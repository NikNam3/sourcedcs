'use strict';

// Timed forwarding obligations (EFSPImplementationGuide.md §4.6.1,
// docs/adr/0021) — "exactly the obligations a paper strip cannot track and
// an electronic panel can. Implement each as a countdown with an alert,
// and instrument compliance." No timer/alert machinery of any kind existed
// anywhere in crc-sync's EFSP subsystem before this — nla.js's own
// isVoidExpired() comment ("alerting is a periodic job elsewhere") was
// aspirational, not real, until now.
//
// `computeDueObligations` is pure logic (mirrors nla.js's isVoidExpired
// style) — no timers, just "given this Strip/flight data/now/ctx, what's due right
// now." `ForwardingObligationMonitor` is the stateful scanner that ticks
// over every Strip across every Facility and holds the set of obligations
// due right now — state, not events: one that stops being due leaves the
// set, and clients learn it from the next `efsp-alerts` (docs/adr/0067). It
// also keeps unpersisted compliance counters (a minimal §11.5
// instrumentation hook, not a real dashboard).

const { isVoidExpired, DEPARTURE_STATES } = require('./nla');
const { WALL_CLOCK } = require('../mission-clock');

const ADVANCE_FORWARDING_MINUTES = 15;   // §4.6.1
const ETA_REVISION_THRESHOLD_MINUTES = 3; // §4.6.1
const AMENDMENT_WINDOW_MINUTES = 30;      // §4.6.1
const DATA_ONLY_VERIFICATION_MINUTES = 3; // §4.6.1

/**
 * @param {object} strip
 * @param {object} flightData
 * @param {number} now
 * @param {{dataOnly?:boolean}} [ctx] — `dataOnly`: is the Facility this
 *   Strip lives at (the RECEIVING side of an active coordination link)
 *   configured data-only (facility-config.js)? Neither real Facility this
 *   slice sets this true — only a synthetic test fixture exercises the
 *   DATA_ONLY_VERIFICATION branch.
 * @returns {Array<{obligationType:string, dueAt:number, severity:'WARNING'|'OVERDUE'}>}
 */
