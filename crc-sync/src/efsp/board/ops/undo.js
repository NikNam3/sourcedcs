'use strict';

const { deepClone } = require('../strip-util');

// Undo (docs/adr/0100): puts back every record the undone action touched, as it was before the action, and voids
// the later changes made inside this Facility. The history (undo/undo-history.js) decided that the action may be
// undone and by whom and handed over its Plan; this validates the whole Plan first (a refusal changes nothing), then
// restores: this Board's Strips, another Board's through its `receiveUndoRestore`, the flight data path by path, and
// the side stores through their own compensators (code, carrier stack, MARSA).

const HOLDER_STATES = ['INITIATED', 'ACTIVE'];

function _key(facilityId, stripId) { return `${facilityId}/${stripId}`; }

/**
 * The control invariant (ADR 0101, H100 DR-6): a restored HANDOFF record must not name a holder whose Strip is
 * retired, or a live flight would be left with nobody holding communications or control. A backstop behind the
 * cross-Facility block. Returns the refusal, or null.
 */
function _controlInvariantRefusal(env, images, restoring) {
  for (const img of images) {
    const link = img.strip && img.strip.coordination;
    if (!link || link.primitive !== 'HANDOFF' || !HOLDER_STATES.includes(link.state) || !link.peerStripId) continue;
    if (img.strip.state === 'DROPPED') continue;
    const restored = restoring.get(_key(link.peerFacilityId, link.peerStripId));
    const peerBoard = env.boardFor(link.peerFacilityId);
    const peer = restored ? restored.strip : (peerBoard ? peerBoard.getStrip(link.peerStripId) : null);
    if (!peer || peer.state === 'DROPPED') {
      return {
        ok: false, reason: 'UNDO_BLOCKED',
        detail: `restoring ${img.stripId} would name ${link.peerFacilityId}'s ${link.peerStripId} as holder, and that Strip is retired`,
      };
    }
  }
  return null;
}

function _summary(env, voided, subject) {
  const flightData = subject && subject.flightDataId ? env.flightDataStore.getFlightData(subject.flightDataId) : null;
  const callsign = (flightData && flightData.identity && flightData.identity.callsign) || (subject && subject.stripId) || '';
  return `${voided.op} on ${callsign}`;
}

