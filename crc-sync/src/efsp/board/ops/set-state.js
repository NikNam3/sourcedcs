'use strict';

const { runwayInhibitFor, RUNWAY_GATED_STATES } = require('../../field-state');

/**
 * SetState is owner-checked (decisions.md S-R2-14, docs/adr/0080, B7). Until
 * now it was ADR 0027's unchecked escape hatch: any Position holding the op
 * and owning the Strip could put it in any state, which let AIC do the very
 * thing H2 says it never does (advance a mission line) and leave the Strip in
 * a Bay that implied another state. The acting Position must own the Strip's
 * CURRENT state per STATE_OWNERS_BY_ROLE — the authority InvokeNla and the
 * Bay-implied drag already apply — for every Role. Checked before the runway
 * inhibit (authority before availability), and ONLY on the controller's
 * SetState: the Undo / NLA paths that reach _applySetState carry their own.
 */
function _setStateOwnerRefusal(ctx, strip, toState, actingPositionId) {
  if (!ctx.rules.canActOnState) return null;
  if (ctx.rules.canActOnState(actingPositionId, strip.role, strip.state)) return null;
  return {
    ok: false, reason: 'PERMISSION_DENIED', strip,
    detail: `${strip.state} is not ${actingPositionId}'s to change`,
  };
}

/**
 * SetState: owner check, then the runway inhibit, then the write. The one
 * exception to H19's "the Strip waits" is an OBSERVED departure
 * (`op.observedAirborne`, set only by the surveillance chip): the aircraft is
 * already off the ground, so refusing the record would only make the Board
 * wrong. It bypasses the RUNWAY gate alone (never the owner check), only for a
 * DEPARTURE going to DEPARTED, only when the server's own surveillance agrees
 * (`setAirborneObserver`: the client's flag is a claim, never evidence), and
 * the audit line carries `bypass` with the reason. A typed SetState has no
 * flag and is refused as before.
 */
function _applySetStateGated(ctx, strip, op, actingPositionId, by) {
  const owner = _setStateOwnerRefusal(ctx, strip, op.toState, actingPositionId);
  if (owner) return owner;
  let refusal = _setStateRunwayRefusal(ctx, strip, op.toState);
  let bypass = null;
  if (refusal && _observedDeparture(ctx, strip, op)) {
    bypass = { gate: 'RUNWAY_INHIBIT', inhibit: refusal.detail, reason: 'OBSERVED_AIRBORNE' };
    refusal = null;
  }
  if (refusal) return refusal;
  const result = _applySetStateOp(ctx, strip, op.toState, by);
  if (bypass && result.ok) result.bypass = bypass;
  return result;
}

function _observedDeparture(ctx, strip, op) {
  return op.observedAirborne === true && strip.role === 'DEPARTURE' && op.toState === 'DEPARTED'
    && typeof ctx.airborneObserver === 'function' && ctx.airborneObserver(strip) === true;
}

/**
 * SetState honours the runway inhibit (decisions.md S-R2-14, H19): the raw
 * state override may not put a Strip into a runway-using state while its
 * runway is suspended or closed — the Strip waits, whichever path is used.
 * The only runway gate SetState carries; it still bypasses every other NLA
 * gate (who may use SetState at all is L23's).
 */
function _setStateRunwayRefusal(ctx, strip, toState) {
  if (!(RUNWAY_GATED_STATES[strip.role] || []).includes(toState)) return null;
  const bay = ctx.rules.bayForImpliedState ? ctx.rules.bayForImpliedState(strip.ownerPositionId, toState) : null;
  const targetRackId = bay && bay.impliesState === toState ? ctx.placement.placementRack(strip, bay) : undefined;
  const inhibit = runwayInhibitFor(strip, ctx.fdrStore.getFdr(strip.fdrId), ctx.placement.fieldStateView(), { targetRackId });
  return inhibit ? { ok: false, reason: 'NLA_INHIBITED', detail: inhibit, strip } : null;
}

/**
 * The controller's SetState (after the owner and runway checks): the state
 * change, plus a warning when it leaves the Strip in a Bay that implies a
 * different state because its owner has no Bay for the new one (B7's second
 * defect, decisions Q5): nothing moves the Strip, and the ack says so.
 */
function _applySetStateOp(ctx, strip, toState, by) {
  // DROPPED goes through the one retiring path (S-L24): the same open-proposal
  // and active-TOFI guards, the remove indicator, the beacon release and the
  // archive clock, not a bare state write that skips all four.
  if (toState === 'DROPPED') return ctx.run('DropStrip', strip, {}, { by });
  const result = ctx.applySetState(strip, toState, by);
  if (result.ok && ctx.rules.bayImpliesState) {
    const implied = ctx.rules.bayImpliesState(strip.bayId);
    if (implied && implied !== strip.state) {
      result.warning = `no ${strip.ownerPositionId} Bay for ${strip.state}; the Strip stays in ${strip.bayId}`;
    }
  }
  return result;
}

module.exports = {
  kind: 'SetState',
  apply: (ctx, strip, op, meta) => _applySetStateGated(ctx, strip, op, meta.actingPositionId, meta.by),
};
