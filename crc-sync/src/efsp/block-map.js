'use strict';

// The Block Maps as data, per Strip Role (EFSPImplementationGuide.md §6.2,
// §6.3, §6.5) — "the Block Map MUST be data, not code." This is the
// server-side copy: binds each Block ID to either an FDR field path or a
// Strip annotation cell, and records which Blocks are ✱-required. The
// client keeps an identical copy (strip-template.js) for rendering — kept
// in sync by a shared binding-table fixture used by both sides' test
// suites (efsp-block-map-parity.test.js), NOT by import: crc-sync and
// crc-desktop are separately deployed packages with separate build/Docker
// contexts (the same reason src/auth.js is duplicated across services
// rather than shared, per its own header comment).
//
// Optional/deferred Blocks (2A, 4A, 9A-9C, 16, 17, 19-23) are present here
// but marked required:false, per the guide's §12 rule: "each deferral MUST
// leave its schema fields present and unpopulated rather than absent."
//
// Blocks 2 (revision), 4 (cid), 25 (state) and 26 (NLA) are system-derived
// — not writable through the generic SetBlock path at all (board-store.js
// manages rev/cid/state directly; NLA is computed, never stored). Block 3
// is a read-only composite render of several identity fields at once, and
// Block 4A is a flag (strip.flags.removeIndicator), not a SetBlock target
// in Phase 1 (DropStrip sets it directly). resolveBlockTarget() returns
// null for all of these, matching board-store.js's "unknown blockId is a
// VALIDATION_ERROR" behavior for anything not fdr/annotation-routed.

const DEPARTURE_BLOCK_MAP = {
  '1':  { required: true,  target: { kind: 'fdr', path: 'identity.callsign' } },
  '2':  { required: true,  target: { kind: 'system' } },
  '2A': { required: false, target: { kind: 'annotation' } },
  '3':  { required: true,  target: { kind: 'composite' } },
  '4':  { required: true,  target: { kind: 'system' } },
  '4A': { required: false, target: { kind: 'flag' } },
  '4B': { required: true,  target: { kind: 'fdr', path: 'assigned.datalinkClearanceIndicator' } },
  '5':  { required: true,  target: { kind: 'fdr', path: 'identity.beaconAssigned' } },
  '6':  { required: true,  target: { kind: 'fdr', path: 'filed.proposedDepartureTimeUtc' } },
  '7':  { required: true,  target: { kind: 'fdr', path: 'filed.requestedAltitude' } },
  '8':  { required: true,  target: { kind: 'fdr', path: 'filed.departureAirport' } },
  '8A': { required: true,  target: { kind: 'fdr', path: 'filed.departureRunway' } },
  '8B': { required: true,  target: { kind: 'fdr', path: 'filed.destinationAirport' } },
  '9':  { required: true,  target: { kind: 'fdr', path: 'filed.route' }, provenance: 'COMPUTER_GENERATED' }, // manual restrictions live separately in annotations['9'] — guide's "mixed provenance in one Block" note; rendered as two sources, one Block. provenance is the pre-edit fallback (fdr-store.js's setField() overrides fdr.provenance['filed.route'] to CONTROLLER_ENTERED once a controller actually edits it — this default only applies until then).
  '9A': { required: false, target: { kind: 'annotation' } },
  '9B': { required: false, target: { kind: 'annotation' } },
  '9C': { required: false, target: { kind: 'annotation' } },
  '9D': { required: true,  target: { kind: 'fdr', path: 'filed.fullRouteClearance' } },
  '9E': { required: true,  target: { kind: 'fdr', path: 'filed.remarks' } },
  '10': { required: true,  target: { kind: 'fdr', path: 'assigned.atisCode' } },
  '11': { required: true,  target: { kind: 'annotation' } },
  '14': { required: true,  target: { kind: 'fdr', path: 'assigned.releaseTimeUtc' } },
  // WP4A (docs/adr/0017), §4.6.2's release-across-the-boundary additions —
  // independently optional sub-fields, same doctrinal shape as ADR 0008's
  // 9A-* split (each omittable per facility with no new validator logic).
  '14B': { required: false, target: { kind: 'fdr', path: 'assigned.edctTimeUtc' } },
  '14C': { required: false, target: { kind: 'fdr', path: 'assigned.callForReleaseTimeUtc' } },
  '16': { required: false, target: { kind: 'fdr', path: 'assigned.movementAreaEntryTimeUtc' } }, // metering deferred, §12
  '17': { required: false, target: { kind: 'fdr', path: 'assigned.taxiTimeUtc' } },
  '18': { required: true,  target: { kind: 'fdr', path: 'assigned.takeoffTimeUtc' } },
  '19': { required: false, target: { kind: 'annotation' } },
  '20': { required: false, target: { kind: 'annotation' } },
  '21': { required: false, target: { kind: 'annotation' } },
  '22': { required: false, target: { kind: 'annotation' } },
  '23': { required: false, target: { kind: 'annotation' } },
  '24': { required: true,  target: { kind: 'annotation' } },
  // WP4A (docs/adr/0018), §4.6.4 — airspace ownership as a direction. A
  // dedicated target kind, not 'fdr'/'annotation' — see resolveBlockTarget
  // below and fdr-store.js's setAirspaceOwner() for why this can't be a
  // generic FDR path (the "no boolean path" requirement needs a
  // structurally distinct route, not just a documented convention).
  '24A': { required: false, target: { kind: 'airspace-owner' } },
  '25': { required: true,  target: { kind: 'system' } },
  '26': { required: true,  target: { kind: 'system' } },
};

