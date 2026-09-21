'use strict';

// Composition root for the EFSP subsystem (WP1's "server-side Board store"
// deliverable) — wires fdr-store, board-store, position-store, code-
// allocator, block-map, facility-config, permission, nla and coordination
// together into the `rules` each Facility's board-store.js needs, plus
// durable persistence (ADR 0002). server.js/ws-hub.js only ever talk to
// the object this factory returns.
//
// WP4A (docs/adr/0013) — createEfsp() now builds ONE {BoardStore,
// PositionStore, rules} pair PER Facility (facilityConfig.getFacilityIds(),
// currently ['INCIRLIK','CENTER']), rather than exactly one of each. This
// is the D13 mechanism's foundation: "the Strip does not cross the
// Facility boundary" (guide §4.6) is realized as two genuinely separate
// BoardStore instances, each with its own `_strips` Map, so a Strip
// replica in one can never structurally reach the other's (see board-
// store.js's own module comment on this). A single FdrStore/CodeAllocator/
// MutationLog stay shared across every Facility — a deliberate
// simplification of "one logical FDR, N per-Facility Strip replicas"
// (docs/adr/0013's own text): both Facilities' replicas reference the
// SAME fdrId, so an edit from either side is instantly visible to the
// other, and the guide's real-world forwarding-obligation timers (§4.6.1)
// become compliance/alerting instrumentation on an always-consistent
// record rather than an actual data-sync protocol we'd otherwise have to
// build. `efsp.boardStore`/`efsp.positionStore` stay as direct top-level
// properties (aliased to INCIRLIK) purely for pre-WP4A caller/test
// back-compat — `efsp.boardStoreFor(facilityId)`/`positionStoreFor(...)`
// are the real, general accessors everything WP4A-aware should use.

const fs = require('fs');

const { FdrStore } = require('./fdr-store');
const { AirspaceStore } = require('./airspace-store');
const { CorrelationStore } = require('./correlation-store');
const { MarsaStore } = require('./marsa-store');
const airspaceConfig = require('./airspace-config');
const { CodeAllocator } = require('./code-allocator');
const { BoardStore } = require('./board-store');
const { MutationLog } = require('./mutation-log');
const { PositionStore } = require('./position-store');
const permission = require('./permission');
const nla = require('./nla');
const blockMap = require('./block-map');
const facilityConfig = require('./facility-config');
const coordination = require('./coordination');
const { handleMessage, snapshotMessage } = require('./efsp-ws');
const { statePaths, ensureDirFor } = require('../state-paths');

// Overridable so tests exercise the restore/persist path against a temp
// file — same pattern as every other config/*.json path in this package.
// The Board is durable (docs/adr/0002), and used to be written into the
// image's config/ with no volume behind it — so a container recreate lost it,
// or worse, restored a snapshot somebody had committed to git. It lives in
// data/ now; see src/state-paths.js.
const { read: BOARD_SNAPSHOT_READ_PATH, write: BOARD_SNAPSHOT_PATH } =
  statePaths('efsp-board.json', process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH);

