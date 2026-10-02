'use strict';

function _applyInvokeNla(ctx, strip, by) {
  // Two clocks, deliberately. The latch (400ms double tap, 30s Undo) is how
  // long a person's finger took, in real time; the NLA gate is a release
  // time or a void deadline, in mission time (docs/adr/0079).
  const wallNow = Date.now();
  const now = ctx.clock.now();
  const lastInvoke = ctx.nlaHistory.get(strip.stripId);
  if (lastInvoke && wallNow - lastInvoke.invokedAt < 400) {
    // Idempotent double-tap guard (§3.5 rule 3): a second press within
    // 400ms is discarded, not queued — the first tap already applied,
    // so from the controller's perspective this is a no-op success, not
    // an error and not a second transition.
    return { ok: true, strip };
  }

  const blocked = ctx.nlaPrecheck(strip);
  if (blocked) return { ok: false, reason: blocked.reason, detail: blocked.detail, strip };

  const flightData = ctx.flightDataStore.getFlightData(strip.flightDataId);
  const result = ctx.rules.computeNla(strip, flightData, now, ctx.placement.nlaCtx());
  if (!result || result.inhibited) {
    return { ok: false, reason: 'NLA_INHIBITED', detail: result ? result.inhibited : 'no NLA for this state', strip };
  }
  const inert = ctx.rejectedReplicaRefusal(strip, result.toState);
  if (inert) return { ok: false, reason: inert.reason, detail: inert.detail, strip };

  // docs/adr/0074: a carrier handoff is one implementation whichever way it
  // is reached. Not the undoable state-only NLA path: it moves the stack.
  if (result.carrierHandoff) {
    return ctx.run('CarrierHandoff', strip, { transfer: result.carrierHandoff, toPositionId: result.transferTo || null }, { by, actingPositionId: strip.ownerPositionId, clientMutationId: null });
  }

  const prevState = strip.state;
  let applied;
  if (result.transferTo) {
    // Transfer-shaped NLA transition (Phase 2's real LC->AP "Hand
    // Off", per docs/adr/0007 superseding the old always-stub DEPARTED
    // case — and ARRIVAL's INBOUND->LC/LANDED->GC steps). Routed
    // through the EXACT SAME atomic board/ops/transfer-strip.js's _applyTransferStrip a controller-
    // initiated drag transfer uses — owner, Bay, Rack and state change
    // together, in one Mutation — not a separate, easier-to-drift path
    // (guide §3.5 rule 4: NLA is an accelerator FOR the same operation,
    // not a shortcut around its checks).
    const targetBay = ctx.rules.bayForImpliedState(result.transferTo, result.toState);
    if (!targetBay) {
      return { ok: false, reason: 'NLA_INHIBITED', detail: `no Bay configured for ${result.transferTo}/${result.toState}`, strip };
    }
    applied = ctx.run('TransferStrip', strip, { toPositionId: result.transferTo, bayId: targetBay.bayId, rackId: ctx.placement.placementRack(strip, targetBay) }, { by });
  } else if (result.toState === 'DROPPED') {
    // Every strip type's terminal NLA is a Drop (DEPARTURE at HANDED_OFF,
    // ARRIVAL at TAXI_IN, OVERFLIGHT at HANDED_OFF, MISSION at RTB), and
    // it has to mean exactly what the explicit DropStrip op means —
    // same guards, same remove indicator, same beacon release. Routed
    // through the one shared path rather than the generic state setter,
    // for the same reason the transfer-shaped branch above reuses
    // board/ops/transfer-strip.js's _applyTransferStrip (§3.5 rule 4: NLA accelerates an operation, it
    // does not route around that operation's checks).
    applied = ctx.retire(strip, by);
  } else {
    applied = ctx.applySetState(strip, result.toState, by);
  }

  // Undo (§3.5 rule 5) stays scoped to state-only NLA transitions in
  // Phase 2 (docs/adr/0009) — a transfer-shaped transition's failure
  // mode is the existing transfer-timeout-revert path (§4.5 rule 5), not
  // this button, and board/ops/transfer-strip.js's _applyTransferStrip already clears any stale entry
  // here regardless of how the transfer happened.
  if (applied.ok && !result.transferTo) {
    ctx.nlaHistory.set(strip.stripId, { invokedAt: wallNow, prevState, expiresAt: wallNow + 30000 });
  }
  return applied;
}

module.exports = {
  kind: 'InvokeNla',
  undo: 'none', // docs/adr/0100: not undoable (yet); UNDO-S step 2 declares the scopes
  // An NLA press records what the op it ran would: a transfer's selfCoordinated, or a carrier handoff's kind and trigger.
  auditFields: (ctx, result, op) => ({ tail: {
    ...ctx.auditFieldsFor('TransferStrip', result, op).tail,
    ...ctx.auditFieldsFor('CarrierHandoff', result, op).tail,
  } }),
  apply: (ctx, strip, op, meta) => _applyInvokeNla(ctx, strip, meta.by),
};
