'use strict';
import { getEfspFlightData } from './efsp-state.js';
import { resolveTimeChain, timeChainForBlock } from './time-chains.js';
import { carrierDerivedText, getEfspCarrier } from './carrier-state.js';
import { mtrLostCommsAdvisory } from './mtr-advisory.js';
import { carrierFinalDistanceText } from './carrier-final-distance.js';
import { formatZuluHhmm } from '../../format.js';
import { cachedStereoRoutesClient } from './efsp-stereo-routes.js';

// The Departure Block Map as data (EFSPImplementationGuide.md §6.2, §6.5)
// — client-side copy. Deliberately a literal duplicate of crc-sync's
// src/efsp/block-map.js, NOT an import: crc-sync and crc-desktop are
// separately deployed packages with separate build contexts (same reason
// src/auth.js is duplicated across crc-sync/sourcedcs-web/atobrief). Kept
// in sync by each side's own test suite asserting the same binding table
// shape (see docs/adr/0001-json-wire-format-not-protobuf.md's consequence
// note on schema drift) — not a compiled contract.
//
// resolveBlockValue() is kept PURE and separate from DOM writing
// (bay-view.js and bay/strip-element.js do the actual rendering) so it's
// testable without a DOM — same discipline as los.js's math functions.

// docs/adr/0024 — `label` added to every entry (guide §2's own Block Map
// definition names it as one of the fields a Block Map maps to; it was the
// one field never actually added). Client-only — block-map.js (server) is
// never used for display, only validation/permission/routing, matching the
// same asymmetry efsp-block-map-parity.test.mjs already documents for
// `field`/`flag`. Kept to 8 characters or fewer so the compact view never
// has to grow wider to fit one, and UNIQUE within a strip type — a label is the
// only thing telling two Blocks apart, and the expanded view renders the long
// tail where four Blocks once all read NOTE and three all read RESTR. Take the
// wording from the guide's own §6.2/§6.3 field column rather than inventing
// one; several of those seven were wrong, not just ambiguous.
// efsp-strip-template.test.mjs holds both rules.
export const DEPARTURE_BLOCK_MAP = {
  '1':  { required: true,  label: 'ACID',     target: { kind: 'flightData', path: 'identity.callsign' } }, // H134 LT-RQ3 a
  '2':  { required: true,  label: 'REV',      target: { kind: 'system', field: 'rev' } },
  '2A': { required: false, label: 'VOICE',     target: { kind: 'annotation' } },
  '3':  { required: true,  label: 'TYPE',     target: { kind: 'aircraft-data' } }, // T7: typed as one field, [count/]TYPE[/WAKE]
  // docs/adr/0023 gap-closure — see crc-sync's block-map.js's '3A' comment
  // for the full rationale. Plain 'flightData'-routed, like '5A'.
  '3A': { required: false, label: 'ACFT',     target: { kind: 'flightData', path: 'identity.aircraftType' } },
  '3B': { required: false, label: 'WAKE',     target: { kind: 'flightData', path: 'identity.wakeCategory' } },
  '3C': { required: false, label: 'TAIL',     target: { kind: 'flightData', path: 'identity.tailNumber' } },
  '3D': { required: false, label: 'UNIT',     target: { kind: 'flightData', path: 'identity.unit' } },
  '3E': { required: false, label: 'HOME',     target: { kind: 'flightData', path: 'identity.homeStation' } },
  // WP6 (crc-sync's docs/adr/0052) — guide §6.4's military extension
  // namespace. Mirrors crc-sync's block-map.js; see its MILITARY_BLOCK_NAMESPACE
  // table for the whole guide-M-number-to-Block-id mapping and why the
  // M-prefix is not reused. Both hang off Block 3 because the 3-family is the
  // airframe, and both are on all three ATC strip types.
  //
  // 3F is a click-to-toggle boolean (BOOLEAN_TOGGLE_BLOCKS below) and 3G an
  // enum <select> (ENUM_SELECT_BLOCKS) — never the generic free-text path,
  // same as IFR and SREG.
  '3F': { required: false, label: 'HOOK',     target: { kind: 'military', field: 'hookRequired' } },  // guide M15, §9.7
  '3G': { required: false, label: 'ORDNANCE', target: { kind: 'military', field: 'ordnanceState' } }, // guide M14, §9.5
  '4':  { required: true,  label: 'CID',      target: { kind: 'system', field: 'cid' } },
  '4A': { required: false, label: 'RMV',      target: { kind: 'flag', flag: 'removeIndicator' } },
  '4B': { required: true,  label: 'DATALINK', target: { kind: 'flightData', path: 'assigned.datalinkClearanceIndicator' } },
  '5':  { required: true,  label: 'BEACON',   target: { kind: 'flightData', path: 'identity.beaconAssigned' } },
  // WP4A gap-closure — track-degradation flag. Mirrors crc-sync's
  // block-map.js's '5A' exactly (plain 'flightData'-routed — see that module's
  // comment for why this one needs no dedicated target kind, unlike 24A).
  '5A': { required: false, label: 'DEGR',     target: { kind: 'flightData', path: 'identity.trackDegradationFlag' } },
  '6':  { required: true,  label: 'PROP DEP', target: { kind: 'flightData', path: 'filed.proposedDepartureTimeUtc' } },
  '7':  { required: true,  label: 'CRUS ALT', target: { kind: 'flightData', path: 'filed.requestedAltitude' } }, // what was filed; the assigned altitude is the clearance (docs/adr/0058)
  '8':  { required: true,  label: 'DEP',      target: { kind: 'flightData', path: 'filed.departureAirport' } },
  '8A': { required: true,  label: 'RWY',      target: { kind: 'flightData', path: 'filed.departureRunway' } },
  '8B': { required: true,  label: 'DEST',     target: { kind: 'flightData', path: 'filed.destinationAirport' } },
  '9':  { required: true,  label: 'RTE',      target: { kind: 'flightData', path: 'filed.route' }, provenance: 'COMPUTER_GENERATED' },
  '9A': { required: false, label: 'FAC A',    target: { kind: 'annotation' } },
  '9B': { required: false, label: 'FAC B',    target: { kind: 'annotation' } },
  '9C': { required: false, label: 'FAC C',    target: { kind: 'annotation' } },
  '9D': { required: true,  label: 'FULL RTE', target: { kind: 'flightData', path: 'filed.fullRouteClearance' } },
  '9E': { required: true,  label: 'RMKS',     target: { kind: 'flightData', path: 'filed.remarks' } },
  // crc-sync docs/adr/0126: LC's pattern cells (mirrors block-map.js's 9J comment).
  '9J-ENTRY':  { required: false, label: 'P/S',      target: { kind: 'flightData', path: 'assigned.patternEntry' } },
  '9J-OPTION': { required: false, label: 'OPT',      target: { kind: 'flightData', path: 'assigned.patternOption' } },
  // crc-sync docs/adr/0143: a VFR departure's direction of flight (mirrors block-map.js's 9K comment).
  '9K':  { required: false, label: 'DIR',      target: { kind: 'flightData', path: 'filed.directionOfFlight' } },
  // §9.10 stereo route name (docs/adr/0050) — mirrors crc-sync's
  // block-map.js '9F' exactly; see that module's comment for why it is not
  // numbered M18 and why writing it re-files the flight rather than just
  // relabelling it. A picker of the configured routes, never free text
  // (docs/adr/0073): 0050 left it free text because ENUM_SELECT_BLOCKS is a
  // static literal and the route table is runtime config. The runtime option
  // source is efsp-stereo-routes.js's cache of the last fetched list, read by
  // enumSelectOptionsFor(blockId, flightData) below. The server still resolves every
  // name and refuses one it does not have (a stale list).
  '9F': { required: false, label: 'STEREO',   target: { kind: 'flightData', path: 'filed.stereoRouteName' } },
  // §9.4 MTR fields (crc-sync's docs/adr/0062): 9G-* is the guide's M10, 9H-*
  // its M11. Plain flightData, no interlock (9H-ALT is the pilot's request, not a
  // clearance). The two times display as HHMM (ZULU_HHMM_BLOCKS below).
  '9G-MTR':   { required: false, label: 'MTR',      target: { kind: 'flightData', path: 'military.mtr.designator' } },
  '9G-ENTRY': { required: false, label: 'ENTRY',    target: { kind: 'flightData', path: 'military.mtr.entryFix' } },
  '9G-TIME':  { required: false, label: 'ENTRY TM', target: { kind: 'flightData', path: 'military.mtr.entryTimeUtc' } },
  '9H-EXIT':  { required: false, label: 'EXIT',     target: { kind: 'flightData', path: 'military.mtr.exitFix' } },
  '9H-TIME':  { required: false, label: 'EXIT EST', target: { kind: 'flightData', path: 'military.mtr.exitEstimateUtc' } },
  '9H-ALT':   { required: false, label: 'EXIT ALT', target: { kind: 'flightData', path: 'military.mtr.requestedAltitudeAfterExit' } },
  '10': { required: true,  label: 'ATIS',     target: { kind: 'flightData', path: 'assigned.atisCode' } },
  '11': { required: true,  label: 'APREQ',    target: { kind: 'annotation' } },
  '14': { required: true,  label: 'RLS TIME', target: { kind: 'flightData', path: 'assigned.releaseTimeUtc' } },
  // WP4A (docs/adr/0017), §4.6.2 — mirrors crc-sync's block-map.js exactly.
  // See crc-sync's block-map.js for why these two exist and why they are
  // numbered in the 14-family.
  '14A': { required: false, label: 'RELEASE', target: { kind: 'flightData', path: 'assigned.departureRelease' } },
  '14D': { required: false, label: 'VOID',      target: { kind: 'flightData', path: 'assigned.voidTimeUtc' } },
  '14B': { required: false, label: 'EDCT',    target: { kind: 'flightData', path: 'assigned.edctTimeUtc' } },
  '14C': { required: false, label: 'CFR',     target: { kind: 'flightData', path: 'assigned.callForReleaseTimeUtc' } },
  '14E': { required: false, label: 'ALERT',   target: { kind: 'military', field: 'alertStatus' } }, // WP6, guide M16 §9.6 — crc-sync docs/adr/0070
  '16': { required: false, label: 'MVMT',     target: { kind: 'flightData', path: 'assigned.movementAreaEntryTimeUtc' } },
  '17': { required: false, label: 'TAXI',     target: { kind: 'flightData', path: 'assigned.taxiTimeUtc' } },
  '18': { required: true,  label: 'TAKEOFF',  target: { kind: 'flightData', path: 'assigned.takeoffTimeUtc' } },
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
  // needs to say so per-Block. efsp-block-map-parity.test.mjs compares it now.
  // docs/adr/0058 — the flight's clearance, on the flight data and shared with every
  // Facility: CD issues ALT with the clearance, AP/CTR amend it and vector.
  '20': { required: false, label: 'HDG',      target: { kind: 'clearance', field: 'heading' }, interlock: 'COURSE' },
  '21': { required: false, label: 'ALT',      target: { kind: 'clearance', field: 'altitude' }, interlock: 'ALTITUDE' },
  '9A-SPEED': { required: false, label: 'SPEED',    target: { kind: 'clearance', field: 'speed' } }, // docs/adr/0099 §3, no interlock
  // The guide's own Block 22, "Frequency" — structured rather than a
  // free-text annotation since the RANGE slice, so approving a flight onto
  // an airspace's frequency can write it directly and it validates as one
  // unit and one type (MHz, a number).
  '22': { required: false, label: 'FREQ',     target: { kind: 'frequency' } },
  '23': { required: false, label: 'FAC RMKS',     target: { kind: 'annotation' } },
  '24': { required: true,  label: 'MIT RMKS',     target: { kind: 'annotation' } },
  // WP4A (docs/adr/0018), §4.6.4 — airspace ownership as a direction. Not
  // flightData/annotation-routed on either side (see efsp-block-map-parity.test.mjs's
  // isWritableKind) — edited via a dedicated <select> widget (bay-view.js's
  // enum-Block renderer), never the generic free-text click-to-edit path
  // (docs/adr/0022 gave this its first actual UI).
  '24A': { required: false, label: 'ARSPC',   target: { kind: 'airspace-owner' } },
  // WP4A second slice, §4.6.3 — the three-field separation model. See
  // resolveBlockValue's 'tofi' branch and _buildBlockCell's IFR toggle for
  // why IFR isn't in ENUM_SELECT_BLOCKS the way RSVC/SREG are.
  'IFR':  { required: false, label: 'KEEP IFR',     target: { kind: 'tofi', field: 'ifrActive' } },
  'RSVC': { required: false, label: 'RADAR',   target: { kind: 'tofi', field: 'radarService' } },
  'SREG': { required: false, label: 'SEP REG', target: { kind: 'tofi', field: 'separationRegime' } },
  '25': { required: true,  label: 'STATE',    target: { kind: 'system', field: 'state' } },
  '26': { required: true,  label: 'NLA',      target: { kind: 'nla' } },
};

