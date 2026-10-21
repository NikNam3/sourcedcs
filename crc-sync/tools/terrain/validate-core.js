'use strict';

// `npm run terrain:validate` (docs/adr/0133): how well grid LOS at each spacing agrees with DCS's own land.isVisible,
// so the human can pick the spacing to build. Run by a human against a DCS server they chose; never by crc-sync.
//
// No full grid is built for this. For every sample pair it asks DCS for the heights at the grid nodes the 24 LOS
// samples fall between, at each spacing, on the same origin the build would use, and interpolates them exactly as the
// server does (src/terrain-grid.js). "direct" is the same 24 samples read straight from land.getHeight, so the table
// separates the error of the grid from the error of sampling the path 24 times.
//
// land.isVisible draws a straight line through DCS's terrain. Our model bends it over a 4/3 earth (src/terrain.js), so
// both are counted: "flat" compares like with like (resolution only), "4/3 earth" is what the server will answer.

const { planGrid } = require('../../src/terrain-grid');
const { losSamplePoints, losProfileBlocked, projectPos } = require('../../src/terrain');
const { visibilityLua, parseVisibility } = require('./lua');
const { probe } = require('./build-core');

const DEFAULTS = { spacings: [1000, 500, 250], pairs: 200, seed: 1, pairsPerEval: 10, pauseMs: 500, radarAglM: 20, minRangeM: 10000, maxRangeM: 150000, maxTargetAglM: 1500 };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded radar->target pairs inside the box (10 % margin), radar on a mast, target low enough to be interesting. */
function makePairs(bbox, o) {
  const rnd = mulberry32(o.seed);
  const mLat = (bbox.latMax - bbox.latMin) * 0.1, mLon = (bbox.lonMax - bbox.lonMin) * 0.1;
  const inside = (lat, lon) => lat > bbox.latMin + mLat && lat < bbox.latMax - mLat && lon > bbox.lonMin + mLon && lon < bbox.lonMax - mLon;
  const out = [];
  for (let guard = 0; out.length < o.pairs && guard < o.pairs * 100; guard++) {
    const rLat = bbox.latMin + mLat + rnd() * (bbox.latMax - bbox.latMin - 2 * mLat);
    const rLon = bbox.lonMin + mLon + rnd() * (bbox.lonMax - bbox.lonMin - 2 * mLon);
    const [tLat, tLon] = projectPos(rLat, rLon, rnd() * 360, o.minRangeM + rnd() * (o.maxRangeM - o.minRangeM));
    if (!inside(tLat, tLon)) continue;
    out.push({ rLat, rLon, rAgl: o.radarAglM, tLat, tLon, tAgl: 30 + rnd() * (o.maxTargetAglM - 30) });
  }
  return out;
}

/** The four grid nodes around a point at a plan: [[row, col, lat, lon] x4]. */
function nodesAround(plan, lat, lon) {
  const r = Math.floor((lat - plan.latMin) / plan.latStep), c = Math.floor((lon - plan.lonMin) / plan.lonStep);
  const out = [];
  for (const [dr, dc] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
    out.push([r + dr, c + dc, plan.latMin + (r + dr) * plan.latStep, plan.lonMin + (c + dc) * plan.lonStep]);
  }
  return out;
}

function bilinearFrom(plan, h, lat, lon) {
  const fy = (lat - plan.latMin) / plan.latStep, fx = (lon - plan.lonMin) / plan.lonStep;
  const r = Math.floor(fy), c = Math.floor(fx), ty = fy - r, tx = fx - c;
  const v = (dr, dc) => h.get(`${r + dr},${c + dc}`);
  const south = v(0, 0) + (v(0, 1) - v(0, 0)) * tx;
  const north = v(1, 0) + (v(1, 1) - v(1, 0)) * tx;
  return south + (north - south) * ty;
}

function flatBlocked(samples, rAlt, tAlt, D) {
  return samples.some(({ d, terrainM }) => terrainM > rAlt + (tAlt - rAlt) * (d / D));
}

/**
 * @param {object} o evalLua, theater, extent, and optional spacings, pairs, seed, pairsPerEval, pauseMs, sleep, print
 * @returns {Promise<{pairs:number, dcsVisible:number, rows:Array<{source:string, flat:number, curved:number}>}>}
 */
