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
  // docs/adr/0023 gap-closure — Block 3 only ever DISPLAYED these as a
  // read-only composite (formatBlock3, client-side); identity.aircraftType/
  // wakeCategory/tailNumber/unit/homeStation were already validated and
  // writable via fdr-store.js's generic setField() (all five in
  // WRITABLE_PATHS since Phase 1), but no Block anywhere ever routed a
  // SetBlock at any of them — found live when a same-flight identity copy
  // (bay-view.js's "Spawn Return Strip") had nothing to actually copy.
  // Grouped near '3' as SOURCE-DEFINED sub-fields, same numbering
  // convention '9A-FUEL' etc. already use.
  '3A': { required: false, target: { kind: 'fdr', path: 'identity.aircraftType' } },
  '3B': { required: false, target: { kind: 'fdr', path: 'identity.wakeCategory' } },
  '3C': { required: false, target: { kind: 'fdr', path: 'identity.tailNumber' } },
  '3D': { required: false, target: { kind: 'fdr', path: 'identity.unit' } },
  '3E': { required: false, target: { kind: 'fdr', path: 'identity.homeStation' } },
  '4':  { required: true,  target: { kind: 'system' } },
  '4A': { required: false, target: { kind: 'flag' } },
  '4B': { required: true,  target: { kind: 'fdr', path: 'assigned.datalinkClearanceIndicator' } },
  '5':  { required: true,  target: { kind: 'fdr', path: 'identity.beaconAssigned' } },
  // WP4A gap-closure (docs/adr/0022), guide §4.6 rule 5 — track-degradation
  // flag. Plain 'fdr'-routed, unlike '24A': fdr-store.js's
  // identity.trackDegradationFlag was already in WRITABLE_PATHS and
  // validated inline by setField() since docs/adr/0019 — the gap this
  // closes was purely the missing Block Map entry (no SetBlock path ever
  // reached that already-working validation), not a missing setter.
  '5A': { required: false, target: { kind: 'fdr', path: 'identity.trackDegradationFlag' } },
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
  // §9.10 stereo route name (docs/adr/0050). The guide numbers this Block
  // M18 in its §6.4 military-extension table (whose "Basis" column cites
  // §9.9, ATO ingest — that is a mis-citation in the guide; §9.10 is the
  // right section). It is NOT numbered M18 here, for two reasons: the
  // M-prefix namespace belongs to MISSION_BLOCK_MAP, which docs/adr/0026
  // froze with its own meanings (its M4 is the beacon, the guide's M4 is IFF
  // Mode 1/2), and MISSION is the one Role that never files a stereo. '9F'
  // instead, because sub-lettering a field onto its parent Block is this
  // codebase's actual convention ('3A'-'3E', '8A'/'8B', '9A'-'9E', '5A',
  // '14A'-'14D'), and a stereo route name IS Block 9's route, named.
  //
  // Plain 'fdr'-routed, like '5A' and unlike '24A' — writing it IS how a
  // controller re-files a live flight onto another stereo ("VIPER11 request
  // change to PACK 2"). It shipped as its own read-only kind; that made the
  // switch case reachable only by hand-editing the route (losing the label
  // and the standing-release match) or by dropping and re-creating the Strip
  // (a new beacon code mid-taxi). fdr-store.js's setField() validates the
  // name against the table and re-expands the route from it, so the name and
  // the route cannot disagree — the same inline-validation precedent
  // identity.trackDegradationFlag set, not a weaker guard than the read-only
  // kind was.
  '9F': { required: false, target: { kind: 'fdr', path: 'filed.stereoRouteName' } },
  '10': { required: true,  target: { kind: 'fdr', path: 'assigned.atisCode' } },
  '11': { required: true,  target: { kind: 'annotation' } },
  '14': { required: true,  target: { kind: 'fdr', path: 'assigned.releaseTimeUtc' } },
  // WP4A (docs/adr/0017), §4.6.2's release-across-the-boundary additions —
  // independently optional sub-fields, same doctrinal shape as ADR 0008's
  // 9A-* split (each omittable per facility with no new validator logic).
  // The release STATE itself, and the void time the 30-minute deadline is
  // derived from. Both were reachable only from a test until now: §3.8's
  // whole release model gated the NLA and validated server-side, but no
  // Block routed to `assigned.releaseState` or `assigned.voidTimeUtc`, so a
  // controller could not put a flight on hold, or set a void time, at all —
  // which also made WP4's own "void-time expiry raises an alert" criterion
  // unexercisable in the real panel. Found by walking a release sortie.
  //
  // Numbered in the 14-family rather than taking the guide's unused 15: 14B
  // and 14C are already local extensions of the same release cluster
  // (docs/adr/0017), and a bare `15` would look like a guide Block it is not.
  '14A': { required: false, target: { kind: 'fdr', path: 'assigned.releaseState' } },
  '14D': { required: false, target: { kind: 'fdr', path: 'assigned.voidTimeUtc' } },
  '14B': { required: false, target: { kind: 'fdr', path: 'assigned.edctTimeUtc' } },
  '14C': { required: false, target: { kind: 'fdr', path: 'assigned.callForReleaseTimeUtc' } },
  '16': { required: false, target: { kind: 'fdr', path: 'assigned.movementAreaEntryTimeUtc' } }, // metering deferred, §12
  '17': { required: false, target: { kind: 'fdr', path: 'assigned.taxiTimeUtc' } },
  '18': { required: true,  target: { kind: 'fdr', path: 'assigned.takeoffTimeUtc' } },
  '19': { required: false, target: { kind: 'annotation' } },
  '20': { required: false, target: { kind: 'annotation' } },
  '21': { required: false, target: { kind: 'annotation' } },
  // Guide's own Block 22, "Frequency" — listed in §6.2 with an entirely
  // empty notes column. Structured rather than a free-text annotation so a
  // frequency can be validated as one unit and one type, and so approving a
  // flight onto an airspace's working frequency can write it directly.
  // Dedicated target kind for the same reason 24A has one.
  '22': { required: false, target: { kind: 'frequency' } },
  '23': { required: false, target: { kind: 'annotation' } },
  '24': { required: true,  target: { kind: 'annotation' } },
  // WP4A (docs/adr/0018), §4.6.4 — airspace ownership as a direction. A
  // dedicated target kind, not 'fdr'/'annotation' — see resolveBlockTarget
  // below and fdr-store.js's setAirspaceOwner() for why this can't be a
  // generic FDR path (the "no boolean path" requirement needs a
  // structurally distinct route, not just a documented convention).
  '24A': { required: false, target: { kind: 'airspace-owner' } },
  // WP4A second slice (docs/adr/0025), §4.6.3 — the three-field separation
  // model. Dedicated 'tofi' target kind, not 'fdr' — see fdr-store.js's
  // setTofi() for why (mirrors '24A''s own airspace-owner precedent: "no
  // boolean path" needs a structurally distinct route, not just a
  // documented convention). Applies to any ATC-side role a flight can
  // enter tactically-controlled airspace while working — not MISSION
  // itself, which is the MRU-side record built from a different Block Map
  // entirely (see MISSION_BLOCK_MAP below).
  'IFR':  { required: false, target: { kind: 'tofi', field: 'ifrActive' } },
  'RSVC': { required: false, target: { kind: 'tofi', field: 'radarService' } },
  'SREG': { required: false, target: { kind: 'tofi', field: 'separationRegime' } },
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
// storage" in the real system). They are Strip-local annotations, same as
// DEPARTURE's, and WP5 settled that they stay that way (docs/adr/0047).
// This track domain has no per-track scratchpad to bind to — collab-store.js
// carries iff/rename/trackNumber and nothing else — so binding would mean
// inventing a shared per-track free-text store with its own conflict,
// retention and cap semantics for two Blocks. And a track-hosted scratchpad
// would VANISH on a DCS re-ID, which is strictly worse than Strip-local for a
// field a controller typed by hand. The guide's instinct assumes a radar
// system with real track scratchpads; this one has none.
//
// Deliberately NOT carried over from DEPARTURE: Blocks 11/14/16/17/18
// (APREQ, release/movement/taxi/takeoff times) are departure-specific
// clearance-delivery concepts with no arrival equivalent.
const ARRIVAL_BLOCK_MAP = {
  '1':        { required: true,  target: { kind: 'fdr', path: 'identity.callsign' } },
  '2':        { required: true,  target: { kind: 'system' } },
  '2A':       { required: false, target: { kind: 'annotation' } },
  '3':        { required: true,  target: { kind: 'composite' } },
  '3A':       { required: false, target: { kind: 'fdr', path: 'identity.aircraftType' } }, // docs/adr/0023 gap-closure — see DEPARTURE_BLOCK_MAP's '3A' comment
  '3B':       { required: false, target: { kind: 'fdr', path: 'identity.wakeCategory' } },
  '3C':       { required: false, target: { kind: 'fdr', path: 'identity.tailNumber' } },
  '3D':       { required: false, target: { kind: 'fdr', path: 'identity.unit' } },
  '3E':       { required: false, target: { kind: 'fdr', path: 'identity.homeStation' } },
  '4':        { required: true,  target: { kind: 'system' } },
  '4A':       { required: false, target: { kind: 'flag' } },
  '4B':       { required: true,  target: { kind: 'fdr', path: 'assigned.datalinkClearanceIndicator' } },
  '5':        { required: true,  target: { kind: 'fdr', path: 'identity.beaconAssigned' } },
  '5A':       { required: false, target: { kind: 'fdr', path: 'identity.trackDegradationFlag' } }, // WP4A gap-closure, §4.6 rule 5 — see DEPARTURE_BLOCK_MAP's '5A' comment
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
  'IFR':      { required: false, target: { kind: 'tofi', field: 'ifrActive' } },       // WP4A second slice, §4.6.3 — see DEPARTURE_BLOCK_MAP's comment
  'RSVC':     { required: false, target: { kind: 'tofi', field: 'radarService' } },
  'SREG':     { required: false, target: { kind: 'tofi', field: 'separationRegime' } },
  '25':       { required: true,  target: { kind: 'system' } },
  '26':       { required: true,  target: { kind: 'system' } },
  // Block 22 (Frequency) on the airborne roles too — the RANGE slice. A
  // flight is approved onto an airspace's frequency while it is enroute,
  // which is exactly when its Strip is an ARRIVAL or an OVERFLIGHT, so a
  // DEPARTURE-only Block would have been invisible precisely when it matters.
  '22': { required: false, target: { kind: 'frequency' } },
};