// [SOURCE-DEFINED] Arrival Block Map (Phase 2, docs/adr/0008) — client
// mirror of crc-sync's ARRIVAL_BLOCK_MAP; see that module's header comment
// for the full design rationale (why Block 7 is annotation-routed, the
// 9A-* split, the 20/21 scratchpad simplification). Kept in sync by
// efsp-block-map-parity.test.mjs, same as DEPARTURE_BLOCK_MAP.
export const ARRIVAL_BLOCK_MAP = {
  '1':        { required: true,  label: 'ACID',     target: { kind: 'flightData', path: 'identity.callsign' } }, // H134 LT-RQ3 a
  '2':        { required: true,  label: 'REV',      target: { kind: 'system', field: 'rev' } },
  '2A':       { required: false, label: 'VOICE',     target: { kind: 'annotation' } },
  '3':        { required: true,  label: 'TYPE',     target: { kind: 'aircraft-data' } }, // T7: typed as one field, [count/]TYPE[/WAKE]
  '3A':       { required: false, label: 'ACFT',     target: { kind: 'flightData', path: 'identity.aircraftType' } }, // docs/adr/0023 gap-closure — see DEPARTURE_BLOCK_MAP's '3A' comment
  '3B':       { required: false, label: 'WAKE',     target: { kind: 'flightData', path: 'identity.wakeCategory' } },
  '3C':       { required: false, label: 'TAIL',     target: { kind: 'flightData', path: 'identity.tailNumber' } },
  '3D':       { required: false, label: 'UNIT',     target: { kind: 'flightData', path: 'identity.unit' } },
  '3E':       { required: false, label: 'HOME',     target: { kind: 'flightData', path: 'identity.homeStation' } },
  '3F':       { required: false, label: 'HOOK',     target: { kind: 'military', field: 'hookRequired' } },  // WP6, guide M15 §9.7 — see DEPARTURE_BLOCK_MAP's '3F'/'3G' comment
  '3G':       { required: false, label: 'ORDNANCE', target: { kind: 'military', field: 'ordnanceState' } }, // WP6, guide M14 §9.5
  '4':        { required: true,  label: 'CID',      target: { kind: 'system', field: 'cid' } },
  '4A':       { required: false, label: 'RMV',      target: { kind: 'flag', flag: 'removeIndicator' } },
  '4B':       { required: true,  label: 'DATALINK', target: { kind: 'flightData', path: 'assigned.datalinkClearanceIndicator' } },
  '5':        { required: true,  label: 'BEACON',   target: { kind: 'flightData', path: 'identity.beaconAssigned' } },
  '5A':       { required: false, label: 'DEGR',     target: { kind: 'flightData', path: 'identity.trackDegradationFlag' } }, // WP4A gap-closure — see DEPARTURE_BLOCK_MAP's '5A' comment
  '6':        { required: true,  label: 'ETA',      target: { kind: 'flightData', path: 'filed.estimatedArrivalTimeUtc' } },
  '7':        { required: true,  label: 'ALT',      target: { kind: 'clearance', field: 'altitude' }, interlock: 'ALTITUDE' }, // docs/adr/0058
  '8':        { required: true,  label: 'ORIG',     target: { kind: 'flightData', path: 'filed.originAirport' } },
  '8A':       { required: false, label: 'FIX',      target: { kind: 'flightData', path: 'filed.arrivalFix' } },
  '8B':       { required: true,  label: 'RWY',      target: { kind: 'flightData', path: 'assigned.landingRunway' } },
  '9':        { required: true,  label: 'RTE',      target: { kind: 'flightData', path: 'filed.route' }, provenance: 'COMPUTER_GENERATED' },
  '9A-FUEL':  { required: true,  label: 'MIN FUEL', target: { kind: 'annotation' } },
  '9A-DEST':  { required: false, label: 'DEST',     target: { kind: 'annotation' } },
  '9A-PTOUT': { required: false, label: 'PT OUT',   target: { kind: 'annotation' } },
  '9A-VECTOR':{ required: false, label: 'HDG',      target: { kind: 'clearance', field: 'heading' }, interlock: 'COURSE' }, // docs/adr/0058 — a radar vector IS the assigned heading
  '9A-SPEED': { required: false, label: 'SPEED',    target: { kind: 'clearance', field: 'speed' } }, // docs/adr/0099 §3: the speed cell, a recorded assignment (no interlock)
  // §9.4 MTR fields — see DEPARTURE_BLOCK_MAP's '9G-*' comment
  '9G-MTR':   { required: false, label: 'MTR',      target: { kind: 'flightData', path: 'military.mtr.designator' } },
  '9G-ENTRY': { required: false, label: 'ENTRY',    target: { kind: 'flightData', path: 'military.mtr.entryFix' } },
  '9G-TIME':  { required: false, label: 'ENTRY TM', target: { kind: 'flightData', path: 'military.mtr.entryTimeUtc' } },
  '9H-EXIT':  { required: false, label: 'EXIT',     target: { kind: 'flightData', path: 'military.mtr.exitFix' } },
  '9H-TIME':  { required: false, label: 'EXIT EST', target: { kind: 'flightData', path: 'military.mtr.exitEstimateUtc' } },
  '9H-ALT':   { required: false, label: 'EXIT ALT', target: { kind: 'flightData', path: 'military.mtr.requestedAltitudeAfterExit' } },
  '9E':       { required: true,  label: 'RMKS',     target: { kind: 'flightData', path: 'filed.remarks' } },
  '9J-ENTRY':  { required: false, label: 'P/S',      target: { kind: 'flightData', path: 'assigned.patternEntry' } },   // crc-sync docs/adr/0126
  '9J-OPTION': { required: false, label: 'OPT',      target: { kind: 'flightData', path: 'assigned.patternOption' } },
  '20':       { required: false, label: 'SCRATCH1',  target: { kind: 'annotation' } },
  '21':       { required: false, label: 'SCRATCH2',  target: { kind: 'annotation' } },
  '24':       { required: true,  label: 'MIT RMKS',     target: { kind: 'annotation' } },
  '24A':      { required: false, label: 'ARSPC',    target: { kind: 'airspace-owner' } }, // WP4A, §4.6.4 — see DEPARTURE_BLOCK_MAP's '24A' comment
  'IFR':      { required: false, label: 'KEEP IFR',      target: { kind: 'tofi', field: 'ifrActive' } },       // WP4A second slice, §4.6.3 — see DEPARTURE_BLOCK_MAP's comment
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
// Blocks). Kept in sync by efsp-block-map-parity.test.mjs.
export const OVERFLIGHT_BLOCK_MAP = {
  '1':  { required: true,  label: 'ACID',     target: { kind: 'flightData', path: 'identity.callsign' } }, // H134 LT-RQ3 a
  '2':  { required: true,  label: 'REV',      target: { kind: 'system', field: 'rev' } },
  '3':  { required: true,  label: 'TYPE',     target: { kind: 'aircraft-data' } }, // T7: typed as one field, [count/]TYPE[/WAKE]
  '3A': { required: false, label: 'ACFT',     target: { kind: 'flightData', path: 'identity.aircraftType' } }, // docs/adr/0023 gap-closure — see DEPARTURE_BLOCK_MAP's '3A' comment
  '3B': { required: false, label: 'WAKE',     target: { kind: 'flightData', path: 'identity.wakeCategory' } },
  '3C': { required: false, label: 'TAIL',     target: { kind: 'flightData', path: 'identity.tailNumber' } },
  '3D': { required: false, label: 'UNIT',     target: { kind: 'flightData', path: 'identity.unit' } },
  '3E': { required: false, label: 'HOME',     target: { kind: 'flightData', path: 'identity.homeStation' } },
  '3F': { required: false, label: 'HOOK',     target: { kind: 'military', field: 'hookRequired' } },  // WP6, guide M15 §9.7 — see DEPARTURE_BLOCK_MAP's '3F'/'3G' comment
  '3G': { required: false, label: 'ORDNANCE', target: { kind: 'military', field: 'ordnanceState' } }, // WP6, guide M14 §9.5
  '4':  { required: true,  label: 'CID',      target: { kind: 'system', field: 'cid' } },
  '4A': { required: false, label: 'RMV',      target: { kind: 'flag', flag: 'removeIndicator' } },
  '4B': { required: true,  label: 'DATALINK', target: { kind: 'flightData', path: 'assigned.datalinkClearanceIndicator' } },
  '5':  { required: true,  label: 'BEACON',   target: { kind: 'flightData', path: 'identity.beaconAssigned' } },
  '5A': { required: false, label: 'DEGR',     target: { kind: 'flightData', path: 'identity.trackDegradationFlag' } },
  '7':  { required: true,  label: 'CRUS ALT', target: { kind: 'flightData', path: 'filed.requestedAltitude' } }, // what was filed; the assigned altitude is the clearance (docs/adr/0058)
  // WP6 (crc-sync's docs/adr/0051) — OVERFLIGHT had no Block carrying an ATC
  // course or altitude ASSIGNMENT, only the filed request above, which left
  // §9.2's MARSA interlock unreachable on this one strip type. Annotation-routed
  // like ARRIVAL's equivalents, so a transiting flight's clearance history is
  // append-only (§3.7) and confirmVacated works. See the server's copy for the
  // [SOURCE-DEFINED] note on the numbering.
  // docs/adr/0058: both are the flight's clearance now, on the flight data.
  '7A': { required: false, label: 'ALT',      target: { kind: 'clearance', field: 'altitude' }, interlock: 'ALTITUDE' },
  '9A-VECTOR': { required: false, label: 'HDG', target: { kind: 'clearance', field: 'heading' }, interlock: 'COURSE' },
  '9A-SPEED': { required: false, label: 'SPEED', target: { kind: 'clearance', field: 'speed' } }, // docs/adr/0099 §3, no interlock
  '8':  { required: true,  label: 'ORIG',     target: { kind: 'flightData', path: 'filed.departureAirport' } },
  '8B': { required: true,  label: 'DEST',     target: { kind: 'flightData', path: 'filed.destinationAirport' } },
  '9':  { required: true,  label: 'RTE',      target: { kind: 'flightData', path: 'filed.route' }, provenance: 'COMPUTER_GENERATED' },
  // §9.4 MTR fields — see DEPARTURE_BLOCK_MAP's '9G-*' comment
  '9G-MTR':   { required: false, label: 'MTR',      target: { kind: 'flightData', path: 'military.mtr.designator' } },
  '9G-ENTRY': { required: false, label: 'ENTRY',    target: { kind: 'flightData', path: 'military.mtr.entryFix' } },
  '9G-TIME':  { required: false, label: 'ENTRY TM', target: { kind: 'flightData', path: 'military.mtr.entryTimeUtc' } },
  '9H-EXIT':  { required: false, label: 'EXIT',     target: { kind: 'flightData', path: 'military.mtr.exitFix' } },
  '9H-TIME':  { required: false, label: 'EXIT EST', target: { kind: 'flightData', path: 'military.mtr.exitEstimateUtc' } },
  '9H-ALT':   { required: false, label: 'EXIT ALT', target: { kind: 'flightData', path: 'military.mtr.requestedAltitudeAfterExit' } },
  '9E': { required: true,  label: 'RMKS',     target: { kind: 'flightData', path: 'filed.remarks' } },
  '20': { required: false, label: 'SCRATCH1',  target: { kind: 'annotation' } },
  '21': { required: false, label: 'SCRATCH2',  target: { kind: 'annotation' } },
  '24': { required: true,  label: 'MIT RMKS',     target: { kind: 'annotation' } },
  '24A':{ required: false, label: 'ARSPC',    target: { kind: 'airspace-owner' } },
  'IFR':  { required: false, label: 'KEEP IFR',     target: { kind: 'tofi', field: 'ifrActive' } },      // WP4A second slice, §4.6.3 — see DEPARTURE_BLOCK_MAP's comment
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
// efsp-block-map-parity.test.mjs.
export const MISSION_BLOCK_MAP = {
  'M1': { required: true,  label: 'MSN #',   target: { kind: 'flightData', path: 'mission.missionNumber' } },
  'M2': { required: false, label: 'PKG',     target: { kind: 'flightData', path: 'mission.packageId' } },
  'M3': { required: true,  label: 'CALLSIGN',target: { kind: 'flightData', path: 'identity.callsign' } },
  'M4': { required: true,  label: 'BEACON',  target: { kind: 'flightData', path: 'identity.beaconAssigned' } },
  'M5': { required: false, label: 'CTL AGY', target: { kind: 'flightData', path: 'mission.controllingAgency' } },
  'M6': { required: false, label: 'VUL STRT',target: { kind: 'flightData', path: 'mission.vulWindowStartUtc' } },
  'M7': { required: false, label: 'VUL END', target: { kind: 'flightData', path: 'mission.vulWindowEndUtc' } },
  'M8': { required: false, label: 'RMKS',    target: { kind: 'flightData', path: 'filed.remarks' } },
  'M25': { required: true, label: 'STATE',   target: { kind: 'system', field: 'state' } },
  'M26': { required: true, label: 'NLA',     target: { kind: 'nla' } },
  // decisions.md H55 (crc-sync's docs/adr/0069): whoever the pilot talks to records hung ordnance.
  '3G': { required: false, label: 'ORDNANCE', target: { kind: 'military', field: 'ordnanceState' } }, // guide M14, §9.5
};

// The carrier's three Block Maps (crc-sync's docs/adr/0064 B3, docs/adr/0074;
// guide §9.12) — a literal duplicate of crc-sync's block-map.js, held by
// efsp-block-map-parity.test.mjs. `carrier-derived` Blocks are DISPLAY ONLY:
// the server derives them (angels from the stack index, DME from angels, push
// time from the Charlie time, the final bearing from the ship's heading) and
// refuses any write, so nothing here is editable and nothing here computes
// (carrier-state.js formats what the server sent). `carrier` Blocks are the
// flight's own fields, on the flight data so they survive launch to recovery.
const _CARRIER_CHROME = {
  '2':  { required: true,  label: 'REV',    target: { kind: 'system', field: 'rev' } },
  '4':  { required: true,  label: 'CID',    target: { kind: 'system', field: 'cid' } },
  '4A': { required: false, label: 'RMV',    target: { kind: 'flag', flag: 'removeIndicator' } },
  '5':  { required: false, label: 'BEACON', target: { kind: 'flightData', path: 'identity.beaconAssigned' } },
  '25': { required: true,  label: 'STATE',  target: { kind: 'system', field: 'state' } },
  '26': { required: true,  label: 'NLA',    target: { kind: 'nla' } },
};

export const MARSHAL_BLOCK_MAP = {
  'C1':  { required: true,  label: 'CALLSIGN', target: { kind: 'flightData', path: 'identity.callsign' } },
  'C2':  { required: true,  label: 'TYPE',     target: { kind: 'flightData', path: 'identity.aircraftType' } },
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
  'C18': { required: false, label: 'SIDE',     target: { kind: 'carrier', field: 'sideNumber' } },
  'C19': { required: false, label: 'TURN',     target: { kind: 'carrier', field: 'approachTurnNm' } },
  'C24': { required: false, label: 'NOTE',     target: { kind: 'annotation' } },
  '9E':  { required: false, label: 'RMKS',     target: { kind: 'flightData', path: 'filed.remarks' } }, // H138 U2: the flight's remarks, on every strip type
  ..._CARRIER_CHROME,
};

export const FINAL_BLOCK_MAP = {
  'C1':  { required: true,  label: 'CALLSIGN', target: { kind: 'carrier-derived', field: 'callsign' } },
  'C2':  { required: true,  label: 'TYPE',     target: { kind: 'carrier-derived', field: 'aircraftType' } },
  'C9':  { required: false, label: 'FNL BRG',  target: { kind: 'carrier-derived', field: 'expectedFinalBearing' } },
  'C18': { required: false, label: 'SIDE',     target: { kind: 'carrier-derived', field: 'sideNumber' } },
  'C19': { required: false, label: 'TURN',     target: { kind: 'carrier-derived', field: 'approachTurnNm' } },
  'C16': { required: false, label: 'DECK',     target: { kind: 'carrier-derived', field: 'deck' } },
  'C17': { required: false, label: 'DIST',     target: { kind: 'carrier-derived', field: 'finalDistance' } },
  // crc-sync docs/adr/0117: the talk-down's two assignments, the flight's clearance (H134 LT-RQ8 a: PAR changes them).
  '7A': { required: false, label: 'ALT',      target: { kind: 'clearance', field: 'altitude' }, interlock: 'ALTITUDE' },
  '9A-VECTOR': { required: false, label: 'HDG', target: { kind: 'clearance', field: 'heading' }, interlock: 'COURSE' },
  '9E':  { required: false, label: 'RMKS',     target: { kind: 'flightData', path: 'filed.remarks' } }, // H138 U2
  '2':  _CARRIER_CHROME['2'], '4': _CARRIER_CHROME['4'], '4A': _CARRIER_CHROME['4A'],
  '25': _CARRIER_CHROME['25'], '26': _CARRIER_CHROME['26'],
};

export const PATTERN_BLOCK_MAP = {
  'C1':  { required: true,  label: 'CALLSIGN', target: { kind: 'flightData', path: 'identity.callsign' } },
  'C2':  { required: true,  label: 'TYPE',     target: { kind: 'flightData', path: 'identity.aircraftType' } },
  'C18': { required: false, label: 'SIDE',     target: { kind: 'carrier-derived', field: 'sideNumber' } },
  'C24': { required: false, label: 'NOTE',     target: { kind: 'annotation' } },
  '9E':  { required: false, label: 'RMKS',     target: { kind: 'flightData', path: 'filed.remarks' } }, // H138 U2
  ..._CARRIER_CHROME,
};

export const BLOCK_MAPS = {
  DEPARTURE: DEPARTURE_BLOCK_MAP, ARRIVAL: ARRIVAL_BLOCK_MAP, OVERFLIGHT: OVERFLIGHT_BLOCK_MAP, MISSION: MISSION_BLOCK_MAP,
  MARSHAL: MARSHAL_BLOCK_MAP, FINAL: FINAL_BLOCK_MAP, PATTERN: PATTERN_BLOCK_MAP,
};

// ── Remarks (decisions.md H138 U2, H139) ───────────────────────────────────
//
// Every strip type carries the flight's remarks (filed.remarks): 9E on the ATC and carrier maps, M8 on MISSION. The
// Strip face shows them in one bottom row when present (strip-remarks.js), cut at a word boundary, and the whole text
// opens in a small text-box window (bay/popovers/remarks.js) that edits it through the ordinary SetBlock.

/** @returns {string|null} the Block id holding this strip type's remarks, or null when its map has none. */
export function remarksBlockFor(stripType) {
  const map = BLOCK_MAPS[stripType || 'DEPARTURE'];
  if (!map) return null;
  for (const [id, def] of Object.entries(map)) {
    if (def.target.kind === 'flightData' && def.target.path === 'filed.remarks') return id;
  }
  return null;
}

/** The flight's remarks, or '' when there are none (blank counts as none: an absent row takes no space). */
export function remarksOf(flightData) {
  const r = flightData && flightData.filed ? flightData.filed.remarks : null;
  return typeof r === 'string' && r.trim() ? r : '';
}

/**
 * H139's cut: the remarks on one line (whitespace folded), and when that does not fit, the longest prefix ending at a
 * word boundary that fits with an ellipsis after it. `fits(text)` answers for the row it will be drawn in. A first word
 * too long for the row comes back whole, for the CSS ellipsis to cut mid-word: there is no boundary to cut at.
 * @param {string} text
 * @param {(candidate: string) => boolean} fits
 * @returns {string}
 */
export function cutRemarksToFit(text, fits) {
  const line = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!line || fits(line)) return line;
  const ends = [];
  const word = /\S+/g;
  let m;
  while ((m = word.exec(line))) ends.push(m.index + m[0].length);
  const cut = (i) => `${line.slice(0, ends[i]).replace(/[,;:.\-–—]+$/, '')}…`;
  let lo = 0, hi = ends.length - 2, best = -1; // the last word ends the whole line, which did not fit
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(cut(mid))) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best >= 0 ? cut(best) : line;
}

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
  const map = BLOCK_MAPS[strip.stripType || 'DEPARTURE'];
  const def = map && map[blockId];
  if (def && def.target.kind === 'clearance') {
    const flightData = getEfspFlightData(strip.flightDataId);
    return (flightData && flightData.clearance && flightData.clearance[def.target.field]) || null;
  }
  return (strip.annotations && strip.annotations[blockId]) || null;
}

