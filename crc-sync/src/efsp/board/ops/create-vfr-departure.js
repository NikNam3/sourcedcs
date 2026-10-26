'use strict';

// CreateVfrDeparture (docs/adr/0143, H166): the VFR departure, one action at the Position that gives departures their
// code at the airfield (CD). A VFR pilot calls ground or clearance delivery for radar traffic information "with proposed
// direction of flight" (AIM para 4-1-18 a.5(b)); the VFR flight plan, if any, is a search-and-rescue record with Flight
// Service and never reaches the controller (H166), so nothing is looked up. The controller assigns a computer-assigned
// discrete code (JO 7110.65BB para 5-2-7 a) and the departure frequency (para 7-6-10): "VIPER11, squawk 4321, departure
// frequency ..., maintain VFR". Here, in one Mutation: flight data (callsign, Block 3, the departure airfield, the runway
// and the direction of flight, Block 9K), a discrete code from the allocator, and a DEPARTURE Strip in the acting
// Position's CLEARED Bay. The single action is ours.
//
// Why CLEARED: a VFR departure has no IFR clearance (no assigned ALT/HDG, so conformance has nothing to check, H136
// VQ2), so the clearance steps (PENDING_CLEARANCE review, the flight-plan check, release and void times) do not apply.
// From CLEARED the ordinary steps follow unchanged: CD's NLA to GC (PUSHBACK, TAXI), LC (runway queue, line up,
// departed) and the hand-off to AP, where "Radar service terminated" (TerminateRadarService) ends the service when it
// leaves the area or the pilot cancels, or it keeps flight following. The departure release stays RELEASED (the flight
// data default): nothing holds it.
//
// Who: a Position that may create a DEPARTURE Strip (canCreateStripType), owns its CLEARED state (canActOnState) and has a
// Bay implying CLEARED; the op-kind grant (VFR_DEPARTURE_OP_KINDS) is the ceiling. No Position id is named here (ADR 0132).
//
// Every gate runs before the first write. "No code free" is the allocator's own refusal, the last check and the first
// write (createFlightData). Undo takes the whole thing back: the Strip removed, the flight data archived, its code released.

const { parseAircraftData } = require('../../aircraft-data');
const { normalizeDirectionOfFlight } = require('../../flight-data-store');
const { normalizeRunwayEnd } = require('../../runway-status');
const { callsignOf } = require('../../undo/scopes');

const STRIP_TYPE = 'DEPARTURE';
const STATE = 'CLEARED';

function _refuse(reason, detail) { return { ok: false, reason, detail }; }

/** The runway end the departure is filed for: the typed one (an end of this airfield), else the active one, else null. */
function _runwayFor(ctx, typed) {
  const view = ctx.placement.runwayStatusView();
  const text = typed == null ? '' : String(typed).trim();
  if (text === '') return { ok: true, end: (view && view.activeRunway) || null };
  const end = normalizeRunwayEnd(text);
  const known = end && view && (view.runways || []).some(r => r.ends.includes(end));
  if (!known) return { ok: false, detail: `runway ${text.toUpperCase()} is not a runway of this airfield` };
  return { ok: true, end };
}

function _applyCreate(ctx, op, meta) {
  const { actingPositionId, by } = meta;
  const seed = op.flightData || {};
  const callsign = String(seed.callsign || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,7}$/.test(callsign)) return _refuse('VALIDATION_ERROR', 'callsign must be 1-7 alphanumeric characters');
  const aircraft = parseAircraftData(seed.aircraftData);
  if (!aircraft.ok) return _refuse('VALIDATION_ERROR', aircraft.detail);
  const direction = normalizeDirectionOfFlight(seed.directionOfFlight);
  if (!direction.ok) return _refuse('VALIDATION_ERROR', direction.detail);
  if (!direction.value) return _refuse('VALIDATION_ERROR', 'a VFR departure needs its direction of flight (N, NE, E, SE, S, SW, W, NW)');

  if (!ctx.rules.canCreateStripType(actingPositionId, STRIP_TYPE) || !ctx.rules.canActOnState(actingPositionId, STRIP_TYPE, STATE)) {
    return _refuse('PERMISSION_DENIED', `${actingPositionId} does not give departures their code`);
  }
  const bay = ctx.rules.bayForImpliedState(actingPositionId, STATE);
  if (!bay || bay.impliesState !== STATE) return _refuse('VALIDATION_ERROR', `${actingPositionId} has no Bay for cleared departures`);
  const full = ctx.placement.bayFullRefusal(bay.bayId, { stripId: null });
  if (full) return _refuse(full.reason, full.detail);
  const runway = _runwayFor(ctx, seed.departureRunway);
  if (!runway.ok) return _refuse('VALIDATION_ERROR', runway.detail);

  const created = ctx.run('CreateStrip', null, {
    kind: 'CreateStrip', bayId: bay.bayId, rackId: bay.rackIds[0], stripType: STRIP_TYPE, initialState: STATE,
    flightData: {
      callsign, aircraftType: aircraft.type, wakeCategory: aircraft.wake, flightSize: aircraft.count,
      departureAirport: ctx.rules.fieldAirport() || '', departureRunway: runway.end, directionOfFlight: direction.value,
    },
  }, { actingPositionId, by });
  if (!created.ok) {
    const detail = created.detail === 'beacon code pool exhausted' ? 'no discrete beacon code is free' : created.detail;
    return _refuse(created.reason, detail);
  }
  return {
    ok: true, strip: created.strip, flightData: created.flightData, warnings: created.warnings,
    vfrDeparture: { flightDataId: created.strip.flightDataId, beaconCode: created.flightData.identity.beaconAssigned },
  };
}

module.exports = {
  kind: 'CreateVfrDeparture',
  // Applied with no Strip (board/strip-ops.js runs it like CreateStrip): it makes its subject.
  stripless: true,
  // Everything it writes it creates: the Strip, and the flight data and its code (archived on undo).
  undo: {
    label: (op, strip, ctx) => `VFR departure ${strip ? callsignOf(ctx, strip) : String((op.flightData && op.flightData.callsign) || '').trim().toUpperCase()}`,
    scope: () => ({ strips: [], flightData: [] }),
    created: (result, ctx) => ({
      strips: [{ facilityId: ctx.rules.facilityId, stripId: result.strip.stripId }],
      flightData: [result.strip.flightDataId],
    }),
  },
  auditFields: (ctx, result) => ({ tail: { vfrDeparture: result.vfrDeparture } }),
  apply: (ctx, strip, op, meta) => _applyCreate(ctx, op, meta),
};
