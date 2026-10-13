'use strict';

// Conformance monitoring (docs/adr/0058): is a correlated flight doing what its
// clearance says?
//
// [SOURCE-DEFINED] (docs/adr/0058) — the three checks and every threshold
// (config/alerting.json) are ours, not a published standard.
//
// "Nothing is good": this module only ever reports what is WRONG. A flight that
// conforms, has no clearance, or has no correlated track has no record here.
//
// Three checks, each only against what was actually assigned:
//
//   HEADING     only while an HDG is assigned. Course over ground more than
//               `headingToleranceDeg` off it for `headingPersistSec`, after a
//               grace of `headingGraceSec` for the turn (which ends early once
//               the aircraft is on the heading). Both sides are MAGNETIC
//               (decisions H15, docs/adr/0085): the HDG is typed magnetic, and
//               DCS's course is GRID, so the monitor converts it with the
//               injected `gridToMagnetic` before comparing. Where that answer
//               is unknown (no variation, or no projection for the theater)
//               the heading is not checked at all — comparing across frames
//               alerts on a pilot flying the heading exactly.
//   WRONG_WAY   told to climb and descending, or told to descend and climbing,
//               faster than `wrongWayFpm` for `wrongWayPersistSec`. Deliberately
//               NOT "not yet climbing/descending": "descend when ready" is a
//               normal clearance and must never alert.
//   LEVEL_BUST  having reached ALT (within `atAltitudeBandFt`), then more than
//               `levelBustFt` away from it for `levelBustPersistSec`.
//
// All three are skipped below `minGroundSpeedKt`, so nothing alerts on the
// ground. It never moves or advances a Strip (guide §10.3).
//
// On a final (docs/adr/0117, H134 LT-RQ8 a, LT-RQ9 a), a flight whose FINAL Strip is on final (ON_FINAL, or the
// carrier's BALL; a missed approach is checked again: its climb-out heading and altitude are assignments, para 5-10-12):
//   - no HEADING check. The final controller's headings are course guidance changed every few seconds ("HEADING
//     (heading)", JO 7110.65BB para 5-12-4) and course deviation is its own continuous call, so they are recorded on
//     the flight, never alerted; AP's last vector stops alerting at the handoff.
//   - at an airfield (PAR), the altitude is checked until "BEGIN DESCENT" (para 5-12-3), which ends the assigned
//     altitude (board/ops/final-call.js), so there is then nothing to check: the glidepath is the reference.
//   - on the carrier, no altitude check from the final on. JO 7110.65 is silent on the carrier final (no CATCC
//     procedures in the order); the same rule applied by analogy, without a descent call, is OURS.
// Ours too: which Strips count as "on a final".
//
// Under MARSA with a tanker (docs/adr/0118, T17, H134 LT-RQ10, research Q6): once the tanker has accepted MARSA (JO 7110.65BB
// para 9-2-13 NOTE c; JO 7610.14A para 5-5-3 a), the climb to the tanker and the join are the participants' business, and
// ATC's single assigned altitude no longer governs a RECEIVER. So a receiver gets no HEADING check (the tanker navigates for
// it, 7610.14A para 5-5-7 d) and no check against its assigned altitude; it is checked against the REFUELING BLOCK RELATIVE TO
// THE TANKER instead (evaluateRefuelingBlock): within `refuelingBlockFt` above or below the tanker's altitude and within
// `refuelingLateralNm` of it. The 3 miles are the order's (7610.14A para 5-5-3 c.3, 7110.65BB para 9-2-13 c NOTE 3: "the tanker
// must keep receiver aircraft within 3 miles of the tanker until MARSA is terminated"); the +/-1,000 ft is OURS (H134 LT-RQ10:
// the orders give 1,000 ft between the tanker's lowest altitude and the receiver before the rendezvous, para 5-5-6 a, and
// three consecutive altitudes for the AR block, para 5-5-1 d, but no vertical limit relative to the tanker after it).
// The wrong-way logic is the ordinary one measured from the block: outside it and moving away is WRONG_WAY (2,000 ft below
// and climbing toward it is fine; 1,350 ft below and descending is not); having been inside it, more than `levelBustFt`
// (our usual buffer) outside is LEVEL_BUST; having been within the 3 miles, outside them is TANKER_DISTANCE. The tanker keeps
// its ordinary checks (ATC cleared its block, para 9-2-13). When MARSA ends or is voided the receiver is back on its own
// clearance at once. A tanker whose track is not correlated, or that cannot be told among the participants, leaves the
// receivers with no altitude check at all (H134 LT-RQ10 a's fallback).

