'use strict';

// Per-acting-Position permission evaluation (EFSPImplementationGuide.md
// §4.8.4) — table-driven, evaluated for the SINGLE acting Position on a
// Mutation, NEVER as a union of every Position a controller happens to
// hold (defect D21): "Permissions MUST be evaluated per acting Position,
// never as the union of the held set."
//
// canMutate()'s signature is the guard against D21 by construction: it
// takes exactly one actingPositionId, with no parameter through which a
// caller could pass "the full set of Positions I hold" — there is
// structurally nowhere for a union to sneak in.
//
// Ownership (does the acting Position own THIS specific Strip?) is
// enforced separately and unconditionally by board-store.js. This module
// answers a different question: is this Position CLASS even allowed to
// perform this kind of Mutation at all, regardless of ownership?
//
// Phase 1 had only Military ATC-class Positions (OPS, CD, GND, TWR) at one
// Facility — the guide's sharpest example of this rule (a Military Radar
// Unit like TAC_C2 must never be granted HANDOFF/POINT_OUT, guide §4.1
// rule 1) doesn't yet apply, since no MRU Position exists until WP4A/WP7,
// and HANDOFF/POINT_OUT/TOFI aren't even in the Mutation op union yet (see
// board-store.js's module comment — absent, not stubbed).
//
// Phase 2 adds APP. Deliberately NOT folded into the flat table the same
// maximally-permissive way CD/GND/TWR were — that would reproduce exactly
// the "looks correct in every demo" trap the guide warns about for D21 (a
// table where every Position can do everything proves nothing about
// per-acting-Position evaluation). Instead CreateStrip is a SECOND,
// role-scoped permission axis, checked by canCreateStripRole() below: OPS
// originates DEPARTURE (guide §4.1 rule 3), APP originates ARRIVAL (the
// Phase-2 stub for "no CTR Facility to hand an inbound flight off from
// yet" — see docs/adr/0008, superseded this WP4A slice by docs/adr/0014).
// Neither Position's CreateStrip right extends to the other's role. This
// is Phase 2's first genuine cross-Position permission asymmetry, and it's
// what finally makes a real D21 regression test possible
// (efsp-permission.test.mjs) — Phase 1's table couldn't reveal a union bug
// because every Position but OPS was permission-identical.
//
// WP4A (docs/adr/0015) adds CTR and 5 new op kinds — HANDOFF, POINT_OUT,
// TRAFFIC, OPERATIONAL_REQUEST, AIT (guide §4.6's cross-Facility
// coordination primitives). This is the SECOND genuine per-Position
// permission asymmetry: only APP and CTR get these 5 kinds — CD/GND/TWR/
// OPS get none, since none of them is a Position that ever touches a
// Facility boundary. This table stays a single flat {positionId: Set}
// map (not Facility-namespaced) ONLY because Position IDs are globally
// unique strings across both Facilities in this slice (OPS/CD/GND/TWR/APP
// vs CTR never collide) — a future Facility whose Position-ID space
// collides with an existing one would break this assumption and needs its
// own ADR before landing.
// The tables themselves now live in the authority registry (authority/,
// S3-2): the op-kind vocabulary in op-kinds.js, the class rules in classes.js,
// each Position family's grants and capability columns in
// positions/<family>.js, each Role's state owners in strip-types/<role>.js, all
// composed in authority/index.js. This module is their facade and exports
// exactly what it exported before; the one-Position predicates (the D21
// gates) stay here.

const authority = require('./authority');
const { OP_KINDS, COORDINATION_OP_KINDS, APP_CTR_ONLY_OP_KINDS, TOFI_OP_KINDS, AIRSPACE_ENTRY_OP_KINDS } = require('./authority/op-kinds');
const { NO_STRIP_OP_CLASSES, _worksNoStrips, _hasNoScope } = require('./authority/classes');
const {
  TACTICAL_CAPABILITIES, READ_SCOPES, TOFI_ANSWER_ACTIONS, handBackTargetsFor, tofiAnswererFor, readScopeFor,
} = require('./authority/positions/tactical');
const {
  CARRIER_CAPABILITIES, canSetRecoveryCase, canSequenceMarshalStack, canEditShipStateInput, canRecordCarrierTransfer,
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
  PERMISSIONS, CREATE_ROLE_PERMISSIONS, STATE_OWNERS_BY_ROLE, FIELD_STATE_OP_OWNERS, NON_OWNER_BLOCK_WRITES, TOFI_COUNTERPARTS,
} = authority;

/**
 * @param {string} actingPositionId — exactly one Position; never a set
 * @param {string} opKind
 * @returns {boolean}
 */
