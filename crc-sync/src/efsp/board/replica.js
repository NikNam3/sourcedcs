'use strict';

// The receiver's replica Strip: the mint the two peer-receive paths share (coordination's
// receiveCoordinationProposal and TOFI's receiveTofiProposal). Both land a brand-new Strip at the tail of the
// receiving Position's Coordination Bay rack, carrying the sender's flight data; they differ in strip type, state
// and which link record they hang on it. Seam rule 1: requires only strip-util.js.

const crypto = require('crypto');
const { newFlags } = require('./strip-util');

/**
 * Mints the replica and inserts it into the Board state.
 * @param {{state:object, placement:object, clock:{now:()=>string}}} deps  the Board's state, placement and clock
 * @param {object} p
 * @param {string} p.flightDataId
 * @param {string} p.stripType
 * @param {string} p.state  the replica's starting EfspState
 * @param {string} p.toPositionId  the owner
 * @param {{bayId:string, rackIds:string[]}} p.coordinationBay
 * @param {string|null} [p.by]
 * @param {(now:string)=>object} p.links  the link record(s), spread between `flags` and `createdAt` (key order is part of the Strip's JSON)
 * @returns {object} the inserted Strip
 */
function mintReplica({ state, placement, clock }, { flightDataId, stripType, state: startState, toPositionId, coordinationBay, by, links }) {
  const stripId = crypto.randomUUID();
  const now = clock.now();
  const rackStrips = state.rack(coordinationBay.bayId, coordinationBay.rackIds[0]);
  const afterStripId = rackStrips.length ? rackStrips[rackStrips.length - 1].stripId : null;
  const orderKey = placement.resolveOrderKey(coordinationBay.bayId, coordinationBay.rackIds[0], afterStripId, null, null);

  const strip = {
    stripId,
    cid: state.nextCid(),
    flightDataId,
    rev: 1,
    stripType,
    state: startState,
    ownerPositionId: toPositionId,
    bayId: coordinationBay.bayId,
    rackId: coordinationBay.rackIds[0],
    orderKey,
    annotations: {},
    flags: newFlags(),
    // No `correlation` — it is keyed by flightDataId, and a replica shares the
    // originator's flight data (docs/adr/0013), so it shares the correlation too.
    ...links(now),
    createdAt: now, updatedAt: now, updatedBy: by || null,
  };
  state.insert(strip);
  return strip;
}

module.exports = { mintReplica };