const { activeClearanceEntry } = require('./flight-data-store');
const { WALL_CLOCK } = require('../mission-clock');

const { MS_PER_KT } = require('../units');
const FPM_PER_MS = 196.850394;

/** Smallest angle between two headings, 0–180. */
function headingDiff(a, b) {
  const d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
  return d;
}

/**
 * One flight, one moment. Pure: all memory lives in `mem`, which the caller
 * keeps per flight and passes back next time.
 *
 * @param {object} input  { hdg: {parsed, at}|null, alt: {parsed, block?: {lowFt, highFt}, at}|null,
 *                          course, groundSpeedMs, verticalSpeedMs, altFt }
 * @param {object} mem    per-flight memory (mutated)
 * @param {number} now    ms, mission time (stamps, `since`)
 * @param {number} [wallNow] ms, wall time (docs/adr/0096): the heading grace and the three persistence durations (heading, wrong-way, level-bust) are measured on it, `since` stays mission; defaults to `now`
 * @param {object} cfg    thresholds (alerting-config.js)
 * @returns {object[]} the alerts that apply now, [] when conforming
 */
function evaluateConformance(input, mem, now, cfg, wallNow = now) {
  const alerts = [];
  // The grace is a pure duration, so it runs on the wall clock from the moment the
  // monitor first sees this clearance (its own `at` is mission time, docs/adr/0096).
  if (input.hdg && Number.isFinite(input.hdg.parsed) && mem.hdgWallFor !== input.hdg.at) {
    mem.hdgWallFor = input.hdg.at; mem.hdgSeenWall = wallNow;
  }
  if (!Number.isFinite(input.groundSpeedMs) || input.groundSpeedMs < cfg.minGroundSpeedKt * MS_PER_KT) {
    mem.hdgDevSince = null; mem.wrongSince = null; mem.bustSince = null;
    mem.hdgDevWall = null; mem.wrongWall = null; mem.bustWall = null;
    return alerts;
  }

  // ── heading ──
  // input.course is magnetic here, or null when it could not be converted.
  const hdg = input.hdg && Number.isFinite(input.hdg.parsed) ? input.hdg : null;
  if (hdg && Number.isFinite(input.course)) {
    if (mem.hdgFor !== hdg.at) { mem.hdgFor = hdg.at; mem.hdgCaptured = false; mem.hdgDevSince = null; mem.hdgDevWall = null; }
    const off = headingDiff(input.course, hdg.parsed);
    if (off <= cfg.headingToleranceDeg) mem.hdgCaptured = true;
    const inGrace = !mem.hdgCaptured && wallNow - mem.hdgSeenWall < cfg.headingGraceSec * 1000;
    if (off > cfg.headingToleranceDeg && !inGrace) {
      if (mem.hdgDevSince == null) { mem.hdgDevSince = now; mem.hdgDevWall = wallNow; }
      if (wallNow - mem.hdgDevWall >= cfg.headingPersistSec * 1000) {
        alerts.push({ kind: 'HEADING', assigned: hdg.parsed, actual: Math.round(input.course) % 360 || 360, since: mem.hdgDevSince });
      }
    } else {
      mem.hdgDevSince = null; mem.hdgDevWall = null;
    }
  } else {
    mem.hdgFor = null; mem.hdgDevSince = null; mem.hdgDevWall = null;
  }

  // ── altitude ──
  const alt = input.alt && (input.alt.block || Number.isFinite(input.alt.parsed)) ? input.alt : null;
  if (alt && Number.isFinite(input.altFt)) {
    if (mem.altFor !== alt.at) { mem.altFor = alt.at; mem.reached = false; mem.wrongSince = null; mem.bustSince = null; mem.wrongWall = null; mem.bustWall = null; }
    // A block (docs/adr/0091) is a band: no deviation anywhere inside it, and
    // outside it the distance to the NEAREST edge, so the edge tolerance and the
    // bust threshold are the same as for a single altitude. `edge` is the
    // altitude the alert is measured from.
    const low = alt.block ? alt.block.lowFt : alt.parsed;
    const high = alt.block ? alt.block.highFt : alt.parsed;
    const edge = input.altFt < low ? low : input.altFt > high ? high : input.altFt;
    const diff = edge - input.altFt; // + means the aircraft is below its clearance
    const assigned = alt.block ? (diff === 0 ? (high - input.altFt <= input.altFt - low ? high : low) : edge) : alt.parsed;
    const blockOut = alt.block ? { block: { lowFt: alt.block.lowFt, highFt: alt.block.highFt } } : {};
    if (Math.abs(diff) <= cfg.atAltitudeBandFt) mem.reached = true;

    const fpm = Number.isFinite(input.verticalSpeedMs) ? input.verticalSpeedMs * FPM_PER_MS : 0;
    const wrongWay = Math.abs(diff) > cfg.atAltitudeBandFt
      && ((diff > 0 && fpm < -cfg.wrongWayFpm) || (diff < 0 && fpm > cfg.wrongWayFpm));
    if (wrongWay && !mem.reached) {
      if (mem.wrongSince == null) { mem.wrongSince = now; mem.wrongWall = wallNow; }
      if (wallNow - mem.wrongWall >= cfg.wrongWayPersistSec * 1000) {
        alerts.push({ kind: 'WRONG_WAY', assigned, ...blockOut, altFt: Math.round(input.altFt), fpm: Math.round(fpm), since: mem.wrongSince });
      }
    } else {
      mem.wrongSince = null; mem.wrongWall = null;
    }

    if (mem.reached && Math.abs(diff) > cfg.levelBustFt) {
      if (mem.bustSince == null) { mem.bustSince = now; mem.bustWall = wallNow; }
      if (wallNow - mem.bustWall >= cfg.levelBustPersistSec * 1000) {
        alerts.push({ kind: 'LEVEL_BUST', assigned, ...blockOut, altFt: Math.round(input.altFt), deviationFt: Math.round(-diff), since: mem.bustSince });
      }
    } else {
      mem.bustSince = null; mem.bustWall = null;
    }
  } else {
    mem.altFor = null; mem.reached = false; mem.wrongSince = null; mem.bustSince = null; mem.wrongWall = null; mem.bustWall = null;
  }
  return alerts;
}

