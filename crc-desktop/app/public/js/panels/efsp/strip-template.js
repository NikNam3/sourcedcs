'use strict';

// The Departure Block Map as data (EFSPImplementationGuide.md §6.2, §6.5)
// — client-side copy. Deliberately a literal duplicate of crc-sync's
// src/efsp/block-map.js, NOT an import: crc-sync and crc-desktop are
// separately deployed packages with separate build contexts (same reason
// src/auth.js is duplicated across crc-sync/sourcedcs-web/atobrief). Kept
// in sync by each side's own test suite asserting the same binding table
// shape (see docs/adr/0001-json-wire-format-not-protobuf.md's consequence
// note on schema drift) — not a compiled contract.
//
// resolveBlockValue() is kept PURE and separate from DOM writing (bay-
// view.js/efsp-panel.js do the actual rendering) so it's testable without
// a DOM — same discipline as los.js's math functions.

// docs/adr/0024 — `label` added to every entry (guide §2's own Block Map
// definition names it as one of the fields a Block Map maps to; it was the
// one field never actually added). Client-only — block-map.js (server) is
// never used for display, only validation/permission/routing, matching the
// same asymmetry efsp-block-map-parity.test.js already documents for
// `field`/`flag`. Kept to 8 characters or fewer so the compact view never
// has to grow wider to fit one, and UNIQUE within a Role — a label is the
// only thing telling two Blocks apart, and the expanded view renders the long
// tail where four Blocks once all read NOTE and three all read RESTR. Take the
// wording from the guide's own §6.2/§6.3 field column rather than inventing
// one; several of those seven were wrong, not just ambiguous.
// efsp-strip-template.test.js holds both rules.
const DEPARTURE_BLOCK_MAP = {
  '1':  { required: true,  label: 'CALLSIGN', target: { kind: 'fdr', path: 'identity.callsign' } },
  '2':  { required: true,  label: 'REV',      target: { kind: 'system', field: 'rev' } },
  '2A': { required: false, label: 'VOICE',     target: { kind: 'annotation' } },
  '3':  { required: true,  label: 'TYPE',     target: { kind: 'composite' } },
  // docs/adr/0023 gap-closure — see crc-sync's block-map.js's '3A' comment
  // for the full rationale. Plain 'fdr'-routed, like '5A'.
  '3A': { required: false, label: 'ACFT',     target: { kind: 'fdr', path: 'identity.aircraftType' } },
  '3B': { required: false, label: 'WAKE',     target: { kind: 'fdr', path: 'identity.wakeCategory' } },
  '3C': { required: false, label: 'TAIL',     target: { kind: 'fdr', path: 'identity.tailNumber' } },
  '3D': { required: false, label: 'UNIT',     target: { kind: 'fdr', path: 'identity.unit' } },
  '3E': { required: false, label: 'HOME',     target: { kind: 'fdr', path: 'identity.homeStation' } },
  // WP6 (crc-sync's docs/adr/0052) — guide §6.4's military extension
  // namespace. Mirrors crc-sync's block-map.js; see its MILITARY_BLOCK_NAMESPACE
  // table for the whole guide-M-number-to-Block-id mapping and why the
  // M-prefix is not reused. Both hang off Block 3 because the 3-family is the
  // airframe, and both are on all three ATC Roles.
  //
  // 3F is a click-to-toggle boolean (BOOLEAN_TOGGLE_BLOCKS below) and 3G an
  // enum <select> (ENUM_SELECT_BLOCKS) — never the generic free-text path,
  // same as IFR and SREG.
  '3F': { required: false, label: 'HOOK',     target: { kind: 'military', field: 'hookRequired' } },  // guide M15, §9.7
  '3G': { required: false, label: 'ORDNANCE', target: { kind: 'military', field: 'ordnanceState' } }, // guide M14, §9.5
  '4':  { required: true,  label: 'CID',      target: { kind: 'system', field: 'cid' } },
  '4A': { required: false, label: 'RMV',      target: { kind: 'flag', flag: 'removeIndicator' } },
  '4B': { required: true,  label: 'DATALINK', target: { kind: 'fdr', path: 'assigned.datalinkClearanceIndicator' } },
  '5':  { required: true,  label: 'SQUAWK',   target: { kind: 'fdr', path: 'identity.beaconAssigned' } },
  // WP4A gap-closure — track-degradation flag. Mirrors crc-sync's
  // block-map.js's '5A' exactly (plain 'fdr'-routed — see that module's
  // comment for why this one needs no dedicated target kind, unlike 24A).
  '5A': { required: false, label: 'DEGR',     target: { kind: 'fdr', path: 'identity.trackDegradationFlag' } },
  '6':  { required: true,  label: 'PROP DEP', target: { kind: 'fdr', path: 'filed.proposedDepartureTimeUtc' } },
  '7':  { required: true,  label: 'CRUS ALT', target: { kind: 'fdr', path: 'filed.requestedAltitude' } }, // what was filed; the assigned altitude is the clearance (docs/adr/0058)
  '8':  { required: true,  label: 'DEP',      target: { kind: 'fdr', path: 'filed.departureAirport' } },
  '8A': { required: true,  label: 'RWY',      target: { kind: 'fdr', path: 'filed.departureRunway' } },
  '8B': { required: true,  label: 'DEST',     target: { kind: 'fdr', path: 'filed.destinationAirport' } },
  '9':  { required: true,  label: 'RTE',      target: { kind: 'fdr', path: 'filed.route' }, provenance: 'COMPUTER_GENERATED' },
  '9A': { required: false, label: 'FAC A',    target: { kind: 'annotation' } },
  '9B': { required: false, label: 'FAC B',    target: { kind: 'annotation' } },
  '9C': { required: false, label: 'FAC C',    target: { kind: 'annotation' } },
  '9D': { required: true,  label: 'FULL RTE', target: { kind: 'fdr', path: 'filed.fullRouteClearance' } },
  '9E': { required: true,  label: 'RMKS',     target: { kind: 'fdr', path: 'filed.remarks' } },
  // §9.10 stereo route name (docs/adr/0050) — mirrors crc-sync's
  // block-map.js '9F' exactly; see that module's comment for why it is not
  // numbered M18 and why writing it re-files the flight rather than just
  // relabelling it. A picker of the configured routes, never free text
  // (docs/adr/0073): 0050 left it free text because ENUM_SELECT_BLOCKS is a
  // static literal and the route table is runtime config. The runtime option
  // source is efsp-stereo-routes.js's cache of the last fetched list, read by
  // enumSelectOptionsFor(blockId, fdr) below. The server still resolves every
  // name and refuses one it does not have (a stale list).
  '9F': { required: false, label: 'STEREO',   target: { kind: 'fdr', path: 'filed.stereoRouteName' } },
  // §9.4 MTR fields (crc-sync's docs/adr/0062): 9G-* is the guide's M10, 9H-*
  // its M11. Plain fdr, no interlock (9H-ALT is the pilot's request, not a
  // clearance). The two times display as HHMM (ZULU_HHMM_BLOCKS below).
  '9G-MTR':   { required: false, label: 'MTR',      target: { kind: 'fdr', path: 'military.mtr.designator' } },
  '9G-ENTRY': { required: false, label: 'ENTRY',    target: { kind: 'fdr', path: 'military.mtr.entryFix' } },
  '9G-TIME':  { required: false, label: 'ENTRY TM', target: { kind: 'fdr', path: 'military.mtr.entryTimeUtc' } },
  '9H-EXIT':  { required: false, label: 'EXIT',     target: { kind: 'fdr', path: 'military.mtr.exitFix' } },
  '9H-TIME':  { required: false, label: 'EXIT EST', target: { kind: 'fdr', path: 'military.mtr.exitEstimateUtc' } },
  '9H-ALT':   { required: false, label: 'EXIT ALT', target: { kind: 'fdr', path: 'military.mtr.requestedAltitudeAfterExit' } },
  '10': { required: true,  label: 'ATIS',     target: { kind: 'fdr', path: 'assigned.atisCode' } },
  '11': { required: true,  label: 'APREQ',    target: { kind: 'annotation' } },
  '14': { required: true,  label: 'RLS TIME', target: { kind: 'fdr', path: 'assigned.releaseTimeUtc' } },
  // WP4A (docs/adr/0017), §4.6.2 — mirrors crc-sync's block-map.js exactly.
  // See crc-sync's block-map.js for why these two exist and why they are
  // numbered in the 14-family.
  '14A': { required: false, label: 'RLS ST', target: { kind: 'fdr', path: 'assigned.releaseState' } },
  '14D': { required: false, label: 'VOID',      target: { kind: 'fdr', path: 'assigned.voidTimeUtc' } },
  '14B': { required: false, label: 'EDCT',    target: { kind: 'fdr', path: 'assigned.edctTimeUtc' } },
  '14C': { required: false, label: 'CFR',     target: { kind: 'fdr', path: 'assigned.callForReleaseTimeUtc' } },
  '14E': { required: false, label: 'ALERT',   target: { kind: 'military', field: 'alertStatus' } }, // WP6, guide M16 §9.6 — crc-sync docs/adr/0070
  '16': { required: false, label: 'MVMT',     target: { kind: 'fdr', path: 'assigned.movementAreaEntryTimeUtc' } },
  '17': { required: false, label: 'TAXI',     target: { kind: 'fdr', path: 'assigned.taxiTimeUtc' } },
  '18': { required: true,  label: 'TAKEOFF',  target: { kind: 'fdr', path: 'assigned.takeoffTimeUtc' } },
  '19': { required: false, label: 'GATE',     target: { kind: 'annotation' } },
  // These are NOT scratchpads, and were mislabelled as such until WP6. Guide
  // §6.2's own DEPARTURE table names Block 20 "Heading" and Block 21 "Initial
  // altitude"; it is ARRIVAL and OVERFLIGHT where 20/21 are the radar
  // scratchpads (§6.3 note 2), and that meaning was copied onto DEPARTURE by
  // mistake. CONFIRM_VACATED_ELIGIBLE_BLOCKS below has always listed
  // DEPARTURE's '21', which only makes sense for an altitude.
  //
  // It matters more now than it did: crc-sync's docs/adr/0051 makes these two
  // the Blocks §9.2's MARSA interlock watches, so a controller typing into a
  // chip labelled SCRATCH could void a live AR with no idea why.
  //
  // The `interlock` tag itself is carried client-side as of WP6: it was
  // server-only under docs/adr/0051, so crc-sync could tag a Block and the
  // client had no way to know which Blocks §9.2 watches — fine while the only
  // use was a tooltip the client composes for itself, wrong the moment it
  // needs to say so per-Block. efsp-block-map-parity.test.js compares it now.
  // docs/adr/0058 — the flight's clearance, on the FDR and shared with every
  // Facility: CD issues ALT with the clearance, APP/CTR amend it and vector.
  '20': { required: false, label: 'HDG',      target: { kind: 'clearance', field: 'heading' }, interlock: 'COURSE' },
  '21': { required: false, label: 'ALT',      target: { kind: 'clearance', field: 'altitude' }, interlock: 'ALTITUDE' },
  // The guide's own Block 22, "Frequency" — structured rather than a
  // free-text annotation since the RANGE slice, so approving a flight onto
  // an airspace's frequency can write it directly and it validates as one
  // unit and one type (MHz, a number).
  '22': { required: false, label: 'FREQ',     target: { kind: 'frequency' } },
  '23': { required: false, label: 'FAC RMKS',     target: { kind: 'annotation' } },
  '24': { required: true,  label: 'MIT RMKS',     target: { kind: 'annotation' } },
  // WP4A (docs/adr/0018), §4.6.4 — airspace ownership as a direction. Not
  // fdr/annotation-routed on either side (see efsp-block-map-parity.test.js's
  // isWritableKind) — edited via a dedicated <select> widget (bay-view.js's
  // enum-Block renderer), never the generic free-text click-to-edit path
  // (docs/adr/0022 gave this its first actual UI).
  '24A': { required: false, label: 'ARSPC',   target: { kind: 'airspace-owner' } },
  // WP4A second slice, §4.6.3 — the three-field separation model. See
  // resolveBlockValue's 'tofi' branch and _buildBlockCell's IFR toggle for
  // why IFR isn't in ENUM_SELECT_BLOCKS the way RSVC/SREG are.
  'IFR':  { required: false, label: 'IFR',     target: { kind: 'tofi', field: 'ifrActive' } },
  'RSVC': { required: false, label: 'RADAR',   target: { kind: 'tofi', field: 'radarService' } },
  'SREG': { required: false, label: 'SEP REG', target: { kind: 'tofi', field: 'separationRegime' } },
  '25': { required: true,  label: 'STATE',    target: { kind: 'system', field: 'state' } },
  '26': { required: true,  label: 'NLA',      target: { kind: 'nla' } },
};

