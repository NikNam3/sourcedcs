'use strict';

// Composition root for the EFSP subsystem (WP1's "server-side Board store"
// deliverable) — wires flight-data-store, board-store, position-store, code-
// allocator, block-map, facility-config, permission, nla and coordination
// together into the `rules` each Facility's Board (board-store.js) needs, plus
// durable persistence (ADR 0002). app.js/ws-hub.js only ever talk to
// the object this factory returns.
//
// WP4A (docs/adr/0013) — createEfsp() now builds ONE {BoardStore,
// PositionStore, rules} pair PER Facility (facilityConfig.getFacilityIds(),
// currently INCIRLIK, CENTER, TACTICAL, CARRIER and the derived RANGES), rather than exactly one of each. This
// is the D13 mechanism's foundation: "the Strip does not cross the
// Facility boundary" (guide §4.6) is realized as two genuinely separate
// BoardStore instances, each with its own `_strips` Map, so a Strip
// replica in one can never structurally reach the other's (docs/adr/0013). A single FlightDataStore/CodeAllocator/
// MutationLog stay shared across every Facility — a deliberate
// simplification of "one logical flight data, N per-Facility Strip replicas"
// (docs/adr/0013's own text): both Facilities' replicas reference the
// SAME flightDataId, so an edit from either side is instantly visible to the
// other, and the guide's real-world forwarding-obligation timers (§4.6.1)
// become compliance/alerting instrumentation on an always-consistent
// record rather than an actual data-sync protocol we'd otherwise have to
// build. `efsp.boardStoreFor(facilityId)`/`positionStoreFor(...)` are the
// accessors; there is no top-level `boardStore`/`positionStore` (ARCH-D5).

const fs = require('fs');

const { NLA_GUARD_MS } = require('./board/ops/invoke-nla');
const airspaceSchema = require('./airspace-schema');
const { deriveRangePositionIds } = require('./airspace-store');
const { CodeAllocator } = require('./code-allocator');
const { BoardStore } = require('./board-store');
const { MutationLog } = require('./mutation-log');
const { PositionStore } = require('./position-store');
const permission = require('./permission');
const authority = require('./authority');
const { NO_STRIP_OP_CLASSES } = require('./authority/classes');
const { createFacilityConfig } = require('./facility-config');
const { createStereoRoutes } = require('./stereo-routes');
const { createRegimeLocator } = require('./regime-locator');
const { buildFacilityRules } = require('./facility-rules');
const { handleMessage, signOffController, snapshotMessage, filterForSession, supplementFor, readScopeKey, directedFor, heartbeatBoardsAll, heartbeatBoardsFor, heartbeatStores } = require('./efsp-ws');
const { NlaStatusMonitor } = require('./nla-status-monitor');
const { Archiver } = require('./archiver');
const { statePaths, ensureDirFor } = require('../state-paths');
const { WALL_CLOCK } = require('../mission-clock');
const { UndoHistory, undoEnv } = require('./undo/undo-history');
const { ReplayCache } = require('./sync/replay-cache');
const { REGISTRY, RESTORE_ORDER, checkPersistedShape } = require('./stores');
const { SERVICE_ROWS } = require('./authority/airspace');
const { stampStrip, touchedStrips, boardDelta } = require('./wire/frames');
const { resetForMission } = require('./mission-reset');
const log = require('../log').logger('efsp');

