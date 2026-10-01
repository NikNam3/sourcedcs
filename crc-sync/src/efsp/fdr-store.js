'use strict';

// Flight Data Record store — net-new state in crc-sync. WP0 reconnaissance
// this session confirmed the guide's decision D-1 ("the CRC server already
// keeps a per-aircraft flight record") is FALSE: src/tracks.js's "track" is
// pure live radar telemetry (id/callsign/coalition/type/lat/lon/alt/heading
// /player/category, plus SRS-observed squawk) with no route, altitude,
// departure, or destination anywhere. This store is the real thing,
// modelled on EFSPImplementationGuide.md §3.1-3.3, §3.8, §3.10.
//
// FDR and Strip are deliberately separate (guide §3.1): this store owns
// only the flight — identity, filed intent, assigned clearance. Strip
// lifecycle (state, ownership, Bay/Rack placement, annotations) lives in
// board-store.js and references an fdrId, never the reverse.

const crypto = require('crypto');
const { CodeAllocator, isValidCodeFormat } = require('./code-allocator');
// One unit and one type for every frequency inside the EFSP: MHz, as a
// number. Shared with airspace-config.js so a configured airspace frequency
// and a frequency a flight is approved onto can never validate differently.
const { isValidFrequency, MIN_FREQUENCY_MHZ, MAX_FREQUENCY_MHZ } = require('./airspace-config');
// §9.10's canned-route table (docs/adr/0050). A data-table require rather
// than the validator-only one above, and deliberately so: createFdr() is the
// single place a flat seed is interpreted into identity.*/filed.*, and
// expanding a short name into a route IS seed interpretation. Putting it in
// board-store.js's _applyCreateStrip instead would mean any second creation
// path — or a test constructing an FdrStore directly — silently skips it.
const stereoRoutes = require('./stereo-routes');
const { resolveZuluHhmm, resolveZuluHhmmAfter } = require('./zulu-time');
const { WALL_CLOCK } = require('../mission-clock');
const { DEFAULT_TRANSITION_ALT_FT } = require('../theaters');

const VOID_DEADLINE_MINUTES = 30; // §3.8 — derived, not stored input
const EDCT_WINDOW_MINUTES = 5;              // §4.6.2 — EDCT ± 5 min
const CALL_FOR_RELEASE_BEFORE_MINUTES = 2;  // §4.6.2 — CALL_FOR_RELEASE − 2 min
const CALL_FOR_RELEASE_AFTER_MINUTES = 1;   //           / + 1 min

// WP4A (docs/adr/0017) added EDCT and CALL_FOR_RELEASE — §4.6.2's two
// release states beyond §3.8's original four ("across the boundary": the
// release travels controller-to-controller CTR->APP->TWR, per that
// section's own text). The original four are unchanged/still Phase-2-only
// reachable without WP4A at all.
const RELEASE_STATES = new Set(['RELEASED', 'HOLD_FOR_RELEASE', 'RELEASE_TIME', 'CLEARANCE_VOID_TIME', 'EDCT', 'CALL_FOR_RELEASE']);
const DEGRADATION_STATES = new Set(['NONE', 'TRANSPONDER_FAILED', 'MODE_C_FAILED']);
const DATALINK_INDICATOR_STATES = new Set(['NONE', 'ISSUED']);
// WP4A (docs/adr/0019) — guide §4.6 rule 5's track-degradation flags, which
// force verbal coordination and disable silent cross-Facility transfer
// while present (board-store.js's _applyCoordinationPropose). Genuinely
// distinct from identity.degradation above (equipment failure — Mode C/
// transponder — not radar-track quality); see this module's WP4A note
// near WRITABLE_PATHS for why these are two separate fields, not a reuse.
const TRACK_DEGRADATION_FLAGS = new Set(['NONE', 'CST', 'FAIL', 'IF', 'NT', 'TRK']);
// WP4A (docs/adr/0018) — §4.6.4's airspace-ownership direction. Never a
// bare boolean (D15) — enforced structurally by routing every write
// through setAirspaceOwner() below, never the generic setField() path.
const AIRSPACE_OWNERS = new Set(['CONTROLLING_AGENCY', 'USING_AGENCY']);
// WP4A second slice (docs/adr/0025), §4.6.3 — the three-field separation
// model. Never independently derived from airspace type (defect D14) —
// enforced structurally by routing every write through setTofi() below,
// never the generic setField() path, exactly like AIRSPACE_OWNERS above.
const RADAR_SERVICE_STATES = new Set(['ACTIVE', 'TERMINATED']);
const SEPARATION_REGIMES = new Set(['ATC', 'MARSA', 'USING_AGENCY', 'DUE_REGARD', 'SEE_AND_AVOID']);
// WP6 (docs/adr/0052), guide §6.4's military extension namespace. Both are
// restricted enums routed through setMilitary() below, never the generic
// setField() path — the same structural exclusion AIRSPACE_OWNERS and
// SEPARATION_REGIMES get, and for the same reason.
const ORDNANCE_STATES = new Set(['CLEAN', 'LOADED', 'HUNG', 'EXPENDED']); // §9.5 (M14)
const ALERT_STATUSES = new Set(['NONE', 'ALERT', 'SCRAMBLE']);            // §9.6 (M16)

const CALLSIGN_RE = /^[A-Za-z0-9]{1,7}$/; // §3.2 rule 1 — MUST NOT exceed 7 alphanumeric characters

// A ceiling on controller-entered free text. The guide sets no limit, and
// none of these fields has a natural one — a route or a remark is as long as
// it needs to be. But nothing bounded them at all, and a Strip is broadcast
// whole to every connected client on every update (docs/adr/0004's immediate
// broadcast), so one pasted document would ride on every subsequent change
// and sit in the durable snapshot forever. Generous enough that no real
// entry meets it, low enough that an accident stays an accident.
const MAX_FREE_TEXT = 2000;

// Paths a controller-driven SetBlock may target generically via setField().
// Deliberately excludes identity.equipmentSuffix (derived-only, §3.3),
// identity.modeOne/modeTwo (no setter anywhere — guards defect D24 by
// construction, not validation), identity.beaconObserved (WP5 — written only
// by setBeaconObserved, whose provenance is UPSTREAM_TRACK rather than a
// controller), trackRef (permanently null, see its own comment), every path
// under military (guide §6.4's extension namespace — an object since
// docs/adr/0052, whose two written fields route through setMilitary() and
// whose rest is §12's present-and-unpopulated — EXCEPT the six military.mtr.*
// leaves (docs/adr/0062), which are plain controller free text / time /
// altitude, go through setField() and are normalised by normalizeMtrValue();
// the `mtr` object itself is not writable), and all structural/system fields
// (fdrId, rev, provenance, createdAt/updatedAt/updatedBy). identity.
// beaconAssigned is listed here but routed through a dedicated method
// (setBeaconAssigned) rather than the generic path, since it needs
// code-allocator validation, not just a plain write.
//
// filed.stereoRouteName (§9.10, docs/adr/0050) IS here, and it is the one
// entry in this list whose write does more than write: setField() validates
// it against the route table and RE-EXPANDS the filed route from it. See
// that branch for why re-filing rather than relabelling is the only safe
// reading of "put this flight on PACK 2".
//
// It shipped unwritable, on the reasoning that nla.js's standing-release
// gate matches on it (release-envelope.js), so a name no table entry backs
// would waive a HOLD_FOR_RELEASE the OPERATIONAL_REQUEST fallback exists to
// force. That threat is real and is still closed — by resolving every
// written name against the table, which is a stronger guarantee than
// unwritability was, because it also makes the name and the route agree by
// construction. What unwritability actually cost was the ability to switch
// or cancel a stereo on a live Strip: the only remedies were to hand-edit
// the route (losing the label, the altitude and the envelope match) or to
// drop and re-file (a new beacon code and CID for an aircraft already
// squawking). Found by walking the "VIPER11 request change to PACK 2" case.
const WRITABLE_PATHS = new Set([
  'identity.callsign', 'identity.flightSize', 'identity.aircraftType', 'identity.wakeCategory',
  'identity.equipmentCodes', 'identity.degradation',
  'identity.tailNumber', 'identity.unit', 'identity.homeStation',
  'filed.route', 'filed.requestedAltitude', 'filed.departureAirport', 'filed.departureRunway',
  'filed.destinationAirport', 'filed.proposedDepartureTimeUtc', 'filed.fullRouteClearance', 'filed.remarks',
  'filed.stereoRouteName',
  // ARRIVAL-role fields (Phase 2) — present on every FDR regardless of the
  // Strip role that ends up referencing it, same "present but unpopulated
  // until relevant" precedent as the DEPARTURE-only fields above (guide
  // §12). Deliberately separate names from the departure fields, not
  // repurposed ones — filed.departureAirport means something different
  // from filed.originAirport, and confusing them would be a genuine bug.
  'filed.originAirport', 'filed.arrivalFix', 'filed.estimatedArrivalTimeUtc',
  'assigned.clearedRoute', 'assigned.clearedAltitude', 'assigned.releaseState', 'assigned.releaseTimeUtc',
  'assigned.voidTimeUtc', 'assigned.delayInfo', 'assigned.atisCode', 'assigned.datalinkClearanceIndicator',
  'assigned.movementAreaEntryTimeUtc', 'assigned.taxiTimeUtc', 'assigned.takeoffTimeUtc',
  'assigned.landingRunway',
  // WP4A (docs/adr/0017) — §4.6.2's release-across-the-boundary additions.
  // edctWindowStartUtc/EndUtc and callForReleaseWindowStartUtc/EndUtc are
  // DERIVED (like voidDeadlineUtc above), not independently writable.
  'assigned.edctTimeUtc', 'assigned.callForReleaseTimeUtc',
  // WP4A (docs/adr/0019) track-degradation flag — see the module comment
  // near TRACK_DEGRADATION_FLAGS for why this is distinct from
  // identity.degradation.
  'identity.trackDegradationFlag',
  // WP4A second slice (docs/adr/0026) — the minimal MISSION field set
  // (guide §9.8's "military extension namespace"), present on every FDR
  // regardless of role, same "present but unpopulated until relevant"
  // precedent as the ARRIVAL-only fields above. Full ATO-driven richness
  // (Mode 1/2/datalink code, MARSA, ordnance, ROZ/ACM) stays WP6/WP7 scope.
  'mission.missionNumber', 'mission.packageId', 'mission.controllingAgency',
  'mission.vulWindowStartUtc', 'mission.vulWindowEndUtc',
  // §9.4 MTR fields (docs/adr/0062), Blocks 9G-* (guide M10) and 9H-* (M11).
  // Plain fdr fields, not setMilitary(): free text, times and an altitude,
  // none an enum or a boolean. Normalised by normalizeMtrValue().
  'military.mtr.designator', 'military.mtr.entryFix', 'military.mtr.entryTimeUtc',
  'military.mtr.exitFix', 'military.mtr.exitEstimateUtc', 'military.mtr.requestedAltitudeAfterExit',
]);

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj, path, value) {
  const parts = path.split('.');
  const last = parts.pop();
  const target = parts.reduce((o, k) => o[k], obj);
  target[last] = value;
}