// [SOURCE-DEFINED] Arrival Block Map (Phase 2, docs/adr/0008) — client
// mirror of crc-sync's ARRIVAL_BLOCK_MAP; see that module's header comment
// for the full design rationale (why Block 7 is annotation-routed, the
// 9A-* split, the 20/21 scratchpad simplification). Kept in sync by
// efsp-block-map-parity.test.js, same as DEPARTURE_BLOCK_MAP.
const ARRIVAL_BLOCK_MAP = {
  '1':        { required: true,  label: 'CALLSIGN', target: { kind: 'fdr', path: 'identity.callsign' } },
  '2':        { required: true,  label: 'REV',      target: { kind: 'system', field: 'rev' } },
  '2A':       { required: false, label: 'VOICE',     target: { kind: 'annotation' } },
  '3':        { required: true,  label: 'TYPE',     target: { kind: 'composite' } },
  '3A':       { required: false, label: 'ACFT',     target: { kind: 'fdr', path: 'identity.aircraftType' } }, // docs/adr/0023 gap-closure — see DEPARTURE_BLOCK_MAP's '3A' comment
  '3B':       { required: false, label: 'WAKE',     target: { kind: 'fdr', path: 'identity.wakeCategory' } },
  '3C':       { required: false, label: 'TAIL',     target: { kind: 'fdr', path: 'identity.tailNumber' } },
  '3D':       { required: false, label: 'UNIT',     target: { kind: 'fdr', path: 'identity.unit' } },
  '3E':       { required: false, label: 'HOME',     target: { kind: 'fdr', path: 'identity.homeStation' } },
  '3F':       { required: false, label: 'HOOK',     target: { kind: 'military', field: 'hookRequired' } },  // WP6, guide M15 §9.7 — see DEPARTURE_BLOCK_MAP's '3F'/'3G' comment
  '3G':       { required: false, label: 'ORDNANCE', target: { kind: 'military', field: 'ordnanceState' } }, // WP6, guide M14 §9.5
  '4':        { required: true,  label: 'CID',      target: { kind: 'system', field: 'cid' } },
  '4A':       { required: false, label: 'RMV',      target: { kind: 'flag', flag: 'removeIndicator' } },
  '4B':       { required: true,  label: 'DATALINK', target: { kind: 'fdr', path: 'assigned.datalinkClearanceIndicator' } },
  '5':        { required: true,  label: 'SQUAWK',   target: { kind: 'fdr', path: 'identity.beaconAssigned' } },
  '5A':       { required: false, label: 'DEGR',     target: { kind: 'fdr', path: 'identity.trackDegradationFlag' } }, // WP4A gap-closure — see DEPARTURE_BLOCK_MAP's '5A' comment
  '6':        { required: true,  label: 'ETA',      target: { kind: 'fdr', path: 'filed.estimatedArrivalTimeUtc' } },
  '7':        { required: true,  label: 'ALT',      target: { kind: 'clearance', field: 'altitude' }, interlock: 'ALTITUDE' }, // docs/adr/0058
  '8':        { required: true,  label: 'ORIG',     target: { kind: 'fdr', path: 'filed.originAirport' } },
  '8A':       { required: false, label: 'FIX',      target: { kind: 'fdr', path: 'filed.arrivalFix' } },
  '8B':       { required: true,  label: 'RWY',      target: { kind: 'fdr', path: 'assigned.landingRunway' } },
  '9':        { required: true,  label: 'RTE',      target: { kind: 'fdr', path: 'filed.route' }, provenance: 'COMPUTER_GENERATED' },
  '9A-FUEL':  { required: true,  label: 'MIN FUEL', target: { kind: 'annotation' } },
  '9A-DEST':  { required: false, label: 'DEST',     target: { kind: 'annotation' } },
  '9A-PTOUT': { required: false, label: 'PT OUT',   target: { kind: 'annotation' } },
  '9A-VECTOR':{ required: false, label: 'HDG',      target: { kind: 'clearance', field: 'heading' }, interlock: 'COURSE' }, // docs/adr/0058 — a radar vector IS the assigned heading
  '9A-SPEED': { required: false, label: 'SPEED',    target: { kind: 'annotation' } },
  // §9.4 MTR fields — see DEPARTURE_BLOCK_MAP's '9G-*' comment
  '9G-MTR':   { required: false, label: 'MTR',      target: { kind: 'fdr', path: 'military.mtr.designator' } },
  '9G-ENTRY': { required: false, label: 'ENTRY',    target: { kind: 'fdr', path: 'military.mtr.entryFix' } },
  '9G-TIME':  { required: false, label: 'ENTRY TM', target: { kind: 'fdr', path: 'military.mtr.entryTimeUtc' } },
  '9H-EXIT':  { required: false, label: 'EXIT',     target: { kind: 'fdr', path: 'military.mtr.exitFix' } },
  '9H-TIME':  { required: false, label: 'EXIT EST', target: { kind: 'fdr', path: 'military.mtr.exitEstimateUtc' } },
  '9H-ALT':   { required: false, label: 'EXIT ALT', target: { kind: 'fdr', path: 'military.mtr.requestedAltitudeAfterExit' } },
  '9E':       { required: true,  label: 'RMKS',     target: { kind: 'fdr', path: 'filed.remarks' } },
  '20':       { required: false, label: 'SCRATCH1',  target: { kind: 'annotation' } },
  '21':       { required: false, label: 'SCRATCH2',  target: { kind: 'annotation' } },
  '24':       { required: true,  label: 'MIT RMKS',     target: { kind: 'annotation' } },
  '24A':      { required: false, label: 'ARSPC',    target: { kind: 'airspace-owner' } }, // WP4A, §4.6.4 — see DEPARTURE_BLOCK_MAP's '24A' comment
  'IFR':      { required: false, label: 'IFR',      target: { kind: 'tofi', field: 'ifrActive' } },       // WP4A second slice, §4.6.3 — see DEPARTURE_BLOCK_MAP's comment
  'RSVC':     { required: false, label: 'RADAR',    target: { kind: 'tofi', field: 'radarService' } },
  'SREG':     { required: false, label: 'SEP REG',  target: { kind: 'tofi', field: 'separationRegime' } },
  '25':       { required: true,  label: 'STATE',    target: { kind: 'system', field: 'state' } },
  '26':       { required: true,  label: 'NLA',      target: { kind: 'nla' } },
  // Block 22 (Frequency) on the airborne roles too — the RANGE slice. A
  // flight is approved onto an airspace's frequency while it is enroute,
  // which is exactly when its Strip is an ARRIVAL or an OVERFLIGHT, so a
  // DEPARTURE-only Block would have been invisible precisely when it matters.
  '22':       { required: false, label: 'FREQ',     target: { kind: 'frequency' } },
};