// [SOURCE-DEFINED] Overflight Block Map (docs/adr/0023) — a flight
// transiting this Facility's airspace without landing or departing here at
// all (guide §2's Strip Role list; §6.3's only Overflight-specific note is
// that it shares Blocks 20/21's radar scratchpads with ARRIVAL — no fuller
// field table is published anywhere in the guide, so per §0.2 discipline
// this mirrors ARRIVAL_BLOCK_MAP's general shape rather than transcribing
// doctrine that doesn't exist). Reuses existing generic FDR paths instead
// of adding new ones: '8'/'8B' (departureAirport/destinationAirport) here
// mean the flight's REAL origin/destination — never Incirlik, since an
// overflight strip only exists at all because it isn't landing or
// departing there. No ground/runway/taxi Blocks (8A, 14, 16-18) — this
// flight never touches Incirlik's ground.
const OVERFLIGHT_BLOCK_MAP = {
  '1':  { required: true,  target: { kind: 'fdr', path: 'identity.callsign' } },
  '2':  { required: true,  target: { kind: 'system' } },
  '3':  { required: true,  target: { kind: 'composite' } },
  '3A': { required: false, target: { kind: 'fdr', path: 'identity.aircraftType' } }, // docs/adr/0023 gap-closure — see DEPARTURE_BLOCK_MAP's '3A' comment
  '3B': { required: false, target: { kind: 'fdr', path: 'identity.wakeCategory' } },
  '3C': { required: false, target: { kind: 'fdr', path: 'identity.tailNumber' } },
  '3D': { required: false, target: { kind: 'fdr', path: 'identity.unit' } },
  '3E': { required: false, target: { kind: 'fdr', path: 'identity.homeStation' } },
  '4':  { required: true,  target: { kind: 'system' } },
  '4A': { required: false, target: { kind: 'flag' } },
  '4B': { required: true,  target: { kind: 'fdr', path: 'assigned.datalinkClearanceIndicator' } },
  '5':  { required: true,  target: { kind: 'fdr', path: 'identity.beaconAssigned' } },
  '5A': { required: false, target: { kind: 'fdr', path: 'identity.trackDegradationFlag' } }, // WP4A gap-closure, §4.6 rule 5 — see DEPARTURE_BLOCK_MAP's '5A' comment
  '7':  { required: true,  target: { kind: 'fdr', path: 'filed.requestedAltitude' } },
  '8':  { required: true,  target: { kind: 'fdr', path: 'filed.departureAirport' } },  // the flight's real origin, not Incirlik
  '8B': { required: true,  target: { kind: 'fdr', path: 'filed.destinationAirport' } }, // the flight's real destination, not Incirlik
  '9':  { required: true,  target: { kind: 'fdr', path: 'filed.route' }, provenance: 'COMPUTER_GENERATED' },
  '9E': { required: true,  target: { kind: 'fdr', path: 'filed.remarks' } },
  '20': { required: false, target: { kind: 'annotation' } }, // radar scratchpad — Strip-local until WP5, see ARRIVAL_BLOCK_MAP's comment
  '21': { required: false, target: { kind: 'annotation' } }, // radar scratchpad — Strip-local until WP5, see ARRIVAL_BLOCK_MAP's comment
  '24': { required: true,  target: { kind: 'annotation' } },
  '24A':{ required: false, target: { kind: 'airspace-owner' } }, // WP4A, §4.6.4 — see DEPARTURE_BLOCK_MAP's '24A' comment
  'IFR':  { required: false, target: { kind: 'tofi', field: 'ifrActive' } },       // WP4A second slice, §4.6.3 — see DEPARTURE_BLOCK_MAP's comment
  'RSVC': { required: false, target: { kind: 'tofi', field: 'radarService' } },
  'SREG': { required: false, target: { kind: 'tofi', field: 'separationRegime' } },
  '25': { required: true,  target: { kind: 'system' } },
  '26': { required: true,  target: { kind: 'system' } },
  // Block 22 (Frequency) on the airborne roles too — the RANGE slice. A
  // flight is approved onto an airspace's frequency while it is enroute,
  // which is exactly when its Strip is an ARRIVAL or an OVERFLIGHT, so a
  // DEPARTURE-only Block would have been invisible precisely when it matters.
  '22': { required: false, target: { kind: 'frequency' } },
};

