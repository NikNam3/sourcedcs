'use strict';

const { stripScope, callsignOf } = require('../../undo/scopes');
const { newFlags } = require('../strip-util');

// LC's pattern work on its ordinary Strips (docs/adr/0126, H149, H150 TWR-Q1 a). Two in-place strip-type changes that
// follow JO 7110.65 ¶3-8-2: "Consider an aircraft cleared for touch-and-go, stop-and-go, or low approach as an arriving
// aircraft until it touches down (for touch-and-go), or makes a complete stop (for stop-and-go), or crosses the landing
// threshold (for low approach), and thereafter as a departing aircraft."
//
//   JoinPattern   a local DEPARTURE LC holds at DEPARTED stays in closed traffic (¶3-10-11): it becomes an ARRIVAL at
//                 TRAFFIC_PATTERN in LC's Pattern Bay, without going to AP.
//   LeavePattern  an ARRIVAL LC works in the pattern (TRAFFIC_PATTERN, or FINAL after the option) departs it: it becomes
//                 a DEPARTURE at DEPARTED in LC's airborne Bay, and the ordinary LC departure flow follows (Hand Off to
//                 AP, or Drop when a VFR flight leaves the area; the pilot then calls APP like any VFR aircraft, H138 U15).
//
// Same Strip, same flight data, same code and correlation, as docs/adr/0023's ConvertToArrival: the pattern cells
// (9J-ENTRY, 9J-OPTION) live on the flight data and survive; the leg's annotations and flags are archived on
// `previousLeg`, as there.

const CONVERSIONS = {
  JoinPattern: { from: 'DEPARTURE', fromStates: ['DEPARTED'], to: 'ARRIVAL', toState: 'TRAFFIC_PATTERN' },
  LeavePattern: { from: 'ARRIVAL', fromStates: ['TRAFFIC_PATTERN', 'FINAL'], to: 'DEPARTURE', toState: 'DEPARTED' },
};

function _openExchangeRefusal(strip) {
  if (strip.coordination && strip.coordination.state === 'INITIATED') return 'an open coordination proposal';
  if (strip.tofiCoordination && strip.tofiCoordination.state === 'INITIATED') return 'an open TOFI proposal';
  if (strip.tofiCoordination && strip.tofiCoordination.state === 'ACTIVE') return 'active tactical control';
  if (strip.vfrHandoff) return `the handoff to ${strip.vfrHandoff.toPositionId}`;
  return null;
}

/** The flight data write that makes the new leg's Block 8 honest, or null (see each branch). */
function _airportPatch(ctx, kind, flightData) {
  if (!flightData) return null;
  if (kind === 'JoinPattern') {
    // ARRIVAL's Block 8 is filed.originAirport (ConvertToArrival's finding): the local flight came from here.
    return flightData.filed.departureAirport ? ['filed.originAirport', flightData.filed.departureAirport] : null;
  }
  // DEPARTURE's Block 8 is filed.departureAirport: the flight now departs the field whose pattern it was in.
  const field = ctx.rules.fieldAirport();
  return field && flightData.filed.departureAirport !== field ? ['filed.departureAirport', field] : null;
}

// docs/adr/0146: on a VFR strip the pattern is a place, not a strip type: Closed traffic puts it in the holder's Bay for the
// pattern (the one implying TRAFFIC_PATTERN), Leave pattern in the Bay for airborne departures (the one implying
// DEPARTED). The strip stays VFR; no takeoff stamp or lifecycle step applies to it.
const VFR_PATTERN_BAYS = { JoinPattern: 'TRAFFIC_PATTERN', LeavePattern: 'DEPARTED' };

