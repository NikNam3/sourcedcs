'use strict';

// The TOFI regime monitor (docs/adr/0102): the separation regime picked at TOFI ENTRY accept becomes effective when
// the correlated flight is inside an airspace ACTIVE for the accepting MRU Facility. Leaving, or the airspace
// deactivating, never changes the regime: it raises REGIME_OUTSIDE_AIRSPACE and the way out stays the EXIT handshake.
//
// Clocks (docs/adr/0096): stamps and `since` are mission time; "2 consecutive inside ticks" counts ticks and the
// outside grace (`regimeExitGraceS`) is a pure duration on the injected wall clock.
//
// Only what is WRONG or WAITING is reported, as conformance does. No correlated track is "unknown", never "outside".

const { WALL_CLOCK } = require('../mission-clock');

const ENTRY_TICKS = 2;

/**
 * One flight, one moment. Pure: memory lives in `mem`, kept per flight by the caller.
 * @param {object} input { pending: string|null (a regime waiting for entry), effective: string|null (a non-ATC regime
 *   made effective by an entry), located: boolean (a correlated track with a position), inside: [], unknown: [] }
 * @param {object} mem    per-flight memory (mutated)
 * @param {number} now    mission ms (`since`)
 * @param {{regimeExitGraceS:number}} cfg
 * @param {number} [wallNow] wall ms (the grace); defaults to `now`
 * @returns {{enter: {airspaceId:string}|null, alert: {kind:string, since:number}|null}}
 */
function evaluateRegime(input, mem, now, cfg, wallNow = now) {
  const inside = input.inside || [];
  const unknown = input.unknown || [];
  if (input.pending) {
    mem.outsideWall = null; mem.outsideSince = null;
    if (input.located && inside.length > 0) {
      mem.insideTicks = (mem.insideTicks || 0) + 1;
      mem.awaitingSince = null;
      if (mem.insideTicks >= ENTRY_TICKS) return { enter: { airspaceId: inside[0].airspaceId }, alert: null };
      return { enter: null, alert: null };
    }
    mem.insideTicks = 0;
    // Waiting, and the monitor cannot tell: no position, or an airspace without geometry. DR-8: the MRU marks it by hand.
    if (!input.located || unknown.length > 0) {
      if (mem.awaitingSince == null) mem.awaitingSince = now;
      return { enter: null, alert: { kind: 'AWAITING_ENTRY_UNKNOWN', since: mem.awaitingSince } };
    }
    mem.awaitingSince = null;
    return { enter: null, alert: null };
  }
  mem.insideTicks = 0; mem.awaitingSince = null;
  if (input.effective && input.effective !== 'ATC') {
    if (!input.located || inside.length > 0 || unknown.length > 0) {
      mem.outsideWall = null; mem.outsideSince = null;
      return { enter: null, alert: null };
    }
    if (mem.outsideWall == null) { mem.outsideWall = wallNow; mem.outsideSince = now; }
    if (wallNow - mem.outsideWall >= cfg.regimeExitGraceS * 1000) {
      return { enter: null, alert: { kind: 'REGIME_OUTSIDE_AIRSPACE', since: mem.outsideSince } };
    }
    return { enter: null, alert: null };
  }
  mem.outsideWall = null; mem.outsideSince = null;
  return { enter: null, alert: null };
}

class TofiRegimeMonitor {
  /**
   * @param {object} deps { flightDataStore, locate(flightDataId, facilityId) -> {located, inside, unknown},
   *   activeMarsaFor(flightDataId), enter(flightDataId, {facilityId, airspaceId}) -> {ok, message?},
   *   onEntered(message), config: {regimeExitGraceS}, clock?, wallClock? }
   * `enter` is the Board facade's system mutation (efsp.markTofiEntered); the monitor never writes a store itself.
   */
  constructor(deps) {
    this._d = deps;
    this._clock = deps.clock || WALL_CLOCK;
    this._wallClock = deps.wallClock || WALL_CLOCK;
    this._mem = new Map();    // flightDataId -> memory
    this._alerts = new Map(); // flightDataId -> { kind, since }
  }

  /** The alerts now: [{ flightDataId, kind, since }]. */
  getAll() {
    return [...this._alerts.entries()].map(([flightDataId, a]) => ({ flightDataId, kind: a.kind, since: a.since }));
  }

  /** @returns {boolean} whether the alert list changed (an entry's own delta is sent through `onEntered`) */
  tick(now = this._clock.now(), wallNow = this._wallClock.now()) {
    const { flightDataStore, locate, activeMarsaFor, enter, onEntered, config } = this._d;
    const seen = new Set();
    let changed = false;
    for (const flightData of flightDataStore.getAll()) {
      const tofi = flightData.tofi || {};
      const pending = tofi.pendingSeparationRegime || null;
      const effective = tofi.regimeEffective && tofi.separationRegime !== 'ATC' ? tofi.separationRegime : null;
      if (!pending && !effective) continue;
      const id = flightData.flightDataId;
      // ADR 0051: an active MARSA relation owns the regime, so the monitor leaves the flight alone.
      if (activeMarsaFor(id)) continue;
      seen.add(id);
      const facilityId = pending ? tofi.pendingFacilityId : tofi.regimeEffective.facilityId;
      const loc = locate(id, facilityId) || { located: false, inside: [], unknown: [] };
      const mem = this._mem.get(id) || {};
      this._mem.set(id, mem);
      const out = evaluateRegime({ pending, effective, located: loc.located, inside: loc.inside, unknown: loc.unknown }, mem, now, config, wallNow);
      if (out.enter) {
        const r = enter(id, { facilityId, airspaceId: out.enter.airspaceId });
        if (r && r.ok) { mem.insideTicks = 0; if (r.message && onEntered) onEntered(r.message); }
      }
      changed = this._set(id, out.alert) || changed;
    }
    for (const id of [...this._alerts.keys()]) if (!seen.has(id)) { this._alerts.delete(id); changed = true; }
    for (const id of [...this._mem.keys()]) if (!seen.has(id)) this._mem.delete(id);
    return changed;
  }

  _set(id, alert) {
    const prev = this._alerts.get(id);
    if (!alert) { if (!prev) return false; this._alerts.delete(id); return true; }
    this._alerts.set(id, alert);
    return !prev || prev.kind !== alert.kind;
  }
}

module.exports = { evaluateRegime, TofiRegimeMonitor, ENTRY_TICKS };
