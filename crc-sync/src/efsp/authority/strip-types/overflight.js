'use strict';

// The OVERFLIGHT strip-type family (authority registry, docs/adr/0095): states,
// NLA table, state owners, and the replica/sender states (replicaStateOnReceipt,
// senderStateOnAccept below).

// [SOURCE-DEFINED] (docs/adr/0087, superseding 0023's two-state lifecycle) —
// the guide's own OVERFLIGHT lifecycle (EFSPImplementationGuide.md:214, itself
// marked [SOURCE-DEFINED]): INBOUND -> IN_SECTOR -> HANDED_OFF -> DROPPED.
// The names are the guide's; the NLA labels and the owners are ours. INBOUND
// and HANDED_OFF are also ARRIVAL's and DEPARTURE's state names: states are
// per strip type, so nothing may compare a bare state without its strip type.
const OVERFLIGHT_STATES = ['INBOUND', 'IN_SECTOR', 'HANDED_OFF', 'DROPPED'];

// [SOURCE-DEFINED] (docs/adr/0087) — the guide's four-state OVERFLIGHT
// lifecycle (INBOUND, IN_SECTOR, HANDED_OFF, DROPPED); who owns each state is
// ours, not the guide's. Both Positions that may originate one
// (permission.js's CREATE_STRIP_TYPE_PERMISSIONS) may also act on it, same
// "self-originator owns it" precedent as ARRIVAL's INBOUND row.
const OVERFLIGHT_STATE_OWNERS = {
  INBOUND:    ['AP', 'CTR'],
  IN_SECTOR:  ['AP', 'CTR'],
  HANDED_OFF: ['AP', 'CTR'],
  // DROPPED is terminal — no NLA exists for it, so no entry is needed.
};

/**
 * OVERFLIGHT's entire NLA table (docs/adr/0087) — a flight transiting this
 * Facility's airspace without landing or departing here at all (guide §2).
 * No staffing gating, no transferTo: whichever Position originated it
 * (permission.js's CREATE_STRIP_TYPE_PERMISSIONS) works it solo. IN_SECTOR's step
 * is "leaves our airspace" — to an agency this server does not model, so
 * nothing is transferred. Handing the flight to our own next Facility
 * (CTR -> AP) is Coordinate/HANDOFF, as at ARRIVAL's CENTER INBOUND.
 */
function computeOverflightNla(strip) {
  switch (strip.state) {
    case 'INBOUND':
      return { toState: 'IN_SECTOR' };
    case 'IN_SECTOR':
      return { toState: 'HANDED_OFF' };
    case 'HANDED_OFF':
      return { toState: 'DROPPED' };
    case 'DROPPED':
    default:
      return null;
  }
}

const family = {
  stripType: 'OVERFLIGHT',
  states: OVERFLIGHT_STATES,
  initialState: 'INBOUND',
  stateOwners: OVERFLIGHT_STATE_OWNERS,
  computeNla: computeOverflightNla,
  countablePreDropStates: ['IN_SECTOR', 'HANDED_OFF'],  // it was worked (docs/adr/0087); dropped still INBOUND, it never was
  excludedWhenNotCountable: 'NEVER_TRANSITED',
  // docs/adr/0087: a flight handed to our next Facility arrives INBOUND there
  // and walks the four states again. { senderState: replicaState }
  replicaStateOnReceipt: { IN_SECTOR: 'INBOUND' },
  // ...and when the receiver ACCEPTs a HANDOFF, the sender's Strip has left
  // its sector. { primitive: { senderState: stateAfterAccept } }
  senderStateOnAccept: { HANDOFF: { IN_SECTOR: 'HANDED_OFF' } },
  coordinationEligibleState: 'IN_SECTOR',         // docs/adr/0087 (F14)
  tofiEligibleState: 'IN_SECTOR',
};

module.exports = { family, OVERFLIGHT_STATES, OVERFLIGHT_STATE_OWNERS, computeOverflightNla };