/**
 * @param {object} [deps]
 * @param {{now:()=>number, source:string}} [deps.clock] the mission clock
 *   (docs/adr/0079). Every store below takes it, so every time a controller
 *   reads — a gate, a deadline, a Strip clock, a Mutation's `at` — is in-game
 *   Zulu. app.js passes the real one; a fixture that omits it gets the wall
 *   clock, which is what the mission clock itself answers before DCS does.
 * @param {(trackId:string) => ({lat:number, lon:number, altFt:number}|null)} [deps.locateTrack] where a contact is, for the TOFI
 *   regime locator (docs/adr/0102), altitude in indicated feet. A real server passes it; omitting it logs an error at the first
 *   regime question and every flight stays unlocated. A fixture with no tracks passes `() => null`.
 * @param {(payload:object) => void} [deps.onNlaDelta] where the NLA-status sweep's changed-Strips payload goes (app.js hands it to the hub); omitted, the sweep's deltas are dropped
 * @param {(strip:object) => boolean} [deps.airborneEvidence] whether the server itself vouches a Strip's aircraft is airborne (the hint monitor's
 *   AIRBORNE_ADVANCE); omitted, no SetState is ever let past the runway gate (docs/wip/UI-B.md)
 * @param {(controllerId:string) => boolean} [deps.isAbsent] whether a controller's connection is closed but within the sign-on grace (the hub's)
 * @param {() => string|null} [deps.currentTheater] the loaded mission's theater (docs/adr/0098 §2); airspaces are scoped
 *   to it, and with no mission loaded the panel's list is empty. A fixture that omits it has no mission.
 * @param {{read:string, write:string}} [deps.standingPaths] where the theater-keyed standing airspace list is read from
 *   (config/efsp-airspaces.json, a state/ copy replaces it whole). Resolved when createEfsp is called.
 * @param {() => number} [deps.transitionAltFt] the theater's transition altitude
 *   (theater-context.js); the FlightDataStore writes a block's text with it. A fixture
 *   that omits it gets 18,000 ft.
 * @param {{read:string, write:string}} [deps.paths] where the Board snapshot is read from and written to.
 *   Resolved when createEfsp is called, not when this file is required.
 *   Overridable so tests exercise the restore/persist path against a temp
 *   file (CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH) — same pattern as every other config/*.json path in this package.
 *   The Board is durable (docs/adr/0002), and used to be written into the
 *   image's config/ with no volume behind it — so a container recreate lost it,
 *   or worse, restored a snapshot somebody had committed to git. It lives in
 *   data/ now; see src/state-paths.js.
 */
