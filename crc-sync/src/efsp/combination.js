'use strict';

// A controller taking the hat of a Position nobody holds (docs/adr/0105, docs/adr/0110, H104, H111). Pure: it reads a
// PositionStore and the Board's Strips, and returns what the wire carries. Nothing here blocks anything (H104 GCLC-1,
// GCLC-2: warn, never block).
//
// Doctrine, applied to a USAF field by analogy (research gc-lc-consolidation §1): FAA JO 7210.3 ¶2-6-5b (non-local functions
// are combined at LC only in significantly reduced traffic), ¶2-6-12 (tower and radar approach not normally combined outside
// the midwatch), ¶2-6-5c and ¶10-3-8a4 (never with LUAW operations; ground control and clearance delivery are named), ¶3-3-3
// (every allocated frequency stays monitored). The wording and the triggers are [SOURCE-DEFINED].

const LOCAL = 'LC';
// Every Incirlik Position but LC (¶10-3-8a4 allows LC with other local positions).
// GC, CD and OPS are the tower's non-local functions (¶2-6-5b); AP and PAR are radar approach (¶2-6-12).
const NON_LOCAL = Object.freeze(['OPS', 'CD', 'GC', 'AP', 'PAR']);
const LUAW_STATES = Object.freeze(['RUNWAY_QUEUE', 'LUAW']);

/** True when a DEPARTURE of the Facility is in RUNWAY_QUEUE or LUAW (the EFSP's "LUAW is in use"). */
function luawInUse(strips) {
  return (strips || []).some(s => s.stripType === 'DEPARTURE' && LUAW_STATES.includes(s.state));
}

/** Strips on, or committed to, the runway: a DEPARTURE in LUAW and an ARRIVAL in FINAL (not DEPARTED: airborne). */
function onRunwayCount(strips) {
  return (strips || []).filter(s => (s.stripType === 'DEPARTURE' && s.state === 'LUAW') || (s.stripType === 'ARRIVAL' && s.state === 'FINAL')).length;
}

/**
 * The combination `controllerId` holds at this Facility, or null. Only Positions they are PRIMARY at count.
 * @returns {{positions:string[], with:string[], luaw:boolean, frequencies:object[]}|null}
 */
function combinationOf(positionStore, controllerId, strips) {
  const held = positionStore.primaryPositionsOf(controllerId);
  if (!held.includes(LOCAL)) return null;
  const withIds = NON_LOCAL.filter(id => held.includes(id));
  if (withIds.length === 0) return null;
  const positions = [LOCAL, ...withIds];
  return {
    positions, with: withIds, luaw: luawInUse(strips),
    frequencies: positionStore.frequenciesHeldBy(controllerId).filter(f => positions.includes(f.positionId)),
  };
}

/**
 * The hats `positionId`'s Primary is offered (docs/adr/0110 §3, §6): each unstaffed Position whose first staffed `consolidation`
 * member is `positionId` and that still owns a live Strip. A TACTICAL `handBack` source is never offered (its Strips move).
 * `observersFirst` is true when the Position has Observers, who are offered Primary there before this.
 * @param {object[]} strips the Facility's Strips (any state; DROPPED is ignored)
 * @returns {{positionId:string, count:number, onRunway:number, observersFirst:boolean}[]}
 */
function hatOffersFor(positionStore, positionId, strips) {
  const out = [];
  for (const q of positionStore.positionIds()) {
    if (q === positionId || positionStore.isStaffed(q) || positionStore.hasHandBack(q)) continue;
    if (positionStore.hatTakerOf(q) !== positionId) continue;
    const owned = (strips || []).filter(s => s.ownerPositionId === q && s.state !== 'DROPPED');
    if (owned.length === 0) continue;
    out.push({ positionId: q, count: owned.length, onRunway: onRunwayCount(owned), observersFirst: positionStore.observersOf(q).length > 0 });
  }
  return out;
}

module.exports = { combinationOf, hatOffersFor, luawInUse, onRunwayCount, LOCAL, NON_LOCAL, LUAW_STATES };
