'use strict';

// Per-acting-Position permission evaluation (EFSPImplementationGuide.md
// §4.8.4): evaluated for the SINGLE acting Position on a Mutation, NEVER as a
// union of every Position a controller is signed on to (defect D21): "Permissions
// MUST be evaluated per acting Position, never as the union of the signed-on set."
// canMutate()'s signature is the guard by construction: it takes exactly one
// actingPositionId, with nowhere for a set to sneak in.
//
// The coordination primitives exist (guide §4.6): their table is
// authority/primitives.js and their mechanics board/coordination.js and
// board/tofi.js. HANDOFF, POINT_OUT and TOFI are ops like any other.
//
// The tables live in the authority registry (docs/adr/0095; authority/): the
// op-kind vocabulary (the coordination kinds included) in op-kinds.js, the class rules in classes.js, each Position
// family's grants and capability columns in positions/<family>.js (the MRU
// capability table is docs/adr/0080), each strip type's state owners in
// strip-types/<type>.js, all composed in authority/index.js. This module is
// their facade, plus the one-Position predicates (the D21 gates).
//
// Ownership (does the acting Position own THIS Strip?) is enforced separately
// and unconditionally by the Board (board/strip-ops.js's NOT_OWNER gate). This
// module answers a different question: is this Position CLASS allowed to
// perform this kind of Mutation at all, regardless of ownership?
//
// CreateStrip is a SECOND, strip-type-scoped permission axis
// (canCreateStripType): a flat table in which every Position can do everything
// would prove nothing about per-acting-Position evaluation.

const authority = require('./authority');
const { OP_KINDS, COORDINATION_OP_KINDS, AP_CTR_ONLY_OP_KINDS, TOFI_OP_KINDS, AIRSPACE_ENTRY_OP_KINDS, FORMATION_OP_KINDS } = require('./authority/op-kinds');
const { NO_STRIP_OP_CLASSES, _worksNoStrips, _hasNoScope } = require('./authority/classes');
const {
  TACTICAL_CAPABILITIES, READ_SCOPES, TOFI_ANSWER_ACTIONS, handBackTargetsFor, tofiAnswererFor, readScopeFor,
} = require('./authority/positions/tactical');
const {
  CARRIER_CAPABILITIES, canEditCarrierState, canSequenceMarshalStack, canRecordCarrierHandoff,
} = require('./authority/positions/carrier');
const {
  INCIRLIK_CAPABILITIES, canRotateSfa, canSendSfaRotationTransfer, sfaRotationReceiver, sfaControllerPositions, incirlikPositionsWith,
} = require('./authority/positions/incirlik-military');
const { DEPARTURE_STATE_OWNERS } = require('./authority/strip-types/departure');
const { ARRIVAL_STATE_OWNERS } = require('./authority/strip-types/arrival');
const { OVERFLIGHT_STATE_OWNERS } = require('./authority/strip-types/overflight');
const { MISSION_STATE_OWNERS } = require('./authority/strip-types/mission');
const { MARSHAL_STATE_OWNERS } = require('./authority/strip-types/marshal');
const { FINAL_STATE_OWNERS } = require('./authority/strip-types/final');
const { PATTERN_STATE_OWNERS } = require('./authority/strip-types/pattern');
const {
  CREATE_STRIP_TYPE_PERMISSIONS, STATE_OWNERS_BY_STRIP_TYPE, RUNWAY_STATUS_OP_OWNERS, NON_OWNER_BLOCK_WRITES, TOFI_COUNTERPARTS,
} = authority;

/**
 * Exactly two parameters: ONE acting Position, never a signed-on set — D21 by
 * construction. A controller signed on to LC and AP acts as one or the other, and
 * an acknowledgement sent as LC never counts as AP's.
 */
function canActOnRunwayStatus(actingPositionId, opKind) {
  const owners = Object.prototype.hasOwnProperty.call(RUNWAY_STATUS_OP_OWNERS, opKind) ? RUNWAY_STATUS_OP_OWNERS[opKind] : null;
  return !!owners && owners.includes(actingPositionId);
}

