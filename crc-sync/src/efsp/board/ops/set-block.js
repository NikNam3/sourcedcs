'use strict';

const { MAX_FREE_TEXT } = require('../../flight-data-store');
const { _frequencyFromBlockValue } = require('../strip-util');

function _applySetBlock(ctx, strip, op, by, actingPositionId, clientMutationId) {
  const target = ctx.rules.resolveBlockTarget(op.blockId, strip.role);
  if (!target) return { ok: false, reason: 'VALIDATION_ERROR', strip };

  // WP6 (docs/adr/0051) — while an ACTIVE MARSA relation holds this flight,
  // the relation owns its separation regime and a direct Block write to it is
  // refused.
  //
  // Two answers to "who is separating these aircraft" is the defect class
  // this subsystem exists to prevent, and §4.8.3 names the exact failure: "if
  // a second controller takes TAC_C2 ten minutes later, the state must
  // already be correct, or they inherit a lie." marsa-store.js writes the
  // regime on declare and writes it back on end/void; letting SREG be edited
  // underneath that would let the FDR and the relation disagree with nothing
  // saying which was right.
  //
  // Refused rather than silently overridden, and the reason names the way
  // out: End or Void the relation, which sets the regime back to ATC as part
  // of doing so. That IS the action the controller wanted.
  if (target.kind === 'tofi' && target.field === 'separationRegime') {
    const active = ctx.rules.activeMarsaFor(strip.fdrId);
    if (active) {
      return {
        ok: false, reason: 'VALIDATION_ERROR',
        detail: `this flight is in an active MARSA relation declared by ${active.declaringCallsign} — end or void it to hand separation back to ATC`,
        strip,
      };
    }
  }
  // §8.1 — a Facility that hides a Block hides it for writes too, not just
  // for rendering. Enforced here because this is the only path a Block
  // value reaches an FDR or an annotation by.
  if (!ctx.rules.isBlockVisible(strip.role, op.blockId)) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `Block ${op.blockId} is not visible for ${strip.role} at this Facility`, strip };
  }

  if (target.kind === 'fdr' || target.kind === 'airspace-owner' || target.kind === 'tofi' || target.kind === 'frequency' || target.kind === 'military') {
    const fdrResult = target.kind === 'airspace-owner'
      ? ctx.fdrStore.setAirspaceOwner(strip.fdrId, op.value, { by })
      : target.kind === 'frequency'
        ? ctx.fdrStore.setWorkingFrequency(strip.fdrId, _frequencyFromBlockValue(op.value), { by })
        : target.kind === 'tofi'
          ? ctx.fdrStore.setTofi(strip.fdrId, { [target.field]: op.value }, { by })
          // WP6 (docs/adr/0052), guide §6.4 — the military extension
          // namespace, routed exactly like 'tofi' above.
          : target.kind === 'military'
            ? ctx.fdrStore.setMilitary(strip.fdrId, { [target.field]: op.value }, { by })
            : target.path === 'identity.beaconAssigned'
              ? ctx.fdrStore.setBeaconAssigned(strip.fdrId, op.value, { by })
              : ctx.fdrStore.setField(strip.fdrId, target.path, op.value, { by });
    if (!fdrResult.ok) return { ok: false, reason: fdrResult.reason, detail: fdrResult.detail, strip };

    // FDR keeps its own independent rev (guide §3.1); the Strip's rev is
    // also bumped here as a deliberate Phase-1 simplification so the
    // ack/broadcast cycle has one consistent rev to key off per Strip,
    // rather than building a fully separate FDR-level optimistic-
    // concurrency protocol on the wire. See the implementation plan.
    ctx.state.bump(strip, by);
    const marsaVoided = ctx.marsaVoidFor(strip, op, by, actingPositionId, clientMutationId);
    return {
      ok: true, strip, fdr: fdrResult.fdr, warning: fdrResult.warning,
      marsaVoided, fdrs: marsaVoided ? ctx.drainMarsaRegimeWrites() : undefined,
    };
  }

  // docs/adr/0074 — a flight's own carrier fields, written to the FDR
  // (`fdr.military.carrier`) so they survive from the launch Strip to the
  // recovery Strip. A `carrier-derived` Block never reaches here: its target
  // resolves to null above, so SetBlock on CASE, DME, ANGELS, EAT/PUSH or the
  // expected final bearing is a VALIDATION_ERROR (WP7A bullets 2 and 5).
  if (target.kind === 'carrier') {
    const fdrResult = ctx.fdrStore.setCarrier(strip.fdrId, target.field, op.value, { by });
    if (!fdrResult.ok) return { ok: false, reason: fdrResult.reason, detail: fdrResult.detail, strip };
    ctx.state.bump(strip, by);
    return { ok: true, strip, fdr: fdrResult.fdr };
  }

  // docs/adr/0058 — the flight's assigned altitude or heading. On the FDR,
  // not the Strip, so every Facility's copy reads the same value; history
  // and confirmVacated work exactly as they do for a Strip annotation.
  if (target.kind === 'clearance') {
    const fdrResult = ctx.fdrStore.setClearance(strip.fdrId, target.field,
      { value: op.value, confirmVacated: !!op.confirmVacated }, { by });
    if (!fdrResult.ok) return { ok: false, reason: fdrResult.reason, detail: fdrResult.detail, strip };
    ctx.state.bump(strip, by);
    const marsaVoided = ctx.marsaVoidFor(strip, op, by, actingPositionId, clientMutationId);
    return {
      ok: true, strip, fdr: fdrResult.fdr,
      marsaVoided, fdrs: marsaVoided ? ctx.drainMarsaRegimeWrites() : undefined,
    };
  }

  const result = _applyAnnotationSet(ctx, strip, op.blockId, op.value, op.confirmVacated, by);
  // Every Block the interlock tags is annotation-routed today (DEPARTURE's
  // 20/21, ARRIVAL's 7 and 9A-VECTOR, OVERFLIGHT's 7A and 9A-VECTOR), so in
  // practice this is the branch that fires — but the check sits on both paths
  // because which routing a Block uses is a Block Map decision that can
  // change, and an interlock that silently stops covering a Block when its
  // target kind changes is the failure mode docs/adr/0041 is about.
  if (result.ok) {
    result.marsaVoided = ctx.marsaVoidFor(strip, op, by, actingPositionId, clientMutationId);
    if (result.marsaVoided) result.fdrs = ctx.drainMarsaRegimeWrites();
  }
  return result;
}