function computeDueObligations(strip, flightData, now, ctx = {}) {
  const obligations = [];
  if (!strip || !flightData) return obligations;
  const { dataOnly = false } = ctx;

  // ADVANCE_FORWARDING — at least 15 minutes before the aircraft is
  // estimated to enter the receiving Facility's area. Only relevant while
  // this Strip hasn't been forwarded at all yet (no coordination link).
  if (strip.stripType === 'ARRIVAL' && !strip.coordination && flightData.filed.estimatedArrivalTimeUtc) {
    const dueAt = flightData.filed.estimatedArrivalTimeUtc - ADVANCE_FORWARDING_MINUTES * 60 * 1000;
    if (now >= dueAt) {
      obligations.push({
        obligationType: 'ADVANCE_FORWARDING', dueAt,
        severity: now >= flightData.filed.estimatedArrivalTimeUtc ? 'OVERDUE' : 'WARNING',
      });
    }
  }

  // ETA_REVISION — forward again once the estimate has moved by more than
  // 3 minutes since it was last forwarded (strip.coordination.
  // lastForwardedEtaUtc, stamped by board/coordination.js).
  if (strip.coordination && (strip.coordination.state === 'INITIATED' || strip.coordination.state === 'ACTIVE')
    && flightData.filed.estimatedArrivalTimeUtc && strip.coordination.lastForwardedEtaUtc) {
    const drift = Math.abs(flightData.filed.estimatedArrivalTimeUtc - strip.coordination.lastForwardedEtaUtc);
    if (drift > ETA_REVISION_THRESHOLD_MINUTES * 60 * 1000) {
      obligations.push({ obligationType: 'ETA_REVISION', dueAt: now, severity: 'WARNING' });
    }
  }

  // AMENDMENT_INSIDE_30MIN — an amendment inside 30 minutes of proposed
  // departure requires verbal AND automated coordination. [SIMPLIFIED]:
  // "just amended" is approximated as "the flight data's updatedAt is within the
  // last 60 seconds" — no separate amendment-event feed exists to check
  // against instead. Documented in docs/adr/0021.
  if (strip.stripType === 'DEPARTURE' && flightData.filed.proposedDepartureTimeUtc) {
    const untilDeparture = flightData.filed.proposedDepartureTimeUtc - now;
    const recentlyAmended = flightData.updatedAt != null && now - flightData.updatedAt <= 60 * 1000;
    if (untilDeparture > 0 && untilDeparture <= AMENDMENT_WINDOW_MINUTES * 60 * 1000 && recentlyAmended) {
      obligations.push({ obligationType: 'AMENDMENT_INSIDE_30MIN', dueAt: now, severity: 'WARNING' });
    }
  }

  // DATA_ONLY_VERIFICATION — manual coordination plus verification within
  // 3 minutes of the transfer-of-control-point estimate, for a data-only
  // receiving facility. No separate "verification" action exists this
  // slice, so once due this stays raised (documented gap, docs/adr/0021).
  if (dataOnly && strip.coordination && strip.coordination.state === 'ACTIVE' && strip.coordination.acceptedAt) {
    const dueAt = strip.coordination.acceptedAt + DATA_ONLY_VERIFICATION_MINUTES * 60 * 1000;
    if (now >= dueAt) {
      obligations.push({ obligationType: 'DATA_ONLY_VERIFICATION', dueAt, severity: 'OVERDUE' });
    }
  }

  // VOID_TIME_EXPIRED — §3.8: a clearance void time carries "a derived
  // deadline 30 minutes after the void time, at which the system MUST alert
  // if the flight is not airborne." isVoidExpired() has existed since Phase 1
  // but had exactly one caller: nla.js's own HELD case, where it inhibits the
  // release button. That is a passive check — a controller has to go and look
  // at the Strip to discover it. This is the alert the guide actually asks
  // for, and it is the obligation this module's own header comment was
  // written about (the "aspirational, not real" note above predates it).
  //
  // OVERDUE with no earlier WARNING tier, unlike ADVANCE_FORWARDING: §3.8
  // describes a hard deadline, not a lead-time window, so there is no
  // meaningful "due soon" moment to escalate from.
  if (strip.stripType === 'DEPARTURE' && strip.state === 'HELD' && isVoidExpired(flightData, now)) {
    obligations.push({
      obligationType: 'VOID_TIME_EXPIRED',
      dueAt: flightData.assigned.voidDeadlineUtc,
      severity: 'OVERDUE',
    });
  }

  // UNACTIVATED_AIRSPACE_ENTRY — guide §9.11: "Aircraft entering unactivated
  // airspace MUST alert." The approval itself is deliberately not refused
  // (see board/ops/approve-airspace-entry.js's _applyApproveAirspaceEntry) — the airspace may
  // well be hot in reality with the board simply not caught up, and refusing
  // would be wrong far more often than right. This is the alert that makes
  // allowing it safe.
  //
  // ENTERING, not approved: raised only while the flight is airborne inside the
  // Strip's approved airspace and that airspace is not ACTIVE, the airspace badge's
  // rule (docs/adr/0134, decisions H155 item 4, H161 V2-Q2 a). An approval given
  // early (on the ground, en route) raises nothing; activation, leaving or clearing
  // the approval retracts it. The inside fact is the airspace-entry monitor's
  // (`ctx.insideApprovedAirspace`, airspace-entry-alert.js `isInside`): no second
  // containment test here, and without it nothing is inside (unknown is never inside).
  //
  // OVERDUE with no WARNING tier: the aircraft is either in airspace nobody
  // has activated or it is not. There is no "due soon" about it. Due from the
  // tick it was first seen inside (the monitor keeps an episode's first dueAt).
  if (strip.airspaceEntry && ctx.isAirspaceActive && !ctx.isAirspaceActive(strip.airspaceEntry.airspaceId)
    && ctx.insideApprovedAirspace && ctx.insideApprovedAirspace(strip)) {
    obligations.push({
      obligationType: 'UNACTIVATED_AIRSPACE_ENTRY',
      dueAt: now,
      severity: 'OVERDUE',
    });
  }

  // CONTROL_UNCOVERED / CONTROL_REPAIRED — the control invariant of a HANDOFF (docs/adr/0101, H100 DR-6): a live flight must
  // never have nobody holding comms and control. UNCOVERED is a standing state, recomputed on every tick and Mutation, so
  // it stays on both Facilities' panels until a Position is staffed (a repair that is impossible is not an event that
  // fires once). REPAIRED is the notice that the server moved a holder to the live, staffed side; it stays until the
  // exchange's holders next move (HandoffControl clears `coordination.repair`).
  if (ctx.controlProblems && strip.coordination && strip.coordination.state === 'ACTIVE' && ctx.controlProblems(strip).length) {
    obligations.push({ obligationType: 'CONTROL_UNCOVERED', dueAt: strip.coordination.acceptedAt || now, severity: 'OVERDUE' });
  }
  if (strip.coordination && strip.coordination.repair) {
    obligations.push({ obligationType: 'CONTROL_REPAIRED', dueAt: strip.coordination.repair.at, severity: 'WARNING' });
  }

  // NOT_CHECKED_IN / IN_AIRSPACE_NOT_CHECKED_IN — docs/adr/0122 (H142 dark cockpit): control never moves before the
  // receiver marks the aircraft checked in. An accepted HANDOFF still not checked in after `notCheckedInMs` (alerting.json
  // `handoff.notCheckedInSec`) asks the receiver for attention; a not-released one whose aircraft is already inside the
  // receiver's airspace (control could move but cannot) asks both sides at once.
  const co = strip.coordination;
  if (co && co.primitive === 'HANDOFF' && co.state === 'ACTIVE' && co.comms && !co.comms.transferred
      && co.control && co.control.holder === 'TRANSFERRING') {
    const notCheckedInMs = ctx.notCheckedInMs;
    if (co.mintedForCoordination && Number.isFinite(notCheckedInMs) && co.acceptedAt != null && now - co.acceptedAt >= notCheckedInMs) {
      obligations.push({ obligationType: 'NOT_CHECKED_IN', dueAt: co.acceptedAt + notCheckedInMs, severity: 'WARNING' });
    }
    if (!co.released && ctx.insideReceiverAirspace && ctx.insideReceiverAirspace(strip)) {
      obligations.push({ obligationType: 'IN_AIRSPACE_NOT_CHECKED_IN', dueAt: now, severity: 'WARNING' });
    }
  }

  return obligations;
}

