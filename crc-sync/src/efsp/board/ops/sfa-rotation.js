'use strict';

/**
 * The SFA_ROTATION transfer (guide §4.7, docs/adr/0075, 0093): an ARRIVAL Strip
 * at INBOUND with APP or SFA becomes a FINAL Strip at ON_FINAL with PAR. The
 * controller moves; the aircraft's frequency does not, and nothing here reads or
 * writes the FDR (D17). The Role changes IN PLACE (same Strip, same FDR, as
 * ConvertToArrival, ADR 0023), the trigger type is recorded on the Strip and the
 * audit line, and the frequency Rack the Strip left is kept on the record so an
 * after-action review sees which frequency the rotation was on.
 *
 * PAR must be manned: there is no covering fallback, because a FINAL Strip at
 * APP would sit in a Bay APP does not have. Refused, with the aircraft staying
 * where it is. PAR's final Bay holds one Strip (§7.10): a second is refused.
 * Nothing is half applied: validate everything, then change the Strip.
 */
function _applySfaRotation(ctx, strip, by, actingPositionId) {
  const fx = ctx.rules.sfaTransfers && ctx.rules.sfaTransfers.SFA_ROTATION;
  if (!fx) return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no SFA rotation in this Facility', strip };
  if (strip.role !== fx.role || strip.state !== fx.state) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `${fx.label} applies to an ${fx.role} Strip in ${fx.state}, not ${strip.role} in ${strip.state}`, strip };
  }
  const blocked = ctx.nlaPrecheck(strip);
  if (blocked) return { ok: false, reason: blocked.reason, detail: blocked.detail, strip };
  const dest = ctx.rules.sfaRotationReceiver ? ctx.rules.sfaRotationReceiver() : null;
  if (!dest) return { ok: false, reason: 'NO_RECEIVING_POSITION', detail: 'this Facility has no Position to rotate onto', strip };
  if (!ctx.rules.isOccupied(dest)) {
    return { ok: false, reason: 'NO_RECEIVING_POSITION', detail: `${dest} is not manned — the aircraft stays with ${strip.ownerPositionId}`, strip };
  }
  const bay = ctx.rules.bayForImpliedState ? ctx.rules.bayForImpliedState(dest, fx.toState) : null;
  if (!bay || bay.impliesState !== fx.toState) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `${dest} has no Bay for ${fx.toState}`, strip };
  }
  const full = ctx.placement.bayFullRefusal(bay.bayId, strip);
  if (full) return { ok: false, reason: full.reason, detail: full.detail, strip };

  const now = ctx.clock.now();
  const from = { role: strip.role, state: strip.state, ownerPositionId: strip.ownerPositionId, bayId: strip.bayId, rackId: strip.rackId };
  strip.role = fx.toRole;
  strip.state = fx.toState;
  strip.ownerPositionId = dest;
  delete strip.coveredFrom; // a new owner by decision, not by cover (F10)
  strip.bayId = bay.bayId;
  strip.rackId = ctx.placement.placementRack(strip, bay);
  strip.orderKey = ctx.placement.appendOrderKey(strip.bayId, strip.rackId, strip.stripId);
  strip.sfaTransfer = {
    kind: 'SFA_ROTATION', trigger: fx.trigger, label: fx.label, at: now, by: by || null,
    from: from.ownerPositionId, to: dest, fromRole: from.role, toRole: strip.role, frequencyRackId: from.rackId,
  };
  strip.rev += 1;
  strip.updatedAt = now;
  strip.updatedBy = by || null;
  ctx.touch(strip.stripId);
  ctx.nlaHistory.delete(strip.stripId);
  return { ok: true, strip, sfaTransfer: { kind: 'SFA_ROTATION', trigger: fx.trigger } };
}

// The SFA_ROTATION transfer (docs/adr/0075, 0093) is not an OP_KINDS grant
// either: permission.js's capability table says which Position may send it.
// docs/adr/0075, 0093 — Single Frequency Approach (guide §4.7): the
// controller rotates, the frequency does not. Same shape as a carrier hand-over.
module.exports = {
  kind: 'SfaRotation',
  authorize: (ctx, actingPositionId) => {
    if (!(ctx.rules.canSendSfaRotationTransfer && ctx.rules.canSendSfaRotationTransfer(actingPositionId))) {
      return { ok: false, reason: 'PERMISSION_DENIED', detail: `${actingPositionId} may not rotate an aircraft onto PAR` };
    }
    return null;
  },
  auditFields: (ctx, result) => ({ tail: {
    // The SFA rotation transfer and its trigger type (guide §4.7).
    sfaTransfer: result.sfaTransfer ? result.sfaTransfer.kind : undefined,
    sfaTrigger: result.sfaTransfer ? result.sfaTransfer.trigger : undefined,
  } }),
  apply: (ctx, strip, op, meta) => _applySfaRotation(ctx, strip, meta.by, meta.actingPositionId),
};
