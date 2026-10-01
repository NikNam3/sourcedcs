'use strict';

// Cross-Facility coordination primitives (EFSPImplementationGuide.md §4.6)
// — WP4A first slice (docs/adr/0013 ff.), civil ATC<->ATC only (APP<->CTR).
// This is the doctrinal table (guide §4.6's own primitive table,
// reproduced exactly) — injected into board-store.js as `rules.
// coordinationEffect`, the same pattern nla.js/block-map.js/permission.js
// already use: doctrinal decisions live in their own small module and are
// injected from the composition root (index.js), never known directly to
// board-store.js's Strip/Rack mechanics. (Moved from coordination.js into the
// authority registry, AUTH: a table per primitive, neither a Role's nor a
// Position's.)
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

module.exports = { COORDINATION_PRIMITIVES, COORDINATION_EFFECTS, TOFI_EFFECTS };