function _applyVfrPatternMove(kind, ctx, strip, by) {
  const wanted = VFR_PATTERN_BAYS[kind];
  const bay = (ctx.rules.baysFor(strip.ownerPositionId) || []).find(b => b.impliesState === wanted && !b.view);
  if (!bay) return { ok: false, reason: 'VALIDATION_ERROR', detail: `${strip.ownerPositionId} has no Bay for ${wanted === 'DEPARTED' ? 'airborne departures' : 'the pattern'}`, strip };
  if (bay.bayId === strip.bayId) return { ok: false, reason: 'VALIDATION_ERROR', detail: `it is already in ${bay.bayId}`, strip };
  const open = _openExchangeRefusal(strip);
  if (open) return { ok: false, reason: 'VALIDATION_ERROR', detail: `resolve ${open} first`, strip };
  const full = ctx.placement.bayFullRefusal(bay.bayId, strip);
  if (full) return { ok: false, reason: full.reason, detail: full.detail, strip };
  strip.bayId = bay.bayId;
  strip.rackId = ctx.placement.placementRack(strip, bay);
  strip.orderKey = ctx.placement.appendOrderKey(bay.bayId, strip.rackId, strip.stripId);
  ctx.state.bump(strip, by);
  return { ok: true, strip };
}

function _applyPatternConversion(kind, ctx, strip, by, actingPositionId) {
  if (strip.stripType === 'VFR') return _applyVfrPatternMove(kind, ctx, strip, by);
  const c = CONVERSIONS[kind];
  if (strip.stripType !== c.from || !c.fromStates.includes(strip.state)) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `${kind} needs ${c.from === 'DEPARTURE' ? 'a DEPARTURE' : 'an ARRIVAL'} Strip at ${c.fromStates.join(' or ')}`, strip };
  }
  // The state authority, as InvokeNla and SetState check it: only the Position working this state (LC) changes it.
  if (!ctx.rules.canActOnState(actingPositionId, strip.stripType, strip.state)) {
    return { ok: false, reason: 'PERMISSION_DENIED', detail: `${strip.state} is not ${actingPositionId}'s to change`, strip };
  }
  const open = _openExchangeRefusal(strip);
  if (open) return { ok: false, reason: 'VALIDATION_ERROR', detail: `resolve ${open} first`, strip };
  const bay = ctx.rules.bayForImpliedState(strip.ownerPositionId, c.toState);
  if (!bay || bay.impliesState !== c.toState) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `${strip.ownerPositionId} has no Bay for ${c.toState}`, strip };
  }

  const flightData = ctx.flightDataStore.getFlightData(strip.flightDataId);
  let updatedFlightData;
  const patch = _airportPatch(ctx, kind, flightData);
  if (patch) {
    const r = ctx.flightDataStore.setField(strip.flightDataId, patch[0], patch[1], { by });
    if (r.ok) updatedFlightData = r.flightData;
  }

  strip.previousLeg = {
    stripType: strip.stripType,
    annotations: strip.annotations,
    flags: strip.flags,
    convertedAt: ctx.clock.now(),
    convertedBy: by || null,
  };
  strip.stripType = c.to;
  strip.state = c.toState;
  strip.bayId = bay.bayId;
  strip.rackId = ctx.placement.placementRack(strip, bay);
  strip.orderKey = ctx.placement.resolveOrderKey(bay.bayId, strip.rackId, null, null, strip.stripId);
  strip.annotations = {};
  strip.flags = newFlags();
  strip.coordination = null;
  strip.tofiCoordination = null;
  ctx.state.bump(strip, by);
  return { ok: true, strip, ...(updatedFlightData ? { flightData: updatedFlightData } : {}) };
}

const op = (kind, label) => ({
  kind,
  // docs/adr/0100: the conversion in place and the airport it writes on the flight data, like ConvertToArrival.
  undo: {
    label: (o, strip, ctx) => `${label} ${callsignOf(ctx, strip)}`,
    scope: (ctx, strip) => stripScope(ctx, strip),
  },
  apply: (ctx, strip, o, meta) => _applyPatternConversion(kind, ctx, strip, meta.by, meta.actingPositionId),
});

module.exports = [op('JoinPattern', 'Closed traffic'), op('LeavePattern', 'Leave pattern')];
module.exports.CONVERSIONS = CONVERSIONS;
