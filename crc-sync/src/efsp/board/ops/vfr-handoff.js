'use strict';

// VfrHandoff (docs/adr/0146, H175 VR-Q2): a VFR strip moves between controllers by the STARS automated handoff, never a
// release. JO 7110.65BB para 5-4-5 (transferring controller): initiate the handoff before the aircraft enters the
// receiver's airspace; para 5-4-6 (receiving controller): accept it; then the transferring controller changes the
// pilot's frequency (para 5-4-5 h; flight following ¶7-6-1: advisories, no separation responsibility to hand over, H174
// "only the comms are handed over"). The frequency change is the controller's, said on the radio; the tool records only
// who holds the strip.
//
//   INITIATE  the holder names a Position (`toPositionId`) of this Facility, or of another one (`toFacilityId`, docs/adr/0162):
//             `strip.vfrHandoff` records it. Any Position with a Bay for a VFR strip, at any time (no lifecycle step
//             gates it). The strip stays the holder's.
//             When the sending controller also holds the receiver (Primary there, or Primary at the Position covering
//             it: self-held.js), nobody else could answer: INITIATE accepts at once, recorded `autoAccepted` and
//             `selfCoordinated` (guide §4.8.3 rule 4: the audit keeps the boundary event). A receiver whose VFR Bay is
//             full leaves the handoff open, with a warning.
//   ACCEPT    the named Position takes it (permission.js `mayActBesideOwner`): the strip becomes its strip, in its VFR
//             Bay (placement.js `vfrBayFor`), and the pending handoff is gone. Across Facilities the receiver sends it
//             to its OWN Board with no Strip (`fromFacilityId`, `fromStripId`: the wire binds a session to the Facility
//             it acts at): its Board mints the strip and the sender's ends (board/vfr-transfer.js).
//   RECALL    the holder takes an unanswered handoff back (STARS's "recall").
//
// Who holds a VFR strip is always `strip.ownerPositionId`: before ACCEPT the transferring Position, after it the
// receiver. `vfrHandoff` only says who has been asked (the follow-up lane U-CA-OWNER reads the holder).
//
// None is undone (docs/adr/0100 §1): INITIATE has RECALL, ACCEPT is the receiver's answer and the holder can hand it back.

const { heldByController } = require('../../self-held');
const { deepClone } = require('../strip-util');
const { warn } = require('../../warnings');

const ACTIONS = ['INITIATE', 'ACCEPT', 'RECALL'];

function _isAcceptAcross(op) { return !!op && op.action === 'ACCEPT' && op.fromFacilityId != null && op.fromFacilityId !== ''; }

function _refuse(strip, reason, detail) { return { ok: false, reason, detail, strip }; }

/** Where the receiver keeps the strip, or a refusal: its VFR Bay, with room. */
function _landing(ctx, strip, positionId) {
  const bay = ctx.placement.vfrBayFor(positionId);
  if (!bay) return { refusal: _refuse(strip, 'VALIDATION_ERROR', `${positionId} has no Bay to keep a VFR strip in`) };
  const full = ctx.placement.bayFullRefusal(bay.bayId, strip);
  return full ? { refusal: _refuse(strip, full.reason, full.detail) } : { bay };
}

/** The strip becomes `positionId`'s, in `bay`; no handoff is open any more. */
function _land(ctx, strip, positionId, bay) {
  strip.ownerPositionId = positionId;
  delete strip.consolidatedFrom; // a new holder by decision, not by cover (F10)
  strip.vfrHandoff = null;
  strip.bayId = bay.bayId;
  strip.rackId = ctx.placement.placementRack(strip, bay);
  strip.orderKey = ctx.placement.appendOrderKey(bay.bayId, strip.rackId, strip.stripId);
}

function _notAutoAccepted(to, refusal) {
  return warn('NOT_AUTO_ACCEPTED', `you hold ${to}, but the handoff stays open: ${refusal.detail || refusal.reason}`);
}

/**
 * INITIATE to another Facility's Position (docs/adr/0162). Validated against the receiving Board's own rules. When the
 * sending controller also holds the receiver, its Board mints the strip at once and this one ends here (DROPPED, audited
 * as this Mutation, so counted once as this Facility's operation).
 */