async function validateTerrain(o) {
  const opt = { ...DEFAULTS, ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) };
  const sleep = opt.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const print = opt.print || ((l) => process.stdout.write(`${l}\n`));
  if (!opt.extent) throw new Error(`config/theaters.json has no terrainExtent for ${opt.theater}: add the map rectangle first`);

  const { bbox } = await probe(opt.evalLua, opt.theater, opt.extent);
  const plans = opt.spacings.map((s) => ({ spacingM: s, plan: planGrid(bbox, s) }));
  const pairs = makePairs(bbox, opt);
  print(`${opt.theater}: ${pairs.length} pairs, spacings ${opt.spacings.join(' / ')} m, ${opt.pairsPerEval} pairs per Eval`);

  const sources = ['direct', ...plans.map((p) => `${p.spacingM} m`)];
  const agree = Object.fromEntries(sources.map((s) => [s, { flat: 0, curved: 0 }]));
  let dcsVisible = 0;

  for (let b = 0; b < pairs.length; b += opt.pairsPerEval) {
    const batch = pairs.slice(b, b + opt.pairsPerEval);
    // Every point this batch needs, deduplicated: the direct samples, then each spacing's nodes.
    const points = [], index = new Map();
    const want = (lat, lon) => {
      const k = `${lat.toFixed(9)},${lon.toFixed(9)}`;
      if (!index.has(k)) { index.set(k, points.length); points.push([lat, lon]); }
      return index.get(k);
    };
    const perPair = batch.map((p) => {
      const { D, points: samples } = losSamplePoints(p.rLat, p.rLon, p.tLat, p.tLon);
      const direct = samples.map((s) => want(s.lat, s.lon));
      const nodes = plans.map(({ plan }) => {
        const m = new Map();
        for (const s of samples) for (const [r, c, lat, lon] of nodesAround(plan, s.lat, s.lon)) m.set(`${r},${c}`, want(lat, lon));
        return m;
      });
      return { D, samples, direct, nodes };
    });

    const ans = parseVisibility(await opt.evalLua(visibilityLua(batch, points)), { theater: opt.theater, pairCount: batch.length, pointCount: points.length });

    batch.forEach((p, i) => {
      const { D, samples, direct, nodes } = perPair[i];
      const a = ans.pairs[i];
      const rAlt = a.rGround + p.rAgl, tAlt = a.tGround + p.tAgl;
      if (a.visible) dcsVisible += 1;
      const judge = (source, heightOf) => {
        const prof = samples.map((s, j) => ({ d: s.d, terrainM: heightOf(s, j) }));
        if (!flatBlocked(prof, rAlt, tAlt, D) === a.visible) agree[source].flat += 1;
        if (!losProfileBlocked(prof, rAlt, tAlt, D) === a.visible) agree[source].curved += 1;
      };
      judge('direct', (_s, j) => ans.points[direct[j]]);
      plans.forEach(({ spacingM, plan }, k) => {
        const h = new Map([...nodes[k]].map(([key, idx]) => [key, ans.points[idx]]));
        judge(`${spacingM} m`, (s) => bilinearFrom(plan, h, s.lat, s.lon));
      });
    });
    print(`${Math.min(b + opt.pairsPerEval, pairs.length)}/${pairs.length} pairs${ans.ms >= 0 ? `, ${ans.ms.toFixed(1)} ms in DCS` : ''}`);
    if (b + opt.pairsPerEval < pairs.length && opt.pauseMs > 0) await sleep(opt.pauseMs);
  }

  const pct = (n) => `${((100 * n) / Math.max(1, pairs.length)).toFixed(1)}%`;
  print(`DCS land.isVisible: ${dcsVisible} of ${pairs.length} visible`);
  print('source     agree (flat)   agree (4/3 earth)');
  const rows = sources.map((s) => ({ source: s, flat: agree[s].flat, curved: agree[s].curved }));
  for (const r of rows) print(`${r.source.padEnd(10)} ${pct(r.flat).padStart(12)}   ${pct(r.curved).padStart(17)}`);
  return { pairs: pairs.length, dcsVisible, rows };
}

module.exports = { validateTerrain, makePairs, nodesAround, bilinearFrom, DEFAULTS, mulberry32 };