function createEfsp() {
  const codeAllocator = new CodeAllocator();
  const fdrStore = new FdrStore(codeAllocator);
  const mutationLog = new MutationLog();
  // One store for every Facility, like fdrStore — an airspace is a theater
  // entity that NAMES its controlling Facility rather than being replicated
  // into each one. There is no D13 replication question here because nothing
  // is ever handed across a boundary; the record has exactly one home.
  const airspaceStore = new AirspaceStore(airspaceConfig, {
    occupancyFor: (airspaceId) => {
      let n = 0;
      for (const { boardStore } of facilities.values()) {
        for (const s of boardStore.getAll()) {
          if (s.state !== 'DROPPED' && s.airspaceEntry && s.airspaceEntry.airspaceId === airspaceId) n++;
        }
      }
      return n;
    },
  });

  // WP5 (docs/adr/0045) — a FOURTH store, peer to the three above. Keyed by
  // fdrId, and shared across every Facility for the same reason fdrStore is:
  // a correlation is a fact about one airframe, and both halves of a
  // cross-Facility exchange are looking at the same one. There is no D13
  // replication question here either — the record has one home.
  const correlationStore = new CorrelationStore({
    fdrExists: (fdrId) => !!fdrStore.getFdr(fdrId),
  });

  // WP6 (docs/adr/0051) — a FIFTH store, peer to the four above and shared
  // across every Facility for the same reason fdrStore and correlationStore
  // are: MARSA is a fact about a set of airframes, not about one Facility's
  // Board, and both halves of a cross-Facility exchange are looking at the same
  // relation. There is no D13 replication question here either — the record has
  // one home, and its participants are fdrIds, which are already theater-wide.
  //
  // setSeparationRegime is injected rather than reached for: the store must not
  // hold an FdrStore (correlation-store.js's fdrExists precedent), and guide
  // §4.8.3 requires the regime to actually change when a flight enters a MARSA
  // block — "if a second controller takes TAC_C2 ten minutes later, the state
  // must already be correct, or they inherit a lie."
  const marsaStore = new MarsaStore({
    fdrExists: (fdrId) => !!fdrStore.getFdr(fdrId),
    setSeparationRegime: (fdrId, separationRegime, { by } = {}) =>
      fdrStore.setTofi(fdrId, { separationRegime }, { by }),
  });

  const facilityIds = facilityConfig.getFacilityIds();
  const facilities = new Map(); // facilityId -> { boardStore, positionStore, rules }

  for (const facilityId of facilityIds) {
    const positionStore = new PositionStore(facilityConfig.getPositionSet(facilityId), facilityConfig.getCoveringChain(facilityId));

    const rules = {
      resolveBlockTarget:  (blockId, role) => blockMap.resolveBlockTarget(role, blockId),
      isBlockVisible:      (role, blockId) => facilityConfig.isBlockVisible(role, blockId, facilityId),
      bayImpliesState:     (bayId) => facilityConfig.bayImpliesState(bayId, facilityId),
      bayExists:           (bayId) => facilityConfig.bayExists(bayId, facilityId),
      bayForImpliedState:  (positionId, state) => facilityConfig.bayForImpliedState(positionId, state, facilityId),
      coordinationBayFor:  (positionId) => facilityConfig.coordinationBayFor(positionId, facilityId),
      computeNla:          (strip, fdr, now, ctx) => nla.computeNla(strip, fdr, now, ctx),
      isValidState:        (state, role) => nla.isValidState(state, role),
      isValidRole:         (role) => blockMap.isValidRole(role),
      isOccupied:          (positionId) => positionStore.isOccupied(positionId),
      coveringPositionFor: (positionId) => positionStore.coveringPositionFor(positionId),
      canMutate:           (actingPositionId, opKind) => permission.canMutate(actingPositionId, opKind),
      canCreateStripRole:  (actingPositionId, role) => permission.canCreateStripRole(actingPositionId, role),
      canActOnState:       (actingPositionId, role, state) => permission.canActOnState(actingPositionId, role, state),
      isSelfCoordinated:   (controllerId, positionId) => positionStore.isSelfCoordinated(controllerId, positionId),
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
      // How many live (non-DROPPED) Strips still reference this FDR, across
      // EVERY Facility, excluding one Strip by id. Deliberately global rather
      // than this Facility's own Board: the FdrStore and its CodeAllocator
      // are shared across all Facilities (see this file's module comment),
      // so "is anyone still using this beacon code" is only answerable by
      // looking at all of them. Same lazy-closure-over-`facilities` shape as
      // peerBoard above, for the same construction-order reason.
      liveStripsForFdr: (fdrId, excludeStripId) => {
        let n = 0;
        for (const { boardStore } of facilities.values()) {
          for (const s of boardStore.getAll()) {
            if (s.fdrId === fdrId && s.stripId !== excludeStripId && s.state !== 'DROPPED') n++;
          }
        }
        return n;
      },
      coordinationEffect: (primitive) => coordination.coordinationEffect(primitive),
      // WP4A gap-closure (docs/adr/0022) — which EfspState a Strip Role
      // must be in to PROPOSE a coordination link (see coordination.js).
      coordinationEligibleState: (role) => coordination.coordinationEligibleState(role),
      tofiEligibleState: (role) => coordination.tofiEligibleState(role),
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
      // ids held in board-store.js — see block-map.js's interlockFor() for why
      // that separation matters (the same Block id means opposite things on
      // different Roles).
      marsaInterlockFor:       (role, blockId) => blockMap.interlockFor(role, blockId),
      voidMarsaForAssignment:  (fdrId, ctx) => marsaStore.voidForAssignment(fdrId, ctx),
      activeMarsaFor:          (fdrId) => marsaStore.activeFor(fdrId),
      retireMarsaForFdr:       (fdrId, by) => marsaStore.onFdrRetired(fdrId, by),
    };

    const boardStore = new BoardStore(fdrStore, rules);
    boardStore.setMutationLog(mutationLog);
    facilities.set(facilityId, { boardStore, positionStore, rules });
  }

  airspaceStore.setMutationLog(mutationLog);
  correlationStore.setMutationLog(mutationLog);
  marsaStore.setMutationLog(mutationLog);
  _validateAirspaceReferences(facilities);
  _restore(facilities, fdrStore, airspaceStore, correlationStore, marsaStore);

  const defaultFacility = facilities.get(facilityConfig.DEFAULT_FACILITY_ID);

  const ctx = {
    // Back-compat direct properties (INCIRLIK) — every pre-WP4A caller in
    // this package (server.js/ws-hub.js/tests) keeps working unmodified.
    boardStore: defaultFacility.boardStore,
    positionStore: defaultFacility.positionStore,
    fdrStore,
    airspaceStore,
    correlationStore,
    marsaStore,
    airspaceConfig,
    facilityConfig,
    // The real, Facility-aware accessors WP4A's wire protocol uses.
    boardStoreFor: (facilityId = facilityConfig.DEFAULT_FACILITY_ID) => {
      const f = facilities.get(facilityId);
      return f ? f.boardStore : null;
    },
    positionStoreFor: (facilityId = facilityConfig.DEFAULT_FACILITY_ID) => {
      const f = facilities.get(facilityId);
      return f ? f.positionStore : null;
    },
  };

  return {
    boardStore: ctx.boardStore, fdrStore, positionStore: ctx.positionStore, mutationLog,
    airspaceStore, correlationStore, marsaStore,
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

    handleMessage: (session, msg) => handleMessage(ctx, session, msg, () => _persist(facilities, fdrStore, airspaceStore, correlationStore, marsaStore)),

    /**
     * Persist on demand. The correlation reconciler deliberately does NOT
     * call this on its own tick (docs/adr/0045): a guaranteed 1Hz atomic
     * whole-snapshot write is exactly the cost _persist's own comment frets
     * about, and the only thing at risk in a crash is a few seconds of
     * correlation history — the state itself recomputes within one tick of
     * boot. This exists so a caller that genuinely needs a flush has one.
     */
    persist: () => _persist(facilities, fdrStore, airspaceStore, correlationStore, marsaStore),

    /** Abrupt disconnect (guide §4.8.6) — releases every Position the controller held, across EVERY Facility (a controller may hold Positions in more than one, guide §4.8.5). */
    onDisconnect: (session) => {
      for (const { positionStore } of facilities.values()) positionStore.onDisconnect(session.controllerId);
    },

    /** Sent once at connect, appended to ws-hub.js's existing connect-time send order. */
    snapshotFor: () => snapshotMessage(ctx),
  };
}

