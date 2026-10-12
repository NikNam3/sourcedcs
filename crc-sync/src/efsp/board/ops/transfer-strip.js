'use strict';

const { stripScope, retireScope, union, callsignOf } = require('../../undo/scopes');
const { warn } = require('../../warnings');

function _applyTransferStrip(ctx, strip, op, by) {
  const bayCheck = ctx.placement.requireKnownBay(op.bayId, strip);
  if (bayCheck) return bayCheck;
  // H2 / H40 (docs/adr/0080): a working Position with a hand-back row may
  // transfer a line only to the Positions the capability table names. The
  // acting Position is the owner (`StripOps#dispatch` verified it).
  const handBack = ctx.rules.handBackTargetsFor(strip.ownerPositionId);
  if (handBack && !handBack.includes(op.toPositionId)) {
    return {
      ok: false, reason: 'PERMISSION_DENIED', strip,
      detail: `${strip.ownerPositionId} may only hand a line back to ${handBack.join(' or ')}`,
    };
  }
  // B4: the Bay is one of the RECEIVING Position's, or the Strip's owner and
  // its Bay disagree and it drops off both Positions' panels.
  const own = ctx.rules.baysFor(op.toPositionId);
  if (!own.some(b => b.bayId === op.bayId)) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `${op.bayId} is not a Bay of ${op.toPositionId}`, strip };
  }
  // Same check board/ops/move-strip.js's _applyMoveStrip uses (§3.5 rule 4) — a Transfer landing in
  // a Bay configured with an implied EfspState is validated EXACTLY like
  // pressing that NLA button would be, before anything else about this
  // Mutation is applied. This is what stops a single controller
  // self-coordinating two Positions (guide §4.8.3) — or two separate
  // controllers, the gap isn't specific to self-coordination — from
  // dragging a Strip straight past every lifecycle check NLA enforces
  // (e.g. PROPOSED directly into a CLEARED Bay with no flight plan and
  // no beacon code at all). Validated before the owner/staffing checks
  // below too, so a rejected transfer never partially mutates the Strip.
  // docs/adr/0117: a transfer that changes the strip type, because the receiving Position works the flight on another
  // one (AP's handoff to the final controller, PAR's Landed to GC; par-final.js). Checked as the conversion's own
  // step, in place of the Bay-implied NLA check that would refuse it ("the only valid next state from INBOUND is
  // HANDED_TO_TOWER", the live test's T1).
  const conversion = ctx.rules.conversionFor(strip, op.bayId);
  let check;
  if (conversion) {
    const refused = _conversionRefusal(ctx, strip, conversion);
    if (refused) return { ok: false, reason: refused.reason, detail: refused.detail, strip };
    check = { ok: true, impliedState: conversion.toState };
  } else {
    check = ctx.placement.validateBayImpliedTransition(strip, op.bayId, op.rackId);
  }
  if (!check.ok) return { ok: false, reason: check.reason, detail: check.detail, strip };
  const full = ctx.placement.bayFullRefusal(op.bayId, strip);
  if (full) return { ok: false, reason: full.reason, detail: full.detail, strip };

  let destPositionId = op.toPositionId;
  let routedTo = null;      // TACTICAL only: the hand-back target an unstaffed Position's line is routed to (docs/adr/0110 decision 7)
  let warnings;

  if (!ctx.rules.isStaffed(op.toPositionId)) {
    const handBack = ctx.rules.handBackTo(op.toPositionId);
    if (handBack) {
      destPositionId = handBack;
      routedTo = handBack;
    } else {
      // docs/adr/0110 §4: delivered to the unstaffed Position when a staffed one stands offered its hat (consolidatedAt),
      // and said so; with nobody to offer it to, it is refused as it always was.
      const offeredTo = ctx.rules.consolidatedAt(op.toPositionId);
      if (!offeredTo) return { ok: false, reason: 'NO_RECEIVING_POSITION', strip };
      warnings = [warn('UNSTAFFED_RECEIVER', `${op.toPositionId} is unstaffed: offered to ${offeredTo}`)];
    }
  }

  // Self-coordination (guide §4.8.3): when the same controller who is
  // sending the Strip is also signed on as Primary at the destination Position,
  // the two-party dialogue collapses — but the transfer itself is still
  // the ONE input that applies it (rule 3), and the event MUST be
  // recorded distinctly (rule 4) so an after-action review can tell it
  // apart from a genuine two-party handoff. The transfer flips no separation-
  // regime or radar-service state, so this tag is what keeps the boundary
  // event: the audit log never silently collapses it away (defect D20).
  const selfCoordinated = ctx.rules.isSelfCoordinated(by, destPositionId);

  const from = { ownerPositionId: strip.ownerPositionId, stripType: strip.stripType, bayId: strip.bayId, rackId: strip.rackId };
  strip.ownerPositionId = destPositionId;
  delete strip.consolidatedFrom; // it has a new owner by decision, not by cover (F10)
  if (conversion) strip.stripType = conversion.toStripType;
  if (check.impliedState && check.impliedState !== strip.state) strip.state = check.impliedState;
  if (conversion && conversion.kind === 'PAR_HANDOFF') {
    // What an after-action review reads on the Strip: who handed it to whom, and which SFA frequency the flight was on
    // (the Rack it left, when that is an SFA Rack; the frequency itself is the flight's and never changes here).
    strip.sfaTransfer = {
      kind: conversion.kind, trigger: conversion.trigger, label: conversion.label, at: ctx.clock.now(), by: by || null,
      from: from.ownerPositionId, to: destPositionId, fromStripType: from.stripType, toStripType: strip.stripType,
      frequencyRackId: ctx.rules.sfaFrequencyFor(from.bayId, from.rackId) == null ? null : from.rackId,
    };
  }
  const routedBay = routedTo ? ctx.placement.bayForNewOwner(destPositionId, strip.state, strip) : null;
  if (routedBay) {
    // B3: routed to the Position it is consolidated at, so the line lands in ITS Bay, not
    // the absent Position's (which no panel of the consolidated-at one builds).
    strip.bayId = routedBay.bayId;
    strip.rackId = routedBay.rackId;
    strip.orderKey = ctx.placement.appendOrderKey(strip.bayId, strip.rackId, strip.stripId);
  } else {
    strip.bayId = op.bayId;
    strip.rackId = op.rackId;
    strip.orderKey = ctx.placement.resolveOrderKey(op.bayId, op.rackId, op.afterStripId || null, op.beforeStripId || null, strip.stripId);
    if (routedTo) warnings = [...(warnings || []), warn('NO_BAY_FOR_STRIP', `${routedTo} has no Bay for this Strip; it stays in ${op.bayId}`)];
  }

  const sfaFlightData = routedBay ? null : ctx.assignSfaFrequency(strip, by);

  ctx.state.bump(strip, by);
  return {
    ok: true, strip, routedTo, selfCoordinated, warnings, flightData: sfaFlightData ? sfaFlightData.flightData : undefined,
    conversion: conversion ? conversion.kind : undefined,
  };
}