// [SOURCE-DEFINED] Overflight Block Map (docs/adr/0023) — client mirror of
// crc-sync's OVERFLIGHT_BLOCK_MAP; see that module's header comment for the
// full design rationale (why '8'/'8B' mean the flight's real origin/
// destination, never Incirlik, and why there are no ground/runway/taxi
// Blocks). Kept in sync by efsp-block-map-parity.test.js.
const OVERFLIGHT_BLOCK_MAP = {
  '1':  { required: true,  label: 'CALLSIGN', target: { kind: 'fdr', path: 'identity.callsign' } },
  '2':  { required: true,  label: 'REV',      target: { kind: 'system', field: 'rev' } },
  '3':  { required: true,  label: 'TYPE',     target: { kind: 'composite' } },
  '3A': { required: false, label: 'ACFT',     target: { kind: 'fdr', path: 'identity.aircraftType' } }, // docs/adr/0023 gap-closure — see DEPARTURE_BLOCK_MAP's '3A' comment
  '3B': { required: false, label: 'WAKE',     target: { kind: 'fdr', path: 'identity.wakeCategory' } },
  '3C': { required: false, label: 'TAIL',     target: { kind: 'fdr', path: 'identity.tailNumber' } },
  '3D': { required: false, label: 'UNIT',     target: { kind: 'fdr', path: 'identity.unit' } },
  '3E': { required: false, label: 'HOME',     target: { kind: 'fdr', path: 'identity.homeStation' } },
  '3F': { required: false, label: 'HOOK',     target: { kind: 'military', field: 'hookRequired' } },  // WP6, guide M15 §9.7 — see DEPARTURE_BLOCK_MAP's '3F'/'3G' comment
  '3G': { required: false, label: 'ORDNANCE', target: { kind: 'military', field: 'ordnanceState' } }, // WP6, guide M14 §9.5
  '4':  { required: true,  label: 'CID',      target: { kind: 'system', field: 'cid' } },
  '4A': { required: false, label: 'RMV',      target: { kind: 'flag', flag: 'removeIndicator' } },
  '4B': { required: true,  label: 'DATALINK', target: { kind: 'fdr', path: 'assigned.datalinkClearanceIndicator' } },
  '5':  { required: true,  label: 'SQUAWK',   target: { kind: 'fdr', path: 'identity.beaconAssigned' } },
  '5A': { required: false, label: 'DEGR',     target: { kind: 'fdr', path: 'identity.trackDegradationFlag' } },
  '7':  { required: true,  label: 'CRUS ALT', target: { kind: 'fdr', path: 'filed.requestedAltitude' } }, // what was filed; the assigned altitude is the clearance (docs/adr/0058)
  // WP6 (crc-sync's docs/adr/0051) — OVERFLIGHT had no Block carrying an ATC
  // course or altitude ASSIGNMENT, only the filed request above, which left
  // §9.2's MARSA interlock unreachable on this one Role. Annotation-routed
  // like ARRIVAL's equivalents, so a transiting flight's clearance history is
  // append-only (§3.7) and confirmVacated works. See the server's copy for the
  // [SOURCE-DEFINED] note on the numbering.
  // docs/adr/0058: both are the flight's clearance now, on the FDR.
  '7A': { required: false, label: 'ALT',      target: { kind: 'clearance', field: 'altitude' }, interlock: 'ALTITUDE' },
  '9A-VECTOR': { required: false, label: 'HDG', target: { kind: 'clearance', field: 'heading' }, interlock: 'COURSE' },
  '8':  { required: true,  label: 'ORIG',     target: { kind: 'fdr', path: 'filed.departureAirport' } },
  '8B': { required: true,  label: 'DEST',     target: { kind: 'fdr', path: 'filed.destinationAirport' } },
  '9':  { required: true,  label: 'RTE',      target: { kind: 'fdr', path: 'filed.route' }, provenance: 'COMPUTER_GENERATED' },
  // §9.4 MTR fields — see DEPARTURE_BLOCK_MAP's '9G-*' comment
  '9G-MTR':   { required: false, label: 'MTR',      target: { kind: 'fdr', path: 'military.mtr.designator' } },
  '9G-ENTRY': { required: false, label: 'ENTRY',    target: { kind: 'fdr', path: 'military.mtr.entryFix' } },
  '9G-TIME':  { required: false, label: 'ENTRY TM', target: { kind: 'fdr', path: 'military.mtr.entryTimeUtc' } },
  '9H-EXIT':  { required: false, label: 'EXIT',     target: { kind: 'fdr', path: 'military.mtr.exitFix' } },
  '9H-TIME':  { required: false, label: 'EXIT EST', target: { kind: 'fdr', path: 'military.mtr.exitEstimateUtc' } },
  '9H-ALT':   { required: false, label: 'EXIT ALT', target: { kind: 'fdr', path: 'military.mtr.requestedAltitudeAfterExit' } },
  '9E': { required: true,  label: 'RMKS',     target: { kind: 'fdr', path: 'filed.remarks' } },
  '20': { required: false, label: 'SCRATCH1',  target: { kind: 'annotation' } },
  '21': { required: false, label: 'SCRATCH2',  target: { kind: 'annotation' } },
  '24': { required: true,  label: 'MIT RMKS',     target: { kind: 'annotation' } },
  '24A':{ required: false, label: 'ARSPC',    target: { kind: 'airspace-owner' } },
  'IFR':  { required: false, label: 'IFR',     target: { kind: 'tofi', field: 'ifrActive' } },      // WP4A second slice, §4.6.3 — see DEPARTURE_BLOCK_MAP's comment
  'RSVC': { required: false, label: 'RADAR',   target: { kind: 'tofi', field: 'radarService' } },
  'SREG': { required: false, label: 'SEP REG', target: { kind: 'tofi', field: 'separationRegime' } },
  '25': { required: true,  label: 'STATE',    target: { kind: 'system', field: 'state' } },
  '26': { required: true,  label: 'NLA',      target: { kind: 'nla' } },
  // Block 22 (Frequency) on the airborne roles too — the RANGE slice. A
  // flight is approved onto an airspace's frequency while it is enroute,
  // which is exactly when its Strip is an ARRIVAL or an OVERFLIGHT, so a
  // DEPARTURE-only Block would have been invisible precisely when it matters.
  '22':       { required: false, label: 'FREQ',     target: { kind: 'frequency' } },
};

