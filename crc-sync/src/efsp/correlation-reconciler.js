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

const { buildTrackIndices } = require('./correlation-match');
const { isSynthetic } = require('./code-allocator');
const { WALL_CLOCK } = require('../mission-clock');
const log = require('../log').logger('efsp:correlation-reconciler');

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
// An exclusion list, per docs/adr/0041's lesson: a state that is not listed counts in the
// denominator. A test (efsp-correlation-reconciler.test.mjs) pins the COMPLETE classification:
// its explicit ELIGIBLE set plus this one must equal the union of nla.js's
// STATES_BY_STRIP_TYPE, so a new state fails there until it is put on one side or the other.
const INELIGIBLE_STATES = new Set([
  // Pre-movement: the aircraft may not even be spawned.
  'PROPOSED', 'PENDING_CLEARANCE', 'CLEARED', 'HELD',
  // An ATO line exists before the jet does.
  'TASKED',
  'DROPPED',
  // The carrier strip types (docs/adr/0074) are pinned one by one in
  // tests/efsp-carrier-strip-types.test.mjs. Every MARSHAL/FINAL/PATTERN state is
  // ELIGIBLE, LAUNCH included: correlation matches the flight data against the track
  // store (binding, beacon), not against what a ship radar has
  // illuminated, so `noGroundAircraft` on the ship radars does not hide a jet
  // on deck, and a launch Strip is the carrier's PUSHBACK ("an aircraft on the
  // ramp is a DCS unit").
]);

class CorrelationReconciler {
  /**
   * @param {object} deps
   * @param {object} deps.trackStore
   * @param {object} deps.flightDataStore
   * @param {object} deps.correlationStore
   * @param {(facilityId:string)=>object|null} deps.boardStoreFor
   * @param {object} deps.facilityConfig
   * @param {(track:object)=>string|null} deps.beaconOf — the Mode 3/A code the
   *   aircraft's transponder is sending, or null (Transponders#transponderOf).
   * @param {(code:string)=>boolean} [deps.isSyntheticCode] — is this code in the
   *   block crc-sync mints for AI transponders (code-allocator.js isSynthetic)?
   * @param {(payload:object)=>void} [deps.onDelta] — called ONCE per tick with
   *   the records that changed plus the stats, or not at all on a quiet tick.
   */
  constructor({ trackStore, flightDataStore, correlationStore, boardStoreFor, facilityConfig, beaconOf, isSyntheticCode = isSynthetic, onDelta, clock = WALL_CLOCK, wallClock = WALL_CLOCK }) {
    // The mission clock (docs/adr/0079) — what the correlation records are
    // stamped with. The below-target warning's rate limit is a log throttle
    // and stays on the wall clock (_warnIfBelowTarget).
    this._clock = clock;
    this._wallClock = wallClock;
    if (typeof beaconOf !== 'function') throw new Error('CorrelationReconciler needs beaconOf');
    this._beaconOf = beaconOf;
    this._isSynthetic = isSyntheticCode;
    this._trackStore = trackStore;
    this._flightDataStore = flightDataStore;
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
    this._matchKeyCounts = { BINDING: 0, BEACON: 0 };
    this._lastRate = null;
    this._lastEligible = 0;
    this._lastWarnAt = 0;

    // flightDataId -> { code, trackId }: the AI aircraft a flight's SYNTHETIC
    // code was last seen on (docs/adr/0142). crc-sync mints a synthetic code
    // for the life of one AI unit and gives it back to the block when the unit
    // leaves (surveillance/transponder.js), so the same code can later be
    // minted to a DIFFERENT AI aircraft. A Strip that carries the code must not
    // follow it there by itself: that aircraft is not the one the controller
    // read the code off. The beacon rung refuses a synthetic-code contact other
    // than the remembered one and says so (warning CODE_REISSUED); the
    // controller binds it, or enters the new aircraft's code. A discrete code a
    // player squawks has no such rule: FAA automation acquires whichever target
    // squawks an active flight's code (H135, JO 7110.65BB ¶5-3-4 a).
    //
    // In memory only. A restart or a mission reload forgets it, and the next
    // match is a first match.
    this._syntheticSeenOn = new Map();
  }