function _initiateAcross(ctx, strip, to, toFacilityId, meta) {
  const { by } = meta;
  const peer = ctx.rules.peerBoard(toFacilityId);
  if (!peer) return _refuse(strip, 'VALIDATION_ERROR', `${toFacilityId} is not a Facility`);
  const refusal = peer.vfrHandoffReceiverRefusal(to);
  if (refusal) return _refuse(strip, refusal.reason, refusal.detail);
  const from = strip.ownerPositionId;
  let warnings;
  if (peer.isHeldByController(by, to)) {
    const minted = peer.receiveVfrHandoff({ fromFacilityId: ctx.rules.facilityId, fromStrip: deepClone(strip), toPositionId: to, by, causedBy: meta.clientMutationId || null });
    if (minted.ok) {
      strip.vfrHandoff = null;
      const retired = ctx.retire(strip, by);
      return {
        ok: true, strip, selfCoordinated: true, warnings: retired.warnings,
        peerFacilityId: toFacilityId, peerStrip: minted.strip,
        vfrHandoff: { action: 'INITIATE', from, to, toFacilityId, toStripId: minted.strip.stripId, autoAccepted: true, selfCoordinated: true },
      };
    }
    warnings = [_notAutoAccepted(to, minted)];
  }
  strip.vfrHandoff = { toPositionId: to, toFacilityId, initiatedAt: ctx.clock.now(), initiatedBy: by || null };
  ctx.state.bump(strip, by);
  return { ok: true, strip, warnings, vfrHandoff: { action: 'INITIATE', from, to, toFacilityId } };
}

/**
 * ACCEPT of another Facility's handoff, sent to the receiver's own Board with no Strip (docs/adr/0162): the strip is
 * minted here and the sender's Board ends its own.
 */
function _acceptAcross(ctx, op, meta) {
  const { by, actingPositionId } = meta;
  const fromFacilityId = String(op.fromFacilityId);
  const fromStripId = op.fromStripId == null ? '' : String(op.fromStripId);
  const peer = fromFacilityId === ctx.rules.facilityId ? null : ctx.rules.peerBoard(fromFacilityId);
  if (!peer) return _refuse(null, 'VALIDATION_ERROR', `${fromFacilityId} is not another Facility`);
  const src = fromStripId ? peer.getStrip(fromStripId) : null;
  if (!src || src.stripType !== 'VFR' || src.state === 'DROPPED') return _refuse(null, 'NOT_FOUND', 'that VFR strip is gone');
  const pending = src.vfrHandoff;
  if (!pending || pending.toFacilityId !== ctx.rules.facilityId) return _refuse(null, 'VALIDATION_ERROR', 'no handoff to this Facility is open on that strip');
  if (pending.toPositionId !== actingPositionId) return _refuse(null, 'PERMISSION_DENIED', `the handoff is to ${pending.toPositionId}`);
  const minted = ctx.vfrTransfer.mint({ fromStrip: deepClone(src), toPositionId: actingPositionId, by });
  if (!minted.ok) return _refuse(null, minted.reason, minted.detail);
  const from = src.ownerPositionId;
  const released = peer.releaseVfrHandoff({
    stripId: src.stripId, toFacilityId: ctx.rules.facilityId, toPositionId: actingPositionId, toStripId: minted.strip.stripId,
    by, causedBy: meta.clientMutationId || null,
  });
  if (!released.ok) {
    ctx.state.remove(minted.strip.stripId);
    return _refuse(null, released.reason, released.detail);
  }
  return {
    ok: true, strip: minted.strip, peerFacilityId: fromFacilityId, peerStrip: released.strip,
    vfrHandoff: { action: 'ACCEPT', from, fromFacilityId, fromStripId: src.stripId, to: actingPositionId },
  };
}