// [SOURCE-DEFINED] WP4A second slice — client mirror of crc-sync's
// MISSION_BLOCK_MAP; see that module's header comment for the full design
// rationale (why this is its own M-prefixed namespace, not a DEPARTURE/
// ARRIVAL field-reuse the way OVERFLIGHT's was). Kept in sync by
// efsp-block-map-parity.test.js.
const MISSION_BLOCK_MAP = {
  'M1': { required: true,  label: 'MSN #',   target: { kind: 'fdr', path: 'mission.missionNumber' } },
  'M2': { required: false, label: 'PKG',     target: { kind: 'fdr', path: 'mission.packageId' } },
  'M3': { required: true,  label: 'CALLSIGN',target: { kind: 'fdr', path: 'identity.callsign' } },
  'M4': { required: true,  label: 'SQUAWK',  target: { kind: 'fdr', path: 'identity.beaconAssigned' } },
  'M5': { required: false, label: 'CTL AGY', target: { kind: 'fdr', path: 'mission.controllingAgency' } },
  'M6': { required: false, label: 'VUL STRT',target: { kind: 'fdr', path: 'mission.vulWindowStartUtc' } },
  'M7': { required: false, label: 'VUL END', target: { kind: 'fdr', path: 'mission.vulWindowEndUtc' } },
  'M8': { required: false, label: 'RMKS',    target: { kind: 'fdr', path: 'filed.remarks' } },
  'M25': { required: true, label: 'STATE',   target: { kind: 'system', field: 'state' } },
  'M26': { required: true, label: 'NLA',     target: { kind: 'nla' } },
  // decisions.md H55 (crc-sync's docs/adr/0069): whoever the pilot talks to records hung ordnance.
  '3G': { required: false, label: 'ORDNANCE', target: { kind: 'military', field: 'ordnanceState' } }, // guide M14, §9.5
};

// The carrier's three Block Maps (crc-sync's docs/adr/0064 B3, docs/adr/0074;
// guide §9.12) — a literal duplicate of crc-sync's block-map.js, held by
// efsp-block-map-parity.test.js. `carrier-derived` Blocks are DISPLAY ONLY:
// the server derives them (angels from the stack index, DME from angels, push
// time from the Charlie time, the final bearing from the ship's heading) and
// refuses any write, so nothing here is editable and nothing here computes
// (carrier-state.js formats what the server sent). `carrier` Blocks are the
// flight's own fields, on the FDR so they survive launch to recovery.
const _CARRIER_CHROME = {
  '2':  { required: true,  label: 'REV',    target: { kind: 'system', field: 'rev' } },
  '4':  { required: true,  label: 'CID',    target: { kind: 'system', field: 'cid' } },
  '4A': { required: false, label: 'RMV',    target: { kind: 'flag', flag: 'removeIndicator' } },
  '5':  { required: false, label: 'SQUAWK', target: { kind: 'fdr', path: 'identity.beaconAssigned' } },
  '25': { required: true,  label: 'STATE',  target: { kind: 'system', field: 'state' } },
  '26': { required: true,  label: 'NLA',    target: { kind: 'nla' } },
};

const MARSHAL_BLOCK_MAP = {
  'C1':  { required: true,  label: 'CALLSIGN', target: { kind: 'fdr', path: 'identity.callsign' } },
  'C2':  { required: true,  label: 'TYPE',     target: { kind: 'fdr', path: 'identity.aircraftType' } },
  'C3':  { required: false, label: 'CASE',     target: { kind: 'carrier-derived', field: 'case' } },
  'C4':  { required: false, label: 'APPR',     target: { kind: 'carrier', field: 'approachType' } },
  'C5':  { required: false, label: 'RADIAL',   target: { kind: 'carrier-derived', field: 'marshalRadial' } },
  'C6':  { required: false, label: 'DME',      target: { kind: 'carrier-derived', field: 'marshalDme' } },
  'C7':  { required: false, label: 'ANGELS',   target: { kind: 'carrier-derived', field: 'angels' } },
  'C8':  { required: false, label: 'EAT/PUSH', target: { kind: 'carrier-derived', field: 'eatPush' } },
  'C9':  { required: false, label: 'FNL BRG',  target: { kind: 'carrier-derived', field: 'expectedFinalBearing' } },
  'C10': { required: false, label: 'BUTTON',   target: { kind: 'carrier', field: 'approachButton' } },
  'C12': { required: false, label: 'LOW ST',   target: { kind: 'carrier', field: 'lowStateLb' } },
  'C13': { required: false, label: 'BINGO',    target: { kind: 'carrier', field: 'bingoField' } },
  'C14': { required: false, label: 'BNG FUEL', target: { kind: 'carrier', field: 'bingoFuelLb' } },
  'C15': { required: false, label: 'EEAT',     target: { kind: 'carrier', field: 'eeatUtc' } },
  'C24': { required: false, label: 'NOTE',     target: { kind: 'annotation' } },
  ..._CARRIER_CHROME,
};

