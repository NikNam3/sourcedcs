'use strict';

const { VERSION, stampStrip } = require('../frames');
const { orderSlots } = require('../slots');

// Both ATO messages are CUSTOM families: they declare `handle()` instead of the skeleton's hooks, because their shape
// does not fit it. `efsp-ato-preview` is read-only (no replay, no persist, no broadcast, and not named `…-mutation`).
// `efsp-ato-mutation` keeps its own per-ctx ack cache instead of the replay cache (`replayKind: null`), audits its own
// refusals, and broadcasts one board-delta carrying `boardEpoch`.

// ── WP7: the ATO import (docs/adr/0071, guide §9.8/§9.9) ─────────────────────
//
// Two message types. `efsp-ato-preview` is read-only — never logged, and not
// named `…-mutation`, so L5's metrics tap does not count it. `efsp-ato-mutation`
// imports: the server RE-PARSES the text (it never trusts a client's parse, a
// seed or a code), checks the text is the one previewed, validates the
// controller's choices against its own re-parse, and then creates each mission
// line through the EXISTING CreateStrip path (docs/adr/0054), one derived
// clientMutationId per line. Everything lands on TACTICAL's Board, so the
// session binding is per Facility, copied from _handleMutation — not the
// "Primary somewhere" of the airspace/correlation/MARSA paths.

const atoBoard = require('../../ato/ato-board');
const ATO_ACK_CACHE_CAP = 200;
const _atoAckCaches = new WeakMap(); // ctx -> Map(clientMutationId -> first ack)

function _atoAckCache(ctx) {
  let cache = _atoAckCaches.get(ctx);
  if (!cache) { cache = new Map(); _atoAckCaches.set(ctx, cache); }
  return cache;
}

/** Every live Strip on every Board, stamped with its Facility — bind candidates look at all of them. */
function _atoLiveStrips(ctx) {
  const out = [];
  const ids = ctx.facilityConfig && typeof ctx.facilityConfig.getFacilityIds === 'function'
    ? ctx.facilityConfig.getFacilityIds() : [atoBoard.ATO_IMPORT_ORIGIN.facilityId];
  for (const facilityId of ids) {
    const boardStore = ctx.boardStoreFor(facilityId);
    if (!boardStore) continue;
    for (const s of boardStore.getAll()) if (s.state !== 'DROPPED') out.push({ ...s, facilityId });
  }
  return out;
}

/** The checks both ATO messages share, in the order a refusal should name them. */
function _atoGate(ctx, session, msg, text) {
  const origin = atoBoard.ATO_IMPORT_ORIGIN;
  const boardStore = typeof ctx.boardStoreFor === 'function' ? ctx.boardStoreFor(origin.facilityId) : null;
  const positionStore = typeof ctx.positionStoreFor === 'function' ? ctx.positionStoreFor(origin.facilityId) : null;
  if (!boardStore || !positionStore || !ctx.fdrStore) return { reason: 'VALIDATION_ERROR', detail: 'this server has no TACTICAL Board to import an ATO into' };
  if (positionStore.primaryOf(msg.actingPositionId) !== session.controllerId) {
    return { reason: 'NOT_HOLDING_POSITION', detail: `you are not Primary at ${msg.actingPositionId} at ${origin.facilityId} — select it before importing an ATO` };
  }
  if (msg.actingPositionId !== origin.positionId) {
    return { reason: 'PERMISSION_DENIED', detail: `only ${origin.positionId} imports an ATO — it works the mission lines (guide §9.8)` };
  }
  if (!ctx.clock) return { reason: 'VALIDATION_ERROR', detail: 'no mission clock to date the ATO against' };
  if (typeof text !== 'string' || text.trim() === '') return { reason: 'VALIDATION_ERROR', detail: 'paste or drop the ATO text first' };
  if (Buffer.byteLength(text, 'utf8') > atoBoard.MAX_ATO_TEXT_BYTES) return { reason: 'VALIDATION_ERROR', detail: 'ATO text over 1 MiB' };
  return { boardStore };
}

function handleAtoPreview(ctx, session, msg) {
  const base = { version: VERSION, type: 'efsp-ato-preview-result', requestId: msg.requestId };
  const gate = _atoGate(ctx, session, msg, msg.text);
  if (gate.reason) return { ack: { ...base, ok: false, reason: gate.reason, detail: gate.detail }, broadcasts: orderSlots(null) };
  const preview = atoBoard.previewAto({ text: msg.text, fdrs: ctx.fdrStore.getAll(), liveStrips: _atoLiveStrips(ctx), nowUtc: ctx.clock.now() });
  return { ack: { ...base, ok: true, preview }, broadcasts: orderSlots(null) };
}