function _applyVfrHandoff(ctx, strip, op, meta) {
  const { by, actingPositionId } = meta;
  if (!ACTIONS.includes(op.action)) return _refuse(strip, 'VALIDATION_ERROR', `action must be one of ${ACTIONS.join(', ')}`);
  if (strip.stripType !== 'VFR') return _refuse(strip, 'VALIDATION_ERROR', 'only a VFR strip is handed off this way');
  if (strip.state === 'DROPPED') return _refuse(strip, 'VALIDATION_ERROR', 'this strip is dropped');
  const pending = strip.vfrHandoff || null;
  const now = ctx.clock.now();

  if (op.action === 'INITIATE') {
    const to = op.toPositionId == null ? '' : String(op.toPositionId);
    if (!to) return _refuse(strip, 'VALIDATION_ERROR', 'name the Position to hand off to');
    if (pending) return _refuse(strip, 'VALIDATION_ERROR', `a handoff to ${pending.toPositionId} is open; recall it first`);
    const toFacilityId = op.toFacilityId == null || op.toFacilityId === '' ? ctx.rules.facilityId : String(op.toFacilityId);
    if (toFacilityId !== ctx.rules.facilityId) return _initiateAcross(ctx, strip, to, toFacilityId, meta);
    if (to === strip.ownerPositionId) return _refuse(strip, 'VALIDATION_ERROR', `${to} already holds this strip`);
    const refusal = ctx.vfrTransfer.receiverRefusal(to);
    if (refusal) return _refuse(strip, refusal.reason, refusal.detail);
    const from = strip.ownerPositionId;
    if (heldByController(ctx.rules, by, to)) {
      const landing = _landing(ctx, strip, to);
      if (!landing.refusal) {
        _land(ctx, strip, to, landing.bay);
        ctx.state.bump(strip, by);
        return { ok: true, strip, selfCoordinated: true, vfrHandoff: { action: 'INITIATE', from, to, autoAccepted: true, selfCoordinated: true } };
      }
      strip.vfrHandoff = { toPositionId: to, initiatedAt: now, initiatedBy: by || null };
      ctx.state.bump(strip, by);
      return { ok: true, strip, warnings: [_notAutoAccepted(to, landing.refusal)], vfrHandoff: { action: 'INITIATE', from, to } };
    }
    strip.vfrHandoff = { toPositionId: to, initiatedAt: now, initiatedBy: by || null };
    ctx.state.bump(strip, by);
    return { ok: true, strip, vfrHandoff: { action: 'INITIATE', from, to } };
  }

  if (!pending) return _refuse(strip, 'VALIDATION_ERROR', 'no handoff is open on this strip');

  if (op.action === 'RECALL') {
    if (actingPositionId !== strip.ownerPositionId) return _refuse(strip, 'NOT_OWNER', `${strip.ownerPositionId} holds this strip`);
    strip.vfrHandoff = null;
    ctx.state.bump(strip, by);
    return { ok: true, strip, vfrHandoff: { action: 'RECALL', from: strip.ownerPositionId, to: pending.toPositionId } };
  }

  // ACCEPT: by the Position named, or whoever is consolidated over it (it acts as that Position).
  if (pending.toFacilityId && pending.toFacilityId !== ctx.rules.facilityId) {
    return _refuse(strip, 'PERMISSION_DENIED', `the handoff is to ${pending.toFacilityId}'s ${pending.toPositionId}: accept it there`);
  }
  if (actingPositionId !== pending.toPositionId) return _refuse(strip, 'PERMISSION_DENIED', `the handoff is to ${pending.toPositionId}`);
  const landing = _landing(ctx, strip, actingPositionId);
  if (landing.refusal) return landing.refusal;
  const from = strip.ownerPositionId;
  _land(ctx, strip, actingPositionId, landing.bay);
  ctx.state.bump(strip, by);
  return { ok: true, strip, vfrHandoff: { action: 'ACCEPT', from, to: actingPositionId } };
}

module.exports = {
  kind: 'VfrHandoff',
  undo: 'none',
  // The receiver answers a strip it does not hold: the owner gate's one exception for this op (permission.js).
  auditFields: (ctx, result) => ({ tail: { vfrHandoff: result.vfrHandoff } }),
  // An ACCEPT from another Facility names the sender's strip and runs on the receiver's Board with no Strip (board/strip-ops.js).
  stripless: (op) => _isAcceptAcross(op),
  apply: (ctx, strip, op, meta) => (strip == null && _isAcceptAcross(op) ? _acceptAcross(ctx, op, meta) : _applyVfrHandoff(ctx, strip, op, meta)),
};
