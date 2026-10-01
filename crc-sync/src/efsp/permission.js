'use strict';

const facilityConfig = require('./facility-config');
const { CARRIER_TRANSFERS } = require('./carrier/transfers'); // pure (docs/adr/0064)

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
const OP_KINDS = [
  'CreateStrip', 'MoveStrip', 'SetBlock', 'TransferStrip',
  'SetFlag', 'SetState', 'InvokeNla', 'Undo', 'DropStrip',
  'HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT',
  // docs/adr/0023 — converts a DEPARTURE Strip at HANDED_OFF into an
  // ARRIVAL Strip IN PLACE (same Strip, same FDR), for a flight returning
  // to the same Facility that just handed it off. Deliberately restricted
  // the same way the 5 coordination primitives are (only APP/CTR sit on a
  // boundary where this makes sense) — see COORDINATION_OP_KINDS' own
  // comment for why that exclusion pattern exists, and why it applies here
  // too, not just to those 5.
  'ConvertToArrival',
  // WP4A second slice (docs/adr/0025) — TOFI (guide §4.6.3), the ATC<->MRU
  // sub-protocol. Deliberately NOT folded into COORDINATION_OP_KINDS below
  // (that set is specifically the 5 ATC<->ATC primitives) and deliberately
  // NOT granted to APP even though APP otherwise gets the full OP_KINDS
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
// PERMISSIONS below can grant them to exactly APP/CTR without repeating
// the list, and so canMutate()'s D21 shape stays a single flat lookup.
const COORDINATION_OP_KINDS = ['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT'];

// Op kinds restricted to exactly APP/CTR, for reasons other than being a
// cross-Facility coordination primitive — currently just ConvertToArrival
// (docs/adr/0023). Kept separate from COORDINATION_OP_KINDS since it isn't
// one (no cross-Facility exchange, no replica — a same-Facility in-place
// role change), but needs the identical exclusion from OPS/CD/GND/TWR.
const APP_CTR_ONLY_OP_KINDS = ['ConvertToArrival'];

// Approving a flight into an airspace is something the Position working that
// airborne flight does — APP and CTR here, since they are the Positions that
// hold a flight once it is airborne. Kept separate from
// APP_CTR_ONLY_OP_KINDS, which those two hold for an unrelated reason, so
// neither list has to be read as "and also these".
const AIRSPACE_ENTRY_OP_KINDS = ['ApproveAirspaceEntry', 'ClearAirspaceEntry'];

// TOFI (guide §4.6.3) — split out the same way COORDINATION_OP_KINDS is,
// so it can be excluded from NON_CREATE_OPS/OPS's grant (nobody gets it by
// default) and explicitly re-added only where guide §4.1's own Position
// table names it (CTR, TAC_C2, GCI — see PERMISSIONS below).
const TOFI_OP_KINDS = ['TOFI'];

const NON_CREATE_OPS = OP_KINDS.filter(k => k !== 'CreateStrip' && !COORDINATION_OP_KINDS.includes(k) && !APP_CTR_ONLY_OP_KINDS.includes(k) && !TOFI_OP_KINDS.includes(k) && !AIRSPACE_ENTRY_OP_KINDS.includes(k));

// WP4A second slice (docs/adr/0025) — defect D12: "TAC_C2, GCI, AIC and
// JTAC MUST NOT be given HANDOFF or POINT_OUT" (guide §4.1 rule 1), which
// this generalizes to all 5 COORDINATION_OP_KINDS. Read from facility-
// config.js's per-Position positionClasses map (docs/adr/0020's own
// directive: "gate the 5 coordination op kinds on [a class concept]...
// rather than the current flat per-Position-ID PERMISSIONS table") instead
// of a hand-maintained ID list, so a future MRU/non-ATC Position
// automatically inherits the same refusal with no new line needed here.
// Applied as a structural strip-back below, layered on top of the
// hand-authored PERMISSIONS table (belt-and-suspenders): even a future
// typo that accidentally grants a coordination kind to an MRU Position's
// entry gets silently corrected by this loop, not just documented against.
const MRU_OR_NON_ATC_CLASSES = new Set(['MRU', 'MRU_POSITION', 'NON_ATC']);
function _isMruOrNonAtc(positionId) {
  return MRU_OR_NON_ATC_CLASSES.has(facilityConfig.getPositionClass(positionId));
}

// Guide §4.1's `RANGE` row: Class "Using agency", Primitives "no strip
// primitives — owns airspace state", Strip Roles "none". A Position of this
// class works no Strips at all, so it is refused every Strip op kind by
// class, in canMutate below.
//
// Refusing by class rather than by omission from PERMISSIONS matters because
// the RANGES Facility's Positions are DERIVED from the airspace config
// (facility-config.js) rather than hand-listed here — there is no table entry
// to leave out, and an unknown Position currently falls through to "no
// permissions" only as a side effect of PERMISSIONS[id] being undefined.
// This makes the refusal the rule it is meant to be, and keeps holding if
// someone later adds a table entry for a range Position by mistake.
const NO_STRIP_OP_CLASSES = new Set(['USING_AGENCY']);
function _worksNoStrips(positionId) {
  return NO_STRIP_OP_CLASSES.has(facilityConfig.getPositionClass(positionId));
}

// B5 (docs/adr/0080, decisions.md H40): a NON_ATC Position (JTAC) has no scope
// either (`positionRadars.JTAC` is []), so it can neither say which blip a
// flight is nor declare MARSA. Derived from the class, so a future non-ATC
// Position is covered with no edit here.
const NO_SCOPE_CLASSES = new Set(['NON_ATC']);
function _hasNoScope(positionId) {
  return NO_SCOPE_CLASSES.has(facilityConfig.getPositionClass(positionId));
}

// The coarse "may this Position class ever perform this KIND of op at
// all" gate — CreateStrip is included here for OPS/APP (both originate
// Strips, just for different roles) but the role itself is gated
// separately by canCreateStripRole(), which board-store.js's
// _applyCreateStrip calls in addition to this. The 5 COORDINATION_OP_KINDS
// are included only for APP/CTR (guide §4.6: only ATC⇄ATC Positions that
// actually sit on a Facility boundary get these — WP4A's deferred MRU
// Positions, docs/adr/0020, get none at all, which is D12's refusal case).
// ConvertToArrival is restricted the same way, for the same underlying
// reason (only APP/CTR ever hold a DEPARTURE Strip at its HANDED_OFF
// terminus in a position to convert it).
const PERMISSIONS = {
  OPS: new Set(OP_KINDS.filter(k => !COORDINATION_OP_KINDS.includes(k) && !APP_CTR_ONLY_OP_KINDS.includes(k) && !TOFI_OP_KINDS.includes(k) && !AIRSPACE_ENTRY_OP_KINDS.includes(k))),
  CD:  new Set(NON_CREATE_OPS),
  GND: new Set(NON_CREATE_OPS),
  TWR: new Set(NON_CREATE_OPS),
  // APP deliberately excludes TOFI even though it otherwise gets the full
  // OP_KINDS set — guide §4.1's own Position table lists TOFI only for CTR
  // among the ATC Positions built so far; APP is not on TOFI's ATC side.
  APP: new Set(OP_KINDS.filter(k => !TOFI_OP_KINDS.includes(k))),
  // CTR gets CreateStrip too — it self-originates ARRIVAL Strips as the new
  // terminus stub (docs/adr/0014, mirroring the same "nothing further
  // upstream is built yet" shape as docs/adr/0008's original APP stub),
  // since no third Facility exists upstream of CENTER this slice. CTR also
  // gets TOFI (WP4A second slice) — the full OP_KINDS set already includes it.
  CTR: new Set(OP_KINDS),
  // WP4A second slice — TAC_C2/GCI (class MRU) get ordinary Strip
  // mechanics plus CreateStrip (they originate MISSION Strips, guide §9.8)
  // plus TOFI, explicitly minus all 5 COORDINATION_OP_KINDS (D12 — an MRU
  // must never be offered HANDOFF/POINT_OUT/TRAFFIC/OPERATIONAL_REQUEST/
  // AIT, even in combination with a Position that does hold them; see the
  // D21 regression test and the class-derived strip-back loop below).
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
  // The CARRIER Facility (docs/adr/0064 B4, docs/adr/0074; guide §4.1: "Military
  // ATC afloat"). Written as literals over NON_CREATE_OPS, which already excludes
  // every coordination primitive, TOFI, ConvertToArrival and the airspace-entry
  // ops: "the carrier does not talk to the centre" (§9.13) holds by construction,
  // not by a list that has to stay current. Only the Marshal originates Strips
  // (launch and recovery check-in); FINAL and PATTERN Strips come only by a
  // carrier transfer. CarrierTransfer is NOT in OP_KINDS (it is not a `.filter()`
  // grant anyone could pick up silently): board-store.js's dispatch asks
  // canRecordCarrierTransfer below, one acting Position and one transfer kind.
  CV_MARSHAL: new Set([...NON_CREATE_OPS, 'CreateStrip']),
  CV_PRIFLY:  new Set(NON_CREATE_OPS),
  CV_APP1:    new Set(NON_CREATE_OPS),
  CV_APP2:    new Set(NON_CREATE_OPS),
};

// D12, enforced structurally rather than merely by careful hand-authoring
// above (docs/adr/0020's own directive — see MRU_OR_NON_ATC_CLASSES'
// comment). Any Position whose facility-config class is MRU/MRU_POSITION/
// NON_ATC loses every one of the 5 COORDINATION_OP_KINDS here, regardless
// of what PERMISSIONS[positionId] was constructed with above.
for (const [positionId, ops] of Object.entries(PERMISSIONS)) {
  if (_isMruOrNonAtc(positionId)) {
    for (const opKind of COORDINATION_OP_KINDS) ops.delete(opKind);
  }
}

// Which Strip Role(s) a Position may originate via CreateStrip. Every
// Position in PERMISSIONS with CreateStrip in its op-kind set MUST have an
// entry here (even if empty) — see the "every CreateStrip-eligible
// Position has a CREATE_ROLE_PERMISSIONS entry" test.
const CREATE_ROLE_PERMISSIONS = {
  OPS: new Set(['DEPARTURE']),
  // docs/adr/0023 reopens this — ADR 0014 had deliberately emptied it,
  // reasoning ARRIVAL Strips at APP should only ever arrive via the real
  // CTR->APP HANDOFF, never local self-creation. Live testing against real
  // ATC scenarios (a VFR aircraft picking up an IFR clearance airborne, an
  // aircraft from an uncontrolled field with no flight plan on file, ...)
  // found that reasoning too narrow: guide §4.1's own Position table lists
  // APP's Strip Roles as "all", and none of those pop-up scenarios have a
  // sending Facility to HANDOFF from — the flight simply isn't in the
  // system yet until whichever Position takes the radio call originates
  // it directly. ARRIVAL Strips can now originate BOTH ways: via a real
  // cross-Facility HANDOFF, or via APP self-originating one directly, same
  // as CTR already could.
  APP: new Set(['ARRIVAL', 'OVERFLIGHT']),
  // CTR self-originates ARRIVAL Strips (docs/adr/0014) — now also
  // OVERFLIGHT (docs/adr/0023), for a flight transiting Center's airspace
  // without landing or departing at Incirlik at all (guide §2/§6.3).
  CTR: new Set(['ARRIVAL', 'OVERFLIGHT']),
  // WP4A second slice — TAC_C2/GCI originate MISSION Strips (guide §9.8:
  // "TAC_C2 works mission lines"). A standalone origination (own fresh
  // FDR) for a mission that never touches ATC-controlled airspace at all —
  // separate from, and coexisting with, a MISSION Strip minted as a TOFI
  // ENTRY exchange's byproduct (board-store.js's receiveTofiProposal),
  // which shares its FDR with the ATC-side Strip instead.
  TAC_C2: new Set(['MISSION']),
  GCI: new Set(['MISSION']),
  // Launch and recovery check-in are both a MARSHAL Strip (ADR 0064: a launch is
  // a MARSHAL Strip in LAUNCH). FINAL and PATTERN are never created, only
  // converted to by a carrier transfer, so no Position may CreateStrip them.
  CV_MARSHAL: new Set(['MARSHAL']),
};

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
 * The carrier's ship-level capabilities (docs/adr/0064 B4, docs/adr/0074), in
 * the capability-table shape docs/adr/0080 gave the tactical Positions: one row
 * per Position, one column per capability, static (P5), so the next capability
 * is a column. Read through the one-parameter predicates below (D21: exactly one
 * acting Position, never a held set). They are predicates and not OP_KINDS
 * entries because the Case, the stack and the ship input are not Strip ops: they
 * go to the CarrierStore (carrier-store.js), which asks these.
 *
 *  setsCase        the recovery Case is PriFly's alone (guide §4.1); Marshal may not
 *  sequencesStack  every stack op, including the marshal radial (H27) and Charlie time
 *  editsShipInput  the one thing a controller may enter on the banner: the altimeter
 *
 * A carrier transfer's sender is read from CARRIER_TRANSFERS[kind].from (the
 * model's own data), not repeated here.
 */
const CARRIER_CAPABILITIES = {
  CV_MARSHAL: { setsCase: false, sequencesStack: true,  editsShipInput: true },
  CV_PRIFLY:  { setsCase: true,  sequencesStack: false, editsShipInput: true },
  CV_APP1:    { setsCase: false, sequencesStack: false, editsShipInput: false },
  CV_APP2:    { setsCase: false, sequencesStack: false, editsShipInput: false },
};

function _carrierCap(positionId, key) {
  return Object.prototype.hasOwnProperty.call(CARRIER_CAPABILITIES, positionId) && CARRIER_CAPABILITIES[positionId][key] === true;
}
function canSetRecoveryCase(actingPositionId) { return _carrierCap(actingPositionId, 'setsCase'); }
function canSequenceMarshalStack(actingPositionId) { return _carrierCap(actingPositionId, 'sequencesStack'); }
function canEditShipStateInput(actingPositionId) { return _carrierCap(actingPositionId, 'editsShipInput'); }
/** May this Position record this carrier transfer (the model's `from` list)? */
function canRecordCarrierTransfer(actingPositionId, kind) {
  const row = typeof kind === 'string' && Object.prototype.hasOwnProperty.call(CARRIER_TRANSFERS, kind) ? CARRIER_TRANSFERS[kind] : null;
  return !!row && row.from.includes(actingPositionId);
}

/**
 * Field state (guide §9.7, docs/adr/0061) — who may do what to a runway. An
 * explicit table with its own predicate, NOT entries in OP_KINDS: every
 * PERMISSIONS row built with a `.filter()` over OP_KINDS would pick a new kind
 * up silently (this module's header, and D21). A Position absent from a row —
 * a range Position, an MRU, anything unknown — is refused by that absence.
 *
 * [SOURCE-DEFINED] where the guide is silent:
 *   - Tower is the sole authority over the runways (decisions.md H18): only TWR
 *     closes, opens, or takes a runway out for runway works. Everyone else
 *     ASKS (RequestRunwayStatus), and TWR accepts or rejects.
 *   - OPS completes the runway works and performs the inspection (guide §9.7
 *     rule 2: "by default OPS (AMOPS)").
 *   - TWR proposes, begins and completes a runway change; OPS and APP
 *     acknowledge it (rule 3; OPS stands in for the SOF). An acknowledger
 *     nobody holds is skipped and audited by the store (decisions.md H20),
 *     never answered from another Facility (S-R2-15).
 *
 * Two rows are CEILINGS the store narrows further from config, never widens:
 * CompleteInspection (to `fieldState.inspectionAuthorityPositionId`) and
 * Ack/RejectRunwayChange (to the change's frozen acknowledger set). Inspection
 * authority is therefore NOT configurable wider than OPS — widening it needs
 * config-derived permissions (docs/adr/0035's shape), a bigger change than
 * this deliverable.
 */
const FIELD_STATE_OP_OWNERS = {
  CloseRunway:                ['TWR'],
  OpenRunway:                 ['TWR'],
  BeginRunwayWorks:           ['TWR'],
  CompleteRunwayWorks:        ['OPS'],
  CompleteInspection:         ['OPS'],
  RequestRunwayStatus:        ['OPS', 'CD', 'GND', 'APP'],
  AcceptRunwayRequest:        ['TWR'],
  RejectRunwayRequest:        ['TWR'],
  ProposeRunwayChange:        ['TWR'],
  SelfCoordinateRunwayChange: ['TWR'],
  WithdrawRunwayChange:       ['TWR'],
  BeginRunwayChange:          ['TWR'],
  CompleteRunwayChange:       ['TWR'],
  AckRunwayChange:            ['OPS', 'APP'],
  RejectRunwayChange:         ['OPS', 'APP'],
};

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
 *    state until it is DROPPED, whoever holds the Strip.
 * The acting Position must still hold the op kind (canMutate runs first).
 */
const TOFI_ANSWER_ACTIONS = ['ACCEPT', 'REJECT', 'TRANSFER_COMMS'];
const NON_OWNER_BLOCK_WRITES = [
  { blockId: '14E', role: 'DEPARTURE', positions: ['OPS'] },
];
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
  // CTR added (docs/adr/0022 bug fix) — a CENTER-held HANDED_OFF Strip
  // (received via APP's real HANDOFF, mirroring ARRIVAL_STATE_OWNERS.
  // INBOUND's existing ['APP','CTR'] entry for the reverse direction)
  // needs its owning Position authorized to Drop it, same as APP's own
  // copy. Without this, a CENTER-side replica — whether legitimately
  // ACCEPTed and moved to ctr-departures, or REJECTed and left inert in
  // ctr-app-coordination — had NO way to ever be cleared: NLA's Drop
  // button rendered but stayed permanently disabled (canActOnState denied
  // to CTR), found in live testing.
  HANDED_OFF:        ['APP', 'CTR'],
  // DROPPED is terminal — no NLA exists for it, so no entry is needed.
};

