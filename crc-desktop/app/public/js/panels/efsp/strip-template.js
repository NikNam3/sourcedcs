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

const DEPARTURE_BLOCK_MAP = {
  '1':  { required: true,  target: { kind: 'fdr', path: 'identity.callsign' } },
  '2':  { required: true,  target: { kind: 'system', field: 'rev' } },
  '2A': { required: false, target: { kind: 'annotation' } },
  '3':  { required: true,  target: { kind: 'composite' } },
  '4':  { required: true,  target: { kind: 'system', field: 'cid' } },
  '4A': { required: false, target: { kind: 'flag', flag: 'removeIndicator' } },
  '4B': { required: true,  target: { kind: 'fdr', path: 'assigned.datalinkClearanceIndicator' } },
  '5':  { required: true,  target: { kind: 'fdr', path: 'identity.beaconAssigned' } },
  '6':  { required: true,  target: { kind: 'fdr', path: 'filed.proposedDepartureTimeUtc' } },
  '7':  { required: true,  target: { kind: 'fdr', path: 'filed.requestedAltitude' } },
  '8':  { required: true,  target: { kind: 'fdr', path: 'filed.departureAirport' } },
  '8A': { required: true,  target: { kind: 'fdr', path: 'filed.departureRunway' } },
  '8B': { required: true,  target: { kind: 'fdr', path: 'filed.destinationAirport' } },
  '9':  { required: true,  target: { kind: 'fdr', path: 'filed.route' }, provenance: 'COMPUTER_GENERATED' },
  '9A': { required: false, target: { kind: 'annotation' } },
  '9B': { required: false, target: { kind: 'annotation' } },
  '9C': { required: false, target: { kind: 'annotation' } },
  '9D': { required: true,  target: { kind: 'fdr', path: 'filed.fullRouteClearance' } },
  '9E': { required: true,  target: { kind: 'fdr', path: 'filed.remarks' } },
  '10': { required: true,  target: { kind: 'fdr', path: 'assigned.atisCode' } },
  '11': { required: true,  target: { kind: 'annotation' } },
  '14': { required: true,  target: { kind: 'fdr', path: 'assigned.releaseTimeUtc' } },
  // WP4A (docs/adr/0017), §4.6.2 — mirrors crc-sync's block-map.js exactly.
  '14B': { required: false, target: { kind: 'fdr', path: 'assigned.edctTimeUtc' } },
  '14C': { required: false, target: { kind: 'fdr', path: 'assigned.callForReleaseTimeUtc' } },
  '16': { required: false, target: { kind: 'fdr', path: 'assigned.movementAreaEntryTimeUtc' } },
  '17': { required: false, target: { kind: 'fdr', path: 'assigned.taxiTimeUtc' } },
  '18': { required: true,  target: { kind: 'fdr', path: 'assigned.takeoffTimeUtc' } },
  '19': { required: false, target: { kind: 'annotation' } },
  '20': { required: false, target: { kind: 'annotation' } },
  '21': { required: false, target: { kind: 'annotation' } },
  '22': { required: false, target: { kind: 'annotation' } },
  '23': { required: false, target: { kind: 'annotation' } },
  '24': { required: true,  target: { kind: 'annotation' } },
  // WP4A (docs/adr/0018), §4.6.4 — airspace ownership as a direction. Not
  // fdr/annotation-routed on either side (see efsp-block-map-parity.test.js's
  // isWritableKind) — read-only display here, since no client UI writes it
  // this slice (server-only, via a future dedicated control, not SetBlock).
  '24A': { required: false, target: { kind: 'airspace-owner' } },
  '25': { required: true,  target: { kind: 'system', field: 'state' } },
  '26': { required: true,  target: { kind: 'nla' } },
};

// [SOURCE-DEFINED] Arrival Block Map (Phase 2, docs/adr/0008) — client
// mirror of crc-sync's ARRIVAL_BLOCK_MAP; see that module's header comment
// for the full design rationale (why Block 7 is annotation-routed, the
// 9A-* split, the 20/21 scratchpad simplification). Kept in sync by
// efsp-block-map-parity.test.js, same as DEPARTURE_BLOCK_MAP.
const ARRIVAL_BLOCK_MAP = {
  '1':        { required: true,  target: { kind: 'fdr', path: 'identity.callsign' } },
  '2':        { required: true,  target: { kind: 'system', field: 'rev' } },
  '2A':       { required: false, target: { kind: 'annotation' } },
  '3':        { required: true,  target: { kind: 'composite' } },
  '4':        { required: true,  target: { kind: 'system', field: 'cid' } },
  '4A':       { required: false, target: { kind: 'flag', flag: 'removeIndicator' } },
  '4B':       { required: true,  target: { kind: 'fdr', path: 'assigned.datalinkClearanceIndicator' } },
  '5':        { required: true,  target: { kind: 'fdr', path: 'identity.beaconAssigned' } },
  '6':        { required: true,  target: { kind: 'fdr', path: 'filed.estimatedArrivalTimeUtc' } },
  '7':        { required: true,  target: { kind: 'annotation' } },
  '8':        { required: true,  target: { kind: 'fdr', path: 'filed.originAirport' } },
  '8A':       { required: false, target: { kind: 'fdr', path: 'filed.arrivalFix' } },
  '8B':       { required: true,  target: { kind: 'fdr', path: 'assigned.landingRunway' } },
  '9':        { required: true,  target: { kind: 'fdr', path: 'filed.route' }, provenance: 'COMPUTER_GENERATED' },
  '9A-FUEL':  { required: true,  target: { kind: 'annotation' } },
  '9A-DEST':  { required: false, target: { kind: 'annotation' } },
  '9A-PTOUT': { required: false, target: { kind: 'annotation' } },
  '9A-VECTOR':{ required: false, target: { kind: 'annotation' } },
  '9A-SPEED': { required: false, target: { kind: 'annotation' } },
  '9E':       { required: true,  target: { kind: 'fdr', path: 'filed.remarks' } },
  '20':       { required: false, target: { kind: 'annotation' } },
  '21':       { required: false, target: { kind: 'annotation' } },
  '24':       { required: true,  target: { kind: 'annotation' } },
  '24A':      { required: false, target: { kind: 'airspace-owner' } }, // WP4A, §4.6.4 — see DEPARTURE_BLOCK_MAP's '24A' comment
  '25':       { required: true,  target: { kind: 'system', field: 'state' } },
  '26':       { required: true,  target: { kind: 'nla' } },
};

const BLOCK_MAPS = { DEPARTURE: DEPARTURE_BLOCK_MAP, ARRIVAL: ARRIVAL_BLOCK_MAP };

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
  return { value: null, provenance: 'SYSTEM_DERIVED' };
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
  return !!def && (def.target.kind === 'fdr' || def.target.kind === 'annotation');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEPARTURE_BLOCK_MAP, ARRIVAL_BLOCK_MAP, BLOCK_MAPS, resolveBlockValue, requiredBlocksFor, formatBlock3,
    activeAnnotationValue, hasActiveAnnotationEntry, isBlockEditable, CONFIRM_VACATED_ELIGIBLE_BLOCKS,
  };
}
