'use strict';

const { CARRIER_TRANSFER_EFFECTS } = require('../../carrier/transfer-effects'); // pure (docs/adr/0074)

/**
 * The carrier's four hand-overs, as one operation (docs/adr/0064, 0074; guide
 * §9.12: "MUST NOT be unified behind one button"). Reached by the dedicated
 * CarrierTransfer op and by the NLA button (computeNla's `carrierTransfer`),
 * so there is exactly one implementation of what each does.
 *
 * Each kind carries its own TRIGGER TYPE, recorded on the Strip
 * (`carrierTransfer`) and on the audit line, and rendered distinctly. Every
 * trigger is a controller gesture: "radar contact", "ball" and "see you" are
 * the controller recording what they saw or the pilot said, never a
 * surveillance advance (guide §10.3, D5).
 *
 * Order: validate everything, then the stack effect (the one step that can
 * refuse after validation), then the Strip. Nothing is half applied.
 */
function _applyCarrierTransfer(ctx, strip, kind, toPositionId, by, actingPositionId, clientMutationId) {
  const fx = typeof kind === 'string' && Object.prototype.hasOwnProperty.call(CARRIER_TRANSFER_EFFECTS, kind) ? CARRIER_TRANSFER_EFFECTS[kind] : null;
  if (!fx) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown carrier transfer '${kind}'`, strip };
  const row = ctx.rules.carrierTransfers && ctx.rules.carrierTransfers[kind];
  const label = row ? row.label : kind;
  if (strip.role !== fx.role || strip.state !== fx.state) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `${label} applies to a ${fx.role} Strip in ${fx.state}, not ${strip.role} in ${strip.state}`, strip };
  }
  const blocked = ctx.nlaPrecheck(strip);
  if (blocked) return { ok: false, reason: blocked.reason, detail: blocked.detail, strip };

  let dest = strip.ownerPositionId;
  if (fx.owner === 'TO') {
    dest = toPositionId || fx.defaultTo || (ctx.rules.carrierLaneFor ? ctx.rules.carrierLaneFor(strip) : null);
    if (!dest) return { ok: false, reason: 'NO_RECEIVING_POSITION', detail: 'no receiving Position present', strip };
  }
  const caseValue = ctx.rules.carrierCase ? ctx.rules.carrierCase() : null;
  if (ctx.rules.validateCarrierTransfer) {
    const v = ctx.rules.validateCarrierTransfer(kind, {
      caseValue, fromPositionId: actingPositionId, toPositionId: fx.owner === 'TO' ? dest : (kind === 'FINAL_TO_LSO' ? null : undefined),
    });
    if (!v.ok) return { ok: false, reason: v.reason || 'VALIDATION_ERROR', detail: v.detail, strip };
  }

  let routedTo = null;
  if (fx.owner === 'TO' && !ctx.rules.isOccupied(dest)) {
    const covering = ctx.rules.coveringPositionFor(dest);
    if (!covering || !ctx.rules.isOccupied(covering)) return { ok: false, reason: 'NO_RECEIVING_POSITION', strip };
    dest = covering;
    routedTo = covering;
  }

  // The stack effect: Commence marks the flight pushed (nobody renumbers, the
  // drift defect D16 names); a hand-over to PriFly removes it leaving a
  // vacancy (H28). A flight that was never in the stack has nothing to remove.
  let carrierChanged = false;
  const effect = row ? row.stackEffect : null;
  if (effect && ctx.rules.carrierApplyEffect) {
    const r = ctx.rules.carrierApplyEffect(effect, strip.fdrId, { by, actingPositionId, clientMutationId });
    if (!r.ok && !(effect === 'REMOVE_NO_CLOSE_UP' && r.reason === 'NOT_FOUND')) {
      return { ok: false, reason: r.reason || 'VALIDATION_ERROR', detail: r.detail, strip };
    }
    carrierChanged = !!(r.ok && r.changed && r.changed.length);
  }

  const now = ctx.clock.now();
  const from = { role: strip.role, state: strip.state, ownerPositionId: strip.ownerPositionId };
  strip.role = fx.toRole;
  strip.state = fx.toState;
  strip.ownerPositionId = dest;
  delete strip.coveredFrom; // a new owner by decision, not by cover (F10)
  let warning;
  if (dest !== from.ownerPositionId) {
    const bay = ctx.placement.bayForNewOwner(dest, strip.state, strip);
    if (bay) {
      strip.bayId = bay.bayId;
      strip.rackId = bay.rackId;
      strip.orderKey = ctx.placement.appendOrderKey(bay.bayId, bay.rackId, strip.stripId);
    } else {
      warning = `${dest} has no Bay for this Strip; it stays in ${strip.bayId}`;
    }
  } else {
    ctx.placement.relocateForImpliedState(strip, strip.state);
  }
  strip.carrierTransfer = {
    kind, trigger: row ? row.trigger : null, label, at: now, by: by || null,
    from: from.ownerPositionId, to: dest, fromRole: from.role, toRole: strip.role,
  };
  strip.rev += 1;
  strip.updatedAt = now;
  strip.updatedBy = by || null;
  ctx.touch(strip.stripId);
  ctx.nlaHistory.delete(strip.stripId);
  return {
    ok: true, strip, routedTo: routedTo || undefined, warning,
    carrierTransfer: { kind, trigger: strip.carrierTransfer.trigger },
    carrierChanged: carrierChanged || undefined,
  };
}

// CarrierTransfer (docs/adr/0074) is not an OP_KINDS grant: which Position
// may record WHICH of the four hand-overs is the model's own `from` list
// (permission.js's canRecordCarrierTransfer), one acting Position and one kind.
// docs/adr/0074 — the carrier's four hand-overs, each its own button with
// its own trigger type recorded (guide §9.12). One implementation: the NLA
// button reaches the same method.
module.exports = {
  kind: 'CarrierTransfer',
  authorize: (ctx, actingPositionId, op) => {
    if (!(ctx.rules.canRecordCarrierTransfer && ctx.rules.canRecordCarrierTransfer(actingPositionId, op.transfer))) {
      return { ok: false, reason: 'PERMISSION_DENIED', detail: `${actingPositionId} may not record ${op.transfer || 'that transfer'}` };
    }
    return null;
  },
  apply: (ctx, strip, op, meta) => _applyCarrierTransfer(ctx, strip, op.transfer, op.toPositionId, meta.by, meta.actingPositionId, meta.clientMutationId),
};
