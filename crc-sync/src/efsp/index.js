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

const path = require('path');
const fs = require('fs');

const { FdrStore } = require('./fdr-store');
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

// Overridable so tests exercise the restore/persist path against a temp
// file — same pattern as every other config/*.json path in this package.
const BOARD_SNAPSHOT_PATH = process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH
  || path.join(__dirname, '../../config/efsp-board.json');

function createEfsp() {
  const codeAllocator = new CodeAllocator();
  const fdrStore = new FdrStore(codeAllocator);
  const mutationLog = new MutationLog();

  const facilityIds = facilityConfig.getFacilityIds();
  const facilities = new Map(); // facilityId -> { boardStore, positionStore, rules }

  for (const facilityId of facilityIds) {
    const positionStore = new PositionStore(facilityConfig.getPositionSet(facilityId), facilityConfig.getCoveringChain(facilityId));

    const rules = {
      resolveBlockTarget:  (blockId, role) => blockMap.resolveBlockTarget(role, blockId),
      bayImpliesState:     (bayId) => facilityConfig.bayImpliesState(bayId, facilityId),
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
      peerBoard: (otherFacilityId) => {
        const other = facilities.get(otherFacilityId);
        return other ? other.boardStore : null;
      },
      coordinationEffect: (primitive) => coordination.coordinationEffect(primitive),
    };

    const boardStore = new BoardStore(fdrStore, rules);
    boardStore.setMutationLog(mutationLog);
    facilities.set(facilityId, { boardStore, positionStore, rules });
  }

  _restore(facilities, fdrStore);

  const defaultFacility = facilities.get(facilityConfig.DEFAULT_FACILITY_ID);

  const ctx = {
    // Back-compat direct properties (INCIRLIK) — every pre-WP4A caller in
    // this package (server.js/ws-hub.js/tests) keeps working unmodified.
    boardStore: defaultFacility.boardStore,
    positionStore: defaultFacility.positionStore,
    fdrStore,
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

    handleMessage: (session, msg) => handleMessage(ctx, session, msg, () => _persist(facilities, fdrStore)),

    /** Abrupt disconnect (guide §4.8.6) — releases every Position the controller held, across EVERY Facility (a controller may hold Positions in more than one, guide §4.8.5). */
    onDisconnect: (session) => {
      for (const { positionStore } of facilities.values()) positionStore.onDisconnect(session.controllerId);
    },

    /** Sent once at connect, appended to ws-hub.js's existing connect-time send order. */
    snapshotFor: () => snapshotMessage(ctx),
  };
}

function _restore(facilities, fdrStore) {
  try {
    const data = JSON.parse(fs.readFileSync(BOARD_SNAPSHOT_PATH, 'utf8'));
    fdrStore.restore(data.fdr);
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
  } catch (e) {
    console.warn('[efsp] no prior Board snapshot to restore (first run, or it failed to load):', e.message);
  }
}

function _persist(facilities, fdrStore) {
  try {
    const boards = {};
    for (const [facilityId, { boardStore }] of facilities.entries()) boards[facilityId] = boardStore.snapshot();
    fs.writeFileSync(BOARD_SNAPSHOT_PATH, JSON.stringify({ boards, fdr: fdrStore.snapshot() }, null, 2));
  } catch (e) {
    console.warn('[efsp] failed to persist Board snapshot:', e.message);
  }
}

module.exports = { createEfsp, BOARD_SNAPSHOT_PATH };