/**
 * Cross-checks every airspace's `controllingPositionId` against the Facility
 * it names. airspace-config.js validates its own shape but deliberately does
 * not require facility-config.js back (facility-config derives the RANGES
 * Position set FROM it, so the dependency only runs one way) — which leaves
 * exactly one thing unchecked, and it is the one that matters: an airspace
 * naming a Position that does not exist can never be activated by anybody,
 * and would fail as a silent PERMISSION_DENIED with nothing pointing at the
 * config. Warns rather than throws: a typo in one airspace should not stop
 * the server, and the rest of the board still works.
 *
 * `usingPositionId` needs no check — the RANGES Facility's Position set is
 * built from those values, so it exists by construction.
 */
/**
 * Checks that what came back off disk agrees with itself.
 *
 * Strips, FDRs and the allocated-code map are three parts of one snapshot,
 * and nothing ever verified they matched. Two ways they can disagree, both
 * silent: a live Strip whose FDR is missing renders with no callsign and
 * computes its NLA against null; and a live Strip whose beacon code is not
 * marked allocated lets the very next CreateStrip mint that same code for a
 * different aircraft — the identical failure docs/adr/0028 fixed for the
 * shared-FDR case, arriving by a different route.
 *
 * The code case is repaired rather than just reported: re-reserving a code
 * that a live flight is already squawking is unambiguously right, and
 * leaving it free is unambiguously dangerous.
 */