/**
 * The obligations a Strip is *heading towards* — clock running, not yet due
 * — for the only two types whose lead window the monitor can observe
 * (docs/adr/0067). Pure, like computeDueObligations; the monitor uses it to
 * tell "done before it was due" (met) from "never came due for some other
 * reason" (neither). The other four types are due the moment they exist, so
 * they are never pending and can only ever be missed.
 *
 * @returns {Array<{obligationType:string, dueAt:number}>}
 */
function computePendingObligations(strip, flightData, now) {
  const pending = [];
  if (!strip || !flightData) return pending;
  const eta = flightData.filed && flightData.filed.estimatedArrivalTimeUtc;
  if (strip.stripType === 'ARRIVAL' && !strip.coordination && eta) {
    const dueAt = eta - ADVANCE_FORWARDING_MINUTES * 60 * 1000;
    if (now < dueAt) pending.push({ obligationType: 'ADVANCE_FORWARDING', dueAt });
  }
  const voidDeadline = flightData.assigned && flightData.assigned.voidDeadlineUtc;
  if (strip.stripType === 'DEPARTURE' && strip.state === 'HELD' && voidDeadline && now < voidDeadline) {
    pending.push({ obligationType: 'VOID_TIME_EXPIRED', dueAt: voidDeadline });
  }
  return pending;
}

