'use strict';

const { MAX_FREE_TEXT } = require('../../flight-data-store');
const { _frequencyFromBlockValue } = require('../strip-util');
const { fromCode } = require('../../warnings');

/**
 * The setTofi patch for a TOFI Block write (docs/adr/0102 for SREG). Before the flight has entered, a non-ATC value
 * replaces the pending regime (a correction of what was picked) and ATC clears it; after entry, or with nothing
 * pending, it writes the effective regime as always (ATC also drops the entry stamp).
 */
function _tofiPatch(ctx, strip, target, op) {
  if (target.field !== 'separationRegime') return { [target.field]: op.value };
  const flightData = ctx.flightDataStore.getFlightData(strip.flightDataId);
  const value = op.value === '' ? null : op.value;
  const none = { pendingSeparationRegime: null, pendingSince: null, pendingFacilityId: null };
  if (flightData && flightData.tofi && flightData.tofi.pendingSeparationRegime) {
    if (value === null) return none;
    if (value === 'ATC') return { separationRegime: 'ATC', ...none };
    return { pendingSeparationRegime: value };
  }
  return value === 'ATC' || value === null ? { separationRegime: value, regimeEffective: null } : { separationRegime: value };
}

function _applySetBlock(ctx, strip, op, by, actingPositionId, clientMutationId) {
  const target = ctx.rules.resolveBlockTarget(op.blockId, strip.stripType);
  if (!target) return { ok: false, reason: 'VALIDATION_ERROR', strip };

  // docs/adr/0101 (H94, H100 DR-1 b): until control transfers on a HANDOFF, a heading or an altitude outside the release
  // in effect (and any from the transferring side after ACCEPT) needs a "coordinated with" attestation. Speed is not an
  // axis. The attestation is audited with the write; nothing below changes.
  const control = ctx.control.checkControlAxis(strip, op, by);
  if (!control.ok) return { ok: false, reason: control.reason, detail: control.detail, strip, ...(control.attestation ? { attestation: control.attestation } : {}) };
  const result = _applySetBlockWrite(ctx, strip, op, by, actingPositionId, clientMutationId, target);
  if (result.ok) {
    if (control.audit || control.settled) result.controlAudit = { ...(control.audit || {}), ...(control.settled ? { control: control.settled } : {}) };
    if (control.peerStrip && !result.peerStrip) { result.peerFacilityId = control.peerFacilityId; result.peerStrip = control.peerStrip; }
  }
  return result;
}