function _atoMsgId(header) {
  const m = header && header.msgId;
  return m ? [m.formatId, m.originator, m.serial, m.month, m.qualifier, m.qualifierSerial].filter(Boolean).join('/') : null;
}

function handleAtoMutation(ctx, session, msg, persist) {
  const facilityId = atoBoard.ATO_IMPORT_ORIGIN.facilityId;
  const op = msg.op && typeof msg.op === 'object' ? msg.op : {};
  const cmid = msg.clientMutationId;
  const base = { version: VERSION, type: 'efsp-ato-ack', clientMutationId: cmid, facilityId };
  const logEntry = (entry) => {
    if (!ctx.mutationLog) return;
    ctx.mutationLog.record({
      clientMutationId: cmid === undefined ? null : cmid, type: msg.type, op: 'ImportAto', facilityId,
      actingPositionId: msg.actingPositionId || null, actorId: session.controllerId || null,
      at: ctx.clock ? ctx.clock.now() : null, ...entry,
    });
  };
  // A refusal made here is audited like any store's (the store convention since
  // docs/adr/0040), except NOT_HOLDING_POSITION, which L5's tap already logs.
  const refuse = (reason, detail) => {
    if (reason !== 'NOT_HOLDING_POSITION') logEntry({ ok: false, reason, detail, source: 'wire' });
    return { ack: { ...base, ok: false, reason, detail, results: [] }, broadcasts: orderSlots(null), ...(reason === 'NOT_HOLDING_POSITION' ? { unaudited: true } : {}) };
  };

  const gate = _atoGate(ctx, session, msg, op.text);
  if (gate.reason) return refuse(gate.reason, gate.detail);
  if (typeof cmid !== 'string' || cmid === '') return refuse('VALIDATION_ERROR', 'an ATO import carries a clientMutationId');
  const cache = _atoAckCache(ctx);
  if (cache.has(cmid)) return { ack: cache.get(cmid), broadcasts: orderSlots(null) }; // a replayed import: the first answer, nothing twice
  if (op.kind !== 'ImportAto') return refuse('VALIDATION_ERROR', `unknown ATO op ${JSON.stringify(op.kind)}`);

  const now = ctx.clock.now();
  const analysis = atoBoard.analyseAto({ text: op.text, fdrs: ctx.fdrStore.getAll(), liveStrips: _atoLiveStrips(ctx), nowUtc: now });
  const plan = atoBoard.planImport(analysis, op.choices, { textSha1: op.textSha1 });
  if (!plan.ok) return refuse(plan.reason, plan.detail);

  const atoRef = {
    importId: cmid, msgId: analysis.preview.header.msgId, operation: analysis.preview.header.operation,
    textSha1: analysis.preview.textSha1, importedAt: now, importedBy: session.controllerId || null,
  };
  const { boardStore } = gate;
  const exec = atoBoard.executeImport({
    analysis, plan, boardStore, fdrStore: ctx.fdrStore, clientMutationId: cmid,
    actingPositionId: msg.actingPositionId, by: session.controllerId, atoRef,
  });
  logEntry({
    ok: true, atoMsgId: _atoMsgId(analysis.doc.header), textSha1: atoRef.textSha1,
    lines: exec.results.map((r) => ({ lineId: r.lineId, action: r.action, ok: r.ok, stripId: r.stripId || null, fdrId: r.fdrId || null, reason: r.reason || null })),
  });
  if (exec.applied) persist();

  const ack = { ...base, ok: true, boardSeq: boardStore.currentSeq, boardEpoch: boardStore.epoch, results: exec.results, textSha1: atoRef.textSha1 };
  cache.set(cmid, ack);
  if (cache.size > ATO_ACK_CACHE_CAP) cache.delete(cache.keys().next().value);
  if (!exec.applied) return { ack, broadcasts: orderSlots(null) };
  return {
    ack,
    broadcasts: orderSlots({ primary: {
      version: VERSION, type: 'efsp-board-delta', boardSeq: boardStore.currentSeq, boardEpoch: boardStore.epoch, facilityId,
      strips: { updated: exec.strips.map((s) => stampStrip(boardStore, boardStore.getStrip(s.stripId) || s, facilityId, ctx)), gone: [] },
      fdrs: { updated: exec.fdrIds.map((id) => ctx.fdrStore.getFdr(id)).filter(Boolean) },
      positions: { updated: [] },
    } }),
  };
}

module.exports = [
  { type: 'efsp-ato-preview', ackType: 'efsp-ato-preview-result', replayKind: null, handle: handleAtoPreview },
  { type: 'efsp-ato-mutation', ackType: 'efsp-ato-ack', replayKind: null, handle: handleAtoMutation },
];