function createEfsp({ env = process.env, facilityConfig = createFacilityConfig({ env }), stereoRoutes = createStereoRoutes({ env }), clock = WALL_CLOCK, wallClock = WALL_CLOCK, nlaGuardMs = NLA_GUARD_MS, transitionAltFt, currentTheater = () => null, locateTrack = null, onNlaDelta = null, airborneEvidence = null, isAbsent = () => false, archiveRetentionMs = undefined,
  paths = statePaths('efsp-board.json', env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, env),
  standingPaths = statePaths('efsp-airspaces.json', env.CRCSYNC_EFSP_AIRSPACES_PATH, env) } = {}) {
  // The Facilities' config and the stereo routes are read when they are built: the composition root builds them and
  // passes them in (docs/adr/0095 §4); a caller that passes neither gets them read now from `env`.
  const permissionRules = permission.createPermission({ classOf: facilityConfig.getPositionClass });
  // The saved snapshot is read ONCE, here, with the same strict shape check the restore uses, and the RANGES Facility's
  // Positions are derived from it (and from the standing list's ids not yet seeded) before any Facility is built: the
  // definitions are data in the registry now, and a Position of RANGES must exist when its PositionStore is made.
  const saved = _readSnapshot(paths);
  const standing = airspaceSchema.loadStandingList({ paths: standingPaths });
  facilityConfig.setRangePositionIds(deriveRangePositionIds(saved && saved.airspaces, standing));
  assertAuthorityCoverage(facilityConfig);
  const nlaGuard = { ms: nlaGuardMs }; // one cell for every Board: the e2e hook changes it at run time (setNlaGuardMs)
  const codeAllocator = new CodeAllocator();
  const mutationLog = new MutationLog(undefined, { clock, env });
  const facilities = new Map(); // facilityId -> { boardStore, positionStore, rules }
  const stores = {};            // registry key -> instance (src/efsp/stores.js)
  // docs/adr/0100: one undo history for the process, every Board reports to it; the wall clock times its 10 s. Its environment is
  // attached once the stores it reads exist; the flight data store reports its writes to it from its constructor.
  const undoHistory = new UndoHistory({ wallClock });
  const onFlightDataWrite = (id, paths) => undoHistory.observe({ kind: 'flightData', id, paths });
  const buildDeps = { onFlightDataWrite, clock, transitionAltFt, currentTheater, codeAllocator, mutationLog, facilities, stores, facilityConfig, stereoRoutes };
  for (const entry of REGISTRY) stores[entry.key] = entry.build(buildDeps);
  const { flightData: flightDataStore, airspaces: airspaceStore, correlations: correlationStore, marsa: marsaStore,
    runwayStatuses: runwayStatusStore, carriers: carrierStore } = stores;
  const regimeLocator = createRegimeLocator({ locateTrack, correlationStore, airspaceStore });
  // Where a flight's correlated contact is (docs/adr/0122's control tick and its obligations): null without a track source,
  // a correlated track, or a position.
  const locateFlight = (flightDataId) => {
    if (!locateTrack || !flightDataId) return null;
    const trackId = correlationStore.correlatedTrackId(flightDataId);
    return trackId ? locateTrack(trackId) : null;
  };
  const facilityIds = facilityConfig.getFacilityIds();
  undoHistory.attach(undoEnv({
    boardFor: (facilityId) => { const f = facilities.get(facilityId); return f ? f.boardStore : null; },
    flightDataStore, carrierStore, marsaStore, correlationStore,
  }));

  for (const facilityId of facilityIds) {
    const positionStore = new PositionStore(facilityConfig.getPositionSet(facilityId), facilityConfig.getHatMaps(facilityId), { clock, frequencies: facilityConfig.getPositionFrequencies(facilityId), isAbsent });

    const rules = buildFacilityRules({ facilityId, facilityConfig, permissionRules, positionStore, facilities, stores: { airspaceStore, marsaStore, runwayStatusStore, carrierStore, correlationStore }, regimeLocator });

    const boardStore = new BoardStore(flightDataStore, rules, { clock, wallClock, undoHistory, nlaGuard, mutationLog, airborneObserver: airborneEvidence, controlInvariantMode: () => (env.CRCSYNC_CONTROL_INVARIANT === 'throw' ? 'throw' : 'repair') });
    facilities.set(facilityId, { boardStore, positionStore, rules });
  }

  _restore({ facilities, stores, saved, paths, mutationLog, clock });
  // The standing list, once per id (ADR 0098 §10): a definition that does not validate stops start-up, naming it.
  if (airspaceStore.seed(standing) > 0) _persist({ wallClock, facilities, stores, persistState: { lastBody: null }, paths });

  // F-408's clock-driven half. Built here rather than in server.js, unlike the
  // obligation monitor and the correlation reconciler, because efsp-ws.js has
  // to tell it what it has already put on the wire (see its note()) — so it
  // has to be reachable from `ctx`. server.js supplies the broadcast and the
  // tick; its delta goes to `onNlaDelta`.
  const nlaStatusMonitor = new NlaStatusMonitor({
    clock,
    boardStoreFor: (facilityId) => {
      const f = facilities.get(facilityId);
      return f ? f.boardStore : null;
    },
    facilityConfig,
    onDelta: onNlaDelta,
  });

  // What _persist last wrote, so an unchanged Board is not written again (docs/adr/0081).
  const persistState = { lastBody: null };

  // H36 (docs/adr/0082) — archives finished flights. server.js wires the
  // traffic count (built outside this factory), the 60 s sweep and F3's
  // mission-session roll-over; the Boards' own snapshots carry what it needs.
  const archiver = new Archiver({
    facilityIds: [...facilities.keys()],
    boardStoreFor: (facilityId) => {
      const f = facilities.get(facilityId);
      return f ? f.boardStore : null;
    },
    flightDataStore, correlationStore, marsaStore, mutationLog, clock,
    retentionMs: archiveRetentionMs, // undefined: ARCHIVE_AFTER_MS (12 h, ADR 0107); only the soak host shortens it
  });

  const ctx = {
    flightDataStore,
    airspaceStore,
    correlationStore,
    marsaStore,
    carrierStore,
    // key -> instance, for every entry of the persisted-store registry (stores.js)
    stores,
    facilityConfig,
    permission: permissionRules, // the class-dependent predicates (permission.js's createPermission), for the wire families
    nlaStatusMonitor,
    runwayStatusStore,
    // The real, Facility-aware accessors WP4A's wire protocol uses.
    boardStoreFor: (facilityId) => {
      const f = _facilityOrThrow(facilities, facilityId);
      return f ? f.boardStore : null;
    },
    positionStoreFor: (facilityId) => {
      const f = _facilityOrThrow(facilities, facilityId);
      return f ? f.positionStore : null;
    },
    // WP7 (docs/adr/0071) — the ATO import dates the ATO against the mission
    // clock (H11/H68) and audits the import itself in the Mutation log.
    clock,
    mutationLog,
    // Idempotency for the airspace, correlation, MARSA and runway-status paths
    // (docs/adr/0081). Memory only: those ops are rev-checked and rarely
    // retried across a restart.
    replayCache: new ReplayCache(),
  };

  return {
    flightDataStore, mutationLog, clock, wallClock, undoHistory, facilityConfig, stereoRoutes,
    /** Tests only (src/test-reset.js): the NLA double-tap guard's length, ms, for every Board. */
    setNlaGuardMs: (ms) => { nlaGuard.ms = ms; },
    airspaceStore, correlationStore, marsaStore, nlaStatusMonitor, runwayStatusStore, carrierStore,
    boardStoreFor: ctx.boardStoreFor, positionStoreFor: ctx.positionStoreFor,

    /**
     * Derives the stable controllerId ws-hub.js should stamp onto a
     * session — the exact fallback chain ws-hub.js already uses for
     * `session.who` (user.name || preferred_username || sub), reused
     * rather than inventing a second identity scheme.
     */
    controllerIdFor(user) {
      return user.name || user.preferred_username || user.sub || 'unknown';
    },

    handleMessage: (session, msg) => handleMessage(ctx, session, msg, () => _persist({ wallClock, facilities, stores, persistState, paths })),

    /** The TOFI regime locator (docs/adr/0102), built from `locateTrack`: the regime monitor asks it too. */
    regimeLocator,

    /**
     * The TOFI regime monitor's write (docs/adr/0102): a system mutation through the MISSION Facility's Board (actor
     * `system`, one audit entry), persisted, with the board-delta every client needs. `facilityId` is the accepting MRU
     * Facility. @returns {{ok:true, message:object}|{ok:false, reason, detail}}
     */
    markTofiEntered: (flightDataId, { facilityId, airspaceId }) => {
      const boardStore = ctx.boardStoreFor(facilityId);
      if (!boardStore) return { ok: false, reason: 'NOT_FOUND', detail: `unknown Facility: ${facilityId}` };
      const result = boardStore.markTofiEntered(flightDataId, { airspaceId });
      if (!result.ok) return result;
      _persist({ wallClock, facilities, stores, persistState, paths });
      const stamped = stampStrip(boardStore, result.strip, facilityId, ctx);
      const touched = boardStore.drainTouched();
      return { ok: true, message: boardDelta(ctx, boardStore, facilityId, touchedStrips(ctx, boardStore, facilityId, touched, stamped), [result.flightData]) };
    },

    /**
     * The control tick (docs/adr/0122, H142): every not-released HANDOFF the receiver has marked checked in, whose aircraft
     * is now inside the receiving Position's airspace (ADR 0125 `isInsideJurisdictionOf`, the correlated track's indicated
     * feet, as the airspace-entry alert), moves control to the receiver: a system write on the transferring Board, mirrored
     * on the receiving one, persisted, with a board-delta for each Facility touched. An aircraft with no correlated track,
     * or a point nobody owns (Class G) or that cannot be judged, waits: control never moves on a null answer.
     * @returns {{moved:number, messages:object[]}}
     */
    settleHandoffControl: () => {
      const touchedFacilities = new Set();
      let moved = 0;
      for (const [facilityId, f] of facilities) {
        for (const c of f.boardStore.boundaryCandidates()) {
          const where = locateFlight(c.strip.flightDataId);
          if (!where || !airspaceStore.isInsideJurisdictionOf(c.receivingPositionId, where)) continue;
          const area = airspaceStore.jurisdictionAt(where);
          const r = f.boardStore.settleAtBoundary(c.strip.stripId, { airspaceId: area ? area.airspaceId : null });
          if (!r.ok) continue;
          moved += 1;
          touchedFacilities.add(facilityId);
          if (r.peerFacilityId) touchedFacilities.add(r.peerFacilityId);
        }
      }
      if (!moved) return { moved, messages: [] };
      _persist({ wallClock, facilities, stores, persistState, paths });
      const messages = [];
      for (const facilityId of touchedFacilities) {
        const boardStore = ctx.boardStoreFor(facilityId);
        const touched = boardStore.drainTouched();
        messages.push(boardDelta(ctx, boardStore, facilityId, touchedStrips(ctx, boardStore, facilityId, touched, null), []));
      }
      return { moved, messages };
    },

    /** Where a flight's correlated contact is, `{lat, lon, altFt}` (indicated feet), or null (docs/adr/0122). */
    locateFlight: (flightDataId) => locateFlight(flightDataId),

    /**
     * Is this HANDOFF Strip's aircraft inside the receiving Position's airspace now (docs/adr/0122, ADR 0125)? Either side's
     * Strip; false with no correlated position or a point nobody owns. The obligation monitor's IN_AIRSPACE_NOT_CHECKED_IN.
     */
    insideReceiverAirspace: (strip) => {
      const co = strip && strip.coordination;
      if (!co) return false;
      const receivingPositionId = co.mintedForCoordination ? strip.ownerPositionId : co.peerPositionId;
      const where = locateFlight(strip.flightDataId);
      return !!where && airspaceStore.isInsideJurisdictionOf(receivingPositionId, where);
    },

    /**
     * The HTTP service path into the airspace registry (docs/adr/0098 §9): the same skeleton pass a panel Mutation takes
     * (persistence, replay cache, delta), with a service principal in place of a signed-on session. `principal` is
     * `{ service: 'SQUADRON_ADMIN', sub, name }`: the web has already checked the user's role. `msg` is
     * `{ clientMutationId, theater, airspaceId, op, baseRev?, baseDefRev? }`. Returns what handleMessage returns,
     * `{ ack, broadcasts }`: the caller sends `broadcasts` to the connected sessions. Not counted as traffic.
     */
    applyAsService: (principal, msg) => {
      const ok = principal && typeof principal.sub === 'string' && principal.sub && typeof principal.name === 'string' && SERVICE_ROWS[principal.service];
      const session = { controllerId: ok ? principal.sub : null, servicePrincipal: ok ? { service: principal.service, sub: principal.sub, name: principal.name } : { service: 'INVALID_PRINCIPAL' } };
      return handleMessage(ctx, session, { ...msg, type: 'efsp-airspace-mutation' }, () => _persist({ wallClock, facilities, stores, persistState, paths }));
    },

    /**
     * Persist on demand. The correlation reconciler deliberately does NOT
     * call this on its own tick (docs/adr/0045): a guaranteed 1Hz atomic
     * whole-snapshot write is exactly the cost _persist's own comment frets
     * about, and the only thing at risk in a crash is a few seconds of
     * correlation history — the state itself recomputes within one tick of
     * boot. This exists so a caller that genuinely needs a flush has one.
     */
    persist: () => _persist({ wallClock, facilities, stores, persistState, paths }),

    /**
     * Abrupt disconnect (guide §4.8.6) — signs the controller off every Position they were signed on at, across EVERY
     * Facility (a controller may be signed on at Positions in more than one, guide §4.8.5), with the effects of an explicit
     * sign-off (efsp-ws.js `staffingChanged`). @returns {{broadcasts: object[], directed: object[]}} for the hub to send.
     */
    onDisconnect: (session) => signOffController(ctx, session.controllerId, () => _persist({ wallClock, facilities, stores, persistState, paths })),


    /** Sent once at connect, appended to ws-hub.js's existing connect-time send order. */
    snapshotFor: (session = null) => snapshotMessage(ctx, session),

    /**
     * The message `session` is to be sent for an EFSP broadcast `msg` (docs/adr/0080):
     * the same object when it reads everything, a filtered copy when it reads only
     * what it owns, null to skip. And a key that changes when a session's scope does.
     */
    filterForSession: (session, msg) => filterForSession(ctx, session, msg),
    supplementFor: (session, filtered) => supplementFor(ctx, session, filtered),
    // docs/adr/0100 §6: an Undo's panel message to the sessions signed on to a voided Position (ws-hub.js sends it).
    directedFor: (session, directed) => directedFor(ctx, session, directed),
    readScopeKey: (session) => readScopeKey(ctx, session),
    /** The efsp-heartbeat's `boards` (docs/adr/0104): `heartbeatBoardsAll()` once per tick, `heartbeatBoardsFor(session, all)` per session. */
    heartbeatBoardsAll: () => heartbeatBoardsAll(ctx),
    heartbeatBoardsFor: (session, all) => heartbeatBoardsFor(ctx, session, all),
    /** The efsp-heartbeat's `stores` (docs/adr/0106), once per tick. */
    heartbeatStores: () => heartbeatStores(ctx),

    archiver,

    /**
     * The mission reset (docs/adr/0108): a real mission roll-over ends every live Strip and resets the per-mission stores. Persisted
     * here; the caller delivers `frames` and runs the archiver's roll-over sweep. @returns {{frames: object[], summary: object}}
     */
    resetForMission: (session = null) => {
      const r = resetForMission(ctx, facilityIds, session);
      _persist({ wallClock, facilities, stores, persistState, paths });
      return r;
    },
  };
}

