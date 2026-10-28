'use strict';

// The Lua the terrain commands send through DCS-gRPC's CustomService.Eval (docs/adr/0133), and the parsers for what it
// returns. Only tools/terrain/ uses this: a running crc-sync never asks DCS for terrain (tests/terrain-no-dcs.test.mjs).
//
// Each script returns one net.lua2json table, which Eval JSON-encodes again (grpc-client.js evalLua parses twice too).
// Every answer carries `theatre`, so a mission change in the middle of a build stops it instead of mixing two maps.
// `ms` is the script's own run time from os.clock() when the mission environment has `os` (it is often sanitized
// away: then -1, and only the round trip is known).

const UNSAMPLED = -32768;

/** A number as a Lua literal: plain decimal, never an exponent. */
function num(n) {
  if (!Number.isFinite(n)) throw new Error(`not a finite number: ${n}`);
  const s = String(n);
  return /e/i.test(s) ? n.toFixed(12) : s;
}

const CLOCK_START = 'local __t0 = (os and os.clock) and os.clock() or nil';
const CLOCK_MS = 'local __ms = __t0 and (os.clock() - __t0) * 1000 or -1';
const THEATRE = '(env and env.mission and env.mission.theatre) or ""';

/**
 * The map's theater, the DCS version, and the lat/lon of points along the edges of the DCS map rectangle
 * (coord.LOtoLL), from which the build takes its lat/lon box.
 * @param {{xMin:number, xMax:number, zMin:number, zMax:number}} extent
 */
function probeLua(extent, steps = 32) {
  return `
${CLOCK_START}
local X0, X1, Z0, Z1, N = ${num(extent.xMin)}, ${num(extent.xMax)}, ${num(extent.zMin)}, ${num(extent.zMax)}, ${steps}
local pts = {}
for i = 0, N do
  local t = i / N
  local edge = {
    {X0 + (X1 - X0) * t, Z0}, {X0 + (X1 - X0) * t, Z1},
    {X0, Z0 + (Z1 - Z0) * t}, {X1, Z0 + (Z1 - Z0) * t},
  }
  for _, p in ipairs(edge) do
    local lat, lon = coord.LOtoLL({x = p[1], y = 0, z = p[2]})
    pts[#pts + 1] = string.format('%.9f,%.9f', lat, lon)
  end
end
${CLOCK_MS}
local version = (type(_APP_VERSION) == 'string' and _APP_VERSION) or ''
return net.lua2json({theatre = ${THEATRE}, version = version, ms = __ms, pts = table.concat(pts, ';')})
`.trim();
}

/** @returns {{theatre:string, version:string, bbox:{latMin:number, latMax:number, lonMin:number, lonMax:number}}} */
function parseProbe(res) {
  if (!res || typeof res !== 'object' || typeof res.pts !== 'string') throw new Error('the probe answer has no points');
  const bbox = { latMin: Infinity, latMax: -Infinity, lonMin: Infinity, lonMax: -Infinity };
  for (const pair of res.pts.split(';')) {
    const [lat, lon] = pair.split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`the probe answered a bad point ${JSON.stringify(pair)}`);
    bbox.latMin = Math.min(bbox.latMin, lat); bbox.latMax = Math.max(bbox.latMax, lat);
    bbox.lonMin = Math.min(bbox.lonMin, lon); bbox.lonMax = Math.max(bbox.lonMax, lon);
  }
  return { theatre: String(res.theatre || ''), version: String(res.version || ''), bbox };
}

/**
 * Heights for whole grid rows [row0, row0 + rows): for each, coord.LLtoLO then land.getHeight, rounded to metres,
 * row-major, west to east. One packed string, not a table, so 4,000 samples are ~20 kB.
 */
function heightsLua({ latMin, lonMin, latStep, lonStep, cols }, row0, rows) {
  return `
${CLOCK_START}
local LAT0, LON0, DLAT, DLON = ${num(latMin)}, ${num(lonMin)}, ${num(latStep)}, ${num(lonStep)}
local R0, NR, NC = ${row0}, ${rows}, ${cols}
local out, n = {}, 0
for r = R0, R0 + NR - 1 do
  local lat = LAT0 + r * DLAT
  for c = 0, NC - 1 do
    local p = coord.LLtoLO(lat, LON0 + c * DLON, 0)
    n = n + 1
    out[n] = string.format('%d', math.floor(land.getHeight({x = p.x, y = p.z}) + 0.5))
  end
end
${CLOCK_MS}
return net.lua2json({theatre = ${THEATRE}, r0 = R0, rows = NR, cols = NC, ms = __ms, h = table.concat(out, ',')})
`.trim();
}

