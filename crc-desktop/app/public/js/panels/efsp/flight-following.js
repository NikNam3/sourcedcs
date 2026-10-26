'use strict';
import { getActingPositions, sendEfspCreateStrip, sendEfspMutation } from './efsp-ws.js';
import { getAllEfspStrips, getEfspFlightData } from './efsp-state.js';
import { getAllEfspCorrelations, stripIdsForTrackId } from './correlation-state.js';
import { facilityOfPosition } from './facility-topology.js';
import { FLIGHT_FOLLOWING_POSITIONS } from './bay/authority-mirror.js';
import { getAllTracks } from '../../picture.js';
import { hasNoClearance } from './vfr.js';

// Flight following (crc-sync H136, docs/wip/LT-VFR.md). "Start flight following" is one action on a contact with no
// Strip: crc-sync makes the flight data, a discrete code and an OVERFLIGHT Strip IN_SECTOR at the acting radar Position,
// and binds the contact, in one Mutation (JO 7110.65BB para 5-14-4 c, 5-2-7 a). "Radar service terminated" is one
// action on the Strip: dropped, code released, airspace entry cleared, the contact untracked (para 5-1-9 a, 5-2-7 b).
// VFR is no field: a Strip with no assigned altitude or heading (H136 VQ2).

/** The radar Position this controller would start flight following at (AP or CTR, Primary), or null. */
export function flightFollowingPosition() {
  const acting = getActingPositions();
  return FLIGHT_FOLLOWING_POSITIONS.find(p => acting.includes(p)) || null;
}

/** Whether "Start flight following" applies to this contact: a radar Position is held and no live Strip is on it. */
export function canStartFlightFollowing(trackId) {
  if (trackId == null || !flightFollowingPosition()) return false;
  const wanted = String(trackId);
  if (stripIdsForTrackId(wanted).length) return false;
  // An explicit binding claims its contact even while crc-sync's picture misses it (crc-sync refuses the same).
  const bound = new Set(getAllEfspCorrelations().filter(r => r.binding && r.binding.trackId === wanted).map(r => r.flightDataId));
  return !bound.size || !getAllEfspStrips().some(s => s.state !== 'DROPPED' && bound.has(s.flightDataId));
}

/** The contact a controller names by its track number (as the data block shows it) or its id, or null. */
export function contactForToken(token) {
  const want = String(token || '').trim().toUpperCase();
  if (!want) return null;
  for (const t of getAllTracks()) {
    if (String(t.id).toUpperCase() === want) return String(t.id);
    if (t.label && t.label.trackNumber != null && String(t.label.trackNumber).toUpperCase() === want) return String(t.id);
  }
  return null;
}

/**
 * Sends StartFlightFollowing. `onAck(ack)` gets the server's answer; a refusal is the caller's to show (it returns true
 * so the generic banner stays quiet). @returns {string|null} what is wrong before sending, or null when sent
 */
export function startFlightFollowing(trackId, callsign, aircraftData, onAck) {
  const positionId = flightFollowingPosition();
  if (!positionId) return 'sign on to AP or CTR first';
  const cs = String(callsign || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,7}$/.test(cs)) return 'callsign: 1 to 7 letters or digits';
  const type = String(aircraftData || '').trim().toUpperCase();
  if (!type) return 'aircraft type, e.g. C172';
  sendEfspCreateStrip(positionId, {
    kind: 'StartFlightFollowing', trackId: String(trackId), flightData: { callsign: cs, aircraftData: type },
  }, facilityOfPosition(positionId), { onAck: (ack) => { if (onAck) onAck(ack); return !ack.ok; } });
  return null;
}

// The strip types a flight-following service rides on: a transit (H136) and a VFR departure (docs/adr/0143). An arrival's
// service ends by landing (JO 7110.65BB para 5-1-9 b.4).
const TERMINABLE_STRIP_TYPES = ['OVERFLIGHT', 'DEPARTURE'];

/** No assigned altitude and no assigned heading: VFR the FAA way (H136 VQ2; vfr.js, shared with crc-sync). */
function _noClearance(strip) {
  return hasNoClearance(getEfspFlightData(strip.flightDataId));
}

/**
 * Whether "Radar service terminated" is offered on this Strip: a live OVERFLIGHT Strip with no clearance, or a VFR
 * departure (a DEPARTURE with no clearance, crc-sync docs/adr/0143) once handed off, owned by a radar Position this
 * controller holds. (crc-sync accepts it on any live Strip AP or CTR owns; the menu offers it where flight following is
 * what the Strip is.)
 */
export function canTerminateRadarService(strip) {
  if (!strip || strip.state === 'DROPPED' || !TERMINABLE_STRIP_TYPES.includes(strip.stripType)) return false;
  if (!FLIGHT_FOLLOWING_POSITIONS.includes(strip.ownerPositionId)) return false;
  if (!getActingPositions().includes(strip.ownerPositionId)) return false;
  return _noClearance(strip);
}

export function terminateRadarService(strip) {
  return sendEfspMutation(strip.ownerPositionId, strip, { kind: 'TerminateRadarService' });
}
