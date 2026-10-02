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

const carrierModel = require('./carrier');
const sfaModel = require('./sfa');
const airspaceSchema = require('./airspace-schema');
const { deriveRangePositionIds } = require('./airspace-store');
const { CodeAllocator } = require('./code-allocator');
const { BoardStore } = require('./board-store');
const { MutationLog } = require('./mutation-log');
const { PositionStore } = require('./position-store');
const permission = require('./permission');
const authority = require('./authority');
const { NO_STRIP_OP_CLASSES } = require('./authority/classes');
const nla = require('./nla');
const blockMap = require('./block-map');
const facilityConfig = require('./facility-config');
const coordination = require('./coordination');
const { handleMessage, snapshotMessage, filterForSession, supplementFor, readScopeKey } = require('./efsp-ws');
const { NlaStatusMonitor } = require('./nla-status-monitor');
const { Archiver } = require('./archiver');
const { statePaths, ensureDirFor } = require('../state-paths');
const { WALL_CLOCK } = require('../mission-clock');
const { ReplayCache } = require('./sync/replay-cache');
const { REGISTRY, RESTORE_ORDER, checkPersistedShape } = require('./stores');
const { SERVICE_ROWS } = require('./authority/airspace');
const log = require('../log').logger('efsp');

/**
 * @param {object} [deps]
 * @param {{now:()=>number, source:string}} [deps.clock] the mission clock
 *   (docs/adr/0079). Every store below takes it, so every time a controller
 *   reads — a gate, a deadline, a Strip clock, a Mutation's `at` — is in-game
 *   Zulu. app.js passes the real one; a fixture that omits it gets the wall
 *   clock, which is what the mission clock itself answers before DCS does.
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
function createEfsp({ clock = WALL_CLOCK, transitionAltFt, currentTheater = () => null,
  paths = statePaths('efsp-board.json', process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH),
  standingPaths = statePaths('efsp-airspaces.json', process.env.CRCSYNC_EFSP_AIRSPACES_PATH) } = {}) {
  facilityConfig.load(); // the Facilities' JSON is read here, not when the module is required (docs/wip/DATA-1.md)
  // The saved snapshot is read ONCE, here, with the same strict shape check the restore uses, and the RANGES Facility's
  // Positions are derived from it (and from the standing list's ids not yet seeded) before any Facility is built: the
  // definitions are data in the registry now, and a Position of RANGES must exist when its PositionStore is made.
  const saved = _readSnapshot(paths);
  const standing = airspaceSchema.loadStandingList({ paths: standingPaths });
  facilityConfig.setRangePositionIds(deriveRangePositionIds(saved && saved.airspaces, standing));
  assertAuthorityCoverage(facilityConfig);
  const codeAllocator = new CodeAllocator();
  const mutationLog = new MutationLog(undefined, { clock });
  const facilities = new Map(); // facilityId -> { boardStore, positionStore, rules }
  const stores = {};            // registry key -> instance (src/efsp/stores.js)
  const buildDeps = { clock, transitionAltFt, currentTheater, codeAllocator, mutationLog, facilities, stores };
  for (const entry of REGISTRY) stores[entry.key] = entry.build(buildDeps);
  const { flightData: flightDataStore, airspaces: airspaceStore, correlations: correlationStore, marsa: marsaStore,
    runwayStatuses: runwayStatusStore, carriers: carrierStore, sfaRotation: sfaStore } = stores;
  const facilityIds = facilityConfig.getFacilityIds();

  for (const facilityId of facilityIds) {
    const positionStore = new PositionStore(facilityConfig.getPositionSet(facilityId), facilityConfig.getConsolidation(facilityId), { clock });

    const rules = {
      resolveBlockTarget:  (blockId, stripType) => blockMap.resolveBlockTarget(stripType, blockId),
      isBlockVisible:      (stripType, blockId) => facilityConfig.isBlockVisible(stripType, blockId, facilityId),
      bayImpliesState:     (bayId) => facilityConfig.bayImpliesState(bayId, facilityId),
      bayHoldsStripType:        (bayId) => facilityConfig.bayHoldsStripType(bayId, facilityId),
      bayExists:           (bayId) => facilityConfig.bayExists(bayId, facilityId),
      bayForImpliedState:  (positionId, state) => facilityConfig.bayForImpliedState(positionId, state, facilityId),
      coordinationBayFor:  (positionId) => facilityConfig.coordinationBayFor(positionId, facilityId),
      computeNla:          (strip, flightData, now, ctx) => nla.computeNla(strip, flightData, now, ctx),
      isValidState:        (state, stripType) => nla.isValidState(state, stripType),
      isValidStripType:         (stripType) => blockMap.isValidStripType(stripType),
      isStaffed:          (positionId) => positionStore.isStaffed(positionId),
      consolidatedAt: (positionId) => positionStore.consolidatedAt(positionId),
      canMutate:           (actingPositionId, opKind) => permission.canMutate(actingPositionId, opKind),
      canCreateStripType:  (actingPositionId, stripType) => permission.canCreateStripType(actingPositionId, stripType),
      canActOnState:       (actingPositionId, stripType, state) => permission.canActOnState(actingPositionId, stripType, state),
      isSelfCoordinated:   (controllerId, positionId) => positionStore.isSelfCoordinated(controllerId, positionId),
      // docs/adr/0080 — the tactical capability table and the Bay lookups the
      // ownership, hand-back and consolidation rules read.
      baysFor:             (positionId) => facilityConfig.getBaysFor(positionId, facilityId),
      handBackTargetsFor:  (positionId) => permission.handBackTargetsFor(positionId),
      mayActBesideOwner:   (actingPositionId, strip, op) => permission.mayActBesideOwner(actingPositionId, strip, op),
      // WP4A (docs/adr/0015) — this Facility's own id, and a lazy accessor
      // to the OTHER Facility's BoardStore instance for cross-Facility
      // coordination. Lazy (a closure over `facilities`, resolved at call
      // time, not at construction time) because both Facilities'
      // BoardStore instances don't exist yet on the first iteration of
      // this loop — see the wiring loop below.
      facilityId,
      // WP4A (docs/adr/0017) — this Facility's own standing-release
      // envelopes (facility-config.js data, §4.6.2), a plain array rather
      // than a function since it's cheap, small config, not derived state.
      standingReleases: facilityConfig.getFacilityConfig(facilityId).standingReleases || [],
      // WP4A gap-closure (docs/adr/0022) — is a written directive on file
      // for AIT at this Facility? Guide §4.6 rule 7: "configuration, not a
      // default." Plain config value, same shape as standingReleases above.
      aitAuthorized: !!facilityConfig.getFacilityConfig(facilityId).aitAuthorized,
      peerBoard: (otherFacilityId) => {
        const other = facilities.get(otherFacilityId);
        return other ? other.boardStore : null;
      },
      // How many live (non-DROPPED) Strips still reference this flight data, across
      // EVERY Facility, excluding one Strip by id. Deliberately global rather
      // than this Facility's own Board: the FlightDataStore and its CodeAllocator
      // are shared across all Facilities (see this file's module comment),
      // so "is anyone still using this beacon code" is only answerable by
      // looking at all of them. Same lazy-closure-over-`facilities` shape as
      // peerBoard above, for the same construction-order reason.
      liveStripsForFlightData: (flightDataId, excludeStripId) => {
        let n = 0;
        for (const { boardStore } of facilities.values()) {
          for (const s of boardStore.getAll()) {
            if (s.flightDataId === flightDataId && s.stripId !== excludeStripId && s.state !== 'DROPPED') n++;
          }
        }
        return n;
      },
      coordinationEffect: (primitive) => coordination.coordinationEffect(primitive),
      // WP4A gap-closure (docs/adr/0022) — which EfspState a strip type
      // must be in to PROPOSE a coordination link (see coordination.js).
      coordinationEligibleState: (stripType) => coordination.coordinationEligibleState(stripType),
      tofiEligibleState: (stripType) => coordination.tofiEligibleState(stripType),
      // WP4A second slice — TOFI's target resolution (permission.js).
      tofiCounterparts: (actingPositionId) => permission.tofiCounterparts(actingPositionId),
      // The RANGE slice — the airspace an entry approval names, so the Strip
      // op can default the frequency from it and see whether it is active.
      // The store is shared across every Facility, so this rule is the same
      // function for all of them.
      airspaceFor: (airspaceId) => airspaceStore.getAirspace(airspaceId),
      // WP6 (docs/adr/0051), §9.2 — the three hooks MARSA needs inside a Strip
      // Mutation. All three are plain closures over the one shared store, with
      // no per-Facility scoping, because a relation is not a Facility's
      // property: a tanker worked by CENTER and a receiver worked by INCIRLIK
      // are in one relation, and a clearance issued at either end must void it.
      //
      // marsaInterlockFor is the Block Map lookup rather than a list of Block
      // ids held in the Board — see block-map.js's interlockFor() for why
      // that separation matters (the same Block id means opposite things on
      // different strip types).
      marsaInterlockFor:       (stripType, blockId) => blockMap.interlockFor(stripType, blockId),
      voidMarsaForAssignment:  (flightDataId, ctx) => marsaStore.voidForAssignment(flightDataId, ctx),
      activeMarsaFor:          (flightDataId) => marsaStore.activeFor(flightDataId),
      retireMarsaForFlightData:       (flightDataId, by) => marsaStore.onFlightDataRetired(flightDataId, by),
      // Ending or voiding a relation writes `tofi.separationRegime` back to
      // ATC on every participant. Those flight data writes are real changes no
      // marsa-delta can carry (a relation is not flight data), so the Board drains
      // them onto its own result and efsp-ws.js puts them in the board-delta's
      // `flightDataList.updated` — see marsa-store.js's drainRegimeWrites() (F-111).
      drainMarsaRegimeWrites:  () => marsaStore.drainRegimeWrites(),
      // WP6 (docs/adr/0061), §9.7 rule 1 — this Facility's runway status view
      // (null where there are no runways, which never inhibits). Cached in the
      // store, so every NLA stamp can afford to ask.
      runwayStatusFor:           () => runwayStatusStore.statusView(facilityId),
      // docs/adr/0074 — the carrier hooks the Board reads (board/strip-ops.js). The NLA out of
      // IN_STACK depends on the Case and on the staffed lane the stack feeds.
      carrierCase:             () => carrierStore.caseValue(),
      carrierLaneFor:          (strip) => carrierStore.laneFor(strip.flightDataId),
      carrierInStack:          (strip) => carrierStore.inStack(strip.flightDataId),
      canRecordCarrierHandoff: (actingPositionId, kind) => permission.canRecordCarrierHandoff(actingPositionId, kind),
      validateCarrierHandoff: (kind, args) => carrierModel.validateCarrierHandoff(kind, args),
      carrierHandoffs:        carrierModel.CARRIER_HANDOFFS,
      carrierApplyEffect:      (effect, flightDataId, meta) => carrierStore.applyEffect(effect, flightDataId, meta),
      carrierAppendFlight:     (flightDataId, meta) => carrierStore.appendFlight(flightDataId, meta),
      carrierRetireFlight:     (flightDataId, by) => carrierStore.onFlightDataRetired(flightDataId, by),
      // docs/adr/0075, 0093 — Bay descriptor flags (`capacity`, `view`) and Single
      // Frequency Approach. All plain reads of the one Facility config, so they
      // are the same functions for every Facility (a Facility without an SFA Bay
      // answers null).
      bayDescriptor:           (bayId) => facilityConfig.getBay(bayId, facilityId),
      sfaFrequencyFor:         (bayId, rackId) => {
        const bay = facilityConfig.getBay(bayId, facilityId);
        const sfa = facilityConfig.getSingleFrequencyApproach(facilityId);
        if (!bay || bay.view !== 'sfa-freqs' || !sfa) return null;
        const entry = sfaModel.poolEntryFor(sfa, rackId);
        return entry ? entry.mhz : null;
      },
      sfaRackFor:              (bayId, mhz) => {
        const bay = facilityConfig.getBay(bayId, facilityId);
        const sfa = facilityConfig.getSingleFrequencyApproach(facilityId);
        if (!bay || bay.view !== 'sfa-freqs' || !sfa) return null;
        const entry = sfa.pool.find(p => p.mhz === mhz);
        return entry ? entry.rackId : null;
      },
      sfaTransfers:            sfaModel.SFA_TRANSFERS,
      sfaRotationReceiver:     () => permission.sfaRotationReceiver(),
      canSendSfaRotationTransfer: (actingPositionId) => permission.canSendSfaRotationTransfer(actingPositionId),
    };

    const boardStore = new BoardStore(flightDataStore, rules, { clock });
    boardStore.setMutationLog(mutationLog);
    facilities.set(facilityId, { boardStore, positionStore, rules });
  }

  for (const entry of REGISTRY) if (entry.audited && stores[entry.key]) stores[entry.key].setMutationLog(mutationLog);
  _restore({ facilities, stores, saved, paths, mutationLog, clock });
  // The standing list, once per id (ADR 0098 §10): a definition that does not validate stops start-up, naming it.
  if (airspaceStore.seed(standing) > 0) _persist({ facilities, stores, persistState: { lastBody: null }, paths });

  // F-408's clock-driven half. Built here rather than in server.js, unlike the
  // obligation monitor and the correlation reconciler, because efsp-ws.js has
  // to tell it what it has already put on the wire (see its note()) — so it
  // has to be reachable from `ctx`. server.js supplies the broadcast and the
  // tick; see setOnDelta.
  const nlaStatusMonitor = new NlaStatusMonitor({
    clock,
    boardStoreFor: (facilityId) => {
      const f = facilities.get(facilityId);
      return f ? f.boardStore : null;
    },
    facilityConfig,
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
  });

  const ctx = {
    flightDataStore,
    airspaceStore,
    correlationStore,
    marsaStore,
    carrierStore,
    sfaStore,
    // key -> instance, for every entry of the persisted-store registry (stores.js)
    stores,
    facilityConfig,
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
    flightDataStore, mutationLog, clock,
    airspaceStore, correlationStore, marsaStore, nlaStatusMonitor, runwayStatusStore, carrierStore, sfaStore,
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

    handleMessage: (session, msg) => handleMessage(ctx, session, msg, () => _persist({ facilities, stores, persistState, paths })),

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
      return handleMessage(ctx, session, { ...msg, type: 'efsp-airspace-mutation' }, () => _persist({ facilities, stores, persistState, paths }));
    },

    /**
     * Persist on demand. The correlation reconciler deliberately does NOT
     * call this on its own tick (docs/adr/0045): a guaranteed 1Hz atomic
     * whole-snapshot write is exactly the cost _persist's own comment frets
     * about, and the only thing at risk in a crash is a few seconds of
     * correlation history — the state itself recomputes within one tick of
     * boot. This exists so a caller that genuinely needs a flush has one.
     */
    persist: () => _persist({ facilities, stores, persistState, paths }),

    /** Abrupt disconnect (guide §4.8.6) — signs the controller off every Position they were signed on at, across EVERY Facility (a controller may be signed on at Positions in more than one, guide §4.8.5). */
    onDisconnect: (session) => {
      for (const { positionStore } of facilities.values()) positionStore.onDisconnect(session.controllerId);
    },

    /** Sent once at connect, appended to ws-hub.js's existing connect-time send order. */
    snapshotFor: (session = null) => snapshotMessage(ctx, session),

    /**
     * The message `session` is to be sent for an EFSP broadcast `msg` (docs/adr/0080):
     * the same object when it reads everything, a filtered copy when it reads only
     * what it owns, null to skip. And a key that changes when a session's scope does.
     */
    filterForSession: (session, msg) => filterForSession(ctx, session, msg),
    supplementFor: (session, filtered) => supplementFor(ctx, session, filtered),
    readScopeKey: (session) => readScopeKey(ctx, session),

    archiver,
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
    log.warn('no prior Board snapshot to restore (first run)', { path: paths.read });
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
  // A Mutation audited but never persisted (a crash inside _persist) gets a
  // NotPersisted marker, so the log says that line never took effect.
  _reconcileLogTail(facilities, mutationLog, data.persistedWallAt, clock, stores.airspaces);
}

function _persist({ facilities, stores, persistState = { lastBody: null }, paths }) {
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
    const payload = `{"persistedWallAt":${Date.now()},${body.slice(1)}`;
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