/** The currently-ACTIVE entry's value for an annotation (or clearance) Block, or null if none has ever been set. */
export function activeAnnotationValue(strip, blockId) {
  const cell = _historyCellFor(strip, blockId);
  if (!cell) return null;
  const active = cell.entries.find(e => e.status === 'ACTIVE');
  return active ? active.value : null;
}

/** True when this annotation Block currently has an ACTIVE entry — i.e. there's something a confirmVacated action (§3.7 rule 3) could actually strike. Checked by status directly rather than truthiness of activeAnnotationValue(), since an active value could itself be falsy-looking (e.g. "0"). */
export function hasActiveAnnotationEntry(strip, blockId) {
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
export function annotationHistory(strip, blockId) {
  const cell = _historyCellFor(strip, blockId);
  if (!cell || !Array.isArray(cell.entries)) return [];
  return cell.entries;
}

/** The entries a Block shows ABOVE its current value — everything that is no longer ACTIVE, oldest first. */
export function supersededAnnotationEntries(strip, blockId) {
  return annotationHistory(strip, blockId).filter(e => e.status !== 'ACTIVE');
}

// Annotation Blocks eligible for the confirmVacated action (guide §3.7 rule
// 3 — "a vacated altitude MUST NOT be struck automatically on assignment...
// implement as an explicit confirmVacated action"). Kept next to the Block
// Map it describes, not as a magic list in bay-view.js's DOM code, and
// role-keyed since eligibility is per-role: DEPARTURE's Block 21 ("Initial
// altitude") vs ARRIVAL's Block 7 (assigned/cleared altitude — the field
// that actually gets a sequence of clearances on a descending arrival).
// Every strip type's assigned altitude now (docs/adr/0058) — OVERFLIGHT's 7A was
// missing, so an overflight's altitude had no ⌿ at all.
export const CONFIRM_VACATED_ELIGIBLE_BLOCKS = { DEPARTURE: ['21'], ARRIVAL: ['7'], OVERFLIGHT: ['7A'] };

// Block 3 (JO 7110.65BB TBL 2-3-3/4/5: "Number of aircraft if more than one, wake category indicator, type of
// aircraft, and aircraft equipment suffix"), written in ICAO order (H134 LT-RQ2 b): `[count/]TYPE[/WAKE][/SUFFIX]`,
// e.g. `F16/M`, `2/F16/M/G`. The wake is the ICAO category L/M/H/J (LT-RQ1 c). No leading slant; a suffix with no
// wake keeps the wake's place empty (`F16//G`), so a suffix letter is never read as a wake. Degradation (§3.3)
// overrides the rendered suffix independently of the derived equipmentSuffix, never touching it.
export function formatBlock3(flightData) {
  const id = flightData && flightData.identity;
  if (!id || !id.aircraftType) return '';
  const suffix = id.degradation === 'TRANSPONDER_FAILED' ? 'H'
    : id.degradation === 'MODE_C_FAILED' ? 'O'
    : id.equipmentSuffix || '';
  const parts = [];
  if (id.flightSize > 1) parts.push(String(id.flightSize));
  parts.push(id.aircraftType);
  if (id.wakeCategory || suffix) parts.push(id.wakeCategory || '');
  if (suffix) parts.push(suffix);
  return parts.join('/');
}

/** What the Block 3 editor opens on: `[count/]TYPE[/WAKE]`, the part a controller types (the suffix is derived). */
export function aircraftDataEditText(flightData) {
  const id = flightData && flightData.identity;
  if (!id || !id.aircraftType) return '';
  return [id.flightSize > 1 ? String(id.flightSize) : '', id.aircraftType, id.wakeCategory || ''].filter(Boolean).join('/');
}

/**
 * Resolves one Block's display value + provenance for a Strip/flight data pair.
 * Strip-type-aware via strip.stripType (defaulting to DEPARTURE when strip is null —
 * e.g. an unrendered/placeholder cell) rather than a separate parameter,
 * since every real caller already has the Strip in hand.
 * NLA (Block 26) resolves to null here — the button's label/inhibit state
 * comes from efsp-nla.js against the current strip.state, not from a
 * stored value.
 * @returns {{value:*, provenance:string}}
 */
export function resolveBlockValue(blockId, flightData, strip) {
  const map = BLOCK_MAPS[(strip && strip.stripType) || 'DEPARTURE'] || DEPARTURE_BLOCK_MAP;
  const def = map[blockId];
  if (!def) return { value: null, provenance: 'SYSTEM_DERIVED' };
  const t = def.target;

  if (t.kind === 'flightData') {
    // §10.5 (docs/adr/0073): P-time, TAXI and TAKEOFF on a DEPARTURE Strip
    // show the first source in their chain that has a value, computed here and
    // never written back. `timeSource` says which; `estimated` marks another
    // source's time standing in for an actual that has not happened yet.
    const chain = ((strip && strip.stripType) || 'DEPARTURE') === 'DEPARTURE'
      ? timeChainForBlock(blockId) : null;
    if (chain) {
      const r = resolveTimeChain(chain, flightData);
      const stored = (flightData && flightData.provenance && flightData.provenance[t.path]) || 'CONTROLLER_ENTERED';
      return {
        value: formatZuluHhmm(r.valueUtc) || null,
        provenance: r.source === 'CONTROLLER' ? stored : 'COMPUTER_GENERATED',
        timeSource: r.source,
        estimated: r.estimated,
      };
    }
    let value = flightData ? getPath(flightData, t.path) : null;
    if (ZULU_HHMM_BLOCKS.has(blockId)) value = formatZuluHhmm(value) || null; // epoch ms → '1432'
    const provenance = (flightData && flightData.provenance && flightData.provenance[t.path]) || def.provenance || 'CONTROLLER_ENTERED';
    return { value: value ?? null, provenance };
  }
  if (t.kind === 'annotation') {
    return { value: activeAnnotationValue(strip, blockId), provenance: 'CONTROLLER_ENTERED' };
  }
  if (t.kind === 'clearance') {
    const cell = flightData && flightData.clearance && flightData.clearance[t.field];
    const active = cell && cell.entries.find(e => e.status === 'ACTIVE');
    return { value: active ? active.value : null, provenance: 'CONTROLLER_ENTERED' };
  }
  if (t.kind === 'system') {
    return { value: strip ? strip[t.field] : null, provenance: 'SYSTEM_DERIVED' };
  }
  if (t.kind === 'flag') {
    return { value: strip ? strip.flags[t.flag] : null, provenance: 'SYSTEM_DERIVED' };
  }
  if (t.kind === 'aircraft-data') {
    return { value: formatBlock3(flightData), provenance: 'COMPUTER_GENERATED' };
  }
  if (t.kind === 'nla') {
    return { value: null, provenance: 'SYSTEM_DERIVED' };
  }
  // WP4A gap-closure (docs/adr/0022) — was previously falling through to
  // the null/SYSTEM_DERIVED catch-all below, meaning Block 24A never
  // actually displayed flightData.airspace.owner even before it had an edit path.
  // Reads straight off the flight data, same shape as the 'flightData' branch above — kept
  // separate since airspace ownership lives in flightData.airspace, not
  // flightData.identity/flightData.filed/flightData.assigned like every generic 'flightData' path.
  if (t.kind === 'airspace-owner') {
    return { value: (flightData && flightData.airspace) ? flightData.airspace.owner : null, provenance: (flightData && flightData.provenance && flightData.provenance['airspace.owner']) || 'CONTROLLER_ENTERED' };
  }
  // WP4A second slice, §4.6.3 — the three-field separation model. Same
  // dedicated-kind reasoning as 'airspace-owner' above; `field` picks which
  // of the 3 keys on flightData.tofi this particular Block renders.
  if (t.kind === 'tofi') {
    return { value: (flightData && flightData.tofi) ? flightData.tofi[t.field] : null, provenance: (flightData && flightData.provenance && flightData.provenance.tofi) || 'CONTROLLER_ENTERED' };
  }
  // WP6 (crc-sync's docs/adr/0052), guide §6.4 — the military extension
  // namespace, read exactly like 'tofi' above. The `flightData.military &&` guard is
  // not defensive padding: this field was the literal `null` of a WP6 hook
  // until 0052, and a flight data restored from a snapshot written before then can
  // still arrive that way if it reaches a client before the server has
  // reseeded it.
  if (t.kind === 'military') {
    return { value: (flightData && flightData.military) ? flightData.military[t.field] : null, provenance: (flightData && flightData.provenance && flightData.provenance.military) || 'CONTROLLER_ENTERED' };
  }
  // The RANGE slice — Block 22, the frequency this flight has been approved
  // onto. Lives in flightData.comms for the same reason airspace ownership lives in
  // flightData.airspace: a dedicated setter, not a generic writable path.
  // crc-sync docs/adr/0074 — a flight's own carrier fields, off the flight data.
  if (t.kind === 'carrier') {
    const raw = flightData && flightData.military && flightData.military.carrier ? flightData.military.carrier[t.field] : null;
    const value = t.field === 'eeatUtc' && raw != null ? formatZuluHhmm(raw) : raw;
    return { value: value ?? null, provenance: (flightData && flightData.provenance && flightData.provenance.military) || 'CONTROLLER_ENTERED' };
  }
  // ...and the values the server DERIVES (angels, DME, push time, the bearings,
  // the Case). Formatted by carrier-state.js from what the server sent; nothing
  // is computed here, and nothing here is editable.
  if (t.kind === 'carrier-derived') {
    let text = '';
    if (t.field === 'finalDistance') text = carrierFinalDistanceText(strip);
    else if (t.field === 'callsign') text = flightData && flightData.identity ? (flightData.identity.callsign || '') : '';
    else if (t.field === 'aircraftType') text = flightData && flightData.identity ? (flightData.identity.aircraftType || '') : '';
    else if (t.field === 'approachTurnNm') text = flightData && flightData.military && flightData.military.carrier && flightData.military.carrier.approachTurnNm != null ? String(flightData.military.carrier.approachTurnNm) : '';
    else if (t.field === 'sideNumber') text = flightData && flightData.military && flightData.military.carrier ? (flightData.military.carrier.sideNumber || '') : '';
    else {
      const c = getEfspCarrier();
      text = carrierDerivedText(t.field, strip ? strip.flightDataId : null, c ? c.shipState : null);
    }
    return { value: text === '' ? null : text, provenance: 'SYSTEM_DERIVED' };
  }
  if (t.kind === 'frequency') {
    const mhz = (flightData && flightData.comms) ? flightData.comms.workingFrequencyMhz : null;
    return {
      value: mhz == null ? null : mhz.toFixed(3),
      provenance: (flightData && flightData.provenance && flightData.provenance['comms.workingFrequencyMhz']) || 'CONTROLLER_ENTERED',
    };
  }
  return { value: null, provenance: 'SYSTEM_DERIVED' };
}

// Blocks edited via a dedicated <select> (bay-view.js) rather than the
// generic free-text click-to-edit path — restricted-enum fields where free
// text would let a controller enter something invalid. Keyed by blockId,
// not target.kind: '24A' needs a structurally distinct target kind
// server-side (the D15 "no boolean path" defect), but '5A' is plain
// 'flightData'-routed (flight-data-store.js's setField already validates it) — both still
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
  // §3.8's release states. flight-data-store.js validates the value; this is the
  // picker so a controller never types one of six exact strings by hand.
  '14A': ['RELEASED', 'HOLD_FOR_RELEASE', 'RELEASE_TIME', 'CLEARANCE_VOID_TIME', 'EDCT', 'CALL_FOR_RELEASE'],
  '24A': ['CONTROLLING_AGENCY', 'USING_AGENCY'],
  'RSVC': ['ACTIVE', 'TERMINATED'],
  'SREG': ['ATC', 'MARSA', 'USING_AGENCY', 'DUE_REGARD', 'SEE_AND_AVOID'],
  // WP6 §9.5 (guide M14) — ordnance state. flight-data-store.js's ORDNANCE_STATES is
  // the authority; this is the picker. A static literal is right here, unlike
  // Block 9F's route table, because these four values are the guide's own and
  // are not runtime config.
  '3G': ['CLEAN', 'LOADED', 'HUNG', 'EXPENDED'],
  // crc-sync docs/adr/0143: the direction of flight, flight-data-store.js's DIRECTIONS_OF_FLIGHT (clearable).
  '9K': ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
  // WP6 §9.6 (guide M16) — alert status, the guide's own three values;
  // flight-data-store.js's ALERT_STATUSES is the authority. 'NONE' is its cleared
  // value and is in the list, as 3G's 'CLEAN' is (crc-sync docs/adr/0070).
  '14E': ['NONE', 'ALERT', 'SCRAMBLE'],
  'C4': ['TACAN', 'ICLS', 'ACLS', 'PAR', 'VISUAL'], // crc-sync carrier/flight-record.js APPROACH_TYPES
};