function _reconcileRestored(facilities, fdrStore, correlationStore, marsaStore) {
  const allocator = fdrStore.codeAllocator;
  // A MARSA relation whose participants' FDRs are all gone has nothing left to
  // be about. Dropped rather than reported, on the same split the correlation
  // case below documents: an orphaned relation is invisible either way, and a
  // relation that kept a partial participant list would be a live claim that
  // ATC is not separating an aircraft that no longer exists.
  if (marsaStore) {
    const dropped = marsaStore.evictMissingFdrs();
    if (dropped) console.warn(`[efsp] dropped ${dropped} restored MARSA relation(s) whose participants are gone`);
  }
  // A correlation record whose FDR did not come back has nothing to be about.
  // Dropped rather than reported, unlike the missing-FDR Strip case below: a
  // Strip without an FDR still renders and a controller needs to know why,
  // while a correlation without one is invisible either way.
  if (correlationStore) {
    const dropped = correlationStore.evictMissingFdrs();
    if (dropped) console.warn(`[efsp] dropped ${dropped} restored correlation record(s) whose FDR is gone`);
  }
  for (const [facilityId, { boardStore }] of facilities.entries()) {
    for (const strip of boardStore.getAll()) {
      if (strip.state === 'DROPPED') continue;
      const fdr = fdrStore.getFdr(strip.fdrId);
      if (!fdr) {
        console.warn(`[efsp] restored Strip ${strip.stripId} at ${facilityId} references a missing FDR ${strip.fdrId} — it will render without flight data`);
        continue;
      }
      const code = fdr.identity.beaconAssigned;
      if (code && !allocator.isAllocated(code)) {
        console.warn(`[efsp] restored Strip ${strip.stripId} squawks ${code}, which the code pool had free — re-reserving it`);
        allocator.reassign(strip.fdrId, code, null);
      }
    }
  }
}

function _validateAirspaceReferences(facilities) {
  for (const airspace of airspaceConfig.getAirspaces()) {
    const facility = facilities.get(airspace.controllingFacilityId);
    if (!facility) {
      console.warn(`[efsp] airspace ${airspace.airspaceId} names unknown Facility ${airspace.controllingFacilityId} — nobody can activate it`);
      continue;
    }
    const positions = facilityConfig.getPositionSet(airspace.controllingFacilityId);
    if (!positions.includes(airspace.controllingPositionId)) {
      console.warn(`[efsp] airspace ${airspace.airspaceId} names controlling Position ${airspace.controllingPositionId}, which does not exist at ${airspace.controllingFacilityId} — nobody can activate it`);
    }
  }
}