// [SOURCE-DEFINED, deliberately simplified] — the real FAA equipment-suffix
// cross-reference (AIM 5-1-8/Doc 8643-adjacent tables) is genuinely complex
// published doctrine this guide does not reproduce, and §3.3's actual
// requirement is the INTERLOCK (suffix is derived, never directly
// editable), not a specific mapping. This derivation is intentionally
// naive — sorted, joined equipment-code letters — and MUST NOT be
// presented as real FAA doctrine (§0.2). Replace with a real table if/when
// one is sourced; nothing else in the Block Map depends on the specific
// letters produced here.
function deriveEquipmentSuffix(equipmentCodes) {
  if (!Array.isArray(equipmentCodes) || equipmentCodes.length === 0) return '';
  return [...equipmentCodes].map(String).sort().join('');
}

/**
 * WP6 (docs/adr/0052) — guide §6.4's military extension namespace, turned on
 * ONCE so the §9.5/§9.6/§9.7/§9.4 deliverables that follow add behaviour
 * rather than schema. It was `null` with a `// WP6 hook` comment until now.
 *
 * Three groups, and the difference between them is the whole point of doing
 * this in one pass:
 *
 *  - WRITTEN, with a Block and a setter: `ordnanceState` (§9.5, guide M14,
 *    Block 3G), `hookRequired` (§9.7, guide M15, Block 3F). Both go through
 *    setMilitary(), never setField().
 *  - WRITTEN, with a Block and a setter, DEPARTURE only: `alertStatus`
 *    (§9.6, guide M16, Block 14E — docs/adr/0070 picked the parent). The
 *    setter validates it so the enum lives in exactly one place.
 *  - WRITTEN through setField(), not setMilitary(): the six leaves of the
 *    `mtr` sub-object (§9.4, guide M10/M11, Blocks 9G-* / 9H-*,
 *    docs/adr/0062). Free text, clock times and an altitude — plain FDR
 *    fields, so they share setField()'s refusal and provenance path.
 *  - PRESENT AND UNPOPULATED per §12, no setter and no Block at all, exactly
 *    like identity.modeOne/modeTwo already are: `altrvRef` (M9), `arInfo` (M12), `scl` (M13),
 *    `fuelState` (M17) and `releaseAuthority` (M19). WP6 does not deliver
 *    these; §12's rule is that a deferral leaves its fields in place rather
 *    than absent, and that is all this is.
 *
 * A function rather than a frozen literal because every FDR needs its own
 * `mtr` object — sharing one would make two flights' MTR entries the same
 * entry, which is the kind of bug that only shows up with two aircraft.
 */
function defaultMilitary() {
  return {
    ordnanceState: 'CLEAN',   // §9.5 / M14 — Block 3G
    hookRequired: false,      // §9.7 / M15 — Block 3F
    alertStatus: 'NONE',      // §9.6 / M16 — Block 14E, DEPARTURE only (docs/adr/0070)
    // §9.4 / M10 + M11 — Blocks 9G-MTR/-ENTRY/-TIME and 9H-EXIT/-TIME/-ALT
    // (docs/adr/0062). Written leaf by leaf through setField(), never
    // setMilitary(); normalizeMtrValue() says what each leaf accepts.
    mtr: {
      designator: null,
      entryFix: null,
      entryTimeUtc: null,
      exitFix: null,
      exitEstimateUtc: null,
      requestedAltitudeAfterExit: null,
    },
    altrvRef: null,         // M9  — ALTRV, WP7/ATO territory
    arInfo: null,           // M12 — air-refuelling info; the MARSA RELATION is
                            //       docs/adr/0051's own store, this is the ATO
                            //       track/anchor data that would describe it
    scl: null,              // M13 — standard conventional load, ATO-owned
    fuelState: null,        // M17
    releaseAuthority: null, // M19
  };
}

// The subset of fdr.military setMilitary() will write. Everything else in
// defaultMilitary() is §12's present-and-unpopulated and is refused, by name,
// rather than merged — see setMilitary()'s own comment.
const MILITARY_WRITABLE_FIELDS = new Set(['ordnanceState', 'hookRequired', 'alertStatus']);

/**
 * Returns this FDR's military namespace, seeding it first if the record
 * predates it.
 *
 * FDRs are durable (docs/adr/0002) and restore() reinstates whole objects off
 * disk, so every board that has ever run carries FDRs whose `military` is the
 * literal `null` this field was until docs/adr/0052. §12's "present and
 * unpopulated rather than absent" is a promise about the SHAPE a reader sees,
 * and a restored snapshot is a reader — without this, a §9.5 advisory reading
 * `fdr.military.ordnanceState` throws on exactly the flights that were already
 * airborne when the service restarted, which is the worst possible set.
 *
 * Seeds in place and returns the object, so callers can treat it as present.
 */
function ensureMilitary(fdr) {
  if (!fdr.military) fdr.military = defaultMilitary();
  return fdr.military;
}

// ── The clearance as issued: assigned altitude and heading (docs/adr/0058) ──
//
// One of each per FLIGHT, not per Strip. They replace the per-Strip notes that
// used to hold them (DEPARTURE's INIT ALT and HDG, ARRIVAL's ALT and VECTOR,
// OVERFLIGHT's ASGN ALT and VECTOR), which never crossed a Facility boundary,
// so CTR's copy of a departure started with neither.
//
// Each is a history cell shaped exactly like a Strip annotation cell
// (`{ entries: [{ value, status, at, by }] }`, statuses ACTIVE / SUPERSEDED /
// STRUCK), because §3.7 applies unchanged: an amendment supersedes, never
// overwrites, and a vacated altitude is struck only by an explicit confirm.
// `parsed` on each entry is the value as a number (feet, degrees) for the
// conformance monitor; `value` is what the controller wrote.
const CLEARANCE_FIELDS = new Set(['altitude', 'heading']);

function defaultClearance() {
  return { altitude: { entries: [] }, heading: { entries: [] } };
}

function ensureClearance(fdr) {
  if (!fdr.clearance) fdr.clearance = defaultClearance();
  if (!fdr.clearance.altitude) fdr.clearance.altitude = { entries: [] };
  if (!fdr.clearance.heading) fdr.clearance.heading = { entries: [] };
  return fdr.clearance;
}

/**
 * An altitude as a strip carries it, in feet. "FL180" / "F180" is a flight
 * level; "A050" and a bare three-or-fewer-digit number are hundreds of feet
 * (the strip convention: "050" is 5,000 ft, "180" is FL180's 18,000 ft); four
 * or more digits are feet. Null when it is not an altitude at all.
 */
function parseAltitudeFt(text) {
  const t = String(text == null ? '' : text).trim().toUpperCase().replace(/\s+/g, '');
  let m = /^F(?:L)?(\d{1,3})$/.exec(t);
  if (m) return Number(m[1]) * 100;
  m = /^A(\d{1,3})$/.exec(t);
  if (m) return Number(m[1]) * 100;
  m = /^(\d{1,5})$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return m[1].length <= 3 ? n * 100 : n;
}

/**
 * A flight level at and above the theater's transition altitude, feet below it,
 * as the canonical block text writes an end. Only the text depends on the
 * transition altitude (docs/wip/TA.md): a stored band is always feet, and
 * parseAltitudeFt() reads "FL100" as 10,000 ft in every theater.
 */
function formatAltitudeEnd(ft, transitionAltFt) {
  return ft >= transitionAltFt && ft % 100 === 0 ? `FL${String(ft / 100).padStart(3, '0')}` : String(ft);
}