/**
 * The few ops a Position may perform on a Strip it does NOT own (docs/adr/0080).
 * Ownership stays the rule (guide §4.4 rule 2); each row below is one narrow,
 * named exception, and nothing else crosses it (T1: a general "TAC_C2 may act
 * on AIC's lines" would undo H2).
 *
 *  - TOFI answer (B2): on a MISSION Strip, the Position `tofiAnsweredBy` names
 *    for its owner (TAC_C2 for an AIC-held line; AIC "works under TAC_C2's
 *    TOFI", guide §4.1, ADR 0025) may ACCEPT, REJECT or TRANSFER_COMMS.
 *  - Back to stack (docs/adr/0114, H117): the Marshal's CarrierHandoff COMMENCED_TO_MARSHAL on a COMMENCED MARSHAL Strip the
 *    lane holds.
 *  - OPS alert status (S-L13, H56): OPS owns Block 14E on a DEPARTURE at every
 *    state until it is DROPPED, whoever holds the Strip. Likewise 3G ORDNANCE (UI-A U1).
 * The acting Position must still hold the op kind (canMutate runs first).
 */
function mayActBesideOwner(actingPositionId, strip, op) {
  if (!strip || !op) return false;
  if (op.kind === 'TOFI' && strip.stripType === 'MISSION' && TOFI_ANSWER_ACTIONS.includes(op.action)) {
    return tofiAnswererFor(strip.ownerPositionId) === actingPositionId;
  }
  // docs/adr/0114: Back to stack. The Marshal sends a COMMENCED flight (the lane's Strip) back into its stack.
  if (op.kind === 'CarrierHandoff' && op.transfer === 'COMMENCED_TO_MARSHAL') {
    return actingPositionId === 'CV_MARSHAL' && strip.stripType === 'MARSHAL' && strip.state === 'COMMENCED';
  }
  if (op.kind === 'SetBlock' && strip.state !== 'DROPPED') {
    return NON_OWNER_BLOCK_WRITES.some(r => r.blockId === op.blockId && r.stripType === strip.stripType && r.positions.includes(actingPositionId));
  }
  return false;
}

/**
 * The role-scoped half of CreateStrip permission (see the module comment).
 * Structurally the same D21 guard as canMutate() — exactly one
 * actingPositionId, never a signed-on set.
 * @param {string} actingPositionId
 * @param {string} stripType — the strip type being created (e.g. 'DEPARTURE')
 * @returns {boolean}
 */
function canCreateStripType(actingPositionId, stripType) {
  const allowed = CREATE_STRIP_TYPE_PERMISSIONS[actingPositionId];
  return !!allowed && allowed.has(stripType);
}

/** @returns {{facilityId:string, positionId:string}[]} the valid TOFI counterparts for `actingPositionId`, or an empty array if it has none. */
function tofiCounterparts(actingPositionId) {
  return TOFI_COUNTERPARTS[actingPositionId] || [];
}

/**
 * @param {string} actingPositionId
 * @param {string} stripType
 * @param {string} state — the Strip's CURRENT state (the one being advanced FROM)
 * @returns {boolean}
 */
function canActOnState(actingPositionId, stripType, state) {
  const owners = (STATE_OWNERS_BY_STRIP_TYPE[stripType] || {})[state];
  return !!owners && owners.includes(actingPositionId);
}

/**
 * The predicates that read a Position's CLASS (facility-config's `positionClasses`): which ops it may do at all, whether
 * it may correlate or declare MARSA. Built by the composition root from the facility config it built, so nothing here
 * reads configuration when this file is required (docs/adr/0095 §4).
 * @param {{classOf:(positionId:string)=>string|null}} deps facility-config's getPositionClass
 */