  /** Every live Strip across every Facility, so eligibility can be judged per flight data. */
  _liveStripsByFlightData() {
    const byFlightData = new Map(); // flightDataId -> [strip]
    for (const facilityId of this._facilityConfig.getFacilityIds()) {
      const boardStore = this._boardStoreFor(facilityId);
      if (!boardStore) continue;
      for (const strip of boardStore.getAll()) {
        if (strip.state === 'DROPPED') continue;
        const list = byFlightData.get(strip.flightDataId);
        if (list) list.push(strip); else byFlightData.set(strip.flightDataId, [strip]);
      }
    }
    return byFlightData;
  }

  /**
   * The flight data is eligible when at least one of its live Strips is in a state
   * where an aircraft could be out there. One Strip is enough: a DEPARTURE
   * Strip parked at PROPOSED and a MISSION Strip AIRBORNE on the same flight data
   * means there is an aircraft.
   */
  static isEligible(strips) {
    return (strips || []).some(s => !INELIGIBLE_STATES.has(s.state));
  }

  /**
   * One ordered claim sweep over every eligible flight data.
   *
   * Rung order, claiming as it goes (§6.6 rule 1 as docs/adr/0142 cut it): an
   * explicit binding, then the assigned beacon code. Nothing else: no callsign
   * rung (H165). A binding always claims a contact before the beacon rung can,
   * which gives the priority order for free and makes a collision decidable.
   * Two CONTACTS squawking one flight's code is ambiguous: the flight gets
   * neither and is told so, with the candidates (docs/adr/0046). Two FLIGHT DATA claiming one contact
   * at the SAME rung (a duplicate code) is not: the first in sweep order takes
   * it, and the other's TRACK_LOST detail names the flight that has it
   * (LT-CORRELATION). One contact never correlates to two flight data.
   */
  tick(now = this._clock.now()) {
    this._ticks += 1;

    const tracks = this._trackStore.getAll();
    const { byBeacon, byId } = buildTrackIndices(tracks, this._beaconOf);
    const stripsByFlightData = this._liveStripsByFlightData();

    // A flight with no live Strip anywhere is over, and its record goes with
    // it. Note the distinction from eligibility: a Strip sitting at PROPOSED is
    // live but ineligible — it has no contact YET — and must not be retired.
    this._store.retireFinished(new Set(stripsByFlightData.keys()));
    for (const flightDataId of [...this._syntheticSeenOn.keys()]) {
      if (!stripsByFlightData.has(flightDataId)) this._syntheticSeenOn.delete(flightDataId);
    }

    const eligible = [];
    for (const flightData of this._flightDataStore.getAll()) {
      const strips = stripsByFlightData.get(flightData.flightDataId);
      if (!strips || !CorrelationReconciler.isEligible(strips)) continue;
      eligible.push(flightData);
    }

    const claimed = new Map(); // trackId -> flightDataId
    const resolutions = new Map(); // flightDataId -> resolution | null

    // Rung 1 — an explicit controller binding. It outranks everything the
    // sweep can work out, which is the point of having it: an aircraft with
    // its transponder off is still a contact the controller can see.
    for (const flightData of eligible) {
      const record = this._store.getCorrelation(flightData.flightDataId);
      const bound = record && record.binding && record.binding.trackId;
      if (!bound) continue;
      const track = byId.get(String(bound));
      if (!track) continue; // the contact is gone — later rungs get a chance
      claimed.set(String(bound), flightData.flightDataId);
      resolutions.set(flightData.flightDataId, {
        trackId: String(bound), matchedBy: 'BINDING', state: 'CORRELATED',
        observedBeacon: this._beaconOf(track),
      });
    }

    // Rung 2 — the assigned Mode 3/A code, observed on a contact. A finished
    // flight holds no code and keeps no contact from the flight now assigned
    // the code it squawks (H135). A synthetic code does not follow a re-mint
    // to another AI aircraft (docs/adr/0142; see the constructor).
    const callsignOf = new Map(eligible.map(f => [f.flightDataId, f.identity.callsign]));
    const beaconTakenBy = new Map(); // flightDataId -> the flight that holds the contact squawking its code
    for (const flightData of eligible) {
      if (resolutions.has(flightData.flightDataId)) continue;
      const assigned = flightData.identity.beaconAssigned;
      if (!assigned) continue;
      const squawking = byBeacon.get(assigned) || [];
      const candidates = squawking.filter(id => !claimed.has(id));
      if (candidates.length === 0) {
        // The contact squawking this code already went to another flight
        // (an explicit binding, or a duplicate code assigned earlier, §3.10.2
        // rule 7). The NO TRK says which flight has it rather than "no contact".
        if (squawking.length === 1) beaconTakenBy.set(flightData.flightDataId, { code: assigned, holder: claimed.get(squawking[0]) });
        continue;
      }
      if (candidates.length > 1) {
        // A duplicate code is structural and explicitly accepted (§3.10.2
        // rule 7), so this is not an error — but guessing between two
        // aircraft squawking one code would be. Say so and let rung 1 settle
        // it, which is what rung 1 is for.
        resolutions.set(flightData.flightDataId, {
          warning: {
            kind: 'AMBIGUOUS_BEACON', candidateTrackIds: candidates,
            detail: `${candidates.length} contacts are squawking ${assigned} — bind one`,
          },
          observedBeacon: null,
        });
        continue;
      }
      const trackId = candidates[0];
      const seen = this._syntheticSeenOn.get(flightData.flightDataId);
      if (seen && seen.code === assigned && seen.trackId !== trackId) {
        // The code went back to the block with the aircraft it was read off,
        // and crc-sync has minted it to another AI aircraft. Not this flight's
        // contact until a controller says so.
        resolutions.set(flightData.flightDataId, {
          warning: {
            kind: 'CODE_REISSUED', candidateTrackIds: [trackId],
            detail: `${assigned} is now squawked by a different AI aircraft — bind it, or enter its code`,
          },
          observedBeacon: null,
        });
        continue;
      }
      claimed.set(trackId, flightData.flightDataId);
      resolutions.set(flightData.flightDataId, {
        trackId, matchedBy: 'BEACON', state: 'CORRELATED',
        observedBeacon: this._beaconOf(byId.get(trackId)),
      });
    }

    // Everything eligible and unmatched is uncorrelated, and says why.
    for (const flightData of eligible) {
      if (resolutions.has(flightData.flightDataId)) continue;
      const taken = beaconTakenBy.get(flightData.flightDataId);
      const detail = taken
        ? `the contact squawking ${taken.code} is correlated to ${callsignOf.get(taken.holder) || 'another flight'}`
        : 'no contact matches this flight';
      resolutions.set(flightData.flightDataId, {
        warning: { kind: 'TRACK_LOST', detail },
        observedBeacon: null,
      });
    }

    this._rememberSyntheticContacts(eligible, resolutions);

    const { changed } = this._store.reconcile(resolutions, now);
    this._writeObservedBeacons(resolutions);
    const stats = this._accumulate(resolutions);

    if (changed.length) this._onDelta({ correlations: changed, stats });
    return { changed, stats };
  }

