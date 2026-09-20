'use strict';

// Cross-Facility coordination primitives (EFSPImplementationGuide.md §4.6)
// — WP4A first slice (docs/adr/0013 ff.), civil ATC<->ATC only (APP<->CTR).
// This is the doctrinal table (guide §4.6's own primitive table,
// reproduced exactly) — injected into board-store.js as `rules.
// coordinationEffect`, the same pattern nla.js/block-map.js/permission.js
// already use: doctrinal decisions live in their own small module and are
// injected from the composition root (index.js), never known directly to
// board-store.js's Strip/Rack mechanics.
//
// `dataOwnershipMoves`: does the Strip's real controlling record pass to
// the receiver on ACCEPT? `separationResponsibilityMoves`: does
// separation responsibility pass to the receiver on ACCEPT? For every
// primitive except POINT_OUT these two always move together (the guide's
// "Jurisdiction" column is one value) — POINT_OUT is the one row where
// they split (rule 1: "the initiator retains data ownership while the
// receiver takes separation responsibility for its own traffic"), which
// is exactly why board-store.js models them as two independent refs
// rather than one, and why the client renders both halves separately.
//
// OPERATIONAL_REQUEST is folded into the same PROPOSE/ACCEPT/REJECT
// replica mechanism as the other 4 primitives, deliberately — a
// simplification versus a "no replica at all" design: guide §4.6's table
// only says its Radar ID/Comms columns are blank and its jurisdiction
// "stays with requester," not that no replica may exist, and reusing one
// mechanism for all 5 primitives keeps every one of them addressable
// through the existing ownership-gated Mutation dispatch (board-store.js's
// _dispatch already requires the acting Position to own the Strip being
// acted on — a genuinely separate "respond without owning a Strip"
// pathway would have needed a parallel, unguarded addressing scheme).
// Its zeroed-out effect row below is what actually enforces "stays with
// requester": ACCEPT never moves anything.
const COORDINATION_PRIMITIVES = new Set(['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT']);

const COORDINATION_EFFECTS = {
  HANDOFF:              { radarIdTransfers: true,  commsTransfers: true,  dataOwnershipMoves: true,  separationResponsibilityMoves: true,  acceptPhrase: 'RADAR CONTACT' },
  POINT_OUT:            { radarIdTransfers: true,  commsTransfers: false, dataOwnershipMoves: false, separationResponsibilityMoves: true,  acceptPhrase: 'POINT OUT APPROVED' },
  TRAFFIC:              { radarIdTransfers: true,  commsTransfers: false, dataOwnershipMoves: false, separationResponsibilityMoves: false, acceptPhrase: 'TRAFFIC OBSERVED' },
  OPERATIONAL_REQUEST:  { radarIdTransfers: false, commsTransfers: false, dataOwnershipMoves: false, separationResponsibilityMoves: false, acceptPhrase: 'APPROVED' },
  AIT:                  { radarIdTransfers: true,  commsTransfers: true,  dataOwnershipMoves: true,  separationResponsibilityMoves: true,  acceptPhrase: null }, // silent — requires a written directive, guide §4.6 rule 7
};

function isCoordinationPrimitive(primitive) {
  return COORDINATION_PRIMITIVES.has(primitive);
}

/** @returns {{radarIdTransfers:boolean, commsTransfers:boolean, dataOwnershipMoves:boolean, separationResponsibilityMoves:boolean, acceptPhrase:string|null}|null} */
function coordinationEffect(primitive) {
  return COORDINATION_EFFECTS[primitive] || null;
}

// Which EfspState a Strip Role must be in to PROPOSE a coordination link —
// i.e. which (role, state) combo has a Bay configured to receive it on the
// OTHER side (facility-config.js's ARRIVAL app-inbound/ctr-enroute Bays and
// DEPARTURE app-departures/ctr-departures Bays all imply exactly these
// states). Gates ALL 5 primitives identically — POINT_OUT/TRAFFIC/
// OPERATIONAL_REQUEST/AIT conceptually apply to any traffic a Position
// holds, not just HANDOFF, so this is role-based, never primitive-based.
// Originally this slice only ever produced ARRIVAL/INBOUND replicas
// (docs/adr/0014's CTR->APP flow); docs/adr/0022 extends it to
// DEPARTURE/HANDED_OFF (APP->CTR) without inventing any new EfspState —
// CTR's terminus for a received DEPARTURE Strip is Drop-only, mirroring
// APP's own existing DEPARTURE terminus.
const COORDINATION_ELIGIBLE_STATES = { ARRIVAL: 'INBOUND', DEPARTURE: 'HANDED_OFF' };

/** @returns {string|undefined} the EfspState `role` must be in to propose a coordination link, or undefined if this role never can. */
function coordinationEligibleState(role) {
  return COORDINATION_ELIGIBLE_STATES[role];
}

// WP4A second slice (docs/adr/0025), §4.6.3 — TOFI does NOT fit
// COORDINATION_EFFECTS' shape above: jurisdiction (data ownership,
// separation responsibility) never transfers in TOFI at all (guide rule 2:
// "the Strip stays live and posted throughout tactical control"), so a
// separate, parallel table by direction rather than a row alongside the 5
// ATC<->ATC primitives. Purely descriptive (acceptPhrase is UI-facing
// text, same as the other table's) — board-store.js's TOFI logic doesn't
// need to consult this to decide what state to transition to, since ENTRY
// vs EXIT is already an explicit field on the Mutation itself.
const TOFI_EFFECTS = {
  ENTRY: { acceptPhrase: 'TOFI ACKNOWLEDGED — ENTRY' },
  EXIT:  { acceptPhrase: 'TOFI ACKNOWLEDGED — EXIT' },
};

/** @returns {{acceptPhrase:string}|null} */
function tofiEffect(direction) {
  return TOFI_EFFECTS[direction] || null;
}

// Which EfspState an ATC-side Strip Role must be in to open a TOFI ENTRY —
// TOFI's own analogue of COORDINATION_ELIGIBLE_STATES above, and added for
// the same reason: without it, the TOFI button rendered (and the mutation
// succeeded) on ANY Strip the acting Position owned, in any state, including
// one that had not been worked yet.
//
// A flight can only enter tactically controlled airspace once it is actually
// airborne and enroute, which is the same set of states the 5 primitives
// already recognise as "airborne, being worked by an enroute Position" —
// plus OVERFLIGHT, which has no entry in the table above only because it
// never originates a HANDOFF, not because it is ever on the ground. MISSION
// is deliberately absent: it is the MRU-side Role TOFI *creates*, never a
// Role that opens an exchange of its own (docs/adr/0026).
const TOFI_ELIGIBLE_STATES = { DEPARTURE: 'HANDED_OFF', ARRIVAL: 'INBOUND', OVERFLIGHT: 'TRANSITING' };

/** @returns {string|undefined} the EfspState `role` must be in to open a TOFI ENTRY, or undefined if this role never can. */
function tofiEligibleState(role) {
  return TOFI_ELIGIBLE_STATES[role];
}

module.exports = {
  COORDINATION_PRIMITIVES, COORDINATION_EFFECTS, COORDINATION_ELIGIBLE_STATES, TOFI_EFFECTS, TOFI_ELIGIBLE_STATES,
  isCoordinationPrimitive, coordinationEffect, coordinationEligibleState, tofiEffect, tofiEligibleState,
};
