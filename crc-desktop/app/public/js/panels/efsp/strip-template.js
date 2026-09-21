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
// has to grow wider to fit one.
const DEPARTURE_BLOCK_MAP = {
  '1':  { required: true,  label: 'CALLSIGN', target: { kind: 'fdr', path: 'identity.callsign' } },
  '2':  { required: true,  label: 'REV',      target: { kind: 'system', field: 'rev' } },
  '2A': { required: false, label: 'NOTE',     target: { kind: 'annotation' } },
  '3':  { required: true,  label: 'TYPE',     target: { kind: 'composite' } },
  // docs/adr/0023 gap-closure — see crc-sync's block-map.js's '3A' comment
  // for the full rationale. Plain 'fdr'-routed, like '5A'.
  '3A': { required: false, label: 'ACFT',     target: { kind: 'fdr', path: 'identity.aircraftType' } },
  '3B': { required: false, label: 'WAKE',     target: { kind: 'fdr', path: 'identity.wakeCategory' } },
  '3C': { required: false, label: 'TAIL',     target: { kind: 'fdr', path: 'identity.tailNumber' } },
  '3D': { required: false, label: 'UNIT',     target: { kind: 'fdr', path: 'identity.unit' } },
  '3E': { required: false, label: 'HOME',     target: { kind: 'fdr', path: 'identity.homeStation' } },
  '4':  { required: true,  label: 'CID',      target: { kind: 'system', field: 'cid' } },
  '4A': { required: false, label: 'RMV',      target: { kind: 'flag', flag: 'removeIndicator' } },
  '4B': { required: true,  label: 'DATALINK', target: { kind: 'fdr', path: 'assigned.datalinkClearanceIndicator' } },
  '5':  { required: true,  label: 'SQUAWK',   target: { kind: 'fdr', path: 'identity.beaconAssigned' } },
  // WP4A gap-closure — track-degradation flag. Mirrors crc-sync's
  // block-map.js's '5A' exactly (plain 'fdr'-routed — see that module's
  // comment for why this one needs no dedicated target kind, unlike 24A).
  '5A': { required: false, label: 'DEGR',     target: { kind: 'fdr', path: 'identity.trackDegradationFlag' } },
  '6':  { required: true,  label: 'PROP DEP', target: { kind: 'fdr', path: 'filed.proposedDepartureTimeUtc' } },
  '7':  { required: true,  label: 'ALT',      target: { kind: 'fdr', path: 'filed.requestedAltitude' } },
  '8':  { required: true,  label: 'DEP',      target: { kind: 'fdr', path: 'filed.departureAirport' } },
  '8A': { required: true,  label: 'RWY',      target: { kind: 'fdr', path: 'filed.departureRunway' } },
  '8B': { required: true,  label: 'DEST',     target: { kind: 'fdr', path: 'filed.destinationAirport' } },
  '9':  { required: true,  label: 'RTE',      target: { kind: 'fdr', path: 'filed.route' }, provenance: 'COMPUTER_GENERATED' },
  '9A': { required: false, label: 'RESTR',    target: { kind: 'annotation' } },
  '9B': { required: false, label: 'RESTR',    target: { kind: 'annotation' } },
  '9C': { required: false, label: 'RESTR',    target: { kind: 'annotation' } },
  '9D': { required: true,  label: 'FULL RTE', target: { kind: 'fdr', path: 'filed.fullRouteClearance' } },
  '9E': { required: true,  label: 'RMKS',     target: { kind: 'fdr', path: 'filed.remarks' } },
  // §9.10 stereo route name (docs/adr/0050) — mirrors crc-sync's
  // block-map.js '9F' exactly; see that module's comment for why it is not
  // numbered M18 and why writing it re-files the flight rather than just
  // relabelling it. Ordinary click-to-edit free text, deliberately NOT in
  // ENUM_SELECT_BLOCKS despite being a restricted value set: that table is
  // a static client-side literal and the route table is runtime config, so
  // a picker there would need a dynamic option source it has no shape for.
  // The server refuses a name that is not in the table, and the rejection
  // now carries its detail to the controller.
  '9F': { required: false, label: 'STEREO',   target: { kind: 'fdr', path: 'filed.stereoRouteName' } },
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
  '16': { required: false, label: 'MVMT',     target: { kind: 'fdr', path: 'assigned.movementAreaEntryTimeUtc' } },
  '17': { required: false, label: 'TAXI',     target: { kind: 'fdr', path: 'assigned.taxiTimeUtc' } },
  '18': { required: true,  label: 'TAKEOFF',  target: { kind: 'fdr', path: 'assigned.takeoffTimeUtc' } },
  '19': { required: false, label: 'NOTE',     target: { kind: 'annotation' } },
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
  '20': { required: false, label: 'HDG',      target: { kind: 'annotation' } },
  '21': { required: false, label: 'INIT ALT', target: { kind: 'annotation' } },
  // The guide's own Block 22, "Frequency" — structured rather than a
  // free-text annotation since the RANGE slice, so approving a flight onto
  // an airspace's frequency can write it directly and it validates as one
  // unit and one type (MHz, a number).
  '22': { required: false, label: 'FREQ',     target: { kind: 'frequency' } },
  '23': { required: false, label: 'NOTE',     target: { kind: 'annotation' } },
  '24': { required: true,  label: 'NOTE',     target: { kind: 'annotation' } },
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
  '2A':       { required: false, label: 'NOTE',     target: { kind: 'annotation' } },
  '3':        { required: true,  label: 'TYPE',     target: { kind: 'composite' } },
  '3A':       { required: false, label: 'ACFT',     target: { kind: 'fdr', path: 'identity.aircraftType' } }, // docs/adr/0023 gap-closure — see DEPARTURE_BLOCK_MAP's '3A' comment
  '3B':       { required: false, label: 'WAKE',     target: { kind: 'fdr', path: 'identity.wakeCategory' } },
  '3C':       { required: false, label: 'TAIL',     target: { kind: 'fdr', path: 'identity.tailNumber' } },
  '3D':       { required: false, label: 'UNIT',     target: { kind: 'fdr', path: 'identity.unit' } },
  '3E':       { required: false, label: 'HOME',     target: { kind: 'fdr', path: 'identity.homeStation' } },
  '4':        { required: true,  label: 'CID',      target: { kind: 'system', field: 'cid' } },
  '4A':       { required: false, label: 'RMV',      target: { kind: 'flag', flag: 'removeIndicator' } },
  '4B':       { required: true,  label: 'DATALINK', target: { kind: 'fdr', path: 'assigned.datalinkClearanceIndicator' } },
  '5':        { required: true,  label: 'SQUAWK',   target: { kind: 'fdr', path: 'identity.beaconAssigned' } },
  '5A':       { required: false, label: 'DEGR',     target: { kind: 'fdr', path: 'identity.trackDegradationFlag' } }, // WP4A gap-closure — see DEPARTURE_BLOCK_MAP's '5A' comment
  '6':        { required: true,  label: 'ETA',      target: { kind: 'fdr', path: 'filed.estimatedArrivalTimeUtc' } },
  '7':        { required: true,  label: 'ALT',      target: { kind: 'annotation' } },
  '8':        { required: true,  label: 'ORIG',     target: { kind: 'fdr', path: 'filed.originAirport' } },
  '8A':       { required: false, label: 'FIX',      target: { kind: 'fdr', path: 'filed.arrivalFix' } },
  '8B':       { required: true,  label: 'RWY',      target: { kind: 'fdr', path: 'assigned.landingRunway' } },
  '9':        { required: true,  label: 'RTE',      target: { kind: 'fdr', path: 'filed.route' }, provenance: 'COMPUTER_GENERATED' },
  '9A-FUEL':  { required: true,  label: 'MIN FUEL', target: { kind: 'annotation' } },
  '9A-DEST':  { required: false, label: 'DEST',     target: { kind: 'annotation' } },
  '9A-PTOUT': { required: false, label: 'PT OUT',   target: { kind: 'annotation' } },
  '9A-VECTOR':{ required: false, label: 'VECTOR',   target: { kind: 'annotation' } },
  '9A-SPEED': { required: false, label: 'SPEED',    target: { kind: 'annotation' } },
  '9E':       { required: true,  label: 'RMKS',     target: { kind: 'fdr', path: 'filed.remarks' } },
  '20':       { required: false, label: 'SCRATCH',  target: { kind: 'annotation' } },
  '21':       { required: false, label: 'SCRATCH',  target: { kind: 'annotation' } },
  '24':       { required: true,  label: 'NOTE',     target: { kind: 'annotation' } },
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
  '4':  { required: true,  label: 'CID',      target: { kind: 'system', field: 'cid' } },
  '4A': { required: false, label: 'RMV',      target: { kind: 'flag', flag: 'removeIndicator' } },
  '4B': { required: true,  label: 'DATALINK', target: { kind: 'fdr', path: 'assigned.datalinkClearanceIndicator' } },
  '5':  { required: true,  label: 'SQUAWK',   target: { kind: 'fdr', path: 'identity.beaconAssigned' } },
  '5A': { required: false, label: 'DEGR',     target: { kind: 'fdr', path: 'identity.trackDegradationFlag' } },
  '7':  { required: true,  label: 'ALT',      target: { kind: 'fdr', path: 'filed.requestedAltitude' } },
  // WP6 (crc-sync's docs/adr/0051) — OVERFLIGHT had no Block carrying an ATC
  // course or altitude ASSIGNMENT, only the filed request above, which left
  // §9.2's MARSA interlock unreachable on this one Role. Annotation-routed
  // like ARRIVAL's equivalents, so a transiting flight's clearance history is
  // append-only (§3.7) and confirmVacated works. See the server's copy for the
  // [SOURCE-DEFINED] note on the numbering.
  '7A': { required: false, label: 'ASGN ALT', target: { kind: 'annotation' } },
  '9A-VECTOR': { required: false, label: 'VECTOR', target: { kind: 'annotation' } },
  '8':  { required: true,  label: 'ORIG',     target: { kind: 'fdr', path: 'filed.departureAirport' } },
  '8B': { required: true,  label: 'DEST',     target: { kind: 'fdr', path: 'filed.destinationAirport' } },
  '9':  { required: true,  label: 'RTE',      target: { kind: 'fdr', path: 'filed.route' }, provenance: 'COMPUTER_GENERATED' },
  '9E': { required: true,  label: 'RMKS',     target: { kind: 'fdr', path: 'filed.remarks' } },
  '20': { required: false, label: 'SCRATCH',  target: { kind: 'annotation' } },
  '21': { required: false, label: 'SCRATCH',  target: { kind: 'annotation' } },
  '24': { required: true,  label: 'NOTE',     target: { kind: 'annotation' } },
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
};

