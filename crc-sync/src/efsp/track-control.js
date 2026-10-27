'use strict';

// Track control: which Positions work a flight right now (docs/adr/0147, H176). A conflict alert is shown only there.
//
// The Position holding the flight's Strip has track control (STARS track ownership; the data block's owner letter,
// crc-desktop's atc-scope.js `owners`). Per live Strip:
//   - no coordination on it:                          its holder (`ownerPositionId`), VFR strips included (docs/adr/0146);
//   - a coordination that moves data ownership (HANDOFF, AIT: `COORDINATION_EFFECTS[...].dataOwnershipMoves`):
//       INITIATED  both sides: the transferring Strip's holder and the receiver's minted replica (a handoff in progress
//                  is worked from both ends until it is accepted, ours, H176's default);
//       ACTIVE     the receiver's replica only (accepted: the track is the receiver's);
//       otherwise  (REJECTED, …) the transferring Strip only;
//   - any other coordination (POINT_OUT, TRAFFIC, OPERATIONAL_REQUEST): the original holder only; a point-out's replica
//     is the receiver's view of someone else's aircraft, not control of it;
//   - an open VFR handoff (`strip.vfrHandoff`, docs/adr/0146): the holder and the Position it names, until ACCEPT or RECALL.
// A DROPPED Strip holds nothing. A flight with live Strips in several Facilities is controlled at each holder.

const { COORDINATION_EFFECTS } = require('./authority/primitives');

/** Whether a coordination primitive moves the Strip (track ownership) on ACCEPT. */
function movesOwnership(primitive) {
  const effect = Object.prototype.hasOwnProperty.call(COORDINATION_EFFECTS, primitive) ? COORDINATION_EFFECTS[primitive] : null;
  return !!(effect && effect.dataOwnershipMoves);
}

/** Whether this live Strip's holder has track control (the header's table, without the VFR handoff's receiver). */
function holdsControl(strip) {
  const c = strip.coordination;
  if (!c) return true;
  const replica = !!c.mintedForCoordination;
  if (movesOwnership(c.primitive)) {
    if (c.state === 'INITIATED') return true;
    if (c.state === 'ACTIVE') return replica;
    return !replica;
  }
  return !replica;
}

/**
 * The Positions with track control of one flight.
 * @param {{facilityId:string, strip:object}[]} entries every Strip of the flight, each with its Board's Facility
 * @returns {{facilityId:string, positionId:string}[]} without repeats
 */
function trackControlPositions(entries) {
  const out = [];
  const seen = new Set();
  const add = (facilityId, positionId) => {
    if (!facilityId || !positionId) return;
    const key = `${facilityId}/${positionId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ facilityId, positionId });
  };
  for (const { facilityId, strip } of entries || []) {
    if (!strip || strip.state === 'DROPPED' || !strip.ownerPositionId) continue;
    if (holdsControl(strip)) add(facilityId, strip.ownerPositionId);
    if (strip.vfrHandoff && strip.vfrHandoff.toPositionId) add(facilityId, String(strip.vfrHandoff.toPositionId));
  }
  return out;
}

module.exports = { trackControlPositions, holdsControl };
