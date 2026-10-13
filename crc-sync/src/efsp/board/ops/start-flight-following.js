'use strict';

// StartFlightFollowing (H136 VQ1 a, docs/wip/LT-VFR.md): one action on a contact with no Strip. The pilot asks for
// traffic advisories (AIM para 4-1-18 a.3); the controller identifies the contact on the scope, enters the aircraft with
// its identification (JO 7110.65BB para 5-14-4 c), issues a computer-assigned discrete code (para 5-2-7 a) and says
// "RADAR CONTACT" (para 5-3-7 a). Here, in one Mutation: flight data (callsign and Block 3), a discrete code from the
// allocator, an OVERFLIGHT Strip owned by the acting Position directly IN_SECTOR (the FAA's ordinary overflight form,
// TBL 2-3-5, H136 VQ3; a flight leaving or landing at our field is the ordinary DEPARTURE/ARRIVAL path), and the
// contact bound to it (BindTrack, rung 1). The single action is ours.
//
// VFR is not a field (H136 VQ2): the Strip has no clearance, so conformance has nothing to check. Undo takes the
// whole thing back: the Strip is removed, the flight data archived (its code released) and the binding ended.
//
// Every gate runs before the first write: a contact already correlated, a Position that does not work OVERFLIGHT
// Strips or has no Bay for them, a callsign or Block 3 that does not parse. "No code free" is the allocator's own
// refusal, the last check and the first write (createFlightData).

const { parseAircraftData } = require('../../aircraft-data');
const { callsignOf } = require('../../undo/scopes');

const STRIP_TYPE = 'OVERFLIGHT';
const STATE = 'IN_SECTOR';

function _refuse(reason, detail) { return { ok: false, reason, detail }; }

function _applyStart(ctx, op, meta) {
  const { actingPositionId, by } = meta;
  const trackId = op.trackId != null ? String(op.trackId).trim() : '';
  if (!trackId) return _refuse('VALIDATION_ERROR', 'pick the contact to start flight following on');

  const seed = op.flightData || {};
  const callsign = String(seed.callsign || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,7}$/.test(callsign)) return _refuse('VALIDATION_ERROR', 'callsign must be 1-7 alphanumeric characters');
  const aircraft = parseAircraftData(seed.aircraftData);
  if (!aircraft.ok) return _refuse('VALIDATION_ERROR', aircraft.detail);

  const holder = ctx.rules.correlationHolderOfTrack(trackId);
  if (holder) {
    const fd = ctx.flightDataStore.getFlightData(holder.flightDataId);
    const name = (fd && fd.identity && fd.identity.callsign) || 'another flight';
    return _refuse('VALIDATION_ERROR', `this contact is already tracked as ${name}`);
  }
  if (!ctx.rules.canCreateStripType(actingPositionId, STRIP_TYPE)) {
    return _refuse('PERMISSION_DENIED', `${actingPositionId} does not work ${STRIP_TYPE} Strips`);
  }
  const bay = ctx.placement.stripTypeBayFor({ stripType: STRIP_TYPE }, actingPositionId);
  if (!bay) return _refuse('VALIDATION_ERROR', `${actingPositionId} has no ${STRIP_TYPE} Bay`);
  const full = ctx.placement.bayFullRefusal(bay.bayId, { stripId: null });
  if (full) return _refuse(full.reason, full.detail);

  const created = ctx.run('CreateStrip', null, {
    kind: 'CreateStrip', bayId: bay.bayId, rackId: bay.rackIds[0], stripType: STRIP_TYPE, initialState: STATE,
    flightData: { callsign, aircraftType: aircraft.type, wakeCategory: aircraft.wake, flightSize: aircraft.count },
  }, { actingPositionId, by });
  if (!created.ok) {
    const detail = created.detail === 'beacon code pool exhausted' ? 'no discrete beacon code is free' : created.detail;
    return _refuse(created.reason, detail);
  }

  const correlation = ctx.rules.bindTrackOnStart(created.strip.flightDataId, trackId, { actingPositionId, by, note: 'flight following' });
  return {
    ok: true, strip: created.strip, flightData: created.flightData, warnings: created.warnings,
    correlationChanged: [correlation],
    flightFollowing: { trackId, flightDataId: created.strip.flightDataId, beaconCode: created.flightData.identity.beaconAssigned },
  };
}

module.exports = {
  kind: 'StartFlightFollowing',
  // Applied with no Strip (board/strip-ops.js runs it like CreateStrip): it makes its subject.
  stripless: true,
  // Everything it writes it creates: the Strip, the flight data and its code (archived on undo), and the binding on that
  // flight data (ended on undo, board/ops/undo.js).
  undo: {
    label: (op, strip, ctx) => `Flight following ${strip ? callsignOf(ctx, strip) : String((op.flightData && op.flightData.callsign) || '').trim().toUpperCase()}`,
    scope: () => ({ strips: [], flightData: [] }),
    created: (result, ctx) => ({
      strips: [{ facilityId: ctx.rules.facilityId, stripId: result.strip.stripId }],
      flightData: [result.strip.flightDataId],
    }),
  },
  auditFields: (ctx, result) => ({ tail: { flightFollowing: result.flightFollowing, correlation: result.correlationChanged[0] } }),
  apply: (ctx, strip, op, meta) => _applyStart(ctx, op, meta),
};