const BLOCK_MAPS = { DEPARTURE: DEPARTURE_BLOCK_MAP, ARRIVAL: ARRIVAL_BLOCK_MAP, OVERFLIGHT: OVERFLIGHT_BLOCK_MAP, MISSION: MISSION_BLOCK_MAP };

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

/** The currently-ACTIVE entry's value for an annotation Block, or null if none has ever been set. */
function activeAnnotationValue(strip, blockId) {
  const cell = strip.annotations && strip.annotations[blockId];
  if (!cell) return null;
  const active = cell.entries.find(e => e.status === 'ACTIVE');
  return active ? active.value : null;
}

/** True when this annotation Block currently has an ACTIVE entry — i.e. there's something a confirmVacated action (§3.7 rule 3) could actually strike. Checked by status directly rather than truthiness of activeAnnotationValue(), since an active value could itself be falsy-looking (e.g. "0"). */
function hasActiveAnnotationEntry(strip, blockId) {
  const cell = strip.annotations && strip.annotations[blockId];
  return !!(cell && cell.entries.some(e => e.status === 'ACTIVE'));
}

// Annotation Blocks eligible for the confirmVacated action (guide §3.7 rule
// 3 — "a vacated altitude MUST NOT be struck automatically on assignment...
// implement as an explicit confirmVacated action"). Kept next to the Block
// Map it describes, not as a magic list in bay-view.js's DOM code, and
// role-keyed since eligibility is per-role: DEPARTURE's Block 21 ("Initial
// altitude") vs ARRIVAL's Block 7 (assigned/cleared altitude — the field
// that actually gets a sequence of clearances on a descending arrival).
const CONFIRM_VACATED_ELIGIBLE_BLOCKS = { DEPARTURE: ['21'], ARRIVAL: ['7'] };

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
    const value = fdr ? getPath(fdr, t.path) : null;
    const provenance = (fdr && fdr.provenance && fdr.provenance[t.path]) || def.provenance || 'CONTROLLER_ENTERED';
    return { value: value ?? null, provenance };
  }
  if (t.kind === 'annotation') {
    return { value: activeAnnotationValue(strip, blockId), provenance: 'CONTROLLER_ENTERED' };
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
  // The RANGE slice — Block 22, the frequency this flight has been approved
  // onto. Lives in fdr.comms for the same reason airspace ownership lives in
  // fdr.airspace: a dedicated setter, not a generic writable path.
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
};