/**
 * Checks that what came back off disk agrees with itself.
 *
 * Strips, flight data and the allocated-code map are three parts of one snapshot,
 * and nothing ever verified they matched. Two ways they can disagree, both
 * silent: a live Strip whose flight data is missing renders with no callsign and
 * computes its NLA against null; and a live Strip whose beacon code is not
 * marked allocated lets the very next CreateStrip mint that same code for a
 * different aircraft — the identical failure docs/adr/0028 fixed for the
 * shared flight data case, arriving by a different route.
 *
 * The code case is repaired rather than just reported: re-reserving a code
 * that a live flight is already squawking is unambiguously right, and
 * leaving it free is unambiguously dangerous.
 */
function _reconcileRestored(facilities, flightDataStore, correlationStore, marsaStore) {
  const allocator = flightDataStore.codeAllocator;
  // A MARSA relation whose participants' flight data are all gone has nothing left to
  // be about. Dropped rather than reported, on the same split the correlation
  // case below documents: an orphaned relation is invisible either way, and a
  // relation that kept a partial participant list would be a live claim that
  // ATC is not separating an aircraft that no longer exists.
  if (marsaStore) {
    const dropped = marsaStore.evictMissingFlightDataList();
    if (dropped) log.warn('dropped restored MARSA relations whose participants are gone', { dropped });
  }
  // A correlation record whose flight data did not come back has nothing to be about.
  // Dropped rather than reported, unlike the missing flight data Strip case below: a
  // Strip without the flight data still renders and a controller needs to know why,
  // while a correlation without one is invisible either way.
  if (correlationStore) {
    const dropped = correlationStore.evictMissingFlightDataList();
    if (dropped) log.warn('dropped restored correlation records whose flight data is gone', { dropped });
  }
  for (const [facilityId, { boardStore }] of facilities.entries()) {
    for (const strip of boardStore.getAll()) {
      if (strip.state === 'DROPPED') continue;
      const flightData = flightDataStore.getFlightData(strip.flightDataId);
      if (!flightData) {
        log.warn('restored Strip references missing flight data — it will render without flight data', { stripId: strip.stripId, facilityId, flightDataId: strip.flightDataId });
        continue;
      }
      const code = flightData.identity.beaconAssigned;
      if (code && !allocator.isAllocated(code)) {
        log.warn('restored Strip squawks a code the code pool had free — re-reserving it', { stripId: strip.stripId, facilityId, code });
        allocator.reassign(strip.flightDataId, code, null);
      }
    }
  }
}