const FINAL_BLOCK_MAP = {
  'C1':  { required: true,  label: 'CALLSIGN', target: { kind: 'carrier-derived', field: 'callsign' } },
  'C2':  { required: true,  label: 'TYPE',     target: { kind: 'carrier-derived', field: 'aircraftType' } },
  'C9':  { required: false, label: 'FNL BRG',  target: { kind: 'carrier-derived', field: 'expectedFinalBearing' } },
  'C16': { required: false, label: 'DECK',     target: { kind: 'carrier-derived', field: 'deck' } },
  'C17': { required: false, label: 'DIST',     target: { kind: 'carrier-derived', field: 'finalDistance' } },
  '2':  _CARRIER_CHROME['2'], '4': _CARRIER_CHROME['4'], '4A': _CARRIER_CHROME['4A'],
  '25': _CARRIER_CHROME['25'], '26': _CARRIER_CHROME['26'],
};

const PATTERN_BLOCK_MAP = {
  'C1':  { required: true,  label: 'CALLSIGN', target: { kind: 'fdr', path: 'identity.callsign' } },
  'C2':  { required: true,  label: 'TYPE',     target: { kind: 'fdr', path: 'identity.aircraftType' } },
  'C24': { required: false, label: 'NOTE',     target: { kind: 'annotation' } },
  ..._CARRIER_CHROME,
};

const BLOCK_MAPS = {
  DEPARTURE: DEPARTURE_BLOCK_MAP, ARRIVAL: ARRIVAL_BLOCK_MAP, OVERFLIGHT: OVERFLIGHT_BLOCK_MAP, MISSION: MISSION_BLOCK_MAP,
  MARSHAL: MARSHAL_BLOCK_MAP, FINAL: FINAL_BLOCK_MAP, PATTERN: PATTERN_BLOCK_MAP,
};

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

/**
 * The history cell behind a Block: the Strip's own annotation, or — for the
 * assigned altitude and heading (docs/adr/0058) — the FLIGHT's clearance cell,
 * which every Facility's copy of the flight shares. Same shape either way.
 */
function _historyCellFor(strip, blockId) {
  if (!strip) return null;
  const map = BLOCK_MAPS[strip.role || 'DEPARTURE'];
  const def = map && map[blockId];
  if (def && def.target.kind === 'clearance') {
    const fdr = typeof getEfspFdr === 'function' ? getEfspFdr(strip.fdrId) : null;
    return (fdr && fdr.clearance && fdr.clearance[def.target.field]) || null;
  }
  return (strip.annotations && strip.annotations[blockId]) || null;
}

/** The currently-ACTIVE entry's value for an annotation (or clearance) Block, or null if none has ever been set. */
function activeAnnotationValue(strip, blockId) {
  const cell = _historyCellFor(strip, blockId);
  if (!cell) return null;
  const active = cell.entries.find(e => e.status === 'ACTIVE');
  return active ? active.value : null;
}

/** True when this annotation Block currently has an ACTIVE entry — i.e. there's something a confirmVacated action (§3.7 rule 3) could actually strike. Checked by status directly rather than truthiness of activeAnnotationValue(), since an active value could itself be falsy-looking (e.g. "0"). */
function hasActiveAnnotationEntry(strip, blockId) {
  const cell = _historyCellFor(strip, blockId);
  return !!(cell && cell.entries.some(e => e.status === 'ACTIVE'));
}

/**
 * Every entry in an annotation Block, in the order they were written.
 *
 * The missing half of §3.7. `activeAnnotationValue` above collapses a cell to
 * its one ACTIVE entry, and until now that was the ONLY thing that ever
 * reached the DOM — so a superseded value was kept faithfully by the server,
 * persisted, broadcast, and then thrown away by the renderer. §3.7 rule 2:
 *
 *   "A superseded value MUST remain visible in the same Block, rendered
 *    struck through, until the Strip is DROPPED."
 *
 * Returns the raw entries (`{value, status, at, by}`), including the ACTIVE
 * one, so a caller can render the whole chain or slice the prior ones off the
 * front. `[]` for a Block that has never been written, and for a Block that is
 * not annotation-routed at all — those have no history by construction, and
 * returning `[]` rather than null means no caller needs a null check to ask.
 *
 * Pure and DOM-free, like its two neighbours, so the ordering and status rules
 * are testable without rendering anything.
 */
function annotationHistory(strip, blockId) {
  const cell = _historyCellFor(strip, blockId);
  if (!cell || !Array.isArray(cell.entries)) return [];
  return cell.entries;
}

/** The entries a Block shows ABOVE its current value — everything that is no longer ACTIVE, oldest first. */
function supersededAnnotationEntries(strip, blockId) {
  return annotationHistory(strip, blockId).filter(e => e.status !== 'ACTIVE');
}

// Annotation Blocks eligible for the confirmVacated action (guide §3.7 rule
// 3 — "a vacated altitude MUST NOT be struck automatically on assignment...
// implement as an explicit confirmVacated action"). Kept next to the Block
// Map it describes, not as a magic list in bay-view.js's DOM code, and
// role-keyed since eligibility is per-role: DEPARTURE's Block 21 ("Initial
// altitude") vs ARRIVAL's Block 7 (assigned/cleared altitude — the field
// that actually gets a sequence of clearances on a descending arrival).
// Every Role's assigned altitude now (docs/adr/0058) — OVERFLIGHT's 7A was
// missing, so an overflight's altitude had no ⌿ at all.
const CONFIRM_VACATED_ELIGIBLE_BLOCKS = { DEPARTURE: ['21'], ARRIVAL: ['7'], OVERFLIGHT: ['7A'] };

// [SOURCE-DEFINED] composite format for Block 3, per the guide's own
// example template (§6.5): count (if formation), wake category, type,
// equipment suffix — degradation (§3.3) overrides the rendered suffix
// independently of the derived equipmentSuffix, never touching it.
function formatBlock3(fdr) {
  if (!fdr) return '';
  const id = fdr.identity;
  const count = id.flightSize > 1 ? String(id.flightSize) : '';
  const suffix = id.degradation === 'TRANSPONDER_FAILED' ? '/H'
    : id.degradation === 'MODE_C_FAILED' ? '/O'
    : id.equipmentSuffix ? '/' + id.equipmentSuffix : '';
  return `${count}${id.wakeCategory || ''}/${id.aircraftType || ''}${suffix}`;
}