// "Met": the condition that satisfies a pending obligation, checked against
// the same live Strip on the tick its pending window ended. For VOID_TIME,
// "got away" means moved on past HELD in the departure lifecycle — a Strip
// put back to CLEARED did not get away, and one DROPPED is not live.
const HELD_INDEX = DEPARTURE_STATES.indexOf('HELD');
const MET_WHEN = {
  ADVANCE_FORWARDING: (strip) => strip.stripType === 'ARRIVAL' && !!strip.coordination,
  VOID_TIME_EXPIRED: (strip) => strip.stripType === 'DEPARTURE' && strip.state !== 'DROPPED'
    && DEPARTURE_STATES.indexOf(strip.state) > HELD_INDEX,
};

/**
 * Stateful scanner — ticked on the 15 s sweep and right after any EFSP
 * Mutation that broadcast something (server.js) — over every live Strip
 * across every Facility. It holds the set of obligations due *right now*
 * (docs/adr/0067, superseding 0021's "alert at most once"): an obligation
 * whose condition stops being true simply leaves the set, and the whole set
 * rides the `efsp-alerts` full-state message beside conformance and CA.
 *
 * Keyed per Strip replica, not per FLIGHT_DATA: an obligation is a duty of the
 * Facility holding the Strip, so two Facilities' replicas of one flight
 * legitimately differ.
 */
class ForwardingObligationMonitor {
  /**
   * @param {{boardStoreFor:(facilityId:string)=>object, flightDataStore:object, facilityConfig:object, airspaceStore?:object, clock?:object}} deps
   *   A stray `onAlert` is ignored — obligations are state now, not events.
   * @param {{notCheckedInSec?:number}} [deps.handoffConfig] alerting.json `handoff` (docs/adr/0122); without it NOT_CHECKED_IN never fires
   * @param {(strip:object) => boolean} [deps.insideReceiverAirspace] is this HANDOFF's aircraft inside the receiving Position's airspace?
   * @param {(facilityId:string, strip:object) => boolean} [deps.insideApprovedAirspace] is this Strip's flight airborne inside its
   *   approved airspace (docs/adr/0134, the airspace-entry monitor's fact)? Without it UNACTIVATED_AIRSPACE_ENTRY never fires
   */
  constructor({ boardStoreFor, flightDataStore, facilityConfig, airspaceStore, clock = WALL_CLOCK, handoffConfig = null, insideReceiverAirspace = null, insideApprovedAirspace = null }) {
    this._insideApprovedAirspace = insideApprovedAirspace;
    this._notCheckedInMs = handoffConfig && Number.isFinite(handoffConfig.notCheckedInSec) ? handoffConfig.notCheckedInSec * 1000 : null;
    this._insideReceiverAirspace = insideReceiverAirspace;
    // The mission clock (docs/adr/0079) — every obligation here is due at an
    // ETA, a proposed departure or a void deadline, all in mission time.
    this._clock = clock;
    this._boardStoreFor = boardStoreFor;
    this._flightDataStore = flightDataStore;
    this._facilityConfig = facilityConfig;
    this._airspaceStore = airspaceStore || null;
    this._current = new Map(); // `${facilityId}:${stripId}:${obligationType}` -> entry
    this._pending = new Map(); // same key -> { facilityId, stripId, obligationType, dueAt }
    this._compliance = new Map(); // obligationType -> {met, missed}
  }