// [SOURCE-DEFINED] — ARRIVAL has no guide-published "normally owned by"
// table (§3.4 only gives the state sequence); this mirrors the same
// per-Position-per-lifecycle-stage shape as DEPARTURE's guide-sourced one.
const ARRIVAL_STATE_OWNERS = {
  // CTR added (docs/adr/0014) — a CENTER-held INBOUND Strip (CTR's own
  // local origination, mirroring APP's original ADR 0008 stub) needs its
  // owning Position authorized to act on it too, even though "acting on
  // it" now means proposing a cross-Facility HANDOFF via the Coordinate
  // button rather than an ordinary NLA transfer (nla.js's computeArrivalNla
  // INBOUND case is Facility-aware — see that module's comment).
  INBOUND:         ['APP', 'CTR'],
  HANDED_TO_TOWER: ['TWR'],
  FINAL:           ['TWR'],
  LANDED:          ['TWR'],
  TAXI_IN:         ['GND'],
};

// [SOURCE-DEFINED] (docs/adr/0023) — OVERFLIGHT has no guide-published
// state table at all (§6.3 only notes it shares Blocks 20/21 with
// ARRIVAL); its 2-state TRANSITING->DROPPED lifecycle mirrors DEPARTURE's
// own HANDED_OFF->DROPPED terminus shape. Both Positions that may
// originate one (permission.js's CREATE_ROLE_PERMISSIONS) may also act on
// it, same "self-originator owns it" precedent as ARRIVAL's INBOUND row.
const OVERFLIGHT_STATE_OWNERS = {
  TRANSITING: ['APP', 'CTR'],
  // DROPPED is terminal — no NLA exists for it, so no entry is needed.
};

