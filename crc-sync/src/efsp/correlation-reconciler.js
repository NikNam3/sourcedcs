'use strict';

// The correlation sweep (EFSPImplementationGuide.md §6.6) — what runs the
// ladder, once a second, and reports the rate.
//
// Built on forwarding-obligations.js's shape: injected dependencies, a tick()
// driven from server.js, an onDelta callback, and getStats() as the §11.5
// instrumentation hook. It lives OUTSIDE createEfsp() for the same reason the
// obligation monitor does — only server.js has the TrackStore — while the
// store it drives lives inside, because that is where the MutationLog, the
// atomic _persist and the snapshot file are.
//
// WHY A TICK, and not an event. TrackStore has no emitter; its delta log is
// consumed per client session. The available signal is grpcClient's 'unit'
// event, which fires per unit per DCS update — hundreds a second for a picture
// that has not meaningfully changed — and each would land on the immediate-
// broadcast path docs/adr/0004 reserved for controller actions under a <200ms
// budget. And not on demand, because §6.6 rule 3 forbids SILENT breakage: a
// broken binding must warn whether or not anyone is looking, and rule 6's rate
// has to be measured continuously rather than sampled when someone clicks.
//
// The tick does NOT govern the <1s selection budget (rule 4). Strip->track
// highlighting never passes through here: the Strip panel and the map live in
// one renderer, so it is a local Map lookup. What the tick bounds is how fresh
// `trackId` is — one second, against a benchmark of one second, for the single
// case of a contact that has only just appeared.

const {
  callsignAffinity, buildTrackIndices, AFFINITY_EXACT,
} = require('./correlation-match');

const CORRELATION_TICK_MS = 1000;

// §6.6 rule 6: "If it drops below 95% in operation, that is a defect, not a
// fact of life." The measured real-world figure was 85-90%.
const CORRELATION_RATE_TARGET = 0.95;

// Below this many eligible flights the rate is noise — one pre-taxi outlier
// would read as a 50% correlation failure. A floor on crying wolf, not on
// measuring.
const RATE_WARN_MIN_ELIGIBLE = 3;
const RATE_WARN_INTERVAL_MS = 60000;

// States in which there is no contact to find, so the flight is not counted in
// the denominator either.
//
// An EXCLUSION list, per docs/adr/0041's lesson. An inclusion list would mean
// a state added in WP6 or WP7 silently leaves the denominator, and the rate
// silently RISES — flattering and wrong. With an exclusion list a new state
// defaults to eligible, so the rate FALLS and somebody notices. A test holds
// every state in nla.js's STATES_BY_ROLE to being either listed here or
// eligible, so adding one forces the decision rather than defaulting it.
const INELIGIBLE_STATES = new Set([
  // Pre-movement: the aircraft may not even be spawned.
  'PROPOSED', 'PENDING_CLEARANCE', 'CLEARED', 'HELD',
  // An ATO line exists before the jet does.
  'TASKED',
  'DROPPED',
]);

class CorrelationReconciler {
  /**
   * @param {object} deps
   * @param {object} deps.trackStore
   * @param {object} deps.fdrStore
   * @param {object} deps.correlationStore
   * @param {(facilityId:string)=>object|null} deps.boardStoreFor
   * @param {object} deps.facilityConfig
   * @param {(track:object)=>string|null} deps.beaconOf — the Mode 3/A code the
   *   aircraft's transponder is sending, or null (Transponders#transponderOf).
   * @param {(payload:object)=>void} [deps.onDelta] — called ONCE per tick with
   *   the records that changed plus the stats, or not at all on a quiet tick.
   */
  constructor({ trackStore, fdrStore, correlationStore, boardStoreFor, facilityConfig, beaconOf, onDelta }) {
    if (typeof beaconOf !== 'function') throw new Error('CorrelationReconciler needs beaconOf');
    this._beaconOf = beaconOf;
    this._trackStore = trackStore;
    this._fdrStore = fdrStore;
    this._store = correlationStore;
    this._boardStoreFor = boardStoreFor;
    this._facilityConfig = facilityConfig;
    this._onDelta = onDelta || (() => {});

    // In-memory, unpersisted, reset on restart — the same minimal §11.5 hook
    // ForwardingObligationMonitor.getComplianceStats() is, and named as such
    // so nobody mistakes it for a dashboard. WP8 owns the real metric set.
    this._ticks = 0;
    this._matchedTickSum = 0;
    this._eligibleTickSum = 0;
    this._minRateSeen = null;
    this._rebinds = 0;
    this._warningsRaised = 0;
    this._warningsRetracted = 0;
    this._matchKeyCounts = { BINDING: 0, BEACON: 0, CALLSIGN_EXACT: 0, CALLSIGN_FUZZY: 0 };
    this._lastRate = null;
    this._lastEligible = 0;
    this._lastWarnAt = 0;
  }

