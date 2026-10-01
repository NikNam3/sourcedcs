'use strict';

// Airspace definitions — the MOAs and ranges this theater knows about
// (EFSPImplementationGuide.md §4.1's `RANGES` Facility, §9.11's activation
// authority). Static configuration, loaded once at require time, same
// load-or-default pattern as facility-config.js; the mutable *state* of each
// airspace (scheduled/active/released/returned) lives in airspace-store.js,
// exactly as a Strip's definition-vs-state split works.
//
// Deliberately loaded by facility-config.js rather than the other way round:
// the `RANGES` Facility's Position set is DERIVED from these records (every
// distinct `usingPositionId`), because a Position only exists for a range
// that has real control of its own. An ordinary MOA has none — a flight
// working inside it is approved onto a working frequency by whichever ATC
// Position owns the airspace, which is the common case. That means this
// module must not require facility-config.js back; it validates Position
// references by shape only, and index.js's _validateAirspaceReferences
// cross-checks them against the real Position sets at startup.
//
// [SOURCE-DEFINED]: the guide models no working frequency, no range-control
// frequency, and no airspace *type* taxonomy at all — its only airspace
// vocabulary is §4.6.4's ownership direction. `type`, `workingFrequencyMhz`
// and `controlFrequencyMhz` are this squadron's operating practice, not FAA
// or DoD doctrine, and must never be presented as such (defect D11).

const fs = require('fs');
const { statePaths, ensureDirFor } = require('../state-paths');

// Squadron data that a live edit rewrites (setAirspaces), so it reads from
// data/ if a live copy exists and always writes there — see state-paths.js.
const { read: AIRSPACES_PATH, write: AIRSPACES_WRITE_PATH } =
  statePaths('efsp-airspaces.json', process.env.CRCSYNC_EFSP_AIRSPACES_PATH);

// What kind of block this is. The FAA's special-use taxonomy and ICAO's
// (which is what Turkey publishes) name overlapping things — a MOA in FAA
// terms is usually charted as a danger or restricted area elsewhere — so
// this set spans both rather than picking one and mistranslating.
//
// **Purely descriptive.** Nothing in the system derives behaviour from it,
// and nothing may: defect D14 and guide §4.6.3 are explicit that
// `separation_regime` "MUST NOT be derived from airspace type" — the
// governing agreement picks the regime, including the case where ATC keeps
// separating inside the block. `type` exists to label the airspace on the
// board and nothing else. The two values that DO change behaviour are
// `usingPositionId` (whether a Position exists for it) and which frequency
// field is set.
const AIRSPACE_TYPES = new Set([
  'MOA',        // military operations area — FAA naming
  'RANGE',      // a range, usually with control of its own
  'DANGER',     // ICAO D — how most of these are charted outside the US
  'RESTRICTED', // ICAO/FAA R
  'PROHIBITED', // ICAO/FAA P
  'WARNING',    // FAA W — over international water
]);

// Vertical limits, in feet. Both optional: an airspace with neither is
// unbounded as far as this system is concerned, which is honest — the real
// limits are published elsewhere and this is not a charting tool. When they
// ARE set, a flight's altitude block has to fit inside them.
const MIN_ALTITUDE_FT = 0;
const MAX_ALTITUDE_FT = 100000;

function isValidAltitude(value) {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= MIN_ALTITUDE_FT && value <= MAX_ALTITUDE_FT;
}

// Deliberately one unit, one type, everywhere inside the EFSP: MHz as a
// number. The wider repo is inconsistent (atis-store keys by integer Hz,
// apt-config stores an unvalidated string, the SRS bridge takes float MHz at
// its HTTP boundary), so conversions happen at those edges, never here.
const MIN_FREQUENCY_MHZ = 30;
const MAX_FREQUENCY_MHZ = 400;