// [SOURCE-DEFINED] (WP4A second slice) — MISSION has no guide-published
// state-ownership table (§9.8 only names the lifecycle, guide line 215);
// mirrors OVERFLIGHT_STATE_OWNERS' "self-originator owns it" precedent —
// whichever Position originated the mission (CREATE_ROLE_PERMISSIONS
// above) works its entire lifecycle solo. AIC/JTAC deliberately absent:
// AIC works under TAC_C2's TOFI rather than owning state transitions
// itself; JTAC's absence alone is what makes it read-only (guide §4.1:
// "MISSION (read-only)"), no separate mechanism needed.
const MISSION_STATE_OWNERS = {
  TASKED:     ['TAC_C2', 'GCI'],
  AIRBORNE:   ['TAC_C2', 'GCI'],
  ON_STATION: ['TAC_C2', 'GCI'],
  OFF_STATION: ['TAC_C2', 'GCI'],
  RTB:        ['TAC_C2', 'GCI'],
  // DROPPED is terminal — no NLA exists for it, so no entry is needed.
};

// The carrier's three Roles (docs/adr/0064 B2, docs/adr/0074), [SOURCE-DEFINED]
// like every state table here: guide §4.1 names the Positions and §9.12 the
// hand-overs, and neither publishes "normally owned by". The Marshal owns a
// flight until Commence; then the lane controller owns COMMENCED, ON_FINAL,
// BALL and BOLTER_WAVEOFF; PriFly owns the pattern. Case I and Case II Strips
// reach PriFly by their own transfer (carrier/transfers.js).
const CV_LANES = ['CV_APP1', 'CV_APP2'];
const MARSHAL_STATE_OWNERS = {
  LAUNCH:    ['CV_MARSHAL'],
  IN_STACK:  ['CV_MARSHAL'],
  COMMENCED: CV_LANES,
};
const FINAL_STATE_OWNERS = {
  ON_FINAL:       CV_LANES,
  BALL:           CV_LANES,
  BOLTER_WAVEOFF: CV_LANES,
};
const PATTERN_STATE_OWNERS = {
  IN_PATTERN: ['CV_PRIFLY'],
  RECOVERED:  ['CV_PRIFLY'],
};

