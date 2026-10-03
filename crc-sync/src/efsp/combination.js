'use strict';

// A tower controller combining Positions (docs/adr/0105, H104). Pure: it reads a PositionStore and the Board's Strips, and
// returns what the wire carries. Nothing here blocks anything (H104 GCLC-1, GCLC-2: warn, never block).
//
// Doctrine, applied to a USAF field by analogy (research gc-lc-consolidation §1): FAA JO 7210.3 ¶2-6-5b (non-local functions
// are combined at LC only in significantly reduced traffic), ¶2-6-5c and ¶10-3-8a4 (never with LUAW operations; ground control
// and clearance delivery are named), ¶3-3-3 (every allocated frequency stays monitored). The wording and the triggers are
// [SOURCE-DEFINED].

const LOCAL = 'LC';
// The non-local tower Positions LC must not be combined with (¶10-3-8a4 names ground control, clearance delivery).
const NON_LOCAL_TOWER = Object.freeze(['GC', 'CD']);
// The Position a vacated GC's Strips are offered to.
const GROUND = 'GC';
const LUAW_STATES = Object.freeze(['RUNWAY_QUEUE', 'LUAW']);

/** True when a DEPARTURE of the Facility is in RUNWAY_QUEUE or LUAW (the EFSP's "LUAW is in use"). */
function luawInUse(strips) {
  return (strips || []).some(s => s.stripType === 'DEPARTURE' && LUAW_STATES.includes(s.state));
}

/**
 * The combination `controllerId` holds at this Facility, or null. Only Positions they are PRIMARY at count.
 * @returns {{positions:string[], with:string[], luaw:boolean, frequencies:object[]}|null}
 */
function combinationOf(positionStore, controllerId, strips) {
  const held = positionStore.primaryPositionsOf(controllerId);
  if (!held.includes(LOCAL)) return null;
  const withIds = NON_LOCAL_TOWER.filter(id => held.includes(id));
  if (withIds.length === 0) return null;
  const positions = [LOCAL, ...withIds];
  return {
    positions, with: withIds, luaw: luawInUse(strips),
    frequencies: positionStore.frequenciesHeldBy(controllerId).filter(f => positions.includes(f.positionId)),
  };
}

/**
 * The offer to make when `vacated` Positions have just been left: GC unstaffed with Strips and a Primary at LC who is not
 * the controller who left it. Returns `{facilityId, positionId, offer, count}` (efsp-ws makes the frame) or null.
 */
function offerAfterSignOff(positionStore, boardStore, facilityId, vacatedIds, leavingControllerId) {
  if (!vacatedIds.includes(GROUND) || positionStore.isStaffed(GROUND)) return null;
  const lcPrimary = positionStore.primaryOf(LOCAL);
  if (!lcPrimary || lcPrimary === leavingControllerId) return null;
  const count = boardStore.getAll().filter(s => s.ownerPositionId === GROUND && s.state !== 'DROPPED').length;
  if (count === 0) return null;
  return { facilityId, positionId: LOCAL, offer: GROUND, count };
}

module.exports = { combinationOf, offerAfterSignOff, luawInUse, LOCAL, NON_LOCAL_TOWER, GROUND, LUAW_STATES };