  /**
   * Recompute the whole due set. Returns true iff it differs from the last
   * one — a key appeared or disappeared, or a severity changed (the
   * ADVANCE_FORWARDING WARNING -> OVERDUE escalation). `dueAt` and `since`
   * are held from the tick an episode was first raised: ETA_REVISION and
   * AMENDMENT_INSIDE_30MIN report `dueAt: now`, and comparing that would
   * make every tick a change.
   */
  tick(now = this._clock.now()) {
    const next = new Map();
    const nextPending = new Map();
    const live = new Map(); // `${facilityId}:${stripId}` -> strip
    const isAirspaceActive = this._airspaceStore
      ? (airspaceId) => this._airspaceStore.isActive(airspaceId)
      : null;

    for (const facilityId of this._facilityConfig.getFacilityIds()) {
      const boardStore = this._boardStoreFor(facilityId);
      if (!boardStore) continue;
      const dataOnly = !!this._facilityConfig.getFacilityConfig(facilityId).dataOnly;
      const insideApprovedAirspace = this._insideApprovedAirspace ? (s) => this._insideApprovedAirspace(facilityId, s) : null;

      for (const strip of boardStore.getAll()) {
        if (strip.state === 'DROPPED') continue;
        const flightData = this._flightDataStore.getFlightData(strip.flightDataId);
        if (!flightData) continue;
        live.set(`${facilityId}:${strip.stripId}`, strip);

        for (const o of computeDueObligations(strip, flightData, now, {
          dataOnly, isAirspaceActive, controlProblems: typeof boardStore.exchangeProblems === 'function' ? (s) => boardStore.exchangeProblems(s.stripId) : null,
          notCheckedInMs: this._notCheckedInMs, insideReceiverAirspace: this._insideReceiverAirspace, insideApprovedAirspace,
        })) {
          const key = `${facilityId}:${strip.stripId}:${o.obligationType}`;
          const prev = this._current.get(key);
          if (!prev) this._recordMissed(o.obligationType);
          next.set(key, {
            facilityId, stripId: strip.stripId, obligationType: o.obligationType,
            severity: o.severity,
            dueAt: prev ? prev.dueAt : o.dueAt,
            since: prev ? prev.since : now,
          });
        }
        for (const p of computePendingObligations(strip, flightData, now)) {
          nextPending.set(`${facilityId}:${strip.stripId}:${p.obligationType}`,
            { facilityId, stripId: strip.stripId, ...p });
        }
      }
    }

    // A pending window that ended this tick: met only if the satisfying
    // condition holds on the same live Strip before the deadline. Anything
    // else (dropped, ETA removed, release state changed) is forgotten.
    for (const [key, p] of this._pending) {
      if (nextPending.has(key) || next.has(key)) continue;
      const strip = live.get(`${p.facilityId}:${p.stripId}`);
      if (strip && now < p.dueAt && MET_WHEN[p.obligationType](strip)) this.recordMet(p.obligationType);
    }

    let changed = next.size !== this._current.size;
    if (!changed) {
      for (const [key, entry] of next) {
        const prev = this._current.get(key);
        if (!prev || prev.severity !== entry.severity) { changed = true; break; }
      }
    }
    this._current = next;
    this._pending = nextPending;
    return changed;
  }

  /** The obligations due right now, sorted by stripId then obligationType. */
  getAll() {
    return [...this._current.values()]
      .map(e => ({ ...e }))
      .sort((a, b) => (a.stripId < b.stripId ? -1 : a.stripId > b.stripId ? 1
        : a.obligationType < b.obligationType ? -1 : a.obligationType > b.obligationType ? 1
          : a.facilityId < b.facilityId ? -1 : a.facilityId > b.facilityId ? 1 : 0));
  }

  _recordMissed(obligationType) {
    const stats = this._compliance.get(obligationType) || { met: 0, missed: 0 };
    stats.missed += 1;
    this._compliance.set(obligationType, stats);
  }

  /**
   * Counts an obligation done before it was due. Its only caller is tick()
   * itself, for the two types computePendingObligations can see coming
   * (docs/adr/0067) — never "any coordination Mutation after an alert",
   * which 0021 rightly rejected as overstating compliance.
   */
  recordMet(obligationType) {
    const stats = this._compliance.get(obligationType) || { met: 0, missed: 0 };
    stats.met += 1;
    this._compliance.set(obligationType, stats);
  }

  /** §11.5 "measured acceptance, not asserted" — unpersisted, in-memory, reset on restart (the same ephemeral-instrumentation precedent as the client's search-invocation count). */
  getComplianceStats() {
    return Object.fromEntries(this._compliance.entries());
  }
}

module.exports = {
  computeDueObligations, computePendingObligations, ForwardingObligationMonitor,
  ADVANCE_FORWARDING_MINUTES, ETA_REVISION_THRESHOLD_MINUTES, AMENDMENT_WINDOW_MINUTES, DATA_ONLY_VERIFICATION_MINUTES,
};
