'use strict';

// The rules a BoardStore reads (ARCH-D5, H80): every name `board-store.js` and `board/**` reads as `rules.<name>`.
// A BoardStore built without one throws at construction, naming what is missing, so a missing rule is a loud
// start-up error and never a check that is silently off. tests/freeze/freeze-guards.test.mjs (guard 1) scans the
// source for the names it reads and fails when this list and the scan differ: that scan is the one source.

const REQUIRED_RULES = [
  'activeMarsaFor', 'airspaceFor', 'aitAuthorized', 'bayDescriptor', 'bayExists', 'bayForImpliedState', 'bayHoldsStripType',
  'bayImpliesState', 'baysFor', 'canActOnState', 'canCreateStripType', 'canMutate', 'canMutateAction', 'controlAxisFor', 'canRecordCarrierHandoff',
  'canHandOffToFinal', 'canRecordFinalCall', 'carrierAppendFlight', 'carrierApplyEffect', 'carrierCase', 'carrierInStack',
  'carrierLaneFor', 'carrierRetireFlight', 'carrierHandoffs', 'computeNla', 'coordinationBayFor', 'coordinationEffect',
  'conversionFor', 'coordinationEligibleState', 'consolidatedAt', 'divertDestinationFor', 'drainMarsaRegimeWrites', 'facilityId', 'formationEligibility', 'runwayStatusFor',
  'handBackTargetsFor', 'handBackTo', 'isBlockVisible', 'isStaffed', 'isSelfCoordinated', 'isValidStripType', 'isValidState',
  'liveStripsForFlightData', 'marsaInterlockFor', 'mayActBesideOwner', 'peerBoard', 'regimeLocation', 'resolveBlockTarget', 'retireMarsaForFlightData',
  'sfaFrequencyFor', 'sfaRackFor', 'standingReleases', 'tofiCounterparts',
  'tofiEligibleState', 'validateCarrierHandoff', 'voidMarsaForAssignment',
];

// The rules that are data, not functions, and the kind each must be. Every other required rule is a function.
const DATA_RULES = {
  aitAuthorized: (v) => typeof v === 'boolean',
  carrierHandoffs: (v) => v !== null && typeof v === 'object',
  standingReleases: (v) => Array.isArray(v),
  facilityId: (v) => v === null || typeof v === 'string',
};

/**
 * Throws when `rules` lacks a required name, or has one of the wrong kind (a function rule that is `null` is as
 * missing as an absent one; `false`, `null` and `[]` are legitimate only for the data rules above).
 */
function assertRules(rules) {
  const bad = REQUIRED_RULES.filter(name => {
    if (!rules || !(name in rules)) return true;
    return DATA_RULES[name] ? !DATA_RULES[name](rules[name]) : typeof rules[name] !== 'function';
  });
  if (bad.length) throw new Error(`BoardStore built without ${bad.length} required rule(s) (absent, or not a ${'function'} where one is needed): ${bad.join(', ')}`);
}

module.exports = { REQUIRED_RULES, DATA_RULES, assertRules };
