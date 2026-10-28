'use strict';

// The Strip op kinds a Position may be granted, and the named subsets the
// Position families build their grants from (moved from permission.js into the
// authority registry, AUTH). See permission.js's module comment for why every
// grant is per acting Position (D21) and why no grant is a `.filter()` that
// would pick a new kind up silently.

const OP_KINDS = [
  'CreateStrip', 'MoveStrip', 'SetBlock', 'TransferStrip',
  // Undo is not a grant (docs/adr/0100 §5): only the Position that performed an action may undo it, whatever
  // ops it holds (a JTAC undoing its hand-back), so board/strip-ops.js's _dispatchUndo gates it on the record.
  'SetFlag', 'SetState', 'InvokeNla', 'DropStrip',
  'HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT',
  // docs/adr/0101 (H94, H98): the release of control inside a HANDOFF, never a bare "Release" (that is departure release).
  'ControlRelease',
  // docs/adr/0023 — converts a DEPARTURE Strip at HANDED_OFF into an
  // ARRIVAL Strip IN PLACE (same Strip, same flight data), for a flight returning
  // to the same Facility that just handed it off. Deliberately restricted
  // the same way the 5 coordination primitives are (only AP/CTR sit on a
  // boundary where this makes sense) — see COORDINATION_OP_KINDS' own
  // comment for why that exclusion pattern exists, and why it applies here
  // too, not just to those 5.
  'ConvertToArrival',
  // docs/adr/0111 — a new destination and a new clearance on the Strip an AP/CTR holds.
  'Divert',
  // WP4A second slice (docs/adr/0025) — TOFI (guide §4.6.3), the ATC<->MRU
  // sub-protocol. Deliberately NOT folded into COORDINATION_OP_KINDS below
  // (that set is specifically the 5 ATC<->ATC primitives) and deliberately
  // NOT granted to AP even though AP otherwise gets the full OP_KINDS
  // set — guide §4.1's own Position table lists TOFI only for CTR among
  // the ATC Positions built so far, plus TAC_C2/GCI on the MRU side. See
  // TOFI_OP_KINDS and each Position's own PERMISSIONS entry below.
  'TOFI',
  // The RANGE slice — approving a flight onto an airspace's working
  // frequency, and clearing that approval when it leaves. Granted to the ATC
  // Positions that actually work airborne flights; a range Position gets
  // neither, because it works no Strips at all (§4.1 rule 2).
  'ApproveAirspaceEntry', 'ClearAirspaceEntry',
];

// The 5 cross-Facility coordination primitives (guide §4.6) — split out so
// PERMISSIONS below can grant them to exactly AP/CTR without repeating
// the list, and so canMutate()'s D21 shape stays a single flat lookup.
const COORDINATION_OP_KINDS = ['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT'];

// A step inside one of them (docs/adr/0101): held exactly where the HANDOFF is, so every place that withholds the
// primitives withholds it too, and kept out of COORDINATION_OP_KINDS because that list is the five primitives the client
// mirrors (crc-desktop's coordination lockstep test).
const COORDINATION_STEP_OP_KINDS = ['ControlRelease'];

// Op kinds restricted to exactly AP/CTR, for reasons other than being a
// cross-Facility coordination primitive — currently just ConvertToArrival
// (docs/adr/0023). Kept separate from COORDINATION_OP_KINDS since it isn't
// one (no cross-Facility exchange, no replica — a same-Facility in-place
// role change), but needs the identical exclusion from OPS/CD/GC/LC.
const AP_CTR_ONLY_OP_KINDS = ['ConvertToArrival', 'Divert'];

// Approving a flight into an airspace is something the Position working that
// airborne flight does — AP and CTR here, since they are the Positions that
// hold a flight once it is airborne. Kept separate from
// AP_CTR_ONLY_OP_KINDS, which those two hold for an unrelated reason, so
// neither list has to be read as "and also these".
const AIRSPACE_ENTRY_OP_KINDS = ['ApproveAirspaceEntry', 'ClearAirspaceEntry'];

// TOFI (guide §4.6.3) — split out the same way COORDINATION_OP_KINDS is,
// so it can be excluded from NON_CREATE_OPS/OPS's grant (nobody gets it by
// default) and explicitly re-added only where guide §4.1's own Position
// table names it (CTR, TAC_C2, GCI — see PERMISSIONS below).
const TOFI_OP_KINDS = ['TOFI'];

// docs/adr/0099 §4 (H100 Q-SJ3 c): formation split and join. A literal capability held by every ATC Position (the civil-ATC
// and Incirlik-military families), NEVER a `.filter()` over OP_KINDS and not an OP_KINDS entry: a kind there would reach the
// tactical and carrier Positions through NON_CREATE_OPS silently. Ownership of the Strip is checked by the Board as always.
const FORMATION_OP_KINDS = ['SplitFormation', 'JoinFormation'];

// docs/adr/0126 (H149, H150): the tower's pattern conversions (board/ops/pattern.js). A literal capability held by LC
// alone, on FORMATION_OP_KINDS' pattern: never in OP_KINDS, where AP's and CTR's grants and NON_CREATE_OPS would pick it up.
const PATTERN_OP_KINDS = ['JoinPattern', 'LeavePattern'];

// docs/adr/0146 (H174, H175): the VFR strip's actions. Tag a track (StartFlightFollowing), the STARS handoff (VfrHandoff),
// the optional code (AssignCode), IFR <-> VFR in place (ChangeFlightRules) and "Radar service terminated". A literal
// capability on FORMATION_OP_KINDS' pattern (never in OP_KINDS, where NON_CREATE_OPS would hand it to the tactical and
// carrier Positions silently), held by every ATC Position that works traffic on a scope or the field.
const VFR_OP_KINDS = ['StartFlightFollowing', 'TerminateRadarService', 'VfrHandoff', 'AssignCode', 'ChangeFlightRules'];

const NON_CREATE_OPS = OP_KINDS.filter(k => k !== 'CreateStrip' && !COORDINATION_OP_KINDS.includes(k) && !COORDINATION_STEP_OP_KINDS.includes(k) && !AP_CTR_ONLY_OP_KINDS.includes(k) && !TOFI_OP_KINDS.includes(k) && !AIRSPACE_ENTRY_OP_KINDS.includes(k));

module.exports = {
  OP_KINDS, COORDINATION_OP_KINDS, COORDINATION_STEP_OP_KINDS, AP_CTR_ONLY_OP_KINDS, AIRSPACE_ENTRY_OP_KINDS, TOFI_OP_KINDS, FORMATION_OP_KINDS, PATTERN_OP_KINDS, VFR_OP_KINDS, NON_CREATE_OPS,
};
