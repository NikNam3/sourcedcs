'use strict';

// The MARSHAL Role family (authority registry, S3-2). States and NLA moved
// from nla.js, state owners from permission.js.

// The carrier's three Roles (docs/adr/0064 B2, docs/adr/0074), guide §4.1 and
// §9.12. [SOURCE-DEFINED] state names, chosen so they collide with no other
// Role's state but DROPPED: in particular NOT `FINAL`, which is an ARRIVAL
// *state* above (the Role named FINAL below lives on strip.role, not
// strip.state). INELIGIBLE_STATES and Bay `impliesState` are role-blind string
// sets, so a clash would be silent.
//
// MARSHAL is the carrier's holding/launch Role (a launch is a MARSHAL Strip in
// LAUNCH; the recovery is a NEW MARSHAL Strip on the same fdrId, so EEAT,
// which lives on the FDR, survives to it). FINAL is the talk-down Role, shared
// with PAR (L18); PATTERN is the visual-pattern Role, shared with RSU (L18).
const MARSHAL_STATES = ['LAUNCH', 'IN_STACK', 'COMMENCED', 'DROPPED'];

// The carrier's three Roles (docs/adr/0064 B2, docs/adr/0074), [SOURCE-DEFINED]
// like every state table here: guide §4.1 names the Positions and §9.12 the
// hand-overs, and neither publishes "normally owned by". The Marshal owns a
// flight until Commence; then the lane controller owns COMMENCED, ON_FINAL,
// BALL and BOLTER_WAVEOFF; PriFly owns the pattern. Case I and Case II Strips
// reach PriFly by their own transfer (carrier/handoffs.js).
const CV_LANES = ['CV_APP1', 'CV_APP2'];
const MARSHAL_STATE_OWNERS = {
  LAUNCH:    ['CV_MARSHAL'],
  IN_STACK:  ['CV_MARSHAL'],
  COMMENCED: CV_LANES,
};

/**
 * MARSHAL's NLA table (docs/adr/0064 B2, docs/adr/0074). A NLA result may carry
 * `carrierTransfer`, the key of a CARRIER_TRANSFERS row (carrier/handoffs.js):
 * board-store.js then applies the whole transfer (ownership, Role, stack effect,
 * the trigger type recorded) instead of a bare state write, so the button and
 * the dedicated CarrierTransfer op are ONE implementation. `roleChange` names
 * the Role the Strip takes in place. Every trigger is a controller gesture
 * (guide §10.3, D5): nothing here reads a radar contact.
 */
function computeMarshalNla(strip, fdr, now, ctx) {
  switch (strip.state) {
    case 'LAUNCH':
      // "Launched": the launch Strip ends. The recovery will be a new MARSHAL
      // Strip on the same flight, and EEAT is on the flight (ADR 0064).
      return { toState: 'DROPPED' };

    case 'IN_STACK': {
      const caseValue = ctx.carrierCase();
      if (!ctx.carrierInStack(strip)) return { inhibited: 'not in the Marshal stack — give it a stack position first' };
      if (caseValue === 'I') {
        // Case I has no Marshal hand-over in the guide; this row is
        // [SOURCE-DEFINED] (L4 briefing Q8) and reuses the controller trigger.
        if (!ctx.isStaffed('CV_PRIFLY') && !ctx.consolidatedAt('CV_PRIFLY')) {
          return { inhibited: 'no receiving Position present' };
        }
        return { toState: 'IN_PATTERN', transferTo: 'CV_PRIFLY', roleChange: 'PATTERN', carrierTransfer: 'MARSHAL_TO_PATTERN_CASE_I' };
      }
      const lane = ctx.carrierLaneFor(strip);
      if (!lane) return { inhibited: 'no receiving Position present' };
      // Case II's "See you" (MARSHAL_TO_PRIFLY) is a SECOND, distinct button,
      // not this one (§3.5 rule 1: one Next Logical Action per Strip).
      return { toState: 'COMMENCED', transferTo: lane, carrierTransfer: 'MARSHAL_TO_APPROACH' };
    }

    case 'COMMENCED':
      // "Radar contact": the lane controller has the aircraft on the scope.
      // The Role changes in place (as ConvertToArrival does, ADR 0023) and the
      // Strip stays with the lane.
      return { toState: 'ON_FINAL', roleChange: 'FINAL', carrierTransfer: 'APPROACH_TO_FINAL' };

    case 'DROPPED':
    default:
      return null;
  }
}

// The carrier Roles' countability (docs/adr/0074), [SOURCE-DEFINED]: a launch
// is a movement (the aircraft left the deck), a trap is one, and a recovered
// aircraft in the pattern is one. A flight that passes MARSHAL -> FINAL ->
// PATTERN is dropped once, from the last Strip, so it counts once.
const family = {
  role: 'MARSHAL',
  states: MARSHAL_STATES,
  initialState: 'IN_STACK',
  stateOwners: MARSHAL_STATE_OWNERS,
  computeNla: computeMarshalNla,
  countablePreDropStates: ['LAUNCH'],
  excludedWhenNotCountable: 'NEVER_DEPARTED',
  replicaStateOnReceipt: null,
  senderStateOnAccept: null,
  coordinationEligibleState: undefined,
  tofiEligibleState: undefined,
};

module.exports = { family, MARSHAL_STATES, MARSHAL_STATE_OWNERS, CV_LANES, computeMarshalNla };