// [SOURCE-DEFINED] Arrival Block Map (Phase 2, docs/adr/0008) — the real
// FAA Arrival strip layout (guide §6.3, `[Annex §2.2]`) isn't in this repo,
// so this mirrors DEPARTURE_BLOCK_MAP's structural pattern (§6.5's own
// instruction) rather than transcribing sourced doctrine. Per §0.2
// discipline: this is labelled SOURCE-DEFINED here and MUST NOT be
// presented as real FAA numbering in UI text or documentation.
//
// Block 7 (assigned/cleared altitude) is annotation-routed, not fdr-routed
// — unlike DEPARTURE's Block 7 — specifically so it carries the append-only
// + confirmVacated model (§3.7 rule 3): a descending arrival's sequence of
// altitude clearances is exactly where "don't strike a vacated altitude
// until confirmed" matters operationally.
//
// The 9A-* sub-fields are guide §6.3 note 1's doctrinal split: minimum
// fuel is required and MUST survive any facility narrowing (enforced by
// validateFacilityConfig below); destination/point-out/vector/speed are
// each independently optional. Modelled as separate annotation-routed
// Blocks (not one opaque composite) specifically so blockVisibility can
// enforce that split per-Block, with no new validator logic needed.
//
// Blocks 20/21 are the guide's arrival radar-automation scratchpads
// (§6.3 note 2 — "bind to the CRC track scratchpads, not Strip-local
// storage" in the real system). WP5 track correlation isn't built yet
// (strip.correlation stays inert), so these are Strip-local annotations
// for now, same as DEPARTURE's — a documented Phase 2 simplification, to
// be revisited once WP5 lands, not a silent doctrine violation.
//
// Deliberately NOT carried over from DEPARTURE: Blocks 11/14/16/17/18
// (APREQ, release/movement/taxi/takeoff times) are departure-specific
// clearance-delivery concepts with no arrival equivalent.
const ARRIVAL_BLOCK_MAP = {
  '1':        { required: true,  target: { kind: 'fdr', path: 'identity.callsign' } },
  '2':        { required: true,  target: { kind: 'system' } },
  '2A':       { required: false, target: { kind: 'annotation' } },
  '3':        { required: true,  target: { kind: 'composite' } },
  '4':        { required: true,  target: { kind: 'system' } },
  '4A':       { required: false, target: { kind: 'flag' } },
  '4B':       { required: true,  target: { kind: 'fdr', path: 'assigned.datalinkClearanceIndicator' } },
  '5':        { required: true,  target: { kind: 'fdr', path: 'identity.beaconAssigned' } },
  '6':        { required: true,  target: { kind: 'fdr', path: 'filed.estimatedArrivalTimeUtc' } },
  '7':        { required: true,  target: { kind: 'annotation' } }, // assigned/cleared altitude — confirmVacated-eligible, see module comment
  '8':        { required: true,  target: { kind: 'fdr', path: 'filed.originAirport' } },
  '8A':       { required: false, target: { kind: 'fdr', path: 'filed.arrivalFix' } },
  '8B':       { required: true,  target: { kind: 'fdr', path: 'assigned.landingRunway' } },
  '9':        { required: true,  target: { kind: 'fdr', path: 'filed.route' }, provenance: 'COMPUTER_GENERATED' },
  '9A-FUEL':  { required: true,  target: { kind: 'annotation' } }, // minimum fuel — the doctrinal exception, guide §6.3 note 1
  '9A-DEST':  { required: false, target: { kind: 'annotation' } },
  '9A-PTOUT': { required: false, target: { kind: 'annotation' } },
  '9A-VECTOR':{ required: false, target: { kind: 'annotation' } },
  '9A-SPEED': { required: false, target: { kind: 'annotation' } },
  '9E':       { required: true,  target: { kind: 'fdr', path: 'filed.remarks' } },
  '20':       { required: false, target: { kind: 'annotation' } }, // radar scratchpad — Strip-local until WP5, see module comment
  '21':       { required: false, target: { kind: 'annotation' } }, // radar scratchpad — Strip-local until WP5, see module comment
  '24':       { required: true,  target: { kind: 'annotation' } },
  '24A':      { required: false, target: { kind: 'airspace-owner' } }, // WP4A, §4.6.4 — see DEPARTURE_BLOCK_MAP's '24A' comment
  '25':       { required: true,  target: { kind: 'system' } },
  '26':       { required: true,  target: { kind: 'system' } },
};

