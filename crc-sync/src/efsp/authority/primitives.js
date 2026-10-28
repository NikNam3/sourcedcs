'use strict';

// Cross-Facility coordination primitives (EFSPImplementationGuide.md §4.6)
// — WP4A first slice (docs/adr/0013 ff.), civil ATC<->ATC only (AP<->CTR).
// This is the doctrinal table (guide §4.6's own primitive table,
// reproduced exactly) — injected into the Board as `rules.
// coordinationEffect`, the same pattern nla.js/block-map.js/permission.js
// already use: doctrinal decisions live in their own small module and are
// injected from the composition root (index.js), never known directly to
// the Board's Strip/Rack mechanics (board/**). A table per primitive, neither a
// strip type's nor a Position's, so it sits beside the families in the registry.
//
// `dataOwnershipMoves`: does the Strip's real controlling record pass to
// the receiver on ACCEPT? `separationResponsibilityMoves`: does
// separation responsibility pass to the receiver on ACCEPT? For every
// primitive except POINT_OUT these two always move together (the guide's
// "Jurisdiction" column is one value) — POINT_OUT is the one row where
// they split (rule 1: "the initiator retains data ownership while the
// receiver takes separation responsibility for its own traffic"), which
// is exactly why board/coordination.js models them as two independent refs
// rather than one, and why the client renders both halves separately.
//
// OPERATIONAL_REQUEST is folded into the same PROPOSE/ACCEPT/REJECT
// replica mechanism as the other 4 primitives, deliberately — a
// simplification versus a "no replica at all" design: guide §4.6's table
// only says its Radar ID/Comms columns are blank and its jurisdiction
// "stays with requester," not that no replica may exist, and reusing one
// mechanism for all 5 primitives keeps every one of them addressable
// through the existing ownership-gated Mutation dispatch (the Board's
// ownership gate, board/strip-ops.js's NOT_OWNER check, already requires the acting Position to own the Strip being
// acted on — a genuinely separate "respond without owning a Strip"
// pathway would have needed a parallel, unguarded addressing scheme).
// Its zeroed-out effect row below is what actually enforces "stays with
// requester": ACCEPT never moves anything.
const COORDINATION_PRIMITIVES = new Set(['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT']);

const COORDINATION_EFFECTS = {
  // docs/adr/0101 (H94): ACCEPT of a HANDOFF moves radar identification and the Strip only. Communications, the
  // ControlRelease and transfer of control are steps of their own (`controlModel: 'STEPS'`); AIT keeps all of it at
  // accept (`'AT_ACCEPT'`, a written directive is the agreement, JO 7110.65 2-1-15 b); every other row has none.
  HANDOFF:              { radarIdTransfers: true,  commsTransfers: false, dataOwnershipMoves: true,  separationResponsibilityMoves: false, controlModel: 'STEPS', acceptPhrase: 'RADAR CONTACT' },
  POINT_OUT:            { radarIdTransfers: true,  commsTransfers: false, dataOwnershipMoves: false, separationResponsibilityMoves: true,  controlModel: null, acceptPhrase: 'POINT OUT APPROVED' },
  TRAFFIC:              { radarIdTransfers: true,  commsTransfers: false, dataOwnershipMoves: false, separationResponsibilityMoves: false, controlModel: null, acceptPhrase: 'TRAFFIC OBSERVED' },
  OPERATIONAL_REQUEST:  { radarIdTransfers: false, commsTransfers: false, dataOwnershipMoves: false, separationResponsibilityMoves: false, controlModel: null, acceptPhrase: 'APPROVED' },
  AIT:                  { radarIdTransfers: true,  commsTransfers: true,  dataOwnershipMoves: true,  separationResponsibilityMoves: true,  controlModel: 'AT_ACCEPT', acceptPhrase: null }, // silent — requires a written directive, guide §4.6 rule 7
};

// WP4A second slice (docs/adr/0025), §4.6.3 — TOFI does NOT fit
// COORDINATION_EFFECTS' shape above: jurisdiction (data ownership,
// separation responsibility) never transfers in TOFI at all (guide rule 2:
// "the Strip stays live and posted throughout tactical control"), so a
// separate, parallel table by direction rather than a row alongside the 5
// ATC<->ATC primitives. Purely descriptive (acceptPhrase is UI-facing
// text, same as the other table's) — board/tofi.js doesn't
// need to consult this to decide what state to transition to, since ENTRY
// vs EXIT is already an explicit field on the Mutation itself.
const TOFI_EFFECTS = {
  ENTRY: { acceptPhrase: 'TOFI ACKNOWLEDGED — ENTRY' },
  EXIT:  { acceptPhrase: 'TOFI ACKNOWLEDGED — EXIT' },
};

module.exports = { COORDINATION_PRIMITIVES, COORDINATION_EFFECTS, TOFI_EFFECTS };
