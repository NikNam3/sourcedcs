'use strict';

// Every monitor createApp runs, built in one place and handed back by name: forwarding obligations, the Strip<->track
// correlation reconciler, EFSP instrumentation, surveillance hints, conformance, short-term conflict alert, the TOFI
// regime monitor and the carrier tick, plus the one function that composes efsp-alerts from them.
// They produce state and server-originated frames; every frame leaves through `hubLink` (late-binding.js), because the hub
// is built after them: it takes the alert composer's `recheck` as its `onEfspChange`.

const { ForwardingObligationMonitor } = require('../efsp/forwarding-obligations');
const { CorrelationReconciler } = require('../efsp/correlation-reconciler');
const { SurveillanceHintMonitor } = require('../efsp/surveillance-hints');
const { getHintsConfig } = require('../efsp/surveillance-hints-config');
const { ConformanceMonitor } = require('../efsp/conformance');
const { TofiRegimeMonitor } = require('../efsp/tofi-regime-monitor');
const { ConflictAlertMonitor } = require('../conflict-alert');
const { loadAlertingConfig } = require('../alerting-config');
const { indicatedAltFt } = require('../altimetry');
const { WALL_CLOCK } = require('../mission-clock');
const { createEfspInstrumentation } = require('../efsp/metrics');
const { CarrierTick } = require('../efsp/carrier-tick');
const { createShipWind } = require('./ship-wind');
const { carrierDelta, correlationDelta } = require('../efsp/wire/frames');
const { ParMonitor } = require('../surveillance/par-monitor');
const { loadParTuning } = require('../surveillance/par-tuning');

const FT_PER_M = 3.28084;

/**
 * @param {object} deps
 * @param {object} deps.env
 * @param {object} deps.efsp the facade
 * @param {object} deps.facilityConfig
 * @param {object} deps.missionClock
 * @param {object} deps.missionSession
 * @param {object} deps.trackStore
 * @param {object} deps.surveillance `{ transponders, identity }`
 * @param {object} deps.theaterContext
 * @param {object} deps.grpcClient
 * @param {number} deps.ownCoalition
 * @param {{get: () => object}} deps.hubLink
 * @param {{beacon?:Function, callsign?:Function, gridToMagnetic?:Function}} [deps.trackSeams]
 * @param {object|null} [deps.surveillanceHints] undefined builds the SurveillanceHintMonitor; null leaves it out (the soak)
 */
