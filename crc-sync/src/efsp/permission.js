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
// yet" — see docs/adr/0008). Neither Position's CreateStrip right extends
// to the other's role. This is Phase 2's first genuine cross-Position
// permission asymmetry, and it's what finally makes a real D21 regression
// test possible (efsp-permission.test.mjs) — Phase 1's table couldn't
// reveal a union bug because every Position but OPS was permission-
// identical.

const OP_KINDS = [
  'CreateStrip', 'MoveStrip', 'SetBlock', 'TransferStrip',
  'SetFlag', 'SetState', 'InvokeNla', 'Undo', 'DropStrip',
];

const NON_CREATE_OPS = OP_KINDS.filter(k => k !== 'CreateStrip');

// The coarse "may this Position class ever perform this KIND of op at
// all" gate — CreateStrip is included here for OPS/APP (both originate
// Strips, just for different roles) but the role itself is gated
// separately by canCreateStripRole(), which board-store.js's
// _applyCreateStrip calls in addition to this.
const PERMISSIONS = {
  OPS: new Set(OP_KINDS),
  CD:  new Set(NON_CREATE_OPS),
  GND: new Set(NON_CREATE_OPS),
  TWR: new Set(NON_CREATE_OPS),
  APP: new Set(OP_KINDS),
};

// Which Strip Role(s) a Position may originate via CreateStrip. Every
// Position in PERMISSIONS with CreateStrip in its op-kind set MUST have an
// entry here (even if empty) — see the "every CreateStrip-eligible
// Position has a CREATE_ROLE_PERMISSIONS entry" test.
const CREATE_ROLE_PERMISSIONS = {
  OPS: new Set(['DEPARTURE']),
  APP: new Set(['ARRIVAL']),
};

/**
 * @param {string} actingPositionId — exactly one Position; never a set
 * @param {string} opKind
 * @returns {boolean}
 */
function canMutate(actingPositionId, opKind) {
  const allowed = PERMISSIONS[actingPositionId];
  return !!allowed && allowed.has(opKind);
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

// Per-State authority (guide §3.4's "normally owned by" column) — WHO may
// advance a Strip OUT of a given State. Checked by board-store.js in
// ADDITION to raw Strip ownership, not instead of it: ownership alone
// (guide §4.4) only ever meant "which Position currently holds this
// Strip," and nothing enforced that holding it also lined up with §3.4's
// per-State authority column — a Position could hold a Strip indefinitely
// and simply never transfer it, walking it through every other Position's
// job single-handedly (e.g. OPS pressing "Mark Cleared" on a Strip it
// created and never handed to CD). This table closes that gap.
//
// Keyed on strip.state — the state the Strip is CURRENTLY in when the
// action is taken (the FROM state), matching how §3.4's table reads: who
// works a Strip WHILE it's in a given State. Applies uniformly to every
// NLA transition (board-store.js's _applyInvokeNla) AND every equivalent
// drag-based Bay-implied transition (_validateBayImpliedTransition) —
// guide §3.5 rule 4 makes NLA an accelerator, never the ONLY path to a
// transition, so gating only the button would be a trivial bypass via drag.
const DEPARTURE_STATE_OWNERS = {
  PROPOSED:          ['OPS'],
  PENDING_CLEARANCE: ['CD'],
  CLEARED:           ['CD'],
  HELD:              ['CD', 'GND'],
  PUSHBACK:          ['GND'],
  TAXI:              ['GND'],
  RUNWAY_QUEUE:      ['TWR'],
  LUAW:              ['TWR'],
  DEPARTED:          ['TWR'],
  HANDED_OFF:        ['APP'],
  // DROPPED is terminal — no NLA exists for it, so no entry is needed.
};

// [SOURCE-DEFINED] — ARRIVAL has no guide-published "normally owned by"
// table (§3.4 only gives the state sequence); this mirrors the same
// per-Position-per-lifecycle-stage shape as DEPARTURE's guide-sourced one.
const ARRIVAL_STATE_OWNERS = {
  INBOUND:         ['APP'],
  HANDED_TO_TOWER: ['TWR'],
  FINAL:           ['TWR'],
  LANDED:          ['TWR'],
  TAXI_IN:         ['GND'],
};

const STATE_OWNERS_BY_ROLE = { DEPARTURE: DEPARTURE_STATE_OWNERS, ARRIVAL: ARRIVAL_STATE_OWNERS };

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
  canMutate, canCreateStripRole, canActOnState,
  PERMISSIONS, CREATE_ROLE_PERMISSIONS, STATE_OWNERS_BY_ROLE, DEPARTURE_STATE_OWNERS, ARRIVAL_STATE_OWNERS,
  OP_KINDS,
};