  /** Every live Strip across every Facility, so eligibility can be judged per FDR. */
  _liveStripsByFdr() {
    const byFdr = new Map(); // fdrId -> [strip]
    for (const facilityId of this._facilityConfig.getFacilityIds()) {
      const boardStore = this._boardStoreFor(facilityId);
      if (!boardStore) continue;
      for (const strip of boardStore.getAll()) {
        if (strip.state === 'DROPPED') continue;
        const list = byFdr.get(strip.fdrId);
        if (list) list.push(strip); else byFdr.set(strip.fdrId, [strip]);
      }
    }
    return byFdr;
  }

  /**
   * An FDR is eligible when at least one of its live Strips is in a state
   * where an aircraft could be out there. One Strip is enough: a DEPARTURE
   * Strip parked at PROPOSED and a MISSION Strip AIRBORNE on the same FDR
   * means there is an aircraft.
   */
  static isEligible(strips) {
    return (strips || []).some(s => !INELIGIBLE_STATES.has(s.state));
  }

  /**
   * One ordered claim sweep over every eligible FDR.
   *
   * Rung order, claiming as it goes (§6.6 rule 1): an explicit binding, then
   * the assigned beacon code, then an exact callsign, then a fuzzy one. A
   * higher rung always claims a contact before a lower one can, which gives
   * the priority order for free and makes a collision decidable: if two FDRs
   * would claim one contact at the SAME rung, neither gets it and both are
   * told it was ambiguous. One contact never correlates to two FDRs.
   */
  tick(now = Date.now()) {
    this._ticks += 1;

    const tracks = this._trackStore.getAll();
    const { byBeacon, byStem, byId } = buildTrackIndices(tracks, this._beaconOf);
    const stripsByFdr = this._liveStripsByFdr();

    // A flight with no live Strip anywhere is over, and its record goes with
    // it. Note the distinction from eligibility: a Strip sitting at PROPOSED is
    // live but ineligible — it has no contact YET — and must not be retired.
    this._store.retireFinished(new Set(stripsByFdr.keys()));

    const eligible = [];
    for (const fdr of this._fdrStore.getAll()) {
      const strips = stripsByFdr.get(fdr.fdrId);
      if (!strips || !CorrelationReconciler.isEligible(strips)) continue;
      eligible.push(fdr);
    }

    const claimed = new Map(); // trackId -> fdrId
    const resolutions = new Map(); // fdrId -> resolution | null

    // Rung 1 — an explicit controller binding. It outranks everything the
    // sweep can work out, which is the point of having it: an aircraft with
    // its transponder off and a callsign nothing matches is still a contact
    // the controller can see.
    for (const fdr of eligible) {
      const record = this._store.getCorrelation(fdr.fdrId);
      const bound = record && record.binding && record.binding.trackId;
      if (!bound) continue;
      const track = byId.get(String(bound));
      if (!track) continue; // the contact is gone — later rungs get a chance
      claimed.set(String(bound), fdr.fdrId);
      resolutions.set(fdr.fdrId, {
        trackId: String(bound), matchedBy: 'BINDING', state: 'CORRELATED',
        observedBeacon: this._beaconOf(track),
      });
    }

    // Rung 2 — the assigned Mode 3/A code, observed on a contact.
    for (const fdr of eligible) {
      if (resolutions.has(fdr.fdrId)) continue;
      const assigned = fdr.identity.beaconAssigned;
      if (!assigned) continue;
      const candidates = (byBeacon.get(assigned) || []).filter(id => !claimed.has(id));
      if (candidates.length === 0) continue;
      if (candidates.length > 1) {
        // A duplicate code is structural and explicitly accepted (§3.10.2
        // rule 7), so this is not an error — but guessing between two
        // aircraft squawking one code would be. Say so and let rung 1 settle
        // it, which is what rung 1 is for.
        resolutions.set(fdr.fdrId, {
          warning: {
            kind: 'AMBIGUOUS_BEACON', candidateTrackIds: candidates,
            detail: `${candidates.length} contacts are squawking ${assigned} — bind one`,
          },
          observedBeacon: null,
        });
        continue;
      }
      const trackId = candidates[0];
      claimed.set(trackId, fdr.fdrId);
      resolutions.set(fdr.fdrId, {
        trackId, matchedBy: 'BEACON', state: 'CORRELATED',
        observedBeacon: this._beaconOf(byId.get(trackId)),
      });
    }

    // Rungs 3 and 4 — the callsign, exact then fuzzy. Both walk the same
    // candidate set; the rung is decided by the affinity that comes back.
    for (const pass of ['exact', 'fuzzy']) {
      for (const fdr of eligible) {
        if (resolutions.has(fdr.fdrId)) continue;
        const resolution = this._matchByCallsign(fdr, { byStem, byId, claimed, exactOnly: pass === 'exact' });
        if (!resolution) continue;
        if (resolution.trackId) claimed.set(resolution.trackId, fdr.fdrId);
        resolutions.set(fdr.fdrId, resolution);
      }
    }

    // Everything eligible and unmatched is uncorrelated, and says why.
    for (const fdr of eligible) {
      if (resolutions.has(fdr.fdrId)) continue;
      resolutions.set(fdr.fdrId, {
        warning: { kind: 'TRACK_LOST', detail: 'no contact matches this flight' },
        observedBeacon: null,
      });
    }

    const { changed } = this._store.reconcile(resolutions, now);
    this._writeObservedBeacons(resolutions);
    const stats = this._accumulate(resolutions, now);

    if (changed.length) this._onDelta({ correlations: changed, stats });
    return { changed, stats };
  }