// [SOURCE-DEFINED] WP4A second slice (docs/adr/0026) — the MISSION Strip
// Role's Block Map, drawn from the guide's own "military extension
// namespace" instruction (§9.8), NOT a DEPARTURE/ARRIVAL field-reuse the
// way OVERFLIGHT's was (docs/adr/0023) — a mission line is keyed by
// mission number/package ID, not callsign/beacon, per the guide's own
// ATC-Strip-vs-mission-line comparison table (§9.8). Deliberately minimal:
// mission number, package ID, callsign, beacon (the guide's own "bridge
// field" joining a mission line to an ATC Strip's Mode 3/A), controlling
// agency, and a basic vul/on-station window. Full ATO-driven mission-line
// richness (Mode 1/2/datalink code, MARSA, ordnance, ROZ/ACM, the AR-line/
// tanker join, ATO ingest) is explicitly deferred to WP6/WP7 — see the
// scope-cut ADR this Block Map ships with.
const MISSION_BLOCK_MAP = {
  'M1': { required: true,  target: { kind: 'fdr', path: 'mission.missionNumber' } },
  'M2': { required: false, target: { kind: 'fdr', path: 'mission.packageId' } },
  'M3': { required: true,  target: { kind: 'fdr', path: 'identity.callsign' } },
  'M4': { required: true,  target: { kind: 'fdr', path: 'identity.beaconAssigned' } },
  'M5': { required: false, target: { kind: 'fdr', path: 'mission.controllingAgency' } },
  'M6': { required: false, target: { kind: 'fdr', path: 'mission.vulWindowStartUtc' } },
  'M7': { required: false, target: { kind: 'fdr', path: 'mission.vulWindowEndUtc' } },
  'M8': { required: false, target: { kind: 'fdr', path: 'filed.remarks' } },
  'M25': { required: true, target: { kind: 'system' } },
  'M26': { required: true, target: { kind: 'system' } },
};

const BLOCK_MAPS = { DEPARTURE: DEPARTURE_BLOCK_MAP, ARRIVAL: ARRIVAL_BLOCK_MAP, OVERFLIGHT: OVERFLIGHT_BLOCK_MAP, MISSION: MISSION_BLOCK_MAP };

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
  // WP4A second slice (docs/adr/0025) — routed through fdr-store.js's
  // dedicated setTofi(), same reasoning as 'airspace-owner' above. Unlike
  // that kind, 3 different Blocks share this one target kind but route to
  // 3 different keys on one fdr.tofi sub-object — `field` carries which.
  if (def.target.kind === 'tofi') return { kind: 'tofi', field: def.target.field };
  // Routed through fdr-store.js's dedicated setWorkingFrequency(), same
  // reasoning as 'airspace-owner' — a frequency needs validating as a number
  // in one band, and the write is append-only.
  if (def.target.kind === 'frequency') return { kind: 'frequency' };
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
  DEPARTURE_BLOCK_MAP, ARRIVAL_BLOCK_MAP, OVERFLIGHT_BLOCK_MAP, MISSION_BLOCK_MAP, BLOCK_MAPS,
  isValidRole, requiredBlocksFor, resolveBlockTarget, validateFacilityConfig,
};
