'use strict';

const { stripScope, callsignOf } = require('../../undo/scopes');
const { newFlags } = require('../strip-util');
const authority = require('../../authority');

// ChangeFlightRules (docs/adr/0146): a flight changes between VFR and IFR on the same strip, in place (same stripId,
// same flight data, so the code, the track binding and the audit history stay), on the precedent of ConvertToArrival
// (docs/adr/0023) and the pattern conversions (docs/adr/0126).
//
//   to: 'IFR'  a VFR aircraft gets an IFR clearance (a pop-up IFR: the pilot requests it in the air, or files at the
//              field). The holder names the IFR strip type (`stripType`) it works the flight on, one it may create
//              (canCreateStripType: the Positions that originate IFR strips, so the radar and clearance Positions), and
//              the strip goes to that strip type's Bay at the holder, in the state that Bay holds. A flight with no code
//              gets a discrete one (an IFR flight is given one, JO 7110.65BB para 5-2-7 a). The clearance itself is
//              then typed as on any IFR strip.
//   to: 'VFR'  an IFR aircraft cancels its IFR flight plan in VFR conditions (AIM para 5-1-15, "Canceling IFR Flight Plan"): the strip
//              becomes a VFR strip TRACKED where it is (a Bay with a view of its own sends it to the holder's VFR Bay),
//              and the IFR assignments (altitude, heading, speed) end: an IFR clearance no longer applies to a VFR
//              aircraft, so conformance stops holding it to them. The binding and the code stay.
//
// Who: the holder (the Board's owner gate). The leg's annotations and flags are archived on `previousLeg`, as the other
// in-place conversions do. An open coordination, TOFI or VFR handoff is resolved first.

const IFR_STRIP_TYPES = ['DEPARTURE', 'ARRIVAL', 'OVERFLIGHT'];

function _openExchangeRefusal(strip) {
  if (strip.coordination && (strip.coordination.state === 'INITIATED' || strip.coordination.state === 'ACTIVE')) return 'its coordination exchange';
  if (strip.tofiCoordination && (strip.tofiCoordination.state === 'INITIATED' || strip.tofiCoordination.state === 'ACTIVE')) return 'its TOFI exchange';
  if (strip.vfrHandoff) return `the handoff to ${strip.vfrHandoff.toPositionId}`;
  return null;
}

/**
 * Where an IFR strip of `stripType` goes at `positionId`: the Bay that holds the strip type (its state the one a worked
 * strip of that type is in, the coordination-eligible one, else the initial), else the first Bay implying a state of
 * the type the Position works. Null when it has neither.
 */
function _ifrTargetFor(ctx, positionId, stripType) {
  const family = authority.stripTypeFamily(stripType);
  const bays = ctx.rules.baysFor(positionId) || [];
  const holding = bays.find(b => b.holdsStripType === stripType);
  if (holding) return { bay: holding, state: family.coordinationEligibleState || family.initialState };
  for (const bay of bays) {
    if (bay.view || !bay.impliesState || !family.states.includes(bay.impliesState) || bay.impliesState === 'DROPPED') continue;
    if (ctx.rules.canActOnState(positionId, stripType, bay.impliesState)) return { bay, state: bay.impliesState };
  }
  return null;
}

function _archiveLeg(ctx, strip, by) {
  strip.previousLeg = { stripType: strip.stripType, annotations: strip.annotations, flags: strip.flags, convertedAt: ctx.clock.now(), convertedBy: by || null };
  strip.annotations = {};
  strip.flags = newFlags();
}