/**
 * A receiver under MARSA with a tanker (the header's "Under MARSA with a tanker"). Pure, like evaluateConformance.
 *
 * @param {object} input  { altFt, verticalSpeedMs, groundSpeedMs, tankerAltFt, distanceNm, tanker: callsign }
 * @param {object} mem    per-flight memory (mutated)
 * @returns {object[]} WRONG_WAY / LEVEL_BUST with `block` and `tanker`, TANKER_DISTANCE; [] inside the block
 */
function evaluateRefuelingBlock(input, mem, now, cfg, wallNow = now) {
  const alerts = [];
  if (!Number.isFinite(input.groundSpeedMs) || input.groundSpeedMs < cfg.minGroundSpeedKt * MS_PER_KT
    || !Number.isFinite(input.altFt) || !Number.isFinite(input.tankerAltFt)) {
    mem.arWrongSince = null; mem.arWrongWall = null; mem.arBustSince = null; mem.arBustWall = null; mem.arFarSince = null; mem.arFarWall = null;
    return alerts;
  }
  const half = cfg.refuelingBlockFt ?? 1000;
  const lowFt = Math.round(input.tankerAltFt - half);
  const highFt = Math.round(input.tankerAltFt + half);
  const edge = input.altFt < lowFt ? lowFt : input.altFt > highFt ? highFt : input.altFt;
  const diff = edge - input.altFt; // + means below the block
  if (diff === 0) mem.arReached = true;
  const block = { lowFt, highFt };
  const fpm = Number.isFinite(input.verticalSpeedMs) ? input.verticalSpeedMs * FPM_PER_MS : 0;

  const away = (diff > 0 && fpm < -cfg.wrongWayFpm) || (diff < 0 && fpm > cfg.wrongWayFpm);
  if (away) {
    if (mem.arWrongSince == null) { mem.arWrongSince = now; mem.arWrongWall = wallNow; }
    if (wallNow - mem.arWrongWall >= cfg.wrongWayPersistSec * 1000) {
      alerts.push({ kind: 'WRONG_WAY', assigned: edge, block, tanker: input.tanker, altFt: Math.round(input.altFt), fpm: Math.round(fpm), since: mem.arWrongSince });
    }
  } else { mem.arWrongSince = null; mem.arWrongWall = null; }

  if (mem.arReached && Math.abs(diff) > cfg.levelBustFt) {
    if (mem.arBustSince == null) { mem.arBustSince = now; mem.arBustWall = wallNow; }
    if (wallNow - mem.arBustWall >= cfg.levelBustPersistSec * 1000) {
      alerts.push({ kind: 'LEVEL_BUST', assigned: edge, block, tanker: input.tanker, altFt: Math.round(input.altFt), deviationFt: Math.round(-diff), since: mem.arBustSince });
    }
  } else { mem.arBustSince = null; mem.arBustWall = null; }

  const limitNm = cfg.refuelingLateralNm ?? 3;
  if (Number.isFinite(input.distanceNm)) {
    if (input.distanceNm <= limitNm) mem.arClose = true;
    if (mem.arClose && input.distanceNm > limitNm) {
      if (mem.arFarSince == null) { mem.arFarSince = now; mem.arFarWall = wallNow; }
      if (wallNow - mem.arFarWall >= cfg.levelBustPersistSec * 1000) {
        alerts.push({ kind: 'TANKER_DISTANCE', tanker: input.tanker, nm: Math.round(input.distanceNm * 10) / 10, limitNm, since: mem.arFarSince });
      }
    } else { mem.arFarSince = null; mem.arFarWall = null; }
  }
  return alerts;
}