function createPermission({ classOf }) {
  if (typeof classOf !== 'function') throw new Error('createPermission needs classOf (facility-config getPositionClass)');
  const PERMISSIONS = authority.permissionsFor(classOf); // the registry's table with the D12 strip-back applied
  const worksNoStrips = (positionId) => _worksNoStrips(classOf, positionId);
  const hasNoScope = (positionId) => _hasNoScope(classOf, positionId);

  /**
   * @param {string} actingPositionId — exactly one Position; never a set
   * @param {string} opKind
   * @returns {boolean}
   */
  function canMutate(actingPositionId, opKind) {
    if (worksNoStrips(actingPositionId)) return false;
    const allowed = PERMISSIONS[actingPositionId];
    return !!allowed && allowed.has(opKind);
  }

  /**
   * canMutate for one ACTION of an op kind (docs/adr/0101): a Position whose grant of a coordination kind is narrower
   * than the kind (CV_MARSHAL answers a HANDOFF, never proposes) lists its actions in the registry's COORDINATION_ACTIONS.
   */
  function canMutateAction(actingPositionId, opKind, action) {
    if (!canMutate(actingPositionId, opKind)) return false;
    const rows = Object.prototype.hasOwnProperty.call(authority.COORDINATION_ACTIONS, actingPositionId) ? authority.COORDINATION_ACTIONS[actingPositionId] : null;
    if (!rows || !Object.prototype.hasOwnProperty.call(rows, opKind)) return true;
    return rows[opKind].includes(action);
  }

  /**
   * May this Position bind or unbind a surveillance contact to a flight
   * (WP5, docs/adr/0045)?
   *
   * Refused by CLASS, on the same basis as canMutate's first line: guide §4.1
   * rule 2 makes a range Position the using agency, which "works no Strips" and
   * has no flights to identify. Under docs/adr/0042 it has no scope either, so
   * there is nothing for it to have seen.
   *
   * Everything else may. A correlation is not a clearance and no Position owns
   * a flight data — a controller who can see the contact must be able to say so, even
   * about a flight whose Strip belongs to somebody else. That includes an MRU:
   * D12 is about being asked to provide ATC SERVICE (handoffs, point-outs), and
   * "which blip is this" is not that.
   */
  function canCorrelate(actingPositionId) {
    return !worksNoStrips(actingPositionId) && !hasNoScope(actingPositionId);
  }

  /**
   * May this Position declare, amend, end or void a MARSA relation (WP6,
   * docs/adr/0051)?
   *
   * Refused by CLASS, the same first line canMutate and canCorrelate share: guide
   * §4.1 rule 2 makes a range Position the using agency, which "works no Strips"
   * and therefore has no flights to put into a relation.
   *
   * Everything else may, INCLUDING an MRU (TAC_C2/GCI). That is deliberate and it
   * is not D12: D12 is about an MRU being asked to provide ATC SERVICE —
   * handoffs, point-outs, separation — and MARSA is the precise opposite. It is
   * the military authority saying it will separate its own aircraft, which is the
   * MRU's own assertion to make. §9.2 rule 1 puts the declaration with the tanker
   * and makes it verbal; whichever Position takes that call records it.
   *
   * Kept as its own predicate rather than an entry in OP_KINDS for the reason the
   * module comment gives about the flat table: every PERMISSIONS entry built with
   * a `.filter()` would pick a new op kind up silently, which is the
   * maximally-permissive trap D21 exists to catch.
   */
  function canDeclareMarsa(actingPositionId) {
    return !worksNoStrips(actingPositionId) && !hasNoScope(actingPositionId);
  }

  return { PERMISSIONS, canMutate, canMutateAction, canCorrelate, canDeclareMarsa };
}

module.exports = {
  createPermission, canCreateStripType, canActOnState, tofiCounterparts,
  CREATE_STRIP_TYPE_PERMISSIONS, STATE_OWNERS_BY_STRIP_TYPE,
  DEPARTURE_STATE_OWNERS, ARRIVAL_STATE_OWNERS, OVERFLIGHT_STATE_OWNERS, MISSION_STATE_OWNERS,
  OP_KINDS, COORDINATION_OP_KINDS, AP_CTR_ONLY_OP_KINDS, TOFI_OP_KINDS, AIRSPACE_ENTRY_OP_KINDS, FORMATION_OP_KINDS, TOFI_COUNTERPARTS,
  NO_STRIP_OP_CLASSES,
  canActOnRunwayStatus, RUNWAY_STATUS_OP_OWNERS,
  TACTICAL_CAPABILITIES, READ_SCOPES, handBackTargetsFor, tofiAnswererFor, readScopeFor, mayActBesideOwner,
  CARRIER_CAPABILITIES, canEditCarrierState, canSequenceMarshalStack, canRecordCarrierHandoff,
  MARSHAL_STATE_OWNERS, FINAL_STATE_OWNERS, PATTERN_STATE_OWNERS,
  INCIRLIK_CAPABILITIES, canRotateSfa, canSendSfaRotationTransfer, sfaRotationReceiver, sfaControllerPositions, incirlikPositionsWith,
};