/** A block in its one canonical text, `FL220-FL240` / `5000-8000` (docs/adr/0091). `transitionAltFt` is the theater's. */
function formatAltitudeBlock(band, transitionAltFt) {
  return `${formatAltitudeEnd(band.lowFt, transitionAltFt)}-${formatAltitudeEnd(band.highFt, transitionAltFt)}`;
}

/** Splits "FL220B240" / "FL220-FL240" / "220TO240" into its two ends in feet, unordered; null when it is not one. */
function splitAltitudeBlock(t) {
  for (let i = 1; i < t.length - 1; i += 1) {
    for (const sep of ['-', 'B', 'TO']) {
      if (!t.startsWith(sep, i)) continue;
      const low = parseAltitudeFt(t.slice(0, i));
      const high = parseAltitudeFt(t.slice(i + sep.length));
      if (low != null && high != null) return { lowFt: low, highFt: high };
    }
  }
  return null;
}

function altitudeKey(text) {
  return String(text == null ? '' : text).trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * An assigned altitude as a band in feet (docs/adr/0091): `{ lowFt, highFt }`.
 * A single altitude is a zero-width band (`lowFt === highFt`). A block is two
 * altitudes joined by `-`, `B` or `TO` ("FL220-FL240", "FL220B240", "220B240",
 * "5000-8000"), low first. Null when it is neither, and for a block whose low
 * end is not below its high end.
 */
function parseAltitude(text) {
  const t = altitudeKey(text);
  const single = parseAltitudeFt(t);
  if (single != null) return { lowFt: single, highFt: single };
  const block = splitAltitudeBlock(t);
  return block && block.lowFt < block.highFt ? block : null;
}

/** True when the text is two readable altitudes in the wrong order (or equal), for a precise refusal. */
function isMisorderedBlock(text) {
  const block = splitAltitudeBlock(altitudeKey(text));
  return !!block && block.lowFt >= block.highFt;
}

// Typed time Blocks (docs/adr/0062's rule, extended by supervisor fix F4).
//
// Every …TimeUtc path a controller writes is epoch ms, like every other …Utc
// field that readers do arithmetic on: nla.js's HELD gates, the void deadline
// and the EDCT/call-for-release windows derived below, and the obligation
// monitor. A controller types a four-digit Zulu time ("1432", "14:32Z"), so a
// string is resolved by zulu-time.js's resolveZuluHhmm against the MISSION
// clock's now (H11) — the one rule, nearest occurrence within ±12 h (S-L2b).
// Before F4 the typed string was stored as-is: "1432" + 30 min became the
// string "14321800000", and `now < "1432"` was always false, so a typed void
// time never expired and a typed release time never held (questioner Q43,
// R2-17).
//
// A finite number is taken as epoch ms already (an import, a scenario).
// Empty clears to null. Anything else is refused, never stored.
//
// The vul window (mission.vulWindowStartUtc/EndUtc, M6/M7) joined in
// docs/adr/0073 (S-F4). Its START is an ordinary typed time. Its END is
// resolved to the first occurrence AFTER the start (WINDOW_END_OF below), not
// the nearest to now, because a window may run longer than 12 h and an end is
// only ever after its start. The ATO already writes both as epoch ms (L3/L14),
// which pass through untouched.
const TYPED_TIME_LABELS = {
  'filed.proposedDepartureTimeUtc': 'proposed departure time',
  'filed.estimatedArrivalTimeUtc': 'estimated arrival time',
  'assigned.releaseTimeUtc': 'release time',
  'assigned.voidTimeUtc': 'void time',
  'assigned.edctTimeUtc': 'EDCT',
  'assigned.callForReleaseTimeUtc': 'call-for-release time',
  'assigned.movementAreaEntryTimeUtc': 'movement area entry time',
  'assigned.taxiTimeUtc': 'taxi time',
  'assigned.takeoffTimeUtc': 'takeoff time',
  'military.mtr.entryTimeUtc': 'MTR entry time',
  'military.mtr.exitEstimateUtc': 'MTR exit estimate',
  'mission.vulWindowStartUtc': 'vul window start',
  'mission.vulWindowEndUtc': 'vul window end',
};

// A typed time that ends a window: the path of the start it follows.
const WINDOW_END_OF = { 'mission.vulWindowEndUtc': 'mission.vulWindowStartUtc' };

/**
 * Normalise a value written to a typed time path (TYPED_TIME_LABELS).
 * `nowMs` is the mission clock's now(), used only to date a typed time.
 * `startMs` is the window start, for a WINDOW_END_OF path only: when it is a
 * number the end resolves to the first occurrence after it; with no start the
 * end falls back to the nearest occurrence like any typed time.
 * Returns { ok: true, value } (epoch ms or null) or { ok: false, detail }.
 */
function normalizeTypedTime(path, value, nowMs, startMs = null) {
  if (typeof value === 'number' && Number.isFinite(value)) return { ok: true, value };
  const text = value == null ? '' : String(value).trim();
  if (text === '') return { ok: true, value: null };
  const ms = WINDOW_END_OF[path] && Number.isFinite(startMs)
    ? resolveZuluHhmmAfter(text, startMs)
    : resolveZuluHhmm(text, nowMs);
  if (ms == null) {
    return { ok: false, detail: `${TYPED_TIME_LABELS[path]} must be a UTC time as HHMM, e.g. 1432` };
  }
  return { ok: true, value: ms };
}

// §9.4 MTR fields (docs/adr/0062). What each military.mtr.* path accepts.
//
// The two times are typed time paths (normalizeTypedTime above).
//
// Designator and fixes take no format rule: there is no MTR route table in
// this repo (H23: free text until the squadron's list arrives), so any grammar
// would be invented (defect D11). Upper-casing is the strip convention, not
// validation.

/**
 * Normalise a value written to one of the six military.mtr.* paths.
 * `nowMs` is the mission clock's now(), used only to date a typed time;
 * `transitionAltFt` is the theater's, used only to write a block's text.
 * Returns { ok: true, value } or { ok: false, detail }. Empty clears to null.
 */
function normalizeMtrValue(path, value, nowMs, transitionAltFt = DEFAULT_TRANSITION_ALT_FT) {
  if (TYPED_TIME_LABELS[path]) return normalizeTypedTime(path, value, nowMs);
  const text = value == null ? '' : String(value).trim().toUpperCase();
  if (text === '') return { ok: true, value: null };
  if (path === 'military.mtr.requestedAltitudeAfterExit') {
    const band = parseAltitude(text);
    if (band == null) {
      return { ok: false, detail: 'requested altitude after exit must be an altitude or a block, e.g. FL210, 080 or FL210-FL230' };
    }
    return { ok: true, value: band.lowFt === band.highFt ? text.replace(/\s+/g, '') : formatAltitudeBlock(band, transitionAltFt) };
  }
  return { ok: true, value: text };
}

/** A heading in degrees, 1–360 ("000" is north, stored as 360). Null when it is not a heading. */
function parseHeadingDeg(text) {
  const t = String(text == null ? '' : text).trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  if (n > 360) return null;
  return n === 0 ? 360 : n;
}

/** The value a clearance cell currently holds, or null. */
function activeClearanceEntry(fdr, field) {
  const cell = fdr && fdr.clearance && fdr.clearance[field];
  return (cell && cell.entries.find(e => e.status === 'ACTIVE')) || null;
}

class FdrStore {
  /**
   * @param {CodeAllocator} [codeAllocator]
   * @param {{clock?:{now:()=>number}, transitionAltFt?:()=>number}} [deps] the mission clock (docs/adr/0079)
   *   — every timestamp on an FDR is a time a controller reads — and the
   *   theater's transition altitude, which decides how a block's text writes
   *   an end (FL or feet). A fixture that omits it gets 18,000 ft.
   */
  constructor(codeAllocator, { clock = WALL_CLOCK, transitionAltFt = () => DEFAULT_TRANSITION_ALT_FT } = {}) {
    this._clock = clock;
    this._transitionAltFt = transitionAltFt;
    this._codeAllocator = codeAllocator || new CodeAllocator();
    this._fdrs = new Map(); // fdrId -> FlightDataRecord
  }

  get codeAllocator() { return this._codeAllocator; }

  getFdr(fdrId) { return this._fdrs.get(fdrId) || null; }
  getAll() { return [...this._fdrs.values()]; }

  /**
   * Creates a new FDR from filed intent (§3.1, §3.2). Mints a beacon code
   * internally via the code allocator — this is NOT a client-facing RPC
   * (guide §3.10.1's split: crc-sync mints, EFSP only displays/overrides).
   *
   * `seed.stereoRouteName` files by §9.10 short name: the route table is
   * resolved HERE, server-side, and its expansion fills whatever the seed
   * left blank. WP6's acceptance criterion — "a stereo route filed by short
   * name produces a complete FDR" — is this function's postcondition.
   *
   * Returns { ok:true, fdr } or { ok:false, reason }.
   */
  createFdr(seed, { by }) {
    const callsign = String(seed?.callsign || '').toUpperCase();
    if (!CALLSIGN_RE.test(callsign)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'callsign must be 1-7 alphanumeric characters' };
    }

    // §9.10 / docs/adr/0050 — resolve the short name BEFORE allocate() below,
    // or a refused CreateStrip leaks a beacon code out of the pool. Same
    // "a denied CreateStrip has no side effects" discipline board-store.js's
    // canCreateStripRole check already documents.
    //
    // An unknown name is REFUSED, not silently blanked — deliberately unlike
    // flight-plan-lookup.js's never-block contract, and the difference is
    // principled: that lookup fronts a remote service that can legitimately
    // be down, so degrading to a blank Strip is the right failure. This table
    // is local config. "Not in the table" is not a transient failure, it is a
    // wrong answer, and a Strip that claims a stereo it isn't flying is worse
    // than no Strip — it would also carry a name into release-envelope.js's
    // matcher that no configured route backs.
    // F4: the two filed times take the same typed-time rule as setField(),
    // checked before allocate() for the same no-side-effects reason as the
    // stereo name below.
    const seedTimes = {};
    for (const key of ['proposedDepartureTimeUtc', 'estimatedArrivalTimeUtc']) {
      const time = normalizeTypedTime(`filed.${key}`, seed[key], this._clock.now());
      if (!time.ok) return { ok: false, reason: 'VALIDATION_ERROR', detail: time.detail };
      seedTimes[key] = time.value;
    }
    // docs/adr/0073 (S-F4): the vul window, the start first so a typed end
    // can follow it. The ATO's epoch ms pass through untouched.
    const vulStart = normalizeTypedTime('mission.vulWindowStartUtc', seed.vulWindowStartUtc, this._clock.now());
    if (!vulStart.ok) return { ok: false, reason: 'VALIDATION_ERROR', detail: vulStart.detail };
    const vulEnd = normalizeTypedTime('mission.vulWindowEndUtc', seed.vulWindowEndUtc, this._clock.now(), vulStart.value);
    if (!vulEnd.ok) return { ok: false, reason: 'VALIDATION_ERROR', detail: vulEnd.detail };
    // docs/adr/0073: the filed DD-1801's departure time, one source of §10.5's
    // P-time chain. Best-effort like the lookup that supplies it: a value that
    // is not a time is dropped, never a refusal.
    const flightPlanDepartureUtc = resolveZuluHhmm(seed.flightPlanDepartureTimeHhmm, this._clock.now());

    let stereoSeed = {};
    let stereoName = '';
    const requestedStereo = seed.stereoRouteName;
    if (requestedStereo != null && String(requestedStereo).trim() !== '') {
      const route = stereoRoutes.resolveStereoRoute(requestedStereo);
      if (!route) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: `${requestedStereo} is not a configured stereo route` };
      }
      // Retired rather than mistyped, so it gets its own message. Note this
      // refuses only NEW filings: a flight already airborne on a route the
      // squadron has since deactivated keeps its name and its route, because
      // deactivation is not retroactive.
      if (route.active === false) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: `${route.name} is not an active stereo route` };
      }
      stereoSeed = stereoRoutes.toFdrFiledSeed(route);
      stereoName = route.name; // the CANONICAL spelling, not whatever was typed
    }
    // The stereo is a template ("file me the usual"); an explicitly supplied
    // value is an amendment and wins. Same layering efsp-panel.js already
    // applies to the DD1801 seed. In practice they rarely collide — picking a
    // stereo client-side skips the flight-plan lookup entirely.
    const filedFrom = (key) => seed[key] || stereoSeed[key] || '';

    const fdrId = crypto.randomUUID();
    const now = this._clock.now();
    const equipmentCodes = Array.isArray(seed.equipmentCodes) ? [...seed.equipmentCodes] : [];

    const minted = this._codeAllocator.allocate(fdrId);
    if (minted.error) return { ok: false, reason: 'VALIDATION_ERROR', detail: 'beacon code pool exhausted' };

    const provenance = {
      'identity.beaconAssigned': 'COMPUTER_GENERATED',
      'identity.equipmentSuffix': 'SYSTEM_DERIVED',
    };
    // Guide §10.5's provenance fallback chains — a field the table filled was
    // not typed by the controller. Block 9's declared pre-edit default is
    // already COMPUTER_GENERATED (block-map.js), and setField() flips any of
    // these to CONTROLLER_ENTERED the moment one is actually edited.
    if (stereoName) {
      for (const key of ['route', 'requestedAltitude', 'departureAirport', 'destinationAirport', 'remarks']) {
        if (!seed[key] && stereoSeed[key]) provenance[`filed.${key}`] = 'COMPUTER_GENERATED';
      }
      provenance['filed.stereoRouteName'] = 'COMPUTER_GENERATED';
    }

    const fdr = {
      fdrId,
      rev: 1,
      identity: {
        callsign,
        flightSize: Number.isInteger(seed.flightSize) && seed.flightSize > 0 ? seed.flightSize : 1,
        aircraftType: seed.aircraftType || '',
        wakeCategory: seed.wakeCategory || '',
        equipmentCodes,
        equipmentSuffix: deriveEquipmentSuffix(equipmentCodes),
        degradation: 'NONE',
        beaconAssigned: minted.code,
        // What the aircraft is actually squawking, from the correlated contact
        // (docs/adr/0045). Null means "assigned but nothing received", which
        // §3.10.2 rule 1 makes one of three renderable states rather than an
        // absence. Written only by setBeaconObserved().
        beaconObserved: null,
        modeOne: null,        // ATO-owned, WP7 hook — no setter exists anywhere
        modeTwo: null,        // ATO-owned, WP7 hook — no setter exists anywhere
        tailNumber: seed.tailNumber || null,
        unit: seed.unit || null,
        homeStation: seed.homeStation || null,
        trackDegradationFlag: 'NONE', // WP4A, §4.6 rule 5
      },
      filed: {
        route: filedFrom('route'),
        requestedAltitude: filedFrom('requestedAltitude'),
        departureAirport: filedFrom('departureAirport'),
        departureRunway: seed.departureRunway || null,
        destinationAirport: filedFrom('destinationAirport'),
        // §9.10 (docs/adr/0050) — the short name this flight was filed under.
        // Its expansion is filed.route beside it; this is the label, and what
        // a standing-release envelope matches on. Not in WRITABLE_PATHS — see
        // that list's own comment for why.
        stereoRouteName: stereoName,
        proposedDepartureTimeUtc: seedTimes.proposedDepartureTimeUtc,
        fullRouteClearance: !!seed.fullRouteClearance,
        remarks: filedFrom('remarks'),
        originAirport: seed.originAirport || '',                       // ARRIVAL-role field, Phase 2
        arrivalFix: seed.arrivalFix || null,                            // ARRIVAL-role field, Phase 2
        estimatedArrivalTimeUtc: seedTimes.estimatedArrivalTimeUtc,  // ARRIVAL-role field, Phase 2
      },
      clearance: defaultClearance(), // docs/adr/0058 — assigned altitude and heading
      assigned: {
        clearedRoute: null,
        clearedAltitude: null,
        releaseState: 'RELEASED',
        releaseTimeUtc: null,
        voidTimeUtc: null,
        voidDeadlineUtc: null,
        edctTimeUtc: null,               // WP4A, §4.6.2
        edctWindowStartUtc: null,        // derived: edctTimeUtc - 5min
        edctWindowEndUtc: null,          // derived: edctTimeUtc + 5min
        callForReleaseTimeUtc: null,     // WP4A, §4.6.2
        callForReleaseWindowStartUtc: null, // derived: callForReleaseTimeUtc - 2min
        callForReleaseWindowEndUtc: null,   // derived: callForReleaseTimeUtc + 1min
        delayInfo: null,
        atisCode: null,
        datalinkClearanceIndicator: 'NONE',
        movementAreaEntryTimeUtc: null, // Block 16 — present, unpopulated; metering deferred, guide §12
        taxiTimeUtc: null,              // Block 17 — present, unpopulated
        takeoffTimeUtc: null,
        landingRunway: null,            // ARRIVAL-role field, Phase 2
      },
      // WP6 (docs/adr/0052), guide §6.4 — the military extension namespace.
      // `ordnanceState`/`hookRequired` are written via setMilitary() only,
      // never the generic setField() path; everything else here is §12's
      // present-and-unpopulated. See defaultMilitary() for the three groups.
      military: defaultMilitary(),
      // Permanently null, and kept present per §12's rule that a deferral
      // leaves its fields in place. Guide §3.1 types it `TrackRef?`, but §6.6
      // rule 2 then forbids the only thing it could usefully hold: "do not
      // store a raw track ID on the FDR". Anything else it could carry is
      // either a staleable duplicate of the correlation record's state — which
      // is the defect, not the fix — or the fdrId, i.e. the record's own key.
      // The correlation lives in correlation-store.js, keyed by fdrId
      // (docs/adr/0045). Nothing reads or writes this.
      trackRef: null,
      // WP4A (docs/adr/0018), §4.6.4 — a DIRECTION, never a bare boolean
      // (D15). Only ever written via setAirspaceOwner() below, never the
      // generic setField() path — see that method for why.
      airspace: { owner: null, changedAt: null, changedBy: null, transitions: [] },
      // The frequency this flight has been approved onto — guide Block 22,
      // which the spec lists with an entirely empty notes column. Written
      // only via setWorkingFrequency() below, never the generic setField()
      // path, on the exact template setAirspaceOwner established
      // (docs/adr/0018) and setTofi followed.
      //
      // [SOURCE-DEFINED]: the concept of a "working frequency" for an
      // airspace, and of approving a flight onto one, appears nowhere in any
      // FAA or DoD source the guide reached. It is this squadron's operating
      // practice and must never be presented as doctrine (defect D11).
      comms: { workingFrequencyMhz: null, airspaceId: null, changedAt: null, changedBy: null, transitions: [] },
      // WP4A second slice (docs/adr/0026) — the minimal MISSION field set
      // (guide §9.8), present but null/empty on every FDR regardless of
      // role. Written through the generic setField() path (WRITABLE_PATHS
      // above) — these are plain controller-entered values, unlike the
      // separation-model fields below.
      // docs/adr/0073 — stored INPUTS of §10.5's time chains (time-chains.js
      // computes the answer at read). Present and null when unknown (§12).
      timeInputs: { flightPlanDepartureUtc },
      mission: {
        missionNumber: seed.missionNumber || null,
        packageId: seed.packageId || null,
        controllingAgency: seed.controllingAgency || null,
        vulWindowStartUtc: vulStart.value,
        vulWindowEndUtc: vulEnd.value,
      },
      // WP4A second slice (docs/adr/0025), §4.6.3 — the three-field
      // separation model. Only ever written via setTofi() below, never the
      // generic setField() path — see that method for why (mirrors
      // airspace.owner's exact template, per docs/adr/0018/0020's own
      // directive).
      tofi: { ifrActive: false, radarService: null, separationRegime: null, changedAt: null, changedBy: null },
      provenance,
      createdAt: now,
      updatedAt: now,
      updatedBy: by || null,
    };

    this._fdrs.set(fdrId, fdr);
    return { ok: true, fdr };
  }

  /**
   * Generic controller-driven field write for any path in WRITABLE_PATHS.
   * Handles the equipment-suffix recompute-on-equipmentCodes-change
   * interlock (§3.3) and the void-deadline derivation on release-state/
   * void-time changes (§3.8). identity.beaconAssigned is NOT handled here
   * — use setBeaconAssigned(), which needs code-allocator validation.
   */
  setField(fdrId, path, value, { by } = {}) {
    const fdr = this._fdrs.get(fdrId);
    if (!fdr) return { ok: false, reason: 'NOT_FOUND' };
    if (path === 'identity.beaconAssigned') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'use setBeaconAssigned' };
    }
    if (path === 'identity.equipmentSuffix') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'equipmentSuffix is derived — set identity.equipmentCodes instead' };
    }
    if (!WRITABLE_PATHS.has(path)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${path} is not writable` };
    }
    if (typeof value === 'string' && value.length > MAX_FREE_TEXT) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${path} is limited to ${MAX_FREE_TEXT} characters` };
    }
    if (path === 'identity.degradation' && !DEGRADATION_STATES.has(value)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'invalid degradation state' };
    }
    if (path === 'assigned.releaseState' && !RELEASE_STATES.has(value)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'invalid release state' };
    }
    if (path === 'assigned.datalinkClearanceIndicator' && !DATALINK_INDICATOR_STATES.has(value)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'invalid datalink clearance indicator' };
    }
    if (path === 'identity.trackDegradationFlag' && !TRACK_DEGRADATION_FLAGS.has(value)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'invalid track degradation flag' };
    }

    if (TYPED_TIME_LABELS[path] && !path.startsWith('military.mtr.')) { // F4: typed HHMM → epoch ms
      const time = normalizeTypedTime(path, value, this._clock.now(), WINDOW_END_OF[path] ? getPath(fdr, WINDOW_END_OF[path]) : null);
      if (!time.ok) return { ok: false, reason: 'VALIDATION_ERROR', detail: time.detail };
      value = time.value;
    }

    if (path.startsWith('military.mtr.')) { // §9.4, docs/adr/0062
      const mtr = normalizeMtrValue(path, value, this._clock.now(), this._transitionAltFt());
      if (!mtr.ok) return { ok: false, reason: 'VALIDATION_ERROR', detail: mtr.detail };
      value = mtr.value;
      ensureMilitary(fdr);
    }

    // §9.10 re-filing (docs/adr/0050). Resolved against the table BEFORE any
    // write, so a bad name leaves the FDR byte-identical and does not bump
    // rev — the no-partial-write property every other inline validator here
    // has, and it matters more for this one because a half-applied re-file
    // would leave the label and the route disagreeing, which is the exact
    // state the whole design exists to prevent.
    let stereoExpansion = null;
    if (path === 'filed.stereoRouteName') {
      const requested = value == null ? '' : String(value).trim();
      if (requested === '') {
        // Clearing the LABEL only. The route stays: un-filing a stereo must
        // never blank a taxiing flight's route out from under it, and a
        // controller who wants the route gone edits Block 9.
        value = '';
      } else {
        const route = stereoRoutes.resolveStereoRoute(requested);
        if (!route) {
          return { ok: false, reason: 'VALIDATION_ERROR', detail: `${requested} is not a configured stereo route` };
        }
        if (route.active === false) {
          return { ok: false, reason: 'VALIDATION_ERROR', detail: `${route.name} is not an active stereo route` };
        }
        value = route.name; // the table's spelling, not what was typed
        stereoExpansion = route;
      }
    }

    setPath(fdr, path, value);

    // A re-file REWRITES the filed route from the table rather than merely
    // relabelling the Strip. Relabelling was the alternative and it is
    // unsafe: it would let "PACK 2" sit on a Strip still carrying PACK 1's
    // route and altitude — a lie on the board, and one release-envelope.js
    // would believe when it decides whether a standing release covers the
    // flight. Naming a different route IS the amendment; the derive-on-write
    // shape is identity.equipmentCodes -> equipmentSuffix above.
    //
    // Unlike createFdr()'s expansion, this overwrites unconditionally. There
    // the seed is a controller's explicit entry and wins; here the explicit
    // entry IS the new route name, so leaving PACK 1's 250 on a flight now
    // filed PACK 2 would be the stale value, not a preserved one.
    //
    // Two fields are deliberately NOT touched:
    //   filed.remarks        — controller free text that has nothing to do
    //                          with the route; clobbering it is the
    //                          annotation-erasure mistake docs/adr/0040 had
    //                          to fix once already.
    //   assigned.clearedRoute — a re-file amends FILED intent (§3.1). The
    //                          clearance already issued is a separate field
    //                          and a separate conversation with the pilot.
    if (stereoExpansion) {
      const seed = stereoRoutes.toFdrFiledSeed(stereoExpansion);
      for (const key of ['route', 'requestedAltitude', 'departureAirport', 'destinationAirport']) {
        fdr.filed[key] = seed[key];
        fdr.provenance[`filed.${key}`] = 'COMPUTER_GENERATED';
      }
    }

    if (path === 'identity.equipmentCodes') {
      fdr.identity.equipmentSuffix = deriveEquipmentSuffix(value);
      fdr.provenance['identity.equipmentSuffix'] = 'SYSTEM_DERIVED';
    }

    // §9.10 (docs/adr/0050) — an amended route is no longer the canned one,
    // so the stereo label goes with it. Same derive-on-write shape as
    // equipmentSuffix above and voidDeadlineUtc below, and it is what stops
    // filed.stereoRouteName becoming a lie that nla.js's standing-release
    // gate then believes: without this, amending PACK 1's route to anything
    // at all would keep the PACK 1 envelope waiving the flight's hold.
    // Clearing the name never touches the route — un-labelling a flight must
    // not blank its route mid-taxi.
    if (path === 'filed.route') fdr.filed.stereoRouteName = '';

    if (path === 'assigned.releaseState' || path === 'assigned.voidTimeUtc') {
      fdr.assigned.voidDeadlineUtc =
        fdr.assigned.releaseState === 'CLEARANCE_VOID_TIME' && fdr.assigned.voidTimeUtc
          ? fdr.assigned.voidTimeUtc + VOID_DEADLINE_MINUTES * 60 * 1000
          : null;
    }

    // WP4A (docs/adr/0017) — EDCT/CALL_FOR_RELEASE windows derive the same
    // way voidDeadlineUtc does above: recomputed on every write of either
    // the release state or the relevant time, never independently settable.
    if (path === 'assigned.releaseState' || path === 'assigned.edctTimeUtc') {
      const active = fdr.assigned.releaseState === 'EDCT' && fdr.assigned.edctTimeUtc;
      fdr.assigned.edctWindowStartUtc = active ? fdr.assigned.edctTimeUtc - EDCT_WINDOW_MINUTES * 60 * 1000 : null;
      fdr.assigned.edctWindowEndUtc   = active ? fdr.assigned.edctTimeUtc + EDCT_WINDOW_MINUTES * 60 * 1000 : null;
    }
    if (path === 'assigned.releaseState' || path === 'assigned.callForReleaseTimeUtc') {
      const active = fdr.assigned.releaseState === 'CALL_FOR_RELEASE' && fdr.assigned.callForReleaseTimeUtc;
      fdr.assigned.callForReleaseWindowStartUtc = active ? fdr.assigned.callForReleaseTimeUtc - CALL_FOR_RELEASE_BEFORE_MINUTES * 60 * 1000 : null;
      fdr.assigned.callForReleaseWindowEndUtc   = active ? fdr.assigned.callForReleaseTimeUtc + CALL_FOR_RELEASE_AFTER_MINUTES * 60 * 1000 : null;
    }

    fdr.provenance[path] = 'CONTROLLER_ENTERED';
    fdr.rev += 1;
    fdr.updatedAt = this._clock.now();
    fdr.updatedBy = by || null;
    return { ok: true, fdr };
  }

  /**
   * Controller override of Block 5 (§3.10.2 rule 2) — routed through the
   * code allocator rather than setField's generic path, since it needs
   * reserved/duplicate validation and must release the FDR's previous code.
   * Returns { ok:false, reason:'VALIDATION_ERROR' } for reserved/malformed
   * codes, or { ok:true, fdr, warning? } — warning is set (never blocking)
   * for a duplicate, per defect D23.
   */
  setBeaconAssigned(fdrId, code, { by } = {}) {
    const fdr = this._fdrs.get(fdrId);
    if (!fdr) return { ok: false, reason: 'NOT_FOUND' };

    const check = this._codeAllocator.validateAssignment(code, fdrId);
    if (!check.ok) return { ok: false, reason: check.reason, detail: check.detail };

    const previous = fdr.identity.beaconAssigned;
    this._codeAllocator.reassign(fdrId, code, previous);
    fdr.identity.beaconAssigned = code;
    fdr.provenance['identity.beaconAssigned'] = 'CONTROLLER_ENTERED';
    fdr.rev += 1;
    fdr.updatedAt = this._clock.now();
    fdr.updatedBy = by || null;
    return { ok: true, fdr, warning: check.warning };
  }

  /**
   * WP5 (docs/adr/0045) — the code the aircraft is actually squawking, as
   * reported by the correlated surveillance contact.
   *
   * This is the missing half of §3.10.2 rule 1: "Assigned and observed are two
   * separate fields. Never one. The panel derives a mismatch state by
   * comparing them, and renders three cases: matching, mismatched, and
   * assigned but nothing received." `beaconAssigned` has been written since
   * Phase 1; nothing ever wrote this, so the three-case render had no data
   * behind it and the D22 defect it guards against was untestable.
   *
   * A dedicated setter, structurally excluded from WRITABLE_PATHS, on the
   * setAirspaceOwner/setTofi/setWorkingFrequency template — but for a
   * different reason than theirs. Those are excluded because they need
   * validation beyond an allow-list check. This one is excluded because its
   * provenance is UPSTREAM_TRACK: it is not a controller-entered value at all,
   * and a generic-path route to setting it would be a route for a client to
   * claim an aircraft is squawking something it is not.
   *
   * Writes ONLY on change, and does not bump `rev` otherwise. The reconciler
   * calls this once a second per correlated flight; an unconditional write
   * would churn every FDR's rev and provenance at reconcile cadence, and an
   * FDR is broadcast whole on every update.
   *
   * @param {string|null} code — a 4-digit octal string, or null for "nothing
   *   received" (which is a distinct, renderable state, not an absence).
   * @returns {{ok:true, fdr, changed:boolean}|{ok:false, reason, detail?}}
   */
  setBeaconObserved(fdrId, code, { source = 'UPSTREAM_TRACK' } = {}) {
    const fdr = this._fdrs.get(fdrId);
    if (!fdr) return { ok: false, reason: 'NOT_FOUND' };
    if (code !== null && !isValidCodeFormat(code)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `observed code must be 4 octal digits or null, not ${JSON.stringify(code)}` };
    }
    if (fdr.identity.beaconObserved === code) return { ok: true, fdr, changed: false };

    fdr.identity.beaconObserved = code;
    fdr.provenance['identity.beaconObserved'] = source;
    fdr.rev += 1;
    fdr.updatedAt = this._clock.now();
    // No updatedBy: surveillance is not a controller, and stamping a
    // controllerId here would attribute a machine observation to a person.
    return { ok: true, fdr, changed: true };
  }

  /**
   * WP4A (docs/adr/0018), §4.6.4 — sets airspace ownership as a DIRECTION,
   * never a bare boolean (defect D15: "released" means active in one
   * direction and available in the other — the word alone is ambiguous).
   * Routed through a dedicated setter, structurally excluded from the
   * generic setField() path, for the same reason setBeaconAssigned() is:
   * this needs validation beyond "is this key in the allow-list," and
   * critically, `identity.trackDegradationFlag`'s WRITABLE_PATHS entry
   * still can't be reused here — 'assigned.airspace.owner'/'airspace.owner'
   * was deliberately never added to WRITABLE_PATHS at all, so there is no
   * generic-path route to setting it as a boolean, or as anything else,
   * even by accident. This is the template docs/adr/0018 flags for the
   * deferred `separation_regime` field when TOFI eventually lands.
   * @returns {{ok:true, fdr}|{ok:false, reason:'NOT_FOUND'|'VALIDATION_ERROR', detail?}}
   */
  setAirspaceOwner(fdrId, owner, { by } = {}) {
    const fdr = this._fdrs.get(fdrId);
    if (!fdr) return { ok: false, reason: 'NOT_FOUND' };
    if (!AIRSPACE_OWNERS.has(owner)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `airspace ownership must be a direction (${[...AIRSPACE_OWNERS].join(' or ')}), not ${JSON.stringify(owner)}` };
    }
    // Append-only transition history alongside the current value. The flat
    // overwrite this replaces lost the record of every prior handover: a MOA
    // given to the using agency and later taken back read afterwards as if
    // it had only ever been taken back. Every other controller-entered
    // doctrinal fact is append-only for exactly this reason (§3.7, and JO
    // 7110.65 ¶2-3-1's "do not erase or overwrite any item"); `owner` stays
    // the current-value field so every existing reader is unaffected.
    const now = this._clock.now();
    fdr.airspace = {
      owner,
      changedAt: now,
      changedBy: by || null,
      transitions: [...(fdr.airspace.transitions || []), { owner, at: now, by: by || null }],
    };
    fdr.provenance['airspace.owner'] = 'CONTROLLER_ENTERED';
    fdr.rev += 1;
    fdr.updatedAt = this._clock.now();
    fdr.updatedBy = by || null;
    return { ok: true, fdr };
  }

  /**
   * WP4A second slice (docs/adr/0025), §4.6.3 — sets the three-field
   * separation model (`ifr_active`/`radar_service`/`separation_regime`),
   * none of which is derivable from any of the others or from airspace
   * type (defect D14). Routed through a dedicated setter, structurally
   * excluded from the generic setField() path, exactly like
   * setAirspaceOwner() above — this IS the template that method's own
   * comment named for this field when TOFI eventually landed.
   *
   * One setter accepting a partial patch, not three independent ones: a
   * controller fills in each field incrementally via separate Block edits,
   * and a single write path keeps provenance/rev bookkeeping in one place.
   * Rule 5 ("DUE_REGARD and MARSA are mutually exclusive") is resolved BY
   * CONSTRUCTION — separation_regime is one 5-value enum field, not two
   * independent booleans — so no cross-field validation is needed here.
   * @param {{ifrActive?:boolean, radarService?:string|null, separationRegime?:string|null}} patch
   * @returns {{ok:true, fdr}|{ok:false, reason:'NOT_FOUND'|'VALIDATION_ERROR', detail?}}
   */
  setTofi(fdrId, patch, { by } = {}) {
    const fdr = this._fdrs.get(fdrId);
    if (!fdr) return { ok: false, reason: 'NOT_FOUND' };
    // Both fields START as null and null is a real, renderable state — "no
    // radar service", "the regime has not been stated" — so clearing one is a
    // meaningful controller action, not an erasure. An enum picker's "—"
    // option sends the empty string, which is the same intent spelled the way
    // a <select> spells it; normalized here so there is one answer server-side
    // rather than two spellings of "cleared" (docs/ui-findings/lane2.md F-206).
    patch = { ...patch };
    if (patch.radarService === '') patch.radarService = null;
    if (patch.separationRegime === '') patch.separationRegime = null;
    if (patch.radarService !== undefined && patch.radarService !== null && !RADAR_SERVICE_STATES.has(patch.radarService)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `invalid radar_service: ${JSON.stringify(patch.radarService)}` };
    }
    if (patch.separationRegime !== undefined && patch.separationRegime !== null && !SEPARATION_REGIMES.has(patch.separationRegime)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `invalid separation_regime: ${JSON.stringify(patch.separationRegime)}` };
    }
    fdr.tofi = { ...fdr.tofi, ...patch, changedAt: this._clock.now(), changedBy: by || null };
    fdr.provenance['tofi'] = 'CONTROLLER_ENTERED';
    fdr.rev += 1;
    fdr.updatedAt = this._clock.now();
    fdr.updatedBy = by || null;
    return { ok: true, fdr };
  }

  /**
   * WP6 (docs/adr/0052), guide §6.4 — writes the military extension
   * namespace's two controller-settable fields, `ordnanceState` (§9.5, M14)
   * and `hookRequired` (§9.7, M15), plus `alertStatus` (§9.6, M16) once §9.6
   * gives it a Block.
   *
   * One setter accepting a partial patch, not three, and structurally
   * excluded from WRITABLE_PATHS — setTofi()'s exact shape and for its exact
   * reasons. Both enums here are restricted value sets, and `hookRequired` is
   * a bare boolean, which is the defect-D15 shape the generic path must never
   * be able to reach: "hook" alone does not say whether it means the aircraft
   * HAS one or REQUIRES one, and the answer decides whether an arrival is
   * gated on a runway's gear being rigged (§9.7 rule 4). Routing it through a
   * named method makes the reading structural rather than a convention in a
   * comment.
   *
   * An unknown key is REFUSED rather than merged. `patch` arrives from a
   * Block Map `field` on the wire, so a typo'd or invented field name would
   * otherwise silently grow fdr.military a member nothing reads — and §12's
   * deferred fields (mtr, altrvRef, arInfo, scl, fuelState, releaseAuthority)
   * sit right beside these, so "not writable yet" has to fail loudly rather
   * than become writable by accident.
   *
   * @param {{ordnanceState?:string, hookRequired?:boolean, alertStatus?:string}} patch
   * @returns {{ok:true, fdr}|{ok:false, reason:'NOT_FOUND'|'VALIDATION_ERROR', detail?}}
   */
  setMilitary(fdrId, patch, { by } = {}) {
    const fdr = this._fdrs.get(fdrId);
    if (!fdr) return { ok: false, reason: 'NOT_FOUND' };

    for (const key of Object.keys(patch || {})) {
      if (!MILITARY_WRITABLE_FIELDS.has(key)) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: `military.${key} is not writable` };
      }
    }
    if (patch.ordnanceState !== undefined && !ORDNANCE_STATES.has(patch.ordnanceState)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `invalid ordnance state: ${JSON.stringify(patch.ordnanceState)}` };
    }
    if (patch.alertStatus !== undefined && !ALERT_STATUSES.has(patch.alertStatus)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `invalid alert status: ${JSON.stringify(patch.alertStatus)}` };
    }
    if (patch.hookRequired !== undefined && typeof patch.hookRequired !== 'boolean') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `hookRequired must be true or false, not ${JSON.stringify(patch.hookRequired)}` };
    }

    fdr.military = { ...ensureMilitary(fdr), ...patch };
    // One provenance key for the whole sub-object, as `tofi` already does —
    // these are filled in incrementally from separate Block edits and every
    // one of them is controller-entered.
    fdr.provenance['military'] = 'CONTROLLER_ENTERED';
    fdr.rev += 1;
    fdr.updatedAt = this._clock.now();
    fdr.updatedBy = by || null;
    return { ok: true, fdr };
  }

  /**
   * WP7 (docs/adr/0071), guide §9.8/§9.9 — writes what an imported ATO says
   * about this flight. The ONLY writer of `identity.modeOne`/`modeTwo`,
   * `military.scl`, `military.arInfo` and `fdr.ato`, called only from the ATO
   * import (efsp-ws.js _handleAtoMutation via ato/ato-board.js). Structurally
   * outside WRITABLE_PATHS and MILITARY_WRITABLE_FIELDS on the setTofi /
   * setBeaconObserved template: Mode 1/2 are "displayed, not edited" by ATC
   * (§3.10.3 rule 1), so no Block, no setField() path and no setMilitary() key
   * may ever reach them (defect D24, by construction).
   *
   * `tasking.mode` says how the flight met the ATO:
   *  - CREATE: the import just made this FDR from the line's seed. Every seed
   *    path is marked provenance 'ATO'; the ATO's Mode 3 is ADOPTED as the
   *    assigned code when the allocator accepts it (decision H64, answering
   *    docs/adr/0054's inherited question), releasing the code createFdr just
   *    minted — else the minted code stays; an ATO alert status of ALERT is
   *    written (the ATO never says SCRAMBLE).
   *  - BIND: a flight already filed. The ATC code is authoritative (§3.10.3
   *    rule 3) and is never touched; the ATO's code sits in `ato.iff.modeThree`.
   *    A seed path is filled only where the flight has nothing yet.
   *  - UPDATE: a re-import. A seed path is replaced only while its provenance
   *    is still 'ATO' — a value a controller typed is kept and reported
   *    (§10.2 rule 3). Everything else the ATO owns is replaced.
   *
   * Refuses unknown keys, validates everything before writing anything, and
   * bumps `rev` once.
   *
   * @returns {{ok:true, fdr, kept:object[], beacon:object|null}|{ok:false, reason, detail?}}
   */
  applyAtoTasking(fdrId, tasking, { by } = {}) {
    const TASKING_KEYS = new Set(['mode', 'identity', 'modeThree', 'military', 'seed', 'ato']);
    const MODES = new Set(['CREATE', 'BIND', 'UPDATE']);
    const SEED_PATHS = new Set(['mission.missionNumber', 'mission.packageId', 'mission.controllingAgency',
      'mission.vulWindowStartUtc', 'mission.vulWindowEndUtc', 'identity.flightSize', 'identity.aircraftType',
      'identity.unit', 'identity.homeStation']);
    const refuse = (detail) => ({ ok: false, reason: 'VALIDATION_ERROR', detail });

    const fdr = this._fdrs.get(fdrId);
    if (!fdr) return { ok: false, reason: 'NOT_FOUND' };
    if (!tasking || typeof tasking !== 'object') return refuse('an ATO tasking is an object');
    for (const key of Object.keys(tasking)) if (!TASKING_KEYS.has(key)) return refuse(`${key} is not part of an ATO tasking`);
    const mode = tasking.mode;
    if (!MODES.has(mode)) return refuse(`unknown ATO tasking mode ${JSON.stringify(mode)}`);
    const identity = tasking.identity || {};
    for (const key of Object.keys(identity)) if (key !== 'modeOne' && key !== 'modeTwo') return refuse(`identity.${key} is not ATO-owned`);
    if (identity.modeOne != null && !/^[0-7]{2}$/.test(identity.modeOne)) return refuse(`Mode 1 must be two octal digits, not ${JSON.stringify(identity.modeOne)}`);
    if (identity.modeTwo != null && !/^[0-7]{4}$/.test(identity.modeTwo)) return refuse(`Mode 2 must be four octal digits, not ${JSON.stringify(identity.modeTwo)}`);
    if (tasking.modeThree != null && !isValidCodeFormat(tasking.modeThree)) return refuse(`Mode 3 must be four octal digits, not ${JSON.stringify(tasking.modeThree)}`);
    const military = tasking.military || {};
    for (const key of Object.keys(military)) if (!['scl', 'arInfo', 'alertStatus'].includes(key)) return refuse(`military.${key} is not ATO-owned`);
    if (military.alertStatus !== undefined && military.alertStatus !== 'NONE' && military.alertStatus !== 'ALERT') {
      return refuse(`an ATO alert status is NONE or ALERT, not ${JSON.stringify(military.alertStatus)}`);
    }
    const seed = tasking.seed || {};
    for (const path of Object.keys(seed)) if (!SEED_PATHS.has(path)) return refuse(`${path} is not seeded by an ATO`);
    if (!tasking.ato || typeof tasking.ato !== 'object') return refuse('an ATO tasking carries its ato record');

    // ── validated; write ──
    const kept = [];
    const blank = (v) => v == null || v === '';
    for (const [path, raw] of Object.entries(seed)) {
      let value = raw;
      if (path === 'identity.flightSize' && !(Number.isInteger(value) && value > 0)) continue;
      if (path === 'identity.aircraftType' && typeof value !== 'string') continue;
      const current = getPath(fdr, path);
      const prov = fdr.provenance[path];
      const owned = mode === 'CREATE' || prov === 'ATO' || (prov === undefined && blank(current));
      if (!owned) {
        if ((current == null ? null : current) !== (value == null ? null : value)) {
          kept.push({ path, value: current, atoValue: value, ownedBy: prov === 'CONTROLLER_ENTERED' ? 'CONTROLLER' : 'FLIGHT' });
        }
        continue;
      }
      setPath(fdr, path, value === undefined ? null : value);
      fdr.provenance[path] = 'ATO';
    }
    if (mode === 'CREATE') fdr.provenance['identity.callsign'] = 'ATO';

    fdr.identity.modeOne = identity.modeOne == null ? null : identity.modeOne;
    fdr.identity.modeTwo = identity.modeTwo == null ? null : identity.modeTwo;
    fdr.provenance['identity.modeOne'] = 'ATO';
    fdr.provenance['identity.modeTwo'] = 'ATO';

    const mil = ensureMilitary(fdr);
    mil.scl = military.scl == null ? null : military.scl;
    mil.arInfo = military.arInfo == null ? null : military.arInfo;
    if (mode === 'CREATE' && military.alertStatus === 'ALERT') mil.alertStatus = 'ALERT';
    fdr.provenance['military.scl'] = 'ATO';
    fdr.provenance['military.arInfo'] = 'ATO';

    fdr.ato = { ...tasking.ato };
    fdr.provenance['ato'] = 'ATO';

    let beacon = null;
    if (mode === 'CREATE' && tasking.modeThree) {
      const check = this._codeAllocator.validateAssignment(tasking.modeThree, fdrId);
      if (check.ok) {
        const previous = fdr.identity.beaconAssigned;
        this._codeAllocator.reassign(fdrId, tasking.modeThree, previous);
        fdr.identity.beaconAssigned = tasking.modeThree;
        fdr.provenance['identity.beaconAssigned'] = 'ATO';
        beacon = { adopted: true, code: tasking.modeThree, released: previous !== tasking.modeThree ? previous : null, warning: check.warning };
      } else {
        beacon = { adopted: false, code: fdr.identity.beaconAssigned, atoCode: tasking.modeThree, detail: check.detail || 'reserved or malformed' };
      }
    }

    fdr.rev += 1;
    fdr.updatedAt = this._clock.now();
    fdr.updatedBy = by || null;
    return { ok: true, fdr, kept, beacon };
  }

  /**
   * Approves this flight onto a frequency, optionally tied to the airspace it
   * is working in (guide Block 22). Append-only, like airspace ownership: a
   * sortie that changes frequency three times has to be able to show all
   * three afterwards, not just the last.
   *
   * Crucially this does NOT move jurisdiction. Guide §4.7 and defect D17 are
   * explicit that modelling "ownership transfer = frequency change" inverts
   * what Single Frequency Approach actually does — "the frequency is an
   * attribute of the Strip; the controller is what moves". The owning
   * controller keeps the Strip across this call; only the flight's radio
   * moves.
   *
   * @param {number|null} frequencyMhz — MHz as a number, or null to clear
   * @returns {{ok:true, fdr}|{ok:false, reason, detail?}}
   */
  setWorkingFrequency(fdrId, frequencyMhz, { airspaceId = null, by } = {}) {
    const fdr = this._fdrs.get(fdrId);
    if (!fdr) return { ok: false, reason: 'NOT_FOUND' };
    if (frequencyMhz !== null && !isValidFrequency(frequencyMhz)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `frequency must be a number between ${MIN_FREQUENCY_MHZ} and ${MAX_FREQUENCY_MHZ} MHz, not ${JSON.stringify(frequencyMhz)}` };
    }
    const now = this._clock.now();
    fdr.comms = {
      workingFrequencyMhz: frequencyMhz,
      airspaceId,
      changedAt: now,
      changedBy: by || null,
      transitions: [...(fdr.comms.transitions || []), { workingFrequencyMhz: frequencyMhz, airspaceId, at: now, by: by || null }],
    };
    fdr.provenance['comms.workingFrequencyMhz'] = 'CONTROLLER_ENTERED';
    fdr.rev += 1;
    fdr.updatedAt = now;
    fdr.updatedBy = by || null;
    return { ok: true, fdr };
  }

  /**
   * Releases the FDR's beacon code — called when its LAST live Strip is
   * DROPPED. Callers must not invoke this while another Strip still
   * references the FDR (TOFI binds two Strips to one fdrId, docs/adr/0025);
   * board-store.js's _releaseFdrIfLastStrip is the guard that enforces it.
   */
  releaseFdr(fdrId) {
    const fdr = this._fdrs.get(fdrId);
    if (!fdr) return;
    this._codeAllocator.release(fdr.identity.beaconAssigned);
  }

  /**
   * Re-claims a code released by releaseFdr, for Undo of a terminal NLA Drop
   * within its 30s window (§3.5 rule 5). No-op when the code has already gone
   * to a different FDR in the meantime — that flight is now squawking it, and
   * minting a knowing duplicate here would be worse than leaving this FDR's
   * own recorded code un-reserved (defect D23: duplicates warn, never block).
   * @returns {{ok:true, warning?:'DUPLICATE_IGNORED_WARNING'}|{ok:false, reason:'NOT_FOUND'}}
   */
  reacquireFdr(fdrId) {
    const fdr = this._fdrs.get(fdrId);
    if (!fdr) return { ok: false, reason: 'NOT_FOUND' };
    const code = fdr.identity.beaconAssigned;
    if (!code) return { ok: true };
    const holder = this._codeAllocator.holderOf(code);
    if (holder && holder !== fdrId) return { ok: true, warning: 'DUPLICATE_IGNORED_WARNING' };
    this._codeAllocator.reassign(fdrId, code, null);
    return { ok: true };
  }

  /**
   * Assigns (or clears) the flight's altitude or heading, or confirms an
   * altitude vacated (docs/adr/0058, guide §3.7).
   *
   * Bumps `rev` so every client redraws, but stamps `clearanceUpdatedAt`
   * rather than `updatedAt`: the AMENDMENT_INSIDE_30MIN obligation reads
   * `updatedAt` as "the flight plan was just amended", and issuing a
   * clearance altitude is not a flight-plan amendment — it would otherwise
   * fire on every clearance CD issues inside 30 minutes of departure.
   *
   * An empty value is allowed and means "no assignment" (resume own
   * navigation, for a heading); it is recorded like any other amendment.
   * @returns {{ok:true, fdr}|{ok:false, reason:'NOT_FOUND'|'VALIDATION_ERROR', detail?}}
   */
  setClearance(fdrId, field, { value, confirmVacated = false } = {}, { by } = {}) {
    const fdr = this._fdrs.get(fdrId);
    if (!fdr) return { ok: false, reason: 'NOT_FOUND' };
    if (!CLEARANCE_FIELDS.has(field)) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown clearance field ${field}` };
    const cell = ensureClearance(fdr)[field];
    const active = cell.entries.find(e => e.status === 'ACTIVE');
    const now = this._clock.now();

    if (confirmVacated) {
      if (field !== 'altitude') return { ok: false, reason: 'VALIDATION_ERROR', detail: 'only an altitude is vacated' };
      if (!active) return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no assigned altitude to confirm vacated' };
      active.status = 'STRUCK';
    } else {
      const text = String(value == null ? '' : value).trim().toUpperCase();
      if (text.length > MAX_FREE_TEXT) return { ok: false, reason: 'VALIDATION_ERROR', detail: `limited to ${MAX_FREE_TEXT} characters` };
      let parsed = null;
      let block = null;
      let shown = text;
      if (text !== '') {
        if (field === 'altitude') {
          const band = parseAltitude(text);
          if (band === null) {
            return {
              ok: false, reason: 'VALIDATION_ERROR',
              detail: isMisorderedBlock(text)
                ? `${JSON.stringify(text)} is not a block — write the lower altitude first, e.g. FL220-FL240`
                : `${JSON.stringify(text)} is not an altitude — write it like 5000, 050, A050, FL180 or a block, FL220-FL240`,
            };
          }
          if (band.lowFt === band.highFt) parsed = band.lowFt;
          else { block = band; shown = formatAltitudeBlock(band, this._transitionAltFt()); }
        } else {
          parsed = parseHeadingDeg(text);
          if (parsed === null) {
            return { ok: false, reason: 'VALIDATION_ERROR', detail: `${JSON.stringify(text)} is not a heading — write it as 1 to 360, e.g. 050` };
          }
        }
      }
      if (active) active.status = 'SUPERSEDED';
      const entry = { value: shown, parsed, status: 'ACTIVE', at: now, by: by || null };
      if (field === 'altitude') entry.block = block;
      cell.entries.push(entry);
    }

    fdr.provenance[`clearance.${field}`] = 'CONTROLLER_ENTERED';
    fdr.rev += 1;
    fdr.clearanceUpdatedAt = now;
    fdr.updatedBy = by || null;
    return { ok: true, fdr };
  }

  /**
   * Archives a finished flight's FDR (docs/adr/0082, H36): it leaves memory
   * and the snapshot. Only archiver.js calls this, and only in the sweep that
   * archived the FDR's last Strip — an FDR that never had a Strip is never
   * passed here. The code should already be free (_releaseFdrIfLastStrip);
   * it is released again only if this FDR still holds it, never when another
   * flight has taken it since. Idempotent.
   * @returns {boolean} whether there was an FDR to archive
   */
  archiveFdr(fdrId) {
    const fdr = this._fdrs.get(fdrId);
    if (!fdr) return false;
    const code = fdr.identity && fdr.identity.beaconAssigned;
    if (code && this._codeAllocator.holderOf(code) === fdrId) this._codeAllocator.release(code);
    this._fdrs.delete(fdrId);
    return true;
  }

  // ── Persistence (durable per ADR 0002) ──────────────────────────────────
  snapshot() {
    return { fdrs: this.getAll(), codes: this._codeAllocator.snapshot(), codeCursor: this._codeAllocator.cursor };
  }
  restore(data) {
    this._fdrs = new Map((data?.fdrs || []).map((f) => {
      // Every FDR written before docs/adr/0052 has `military: null` on disk.
      // Seeding on the way in (rather than on every read) means one place
      // knows about the old shape and nothing downstream has to — see
      // ensureMilitary() for why a null here is worse than it looks.
      ensureMilitary(f);
      ensureClearance(f); // docs/adr/0058 — FDRs saved before the clearance cells existed
      if (!f.timeInputs) f.timeInputs = { flightPlanDepartureUtc: null }; // docs/adr/0073 — FDRs saved before the time chains
      return [f.fdrId, f];
    }));
    this._codeAllocator.restore(data?.codes);
    this._codeAllocator.restoreCursor(data?.codeCursor); // docs/adr/0081: the rotating cursor survives a restart
  }
}

module.exports = {
  FdrStore, deriveEquipmentSuffix, WRITABLE_PATHS, RELEASE_STATES, VOID_DEADLINE_MINUTES,
  EDCT_WINDOW_MINUTES, CALL_FOR_RELEASE_BEFORE_MINUTES, CALL_FOR_RELEASE_AFTER_MINUTES,
  TRACK_DEGRADATION_FLAGS, AIRSPACE_OWNERS, RADAR_SERVICE_STATES, SEPARATION_REGIMES, MAX_FREE_TEXT,
  ORDNANCE_STATES, ALERT_STATUSES, MILITARY_WRITABLE_FIELDS, defaultMilitary,
  CLEARANCE_FIELDS, defaultClearance, ensureClearance, parseAltitudeFt, parseAltitude, formatAltitudeBlock, parseHeadingDeg, activeClearanceEntry,
  normalizeMtrValue,
};