/**
 * Append-only annotation supersession (guide §3.7). A normal amendment
 * always marks the prior entry SUPERSEDED, never STRUCK — a vacated
 * altitude MUST NOT be struck automatically on assignment (rule 3).
 * confirmVacated is a distinct action: it marks the currently ACTIVE
 * entry STRUCK, with no new value (the controller confirming the
 * aircraft has actually left, not amending to something new).
 */
function _applyAnnotationSet(ctx, strip, blockId, value, confirmVacated, by) {
  // Same ceiling the FDR's free-text fields get, for the same reason: an
  // annotation rides in every broadcast of this Strip and is append-only,
  // so an oversized one is permanent as well as repeated.
  if (typeof value === 'string' && value.length > MAX_FREE_TEXT) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `an annotation is limited to ${MAX_FREE_TEXT} characters`, strip };
  }
  const cell = strip.annotations[blockId] || (strip.annotations[blockId] = { blockId, entries: [] });
  const active = cell.entries.find(e => e.status === 'ACTIVE');

  if (confirmVacated) {
    if (!active) return { ok: false, reason: 'VALIDATION_ERROR', strip };
    active.status = 'STRUCK';
  } else {
    if (active) active.status = 'SUPERSEDED';
    cell.entries.push({ value, status: 'ACTIVE', at: ctx.clock.now(), by: by || null });
  }

  ctx.state.bump(strip, by);
  return { ok: true, strip };
}

module.exports = {
  kind: 'SetBlock',
  // The op kind alone names neither the Block written nor a coordination
  // action (PROPOSE/ACCEPT/REJECT/CANCEL...); the entry says which.
  auditFields: (ctx, result, op) => ({ head: { blockId: op.blockId, value: op.value } }),
  apply: (ctx, strip, op, meta) => _applySetBlock(ctx, strip, op, meta.by, meta.actingPositionId, meta.clientMutationId),
};