function buildMonitors({ env, efsp, facilityConfig, missionClock, missionSession, trackStore, surveillance, theaterContext, grpcClient, ownCoalition, hubLink, trackSeams = {}, surveillanceHints: hintsDep }) {
  const { transponders, identity } = surveillance;
  const deliver = (frames) => hubLink.get().deliverEfsp(frames);

  // ── WP4A forwarding obligations (guide §4.6.1, docs/adr/0021, 0067) — the set due right now, sent as state in
  // efsp-alerts (broadcastEfspAlerts below). Re-evaluated on a 15s sweep for the clock (comfortably fine-grained for
  // minute-scale obligations) and right after any EFSP delivery (the hub's onEfspChange), so a controller's fix clears its
  // badge at once. ────────────────────────────────────────────────────────
  const obligationMonitor = new ForwardingObligationMonitor({
    clock: missionClock,
    boardStoreFor: efsp.boardStoreFor,
    flightDataStore: efsp.flightDataStore,
    facilityConfig,
    airspaceStore: efsp.airspaceStore,
  });

  // ── WP5 Strip<->track correlation (guide §6.6, docs/adr/0045/0046) ───────
  // Its own cadence again, and a much faster one: this is what keeps each Strip's bound contact fresh, and §6.6 rule 4's
  // benchmark is one second. The store lives inside createEfsp() (it needs the MutationLog and the atomic snapshot); the
  // reconciler lives out here, because only createApp has the TrackStore.
  const correlationReconciler = new CorrelationReconciler({
    clock: missionClock,
    wallClock: WALL_CLOCK,
    trackStore,
    // The code the aircraft is actually sending (docs/adr/0059).
    beaconOf: trackSeams.beacon || ((t) => { const x = transponders.transponderOf(t); return x ? x.code : null; }),
    flightDataStore: efsp.flightDataStore,
    correlationStore: efsp.correlationStore,
    boardStoreFor: efsp.boardStoreFor,
    facilityConfig,
    onDelta: (payload) => deliver(correlationDelta(efsp.correlationStore, payload.correlations || [], payload.stats)),
  });

  // ── WP8 instrumentation (docs/adr/0065) — the §11.5 metric set, the §11.4 traffic count and Mutation-log retention. It
  // wraps efsp.handleMessage/onDisconnect (ws-hub.js looks them up per message, and no socket connects before server.listen).
  const efspInstrumentation = createEfspInstrumentation({
    env,
    efsp,
    facilityConfig,
    clock: missionClock,
    correlationStats: () => correlationReconciler.getStats(),
    obligationStats: () => obligationMonitor.getComplianceStats(),
    // A metrics session is one mission to the next (H32): F3's mission session.
    missionSession,
  });

  // ── Conformance and short-term conflict alerting (docs/adr/0058) ─────────
  // Server-side, because only this process sees every track: a client only receives the ones inside its own coverage. Once
  // a second, the same rhythm as correlation (whose records conformance reads). Only what is WRONG is ever sent; the whole
  // alert state goes out when it changes.
  const alertingConfig = loadAlertingConfig();
  const conformanceMonitor = new ConformanceMonitor({
    clock: missionClock,
    wallClock: WALL_CLOCK,
    trackStore,
    flightDataStore: efsp.flightDataStore,
    correlationStore: efsp.correlationStore,
    weather: () => grpcClient.getWeather(),
    transitionAltFt: () => theaterContext.transitionAltFt(),
    indicatedAltFt,
    // DCS's course is grid; the typed HDG is magnetic (docs/adr/0085).
    gridToMagnetic: trackSeams.gridToMagnetic || ((deg, lat, lon) => theaterContext.gridToMagnetic(deg, lat, lon)),
    config: alertingConfig.conformance,
  });
  // docs/adr/0076 — "detected airborne" and staleness. It reads the Boards and the correlation records and writes nothing:
  // surveillance informs, the controller advances (§10.3).
  const surveillanceHints = hintsDep === null ? null : (hintsDep || new SurveillanceHintMonitor({
    clock: missionClock,
    wallClock: WALL_CLOCK,
    trackStore,
    correlationStore: efsp.correlationStore,
    boardStoreFor: efsp.boardStoreFor,
    facilityConfig,
    getMissionData: () => hubLink.get().getMissionData(),
    config: getHintsConfig(),
    onStaleness: (e) => efspInstrumentation.metrics.recordStaleness(e),
  }));
  if (surveillanceHints) efspInstrumentation.metrics.declareSource('staleness');
  const conflictAlertMonitor = new ConflictAlertMonitor({
    trackStore,
    config: alertingConfig.conflictAlert,
    flightDataForTrack: (trackId) => efsp.correlationStore.flightDataForTrack(trackId),
    activeMarsaFor: (flightDataId) => efsp.marsaStore.activeFor(flightDataId),
    // Alert text names each aircraft the way identity does (docs/adr/0059).
    callsignFor: trackSeams.callsign || ((track) => identity.labelFor(track.id)),
  });
  // ── The TOFI separation regime (docs/adr/0102) ────────────────────────────
  // Where a correlated flight is, relative to the airspaces ACTIVE for an MRU Facility: one answer for ACCEPT, MARK_ENTERED and
  // the monitor (`efsp.regimeLocator`, built inside createEfsp from the `locateTrack` it was given). No correlated contact is
  // `located: false`, which is unknown, never outside.
  const tofiRegimeMonitor = new TofiRegimeMonitor({
    clock: missionClock,
    wallClock: WALL_CLOCK,
    flightDataStore: efsp.flightDataStore,
    locate: efsp.regimeLocator,
    activeMarsaFor: (flightDataId) => efsp.marsaStore.activeFor(flightDataId),
    enter: (flightDataId, info) => efsp.markTofiEntered(flightDataId, info),
    onEntered: (message) => deliver(message),
    config: alertingConfig.tofiRegime,
  });

  // ── The carrier's ship banner (docs/adr/0074, ADR 0064 B6) — matched to the live ship track once a second, republished only
  // when it changed enough to matter. Own coalition, grid convergence and magnetic variation are injected: the model owns none
  // of them (decisions H15, H42).
  const shipWind = createShipWind({ grpcClient });
  const carrierTick = new CarrierTick({
    carrierStore: efsp.carrierStore,
    tracks: () => trackStore.getAll(),
    ownCoalition: () => ownCoalition,
    clock: missionClock,
    convergenceAt: (lat, lon) => theaterContext.convergenceAt(lat, lon),
    variationAt: (lat, lon) => theaterContext.variationAt(lat, lon),
    weatherPa: () => { const w = grpcClient.getWeather(); return w && Number.isFinite(w.pressurePa) ? w.pressurePa : null; },
    windAt: (lat, lon) => shipWind.get(lat, lon),
    onChange: () => deliver(carrierDelta(efsp.carrierStore)),
  });

  // ── The PAR sample (docs/adr/0112): each aircraft on a final, measured against its approach, for the Position working it.
  // The hub sends it (`sendParSamples`, the `par` ticker); the airfield elevation is DCS's, for an approach whose TDZE the
  // config leaves to DCS. ──────────────────────────────────────────────────
  const parMonitor = new ParMonitor({
    facilityConfig,
    boardStoreFor: (facilityId) => { try { return efsp.boardStoreFor(facilityId); } catch { return null; } },
    flightDataOf: (id) => efsp.flightDataStore.getFlightData(id),
    correlatedTrackId: (id) => efsp.correlationStore.correlatedTrackId(id),
    runwayViewOf: (facilityId) => efsp.runwayStatusStore.statusView(facilityId),
    trackOf: (id) => trackStore.get(id),
    tracks: () => trackStore.getAll(),
    carrierStore: efsp.carrierStore,
    ownCoalition: () => ownCoalition,
    convergenceAt: (lat, lon) => theaterContext.convergenceAt(lat, lon),
    variationAt: (lat, lon) => theaterContext.variationAt(lat, lon),
    airportElevationFt: (icao) => {
      const data = hubLink.get().getMissionData();
      const apt = data && (data.airports || []).find(a => a.icao === icao);
      return apt && Number.isFinite(apt.elev) ? apt.elev * FT_PER_M : null;
    },
    wallClock: WALL_CLOCK,
    tuning: loadParTuning(),
  });

  // The one place efsp-alerts is composed (docs/adr/0067). broadcastEfspAlerts replaces the whole alert state, so every
  // producer — the 1s conformance/CA tick, the 15s obligation sweep, the post-delivery hook — must send all slices, or it would
  // erase the others'.
  function broadcastEfspAlerts() {
    hubLink.get().broadcastEfspAlerts({
      conformance: conformanceMonitor.getAll(),
      tofiRegime: tofiRegimeMonitor.getAll(),
      conflictAlert: conflictAlertMonitor.getAll(),
      obligations: obligationMonitor.getAll(),
      surveillance: surveillanceHints ? surveillanceHints.getAll() : undefined, // docs/adr/0076: the suggestion chip and staleness
    });
  }
  /** The hub's `onEfspChange`: obligations re-evaluated at once after an EFSP delivery, alerts sent when they moved. */
  function recheckObligations() { if (obligationMonitor.tick()) broadcastEfspAlerts(); }

  return {
    obligationMonitor, correlationReconciler, efspInstrumentation, conformanceMonitor, surveillanceHints, conflictAlertMonitor,
    tofiRegimeMonitor, carrierTick, parMonitor, broadcastEfspAlerts, recheckObligations,
  };
}

module.exports = { buildMonitors };