/**
 * The boot half of "a Mutation survives a crash exactly once" (docs/adr/0081,
 * L6's F5 mode B). The audit line is written inside applyMutation, before
 * _persist; a crash between the two leaves a line for a change the restored
 * Board does not have, and the client's retry then applies it and writes a
 * second line — two lines for one effective change.
 *
 * Every successful Board line written since shortly before the snapshot whose
 * clientMutationId is in no Board's restored replay window was never
 * persisted (every persisted Mutation of the last ten minutes is in that
 * window). Each gets one marker line:
 *   { op: 'NotPersisted', clientMutationId, stripId, voids, reason: 'CRASH_BEFORE_PERSIST', ... }
 * The log stays append-only: nothing is deleted or rewritten, and a reader
 * that pairs a marker with the line it voids (the traffic count; the soak
 * ledger) sees exactly one effective line per change. A line already voided by
 * an earlier boot's marker is not marked again.
 *
 * Wall time (`wallAt`, `persistedWallAt`) because that is what the log's own
 * retention and readSince use; the marker's `at` is mission time like every
 * other entry.
 * @returns {number} markers written
 */
const LOG_TAIL_SLACK_MS = 60 * 1000;
function _reconcileLogTail(facilities, mutationLog, persistedWallAt, clock, airspaceStore = null) {
  if (!mutationLog || !Number.isFinite(persistedWallAt)) return 0;
  const airspaceLines = []; const airspaceMarked = new Set();
  const boards = [...facilities.values()].map(f => f.boardStore);
  const lines = new Map();   // cmid -> [entry] successful Board lines
  const markers = new Map(); // cmid -> count of NotPersisted markers already written
  for (const e of mutationLog.readSince(persistedWallAt - LOG_TAIL_SLACK_MS)) {
    const cmid = e && e.clientMutationId;
    // An airspace line (ADR 0098 §10, 0083): a definition edit audited but never persisted, judged on the revisions it recorded.
    if (airspaceStore && e && e.op !== 'NotPersisted' && e.ok !== false && e.theater && !e.stripId && e.actorId !== 'system' && e.source !== 'wire') {
      if (typeof cmid === 'string' && cmid !== '' && !airspaceStore.hasApplied(e)) {
        airspaceLines.push(e);
      }
      continue;
    }
    if (e && e.op === 'NotPersisted' && e.airspaceId) { airspaceMarked.add(cmid); continue; }
    if (typeof cmid !== 'string' || cmid === '' || !e.stripId) continue;
    if (e.op === 'NotPersisted') { markers.set(cmid, (markers.get(cmid) || 0) + 1); continue; }
    if (e.ok === false || e.source === 'wire' || e.actorId === 'system') continue;
    if (!lines.has(cmid)) lines.set(cmid, []);
    lines.get(cmid).push(e);
  }
  let written = 0;
  for (const e of airspaceLines) {
    if (airspaceMarked.has(e.clientMutationId)) continue;
    mutationLog.record({
      op: 'NotPersisted', clientMutationId: e.clientMutationId, airspaceId: e.airspaceId, theater: e.theater, voids: e.op,
      reason: 'CRASH_BEFORE_PERSIST', actorId: 'system', actingPositionId: null, at: clock.now(),
    });
    written += 1;
  }
  for (const [cmid, entries] of lines) {
    if (boards.some(b => b.hasApplied(cmid))) continue;
    const unmarked = entries.slice(markers.get(cmid) || 0);
    for (const e of unmarked) {
      mutationLog.record({
        op: 'NotPersisted', clientMutationId: cmid, stripId: e.stripId, voids: e.op,
        reason: 'CRASH_BEFORE_PERSIST', actorId: 'system', actingPositionId: null, at: clock.now(),
      });
      written += 1;
    }
  }
  if (written) log.warn('audited Mutations never reached the Board snapshot (a crash before persist) — marked NotPersisted', { written });
  return written;
}

