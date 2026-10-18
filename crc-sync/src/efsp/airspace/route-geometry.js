'use strict';

// "Filed through" by route geometry (docs/adr/0128 §5; H151 MT-Q6 c, H152). Pure: no store, no clock, no I/O. Ours
// throughout: the FAA orders say nothing about how an automation reads a filed route.
//
// A filed route is text (`filed.route`, which a stereo route has already expanded). Its tokens are split on spaces and
// commas; `DCT` is skipped and a `/…` suffix is dropped (`ERGEP/D1+00` -> `ERGEP`). Each token is looked up, in order, in
// the DCS mission's nav points (`missionData.waypoints`, both coalitions), the airports by ICAO (`missionData.airports`)
// and the named fixes of the theater's ROUTE airspaces (`segments[].fix`). The filed departure and destination airports
// (ICAO first) add the two ends. A token nothing resolves is skipped. Consecutive resolved points make legs; the flight is
// filed through an AREA when a leg touches its lateral shape and the filed altitude (else the assigned one) is inside its
// vertical limits or unknown. Fewer than two points: NOT filed through (H152: no fix table until AIRAC cycles; no name
// fallback, H151 MT-Q6 c).

const containment = require('./containment');
const { parseAltitude } = require('../flight-data-store');

const _key = (name) => String(name == null ? '' : name).trim().toUpperCase();
const _ok = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);

/**
 * The lookup tables, built once per tick.
 * @param {{waypoints?:{name:string, lat:number, lon:number}[], airports?:{icao:string|null, lat:number, lon:number}[]}|null} missionData
 * @param {object[]} airspaces airspace views (or bare definitions); the ROUTE ones' fixes are read
 * @returns {{navPoints:Map<string, {lat:number, lon:number}>, airports:Map<string, {lat:number, lon:number}>, routeFixes:Map<string, {lat:number, lon:number}>}}
 */
function buildPointIndex(missionData, airspaces) {
  const navPoints = new Map(); const airports = new Map(); const routeFixes = new Map();
  for (const w of (missionData && missionData.waypoints) || []) {
    const k = _key(w && w.name);
    if (k && _ok(w) && !navPoints.has(k)) navPoints.set(k, { lat: w.lat, lon: w.lon });
  }
  for (const a of (missionData && missionData.airports) || []) {
    const k = _key(a && a.icao);
    if (k && _ok(a) && !airports.has(k)) airports.set(k, { lat: a.lat, lon: a.lon });
  }
  for (const r of airspaces || []) {
    const def = (r && r.definition) || r || {};
    if (def.kind !== 'ROUTE') continue;
    for (const seg of def.segments || []) {
      const k = _key(seg && seg.fix && seg.fix.name);
      if (k && _ok(seg.fix) && !routeFixes.has(k)) routeFixes.set(k, { lat: seg.fix.lat, lon: seg.fix.lon });
    }
  }
  return { navPoints, airports, routeFixes };
}

/** A route token's name: `ERGEP/D1+00` -> `ERGEP`; null for `DCT` and an empty token. */
function tokenName(token) {
  const k = _key(String(token).split('/')[0]);
  return k && k !== 'DCT' ? k : null;
}

/** One name: nav point, else airport ICAO, else ROUTE fix; null when nothing has it. `airportFirst` for the filed ends. */
function resolvePoint(name, index, { airportFirst = false } = {}) {
  const k = _key(name);
  if (!k) return null;
  const order = airportFirst ? [index.airports, index.navPoints, index.routeFixes] : [index.navPoints, index.airports, index.routeFixes];
  for (const m of order) if (m.has(k)) return { name: k, ...m.get(k) };
  return null;
}

/** The resolved points of a flight's filed route, departure first and destination last; unresolved tokens are skipped. */
function routePoints(flightData, index) {
  const filed = (flightData && flightData.filed) || {};
  const out = [];
  const push = (p) => { if (p && !(out.length && out[out.length - 1].name === p.name)) out.push(p); };
  push(resolvePoint(filed.departureAirport, index, { airportFirst: true }));
  for (const token of String(filed.route || '').split(/[\s,]+/)) {
    const name = tokenName(token);
    if (name) push(resolvePoint(name, index));
  }
  push(resolvePoint(filed.destinationAirport, index, { airportFirst: true }));
  return out;
}

/** The flight's altitude as a band in feet: the filed one, else the assigned one (a block is a band); null when unknown. */
function altitudeBandOf(flightData) {
  const filed = flightData && flightData.filed && flightData.filed.requestedAltitude;
  const band = filed != null && filed !== '' ? parseAltitude(filed) : null;
  if (band) return band;
  const cell = flightData && flightData.clearance && flightData.clearance.altitude;
  const active = cell && (cell.entries || []).find(e => e.status === 'ACTIVE');
  if (active && active.block) return { lowFt: active.block.lowFt, highFt: active.block.highFt };
  if (active && Number.isFinite(active.parsed)) return { lowFt: active.parsed, highFt: active.parsed };
  return null;
}

/** Does the band reach into the definition's vertical limits (a null limit is open)? */
function bandOverlaps(band, def) {
  if (def.altLowerFt != null && band.highFt < def.altLowerFt) return false;
  if (def.altUpperFt != null && band.lowFt > def.altUpperFt) return false;
  return true;
}

/**
 * Is this flight filed through this AREA, by geometry? False for anything without a polygon, and for fewer than two
 * resolved points.
 * @param {object} flightData
 * @param {object} def the airspace definition
 * @param {ReturnType<typeof buildPointIndex>} index
 */
function filedThrough(flightData, def, index) {
  if (!def || def.kind !== 'AREA') return false;
  const polygon = def.geometry && Array.isArray(def.geometry.points) && def.geometry.points.length >= 3 ? def.geometry.points : null;
  if (!polygon) return false;
  const points = routePoints(flightData, index);
  if (points.length < 2) return false;
  let crosses = false;
  for (let i = 0; i < points.length - 1 && !crosses; i++) {
    crosses = containment.legCrossesPolygon([points[i].lat, points[i].lon], [points[i + 1].lat, points[i + 1].lon], polygon);
  }
  if (!crosses) return false;
  const band = altitudeBandOf(flightData);
  return !band || bandOverlaps(band, def);
}

module.exports = { buildPointIndex, tokenName, resolvePoint, routePoints, altitudeBandOf, filedThrough };
