'use strict';

const { stripScope, union, callsignOf } = require('../../undo/scopes');
const { MAX_FREE_TEXT } = require('../../flight-data-store');

/**
 * docs/adr/0111 — a Divert: the flight is now flying to a different destination and gets a new clearance. The SAME Strip
 * (same stripId, same flight data) changes strip type when the destination demands it:
 *
 *   OVERFLIGHT -> a field we run   => ARRIVAL at INBOUND
 *   OVERFLIGHT -> not ours         => OVERFLIGHT, state kept
 *   ARRIVAL    -> a field we run   => ARRIVAL at INBOUND
 *   ARRIVAL    -> not ours         => OVERFLIGHT at IN_SECTOR (the holder is working it)
 *
 * The clearance fields are FAA JO 7110.65 ¶4-2-1 / ¶4-2-5 / ¶4-5-7's (ADR 0111 §2). Destination, route and altitude
 * are written on the flight data (the altitude through the clearance history, so the old one shows struck through);
 * restrictions, holding and special information live on the Strip's append-only `diverts` list with the old values.
 */

const DIVERTABLE = {
  OVERFLIGHT: ['INBOUND', 'IN_SECTOR'],
  ARRIVAL: ['INBOUND'],
};
const TEXT_FIELDS = ['route', 'altitude', 'restrictions', 'holding', 'special'];

function _text(op, key) {
  const v = op[key];
  return typeof v === 'string' ? v.trim() : '';
}

function _refuse(strip, detail) {
  return { ok: false, reason: 'VALIDATION_ERROR', detail, strip };
}

function _activeAltitude(flightData) {
  const cell = flightData && flightData.clearance && flightData.clearance.altitude;
  const active = cell && cell.entries ? cell.entries.find(e => e.status === 'ACTIVE') : null;
  return active ? active.value : '';
}

/** The guards, in the order a controller meets them. Returns a refusal or null. */
function _guards(ctx, strip, op, actingPositionId) {
  if (strip.stripType === 'DEPARTURE') {
    return _refuse(strip, 'a departure does not divert: an emergency is not a divert, and a departure that turns back is told to call Center');
  }
  const states = DIVERTABLE[strip.stripType];
  if (!states || !states.includes(strip.state)) {
    return _refuse(strip, `only an OVERFLIGHT being worked or an ARRIVAL at INBOUND can divert, not ${strip.stripType} in ${strip.state}`);
  }
  if (!ctx.rules.canCreateStripType(actingPositionId, 'ARRIVAL') || !ctx.rules.canCreateStripType(actingPositionId, 'OVERFLIGHT')) {
    return { ok: false, reason: 'PERMISSION_DENIED', strip };
  }
  const link = strip.coordination;
  if (link && link.state === 'INITIATED') {
    return _refuse(strip, 'cannot divert a Strip with an open coordination proposal — accept, reject, or cancel it first');
  }
  if (link && link.state === 'ACTIVE' && link.primitive === 'HANDOFF') {
    if (!link.mintedForCoordination) return _refuse(strip, 'the flight is with the receiving Position of its hand-off — it diverts there');
    if (ctx.control.isSteps(strip) && ctx.control.controlHolder(link) === 'TRANSFERRING') {
      return _refuse(strip, 'control of this flight has not transferred yet — a new route or altitude needs the transferring controller');
    }
  }
  const tofi = strip.tofiCoordination;
  if (tofi && tofi.state === 'INITIATED') return _refuse(strip, 'cannot divert a Strip with an open TOFI proposal — accept, reject, or wait for a response first');
  if (tofi && tofi.state === 'ACTIVE') return _refuse(strip, 'cannot divert a Strip under active tactical control — complete a TOFI exit first');
  if (_text(op, 'destination') === '') return _refuse(strip, 'a divert names the new destination (the clearance limit)');
  for (const key of ['destination', ...TEXT_FIELDS]) {
    if (_text(op, key).length > MAX_FREE_TEXT) return _refuse(strip, `${key} is limited to ${MAX_FREE_TEXT} characters`);
  }
  return null;
}