/**
 * Every Position a Facility configures (but a using agency, which does no Strip op) must have a registered
 * Position family in authority/, or its permissions are silently empty. A start-up error (ARCH-D5; was AUTH's
 * authority-coverage test).
 * @param {{getFacilityIds: () => string[], getPositionSet: (f:string) => string[], getPositionClass: (p:string) => string}} config
 */
function assertAuthorityCoverage(config) {
  const uncovered = [];
  for (const facilityId of config.getFacilityIds()) {
    for (const positionId of config.getPositionSet(facilityId)) {
      if (NO_STRIP_OP_CLASSES.has(config.getPositionClass(positionId))) continue;
      if (!authority.positionFamilyOf(positionId)) uncovered.push(`${facilityId}/${positionId}`);
    }
  }
  if (uncovered.length) throw new Error(`[efsp] Position(s) configured with no Position family in authority/: ${uncovered.join(', ')}`);
}

// boardStoreFor/positionStoreFor take a Facility id and nothing defaults it (ARCH-D5): calling one without is a
// bug in the caller. An id that is a string but names no Facility still answers null, as it always did.
function _facilityOrThrow(facilities, facilityId) {
  if (typeof facilityId !== 'string') throw new Error('boardStoreFor/positionStoreFor need a facilityId');
  return facilities.get(facilityId);
}