const STATE_OWNERS_BY_ROLE = {
  DEPARTURE: DEPARTURE_STATE_OWNERS, ARRIVAL: ARRIVAL_STATE_OWNERS, OVERFLIGHT: OVERFLIGHT_STATE_OWNERS, MISSION: MISSION_STATE_OWNERS,
  MARSHAL: MARSHAL_STATE_OWNERS, FINAL: FINAL_STATE_OWNERS, PATTERN: PATTERN_STATE_OWNERS,
};

// WP4A second slice — TOFI's target resolution (guide §4.6.3, ATC<->MRU).
// Per guide §4.1's own Position table, TOFI is listed only for CTR among
// the ATC Positions built so far (not APP) — so the ATC side is CTR only,
// but the MRU side has two candidates (TAC_C2, GCI), and this table
// resolves which counterpart(s) are valid for a given acting Position
// rather than assuming a fixed 1:1 pair the way the older, narrower
// COORDINATION_TARGETS-style stub could. Small and static (not full
// dynamic discovery) — board-store.js's _applyTofiPropose validates a
// proposal's target against this for defense in depth, and
// crc-desktop's TOFI popover mirrors it to build its target picker.
const TOFI_COUNTERPARTS = {
  CTR:    [{ facilityId: 'TACTICAL', positionId: 'TAC_C2' }, { facilityId: 'TACTICAL', positionId: 'GCI' }],
  TAC_C2: [{ facilityId: 'CENTER', positionId: 'CTR' }],
  GCI:    [{ facilityId: 'CENTER', positionId: 'CTR' }],
};

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
};