/**
 * Resolves one Block's display value + provenance for a Strip/FDR pair.
 * Role-aware via strip.role (defaulting to DEPARTURE when strip is null —
 * e.g. an unrendered/placeholder cell) rather than a separate parameter,
 * since every real caller already has the Strip in hand.
 * NLA (Block 26) resolves to null here — the button's label/inhibit state
 * comes from efsp-nla.js against the current strip.state, not from a
 * stored value.
 * @returns {{value:*, provenance:string}}
 */
function resolveBlockValue(blockId, fdr, strip) {
  const map = BLOCK_MAPS[(strip && strip.role) || 'DEPARTURE'] || DEPARTURE_BLOCK_MAP;
  const def = map[blockId];
  if (!def) return { value: null, provenance: 'SYSTEM_DERIVED' };
  const t = def.target;

  if (t.kind === 'fdr') {
    // §10.5 (docs/adr/0073): P-time, TAXI and TAKEOFF on a DEPARTURE Strip
    // show the first source in their chain that has a value, computed here and
    // never written back. `timeSource` says which; `estimated` marks another
    // source's time standing in for an actual that has not happened yet.
    const chain = ((strip && strip.role) || 'DEPARTURE') === 'DEPARTURE' && typeof timeChainForBlock === 'function'
      ? timeChainForBlock(blockId) : null;
    if (chain) {
      const r = resolveTimeChain(chain, fdr);
      const stored = (fdr && fdr.provenance && fdr.provenance[t.path]) || 'CONTROLLER_ENTERED';
      return {
        value: formatZuluHhmm(r.valueUtc) || null,
        provenance: r.source === 'CONTROLLER' ? stored : 'COMPUTER_GENERATED',
        timeSource: r.source,
        estimated: r.estimated,
      };
    }
    let value = fdr ? getPath(fdr, t.path) : null;
    if (ZULU_HHMM_BLOCKS.has(blockId)) value = formatZuluHhmm(value) || null; // epoch ms → '1432'
    const provenance = (fdr && fdr.provenance && fdr.provenance[t.path]) || def.provenance || 'CONTROLLER_ENTERED';
    return { value: value ?? null, provenance };
  }
  if (t.kind === 'annotation') {
    return { value: activeAnnotationValue(strip, blockId), provenance: 'CONTROLLER_ENTERED' };
  }
  if (t.kind === 'clearance') {
    const cell = fdr && fdr.clearance && fdr.clearance[t.field];
    const active = cell && cell.entries.find(e => e.status === 'ACTIVE');
    return { value: active ? active.value : null, provenance: 'CONTROLLER_ENTERED' };
  }
  if (t.kind === 'system') {
    return { value: strip ? strip[t.field] : null, provenance: 'SYSTEM_DERIVED' };
  }
  if (t.kind === 'flag') {
    return { value: strip ? strip.flags[t.flag] : null, provenance: 'SYSTEM_DERIVED' };
  }
  if (t.kind === 'composite') {
    return { value: formatBlock3(fdr), provenance: 'COMPUTER_GENERATED' };
  }
  if (t.kind === 'nla') {
    return { value: null, provenance: 'SYSTEM_DERIVED' };
  }
  // WP4A gap-closure (docs/adr/0022) — was previously falling through to
  // the null/SYSTEM_DERIVED catch-all below, meaning Block 24A never
  // actually displayed fdr.airspace.owner even before it had an edit path.
  // Reads straight off the FDR, same shape as the 'fdr' branch above — kept
  // separate since airspace ownership lives in fdr.airspace, not
  // fdr.identity/fdr.filed/fdr.assigned like every generic 'fdr' path.
  if (t.kind === 'airspace-owner') {
    return { value: (fdr && fdr.airspace) ? fdr.airspace.owner : null, provenance: (fdr && fdr.provenance && fdr.provenance['airspace.owner']) || 'CONTROLLER_ENTERED' };
  }
  // WP4A second slice, §4.6.3 — the three-field separation model. Same
  // dedicated-kind reasoning as 'airspace-owner' above; `field` picks which
  // of the 3 keys on fdr.tofi this particular Block renders.
  if (t.kind === 'tofi') {
    return { value: (fdr && fdr.tofi) ? fdr.tofi[t.field] : null, provenance: (fdr && fdr.provenance && fdr.provenance.tofi) || 'CONTROLLER_ENTERED' };
  }
  // WP6 (crc-sync's docs/adr/0052), guide §6.4 — the military extension
  // namespace, read exactly like 'tofi' above. The `fdr.military &&` guard is
  // not defensive padding: this field was the literal `null` of a WP6 hook
  // until 0052, and an FDR restored from a snapshot written before then can
  // still arrive that way if it reaches a client before the server has
  // reseeded it.
  if (t.kind === 'military') {
    return { value: (fdr && fdr.military) ? fdr.military[t.field] : null, provenance: (fdr && fdr.provenance && fdr.provenance.military) || 'CONTROLLER_ENTERED' };
  }
  // The RANGE slice — Block 22, the frequency this flight has been approved
  // onto. Lives in fdr.comms for the same reason airspace ownership lives in
  // fdr.airspace: a dedicated setter, not a generic writable path.
  // crc-sync docs/adr/0074 — a flight's own carrier fields, off the FDR.
  if (t.kind === 'carrier') {
    const raw = fdr && fdr.military && fdr.military.carrier ? fdr.military.carrier[t.field] : null;
    const value = t.field === 'eeatUtc' && raw != null ? formatZuluHhmm(raw) : raw;
    return { value: value ?? null, provenance: (fdr && fdr.provenance && fdr.provenance.military) || 'CONTROLLER_ENTERED' };
  }
  // ...and the values the server DERIVES (angels, DME, push time, the bearings,
  // the Case). Formatted by carrier-state.js from what the server sent; nothing
  // is computed here, and nothing here is editable.
  if (t.kind === 'carrier-derived') {
    let text = '';
    if (t.field === 'finalDistance') text = typeof carrierFinalDistanceText === 'function' ? carrierFinalDistanceText(strip) : '';
    else if (t.field === 'callsign') text = fdr && fdr.identity ? (fdr.identity.callsign || '') : '';
    else if (t.field === 'aircraftType') text = fdr && fdr.identity ? (fdr.identity.aircraftType || '') : '';
    else if (typeof carrierDerivedText === 'function') {
      const c = typeof getEfspCarrier === 'function' ? getEfspCarrier() : null;
      text = carrierDerivedText(t.field, strip ? strip.fdrId : null, c ? c.shipState : null);
    }
    return { value: text === '' ? null : text, provenance: 'SYSTEM_DERIVED' };
  }
  if (t.kind === 'frequency') {
    const mhz = (fdr && fdr.comms) ? fdr.comms.workingFrequencyMhz : null;
    return {
      value: mhz == null ? null : mhz.toFixed(3),
      provenance: (fdr && fdr.provenance && fdr.provenance['comms.workingFrequencyMhz']) || 'CONTROLLER_ENTERED',
    };
  }
  return { value: null, provenance: 'SYSTEM_DERIVED' };
}

