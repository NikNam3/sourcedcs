'use strict';

// The tactical Position family (authority registry, S3-2): TAC_C2, GCI, AIC and
// JTAC (guide §4.1, docs/adr/0025, docs/adr/0080). Moved from permission.js.

const { NON_CREATE_OPS } = require('../op-kinds');

const PERMISSIONS = {
  // WP4A second slice — TAC_C2/GCI (class MRU) get ordinary Strip
  // mechanics plus CreateStrip (they originate MISSION Strips, guide §9.8)
  // plus TOFI, explicitly minus all 5 COORDINATION_OP_KINDS (D12 — an MRU
  // must never be offered HANDOFF/POINT_OUT/TRAFFIC/OPERATIONAL_REQUEST/
  // AIT, even in combination with a Position that does hold them; see the
  // D21 regression test and the class-derived strip-back loop in authority/index.js).
  TAC_C2: new Set([...NON_CREATE_OPS, 'CreateStrip', 'TOFI']),
  GCI:    new Set([...NON_CREATE_OPS, 'CreateStrip', 'TOFI']),
  // AIC (class MRU_POSITION) — "works under TAC_C2's TOFI" (guide §4.1):
  // acts on MISSION Strips once TAC_C2 has already completed an exchange,
  // never independently PROPOSEs/ACCEPTs one itself. Ordinary Strip
  // mechanics only — no CreateStrip (doesn't originate MISSION Strips),
  // no TOFI, no coordination kinds.
  AIC: new Set(NON_CREATE_OPS),
  // JTAC (class NON_ATC) — guide §4.1 "MISSION (read-only)", refined by
  // decisions.md H40 (docs/adr/0080): a JTAC sees only the Strips TAC_C2 has
  // handed it, and hands them back. So exactly ONE op kind, written as a
  // literal (never a .filter(): the header's maximally-permissive trap), and
  // TACTICAL_CAPABILITIES' `handBackTo` narrows its target to TAC_C2. What a
  // JTAC is SENT is the read scope (read-scope.js, docs/adr/0080), no longer
  // unconditional.
  JTAC: new Set(['TransferStrip']),
};

const CREATE_ROLE_PERMISSIONS = {
  // WP4A second slice — TAC_C2/GCI originate MISSION Strips (guide §9.8:
  // "TAC_C2 works mission lines"). A standalone origination (own fresh
  // FDR) for a mission that never touches ATC-controlled airspace at all —
  // separate from, and coexisting with, a MISSION Strip minted as a TOFI
  // ENTRY exchange's byproduct (board-store.js's receiveTofiProposal),
  // which shares its FDR with the ATC-side Strip instead.
  TAC_C2: new Set(['MISSION']),
  GCI: new Set(['MISSION']),
};

/**
 * H2 / H40 (docs/adr/0080): what each tactical working Position may do BEYOND
 * its op grant. One row per Position, one column per capability, so the next
 * capability (H2: "AIC gets an update in a future version") is a column, not a
 * rewrite. A Position with no row gets the defaults (no hand-back limit, no
 * TOFI answerer, 'ALL'). Static, like every other grant (P5).
 *
 *  handBackTo      the only Positions a line it owns may be transferred to
 *  tofiAnsweredBy  who answers a TOFI exchange on a line this Position is working
 *                  (AIC "works under TAC_C2's TOFI", guide §4.1 / ADR 0025)
 *  readScope       'ALL' | 'OWNED' — what a session holding only such Positions is sent
 */
const READ_SCOPES = ['ALL', 'OWNED'];
const TACTICAL_CAPABILITIES = {
  AIC:  { handBackTo: ['TAC_C2'], tofiAnsweredBy: 'TAC_C2', readScope: 'ALL' },
  JTAC: { handBackTo: ['TAC_C2'], tofiAnsweredBy: null,     readScope: 'OWNED' },
};

function _tacRow(positionId) {
  return Object.prototype.hasOwnProperty.call(TACTICAL_CAPABILITIES, positionId) ? TACTICAL_CAPABILITIES[positionId] : null;
}
/** @returns {string[]|null} the only Positions `positionId` may transfer a line to, or null when unrestricted. */
function handBackTargetsFor(positionId) {
  const row = _tacRow(positionId);
  return row && row.handBackTo ? row.handBackTo.slice() : null;
}
/** @returns {string|null} the Position that answers TOFI on a line `ownerPositionId` is working, or null. */
function tofiAnswererFor(ownerPositionId) {
  const row = _tacRow(ownerPositionId);
  return (row && row.tofiAnsweredBy) || null;
}
/** @returns {'ALL'|'OWNED'} */
function readScopeFor(positionId) {
  const row = _tacRow(positionId);
  return (row && row.readScope) || 'ALL';
}

// The TOFI answer (B2, docs/adr/0080; see permission.js's mayActBesideOwner):
// on a MISSION Strip, the Position `tofiAnsweredBy` names for its owner (TAC_C2
// for an AIC-held line) may ACCEPT, REJECT or TRANSFER_COMMS.
const TOFI_ANSWER_ACTIONS = ['ACCEPT', 'REJECT', 'TRANSFER_COMMS'];

const family = {
  family: 'tactical',
  positions: ['TAC_C2', 'GCI', 'AIC', 'JTAC'],
  permissions: PERMISSIONS,
  createsStripTypes: CREATE_ROLE_PERMISSIONS,
  capabilities: TACTICAL_CAPABILITIES,
  // TOFI's MRU side (guide §4.6.3): both answer to CENTER's CTR.
  tofiCounterparts: {
    TAC_C2: [{ facilityId: 'CENTER', positionId: 'CTR' }],
    GCI:    [{ facilityId: 'CENTER', positionId: 'CTR' }],
  },
};

module.exports = {
  family, TACTICAL_CAPABILITIES, READ_SCOPES, TOFI_ANSWER_ACTIONS, handBackTargetsFor, tofiAnswererFor, readScopeFor,
};
