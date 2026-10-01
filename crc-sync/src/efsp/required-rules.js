'use strict';

// The rules a BoardStore reads (ARCH-D5, H80): every name `board-store.js` and `board/**` reads as `rules.<name>`.
// A BoardStore built without one throws at construction, naming what is missing, so a missing rule is a loud
// start-up error and never a check that is silently off. tests/freeze/freeze-guards.test.mjs (guard 1) scans the
// source for the names it reads and fails when this list and the scan differ: that scan is the one source.

const REQUIRED_RULES = [
  'activeMarsaFor', 'airspaceFor', 'aitAuthorized', 'bayDescriptor', 'bayExists', 'bayForImpliedState', 'bayHoldsRole',
  'bayImpliesState', 'baysFor', 'canActOnState', 'canCreateStripRole', 'canMutate', 'canRecordCarrierTransfer',
  'canSendSfaRotationTransfer', 'carrierAppendFlight', 'carrierApplyEffect', 'carrierCase', 'carrierInStack',
  'carrierLaneFor', 'carrierRetireFlight', 'carrierTransfers', 'computeNla', 'coordinationBayFor', 'coordinationEffect',
  'coordinationEligibleState', 'coveringPositionFor', 'drainMarsaRegimeWrites', 'facilityId', 'fieldStateFor',
  'handBackTargetsFor', 'isBlockVisible', 'isOccupied', 'isSelfCoordinated', 'isValidRole', 'isValidState',
  'liveStripsForFdr', 'marsaInterlockFor', 'mayActBesideOwner', 'peerBoard', 'resolveBlockTarget', 'retireMarsaForFdr',
  'sfaFrequencyFor', 'sfaRackFor', 'sfaRotationReceiver', 'sfaTransfers', 'standingReleases', 'tofiCounterparts',
  'tofiEligibleState', 'validateCarrierTransfer', 'voidMarsaForAssignment',
];

/** Throws when `rules` lacks a required name (`null`, `false` and `[]` are values; only an absent key is missing). */
function assertRules(rules) {
  const missing = REQUIRED_RULES.filter(name => !rules || !(name in rules));
  if (missing.length) throw new Error(`BoardStore built without ${missing.length} required rule(s): ${missing.join(', ')}`);
}

module.exports = { REQUIRED_RULES, assertRules };