function canMutate(actingPositionId, opKind) {
  if (_worksNoStrips(actingPositionId)) return false;
  const allowed = PERMISSIONS[actingPositionId];
  return !!allowed && allowed.has(opKind);
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
 * an FDR — a controller who can see the contact must be able to say so, even
 * about a flight whose Strip belongs to somebody else. That includes an MRU:
 * D12 is about being asked to provide ATC SERVICE (handoffs, point-outs), and
 * "which blip is this" is not that.
 */
function canCorrelate(actingPositionId) {
  return !_worksNoStrips(actingPositionId) && !_hasNoScope(actingPositionId);
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
  return !_worksNoStrips(actingPositionId) && !_hasNoScope(actingPositionId);
}

/**
 * Exactly two parameters: ONE acting Position, never a held set — D21 by
 * construction. A controller holding TWR and APP acts as one or the other, and
 * an acknowledgement sent as TWR never counts as APP's.
 */
function canActOnFieldState(actingPositionId, opKind) {
  const owners = Object.prototype.hasOwnProperty.call(FIELD_STATE_OP_OWNERS, opKind) ? FIELD_STATE_OP_OWNERS[opKind] : null;
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
 *  - OPS alert status (S-L13, H56): OPS owns Block 14E on a DEPARTURE at every
 *    state until it is DROPPED, whoever holds the Strip. Likewise 3G ORDNANCE (UI-A U1).
 * The acting Position must still hold the op kind (canMutate runs first).
 */
function mayActBesideOwner(actingPositionId, strip, op) {
  if (!strip || !op) return false;
  if (op.kind === 'TOFI' && strip.role === 'MISSION' && TOFI_ANSWER_ACTIONS.includes(op.action)) {
    return tofiAnswererFor(strip.ownerPositionId) === actingPositionId;
  }
  if (op.kind === 'SetBlock' && strip.state !== 'DROPPED') {
    return NON_OWNER_BLOCK_WRITES.some(r => r.blockId === op.blockId && r.role === strip.role && r.positions.includes(actingPositionId));
  }
  return false;
}

/**
 * The role-scoped half of CreateStrip permission (see the module comment).
 * Structurally the same D21 guard as canMutate() — exactly one
 * actingPositionId, never a held set.
 * @param {string} actingPositionId
 * @param {string} role — the Strip Role being created (e.g. 'DEPARTURE')
 * @returns {boolean}
 */
function canCreateStripRole(actingPositionId, role) {
  const allowed = CREATE_ROLE_PERMISSIONS[actingPositionId];
  return !!allowed && allowed.has(role);
}

/** @returns {{facilityId:string, positionId:string}[]} the valid TOFI counterparts for `actingPositionId`, or an empty array if it has none. */
function tofiCounterparts(actingPositionId) {
  return TOFI_COUNTERPARTS[actingPositionId] || [];
}

/**
 * @param {string} actingPositionId
 * @param {string} role
 * @param {string} state — the Strip's CURRENT state (the one being advanced FROM)
 * @returns {boolean}
 */
function canActOnState(actingPositionId, role, state) {
  const owners = (STATE_OWNERS_BY_ROLE[role] || {})[state];
  return !!owners && owners.includes(actingPositionId);
}

module.exports = {
  canMutate, canCorrelate, canDeclareMarsa, canCreateStripRole, canActOnState, tofiCounterparts,
  PERMISSIONS, CREATE_ROLE_PERMISSIONS, STATE_OWNERS_BY_ROLE,
  DEPARTURE_STATE_OWNERS, ARRIVAL_STATE_OWNERS, OVERFLIGHT_STATE_OWNERS, MISSION_STATE_OWNERS,
  OP_KINDS, COORDINATION_OP_KINDS, APP_CTR_ONLY_OP_KINDS, TOFI_OP_KINDS, AIRSPACE_ENTRY_OP_KINDS, TOFI_COUNTERPARTS,
  NO_STRIP_OP_CLASSES,
  canActOnFieldState, FIELD_STATE_OP_OWNERS,
  TACTICAL_CAPABILITIES, READ_SCOPES, handBackTargetsFor, tofiAnswererFor, readScopeFor, mayActBesideOwner,
  CARRIER_CAPABILITIES, canSetRecoveryCase, canSequenceMarshalStack, canEditShipStateInput, canRecordCarrierTransfer,
  MARSHAL_STATE_OWNERS, FINAL_STATE_OWNERS, PATTERN_STATE_OWNERS,
  INCIRLIK_CAPABILITIES, canRotateSfa, canSendSfaRotationTransfer, sfaRotationReceiver, sfaControllerPositions, incirlikPositionsWith,
};