const callsignKey = (s) => String(s || '').replace(/[\s-]/g, '').toUpperCase();

/**
 * Which flights are receivers under MARSA with a tanker (docs/adr/0118): every ACTIVE relation the tanker accepted
 * (`startEvent: 'TANKER_ACCEPTED'`, JO 7110.65BB para 9-2-13 NOTE c). The tanker is the participant the ATO tasks as one
 * (`military.arInfo.asTanker`), else the one whose callsign is the declaring callsign (the tanker declares, para 9-2-13 NOTE
 * c; ours). Every other participant is a receiver. With no tanker found, the receivers are still listed, with
 * `tankerFlightDataId: null`, so they get no altitude check rather than their old clearance's.
 * @param {object[]} relations every MARSA relation
 * @param {(flightDataId:string) => object|null} flightDataOf
 * @returns {Map<string, {tankerFlightDataId:string|null, tanker:string}>}
 */
function refuelingReceivers(relations, flightDataOf) {
  const out = new Map();
  for (const relation of relations || []) {
    if (relation.state !== 'ACTIVE' || relation.startEvent !== 'TANKER_ACCEPTED') continue;
    const fd = (id) => flightDataOf(id) || null;
    const isAtoTanker = (id) => { const f = fd(id); return !!(f && f.military && f.military.arInfo && f.military.arInfo.asTanker); };
    const callsignOf = (id) => { const f = fd(id); return (f && f.identity && f.identity.callsign) || null; };
    const tankerFlightDataId = relation.participants.find(isAtoTanker)
      || relation.participants.find(id => callsignKey(callsignOf(id)) && callsignKey(callsignOf(id)) === callsignKey(relation.declaringCallsign))
      || null;
    const tanker = (tankerFlightDataId && callsignOf(tankerFlightDataId)) || relation.declaringCallsign;
    for (const id of relation.participants) if (id !== tankerFlightDataId) out.set(id, { tankerFlightDataId, tanker });
  }
  return out;
}

/** Great-circle-free distance in NM between two {lat, lon}: a flat earth, plenty for a few miles. */
function distanceNm(a, b) {
  const cosLat = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const dx = (b.lon - a.lon) * 111320 * cosLat;
  const dy = (b.lat - a.lat) * 110540;
  return Math.hypot(dx, dy) / 1852;
}

/**
 * Runs evaluateConformance for every correlated flight, once per tick, and
 * reports the flights whose alerts changed.
 */
class ConformanceMonitor {
  /**
   * @param {object} deps { trackStore, flightDataStore, correlationStore, weather: () => {pressurePa,tempK},
   *                        transitionAltFt: () => number, indicatedAltFt, config, clock?, wallClock?,
   *                        gridToMagnetic?: (gridDeg, lat, lon) => number|null,
   *                        finals?: () => Map<flightDataId, 'AIRFIELD'|'CARRIER'>,
   *                        refueling?: () => Map<receiverFlightDataId, {tankerFlightDataId:string|null, tanker:string}> }
   * `refueling` names the receivers under MARSA with a tanker (the header's "Under MARSA with a tanker"), read once per tick.
   * `finals` names the flights on a final (a live FINAL Strip) and where, read once per tick (the header's "On a final").
   * `gridToMagnetic` turns DCS's GRID course into magnetic (server.js passes
   * theater-context.js's, docs/adr/0085). Without it every answer is
   * "unknown", so no heading alert is raised — never a cross-frame compare.
   */
  constructor(deps) {
    this._d = deps;
    // The mission clock (docs/adr/0079): an alert's `since` is shown to
    // controllers. The heading grace and the heading/wrong-way/level-bust persistence are pure durations and run on the wall
    // clock (docs/adr/0096).
    this._clock = deps.clock || WALL_CLOCK;
    this._wallClock = deps.wallClock || WALL_CLOCK; // docs/adr/0096
    this._gridToMagnetic = deps.gridToMagnetic || (() => null);
    this._mem = new Map();    // flightDataId -> memory
    this._alerts = new Map(); // flightDataId -> alerts[]
  }