  _matchByCallsign(fdr, { byStem, byId, claimed, exactOnly }) {
    const callsign = fdr.identity.callsign;
    if (!callsign) return null;
    const stem = callsign.toUpperCase().replace(/[^A-Z]/g, '').replace(/[0-9]/g, '');
    const candidateIds = (byStem.get(stem) || []).filter(id => !claimed.has(id));
    if (candidateIds.length === 0) return null;

    const scored = [];
    for (const id of candidateIds) {
      const affinity = callsignAffinity(callsign, byId.get(id).callsign);
      if (affinity == null) continue;
      if (exactOnly && affinity !== AFFINITY_EXACT) continue;
      if (!exactOnly && affinity === AFFINITY_EXACT) continue; // rung 3 already had its chance
      scored.push({ id, affinity });
    }
    if (scored.length === 0) return null;

    const best = Math.max(...scored.map(s => s.affinity));
    const top = scored.filter(s => s.affinity === best);
    if (top.length > 1) {
      return {
        warning: {
          kind: 'AMBIGUOUS_CALLSIGN', candidateTrackIds: top.map(s => s.id),
          detail: `${top.length} contacts answer to ${callsign} equally well — bind one`,
        },
        observedBeacon: null,
      };
    }

    const trackId = top[0].id;
    const track = byId.get(trackId);
    const observedBeacon = this._beaconOf(track);
    const assigned = fdr.identity.beaconAssigned;
    // An exact callsign match is CORRELATED — unless the contact is squawking
    // something other than the code we assigned it, which is real evidence
    // against the identity even when the name agrees. A fuzzy match is
    // PROVISIONAL regardless: §6.6 rule 1 says "flagged as provisional".
    const contradicted = !!(observedBeacon && assigned && observedBeacon !== assigned);
    const isExact = best === AFFINITY_EXACT;
    return {
      trackId,
      matchedBy: isExact ? 'CALLSIGN_EXACT' : 'CALLSIGN_FUZZY',
      state: isExact && !contradicted ? 'CORRELATED' : 'PROVISIONAL',
      confidence: isExact ? null : best,
      observedBeacon,
    };
  }

  /**
   * Pushes each resolution's observed code onto its FDR — §3.10.2 rule 1's
   * assigned-vs-observed pair, which the panel renders as matching /
   * mismatched / assigned-but-nothing-received. setBeaconObserved writes only
   * on change, so this is a no-op for a steady flight.
   */
  _writeObservedBeacons(resolutions) {
    for (const [fdrId, resolution] of resolutions) {
      this._fdrStore.setBeaconObserved(fdrId, (resolution && resolution.observedBeacon) || null);
    }
  }