/** @returns {string[]|null} the option values for this Block if it's an enum-select Block, else null. */
function enumSelectOptionsFor(blockId) {
  return ENUM_SELECT_BLOCKS[blockId] || null;
}

// WP4A second slice — Blocks edited via a click-to-toggle boolean
// affordance (bay-view.js), reusing the existing ✓/blank rendering
// convention rather than a 2-option <select> — the counterpart to
// ENUM_SELECT_BLOCKS for a restricted-VALUE-SET field that happens to have
// exactly two values already spelled `true`/`false`, not a string enum.
const BOOLEAN_TOGGLE_BLOCKS = new Set(['IFR']);

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
  // 'frequency' joins the editable kinds: unlike airspace-owner/tofi, which
  // are restricted enums with their own <select>, a frequency is a free
  // numeric entry — the ordinary click-to-edit path is right for it. The
  // server validates the band.
  return !!def && (def.target.kind === 'fdr' || def.target.kind === 'annotation' || def.target.kind === 'frequency');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEPARTURE_BLOCK_MAP, ARRIVAL_BLOCK_MAP, OVERFLIGHT_BLOCK_MAP, MISSION_BLOCK_MAP, BLOCK_MAPS, resolveBlockValue, requiredBlocksFor, formatBlock3,
    activeAnnotationValue, hasActiveAnnotationEntry, isBlockEditable, CONFIRM_VACATED_ELIGIBLE_BLOCKS,
    enumSelectOptionsFor, isBooleanToggleBlock, blockLabelFor,
  };
}