function _toIfr(ctx, strip, op, by, actingPositionId) {
  if (strip.stripType !== 'VFR') return { ok: false, reason: 'VALIDATION_ERROR', detail: 'this strip is already IFR', strip };
  const stripType = op.stripType;
  if (!IFR_STRIP_TYPES.includes(stripType)) return { ok: false, reason: 'VALIDATION_ERROR', detail: `stripType must be one of ${IFR_STRIP_TYPES.join(', ')}`, strip };
  if (!ctx.rules.canCreateStripType(actingPositionId, stripType)) {
    return { ok: false, reason: 'PERMISSION_DENIED', detail: `${actingPositionId} does not originate ${stripType} strips`, strip };
  }
  const target = _ifrTargetFor(ctx, actingPositionId, stripType);
  if (!target) return { ok: false, reason: 'VALIDATION_ERROR', detail: `${actingPositionId} has no Bay for ${stripType} strips`, strip };
  const full = ctx.placement.bayFullRefusal(target.bay.bayId, strip);
  if (full) return { ok: false, reason: full.reason, detail: full.detail, strip };

  let flightData;
  const fd = ctx.flightDataStore.getFlightData(strip.flightDataId);
  if (fd && !fd.identity.beaconAssigned) {
    const r = ctx.flightDataStore.assignDiscreteCode(strip.flightDataId, { by });
    if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail, strip };
    flightData = r.flightData;
  }
  _archiveLeg(ctx, strip, by);
  strip.stripType = stripType;
  strip.state = target.state;
  strip.bayId = target.bay.bayId;
  strip.rackId = ctx.placement.placementRack(strip, target.bay);
  strip.orderKey = ctx.placement.appendOrderKey(strip.bayId, strip.rackId, strip.stripId);
  ctx.state.bump(strip, by);
  return { ok: true, strip, ...(flightData ? { flightData } : {}), flightRules: { to: 'IFR', stripType } };
}

function _toVfr(ctx, strip, by) {
  if (!IFR_STRIP_TYPES.includes(strip.stripType)) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `a ${strip.stripType} strip does not become a VFR strip`, strip };
  }
  const fromStripType = strip.stripType;
  const bay = ctx.rules.bayDescriptor(strip.bayId);
  let target = null;
  if (!bay || bay.view) {
    target = ctx.placement.vfrBayFor(strip.ownerPositionId);
    if (!target) return { ok: false, reason: 'VALIDATION_ERROR', detail: `${strip.ownerPositionId} has no Bay to keep a VFR strip in`, strip };
  }
  // The IFR assignments end (an empty value is "no assignment", ADR 0058's append-only history).
  let flightData;
  const fd = ctx.flightDataStore.getFlightData(strip.flightDataId);
  for (const field of ['altitude', 'heading', 'speed']) {
    const cell = fd && fd.clearance && fd.clearance[field];
    const active = cell && (cell.entries || []).find(e => e.status === 'ACTIVE');
    if (!active || String(active.value == null ? '' : active.value).trim() === '') continue;
    const r = ctx.flightDataStore.setClearance(strip.flightDataId, field, { value: '' }, { by });
    if (r.ok) flightData = r.flightData;
  }
  _archiveLeg(ctx, strip, by);
  strip.stripType = 'VFR';
  strip.state = 'TRACKED';
  if (target) {
    strip.bayId = target.bayId;
    strip.rackId = ctx.placement.placementRack(strip, target);
    strip.orderKey = ctx.placement.appendOrderKey(strip.bayId, strip.rackId, strip.stripId);
  }
  ctx.state.bump(strip, by);
  return { ok: true, strip, ...(flightData ? { flightData } : {}), flightRules: { to: 'VFR', stripType: fromStripType } };
}

function _apply(ctx, strip, op, meta) {
  const { by, actingPositionId } = meta;
  if (strip.state === 'DROPPED') return { ok: false, reason: 'VALIDATION_ERROR', detail: 'this strip is dropped', strip };
  const open = _openExchangeRefusal(strip);
  if (open) return { ok: false, reason: 'VALIDATION_ERROR', detail: `resolve ${open} first`, strip };
  if (op.to === 'IFR') return _toIfr(ctx, strip, op, by, actingPositionId);
  if (op.to === 'VFR') return _toVfr(ctx, strip, by);
  return { ok: false, reason: 'VALIDATION_ERROR', detail: 'to must be IFR or VFR', strip };
}

module.exports = {
  kind: 'ChangeFlightRules',
  // docs/adr/0100: the conversion in place and what it writes on the flight data (a code, the ended assignments). A code
  // it allocates is released by the restore (flight-data-store.js restorePaths).
  undo: {
    label: (op, strip, ctx) => `${op.to === 'VFR' ? 'IFR cancelled' : 'IFR'} ${callsignOf(ctx, strip)}`,
    scope: (ctx, strip) => stripScope(ctx, strip),
  },
  auditFields: (ctx, result) => ({ tail: { flightRules: result.flightRules } }),
  apply: (ctx, strip, op, meta) => _apply(ctx, strip, op, meta),
};
module.exports.IFR_STRIP_TYPES = IFR_STRIP_TYPES;
