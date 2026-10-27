'use strict';
import { getActingPositions, sendEfspCreateStrip, sendEfspMutation } from './efsp-ws.js';
import { getAllEfspStrips, getEfspBays } from './efsp-state.js';
import { getAllEfspCorrelations, stripIdsForTrackId } from './correlation-state.js';
import { facilityOfPosition } from './facility-topology.js';
import { getAllTracks } from '../../picture.js';
import { isVfrStrip } from './vfr.js';

// The minimal VFR strip (crc-sync docs/adr/0146, H174, H175). A controller tags a track (its data block's menu, or the
// track panel of an untracked target): callsign, type optional, a code only if asked, and crc-sync makes the flight data,
// a VFR strip in the Position's VFR Bay and the binding in one Mutation (StartFlightFollowing). It moves between
// Positions by the STARS handoff (VfrHandoff: initiate, the receiver accepts; recall), and "Radar service terminated"
// ends it. Who may: a Position with a VFR Bay (the snapshot's Bays carry `vfr`, crc-sync's facility files): data, never
// a Position id (ADR 0132). crc-sync's op grant is the ceiling and the authority.

/** The VFR Bay of a Position, from the snapshot's Bays, or null: the Position works no VFR strips. */
export function vfrBayOf(positionId, bays = getEfspBays()) {
  if (!positionId) return null;
  const facilityId = facilityOfPosition(positionId);
  return (bays || []).find(b => b.vfr === true && b.positionId === positionId && (!b.facilityId || b.facilityId === facilityId)) || null;
}

/** The Position this controller tags a track at: the first Position it acts at that has a VFR Bay, or null. */
export function vfrTagPosition() {
  return getActingPositions().find(p => vfrBayOf(p)) || null;
}

/** Whether a tag applies to this contact: a Position that tags is held, and no live strip is on it. */
export function canTagTrack(trackId) {
  if (trackId == null || !vfrTagPosition()) return false;
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

/** What is wrong with a tag before sending it, or null. The type is optional (H175). */
export function tagProblem(callsign) {
  const cs = String(callsign || '').trim().toUpperCase();
  return /^[A-Z0-9]{1,7}$/.test(cs) ? null : 'callsign: 1 to 7 letters or digits';
}

/**
 * Sends StartFlightFollowing (the tag). `onAck(ack)` gets the server's answer; a refusal is the caller's to show (it
 * returns true so the generic banner stays quiet). @returns {string|null} what is wrong before sending, or null when sent
 */
export function tagTrack(trackId, callsign, aircraftData, onAck, { code = false, banner = false } = {}) {
  const positionId = vfrTagPosition();
  if (!positionId) return 'sign on to a Position that works VFR traffic first';
  const problem = tagProblem(callsign);
  if (problem) return problem;
  const op = {
    kind: 'StartFlightFollowing', trackId: String(trackId),
    flightData: { callsign: String(callsign).trim().toUpperCase(), aircraftData: String(aircraftData || '').trim().toUpperCase() },
  };
  if (code) op.code = true;
  // `banner`: a refusal shows on the Board's refusal banner (the label menu has closed); else the caller shows it.
  sendEfspCreateStrip(positionId, op, facilityOfPosition(positionId), { onAck: (ack) => { if (onAck) onAck(ack); return banner ? false : !ack.ok; } });
  return null;
}

/** Is this live VFR strip held at a Position this controller acts at? */
function _held(strip) {
  return isVfrStrip(strip) && getActingPositions().includes(strip.ownerPositionId);
}

/** "Radar service terminated" is the holder's, on a live VFR strip. */
export function canTerminateRadarService(strip) {
  return _held(strip);
}

export function terminateRadarService(strip) {
  return sendEfspMutation(strip.ownerPositionId, strip, { kind: 'TerminateRadarService' });
}

/**
 * Where the holder may hand a VFR strip (the STARS handoff): every other Position of its Facility with a VFR Bay. None
 * while a handoff is open (recall it first). Pure over `bays` (the snapshot's).
 * @returns {string[]}
 */
export function vfrHandoffTargets(strip, bays = getEfspBays()) {
  if (!isVfrStrip(strip) || strip.vfrHandoff) return [];
  return (bays || [])
    .filter(b => b.vfr === true && b.positionId !== strip.ownerPositionId && (!strip.facilityId || !b.facilityId || b.facilityId === strip.facilityId))
    .map(b => b.positionId);
}

/** The Position this controller accepts an open VFR handoff as, or null (STARS: the receiver accepts). */
export function vfrHandoffAcceptAs(strip) {
  if (!isVfrStrip(strip) || !strip.vfrHandoff) return null;
  return getActingPositions().includes(strip.vfrHandoff.toPositionId) ? strip.vfrHandoff.toPositionId : null;
}

/** May this controller recall the open handoff (the holder)? */
export function canRecallVfrHandoff(strip) {
  return _held(strip) && !!strip.vfrHandoff;
}

export function initiateVfrHandoff(strip, toPositionId) {
  return sendEfspMutation(strip.ownerPositionId, strip, { kind: 'VfrHandoff', action: 'INITIATE', toPositionId });
}
export function recallVfrHandoff(strip) {
  return sendEfspMutation(strip.ownerPositionId, strip, { kind: 'VfrHandoff', action: 'RECALL' });
}
export function acceptVfrHandoff(strip) {
  const as = vfrHandoffAcceptAs(strip);
  return as ? sendEfspMutation(as, strip, { kind: 'VfrHandoff', action: 'ACCEPT' }) : false;
}

/** A discrete code for a VFR strip whose flight has none (H175 VR-Q4), at the holder. */
export function canAssignCode(strip, flightData) {
  return _held(strip) && !(flightData && flightData.identity && flightData.identity.beaconAssigned);
}
export function assignCode(strip) {
  return sendEfspMutation(strip.ownerPositionId, strip, { kind: 'AssignCode' });
}

/** IFR -> VFR in place ("IFR cancelled"), on a live IFR strip the controller holds. */
const IFR_STRIP_TYPES = ['DEPARTURE', 'ARRIVAL', 'OVERFLIGHT'];
export function canCancelIfr(strip) {
  return !!strip && strip.state !== 'DROPPED' && IFR_STRIP_TYPES.includes(strip.stripType)
    && getActingPositions().includes(strip.ownerPositionId) && !!vfrBayOf(strip.ownerPositionId);
}
export function cancelIfr(strip) {
  return sendEfspMutation(strip.ownerPositionId, strip, { kind: 'ChangeFlightRules', to: 'VFR' });
}
/** VFR -> IFR in place, as one of the IFR strip types the holder originates (the caller names it). */
export function changeToIfr(strip, stripType) {
  return sendEfspMutation(strip.ownerPositionId, strip, { kind: 'ChangeFlightRules', to: 'IFR', stripType });
}
