'use strict';

const { stripScope, retireScope, union, callsignOf } = require('../../undo/scopes');

const { CARRIER_HANDOFF_EFFECTS } = require('../../carrier/handoff-effects'); // pure (docs/adr/0074)
const { warn } = require('../../warnings');

/**
 * The carrier's four handoffs, as one operation (docs/adr/0064, 0074; guide
 * §9.12: "MUST NOT be unified behind one button"). Reached by the dedicated
 * CarrierHandoff op and by the NLA button (computeNla's `carrierHandoff`),
 * so there is exactly one implementation of what each does.
 *
 * Each kind carries its own TRIGGER TYPE, recorded on the Strip
 * (`carrierHandoff`) and on the audit line, and rendered distinctly. Every
 * trigger is a controller gesture: "radar contact", "ball" and "see you" are
 * the controller recording what they saw or the pilot said, never a
 * surveillance advance (guide §10.3, D5).
 *
 * Order: validate everything, then the stack effect (the one step that can
 * refuse after validation), then the Strip. Nothing is half applied.
 */
function _applyCarrierHandoff(ctx, strip, kind, toPositionId, by, actingPositionId, clientMutationId) {
  const fx = typeof kind === 'string' && Object.prototype.hasOwnProperty.call(CARRIER_HANDOFF_EFFECTS, kind) ? CARRIER_HANDOFF_EFFECTS[kind] : null;
  if (!fx) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown carrier transfer '${kind}'`, strip };
  const row = ctx.rules.carrierHandoffs[kind];
  const label = row ? row.label : kind;
  if (strip.stripType !== fx.stripType || strip.state !== fx.state) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `${label} applies to a ${fx.stripType} Strip in ${fx.state}, not ${strip.stripType} in ${strip.state}`, strip };
  }
  const blocked = ctx.nlaPrecheck(strip);
  if (blocked) return { ok: false, reason: blocked.reason, detail: blocked.detail, strip };

  let dest = strip.ownerPositionId;
  if (fx.owner === 'TO') {
    dest = toPositionId || fx.defaultTo || ctx.rules.carrierLaneFor(strip);
    if (!dest) return { ok: false, reason: 'NO_RECEIVING_POSITION', detail: 'no receiving Position present', strip };
  }
  const caseValue = ctx.rules.carrierCase();
  const v = ctx.rules.validateCarrierHandoff(kind, {
    caseValue, fromPositionId: actingPositionId, toPositionId: fx.owner === 'TO' ? dest : (kind === 'FINAL_TO_LSO' ? null : undefined),
  });
  if (!v.ok) return { ok: false, reason: v.reason || 'VALIDATION_ERROR', detail: v.detail, strip };

  let routedTo = null;
  if (fx.owner === 'TO' && !ctx.rules.isStaffed(dest)) {
    const consolidatedAt = ctx.rules.consolidatedAt(dest);
    if (!consolidatedAt || !ctx.rules.isStaffed(consolidatedAt)) return { ok: false, reason: 'NO_RECEIVING_POSITION', strip };
    dest = consolidatedAt;
    routedTo = consolidatedAt;
  }

  // The stack effect: Commence marks the flight pushed (nobody renumbers, the
  // drift defect D16 names); a handoff to PriFly removes it leaving a
  // vacancy (H28). A flight that was never in the stack has nothing to remove.
  let carrierChanged = false;
  const effect = row ? row.stackEffect : null;
  if (effect) {
    const r = ctx.rules.carrierApplyEffect(effect, strip.flightDataId, { by, actingPositionId, clientMutationId });
    if (!r.ok && !(effect === 'REMOVE_NO_CLOSE_UP' && r.reason === 'NOT_FOUND')) {
      return { ok: false, reason: r.reason || 'VALIDATION_ERROR', detail: r.detail, strip };
    }
    carrierChanged = !!(r.ok && r.changed && r.changed.length);
  }

  const now = ctx.clock.now();
  const from = { stripType: strip.stripType, state: strip.state, ownerPositionId: strip.ownerPositionId };
  strip.stripType = fx.toStripType;
  strip.state = fx.toState;
  strip.ownerPositionId = dest;
  delete strip.consolidatedFrom; // a new owner by decision, not by cover (F10)
  let warnings;
  if (dest !== from.ownerPositionId) {
    const bay = ctx.placement.bayForNewOwner(dest, strip.state, strip);
    if (bay) {
      strip.bayId = bay.bayId;
      strip.rackId = bay.rackId;
      strip.orderKey = ctx.placement.appendOrderKey(bay.bayId, bay.rackId, strip.stripId);
    } else {
      warnings = [warn('NO_BAY_FOR_STRIP', `${dest} has no Bay for this Strip; it stays in ${strip.bayId}`)];
    }
  } else {
    ctx.placement.relocateForImpliedState(strip, strip.state);
  }
  strip.carrierHandoff = {
    kind, trigger: row ? row.trigger : null, label, at: now, by: by || null,
    from: from.ownerPositionId, to: dest, fromStripType: from.stripType, toStripType: strip.stripType,
  };
  ctx.state.bump(strip, by, now);
  return {
    ok: true, strip, routedTo: routedTo || undefined, warnings,
    carrierHandoff: { kind, trigger: strip.carrierHandoff.trigger },
    carrierChanged: carrierChanged || undefined,
  };
}

// CarrierHandoff (docs/adr/0074) is not an OP_KINDS grant: which Position
// may record WHICH of the four handoffs is the model's own `from` list
// (permission.js's canRecordCarrierHandoff), one acting Position and one kind.
// docs/adr/0074 — the carrier's four handoffs, each its own button with
// its own trigger type recorded (guide §9.12). One implementation: the NLA
// button reaches the same method.
module.exports = {
  kind: 'CarrierHandoff',
  // docs/adr/0100 (H95): the handoff and its stack effect (Commence's push mark, PriFly's removal).
  undo: {
    label: (op, strip, ctx) => `${(ctx.rules.carrierHandoffs[op.transfer] || {}).label || op.transfer} ${callsignOf(ctx, strip)}`,
    scope: (ctx, strip) => union(stripScope(ctx, strip), { carrier: [{ flightDataId: strip.flightDataId }] }),
  },
  authorize: (ctx, actingPositionId, op) => {
    if (!(ctx.rules.canRecordCarrierHandoff(actingPositionId, op.transfer))) {
      return { ok: false, reason: 'PERMISSION_DENIED', detail: `${actingPositionId} may not record ${op.transfer || 'that transfer'}` };
    }
    return null;
  },
  auditFields: (ctx, result) => ({ tail: {
    // The carrier handoff kind and its trigger type (guide §9.12: "four
    // different trigger types"), so an after-action review can tell them apart.
    carrierHandoff: result.carrierHandoff ? result.carrierHandoff.kind : undefined,
    carrierTrigger: result.carrierHandoff ? result.carrierHandoff.trigger : undefined,
  } }),
  apply: (ctx, strip, op, meta) => _applyCarrierHandoff(ctx, strip, op.transfer, op.toPositionId, meta.by, meta.actingPositionId, meta.clientMutationId),
};
