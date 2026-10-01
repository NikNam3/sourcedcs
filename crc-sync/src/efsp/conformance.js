'use strict';

// Conformance monitoring (docs/adr/0058): is a correlated flight doing what its
// clearance says?
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

const { activeClearanceEntry } = require('./fdr-store');
const { WALL_CLOCK } = require('../mission-clock');

const MS_PER_KT = 0.514444;
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
 * @param {number} now    ms
 * @param {object} cfg    thresholds (alerting-config.js)
 * @returns {object[]} the alerts that apply now, [] when conforming
 */
function evaluateConformance(input, mem, now, cfg) {
  const alerts = [];
  if (!Number.isFinite(input.groundSpeedMs) || input.groundSpeedMs < cfg.minGroundSpeedKt * MS_PER_KT) {
    mem.hdgDevSince = null; mem.wrongSince = null; mem.bustSince = null;
    return alerts;
  }

  // ── heading ──
  // input.course is magnetic here, or null when it could not be converted.
  const hdg = input.hdg && Number.isFinite(input.hdg.parsed) ? input.hdg : null;
  if (hdg && Number.isFinite(input.course)) {
    if (mem.hdgFor !== hdg.at) { mem.hdgFor = hdg.at; mem.hdgCaptured = false; mem.hdgDevSince = null; }
    const off = headingDiff(input.course, hdg.parsed);
    if (off <= cfg.headingToleranceDeg) mem.hdgCaptured = true;
    const inGrace = !mem.hdgCaptured && now - hdg.at < cfg.headingGraceSec * 1000;
    if (off > cfg.headingToleranceDeg && !inGrace) {
      if (mem.hdgDevSince == null) mem.hdgDevSince = now;
      if (now - mem.hdgDevSince >= cfg.headingPersistSec * 1000) {
        alerts.push({ kind: 'HEADING', assigned: hdg.parsed, actual: Math.round(input.course) % 360 || 360, since: mem.hdgDevSince });
      }
    } else {
      mem.hdgDevSince = null;
    }
  } else {
    mem.hdgFor = null; mem.hdgDevSince = null;
  }

  // ── altitude ──
  const alt = input.alt && (input.alt.block || Number.isFinite(input.alt.parsed)) ? input.alt : null;
  if (alt && Number.isFinite(input.altFt)) {
    if (mem.altFor !== alt.at) { mem.altFor = alt.at; mem.reached = false; mem.wrongSince = null; mem.bustSince = null; }
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
      if (mem.wrongSince == null) mem.wrongSince = now;
      if (now - mem.wrongSince >= cfg.wrongWayPersistSec * 1000) {
        alerts.push({ kind: 'WRONG_WAY', assigned, ...blockOut, altFt: Math.round(input.altFt), fpm: Math.round(fpm), since: mem.wrongSince });
      }
    } else {
      mem.wrongSince = null;
    }

    if (mem.reached && Math.abs(diff) > cfg.levelBustFt) {
      if (mem.bustSince == null) mem.bustSince = now;
      if (now - mem.bustSince >= cfg.levelBustPersistSec * 1000) {
        alerts.push({ kind: 'LEVEL_BUST', assigned, ...blockOut, altFt: Math.round(input.altFt), deviationFt: Math.round(-diff), since: mem.bustSince });
      }
    } else {
      mem.bustSince = null;
    }
  } else {
    mem.altFor = null; mem.reached = false; mem.wrongSince = null; mem.bustSince = null;
  }
  return alerts;
}

/**
 * Runs evaluateConformance for every correlated flight, once per tick, and
 * reports the flights whose alerts changed.
 */
class ConformanceMonitor {
  /**
   * @param {object} deps { trackStore, fdrStore, correlationStore, weather: () => {pressurePa,tempK},
   *                        transitionAltFt: () => number, indicatedAltFt, config, clock?,
   *                        gridToMagnetic?: (gridDeg, lat, lon) => number|null }
   * `gridToMagnetic` turns DCS's GRID course into magnetic (server.js passes
   * theater-context.js's, docs/adr/0085). Without it every answer is
   * "unknown", so no heading alert is raised — never a cross-frame compare.
   */
  constructor(deps) {
    this._d = deps;
    // The mission clock (docs/adr/0079): the heading grace period runs from
    // the clearance's own `at`, which is mission time, and an alert's `since`
    // is shown to controllers.
    this._clock = deps.clock || WALL_CLOCK;
    this._gridToMagnetic = deps.gridToMagnetic || (() => null);
    this._mem = new Map();    // fdrId -> memory
    this._alerts = new Map(); // fdrId -> alerts[]
  }

  /** Every flight with an alert right now: [{ fdrId, alerts }]. */
  getAll() {
    return [...this._alerts.entries()].map(([fdrId, alerts]) => ({ fdrId, alerts }));
  }

  /** @returns {boolean} whether any flight's alerts changed */
  tick(now = this._clock.now()) {
    const { trackStore, fdrStore, correlationStore, config } = this._d;
    const seen = new Set();
    let changed = false;
    for (const record of correlationStore.getAll()) {
      if (!record.trackId || (record.state !== 'CORRELATED' && record.state !== 'PROVISIONAL')) continue;
      const track = trackStore.get(record.trackId);
      const fdr = fdrStore.getFdr(record.fdrId);
      if (!track || !fdr) continue;
      seen.add(record.fdrId);
      const mem = this._mem.get(record.fdrId) || {};
      this._mem.set(record.fdrId, mem);
      const altFt = this._d.indicatedAltFt(track.alt, this._d.weather(), this._d.transitionAltFt());
      const alerts = evaluateConformance({
        hdg: activeClearanceEntry(fdr, 'heading'),
        alt: activeClearanceEntry(fdr, 'altitude'),
        course: Number.isFinite(track.course) ? this._gridToMagnetic(track.course, track.lat, track.lon) : null,
        groundSpeedMs: track.groundSpeed, verticalSpeedMs: track.verticalSpeed, altFt,
      }, mem, now, config);
      changed = this._set(record.fdrId, alerts) || changed;
    }
    for (const fdrId of [...this._alerts.keys()]) {
      if (!seen.has(fdrId)) { this._alerts.delete(fdrId); changed = true; }
    }
    for (const fdrId of [...this._mem.keys()]) if (!seen.has(fdrId)) this._mem.delete(fdrId);
    return changed;
  }

  _set(fdrId, alerts) {
    const key = (list) => list.map(a => `${a.kind}:${a.assigned}:${a.actual ?? ''}:${a.deviationFt ?? ''}`).join('|');
    const prev = this._alerts.get(fdrId) || [];
    if (alerts.length === 0) {
      if (prev.length === 0) return false;
      this._alerts.delete(fdrId);
      return true;
    }
    // Numbers that drift every tick (altitude, rate) do not count as a change on
    // their own — only which alerts apply, and the assigned values behind them.
    const changed = key(prev) !== key(alerts);
    this._alerts.set(fdrId, alerts);
    return changed;
  }
}

module.exports = { evaluateConformance, headingDiff, ConformanceMonitor, FPM_PER_MS, MS_PER_KT };