function _applyDivert(ctx, strip, op, by, actingPositionId, clientMutationId) {
  const refused = _guards(ctx, strip, op, actingPositionId);
  if (refused) return refused;

  const flightData = ctx.flightDataStore.getFlightData(strip.flightDataId);
  if (!flightData) return { ok: false, reason: 'NOT_FOUND', strip };
  const destination = _text(op, 'destination').toUpperCase();
  const target = ctx.rules.divertDestinationFor(destination);
  const toStripType = target.kind === 'OTHER' ? 'OVERFLIGHT' : 'ARRIVAL';
  const toState = toStripType === 'ARRIVAL' ? 'INBOUND' : (strip.stripType === 'OVERFLIGHT' ? strip.state : 'IN_SECTOR');
  const route = _text(op, 'route').toUpperCase();
  const altitude = _text(op, 'altitude');

  // Where it goes, found before anything is written (a refusal changes nothing).
  const shadow = { ...strip, stripType: toStripType, state: toState };
  const place = strip.stripType === toStripType
    ? { bayId: strip.bayId, rackId: strip.rackId }
    : ctx.placement.bayForNewOwner(strip.ownerPositionId, toState, shadow);
  if (!place) return _refuse(strip, `${strip.ownerPositionId} has no Bay for a ${toStripType}`);

  const from = {
    stripType: strip.stripType, state: strip.state,
    destination: (flightData.filed.destinationAirport || '').toUpperCase(),
    route: flightData.filed.route || '',
    altitude: _activeAltitude(flightData),
  };

  // Flight data writes. A refusal here (an altitude that does not parse) is the only way to fail after the checks above,
  // so the altitude is written first, and the rest cannot refuse.
  let updated = flightData;
  if (altitude !== '') {
    const r = ctx.flightDataStore.setClearance(strip.flightDataId, 'altitude', { value: altitude }, { by });
    if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail, strip };
    updated = r.flightData;
  }
  const writes = [['filed.destinationAirport', destination]];
  if (route !== '') writes.push(['filed.route', route]);
  // The origin is one fact under two names (ConvertToArrival's note): carry it across so the other strip type reads it.
  if (toStripType === 'ARRIVAL' && !flightData.filed.originAirport && flightData.filed.departureAirport) writes.push(['filed.originAirport', flightData.filed.departureAirport]);
  if (toStripType === 'OVERFLIGHT' && !flightData.filed.departureAirport && flightData.filed.originAirport) writes.push(['filed.departureAirport', flightData.filed.originAirport]);
  for (const [path, value] of writes) {
    const r = ctx.flightDataStore.setField(strip.flightDataId, path, value, { by });
    if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail, strip };
    updated = r.flightData;
  }

  const now = ctx.clock.now();
  const to = {
    stripType: toStripType, state: toState, destination, route: route || from.route, altitude: altitude ? altitude.toUpperCase() : from.altitude,
    restrictions: _text(op, 'restrictions'), holding: _text(op, 'holding'), special: _text(op, 'special'),
  };
  if (!Array.isArray(strip.diverts)) strip.diverts = [];
  strip.diverts.push({ at: now, by: by || null, actingPositionId, from, to });
  strip.stripType = toStripType;
  strip.state = toState;
  if (place.bayId !== strip.bayId || place.rackId !== strip.rackId) {
    strip.bayId = place.bayId;
    strip.rackId = place.rackId;
    strip.orderKey = ctx.placement.appendOrderKey(place.bayId, place.rackId, strip.stripId);
  }
  ctx.state.bump(strip, by, now);

  // A new altitude outside a MARSA relation voids it, as a Block write of the altitude does (ADR 0051).
  let marsaVoided;
  if (altitude !== '') {
    marsaVoided = ctx.marsaVoidFor(strip, { blockId: toStripType === 'ARRIVAL' ? '7' : '7A' }, by, actingPositionId, clientMutationId);
  }
  return {
    ok: true, strip, flightData: updated,
    marsaVoided, flightDataList: marsaVoided ? ctx.drainMarsaRegimeWrites() : undefined,
    divert: { from, to },
  };
}

module.exports = {
  kind: 'Divert',
  // docs/adr/0111 §6: the Strip and its flight data (destination, route, the altitude history); a MARSA relation a new altitude
  // ends is put back with them.
  undo: {
    label: (op, strip, ctx) => `Divert ${callsignOf(ctx, strip)}`,
    scope: (ctx, strip) => union(stripScope(ctx, strip), { marsa: strip.flightDataId ? [{ flightDataId: strip.flightDataId }] : [] }),
  },
  auditFields: (ctx, result) => ({ tail: result.divert ? { divert: result.divert } : {} }),
  apply: (ctx, strip, op, meta) => _applyDivert(ctx, strip, op, meta.by, meta.actingPositionId, meta.clientMutationId),
};
