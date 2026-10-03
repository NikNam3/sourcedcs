'use strict';

const { stripScope, retireScope, union, callsignOf } = require('../../undo/scopes');

/** What the NLA would do now (the state table), or null when it has none or is inhibited: the undo scope's route. */
/** The double-tap guard's default length, ms (§3.5 rule 3). */
const NLA_GUARD_MS = 400;

function _route(ctx, strip) {
  const flightData = ctx.flightDataStore.getFlightData(strip.flightDataId);
  const r = ctx.rules.computeNla(strip, flightData, ctx.clock.now(), ctx.placement.nlaCtx());
  return r && !r.inhibited ? r : null;
}

function _applyInvokeNla(ctx, strip, by) {
  // Two clocks, deliberately. The latch (400ms double tap) is how
  // long a person's finger took, in real time; the NLA gate is a release
  // time or a void deadline, in mission time (docs/adr/0079).
  const wallNow = ctx.wallClock.now();
  const now = ctx.clock.now();
  const lastInvoke = ctx.nlaHistory.get(strip.stripId);
  if (lastInvoke && wallNow - lastInvoke.invokedAt < ctx.nlaGuardMs) {
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

  // The double-tap latch (§3.5 rule 3). Undo is no longer here: every NLA, whatever it routes to, is undone through
  // the one undo history (docs/adr/0100, superseding ADR 0009's state-only Undo).
  if (applied.ok && !result.transferTo) ctx.nlaHistory.set(strip.stripId, { invokedAt: wallNow });
  return applied;
}

module.exports = {
  NLA_GUARD_MS,
  kind: 'InvokeNla',
  // docs/adr/0100: as the op the NLA routes to (state-only, transfer-shaped, terminal Drop, carrier handoff).
  undo: {
    label: (op, strip, ctx) => {
      const route = _route(ctx, strip);
      const cs = callsignOf(ctx, strip);
      if (!route) return `NLA ${cs}`;
      if (route.carrierHandoff) return `${(ctx.rules.carrierHandoffs[route.carrierHandoff] || {}).label || route.carrierHandoff} ${cs}`;
      if (route.transferTo) return `Hand off ${cs} → ${route.transferTo}`;
      if (route.toState === 'DROPPED') return `Drop ${cs}`;
      return `${cs} → ${route.toState}`;
    },
    scope: (ctx, strip) => {
      const route = _route(ctx, strip);
      if (route && route.toState === 'DROPPED' && !route.transferTo && !route.carrierHandoff) return retireScope(ctx, strip);
      if (route && route.carrierHandoff) return union(stripScope(ctx, strip), { carrier: [{ flightDataId: strip.flightDataId }] });
      return stripScope(ctx, strip);
    },
  },
  // An NLA press records what the op it ran would: a transfer's selfCoordinated, or a carrier handoff's kind and trigger.
  auditFields: (ctx, result, op) => ({ tail: {
    ...ctx.auditFieldsFor('TransferStrip', result, op).tail,
    ...ctx.auditFieldsFor('CarrierHandoff', result, op).tail,
  } }),
  apply: (ctx, strip, op, meta) => _applyInvokeNla(ctx, strip, meta.by),
};