  _accumulate(resolutions, now) {
    const records = [...resolutions.keys()].map(id => this._store.getCorrelation(id)).filter(Boolean);
    const rate = computeCorrelationRate(records);

    for (const record of records) {
      if (record.matchedBy && this._matchKeyCounts[record.matchedBy] !== undefined) {
        this._matchKeyCounts[record.matchedBy] += 1;
      }
      const last = record.transitions[record.transitions.length - 1];
      if (!last || last.at !== record.updatedAt) continue;
      if (last.reason === 'REBOUND_ON_BEACON' || last.reason === 'REBOUND_ON_CALLSIGN') this._rebinds += 1;
      if (last.reason === 'TRACK_GONE' || last.reason === 'MISSION_RELOAD' || last.reason === 'AMBIGUOUS') this._warningsRaised += 1;
      if (last.reason === 'WARNING_RETRACTED') this._warningsRetracted += 1;
    }

    if (rate.rate != null) {
      this._matchedTickSum += rate.correlated + rate.provisional;
      this._eligibleTickSum += rate.eligible;
      if (this._minRateSeen == null || rate.rate < this._minRateSeen) this._minRateSeen = rate.rate;
      this._warnIfBelowTarget(rate, now);
    }
    this._lastRate = rate.rate;
    this._lastEligible = rate.eligible;

    return this.getStats();
  }

  _warnIfBelowTarget(rate, now) {
    if (rate.rate >= CORRELATION_RATE_TARGET) return;
    if (rate.eligible < RATE_WARN_MIN_ELIGIBLE) return;
    if (now - this._lastWarnAt < RATE_WARN_INTERVAL_MS) return;
    this._lastWarnAt = now;
    console.warn(`[efsp] correlation rate ${rate.rate.toFixed(2)} (${rate.correlated + rate.provisional}/${rate.eligible} eligible) — below the ${CORRELATION_RATE_TARGET * 100}% target (§6.6 rule 6)`);
  }

  /** Mission reload — every contact in the theater was re-minted. */
  resetPicture(reason = 'MISSION_RELOAD', now = Date.now()) {
    const { changed } = this._store.resetPicture(reason, now);
    this._warningsRaised += changed.length;
    if (changed.length) this._onDelta({ correlations: changed, stats: this.getStats() });
    return { changed };
  }

  /**
   * The §11.5 hook, sized to §6.6 rule 6's "reported and >= 95%" and no
   * larger. In-memory and unpersisted, the same words ADR 0021 used for
   * recordMet: a plug point for WP8's real metric set, not a dashboard.
   */
  getStats() {
    return {
      rate: this._lastRate,
      // Accumulated across ticks, so "at least 95% on a representative
      // session" is measurable over a session rather than at a lucky instant.
      sessionRate: this._eligibleTickSum > 0 ? this._matchedTickSum / this._eligibleTickSum : null,
      eligible: this._lastEligible,
      minRateSeen: this._minRateSeen,
      target: CORRELATION_RATE_TARGET,
      ticks: this._ticks,
      rebinds: this._rebinds,
      warningsRaised: this._warningsRaised,
      warningsRetracted: this._warningsRetracted,
      matchKeyCounts: { ...this._matchKeyCounts },
    };
  }
}

/**
 * The correlation rate, over a set of records.
 *
 * `(correlated + provisional) / eligible` — matching §6.6's own measured
 * quantity, "85-90% of Strips matched a surveillance target", i.e. matched at
 * all rather than matched with certainty.
 *
 * Null when there is nothing eligible, NEVER 1.0. An empty board is not 100%
 * correlated, and reporting it as such would let the >= 95% acceptance gate
 * pass vacuously.
 *
 * Pure, and takes records rather than reading a store, so a test can drive it
 * against a fixture with no clock — the computeDueObligations shape.
 */
function computeCorrelationRate(records) {
  let correlated = 0, provisional = 0, uncorrelated = 0;
  for (const record of records || []) {
    if (record.state === 'CORRELATED') correlated += 1;
    else if (record.state === 'PROVISIONAL') provisional += 1;
    else uncorrelated += 1;
  }
  const eligible = correlated + provisional + uncorrelated;
  return {
    eligible, correlated, provisional, uncorrelated,
    rate: eligible > 0 ? (correlated + provisional) / eligible : null,
  };
}

module.exports = {
  CorrelationReconciler, computeCorrelationRate,
  CORRELATION_TICK_MS, CORRELATION_RATE_TARGET, INELIGIBLE_STATES,
  RATE_WARN_MIN_ELIGIBLE, RATE_WARN_INTERVAL_MS,
};