// Blocks edited via a dedicated <select> (bay-view.js) rather than the
// generic free-text click-to-edit path — restricted-enum fields where free
// text would let a controller enter something invalid. Keyed by blockId,
// not target.kind: '24A' needs a structurally distinct target kind
// server-side (the D15 "no boolean path" defect), but '5A' is plain
// 'fdr'-routed (fdr-store.js's setField already validates it) — both still
// deserve the same picker UX, not free text, so this is a client-only
// rendering decision independent of how the server routes the write.
// Distinct from isBlockEditable() below: these ARE editable, just not
// through THAT path.
// WP4A second slice — RSVC/SREG (radar_service/separation_regime) join the
// same enum-<select> convention. IFR is deliberately absent here — it's a
// boolean, not a restricted-value enum, and gets its own click-to-toggle
// affordance in bay-view.js reusing the existing ✓/blank boolean-render
// convention instead of a 2-option <select>.
const ENUM_SELECT_BLOCKS = {
  '5A': ['NONE', 'CST', 'FAIL', 'IF', 'NT', 'TRK'],
  // §3.8's release states. fdr-store.js validates the value; this is the
  // picker so a controller never types one of six exact strings by hand.
  '14A': ['RELEASED', 'HOLD_FOR_RELEASE', 'RELEASE_TIME', 'CLEARANCE_VOID_TIME', 'EDCT', 'CALL_FOR_RELEASE'],
  '24A': ['CONTROLLING_AGENCY', 'USING_AGENCY'],
  'RSVC': ['ACTIVE', 'TERMINATED'],
  'SREG': ['ATC', 'MARSA', 'USING_AGENCY', 'DUE_REGARD', 'SEE_AND_AVOID'],
  // WP6 §9.5 (guide M14) — ordnance state. fdr-store.js's ORDNANCE_STATES is
  // the authority; this is the picker. A static literal is right here, unlike
  // Block 9F's route table, because these four values are the guide's own and
  // are not runtime config.
  '3G': ['CLEAN', 'LOADED', 'HUNG', 'EXPENDED'],
  // WP6 §9.6 (guide M16) — alert status, the guide's own three values;
  // fdr-store.js's ALERT_STATUSES is the authority. 'NONE' is its cleared
  // value and is in the list, as 3G's 'CLEAN' is (crc-sync docs/adr/0070).
  '14E': ['NONE', 'ALERT', 'SCRAMBLE'],
  'C4': ['TACAN', 'ICLS', 'ACLS', 'PAR', 'VISUAL'], // crc-sync carrier/flight-record.js APPROACH_TYPES
};

// Block 9F's options come from the stereo route table, which is runtime
// config (docs/adr/0073): efsp-stereo-routes.js caches the last list crc-sync
// returned. Guarded because the node tests load this module on its own.
function _stereoRouteOptions() {
  const routes = typeof cachedStereoRoutesClient === 'function' ? cachedStereoRoutesClient() : [];
  return Array.isArray(routes) ? routes.filter(r => r && r.name && r.active !== false) : [];
}

/**
 * @param {string} blockId
 * @param {object} [fdr] — the flight, for Block 9F only: a route the squadron
 *   has since retired stays on the flight flying it (ADR 0050: deactivation is
 *   not retroactive), so the flight's current name is offered even when the
 *   table no longer lists it.
 * @returns {string[]|null} the option values for this Block if it's an
 *   enum-select Block, else null. 9F is null when there is nothing to offer —
 *   no routes cached and no stereo on the flight — so bay-view.js renders a
 *   plain cell rather than a picker that can only fail.
 */
function enumSelectOptionsFor(blockId, fdr) {
  if (blockId === '9F') {
    const names = _stereoRouteOptions().map(r => r.name);
    const current = fdr && fdr.filed ? fdr.filed.stereoRouteName : null;
    if (current && !names.includes(current)) names.push(current);
    return names.length ? names : null;
  }
  return ENUM_SELECT_BLOCKS[blockId] || null;
}

// Which enum Blocks may offer the picker's "—" once they have a value (lane
// 2's F-206: "—" was offered on all six and did nothing on any of them,
// because bay-view.js's change handler returned early on an empty value — an
// enabled choice that cannot be acted on, which is standing rule 1).
//
// This is the SERVER's answer to "which of the six accept a clear", not a
// guess from reading the validators:
//   RSVC / SREG  -> both start as null and null is a real, renderable state,
//                   so clearing one is a meaningful action. fdr-store.js's
//                   setTofi() normalizes the '' a <select> sends to null, so
//                   "—" sends '' and there is one spelling of "cleared"
//                   server-side.
//   5A           -> 'NONE' IS this field's cleared value; offer that.
//   3G           -> 'CLEAN' IS this field's cleared value; offer that.
//   14A          -> §3.8's six release states are exhaustive. There is no
//                   "no release state".
//   24A          -> airspace ownership is a DIRECTION, and its record is
//                   append-only precisely so a handover cannot be erased.
//                   "Give it back" is CONTROLLING_AGENCY, not blank.
//   9F           -> fdr-store.js's setField('filed.stereoRouteName', '')
//                   clears the LABEL and keeps the route (docs/adr/0050), so
//                   "cancel the stereo" is meaningful and the route a flight
//                   is taxiing on never goes blank (docs/adr/0073).
// Clearing SREG is still refused while an ACTIVE MARSA relation holds the
// flight (board-store.js names the declarer in the refusal). That is correct
// and deliberately NOT pre-empted here: the refusal is legible and lands
// attributed to the Strip.
const ENUM_CLEARABLE_BLOCKS = new Set(['RSVC', 'SREG', '9F', 'C4']);

/** @returns {boolean} may this enum Block be cleared back to no value at all? */
function isEnumBlockClearable(blockId) {
  return ENUM_CLEARABLE_BLOCKS.has(blockId);
}

// WP4A second slice — Blocks edited via a click-to-toggle boolean
// affordance (bay-view.js), reusing the existing ✓/blank rendering
// convention rather than a 2-option <select> — the counterpart to
// ENUM_SELECT_BLOCKS for a restricted-VALUE-SET field that happens to have
// exactly two values already spelled `true`/`false`, not a string enum.
// WP6 §9.7 (guide M15) — 3F, the arresting-gear/hook requirement, joins IFR
// here for the same reason: a restricted value set that already has exactly
// two values spelled true/false, so a 2-option <select> would be worse than
// the ✓/blank toggle. The LABEL is what carries the D15 distinction the
// server's dedicated setter enforces — it reads HOOK, and a ✓ means this
// aircraft REQUIRES arresting gear, not merely that it has a tailhook.
const BOOLEAN_TOGGLE_BLOCKS = new Set(['IFR', '3F']);

/** @returns {boolean} whether this Block is edited via a click-to-toggle boolean affordance rather than free text or an enum <select>. */
function isBooleanToggleBlock(blockId) {
  return BOOLEAN_TOGGLE_BLOCKS.has(blockId);
}

/** @returns {string|null} this Block's display label for the given role, or null if the Block doesn't exist for that role. */
function blockLabelFor(blockId, role = 'DEPARTURE') {
  const map = BLOCK_MAPS[role] || DEPARTURE_BLOCK_MAP;
  const def = map[blockId];
  return def ? def.label || null : null;
}

function requiredBlocksFor(role = 'DEPARTURE') {
  const map = BLOCK_MAPS[role];
  if (!map) return [];
  return Object.entries(map).filter(([, def]) => def.required).map(([id]) => id);
}

/**
 * A Block is directly editable via click-to-edit (guide §3.7/§7.4 — Enter
 * commits, Esc reverts, no auto-commit on blur) when it's fdr- or
 * annotation-routed. System/composite/flag/nla Blocks (2, 3, 4, 4A, 25, 26)
 * are managed by their own dedicated mechanisms (board-store-derived,
 * gesture toggles, the NLA button) and are never free-text editable here.
 */
