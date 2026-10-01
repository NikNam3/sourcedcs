'use strict';

const crypto = require('crypto');
const { newFlags } = require('../strip-util');

function _applyCreateStrip(ctx, op, actingPositionId, by) {
  // A Strip in a Bay this Facility does not have is invisible on every
  // Board — every read path goes through a Bay — while still holding a
  // beacon code. Cheaper to refuse than to hunt for later.
  const bayCheck = ctx.placement.requireKnownBay(op.bayId);
  if (bayCheck) return bayCheck;
  const role = op.role || 'DEPARTURE';
  if (ctx.rules.isValidRole && !ctx.rules.isValidRole(role)) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown Strip Role: ${role}` };
  }
  // Role-scoped CreateStrip (OPS/DEPARTURE: guide §4.1 rule 3; APP/ARRIVAL: docs/adr/0008) — a
  // SECOND permission check beyond the coarse canMutate('CreateStrip')
  // gate already applied in _dispatch: OPS may only originate DEPARTURE,
  // APP may only originate ARRIVAL. Checked before touching fdrStore so
  // a denied CreateStrip has no side effects.
  if (ctx.rules.canCreateStripRole && !ctx.rules.canCreateStripRole(actingPositionId, role)) {
    return { ok: false, reason: 'PERMISSION_DENIED' };
  }

  // BIND, rather than originate (docs/adr/0054). `op.fdrId` attaches this
  // new Strip to a flight that already exists instead of minting a fresh
  // FDR — which is how a mission line comes to be the SAME flight as the
  // ATC Strip, at tasking time, long before any TOFI.
  //
  // A field on this op rather than an op of its own: every gate above
  // (known Bay, valid Role, canCreateStripRole) and everything below
  // (cid, orderKey, the Strip literal) applies identically, and ADR 0023's
  // precedent is that ARRIVAL Strips already originate "both ways" through
  // this one op. It also keeps the reverse direction free — WP7's ATO-first
  // case is this same op with a different Role and acting Position.
  let created;
  if (op.fdrId !== undefined && op.fdrId !== null) {
    if (op.fdr) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'CreateStrip takes either fdr (a new flight) or fdrId (an existing one), not both' };
    }
    const bound = ctx.fdrStore.getFdr(op.fdrId);
    // Same reason code and wording receiveTofiProposal already uses, so
    // both binding paths fail identically.
    if (!bound) return { ok: false, reason: 'NOT_FOUND', detail: 'referenced FDR not found' };

    // Scanned LOCALLY, not through rules.liveStripsForFdr — that one is
    // global and role-blind, and the 5 ATC<->ATC primitives legitimately put
    // same-role Strips for one FDR on two Boards (docs/adr/0013). Within ONE
    // Board, two same-role Strips on one FDR is §3.6's duplicate
    // origination. Role-agnostic rather than MISSION-specific, so the
    // ATO-first direction reuses this unchanged.
    const clash = [...ctx.state.strips.values()].find(
      s => s.fdrId === op.fdrId && s.role === role && s.state !== 'DROPPED');
    if (clash) {
      return {
        ok: false, reason: 'VALIDATION_ERROR',
        detail: `${bound.identity.callsign} already has a live ${role} Strip at ${clash.ownerPositionId}`,
      };
    }
    // No createFdr, so NO BEACON CODE IS MINTED: the mission line shares the
    // flight's Mode 3/A, which is guide §9.8's own "bridge field" and the
    // strongest argument for a shared fdrId over copying fields across.
    created = { ok: true, fdr: bound };
    // docs/adr/0074: the recovery Strip binds to the flight whose launch Strip
    // was dropped, and that drop released the flight's squawk once no Strip
    // referenced it. Re-claim it, or the next CreateStrip is handed a code a
    // live aircraft is squawking (D23: reacquireFdr never steals a code another
    // flight took in the meantime, and is a no-op for a flight still holding it).
    if (ctx.fdrStore.reacquireFdr) ctx.fdrStore.reacquireFdr(op.fdrId);
  } else {
    created = ctx.fdrStore.createFdr(op.fdr, { by });
  }
  if (!created.ok) return { ok: false, reason: created.reason, detail: created.detail };

  const stripId = crypto.randomUUID();
  const rackStrips = ctx.state.rack(op.bayId, op.rackId);
  const afterStripId = op.afterStripId !== undefined
    ? op.afterStripId
    : (rackStrips.length ? rackStrips[rackStrips.length - 1].stripId : null);
  const orderKey = ctx.placement.resolveOrderKey(op.bayId, op.rackId, afterStripId, op.beforeStripId || null, null);

  const now = ctx.clock.now();
  const strip = {
    stripId,
    cid: ctx.state.nextCid(),
    fdrId: created.fdr.fdrId,
    rev: 1,
    role,
    // docs/adr/0023 bug fix — this used to be a raw `role === 'ARRIVAL' ?
    // 'INBOUND' : 'PROPOSED'` binary, which silently gave a new
    // OVERFLIGHT Strip the invalid state 'PROPOSED' (a DEPARTURE-only
    // state, not even in OVERFLIGHT_STATE_SET) since no caller passes
    // op.initialState explicitly. A small per-role table, not a wider
    // rules-injection — board-store.js only ever needs each role's own
    // starting state, never the full STATES_BY_ROLE list nla.js owns.
    state: op.initialState || ctx.initialStateFor(role) || 'PROPOSED',
    ownerPositionId: actingPositionId,
    bayId: op.bayId,
    rackId: op.rackId,
    orderKey,
    annotations: {},
    flags: newFlags(),
    // No `correlation` field. The inert `{ state: 'UNCORRELATED' }` hook that
    // used to sit here was keyed wrongly: one FDR legitimately has several
    // Strips (per-Facility replicas, docs/adr/0013; a TOFI MISSION Strip;
    // ConvertToArrival keeping one stripId across a role change), so a
    // per-Strip correlation lets two replicas hold different answers to
    // "which contact is this airframe" — and two answers to an identity
    // question IS the defect class §6.6 exists to prevent. The correlation
    // is keyed by fdrId in correlation-store.js (docs/adr/0045), and the
    // client joins on fdrId to render it.
    coordination: null, // WP4A hook (docs/adr/0015) — set by _applyCoordinationPropose/receiveCoordinationProposal once this Strip is party to a cross-Facility exchange
    tofiCoordination: null, // WP4A second slice hook — set by _applyTofiPropose/receiveTofiProposal once this Strip is party to a TOFI exchange
    airspaceEntry: null, // the RANGE slice — set by _applyApproveAirspaceEntry while this flight is working an airspace
    previousLeg: null,   // set by ConvertToArrival — the departure leg's archived annotations
    createdAt: now, updatedAt: now, updatedBy: by || null,
  };
  ctx.state.insert(strip);
  // docs/adr/0074: a recovery check-in (a MARSHAL Strip in IN_STACK) joins the
  // Marshal stack at the next free slot. The Marshal re-sequences with one
  // Move; a full stack is a warning, not a refusal of the check-in.
  let warning;
  let carrierChanged;
  if (role === 'MARSHAL' && strip.state === 'IN_STACK' && ctx.rules.carrierAppendFlight) {
    const a = ctx.rules.carrierAppendFlight(strip.fdrId, { by, actingPositionId });
    if (a && a.ok === false) warning = `not in the Marshal stack: ${a.detail || a.reason}`;
    else if (a && a.changed && a.changed.length) carrierChanged = true;
  }
  return { ok: true, strip, fdr: created.fdr, warning, carrierChanged };
}

module.exports = {
  kind: 'CreateStrip',
  apply: (ctx, strip, op, meta) => _applyCreateStrip(ctx, op, meta.actingPositionId, meta.by),
};