// Block 9F's options come from the stereo route table, which is runtime
// config (docs/adr/0073): efsp-stereo-routes.js caches the last list crc-sync
// returned.
function _stereoRouteOptions() {
  const routes = cachedStereoRoutesClient();
  return Array.isArray(routes) ? routes.filter(r => r && r.name && r.active !== false) : [];
}

/**
 * @param {string} blockId
 * @param {object} [flightData] — the flight, for Block 9F only: a route the squadron
 *   has since retired stays on the flight flying it (ADR 0050: deactivation is
 *   not retroactive), so the flight's current name is offered even when the
 *   table no longer lists it.
 * @returns {string[]|null} the option values for this Block if it's an
 *   enum-select Block, else null. 9F is null when there is nothing to offer —
 *   no routes cached and no stereo on the flight — so bay-view.js renders a
 *   plain cell rather than a picker that can only fail.
 */
export function enumSelectOptionsFor(blockId, flightData) {
  if (blockId === '9F') {
    const names = _stereoRouteOptions().map(r => r.name);
    const current = flightData && flightData.filed ? flightData.filed.stereoRouteName : null;
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
//                   so clearing one is a meaningful action. flight-data-store.js's
//                   setTofi() normalizes the '' a <select> sends to null, so
//                   "—" sends '' and there is one spelling of "cleared"
//                   server-side.
//   5A           -> 'NONE' IS this field's cleared value; offer that.
//   3G           -> 'CLEAN' IS this field's cleared value; offer that.
//   14A          -> §3.8's six release states are exhaustive. There is no
//                   "no release state".
//   24A          -> airspace ownership is a DIRECTION; "give it back" is
//                   CONTROLLING_AGENCY. Clearing it (LT-AIRSPACE-FIX T13) goes
//                   back to undecided, an ordinary amendment: setAirspaceOwner()
//                   takes '' as null and appends the clear to its transitions,
//                   so the earlier direction is still on record.
//   9F           -> flight-data-store.js's setField('filed.stereoRouteName', '')
//                   clears the LABEL and keeps the route (docs/adr/0050), so
//                   "cancel the stereo" is meaningful and the route a flight
//                   is taxiing on never goes blank (docs/adr/0073).
// Clearing SREG is still refused while an ACTIVE MARSA relation holds the
// flight (crc-sync names the declarer in the refusal). That is correct
// and deliberately NOT pre-empted here: the refusal is legible and lands
// attributed to the Strip.
// crc-sync docs/adr/0126 (H150 TWR-Q1 a): LC's two pattern cells, a click cycling through the values the server accepts
// (flight-data-store.js PATTERN_ENTRIES / PATTERN_OPTIONS) and back to empty. Each shows its short form: PAT / STR, and
// T&G / FS / LA (no stop-and-go, H147 RQ7). Checked before the enum <select> (block-edit.js).
export const CYCLE_BLOCKS = {
  '9J-ENTRY': [['PATTERN', 'PAT'], ['STRAIGHT_IN', 'STR']],
  '9J-OPTION': [['TOUCH_AND_GO', 'T&G'], ['FULL_STOP', 'FS'], ['LOW_APPROACH', 'LA']],
};

/** @returns {boolean} is this Block a click-to-cycle cell? */
export function isCycleBlock(blockId) {
  return Object.prototype.hasOwnProperty.call(CYCLE_BLOCKS, blockId);
}

/** The short form a cycle cell shows for `value` ('' when unset or unknown). */
export function cycleBlockLabel(blockId, value) {
  const row = (CYCLE_BLOCKS[blockId] || []).find(([v]) => v === value);
  return row ? row[1] : '';
}

/** The value one click sets: the next in the list, '' (clear) after the last, the first from empty. */
export function nextCycleValue(blockId, value) {
  const values = (CYCLE_BLOCKS[blockId] || []).map(([v]) => v);
  const i = values.indexOf(value);
  if (i < 0) return values[0] || '';
  return i + 1 < values.length ? values[i + 1] : '';
}

export const ENUM_CLEARABLE_BLOCKS = new Set(['RSVC', 'SREG', '24A', '9F', 'C4', '9K']);

/** @returns {boolean} may this enum Block be cleared back to no value at all? */
export function isEnumBlockClearable(blockId) {
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
export function isBooleanToggleBlock(blockId) {
  return BOOLEAN_TOGGLE_BLOCKS.has(blockId);
}

/** @returns {string|null} this Block's display label for the given role, or null if the Block doesn't exist for that role. */
export function blockLabelFor(blockId, stripType = 'DEPARTURE') {
  const map = BLOCK_MAPS[stripType] || DEPARTURE_BLOCK_MAP;
  const def = map[blockId];
  return def ? def.label || null : null;
}

export function requiredBlocksFor(stripType = 'DEPARTURE') {
  const map = BLOCK_MAPS[stripType];
  if (!map) return [];
  return Object.entries(map).filter(([, def]) => def.required).map(([id]) => id);
}

/** crc-sync block-map.js's PAR_FINAL_ONLY_BLOCKS: FINAL Blocks typed only on an airfield's PAR final, never the carrier's. */
export const PAR_FINAL_ONLY_BLOCKS = Object.freeze(['7A', '9A-VECTOR']);

/**
 * True for a PAR-final-only Block on the carrier's FINAL: neither typed nor shown there (dark cockpit, H115-H119: the
 * carrier final has nothing to type and no conformance, so an approach controller's old HDG and ALT would be noise).
 */
export function isParFinalOnlyOnCarrier(stripType, blockId, facilityId) {
  return stripType === 'FINAL' && facilityId === 'CARRIER' && PAR_FINAL_ONLY_BLOCKS.includes(blockId);
}

/**
 * A Block is directly editable via click-to-edit (guide §3.7/§7.4 — Enter
 * commits, Esc reverts, no auto-commit on blur) when it's flight-data- or
 * annotation-routed. System/composite/flag/nla Blocks (2, 3, 4, 4A, 25, 26)
 * are managed by their own dedicated mechanisms (server-derived,
 * gesture toggles, the NLA button) and are never free-text editable here.
 */
export function isBlockEditable(blockId, stripType = 'DEPARTURE', facilityId = null) {
  const map = BLOCK_MAPS[stripType];
  const def = map && map[blockId];
  // HDG and ALT are the PAR final's (an airfield's): the carrier's FINAL has nothing to type (crc-sync block-map.js).
  if (isParFinalOnlyOnCarrier(stripType, blockId, facilityId)) return false;
  // 9F is a picker (docs/adr/0073) and editable only while there is a route
  // table to pick from; with none it must not fall through to free text
  // (bay-view.js tries the picker first, then this).
  if (blockId === '9F') return !!def && _stereoRouteOptions().length > 0;
  // 'frequency' joins the editable kinds: unlike airspace-owner/tofi, which
  // are restricted enums with their own <select>, a frequency is a free
  // numeric entry — the ordinary click-to-edit path is right for it. The
  // server validates the band.
  return !!def && (def.target.kind === 'flightData' || def.target.kind === 'annotation' || def.target.kind === 'frequency' || def.target.kind === 'clearance' || def.target.kind === 'carrier' || def.target.kind === 'aircraft-data');
}

/**
 * A Block whose editor opens on something other than what it shows. TYPE (Block 3) shows
 * `[count/]TYPE[/WAKE][/SUFFIX]` and is typed as `[count/]TYPE[/WAKE]` (T7, H134 LT-RQ2 b): the suffix comes
 * from the equipment codes, so the editor leaves it out. crc-sync parses what is typed (aircraft-data.js) into
 * the number, the type and the wake, and derives the wake from the type when none is typed.
 * @returns {{blockId:string, value:string}|null} null when the Block edits what it shows
 */
export function editRedirectFor(blockId, stripType, flightData) {
  if (blockId !== '3') return null;
  const map = BLOCK_MAPS[stripType || 'DEPARTURE'];
  const def = map && map['3'];
  if (!def || def.target.kind !== 'aircraft-data') return null;
  return { blockId: '3', value: aircraftDataEditText(flightData) };
}

/**
 * The editor's placeholder: the format a Block is typed in, shown before anything is typed (T31 a). Every Zulu
 * time Block and EEAT (C15) are HHMM; TYPE is TYPE/WAKE.
 */
export function blockInputPlaceholderFor(blockId) {
  if (ZULU_HHMM_BLOCKS.has(blockId) || blockId === 'C15') return 'HHMM';
  if (blockId === '3') return 'TYPE/WAKE';
  return null;
}

// ── Zulu time-of-day Blocks (crc-sync's docs/adr/0062) ──────────────────────
//
// Blocks whose flight data value is epoch ms (dated by crc-sync against the MISSION
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
export const ZULU_HHMM_BLOCKS = new Set([
  '6', '9G-TIME', '9H-TIME', '14', '14B', '14C', '14D', '16', '17', '18', 'M6', 'M7',
]);

// ── Label hover titles (live test T8, decisions.md H134 LT-RQ4 c) ──────────
//
// The labels stay as they were (only Block 1 became ACID, LT-RQ3 a); each label's hover gives the FAA block name and
// number from JO 7110.65BB TBL 2-3-4 (departure), 2-3-3 (arrival) and 2-3-5 (overflight), per the research's Q5 table
// (docs/parallel/research/live-test-faa.md). "(ours)" marks a Block no FAA block carries; "#≠" marks one whose FAA
// block number differs from ours (the ids are wire and state keys, so they are not renumbered). Every typed time
// says "UTC HHMM" (T31 a). The MTR fields (docs/adr/0062) and IFR (UI-A U3) keep their own wording, marked ours;
// EXIT ALT carries §9.4's lost-comms rule (blockTitleFor). MISSION and the carrier/pattern maps have no FAA strip:
// only their typed times carry a title.
const DEPARTURE_TITLES = {
  '1': 'Block 1, aircraft identification',
  '2': 'Block 2, revision number',
  '2A': 'Voice clearance issued (ours; FAA Block 2A is "strip request originator")',
  '3': 'Block 3, number of aircraft, wake category indicator (ICAO L, M, H, J), type of aircraft, equipment suffix',
  '3A': 'Aircraft type designator (Block 3)',
  '3B': 'Wake category indicator, ICAO L, M, H or J (Block 3)',
  '3C': 'Tail number (ours)',
  '3D': 'Unit (ours)',
  '3E': 'Home station / base (ours, military)',
  '3F': 'Tailhook required (ours, military)',
  '3G': 'Ordnance state (ours, military)',
  '4': 'Block 4, computer identification number',
  '4A': 'Remove indicator (ours)',
  '4B': 'Datalink clearance indicator (ours)',
  '5': 'Block 5, beacon code assigned',
  '5A': 'Track degradation flag (ours)',
  '6': 'Block 6, proposed departure time (P time), UTC HHMM',
  '7': 'Block 7, requested altitude',
  '8': 'Block 8, departure airport',
  '8A': 'Departure runway (ours, in the FAA\'s optional space 8A)',
  '8B': 'Destination (FAA: part of Block 9; ours as its own cell)',
  '9': 'Block 9, route (computer-generated) and manual altitude restrictions',
  '9A': 'Block 9A, optional use (facility)',
  '9B': 'Block 9B, optional use (facility)',
  '9C': 'Block 9C, optional use (facility)',
  '9D': 'Full route clearance (ours)',
  '9E': 'Remarks (Block 9)',
  '9J-ENTRY': 'Pattern or straight-in (ours: the tower\'s pattern work, AIM 4-3-3)',
  '9J-OPTION': 'Touch-and-go, full stop or low approach (JO 7110.65 ¶3-8-2; ours as a cell)',
  '9F': 'Stereo route (ours, local tower-en-route canned route)',
  '9K': 'VFR direction of flight (AIM 4-1-18 a.5(b); ours as a cell)',
  '9G-MTR': 'MTR designator (ours, military; guide M10)',
  '9G-ENTRY': 'MTR entry fix (ours, military)',
  '9G-TIME': 'MTR entry time, UTC HHMM (ours, military)',
  '9H-EXIT': 'MTR exit fix (ours, military; guide §9.4)',
  '9H-TIME': 'MTR exit estimate, UTC HHMM (ours, military)',
  '9H-ALT': 'Requested altitude after MTR exit (ours, military)',
  '9A-SPEED': 'Speed assignment (ours on a departure)',
  '10': 'ATIS code (ours, facility-directive space 10-18)',
  '11': 'Approval request (APREQ) (ours, space 10-18)',
  '14': 'Release time, UTC HHMM (P/CG RELEASE TIME; space 10-18)',
  '14A': 'Departure release state (ours)',
  '14B': 'Expect departure clearance time, UTC HHMM',
  '14C': 'Call for release time, UTC HHMM',
  '14D': 'Clearance void time, UTC HHMM (P/CG CLEARANCE VOID IF NOT OFF BY)',
  '14E': 'Alert status (ours, military)',
  '16': 'Movement-area entry time, UTC HHMM (ours)',
  '17': 'Taxi time, UTC HHMM (ours)',
  '18': 'Departure (takeoff) time, UTC HHMM (space 10-18)',
  '19': 'Gate / parking (ours)',
  '20': 'Assigned heading (ours; not en route Block 20)',
  '21': 'Assigned altitude (ours)',
  '22': 'Frequency (ours)',
  '23': 'Facility remarks (ours)',
  '24': 'Miles-in-trail (P/CG MILES-IN-TRAIL; ours as a block)',
  '24A': 'Airspace owner (ours)',
  // UI-A U3: the field is TOFI's ifrActive (guide §4.6.3), not the filed flight rules.
  'IFR': 'Keeps IFR under tactical control (TOFI, guide §4.6.3; ours): ✓ means ATC keeps separating this flight while the mission line works it. Click to toggle.',
  'RSVC': 'Radar service (TOFI, ours)',
  'SREG': 'Separation regime (TOFI, ours)',
  '25': 'Strip state (ours)',
  '26': 'Next logical action (ours)',
};

const ARRIVAL_TITLES = {
  ...DEPARTURE_TITLES,
  '6': 'ETA at coordination fix or destination, UTC HHMM (FAA Block 8, #≠)',
  '7': 'Assigned altitude (FAA Block 9, #≠)',
  '8': 'Point of origin (ours on a terminal arrival)',
  '8A': 'Coordination fix (FAA Block 7, #≠)',
  '8B': 'Landing runway (ours)',
  '9': 'Route (ours on an arrival)',
  '9A-FUEL': 'Block 9A, minimum fuel',
  '9A-DEST': 'Block 9A, destination airport',
  '9A-PTOUT': 'Block 9A, point out',
  '9A-VECTOR': 'Block 9A, radar vector (assigned heading)',
  '9A-SPEED': 'Block 9A, speed adjustment',
  '20': 'Scratchpad (ours)',
  '21': 'Scratchpad (ours)',
};

const OVERFLIGHT_TITLES = {
  ...DEPARTURE_TITLES,
  '7': 'Requested altitude (en route Block 24, #≠; FAA terminal Block 7 is the overflight coordination indicator)',
  '7A': 'Assigned altitude (FAA Block 9, #≠)',
  '8': 'Point of origin (ours)',
  '8B': 'Destination (ours)',
  '9': 'Block 9, route of flight through the terminal area',
  '9A-VECTOR': 'Assigned heading (ours)',
  '9A-SPEED': 'Speed assignment (ours)',
};

function _titlesFor(map, titles) {
  return Object.fromEntries(Object.entries(titles).filter(([id]) => Object.prototype.hasOwnProperty.call(map, id)));
}

/** Label hover titles, by strip type then Block id. Only Blocks the strip type's Block Map has. */
export const BLOCK_TITLES = {
  DEPARTURE: _titlesFor(DEPARTURE_BLOCK_MAP, DEPARTURE_TITLES),
  ARRIVAL: _titlesFor(ARRIVAL_BLOCK_MAP, ARRIVAL_TITLES),
  OVERFLIGHT: _titlesFor(OVERFLIGHT_BLOCK_MAP, OVERFLIGHT_TITLES),
  MISSION: { M6: 'Vul window start, UTC HHMM (ours)', M7: 'Vul window end, UTC HHMM (ours)' },
  MARSHAL: { C15: 'Expected EAT, UTC HHMM (ours)' },
};

// ── §10.5's source on hover (docs/adr/0073) ─────────────────────────────────
//
// What each chain source means, in the words a controller reads. An estimate
// names the chain it borrowed from and that chain's own source.
export const TIME_SOURCE_TEXT = {
  CONTROLLER: 'entered by a controller',
  FLIGHT_PLAN: 'from the filed DD-1801 (item 13, EOBT)',
  ATO: 'from the ATO (AMSNDAT departure time)',
  STATE_CHANGE: 'stamped when the Strip entered Airborne',
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
 * Null for any other Block or strip type.
 */
export function timeChainTitleFor(blockId, flightData, strip) {
  if (((strip && strip.stripType) || 'DEPARTURE') !== 'DEPARTURE') return null;
  const chain = timeChainForBlock(blockId);
  if (!chain) return null;
  const r = resolveTimeChain(chain, flightData);
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
 * S-L16 W3: a typed TAXI (17) or TAKEOFF (18) that now sits BEFORE the proposed departure. A
 * controller's entry stops the chain (§10.2 rule 3), so a later P-time does not move it, and
 * the Strip would otherwise show TAXI 1425 ahead of a P-time of 1450 with nothing saying why.
 * @returns {{typedUtc:number, planUtc:number}|null}
 */
export function typedTimeBehindPlan(blockId, flightData, strip) {
  if (((strip && strip.stripType) || 'DEPARTURE') !== 'DEPARTURE') return null;
  const chain = timeChainForBlock(blockId);
  if (chain !== 'offBlock' && chain !== 'takeoff') return null;
  const own = resolveTimeChain(chain, flightData);
  if (own.source !== 'CONTROLLER' || own.valueUtc == null) return null;
  const plan = resolveTimeChain('departure', flightData);
  if (plan.valueUtc == null || own.valueUtc >= plan.valueUtc) return null;
  return { typedUtc: own.valueUtc, planUtc: plan.valueUtc };
}

/**
 * What the VALUE cell of a Block adds to itself (bay-view.js's _buildBlockCell):
 * a hover title and whether to set it in italics as an estimate. Null when
 * the cell needs nothing. Block 9F with no route table says why it is not a
 * picker, since there is nothing to pick.
 */
export function blockValueHintFor(blockId, flightData, strip) {
  if (blockId === '9F' && enumSelectOptionsFor('9F', flightData) == null) {
    return { title: 'no stereo routes configured', estimated: false };
  }
  let title = timeChainTitleFor(blockId, flightData, strip);
  if (!title) return null;
  const resolved = resolveBlockValue(blockId, flightData, strip);
  if (resolved.estimated) title += '\nType it again to accept it as the actual.'; // S-L16 W5
  const behind = typedTimeBehindPlan(blockId, flightData, strip);
  if (behind) {
    title += `\n${formatZuluHhmm(behind.typedUtc)}Z was typed before the proposed departure moved to ${formatZuluHhmm(behind.planUtc)}Z: `
      + 'a typed time does not follow a new P-time. Clear it to follow, or retype it.'; // S-L16 W3
  }
  return { title, estimated: !!resolved.estimated, behindPlan: !!behind };
}

/**
 * The label's hover title for this Block, or null: the FAA block name (BLOCK_TITLES, T8) for the Strip's
 * strip type (`strip.stripType`, else `stripType`, else DEPARTURE). `flightData` adds the lost-comms rule to
 * EXIT ALT; with `strip`, Blocks 6/17/18 on a DEPARTURE add §10.5's source under the name (docs/adr/0073).
 * Without the Strip (the collapsed face's label, which strip-view.js titles with its strip type alone) the
 * source is left off: the value cell carries it.
 */
export function blockTitleFor(blockId, flightData, strip, stripType) {
  const type = (strip && strip.stripType) || stripType || 'DEPARTURE';
  const base = (BLOCK_TITLES[type] && BLOCK_TITLES[type][blockId]) || null;
  if (strip) {
    const chainTitle = timeChainTitleFor(blockId, flightData, strip);
    // The chain's own first line names the time; the FAA name replaces it.
    if (chainTitle) return base ? [base, ...chainTitle.split('\n').slice(1)].join('\n') : chainTitle;
  }
  if (blockId !== '9H-ALT' || !base) return base;
  const advisory = mtrLostCommsAdvisory(flightData);
  return advisory ? `${base}.\n${advisory}` : base;
}