const BLOCK_MAPS = { DEPARTURE: DEPARTURE_BLOCK_MAP, ARRIVAL: ARRIVAL_BLOCK_MAP };

/** Every Strip Role this facility's Block Map data actually defines — board-store.js's CreateStrip validation calls this so an unknown role is a VALIDATION_ERROR, not a silent fallback. */
function isValidRole(role) {
  return Object.prototype.hasOwnProperty.call(BLOCK_MAPS, role);
}

function requiredBlocksFor(role) {
  const map = BLOCK_MAPS[role];
  if (!map) return [];
  return Object.entries(map).filter(([, def]) => def.required).map(([id]) => id);
}

/**
 * Resolves a Block ID to a SetBlock routing target for board-store.js's
 * applyMutation(): { kind:'fdr', path } for an FDR field, { kind:
 * 'annotation' } for a Strip annotation cell, or null for anything not
 * writable through the generic SetBlock path (system/composite/flag
 * Blocks, or an unknown Block ID / role).
 */
function resolveBlockTarget(role, blockId) {
  const map = BLOCK_MAPS[role];
  const def = map && map[blockId];
  if (!def) return null;
  if (def.target.kind === 'fdr') return { kind: 'fdr', path: def.target.path };
  if (def.target.kind === 'annotation') return { kind: 'annotation' };
  // WP4A (docs/adr/0018) — routed through fdr-store.js's dedicated
  // setAirspaceOwner(), never the generic 'fdr' path above (see that
  // method's own comment for why this needs to be structurally distinct).
  if (def.target.kind === 'airspace-owner') return { kind: 'airspace-owner' };
  return null;
}

/**
 * Validates a facility's Block Map configuration (guide §8.3): every ✱
 * Block for the role MUST be present and visible. This is genuinely how
 * §8.3's arrival-specific "9A must retain minimum fuel" exception is
 * enforced now that ARRIVAL_BLOCK_MAP models minimum fuel as its own
 * required Block ('9A-FUEL') — no role-specific exception logic needed
 * here beyond the existing required-Block check.
 *
 * @param {{role:string, visibleBlocks:string[]}} config
 */
function validateFacilityConfig(config) {
  const required = requiredBlocksFor(config.role);
  const visible = new Set(config.visibleBlocks || []);
  const missing = required.filter(id => !visible.has(id));
  if (missing.length > 0) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `missing required Blocks: ${missing.join(', ')}` };
  }
  return { ok: true };
}

module.exports = {
  DEPARTURE_BLOCK_MAP, ARRIVAL_BLOCK_MAP, BLOCK_MAPS,
  isValidRole, requiredBlocksFor, resolveBlockTarget, validateFacilityConfig,
};
