'use strict';

// Which flights the final Position holds (docs/adr/0139, decisions H164 FT-Q8). Pure: it reads the Facility config and the
// Boards it is handed and keeps nothing.
//
// "The final Position" is a role read from Facility data, never a Position id (ADR 0132, H160): a Position that owns a Bay
// whose descriptor says `view: 'final'` in that Facility (Incirlik's PAR, the carrier's lane controllers; any number of
// Facilities, any number of finals). A flight is held on a final while its FINAL Strip is owned by such a Position and is
// in a state of the final itself: ON_FINAL, or the carrier's BALL. A missed approach is not (BOLTER_WAVEOFF, the PAR's
// missed-approach Bay, and the airfield's MISSED_APPROACH conversion, which hands the Strip back to the approach control
// Position as an ARRIVAL): the climb-out heading and altitude are an assignment again (JO 7110.65BB para 5-10-12) and are
// checked as any arrival's.

/** The states of a FINAL Strip that are the final itself (the missed approach and DROPPED are not). */
const ON_FINAL_STATES = Object.freeze(['ON_FINAL', 'BALL']);

/** The Positions of a Facility that own a final Bay (`view: 'final'`). */
function finalPositionsOf(facilityConfig, facilityId) {
  const out = new Set();
  for (const bay of facilityConfig.getAllBays(facilityId)) if (bay.view === 'final' && bay.positionId) out.add(bay.positionId);
  return out;
}

/**
 * Every flight a final Position holds, across every Facility.
 * @param {{facilityConfig: {getFacilityIds:Function, getAllBays:Function}, boardStoreFor: (facilityId:string)=>object|null}} d
 * @returns {Map<string, {facilityId:string, positionId:string, strip:object}>} flightDataId -> the Strip on the final
 */
function flightsHeldOnFinal({ facilityConfig, boardStoreFor }) {
  const out = new Map();
  for (const facilityId of facilityConfig.getFacilityIds()) {
    const finalPositions = finalPositionsOf(facilityConfig, facilityId);
    if (!finalPositions.size) continue;
    let board = null;
    try { board = boardStoreFor(facilityId); } catch { board = null; }
    if (!board) continue;
    for (const strip of board.getAll()) {
      if (strip.stripType !== 'FINAL' || !ON_FINAL_STATES.includes(strip.state) || !strip.flightDataId) continue;
      if (!finalPositions.has(strip.ownerPositionId)) continue;
      out.set(strip.flightDataId, { facilityId, positionId: strip.ownerPositionId, strip });
    }
  }
  return out;
}

module.exports = { ON_FINAL_STATES, finalPositionsOf, flightsHeldOnFinal };