function isValidFrequency(value) {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= MIN_FREQUENCY_MHZ && value <= MAX_FREQUENCY_MHZ;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Validates a whole airspace list (guide §8.3's configuration-validation
 * shape, mirroring facility-config.js's validateConfig).
 * @returns {{ok:true}|{ok:false, reason:'VALIDATION_ERROR', detail:string}}
 */
function validateAirspaces(candidate) {
  if (!Array.isArray(candidate)) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: 'airspaces config must be an array' };
  }
  const seen = new Set();
  for (const a of candidate) {
    if (!a || typeof a !== 'object') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'each airspace must be an object' };
    }
    if (!a.airspaceId || typeof a.airspaceId !== 'string') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'each airspace needs a string airspaceId' };
    }
    if (seen.has(a.airspaceId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `duplicate airspaceId ${a.airspaceId}` };
    }
    seen.add(a.airspaceId);
    if (!a.name || typeof a.name !== 'string') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${a.airspaceId} needs a name` };
    }
    if (!AIRSPACE_TYPES.has(a.type)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${a.airspaceId} has unknown type ${JSON.stringify(a.type)}` };
    }
    // Who approves activation. §9.11 names APP specifically because it
    // assumes a RAPCON-owned range complex; here it is per-airspace, so a
    // MOA inside Ankara Center's airspace is approved by CTR rather than by
    // an Approach that does not own it. See the ADR for this generalization.
    if (!a.controllingFacilityId || typeof a.controllingFacilityId !== 'string') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${a.airspaceId} needs a controllingFacilityId` };
    }
    if (!a.controllingPositionId || typeof a.controllingPositionId !== 'string') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${a.airspaceId} needs a controllingPositionId` };
    }
    if (a.usingPositionId !== undefined && a.usingPositionId !== null && typeof a.usingPositionId !== 'string') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${a.airspaceId}'s usingPositionId must be a string when present` };
    }
    for (const key of ['workingFrequencyMhz', 'controlFrequencyMhz']) {
      if (a[key] !== undefined && a[key] !== null && !isValidFrequency(a[key])) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: `${a.airspaceId}'s ${key} must be a number between ${MIN_FREQUENCY_MHZ} and ${MAX_FREQUENCY_MHZ} MHz` };
      }
    }
    for (const key of ['altLowerFt', 'altUpperFt']) {
      if (a[key] !== undefined && a[key] !== null && !isValidAltitude(a[key])) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: `${a.airspaceId}'s ${key} must be a whole number of feet between ${MIN_ALTITUDE_FT} and ${MAX_ALTITUDE_FT}` };
      }
    }
    if (isValidAltitude(a.altLowerFt) && isValidAltitude(a.altUpperFt) && a.altUpperFt <= a.altLowerFt) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${a.airspaceId}'s altUpperFt must be above its altLowerFt` };
    }
  }
  return { ok: true };
}

// Ships empty. The real MOAs, ranges, owning authorities and frequencies are
// squadron data the project owner supplies; an invented default would be
// exactly the [SOURCE-DEFINED]-presented-as-doctrine trap D11 names.
const DEFAULT_AIRSPACES = [];

function _load() {
  try {
    const onDisk = JSON.parse(fs.readFileSync(AIRSPACES_PATH, 'utf8'));
    const check = validateAirspaces(onDisk);
    if (!check.ok) {
      console.warn('[efsp-airspace-config] on-disk airspaces failed validation, using defaults:', check.detail);
      return deepClone(DEFAULT_AIRSPACES);
    }
    return onDisk;
  } catch (e) {
    console.warn('[efsp-airspace-config] no airspaces config loaded, using defaults:', e.message);
    return deepClone(DEFAULT_AIRSPACES);
  }
}

let airspaces = _load();

function getAirspaces() { return deepClone(airspaces); }

function getAirspace(airspaceId) {
  const found = airspaces.find(a => a.airspaceId === airspaceId);
  return found ? deepClone(found) : null;
}

/**
 * Every distinct `usingPositionId` across the configured airspaces — the
 * `RANGES` Facility's Position set. A range with no control of its own
 * contributes nothing, which is the whole point: Positions exist only where
 * somebody actually controls a range.
 */
function getRangePositionIds() {
  const ids = [];
  for (const a of airspaces) {
    if (a.usingPositionId && !ids.includes(a.usingPositionId)) ids.push(a.usingPositionId);
  }
  return ids;
}

/** The airspaces a given range Position is responsible for. */
function airspacesForUsingPosition(positionId) {
  return deepClone(airspaces.filter(a => a.usingPositionId === positionId));
}

/**
 * Replaces the whole airspace list (guide §8.4 — an explicit reload step, not
 * a live mutation). No editing UI calls this yet; it exists so one is
 * additive later, and so tests can exercise the load path.
 */
function setAirspaces(next) {
  const check = validateAirspaces(next);
  if (!check.ok) return check;
  airspaces = deepClone(next);
  try {
    ensureDirFor(AIRSPACES_WRITE_PATH);
    fs.writeFileSync(AIRSPACES_WRITE_PATH, JSON.stringify(airspaces, null, 2));
  } catch (e) {
    console.warn('[efsp-airspace-config] failed to persist airspaces:', e.message);
  }
  return { ok: true };
}

module.exports = {
  getAirspaces, getAirspace, getRangePositionIds,
  setAirspaces, validateAirspaces, isValidFrequency, isValidAltitude,
  AIRSPACE_TYPES, MIN_FREQUENCY_MHZ, MAX_FREQUENCY_MHZ,
  MIN_ALTITUDE_FT, MAX_ALTITUDE_FT,
};