  /** Every flight with an alert right now: [{ flightDataId, alerts }]. */
  getAll() {
    return [...this._alerts.entries()].map(([flightDataId, alerts]) => ({ flightDataId, alerts }));
  }

  /** @returns {boolean} whether any flight's alerts changed */
  tick(now = this._clock.now(), wallNow = this._wallClock.now()) {
    const { trackStore, flightDataStore, correlationStore, config } = this._d;
    const seen = new Set();
    let changed = false;
    const finals = this._d.finals ? this._d.finals() : new Map();
    const refueling = this._d.refueling ? this._d.refueling() : new Map();
    const live = new Map(); // flightDataId -> track, for the tanker lookup
    for (const record of correlationStore.getAll()) {
      if (!record.trackId || (record.state !== 'CORRELATED' && record.state !== 'PROVISIONAL')) continue;
      const track = trackStore.get(record.trackId);
      if (track) live.set(record.flightDataId, track);
    }
    const altOf = (track) => this._d.indicatedAltFt(track.alt, this._d.weather(), this._d.transitionAltFt());
    for (const [flightDataId, track] of live) {
      const flightData = flightDataStore.getFlightData(flightDataId);
      if (!flightData) continue;
      seen.add(flightDataId);
      const mem = this._mem.get(flightDataId) || {};
      this._mem.set(flightDataId, mem);
      const altFt = altOf(track);
      const ar = refueling.get(flightDataId);
      if (ar) {
        // docs/adr/0118: the receiver is checked against the block around the tanker, never its own clearance.
        if (mem.mode !== 'AR') { for (const k of Object.keys(mem)) delete mem[k]; mem.mode = 'AR'; }
        const tankerTrack = ar.tankerFlightDataId ? live.get(ar.tankerFlightDataId) : null;
        const alerts = tankerTrack ? evaluateRefuelingBlock({
          altFt, verticalSpeedMs: track.verticalSpeed, groundSpeedMs: track.groundSpeed,
          tankerAltFt: altOf(tankerTrack), distanceNm: distanceNm(track, tankerTrack), tanker: ar.tanker,
        }, mem, now, config, wallNow) : [];
        changed = this._set(flightDataId, alerts) || changed;
        continue;
      }
      if (mem.mode === 'AR') { for (const k of Object.keys(mem)) delete mem[k]; }
      const onFinal = finals.get(flightDataId) || null;
      const alerts = evaluateConformance({
        hdg: onFinal ? null : activeClearanceEntry(flightData, 'heading'),
        alt: onFinal === 'CARRIER' ? null : activeClearanceEntry(flightData, 'altitude'),
        course: Number.isFinite(track.course) ? this._gridToMagnetic(track.course, track.lat, track.lon) : null,
        groundSpeedMs: track.groundSpeed, verticalSpeedMs: track.verticalSpeed, altFt,
      }, mem, now, config, wallNow);
      changed = this._set(flightDataId, alerts) || changed;
    }
    for (const flightDataId of [...this._alerts.keys()]) {
      if (!seen.has(flightDataId)) { this._alerts.delete(flightDataId); changed = true; }
    }
    for (const flightDataId of [...this._mem.keys()]) if (!seen.has(flightDataId)) this._mem.delete(flightDataId);
    return changed;
  }

  _set(flightDataId, alerts) {
    // A refueling alert's edge moves with the tanker: the tanker it is measured from is what identifies it (docs/adr/0118).
    const key = (list) => list.map(a => (a.tanker !== undefined ? `${a.kind}:AR:${a.tanker}` : `${a.kind}:${a.assigned}:${a.actual ?? ''}:${a.deviationFt ?? ''}`)).join('|');
    const prev = this._alerts.get(flightDataId) || [];
    if (alerts.length === 0) {
      if (prev.length === 0) return false;
      this._alerts.delete(flightDataId);
      return true;
    }
    // Numbers that drift every tick (altitude, rate) do not count as a change on
    // their own — only which alerts apply, and the assigned values behind them.
    const changed = key(prev) !== key(alerts);
    this._alerts.set(flightDataId, alerts);
    return changed;
  }
}

module.exports = { evaluateConformance, evaluateRefuelingBlock, refuelingReceivers, headingDiff, ConformanceMonitor, FPM_PER_MS, MS_PER_KT };