const clampInt16 = (v) => Math.max(-32767, Math.min(32767, v));

/** @returns {{heights:Int16Array, ms:number}} strict: wrong rows, columns, count or theater throws */
function parseHeights(res, { theater, row0, rows, cols }) {
  if (!res || typeof res !== 'object') throw new Error('the heights answer is not an object');
  if (res.theatre !== theater) throw new Error(`DCS is now running ${JSON.stringify(res.theatre)}, not ${theater}: stopped`);
  if (res.r0 !== row0 || res.rows !== rows || res.cols !== cols) throw new Error(`asked rows ${row0}+${rows}x${cols}, answered ${res.r0}+${res.rows}x${res.cols}`);
  const parts = typeof res.h === 'string' && res.h.length ? res.h.split(',') : [];
  if (parts.length !== rows * cols) throw new Error(`expected ${rows * cols} heights, got ${parts.length}`);
  const heights = new Int16Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const v = Number(parts[i]);
    if (!Number.isInteger(v)) throw new Error(`height ${i} is ${JSON.stringify(parts[i])}`);
    heights[i] = clampInt16(v);
  }
  return { heights, ms: Number.isFinite(res.ms) ? res.ms : -1 };
}

/**
 * For the validate command: the ground under each pair's two ends, land.isVisible between them at their heights above
 * that ground, and land.getHeight at every extra point.
 * @param {Array<{rLat:number, rLon:number, rAgl:number, tLat:number, tLon:number, tAgl:number}>} pairs
 * @param {Array<[number, number]>} points [lat, lon]
 */
function visibilityLua(pairs, points) {
  const P = pairs.map((p) => `{${num(p.rLat)},${num(p.rLon)},${num(p.rAgl)},${num(p.tLat)},${num(p.tLon)},${num(p.tAgl)}}`).join(',');
  const Q = points.map(([lat, lon]) => `{${num(lat)},${num(lon)}}`).join(',');
  return `
${CLOCK_START}
local P = {${P}}
local Q = {${Q}}
local function ground(lat, lon)
  local p = coord.LLtoLO(lat, lon, 0)
  return land.getHeight({x = p.x, y = p.z}), p
end
local pr, qr = {}, {}
for i, v in ipairs(P) do
  local rg, rp = ground(v[1], v[2])
  local tg, tp = ground(v[4], v[5])
  local vis = land.isVisible({x = rp.x, y = rg + v[3], z = rp.z}, {x = tp.x, y = tg + v[6], z = tp.z})
  pr[i] = string.format('%.2f,%.2f,%d', rg, tg, vis and 1 or 0)
end
for i, v in ipairs(Q) do
  qr[i] = string.format('%.2f', (ground(v[1], v[2])))
end
${CLOCK_MS}
return net.lua2json({theatre = ${THEATRE}, ms = __ms, pairs = table.concat(pr, ';'), points = table.concat(qr, ',')})
`.trim();
}

/** @returns {{pairs:Array<{rGround:number, tGround:number, visible:boolean}>, points:number[], ms:number}} */
function parseVisibility(res, { theater, pairCount, pointCount }) {
  if (!res || typeof res !== 'object') throw new Error('the visibility answer is not an object');
  if (res.theatre !== theater) throw new Error(`DCS is now running ${JSON.stringify(res.theatre)}, not ${theater}: stopped`);
  const pairs = (res.pairs ? res.pairs.split(';') : []).map((s) => {
    const [rGround, tGround, vis] = s.split(',').map(Number);
    if (![rGround, tGround].every(Number.isFinite) || (vis !== 0 && vis !== 1)) throw new Error(`bad pair answer ${JSON.stringify(s)}`);
    return { rGround, tGround, visible: vis === 1 };
  });
  const points = res.points ? res.points.split(',').map(Number) : [];
  if (pairs.length !== pairCount || points.length !== pointCount || !points.every(Number.isFinite)) {
    throw new Error(`expected ${pairCount} pairs and ${pointCount} points, got ${pairs.length} and ${points.length}`);
  }
  return { pairs, points, ms: Number.isFinite(res.ms) ? res.ms : -1 };
}

module.exports = { probeLua, parseProbe, heightsLua, parseHeights, visibilityLua, parseVisibility, num, UNSAMPLED };
