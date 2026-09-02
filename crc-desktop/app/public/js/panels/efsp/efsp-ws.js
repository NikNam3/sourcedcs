'use strict';

// Client-side EFSP WebSocket helpers — constructs efsp-mutation/efsp-
// set-positions/efsp-resync messages, sends them via sync.js's existing
// sendToSync(), and registers Mutations as pending (efsp-state.js) until
// their ack arrives. Thin network glue with no dedicated test file, same
// as sync.js itself (which also has none) — the logic worth testing in
// isolation (message merging, rebase) already lives in efsp-state.js.

let _actingPositions = []; // this controller's currently-held Positions, set via sendEfspSetPositions()

function efspClientMutationId() {
  // crypto.randomUUID() is available in Electron's Chromium renderer (and
  // any modern browser) with no polyfill — same API crc-sync uses server-side.
  return crypto.randomUUID();
}

// sendToSync() (sync.js) silently drops a message if the WebSocket isn't
// OPEN at the moment of the call — correct for its existing callers, but
// an EFSP action that gets silently dropped is indistinguishable from a
// broken button. Warn loudly here instead, since this is the one place
// every EFSP send passes through.
function _sendEfsp(msg) {
  if (!isSyncOpen()) {
    console.warn('[efsp] WebSocket not open — message NOT sent (silently dropped by sendToSync):', msg);
    return;
  }
  sendToSync(msg);
}

/** Sends a Mutation targeting an existing Strip. Caller MUST only pass a currently-held Position — efsp-panel.js only offers actions for Positions actually held. */
function sendEfspMutation(actingPositionId, strip, op) {
  const msg = {
    version: 1, type: 'efsp-mutation',
    clientMutationId: efspClientMutationId(),
    actingPositionId,
    stripId: strip.stripId,
    baseRev: strip.rev,
    op,
  };
  registerPendingMutation(msg);
  _sendEfsp(msg);
  return msg.clientMutationId;
}

/** CreateStrip has no stripId/baseRev to target — OPS-only, enforced server-side by permission.js. */
function sendEfspCreateStrip(actingPositionId, createOp) {
  const msg = {
    version: 1, type: 'efsp-mutation',
    clientMutationId: efspClientMutationId(),
    actingPositionId,
    op: createOp,
  };
  registerPendingMutation(msg);
  _sendEfsp(msg);
  return msg.clientMutationId;
}

function sendEfspSetPositions(held) {
  _actingPositions = [...held];
  _sendEfsp({ version: 1, type: 'efsp-set-positions', held });
}

function getActingPositions() { return [..._actingPositions]; }

/** Resync after reconnect (guide §5.6) — server replies with efsp-board-delta or efsp-snapshot, never a third path. */
function sendEfspResync(lastBoardSeq) {
  _sendEfsp({ version: 1, type: 'efsp-resync', lastBoardSeq });
}

/**
 * Replays every still-pending Mutation against the fresh post-reconnect
 * baseline (guide §5.6.3) — call once after an efsp-snapshot or
 * efsp-board-delta lands following a resync. A Mutation whose target Strip
 * no longer exists locally (rebaseForResend returns null) is surfaced via
 * onOrphaned rather than silently dropped — "the worst failure mode in
 * the system."
 */
function replayPendingEfspMutations(onOrphaned) {
  for (const original of getPendingMutations()) {
    const rebased = rebaseForResend(original.clientMutationId);
    if (!rebased) {
      if (typeof onOrphaned === 'function') onOrphaned(original);
      continue;
    }
    _sendEfsp(rebased);
  }
}