function _applySetBlockWrite(ctx, strip, op, by, actingPositionId, clientMutationId, target) {

  // WP6 (docs/adr/0051) — while an ACTIVE MARSA relation holds this flight,
  // the relation owns its separation regime and a direct Block write to it is
  // refused.
  //
  // Two answers to "who is separating these aircraft" is the defect class
  // this subsystem exists to prevent, and §4.8.3 names the exact failure: "if
  // a second controller takes TAC_C2 ten minutes later, the state must
  // already be correct, or they inherit a lie." marsa-store.js writes the
  // regime on declare and writes it back on end/void; letting SREG be edited
  // underneath that would let the flight data and the relation disagree with nothing
  // saying which was right.
  //
  // Refused rather than silently overridden, and the reason names the way
  // out: End or Void the relation, which sets the regime back to ATC as part
  // of doing so. That IS the action the controller wanted.
  if (target.kind === 'tofi' && target.field === 'separationRegime') {
    const active = ctx.rules.activeMarsaFor(strip.flightDataId);
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
  // value reaches the flight data or an annotation by.
  if (!ctx.rules.isBlockVisible(strip.stripType, op.blockId)) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `Block ${op.blockId} is not visible for ${strip.stripType} at this Facility`, strip };
  }

  if (target.kind === 'flightData' || target.kind === 'airspace-owner' || target.kind === 'tofi' || target.kind === 'frequency' || target.kind === 'military') {
    const flightDataResult = target.kind === 'airspace-owner'
      ? ctx.flightDataStore.setAirspaceOwner(strip.flightDataId, op.value, { by })
      : target.kind === 'frequency'
        ? ctx.flightDataStore.setWorkingFrequency(strip.flightDataId, _frequencyFromBlockValue(op.value), { by })
        : target.kind === 'tofi'
          ? ctx.flightDataStore.setTofi(strip.flightDataId, _tofiPatch(ctx, strip, target, op), { by })
          // WP6 (docs/adr/0052), guide §6.4 — the military extension
          // namespace, routed exactly like 'tofi' above.
          : target.kind === 'military'
            ? ctx.flightDataStore.setMilitary(strip.flightDataId, { [target.field]: op.value }, { by })
            : target.path === 'identity.beaconAssigned'
              ? ctx.flightDataStore.setBeaconAssigned(strip.flightDataId, op.value, { by })
              : ctx.flightDataStore.setField(strip.flightDataId, target.path, op.value, { by });
    if (!flightDataResult.ok) return { ok: false, reason: flightDataResult.reason, detail: flightDataResult.detail, strip };

    // flight data keeps its own independent rev (guide §3.1); the Strip's rev is
    // also bumped here as a deliberate Phase-1 simplification so the
    // ack/broadcast cycle has one consistent rev to key off per Strip,
    // rather than building a fully separate flight data-level optimistic-
    // concurrency protocol on the wire. See the implementation plan.
    ctx.state.bump(strip, by);
    const marsaVoided = ctx.marsaVoidFor(strip, op, by, actingPositionId, clientMutationId);
    return {
      ok: true, strip, flightData: flightDataResult.flightData, warnings: fromCode(flightDataResult.warning),
      marsaVoided, flightDataList: marsaVoided ? ctx.drainMarsaRegimeWrites() : undefined,
    };
  }

  // docs/adr/0074 — a flight's own carrier fields, written to the flight data
  // (`flightData.military.carrier`) so they survive from the launch Strip to the
  // recovery Strip. A `carrier-derived` Block never reaches here: its target
  // resolves to null above, so SetBlock on CASE, DME, ANGELS, EAT/PUSH or the
  // expected final bearing is a VALIDATION_ERROR (WP7A bullets 2 and 5).
  if (target.kind === 'carrier') {
    const flightDataResult = ctx.flightDataStore.setCarrier(strip.flightDataId, target.field, op.value, { by });
    if (!flightDataResult.ok) return { ok: false, reason: flightDataResult.reason, detail: flightDataResult.detail, strip };
    ctx.state.bump(strip, by);
    return { ok: true, strip, flightData: flightDataResult.flightData };
  }

  // docs/adr/0058 — the flight's assigned altitude or heading. On the flight data,
  // not the Strip, so every Facility's copy reads the same value; history
  // and confirmVacated work exactly as they do for a Strip annotation.
  if (target.kind === 'clearance') {
    const flightDataResult = ctx.flightDataStore.setClearance(strip.flightDataId, target.field,
      { value: op.value, confirmVacated: !!op.confirmVacated }, { by });
    if (!flightDataResult.ok) return { ok: false, reason: flightDataResult.reason, detail: flightDataResult.detail, strip };
    ctx.state.bump(strip, by);
    const marsaVoided = ctx.marsaVoidFor(strip, op, by, actingPositionId, clientMutationId);
    return {
      ok: true, strip, flightData: flightDataResult.flightData,
      marsaVoided, flightDataList: marsaVoided ? ctx.drainMarsaRegimeWrites() : undefined,
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
    if (result.marsaVoided) result.flightDataList = ctx.drainMarsaRegimeWrites();
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
  // Same ceiling the flight data's free-text fields get, for the same reason: an
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
  undo: 'none', // docs/adr/0100 §1: an edit, corrected by editing
  // The op kind alone names neither the Block written nor a coordination
  // action (PROPOSE/ACCEPT/REJECT/CANCEL...); the entry says which.
  // A coordinated write carries `coordinatedWith` and `controlAxis` in its line (docs/adr/0101).
  auditFields: (ctx, result, op) => ({ head: { blockId: op.blockId, value: op.value }, ...(result.controlAudit ? { tail: result.controlAudit } : {}) }),
  apply: (ctx, strip, op, meta) => _applySetBlock(ctx, strip, op, meta.by, meta.actingPositionId, meta.clientMutationId),
};