  /**
   * Remembers which contact each flight's synthetic code is on, from this
   * tick's matches: a beacon match, or a binding to the contact squawking the
   * code (so a controller who binds the new holder moves the memory with it).
   * A flight whose code is not synthetic, or no longer the remembered one,
   * forgets.
   */
  _rememberSyntheticContacts(eligible, resolutions) {
    for (const flightData of eligible) {
      const assigned = flightData.identity.beaconAssigned;
      const id = flightData.flightDataId;
      if (!assigned || !this._isSynthetic(assigned)) { this._syntheticSeenOn.delete(id); continue; }
      const seen = this._syntheticSeenOn.get(id);
      if (seen && seen.code !== assigned) this._syntheticSeenOn.delete(id);
      const r = resolutions.get(id);
      if (r && r.trackId && r.observedBeacon === assigned) this._syntheticSeenOn.set(id, { code: assigned, trackId: r.trackId });
    }
  }

  /**
   * Pushes each resolution's observed code onto its flight data — §3.10.2 rule 1's
   * assigned-vs-observed pair, which the panel renders as matching /
   * mismatched / assigned-but-nothing-received. setBeaconObserved writes only
   * on change, so this is a no-op for a steady flight.
   */
  _writeObservedBeacons(resolutions) {
    for (const [flightDataId, resolution] of resolutions) {
      this._flightDataStore.setBeaconObserved(flightDataId, (resolution && resolution.observedBeacon) || null);
    }
  }