function isBlockEditable(blockId, role = 'DEPARTURE') {
  const map = BLOCK_MAPS[role];
  const def = map && map[blockId];
  // 9F is a picker (docs/adr/0073) and editable only while there is a route
  // table to pick from; with none it must not fall through to free text
  // (bay-view.js tries the picker first, then this).
  if (blockId === '9F') return !!def && _stereoRouteOptions().length > 0;
  // 'frequency' joins the editable kinds: unlike airspace-owner/tofi, which
  // are restricted enums with their own <select>, a frequency is a free
  // numeric entry — the ordinary click-to-edit path is right for it. The
  // server validates the band.
  return !!def && (def.target.kind === 'fdr' || def.target.kind === 'annotation' || def.target.kind === 'frequency' || def.target.kind === 'clearance' || def.target.kind === 'carrier');
}

// ── Zulu time-of-day Blocks (crc-sync's docs/adr/0062) ──────────────────────
//
// Blocks whose FDR value is epoch ms (dated by crc-sync against the MISSION
// clock, never the wall clock — H11) and which a controller reads and types
// as a four-digit Zulu time. resolveBlockValue shows them as '1432', so the
// click-to-edit cell opens on '1432' and sends back what the controller typed;
// crc-sync's zulu-time.js resolves it to the instant again. The MTR times
// (docs/adr/0062) and, since supervisor fix F4, every typed …TimeUtc Block:
// 6 (PROP DEP on a DEPARTURE, ETA on an ARRIVAL), 14 and 14B-D (the release
// times) and 16-18; and since docs/adr/0073 the vul window, M6/M7 (S-F4).
// Block ids, not paths: each id means one time on every role map that has it.
// A test derives this set from the Block Maps, so a time Block added later
// without it fails.
const ZULU_HHMM_BLOCKS = new Set([
  '6', '9G-TIME', '9H-TIME', '14', '14B', '14C', '14D', '16', '17', '18', 'M6', 'M7',
]);

/** Epoch ms as the four-digit Zulu time a Strip shows ('1432'), or '' for no time. Mirrors crc-sync's zulu-time.js. */
function formatZuluHhmm(ms) {
  if (ms == null || ms === '' || !Number.isFinite(Number(ms))) return '';
  const d = new Date(Number(ms));
  return String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0');
}

// A hover title for a field's label, where the label alone does not say
// enough. Only the MTR fields today (docs/adr/0062). EXIT ALT carries §9.4's
// lost-comms rule (strip-fields.js's mtrLostCommsAdvisory) because it is the
// field a controller is looking at when the question comes up.
const BLOCK_TITLES = {
  '9G-MTR': 'MTR designator (guide M10)',
  '9G-ENTRY': 'MTR entry fix',
  '9G-TIME': 'MTR entry time, UTC HHMM',
  '9H-EXIT': 'MTR exit fix (guide §9.4)',
  '9H-TIME': 'MTR exit estimate, UTC HHMM',
  '9H-ALT': 'requested altitude after exit',
};

// ── §10.5's source on hover (docs/adr/0073) ─────────────────────────────────
//
// What each chain source means, in the words a controller reads. An estimate
// names the chain it borrowed from and that chain's own source.
const TIME_SOURCE_TEXT = {
  CONTROLLER: 'entered by a controller',
  FLIGHT_PLAN: 'from the filed DD-1801 (item 13, EOBT)',
  ATO: 'from the ATO (AMSNDAT departure time)',
  EST_DEPARTURE: 'estimate: P-time',
  EST_OFF_BLOCK: 'estimate: off-block',
};
const TIME_CHAIN_NAMES = { departure: 'Proposed departure (P-time)', offBlock: 'Off-block (taxi) time', takeoff: 'Takeoff time' };

function _timeSourceSentence(source, via) {
  const text = TIME_SOURCE_TEXT[source] || source;
  return via ? `${text}, ${TIME_SOURCE_TEXT[via] || via}` : text;
}

/**
 * The hover text for Block 6/17/18 on a DEPARTURE Strip: the Block's name, the
 * value and where it came from, and what would apply if it were cleared.
 * Null for any other Block or Role.
 */
function timeChainTitleFor(blockId, fdr, strip) {
  if (((strip && strip.role) || 'DEPARTURE') !== 'DEPARTURE') return null;
  const chain = typeof timeChainForBlock === 'function' ? timeChainForBlock(blockId) : null;
  if (!chain) return null;
  const r = resolveTimeChain(chain, fdr);
  const lines = [TIME_CHAIN_NAMES[chain]];
  if (r.source) {
    lines.push(`${r.estimated ? '~' : ''}${formatZuluHhmm(r.valueUtc)}Z ${_timeSourceSentence(r.source, r.via)}`);
  } else {
    lines.push('no time from any source');
  }
  // What a controller clearing their entry would get back — only meaningful
  // when a controller's entry is what is shown.
  if (r.source === 'CONTROLLER') {
    const next = r.candidates.find(c => c.source !== 'CONTROLLER' && c.valueUtc != null);
    lines.push(next
      ? `if cleared: ${_timeSourceSentence(next.source, next.via)}, ${formatZuluHhmm(next.valueUtc)}Z`
      : 'if cleared: no other source');
  }
  return lines.join('\n');
}

/**
 * What the VALUE cell of a Block adds to itself (bay-view.js's _buildBlockCell):
 * a hover title and whether to set it in italics as an estimate. Null when
 * the cell needs nothing. Block 9F with no route table says why it is not a
 * picker, since there is nothing to pick.
 */
function blockValueHintFor(blockId, fdr, strip) {
  if (blockId === '9F' && enumSelectOptionsFor('9F', fdr) == null) {
    return { title: 'no stereo routes configured', estimated: false };
  }
  const title = timeChainTitleFor(blockId, fdr, strip);
  if (!title) return null;
  return { title, estimated: !!resolveBlockValue(blockId, fdr, strip).estimated };
}

/**
 * The label's hover title for this Block, or null. `fdr` adds the lost-comms
 * rule to EXIT ALT; with `strip`, Blocks 6/17/18 on a DEPARTURE carry §10.5's
 * source (docs/adr/0073). Without the Strip (the collapsed face's label, which
 * strip-view.js titles with the FDR alone) the chain title is left off: the
 * same id is the ETA on an ARRIVAL, and the value cell carries it anyway.
 */
function blockTitleFor(blockId, fdr, strip) {
  if (strip) {
    const chainTitle = timeChainTitleFor(blockId, fdr, strip);
    if (chainTitle) return chainTitle;
  }
  const base = BLOCK_TITLES[blockId] || null;
  if (blockId !== '9H-ALT' || typeof mtrLostCommsAdvisory !== 'function') return base;
  const advisory = mtrLostCommsAdvisory(fdr);
  return advisory ? `${base}.\n${advisory}` : base;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEPARTURE_BLOCK_MAP, ARRIVAL_BLOCK_MAP, OVERFLIGHT_BLOCK_MAP, MISSION_BLOCK_MAP, MARSHAL_BLOCK_MAP, FINAL_BLOCK_MAP, PATTERN_BLOCK_MAP, BLOCK_MAPS, resolveBlockValue, requiredBlocksFor, formatBlock3,
    activeAnnotationValue, hasActiveAnnotationEntry, annotationHistory, supersededAnnotationEntries,
    isBlockEditable, CONFIRM_VACATED_ELIGIBLE_BLOCKS,
    enumSelectOptionsFor, ENUM_CLEARABLE_BLOCKS, isEnumBlockClearable, isBooleanToggleBlock, blockLabelFor,
    ZULU_HHMM_BLOCKS, formatZuluHhmm, BLOCK_TITLES, blockTitleFor,
    TIME_SOURCE_TEXT, timeChainTitleFor, blockValueHintFor,
  };
}
