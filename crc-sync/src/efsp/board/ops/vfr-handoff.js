'use strict';

// VfrHandoff (docs/adr/0146, H175 VR-Q2): a VFR strip moves between controllers by the STARS automated handoff, never a
// release. JO 7110.65BB para 5-4-5 (transferring controller): initiate the handoff before the aircraft enters the
// receiver's airspace; para 5-4-6 (receiving controller): accept it; then the transferring controller changes the
// pilot's frequency (para 5-4-5 h; flight following ¶7-6-1: advisories, no separation responsibility to hand over, H174
// "only the comms are handed over"). The frequency change is the controller's, said on the radio; the tool records only
// who holds the strip.
//
//   INITIATE  the holder names a Position of this Facility (`toPositionId`): `strip.vfrHandoff` records it. Any Position
//             with a Bay for a VFR strip, at any time (no lifecycle step gates it). The strip stays the holder's.
//   ACCEPT    the named Position takes it (permission.js `mayActBesideOwner`): the strip becomes its strip, in its VFR
//             Bay (placement.js `vfrBayFor`), and the pending handoff is gone.
//   RECALL    the holder takes an unanswered handoff back (STARS's "recall").
//
// Who holds a VFR strip is always `strip.ownerPositionId`: before ACCEPT the transferring Position, after it the
// receiver. `vfrHandoff` only says who has been asked (the follow-up lane U-CA-OWNER reads the holder).
//
// None is undone (docs/adr/0100 §1): INITIATE has RECALL, ACCEPT is the receiver's answer and the holder can hand it back.

const ACTIONS = ['INITIATE', 'ACCEPT', 'RECALL'];

function _refuse(strip, reason, detail) { return { ok: false, reason, detail, strip }; }

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
    if (to === strip.ownerPositionId) return _refuse(strip, 'VALIDATION_ERROR', `${to} already holds this strip`);
    if (pending) return _refuse(strip, 'VALIDATION_ERROR', `a handoff to ${pending.toPositionId} is open; recall it first`);
    if (!(ctx.rules.baysFor(to) || []).length) return _refuse(strip, 'VALIDATION_ERROR', `${to} is not a Position of this Facility`);
    if (!ctx.rules.canMutateAction(to, 'VfrHandoff', 'ACCEPT') || !ctx.placement.vfrBayFor(to)) {
      return _refuse(strip, 'VALIDATION_ERROR', `${to} does not work VFR strips`);
    }
    if (!ctx.rules.isStaffed(to) && !ctx.rules.consolidatedAt(to)) return _refuse(strip, 'NO_RECEIVING_POSITION', `${to} is not staffed`);
    strip.vfrHandoff = { toPositionId: to, initiatedAt: now, initiatedBy: by || null };
    ctx.state.bump(strip, by);
    return { ok: true, strip, vfrHandoff: { action: 'INITIATE', from: strip.ownerPositionId, to } };
  }

  if (!pending) return _refuse(strip, 'VALIDATION_ERROR', 'no handoff is open on this strip');

  if (op.action === 'RECALL') {
    if (actingPositionId !== strip.ownerPositionId) return _refuse(strip, 'NOT_OWNER', `${strip.ownerPositionId} holds this strip`);
    strip.vfrHandoff = null;
    ctx.state.bump(strip, by);
    return { ok: true, strip, vfrHandoff: { action: 'RECALL', from: strip.ownerPositionId, to: pending.toPositionId } };
  }

  // ACCEPT: by the Position named, or whoever is consolidated over it (it acts as that Position).
  if (actingPositionId !== pending.toPositionId) return _refuse(strip, 'PERMISSION_DENIED', `the handoff is to ${pending.toPositionId}`);
  const bay = ctx.placement.vfrBayFor(actingPositionId);
  if (!bay) return _refuse(strip, 'VALIDATION_ERROR', `${actingPositionId} has no Bay to keep a VFR strip in`);
  const full = ctx.placement.bayFullRefusal(bay.bayId, strip);
  if (full) return _refuse(strip, full.reason, full.detail);
  const from = strip.ownerPositionId;
  strip.ownerPositionId = actingPositionId;
  delete strip.consolidatedFrom; // a new holder by decision, not by cover (F10)
  strip.vfrHandoff = null;
  strip.bayId = bay.bayId;
  strip.rackId = ctx.placement.placementRack(strip, bay);
  strip.orderKey = ctx.placement.appendOrderKey(bay.bayId, strip.rackId, strip.stripId);
  ctx.state.bump(strip, by);
  return { ok: true, strip, vfrHandoff: { action: 'ACCEPT', from, to: actingPositionId } };
}

module.exports = {
  kind: 'VfrHandoff',
  undo: 'none',
  // The receiver answers a strip it does not hold: the owner gate's one exception for this op (permission.js).
  auditFields: (ctx, result) => ({ tail: { vfrHandoff: result.vfrHandoff } }),
  apply: (ctx, strip, op, meta) => _applyVfrHandoff(ctx, strip, op, meta),
};