function _restore(facilities, fdrStore, airspaceStore, correlationStore, marsaStore) {
  try {
    const data = JSON.parse(fs.readFileSync(BOARD_SNAPSHOT_READ_PATH, 'utf8'));
    fdrStore.restore(data.fdr);
    // Airspace STATE is durable (ADR 0002); the definitions come from config
    // on every boot, so restore() skips anything no longer configured and a
    // newly configured airspace simply starts available. No migration either
    // way — the same reasoning that keeps facility config out of the snapshot.
    airspaceStore.restore(data.airspaces);
    // WP4A shape: { fdr, boards: { [facilityId]: boardSnapshot } }.
    // Falls back to the pre-WP4A single-board shape ({ fdr, board }) for
    // an on-disk snapshot written before this slice — restored into
    // whichever Facility is DEFAULT_FACILITY_ID (INCIRLIK), matching
    // exactly where that data always lived pre-WP4A.
    if (data.boards) {
      for (const [facilityId, boardData] of Object.entries(data.boards)) {
        const f = facilities.get(facilityId);
        if (f) f.boardStore.restore(boardData);
      }
    } else if (data.board) {
      const defaultFacilityId = require('./facility-config').DEFAULT_FACILITY_ID;
      const f = facilities.get(defaultFacilityId);
      if (f) f.boardStore.restore(data.board);
    }
    // Correlation records after the FDRs, since restore() skips any whose FDR
    // is gone. Every restored record comes back UNCORRELATED with its trackId
    // and its binding nulled — a persisted track id is a lie the moment the
    // process restarts, because DCS re-mints ids (docs/adr/0045).
    if (correlationStore) correlationStore.restore(data.correlations);
    // MARSA relations after the FDRs too, and for the opposite reason to the
    // correlation case above: a relation comes back INTACT, state and all. A
    // persisted track id is a lie after a restart because DCS re-mints ids; a
    // persisted MARSA relation names fdrIds and records a verbal declaration a
    // tanker crew made, which a crc-sync restart does not make untrue. Coming
    // back up with every AR silently reverted to ATC separation would be
    // §4.8.3's "second controller inherits a lie", caused by us.
    if (marsaStore) marsaStore.restore(data.marsa);
    // After the Boards, not before — it has Strips to check against only now.
    _reconcileRestored(facilities, fdrStore, correlationStore, marsaStore);
  } catch (e) {
    console.warn('[efsp] no prior Board snapshot to restore (first run, or it failed to load):', e.message);
  }
}

function _persist(facilities, fdrStore, airspaceStore, correlationStore, marsaStore) {
  try {
    const boards = {};
    for (const [facilityId, { boardStore }] of facilities.entries()) boards[facilityId] = boardStore.snapshot();
    // Written to a sibling and renamed, because rename is atomic on POSIX
    // and a plain write is not. This runs after EVERY successful Mutation,
    // so the process spends a meaningful fraction of a busy session inside
    // this call — a crash or a power loss partway through would leave a
    // truncated file, which JSON.parse then rejects wholesale on restart,
    // and _restore's catch would come up with an empty Board. Losing one
    // Mutation to a crash is unavoidable; losing the entire session's Board
    // to one is not.
    const payload = JSON.stringify({
      boards,
      fdr: fdrStore.snapshot(),
      airspaces: airspaceStore.snapshot(),
      correlations: correlationStore ? correlationStore.snapshot() : [],
      marsa: marsaStore ? marsaStore.snapshot() : [],
    }, null, 2);
    const tmpPath = `${BOARD_SNAPSHOT_PATH}.tmp`;
    // Same directory as the target, so the rename below stays within one
    // filesystem — across a mount boundary it is not atomic, and the whole
    // point of the sibling-then-rename is that it is.
    ensureDirFor(BOARD_SNAPSHOT_PATH);
    fs.writeFileSync(tmpPath, payload);
    fs.renameSync(tmpPath, BOARD_SNAPSHOT_PATH);
  } catch (e) {
    console.warn('[efsp] failed to persist Board snapshot:', e.message);
  }
}

module.exports = { createEfsp, BOARD_SNAPSHOT_PATH };