/**
 * Reads and checks the saved snapshot, once (createEfsp calls it before the Facilities exist, and hands the result to
 * _restore). No file is a first run (null). A file that is there and cannot be read, parsed or shape-checked is a startup
 * error (ARCH-D5, H88): an unknown persisted shape is never quietly dropped for an empty Board (docs/wip/BACKCOMPAT.md),
 * and the file is left untouched.
 */
function _readSnapshot(paths) {
  let raw;
  try {
    raw = fs.readFileSync(paths.read, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`[efsp] cannot read the Board snapshot ${paths.read}: ${e.message}`);
    // paths.read can be the shipped config/ fallback; the Board is written to paths.write, so that is the path to show.
    const fields = { willWriteTo: paths.write };
    if (paths.read !== paths.write) fields.alsoLookedAt = paths.read;
    log.warn('no prior Board snapshot to restore (first run); the Board will be saved to the willWriteTo path', fields);
    return null;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`[efsp] the Board snapshot ${paths.read} is not valid JSON: ${e.message}`);
  }
  // Every key the build knows, before any store restores (H88 item 8): an older build's names stop start-up here.
  // The pre-WP4A shape (a top-level `board`) keeps its own, more specific refusal in stores.js's `boards` entry.
  if (!(data && data.board !== undefined && data.boards === undefined)) checkPersistedShape(data, paths.read);
  return data;
}