  _accumulate(resolutions) {
    const records = [...resolutions.keys()].map(id => this._store.getCorrelation(id)).filter(Boolean);
    const rate = computeCorrelationRate(records);

    for (const record of records) {
      if (record.matchedBy && this._matchKeyCounts[record.matchedBy] !== undefined) {
        this._matchKeyCounts[record.matchedBy] += 1;
      }
      const last = record.transitions[record.transitions.length - 1];
      if (!last || last.at !== record.updatedAt) continue;
      if (last.reason === 'REBOUND_ON_BEACON') this._rebinds += 1;
      if (last.reason === 'TRACK_GONE' || last.reason === 'MISSION_RELOAD' || last.reason === 'AMBIGUOUS') this._warningsRaised += 1;
      if (last.reason === 'WARNING_RETRACTED') this._warningsRetracted += 1;
    }

    if (rate.rate != null) {
      this._matchedTickSum += rate.correlated;
      this._eligibleTickSum += rate.eligible;
      if (this._minRateSeen == null || rate.rate < this._minRateSeen) this._minRateSeen = rate.rate;
      this._warnIfBelowTarget(rate, this._wallClock.now());
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
    log.warn('correlation rate below the target (§6.6 rule 6)', { rate: Number(rate.rate.toFixed(2)), correlated: rate.correlated, eligible: rate.eligible, targetPct: CORRELATION_RATE_TARGET * 100 });
  }

  /** Mission reload — every contact in the theater was re-minted. */
  resetPicture(reason = 'MISSION_RELOAD', now = this._clock.now()) {
    this._syntheticSeenOn.clear(); // every contact was re-minted; no remembered id means anything
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
 * The correlation rate, over a set of records: `correlated / eligible`,
 * matching §6.6's own measured quantity, "85-90% of Strips matched a
 * surveillance target".
 *
 * Null when there is nothing eligible, NEVER 1.0. An empty board is not 100%
 * correlated, and reporting it as such would let the >= 95% acceptance gate
 * pass vacuously.
 *
 * Pure, and takes records rather than reading a store, so a test can drive it
 * against a fixture with no clock — the computeDueObligations shape.
 */
function computeCorrelationRate(records) {
  let correlated = 0, uncorrelated = 0;
  for (const record of records || []) {
    if (record.state === 'CORRELATED') correlated += 1;
    else uncorrelated += 1;
  }
  const eligible = correlated + uncorrelated;
  return {
    eligible, correlated, uncorrelated,
    rate: eligible > 0 ? correlated / eligible : null,
  };
}

module.exports = {
  CorrelationReconciler, computeCorrelationRate,
  CORRELATION_TICK_MS, INELIGIBLE_STATES,
};
