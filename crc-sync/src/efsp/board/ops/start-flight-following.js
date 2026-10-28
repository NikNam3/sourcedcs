'use strict';

// StartFlightFollowing (docs/adr/0146, H174, H175; supersedes H136's OVERFLIGHT form and ADR 0143's VFR departure):
// a controller tags a VFR aircraft's track. One action on a contact with no live Strip, at any Position that sees the
// track, on the ground or in the air: the controller identifies the target, enters the aircraft identification (JO
// 7110.65BB para 5-14-4 c, the track is "tracked" from then on) and the tool makes, in one Mutation, flight data
// (callsign and Block 3), a minimal VFR strip TRACKED in the acting Position's VFR Bay (placement.js `vfrBayFor`, or the
// Bay the controller named) and the binding of the contact to it (BindTrack, docs/adr/0142 rung 1). No code is needed:
// a primary target is tagged as it is and the binding follows the track (H175 VR-Q4); `code: true` also asks the
// allocator for a discrete one (para 5-2-7 a), as AssignCode does later. The single action is ours.
//
// Who: the one acting Position, holding the op (every ATC Position that works a scope or the field), with a Bay to keep
// the strip in. No Position id is named (ADR 0132). Every gate runs before the first write; "no code free" is the
// allocator's refusal, the last check and the first write. Undo takes the whole thing back: the strip removed, the
// flight data archived (a code released) and the binding ended.

const { parseAircraftData } = require('../../aircraft-data');
const { callsignOf } = require('../../undo/scopes');

const STRIP_TYPE = 'VFR';
const STATE = 'TRACKED';

function _refuse(reason, detail) { return { ok: false, reason, detail }; }

/** The Bay the strip goes in: the one the controller named (one of the acting Position's, never a view), else its VFR Bay. */
function _bayFor(ctx, op, actingPositionId) {
  if (op.bayId != null && op.bayId !== '') {
    const bay = (ctx.rules.baysFor(actingPositionId) || []).find(b => b.bayId === op.bayId);
    if (!bay) return { refusal: _refuse('VALIDATION_ERROR', `${op.bayId} is not a Bay of ${actingPositionId}`) };
    if (bay.view) return { refusal: _refuse('VALIDATION_ERROR', `a VFR strip does not go in ${op.bayId}`) };
    return { bay };
  }
  const bay = ctx.placement.vfrBayFor(actingPositionId);
  return bay ? { bay } : { refusal: _refuse('VALIDATION_ERROR', `${actingPositionId} has no Bay to keep a VFR strip in`) };
}

function _applyStart(ctx, op, meta) {
  const { actingPositionId, by } = meta;
  const trackId = op.trackId != null ? String(op.trackId).trim() : '';
  if (!trackId) return _refuse('VALIDATION_ERROR', 'pick the track to tag');

  const seed = op.flightData || {};
  const callsign = String(seed.callsign || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,7}$/.test(callsign)) return _refuse('VALIDATION_ERROR', 'callsign must be 1-7 alphanumeric characters');
  // The type is optional (H175: "type the callsign (and type, optional)"): an empty one is no Block 3 yet.
  const typed = String(seed.aircraftData == null ? '' : seed.aircraftData).trim();
  const aircraft = typed === '' ? { ok: true, type: '', wake: null, count: 1 } : parseAircraftData(typed);
  if (!aircraft.ok) return _refuse('VALIDATION_ERROR', aircraft.detail);
  if (op.code !== undefined && typeof op.code !== 'boolean') return _refuse('VALIDATION_ERROR', 'code must be true or false');

  const holder = ctx.rules.correlationHolderOfTrack(trackId);
  if (holder) {
    const fd = ctx.flightDataStore.getFlightData(holder.flightDataId);
    const name = (fd && fd.identity && fd.identity.callsign) || 'another flight';
    return _refuse('VALIDATION_ERROR', `this track is already tagged as ${name}`);
  }
  const placed = _bayFor(ctx, op, actingPositionId);
  if (placed.refusal) return placed.refusal;
  const bay = placed.bay;
  const full = ctx.placement.bayFullRefusal(bay.bayId, { stripId: null });
  if (full) return _refuse(full.reason, full.detail);

  const created = ctx.run('CreateStrip', null, {
    kind: 'CreateStrip', bayId: bay.bayId, rackId: bay.rackIds[0], stripType: STRIP_TYPE, initialState: STATE,
    flightData: {
      callsign, aircraftType: aircraft.type, wakeCategory: aircraft.wake, flightSize: aircraft.count, noCode: op.code !== true,
    },
  }, { actingPositionId, by, fromTrack: true });
  if (!created.ok) {
    const detail = created.detail === 'beacon code pool exhausted' ? 'no discrete beacon code is free' : created.detail;
    return _refuse(created.reason, detail);
  }
  // In a runway-queue Bay the rack is the strip's runway (placement.js placementRack), as for every system placement.
  const rackId = ctx.placement.placementRack(created.strip, bay);
  if (rackId && rackId !== created.strip.rackId) {
    created.strip.rackId = rackId;
    created.strip.orderKey = ctx.placement.appendOrderKey(bay.bayId, rackId, created.strip.stripId);
  }

  const correlation = ctx.rules.bindTrackOnStart(created.strip.flightDataId, trackId, { actingPositionId, by, note: 'VFR tag' });
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
  // Everything it writes it creates: the strip, the flight data and any code (archived on undo), and the binding on that
  // flight data (ended on undo, board/ops/undo.js).
  undo: {
    label: (op, strip, ctx) => `VFR ${strip ? callsignOf(ctx, strip) : String((op.flightData && op.flightData.callsign) || '').trim().toUpperCase()}`,
    scope: () => ({ strips: [], flightData: [] }),
    created: (result, ctx) => ({
      strips: [{ facilityId: ctx.rules.facilityId, stripId: result.strip.stripId }],
      flightData: [result.strip.flightDataId],
    }),
  },
  auditFields: (ctx, result) => ({ tail: { flightFollowing: result.flightFollowing, correlation: result.correlationChanged[0] } }),
  apply: (ctx, strip, op, meta) => _applyStart(ctx, op, meta),
};
