'use strict';

const { stripScope, retireScope, union, callsignOf } = require('../../undo/scopes');

const { warn } = require('../../warnings');
const { flightCaseOf } = require('../../carrier/strip-types');
const { activeClearanceEntry } = require('../../flight-data-store');

const ASSIGNMENT_FIELDS = Object.freeze(['heading', 'speed', 'altitude']);

/**
 * The carrier's handoffs, as one operation (docs/adr/0156). Reached by the dedicated CarrierHandoff op and by the NLA
 * button (computeNla's `carrierHandoff`), so there is exactly one implementation of what each does; what each does is
 * the row in carrier/handoffs.js. Every trigger is a controller gesture, never a surveillance advance (guide §10.3, D5).
 *
 * Order: validate everything, then the stack effect (the one step that can refuse after validation), then the Strip.
 * Nothing is half applied.
 */
function _applyCarrierHandoff(ctx, strip, kind, toPositionId, by, actingPositionId, clientMutationId) {
  const row = typeof kind === 'string' && Object.prototype.hasOwnProperty.call(ctx.rules.carrierHandoffs, kind) ? ctx.rules.carrierHandoffs[kind] : null;
  if (!row) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown carrier transfer '${kind}'`, strip };
  const label = row.label;
  if (strip.stripType !== row.stripType || !row.states.includes(strip.state)) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `${label} applies to a ${row.stripType} Strip in ${row.states.join(' or ')}, not ${strip.stripType} in ${strip.state}`, strip };
  }
  const blocked = ctx.nlaPrecheck(strip);
  if (blocked) return { ok: false, reason: blocked.reason, detail: blocked.detail, strip };

  const handsOn = row.to !== 'SAME';
  let dest = strip.ownerPositionId;
  if (handsOn) {
    dest = toPositionId || (row.to.length === 1 ? row.to[0] : ctx.rules.carrierLaneFor(strip));
    if (!dest) return { ok: false, reason: 'NO_RECEIVING_POSITION', detail: 'no receiving Position present', strip };
  }
  const v = ctx.rules.validateCarrierHandoff(kind, {
    shipCase: ctx.rules.carrierCase(), flightCase: flightCaseOf(strip, ctx.rules),
    fromPositionId: actingPositionId, toPositionId: handsOn ? dest : undefined,
  });
  if (!v.ok) return { ok: false, reason: v.reason || 'VALIDATION_ERROR', detail: v.detail, strip };

  // docs/adr/0110 §4: a hand-off into an unstaffed Position is delivered there when a staffed one stands offered its hat.
  let warnings;
  if (handsOn && dest !== actingPositionId && !ctx.rules.isStaffed(dest)) {
    const offeredTo = ctx.rules.consolidatedAt(dest);
    if (!offeredTo) return { ok: false, reason: 'NO_RECEIVING_POSITION', strip };
    warnings = [warn('UNSTAFFED_RECEIVER', `${dest} is unstaffed: offered to ${offeredTo}`)];
  }

  // The stack effect: Commence marks the flight pushed (nobody renumbers, the drift defect D16 names); a launch handed to
  // the Marshal joins the stack; Back to stack and Abort take the next free slot.
  let carrierChanged = false;
  if (row.stackEffect) {
    const r = ctx.rules.carrierApplyEffect(row.stackEffect, strip.flightDataId, { by, actingPositionId, clientMutationId });
    if (!r.ok) return { ok: false, reason: r.reason || 'VALIDATION_ERROR', detail: r.detail, strip };
    carrierChanged = !!(r.changed && r.changed.length);
  }
  // A flight back in the stack starts afresh: the heading, speed and altitude it was given on the approach are gone.
  if (row.clearsAssignments) {
    const fd = ctx.flightDataStore.getFlightData(strip.flightDataId);
    for (const field of ASSIGNMENT_FIELDS) {
      const active = fd && activeClearanceEntry(fd, field);
      if (active && active.parsed != null) ctx.flightDataStore.setClearance(strip.flightDataId, field, { value: '' }, { by });
    }
  }

  if (row.assignsCode) {
    const fd = ctx.flightDataStore.getFlightData(strip.flightDataId);
    if (fd && !fd.identity.beaconAssigned) ctx.flightDataStore.assignDiscreteCode(strip.flightDataId, { by });
  }

  const now = ctx.clock.now();
  const from = { stripType: strip.stripType, state: strip.state, ownerPositionId: strip.ownerPositionId };
  // A launch that becomes the recovery keeps its first leg on record, as ConvertToArrival does (traffic-count.js counts it once).
  if (row.toStripType !== strip.stripType) {
    strip.previousLeg = { stripType: strip.stripType, annotations: strip.annotations || {}, convertedAt: now, convertedBy: by || null };
  }
  strip.stripType = row.toStripType;
  strip.state = row.toState;
  strip.ownerPositionId = dest;
  delete strip.consolidatedFrom; // a new owner by decision, not by cover (F10)
  if (dest !== from.ownerPositionId) {
    const bay = ctx.placement.bayForNewOwner(dest, strip.state, strip);
    if (bay) {
      strip.bayId = bay.bayId;
      strip.rackId = bay.rackId;
      strip.orderKey = ctx.placement.appendOrderKey(bay.bayId, bay.rackId, strip.stripId);
    } else {
      warnings = [...(warnings || []), warn('NO_BAY_FOR_STRIP', `${dest} has no Bay for this Strip; it stays in ${strip.bayId}`)];
    }
  } else {
    ctx.placement.relocateForImpliedState(strip, strip.state);
  }
  strip.carrierHandoff = {
    kind, trigger: row.trigger, label, at: now, by: by || null,
    from: from.ownerPositionId, to: dest, fromStripType: from.stripType, toStripType: strip.stripType,
  };
  ctx.state.bump(strip, by, now);
  return {
    ok: true, strip, warnings,
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
