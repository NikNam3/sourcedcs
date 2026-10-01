'use strict';

function _applyTransferStrip(ctx, strip, op, by) {
  const bayCheck = ctx.placement.requireKnownBay(op.bayId, strip);
  if (bayCheck) return bayCheck;
  // H2 / H40 (docs/adr/0080): a working Position with a hand-back row may
  // transfer a line only to the Positions the capability table names. The
  // acting Position is the owner (_dispatch verified it).
  const handBack = ctx.rules.handBackTargetsFor ? ctx.rules.handBackTargetsFor(strip.ownerPositionId) : null;
  if (handBack && !handBack.includes(op.toPositionId)) {
    return {
      ok: false, reason: 'PERMISSION_DENIED', strip,
      detail: `${strip.ownerPositionId} may only hand a line back to ${handBack.join(' or ')}`,
    };
  }
  // B4: the Bay is one of the RECEIVING Position's, or the Strip's owner and
  // its Bay disagree and it drops off both Positions' panels.
  if (ctx.rules.baysFor) {
    const own = ctx.rules.baysFor(op.toPositionId);
    if (!own.some(b => b.bayId === op.bayId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${op.bayId} is not a Bay of ${op.toPositionId}`, strip };
    }
  }
  // Same check _applyMoveStrip uses (§3.5 rule 4) — a Transfer landing in
  // a Bay configured with an implied EfspState is validated EXACTLY like
  // pressing that NLA button would be, before anything else about this
  // Mutation is applied. This is what stops a single controller
  // self-coordinating two Positions (guide §4.8.3) — or two separate
  // controllers, the gap isn't specific to self-coordination — from
  // dragging a Strip straight past every doctrine check NLA enforces
  // (e.g. PROPOSED directly into a CLEARED Bay with no flight plan and
  // no beacon code at all). Validated before the owner/occupancy checks
  // below too, so a rejected transfer never partially mutates the Strip.
  const check = ctx.placement.validateBayImpliedTransition(strip, op.bayId, op.rackId);
  if (!check.ok) return { ok: false, reason: check.reason, detail: check.detail, strip };
  const full = ctx.placement.bayFullRefusal(op.bayId, strip);
  if (full) return { ok: false, reason: full.reason, detail: full.detail, strip };

  let destPositionId = op.toPositionId;
  let routedTo = null;
  let warning;

  if (!ctx.rules.isOccupied(op.toPositionId)) {
    const covering = ctx.rules.coveringPositionFor(op.toPositionId);
    if (!covering || !ctx.rules.isOccupied(covering)) {
      return { ok: false, reason: 'NO_RECEIVING_POSITION', strip };
    }
    destPositionId = covering;
    routedTo = covering;
  }

  // Self-coordination (guide §4.8.3): when the same controller who is
  // sending the Strip also holds Primary on the destination Position,
  // the two-party dialogue collapses — but the transfer itself is still
  // the ONE input that applies it (rule 3), and the event MUST be
  // recorded distinctly (rule 4) so an after-action review can tell it
  // apart from a genuine two-party handoff. Phase 1 has no separation-
  // regime/radar-service state to also flip (that's WP4A/WP9 territory,
  // not yet built) — this tag is the Phase-1 analogue: the audit log
  // never silently collapses the boundary event away (defect D20).
  const selfCoordinated = ctx.rules.isSelfCoordinated
    ? ctx.rules.isSelfCoordinated(by, destPositionId)
    : false;

  strip.ownerPositionId = destPositionId;
  delete strip.coveredFrom; // it has a new owner by decision, not by cover (F10)
  if (check.impliedState && check.impliedState !== strip.state) strip.state = check.impliedState;
  const routedBay = routedTo ? ctx.placement.bayForNewOwner(destPositionId, strip.state, strip) : null;
  if (routedBay) {
    // B3: routed to the covering Position, so the line lands in ITS Bay, not
    // the absent Position's (which no panel of the covering one builds).
    strip.bayId = routedBay.bayId;
    strip.rackId = routedBay.rackId;
    strip.orderKey = ctx.placement.appendOrderKey(strip.bayId, strip.rackId, strip.stripId);
  } else {
    strip.bayId = op.bayId;
    strip.rackId = op.rackId;
    strip.orderKey = ctx.placement.resolveOrderKey(op.bayId, op.rackId, op.afterStripId || null, op.beforeStripId || null, strip.stripId);
    if (routedTo) warning = `${routedTo} has no Bay for this Strip; it stays in ${op.bayId}`;
  }

  const sfaFdr = routedBay ? null : ctx.assignSfaFrequency(strip, by);

  ctx.state.bump(strip, by);
  // A pending Undo window (§3.5 rule 5) is for reverting a STATE change —
  // once ownership has also moved, "revert the state" no longer means
  // what it did when it was recorded (the Strip may now be under a
  // different Position's Bay/lifecycle entirely). Drop it rather than
  // let a stale Undo fire against a Strip that's since changed hands,
  // regardless of whether this transfer came from a drag or an NLA-
  // driven transfer-shaped transition (board-store.js's own _applyInvokeNla).
  ctx.nlaHistory.delete(strip.stripId);
  return { ok: true, strip, routedTo, selfCoordinated, warning, fdr: sfaFdr ? sfaFdr.fdr : undefined };
}

module.exports = {
  kind: 'TransferStrip',
  apply: (ctx, strip, op, meta) => _applyTransferStrip(ctx, strip, op, meta.by),
};
