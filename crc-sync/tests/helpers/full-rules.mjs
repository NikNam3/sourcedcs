// A complete `rules` object for a BoardStore built in a unit test (ARCH-D5): every rule the Board reads, each
// defaulting to the neutral answer (the one the Board gave when the rule was absent), with the test's own rules
// laid over it. `fullRules({ isStaffed: () => true })`. The name list is src/efsp/required-rules.js.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { REQUIRED_RULES } = require('../../src/efsp/required-rules.js');
const coordination = require('../../src/efsp/coordination.js');

// A Position with every Bay: a fixture's Bay ids are arbitrary, so the "is this one of the Position's Bays" check passes.
class EveryBay extends Array { some() { return true; } }

export const DEFAULT_RULES = {
  activeMarsaFor: () => null,
  airspaceFor: () => null,
  aitAuthorized: false,
  bayDescriptor: () => null,
  bayExists: () => true,
  bayForImpliedState: () => null,
  bayHoldsRole: () => null,
  bayImpliesState: () => null,
  baysFor: () => new EveryBay(),
  canActOnState: () => true,
  canCreateStripRole: () => true,
  canMutate: () => true,
  canRecordCarrierHandoff: () => false,
  canSendSfaRotationTransfer: () => false,
  carrierAppendFlight: () => null,
  carrierApplyEffect: () => ({ ok: true }),
  carrierCase: () => null,
  carrierInStack: () => true,
  carrierLaneFor: () => null,
  carrierRetireFlight: () => null,
  carrierHandoffs: {},
  computeNla: () => null,
  coordinationBayFor: () => null,
  coordinationEffect: () => null,
  coordinationEligibleState: (role) => coordination.coordinationEligibleState(role),
  consolidatedAt: () => null,
  drainMarsaRegimeWrites: () => [],
  facilityId: null,
  fieldStateFor: () => null,
  handBackTargetsFor: () => null,
  isBlockVisible: () => true,
  isStaffed: () => false,
  isSelfCoordinated: () => false,
  isValidRole: () => true,
  isValidState: () => true,
  liveStripsForFdr: () => 0,
  marsaInterlockFor: () => null,
  mayActBesideOwner: () => false,
  peerBoard: () => null,
  resolveBlockTarget: () => null,
  retireMarsaForFdr: () => null,
  sfaFrequencyFor: () => null,
  sfaRackFor: () => null,
  sfaRotationReceiver: () => null,
  sfaTransfers: {},
  standingReleases: [],
  tofiCounterparts: (positionId) => require('../../src/efsp/permission.js').tofiCounterparts(positionId),
  tofiEligibleState: (role) => coordination.tofiEligibleState(role),
  validateCarrierHandoff: () => ({ ok: true }),
  voidMarsaForAssignment: () => null,
};

export function fullRules(overrides = {}) {
  return { ...DEFAULT_RULES, ...overrides };
}
export { REQUIRED_RULES };
