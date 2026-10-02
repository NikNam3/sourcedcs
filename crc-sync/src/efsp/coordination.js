'use strict';

// Cross-Facility coordination primitives (EFSPImplementationGuide.md §4.6)
// and TOFI (§4.6.3). The tables now live in the authority registry (S3-2):
// the primitive and TOFI effect tables in authority/primitives.js, and each
// Strip type's coordination/TOFI eligibility in its strip type family
// (authority/strip-types/<strip-type>.js), composed in authority/index.js. This module is
// their facade and exports exactly what it exported before; it is injected
// into the Board as `rules.coordinationEffect` &c from index.js (board/coordination.js reads them).

const { COORDINATION_PRIMITIVES, COORDINATION_EFFECTS, TOFI_EFFECTS } = require('./authority/primitives');
const { COORDINATION_ELIGIBLE_STATES, TOFI_ELIGIBLE_STATES } = require('./authority');

function isCoordinationPrimitive(primitive) {
  return COORDINATION_PRIMITIVES.has(primitive);
}

/** @returns {{radarIdTransfers:boolean, commsTransfers:boolean, dataOwnershipMoves:boolean, separationResponsibilityMoves:boolean, acceptPhrase:string|null}|null} */
function coordinationEffect(primitive) {
  return COORDINATION_EFFECTS[primitive] || null;
}

/** @returns {string|undefined} the EfspState `stripType` must be in to propose a coordination link, or undefined if this role never can. */
function coordinationEligibleState(stripType) {
  return COORDINATION_ELIGIBLE_STATES[stripType];
}

/** @returns {{acceptPhrase:string}|null} */
function tofiEffect(direction) {
  return TOFI_EFFECTS[direction] || null;
}

/** @returns {string|undefined} the EfspState `stripType` must be in to open a TOFI ENTRY, or undefined if this role never can. */
function tofiEligibleState(stripType) {
  return TOFI_ELIGIBLE_STATES[stripType];
}

module.exports = {
  COORDINATION_PRIMITIVES, COORDINATION_EFFECTS, COORDINATION_ELIGIBLE_STATES, TOFI_EFFECTS, TOFI_ELIGIBLE_STATES,
  isCoordinationPrimitive, coordinationEffect, coordinationEligibleState, tofiEligibleState,
};
