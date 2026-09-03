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
// style) — no timers, just "given this Strip/FDR/now/ctx, what's due right
// now." `ForwardingObligationMonitor` is the stateful scanner that ticks
// over every Strip across every Facility, de-duplicates repeat alerts per
// Strip+obligation, and keeps unpersisted compliance counters (mirrors
// crc-desktop's efsp-panel.js `_searchInvocationCount` — a minimal §11.5
// instrumentation hook, not a real dashboard).

const ADVANCE_FORWARDING_MINUTES = 15;   // §4.6.1
const ETA_REVISION_THRESHOLD_MINUTES = 3; // §4.6.1
const AMENDMENT_WINDOW_MINUTES = 30;      // §4.6.1
const DATA_ONLY_VERIFICATION_MINUTES = 3; // §4.6.1

/**
 * @param {object} strip
 * @param {object} fdr
 * @param {number} now
 * @param {{dataOnly?:boolean}} [ctx] — `dataOnly`: is the Facility this
 *   Strip lives at (the RECEIVING side of an active coordination link)
 *   configured data-only (facility-config.js)? Neither real Facility this
 *   slice sets this true — only a synthetic test fixture exercises the
 *   DATA_ONLY_VERIFICATION branch.
 * @returns {Array<{obligationType:string, dueAt:number, severity:'WARNING'|'OVERDUE'}>}
 */
function computeDueObligations(strip, fdr, now, ctx = {}) {
  const obligations = [];
  if (!strip || !fdr) return obligations;
  const { dataOnly = false } = ctx;

  // ADVANCE_FORWARDING — at least 15 minutes before the aircraft is
  // estimated to enter the receiving Facility's area. Only relevant while
  // this Strip hasn't been forwarded at all yet (no coordination link).
  if (strip.role === 'ARRIVAL' && !strip.coordination && fdr.filed.estimatedArrivalTimeUtc) {
    const dueAt = fdr.filed.estimatedArrivalTimeUtc - ADVANCE_FORWARDING_MINUTES * 60 * 1000;
    if (now >= dueAt) {
      obligations.push({
        obligationType: 'ADVANCE_FORWARDING', dueAt,
        severity: now >= fdr.filed.estimatedArrivalTimeUtc ? 'OVERDUE' : 'WARNING',
      });
    }
  }

  // ETA_REVISION — forward again once the estimate has moved by more than
  // 3 minutes since it was last forwarded (strip.coordination.
  // lastForwardedEtaUtc, stamped by board-store.js's coordination methods).
  if (strip.coordination && (strip.coordination.state === 'PROPOSED' || strip.coordination.state === 'ACTIVE')
    && fdr.filed.estimatedArrivalTimeUtc && strip.coordination.lastForwardedEtaUtc) {
    const drift = Math.abs(fdr.filed.estimatedArrivalTimeUtc - strip.coordination.lastForwardedEtaUtc);
    if (drift > ETA_REVISION_THRESHOLD_MINUTES * 60 * 1000) {
      obligations.push({ obligationType: 'ETA_REVISION', dueAt: now, severity: 'WARNING' });
    }
  }

  // AMENDMENT_INSIDE_30MIN — an amendment inside 30 minutes of proposed
  // departure requires verbal AND automated coordination. [SIMPLIFIED]:
  // "just amended" is approximated as "the FDR's updatedAt is within the
  // last 60 seconds" — no separate amendment-event feed exists to check
  // against instead. Documented in docs/adr/0021.
  if (strip.role === 'DEPARTURE' && fdr.filed.proposedDepartureTimeUtc) {
    const untilDeparture = fdr.filed.proposedDepartureTimeUtc - now;
    const recentlyAmended = fdr.updatedAt != null && now - fdr.updatedAt <= 60 * 1000;
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

  return obligations;
}

const ALERTED_CAP = 20000; // safety cap, same shape as board-store.js's APPLIED_MUTATIONS_CAP

/**
 * Stateful scanner — ticked periodically (server.js) over every Strip
 * across every Facility. De-duplicates: each Strip+obligationType pair
 * alerts at most once (a Strip's obligation, once raised, doesn't repeat
 * every tick — the alert already reached every connected client).
 */
class ForwardingObligationMonitor {
  /**
   * @param {{boardStoreFor:(facilityId:string)=>object, fdrStore:object, facilityConfig:object, onAlert?:(alert:object)=>void}} deps
   */
  constructor({ boardStoreFor, fdrStore, facilityConfig, onAlert }) {
    this._boardStoreFor = boardStoreFor;
    this._fdrStore = fdrStore;
    this._facilityConfig = facilityConfig;
    this._onAlert = onAlert || (() => {});
    this._alerted = new Set(); // `${stripId}:${obligationType}`
    this._compliance = new Map(); // obligationType -> {met, missed}
  }

  tick(now = Date.now()) {
    for (const facilityId of this._facilityConfig.getFacilityIds()) {
      const boardStore = this._boardStoreFor(facilityId);
      if (!boardStore) continue;
      const dataOnly = !!this._facilityConfig.getFacilityConfig(facilityId).dataOnly;

      for (const strip of boardStore.getAll()) {
        if (strip.state === 'DROPPED') continue;
        const fdr = this._fdrStore.getFdr(strip.fdrId);
        if (!fdr) continue;

        for (const obligation of computeDueObligations(strip, fdr, now, { dataOnly })) {
          const key = `${strip.stripId}:${obligation.obligationType}`;
          if (this._alerted.has(key)) continue;
          this._alerted.add(key);
          this._recordMissed(obligation.obligationType);
          this._onAlert({ facilityId, stripId: strip.stripId, ...obligation });
        }
      }
    }
    if (this._alerted.size > ALERTED_CAP) {
      // Drop the oldest half — a long-running server will eventually
      // outgrow this de-dup set; losing the very oldest entries risks a
      // rare re-alert on an ancient, long-dropped Strip, never a missed one.
      const toDrop = [...this._alerted].slice(0, this._alerted.size - ALERTED_CAP / 2);
      for (const key of toDrop) this._alerted.delete(key);
    }
  }

  _recordMissed(obligationType) {
    const stats = this._compliance.get(obligationType) || { met: 0, missed: 0 };
    stats.missed += 1;
    this._compliance.set(obligationType, stats);
  }

  /**
   * A caller (board-store.js's coordination methods, once wired) can call
   * this when a coordination Mutation lands BEFORE its deadline, to count
   * it as compliant. Not automatically wired this slice — no dispatch-
   * level signal yet distinguishes "this Mutation resolved a pending
   * obligation" from "the controller was just doing their job anyway"
   * (docs/adr/0021's documented gap). Exists so §11.5's compliance-rate
   * instrumentation has a real place to plug into once that signal exists.
   */
  recordMet(obligationType) {
    const stats = this._compliance.get(obligationType) || { met: 0, missed: 0 };
    stats.met += 1;
    this._compliance.set(obligationType, stats);
  }

  /** §11.5 "measured acceptance, not asserted" — unpersisted, in-memory, reset on restart (same ephemeral-instrumentation precedent as efsp-panel.js's _searchInvocationCount client-side). */
  getComplianceStats() {
    return Object.fromEntries(this._compliance.entries());
  }
}

module.exports = {
  computeDueObligations, ForwardingObligationMonitor,
  ADVANCE_FORWARDING_MINUTES, ETA_REVISION_THRESHOLD_MINUTES, AMENDMENT_WINDOW_MINUTES, DATA_ONLY_VERIFICATION_MINUTES,
};