function _restore({ facilities, stores, saved: data, mutationLog, clock }) {
  if (!data) return;
  const all = { facilities, stores, saved: data };
  const byKey = new Map(REGISTRY.map(e => [e.key, e]));
  // RESTORE_ORDER, not the registry's (write) order: see stores.js.
  for (const key of RESTORE_ORDER) {
    const store = stores[key];
    if (store) byKey.get(key).restore(store, key === 'boards' ? data.boards : data[key], all);
  }
  // After the Boards, not before — it has Strips to check against only now.
  _reconcileRestored(facilities, stores.flightData, stores.correlations, stores.marsa);
  // docs/adr/0101: a snapshot whose HANDOFF record names a retired holder is repaired (InterfacilityControlRepair). Liveness
  // only: nobody has signed on yet at a restart, so no owner is staffed and staffing is not judged here.
  for (const { boardStore } of facilities.values()) boardStore.reconcileExchanges({ staffing: false });
  // A Mutation audited but never persisted (a crash inside _persist) gets a
  // NotPersisted marker, so the log says that line never took effect.
  _reconcileLogTail(facilities, mutationLog, data.persistedWallAt, clock, stores.airspaces);
}

function _persist({ wallClock, facilities, stores, persistState = { lastBody: null }, paths }) {
  try {
    // Compact, not pretty-printed: this runs after EVERY successful Mutation,
    // and indenting a snapshot that grows with the session was the largest
    // single cost in the soak (40% of self-time at four hours, L24's
    // profile). A human reading the file pipes it through a formatter.
    const snap = {};
    for (const entry of REGISTRY) snap[entry.key] = entry.snapshot(stores[entry.key], { facilities, stores });
    const body = JSON.stringify(snap);
    // Dirty-only: nothing changed since the last successful write (a caller
    // that persists on a path which changed nothing), so there is nothing to
    // make durable. Compared on the body, so `persistedWallAt` below stays the
    // time of the write that produced what is on disk — which is what the boot
    // reconcile reads the log tail from. Every Mutation that did change the
    // Board is still written before its ack leaves (docs/adr/0081, F5): a
    // deferred or batched write would let an acked change die with the process.
    if (body === persistState.lastBody) return;
    // Wall time of this write: the boot reconcile reads the log tail from
    // here to find Mutations audited but never persisted (docs/adr/0081).
    const payload = `{"persistedWallAt":${wallClock.now()},${body.slice(1)}`;
    // Written to a sibling and renamed, because rename is atomic on POSIX
    // and a plain write is not. This runs after EVERY successful Mutation,
    // so the process spends a meaningful fraction of a busy session inside
    // this call — a crash or a power loss partway through would leave a
    // truncated file, which JSON.parse then rejects wholesale on restart,
    // and _restore's catch would come up with an empty Board. Losing one
    // Mutation to a crash is unavoidable; losing the entire session's Board
    // to one is not.
    const tmpPath = `${paths.write}.tmp`;
    // Same directory as the target, so the rename below stays within one
    // filesystem — across a mount boundary it is not atomic, and the whole
    // point of the sibling-then-rename is that it is.
    ensureDirFor(paths.write);
    fs.writeFileSync(tmpPath, payload);
    fs.renameSync(tmpPath, paths.write);
    persistState.lastBody = body;
  } catch (e) {
    log.warn('failed to persist Board snapshot', { error: e.message });
  }
}

module.exports = { createEfsp, assertAuthorityCoverage };