function _applyUndo(ctx, meta) {
  const { plan, by, actingPositionId, clientMutationId } = meta;
  const env = ctx.undoHistory.env;
  const facilityId = ctx.rules.facilityId;
  const voidedBy = plan.actionId;

  // ── what is restored and what is removed ──
  const createdKeys = new Set((plan.created.strips || []).map(s => _key(s.facilityId, s.stripId)));
  const restoring = new Map();
  for (const img of plan.images.strips) if (img.strip) restoring.set(_key(img.facilityId, img.stripId), img);
  const byFacility = new Map(); // facilityId -> { images, removeIds }
  const slot = (f) => byFacility.get(f) || byFacility.set(f, { images: [], removeIds: [] }).get(f);
  for (const img of restoring.values()) slot(img.facilityId).images.push(img);
  for (const s of plan.created.strips || []) {
    if (!restoring.has(_key(s.facilityId, s.stripId))) slot(s.facilityId).removeIds.push(s.stripId);
  }
  const subjectKey = _key(facilityId, plan.meta.stripId);
  const subjectImage = restoring.get(subjectKey);

  // ── validate everything first ──
  for (const [f, part] of byFacility) {
    const board = f === facilityId ? null : env.boardFor(f);
    if (f !== facilityId && !board) return { ok: false, reason: 'UNDO_BLOCKED', detail: `Facility ${f} is not reachable` };
    const refusal = f === facilityId ? ctx.checkRestore(part.images) : board.checkUndoRestore(part.images);
    if (refusal) return refusal;
  }
  const invariant = _controlInvariantRefusal(env, [...restoring.values()], restoring);
  if (invariant) return invariant;
  const carrierActions = [];
  for (const c of plan.images.carrier || []) {
    if (!env.carrierStore) continue;
    const check = env.carrierStore.restoreCheck(c.flightDataId, c.image);
    if (!check.ok) return { ok: false, reason: check.reason, detail: check.detail };
    if (check.action !== 'NONE') carrierActions.push(c);
  }
  const marsaActions = [];
  for (const image of plan.images.marsa || []) {
    if (!env.marsaStore) continue;
    const check = env.marsaStore.reopenCheck(image);
    if (!check.ok) return { ok: false, reason: check.reason, detail: check.detail };
    if (check.action === 'REOPEN') marsaActions.push(image);
  }

  // ── restore ──
  const live = ctx.state.strips.get(plan.meta.stripId) || null;
  const subjectBefore = live ? deepClone(live) : null;
  const mine = byFacility.get(facilityId) || { images: [], removeIds: [] };
  const own = ctx.restoreImages(mine.images, mine.removeIds, { voidedBy, by });
  let peerFacilityId; let peerStrip; let peerGone = false;
  for (const [f, part] of byFacility) {
    if (f === facilityId) continue;
    const r = env.boardFor(f).receiveUndoRestore({
      causedBy: clientMutationId, undoneActionId: plan.actionId, fromFacilityId: facilityId,
      images: part.images, removeIds: part.removeIds, voidedBy, by,
    });
    peerFacilityId = f;
    const restoredHere = r.records.find(x => x.after);
    if (restoredHere) peerStrip = env.boardFor(f).getStrip(restoredHere.stripId);
    if (r.gone.length) peerGone = true;
  }

  const compensators = {};
  const marsaChanged = [];
  for (const image of marsaActions) {
    const reopened = env.marsaStore.reopenRelation(image, { causedBy: clientMutationId, by });
    if (reopened) marsaChanged.push(reopened);
  }
  if (marsaChanged.length) compensators.marsa = marsaChanged.map(r => r.marsaId);

  const flightDataList = [];
  let warning;
  for (const { id, image } of plan.images.flightData) {
    const paths = plan.paths.get(id);
    if (!image || !paths || paths.size === 0) continue;
    const r = env.flightDataStore.restorePaths(id, image, [...paths], { voidedBy, by });
    if (r.ok && r.changed) flightDataList.push(r.flightData);
    if (r.warning) warning = r.warning;
  }
  for (const c of plan.images.codes || []) {
    if (!c || !c.holder) continue;
    if (env.flightDataStore.codeAllocator.holderOf(c.code) === c.holder) continue;
    const r = env.flightDataStore.reacquireFlightData(c.holder);
    (compensators.codes = compensators.codes || []).push(c.code);
    if (r.warning) warning = r.warning;
  }
  let carrierChanged;
  for (const c of carrierActions) {
    const r = env.carrierStore.restoreEntry(c.flightDataId, c.image, { causedBy: clientMutationId, by });
    if (r.ok && r.changed.length) {
      carrierChanged = true;
      (compensators.carrier = compensators.carrier || []).push(c.flightDataId);
    }
  }
  for (const fd of marsaChanged.length ? (env.marsaStore.drainRegimeWrites() || []) : []) {
    if (!flightDataList.some(x => x.flightDataId === fd.flightDataId)) flightDataList.push(fd);
  }

  // ── the result and the one Undo entry on this Board (§8) ──
  const subject = ctx.state.strips.get(plan.meta.stripId) || null;
  const voided = plan.voided.map(v => ({ ...v, summary: _summary(env, v, subject || subjectBefore) }));
  const others = own.records.filter(r => r.stripId !== plan.meta.stripId);
  if (subject && subjectImage) {
    ctx.audit.recordAudit(
      { clientMutationId, op: { kind: 'Undo' } }, actingPositionId, by, subjectBefore,
      { ok: true, strip: subject },
      { tail: { undoneActionId: plan.actionId, undoneOp: plan.meta.op, records: others, voided: plan.voided, compensators } },
    );
  }

  // H100 Q-U2 (b): one panel message per voided Position (never the undoer's own), after the Board event.
  const byPosition = new Map();
  for (const v of voided) {
    if (!v.actingPositionId || v.actingPositionId === actingPositionId) continue;
    const list = byPosition.get(v.actingPositionId) || [];
    list.push({ op: v.op, positionId: v.actingPositionId, at: v.at, summary: v.summary });
    byPosition.set(v.actingPositionId, list);
  }
  const undoVoided = [...byPosition].map(([positionId, list]) => ({
    facilityId, positionId,
    message: {
      actionId: plan.actionId, stripId: plan.meta.stripId, undoneOp: plan.meta.op, undoneLabel: plan.meta.label || plan.meta.op,
      undoneBy: actingPositionId, at: ctx.clock.now(), voided: list,
    },
  }));

  return {
    ok: true,
    strip: subject,
    // `transfer`: the undone action had moved the Strip to another Position (metrics' undoneTransfers, §9).
    undone: {
      actionId: plan.actionId, op: plan.meta.op, label: plan.meta.label || plan.meta.op,
      transfer: !!(subjectImage && subjectBefore && subjectImage.strip.ownerPositionId !== subjectBefore.ownerPositionId),
    },
    voided,
    warning,
    flightDataList: flightDataList.length ? flightDataList : undefined,
    gone: own.gone.length ? own.gone : undefined,
    peerFacilityId: peerFacilityId && (peerStrip || peerGone) ? peerFacilityId : undefined,
    peerStrip: peerStrip || undefined,
    marsaChanged: marsaChanged.length ? marsaChanged : undefined,
    carrierChanged,
    undoVoided: undoVoided.length ? undoVoided : undefined,
  };
}

module.exports = {
  kind: 'Undo',
  undo: 'none', // docs/adr/0100 §1: no redo
  apply: (ctx, strip, op, meta) => _applyUndo(ctx, meta),
  controlInvariantRefusal: _controlInvariantRefusal, // for tests (U23)
};
