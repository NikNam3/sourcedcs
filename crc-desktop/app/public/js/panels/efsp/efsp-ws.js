'use strict';

// Client-side EFSP WebSocket helpers — constructs efsp-mutation/efsp-
// set-positions/efsp-resync messages, sends them via sync.js's existing
// sendToSync(), and registers Mutations as pending (efsp-state.js) until
// their ack arrives. Thin network glue with no dedicated test file, same
// as sync.js itself (which also has none) — the logic worth testing in
// isolation (message merging, rebase) already lives in efsp-state.js.

// WP4A (docs/adr/0013): keyed by facilityId — each Facility's held-Position
// set is independent server-side (a separate PositionStore instance per
// Facility), so the client tracks them the same way. Position IDs are
// globally unique across Facilities in this slice (OPS/CD/GND/TWR/APP vs
// CTR never collide), which is what lets getActingPositions() below still
// return one flat, facility-agnostic list for every pre-WP4A call site.
const DEFAULT_EFSP_FACILITY_ID = 'INCIRLIK';
let _actingPositionsByFacility = { INCIRLIK: [], CENTER: [] };

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

/**
 * Sends a Mutation targeting an existing Strip. Caller MUST only pass a
 * currently-held Position — efsp-panel.js only offers actions for
 * Positions actually held. facilityId is read directly off the Strip
 * (every Strip record arriving from crc-sync since WP4A carries one,
 * efsp-ws.js server-side stamps it on every snapshot/delta/ack) rather
 * than threaded through every call site — bay-view.js's dispatch helpers
 * (NLA/move/transfer/gesture/coordination) all just pass their Strip
 * through unchanged.
 */
function sendEfspMutation(actingPositionId, strip, op) {
  const msg = {
    version: 1, type: 'efsp-mutation',
    clientMutationId: efspClientMutationId(),
    facilityId: strip.facilityId || undefined, // omitted entirely for a pre-WP4A Strip record with no facilityId — server defaults to INCIRLIK
    actingPositionId,
    stripId: strip.stripId,
    baseRev: strip.rev,
    op,
  };
  registerPendingMutation(msg);
  _sendEfsp(msg);
  return msg.clientMutationId;
}

/** CreateStrip has no existing Strip to derive facilityId from — an explicit param, defaulting to INCIRLIK for back-compat with every pre-WP4A call site (efsp-panel.js's OPS-only DEPARTURE form). */
function sendEfspCreateStrip(actingPositionId, createOp, facilityId = DEFAULT_EFSP_FACILITY_ID) {
  const msg = {
    version: 1, type: 'efsp-mutation',
    clientMutationId: efspClientMutationId(),
    facilityId,
    actingPositionId,
    op: createOp,
  };
  registerPendingMutation(msg);
  _sendEfsp(msg);
  return msg.clientMutationId;
}

/** Sets the FULL held-Position set for ONE Facility — mirrors position-store.js's own "declare your full set each call" contract, per Facility (docs/adr/0013: each Facility has its own PositionStore instance server-side). */
function sendEfspSetPositions(facilityId, held) {
  _actingPositionsByFacility[facilityId] = [...held];
  _sendEfsp({ version: 1, type: 'efsp-set-positions', facilityId, held });
}

/**
 * @param {string} [facilityId] — omit to get the flattened union across
 *   EVERY Facility (every pre-WP4A call site in bay-view.js/efsp-panel.js
 *   does this — Position IDs are globally unique across Facilities this
 *   slice, so a flat list is exactly as correct as a facility-scoped one
 *   for "does this controller hold Position X").
 */
function getActingPositions(facilityId) {
  if (facilityId) return [...(_actingPositionsByFacility[facilityId] || [])];
  return Object.values(_actingPositionsByFacility).flat();
}

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