/**
 * Who may make a conversion (docs/adr/0117): the handoff to the final is the radar approach controller's (the capability
 * table's `handsOffToFinal`), Landed the final controller's (`recordsFinalCalls`); either way the sender must work the
 * Strip's state now (nlaPrecheck: the state owner, no open coordination proposal). Null when allowed.
 */
function _conversionRefusal(ctx, strip, conversion) {
  const owner = strip.ownerPositionId;
  if (conversion.kind === 'PAR_HANDOFF' && !ctx.rules.canHandOffToFinal(owner)) {
    return { reason: 'PERMISSION_DENIED', detail: `${owner} may not hand an arrival to the final controller` };
  }
  if (conversion.kind === 'LANDED' && !ctx.rules.canRecordFinalCall(owner)) {
    return { reason: 'PERMISSION_DENIED', detail: `${owner} does not work the final` };
  }
  const blocked = ctx.nlaPrecheck(strip);
  return blocked ? { reason: blocked.reason, detail: blocked.detail } : null;
}

module.exports = {
  kind: 'TransferStrip',
  // docs/adr/0100: a transfer (drag or menu), the SFA frequency it may assign and the strip-type conversion it may make.
  undo: {
    label: (op, strip, ctx) => `Hand off ${callsignOf(ctx, strip)} → ${op.toPositionId}`,
    scope: (ctx, strip) => stripScope(ctx, strip),
  },
  auditFields: (ctx, result) => ({ tail: {
    // Distinguishes a self-coordinated boundary event from a two-party
    // one (guide §4.8.3 rule 4) — undefined for every op except a
    // successful TransferStrip, where this op computes it.
    selfCoordinated: result.selfCoordinated,
    // docs/adr/0117: the strip-type conversion the transfer made (PAR_HANDOFF, LANDED), undefined otherwise.
    conversion: result.conversion,
  } }),
  apply: (ctx, strip, op, meta) => _applyTransferStrip(ctx, strip, op, meta.by),
};
