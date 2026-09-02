'use strict';

// Composition root for the EFSP subsystem (WP1's "server-side Board store"
// deliverable) — wires fdr-store, board-store, position-store, code-
// allocator, block-map, facility-config, permission and nla together into
// the `rules` board-store.js needs, plus durable persistence (ADR 0002).
// server.js/ws-hub.js only ever talk to the object this factory returns.

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
const { handleMessage, snapshotMessage } = require('./efsp-ws');

// Overridable so tests exercise the restore/persist path against a temp
// file — same pattern as every other config/*.json path in this package.
const BOARD_SNAPSHOT_PATH = process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH
  || path.join(__dirname, '../../config/efsp-board.json');

function createEfsp() {
  const codeAllocator = new CodeAllocator();
  const fdrStore = new FdrStore(codeAllocator);
  const positionStore = new PositionStore(facilityConfig.getPositionSet(), facilityConfig.getCoveringChain());
  const mutationLog = new MutationLog();

  const rules = {
    resolveBlockTarget:  (blockId, role) => blockMap.resolveBlockTarget(role, blockId),
    bayImpliesState:     (bayId) => facilityConfig.bayImpliesState(bayId),
    bayForImpliedState:  (positionId, state) => facilityConfig.bayForImpliedState(positionId, state),
    computeNla:          (strip, fdr, now, ctx) => nla.computeNla(strip, fdr, now, ctx),
    isValidState:        (state, role) => nla.isValidState(state, role),
    isValidRole:         (role) => blockMap.isValidRole(role),
    isOccupied:          (positionId) => positionStore.isOccupied(positionId),
    coveringPositionFor: (positionId) => positionStore.coveringPositionFor(positionId),
    canMutate:           (actingPositionId, opKind) => permission.canMutate(actingPositionId, opKind),
    canCreateStripRole:  (actingPositionId, role) => permission.canCreateStripRole(actingPositionId, role),
    canActOnState:       (actingPositionId, role, state) => permission.canActOnState(actingPositionId, role, state),
    isSelfCoordinated:   (controllerId, positionId) => positionStore.isSelfCoordinated(controllerId, positionId),
  };

  const boardStore = new BoardStore(fdrStore, rules);
  boardStore.setMutationLog(mutationLog);
  _restore(boardStore, fdrStore);

  const ctx = { boardStore, fdrStore, positionStore, facilityConfig };

  return {
    boardStore, fdrStore, positionStore, mutationLog,

    /**
     * Derives the stable controllerId ws-hub.js should stamp onto a
     * session — the exact fallback chain ws-hub.js already uses for
     * `session.who` (user.name || preferred_username || sub), reused
     * rather than inventing a second identity scheme.
     */
    controllerIdFor(user) {
      return user.name || user.preferred_username || user.sub || 'unknown';
    },

    handleMessage: (session, msg) => handleMessage(ctx, session, msg, () => _persist(boardStore, fdrStore)),

    /** Abrupt disconnect (guide §4.8.6) — releases every Position the controller held. */
    onDisconnect: (session) => positionStore.onDisconnect(session.controllerId),

    /** Sent once at connect, appended to ws-hub.js's existing connect-time send order. */
    snapshotFor: () => snapshotMessage(ctx),
  };
}

function _restore(boardStore, fdrStore) {
  try {
    const data = JSON.parse(fs.readFileSync(BOARD_SNAPSHOT_PATH, 'utf8'));
    fdrStore.restore(data.fdr);
    boardStore.restore(data.board);
  } catch (e) {
    console.warn('[efsp] no prior Board snapshot to restore (first run, or it failed to load):', e.message);
  }
}

function _persist(boardStore, fdrStore) {
  try {
    fs.writeFileSync(BOARD_SNAPSHOT_PATH, JSON.stringify({
      board: boardStore.snapshot(),
      fdr: fdrStore.snapshot(),
    }, null, 2));
  } catch (e) {
    console.warn('[efsp] failed to persist Board snapshot:', e.message);
  }
}

module.exports = { createEfsp, BOARD_SNAPSHOT_PATH };
