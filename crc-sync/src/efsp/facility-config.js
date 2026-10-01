'use strict';

// Facility adaptation layer (EFSPImplementationGuide.md §8) — Position set,
// Bay/Rack definitions, the covering chain, and the Bay-implies-State
// mapping. Persisted JSON config, same pattern as theater-settings.js/
// apt-config.js: loaded once, at the first use (load()), mutated and re-persisted
// through setters, survives a crc-sync restart. "The configurability is the
// specification" (§8.1) — even though this module ships no facility-config
// *editing* UI, the load/persist path exists from the start so a future
// editor is additive, not a retrofit.
//
// WP4A (docs/adr/0013) added a second Facility, `CENTER` (Ankara Center,
// Position `CTR`) — every exported function now takes an OPTIONAL trailing
// `facilityId` parameter defaulting to DEFAULT_FACILITY_ID ('INCIRLIK'), so
// every zero-arg call site that predates WP4A keeps compiling and behaving
// identically. `configs` is a Map keyed by facilityId rather than a single
// module-level object — see docs/adr/0013-facility-config-multi-facility.md.
//
// Bay sets below are the guide's own §4.2 defaults, restricted to the
// Positions each Facility actually has. Each ATC Position's `Coordination`
// Bay was present-but-inert through Phase 2 (guide §16's build-sequencing
// note: "an empty-but-present Coordination Bay" is the WP4A seam) — it's
// now genuinely used by the 5 new coordination-primitive Mutations
// (permission.js's OP_KINDS) to land a proposed cross-Facility Strip
// replica. `bayImpliesState` (guide §3.5 rule 4 / §2 "Bay membership
// expresses operational state") only covers Bays whose name cleanly maps to
// one EfspState — Filed/Taxi In/Arrivals/every Coordination Bay have none.

const fs = require('fs');
const fieldState = require('./field-state'); // pure, requires nothing back (docs/adr/0061)
const schema = require('./facility-schema');
const { validateConfig, validateRadarSelector, validateSfaRotationRecord, BAY_VIEWS } = schema;
// Required BEFORE this module builds its configs Map: the RANGES Facility's
// Position set is derived from the airspace definitions (see
//  airspace-config.js deliberately does not require
// this module back, so there is no cycle.
const airspaceConfig = require('./airspace-config');
const path = require('path');
const { CONFIG_DIR, readPath, writePath, ensureDirFor } = require('../state-paths');
const log = require('../log').logger('efsp:facility-config');

const DEFAULT_FACILITY_ID = 'INCIRLIK';

// Overridable so tests exercise the mutate/persist path against a temp
// file — same pattern as theater-settings.js's CRCSYNC_THEATER_SETTINGS_PATH.
// One env var per Facility, so a test can override either (or both)
// independently without the two Facilities' on-disk state colliding.
// `setFacilityConfig` rewrites these, so each has a read path (data/ if a live
// copy exists, else the shipped default) and a write path (always data/) — see
// state-paths.js for why that split exists at all.
const FACILITY_CONFIG_FILES = {
  INCIRLIK: ['efsp-facility-incirlik.json', undefined], // set by load()
  CENTER: ['efsp-facility-center.json', undefined], // set by load()
  // WP4A second slice — the TACTICAL Facility (docs/adr/0013's pattern
  // repeated for a third Facility).
  TACTICAL: ['efsp-facility-tactical.json', undefined], // set by load()
  // docs/adr/0074 — the CARRIER Facility (docs/adr/0064 B1).
  CARRIER: ['efsp-facility-carrier.json', undefined], // set by load()
};

/** Kept as a name->path map for any existing reader; resolved fresh per call. */
const FACILITY_CONFIG_PATHS = new Proxy({}, {
  get: (_t, facilityId) => {
    const entry = FACILITY_CONFIG_FILES[facilityId];
    return entry ? writePath(entry[0], entry[1]) : undefined;
  },
  has: (_t, facilityId) => facilityId in FACILITY_CONFIG_FILES,
  ownKeys: () => Object.keys(FACILITY_CONFIG_FILES),
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});

// RANGES is deliberately absent from the path table above: its Position set
// is DERIVED from airspace-config.js, so an on-disk override would freeze a
// `positions` array that then silently goes stale the moment an airspace is
// added or removed. Deriving it every boot is the whole point — there is
// nothing here a facility config could usefully say. Also spares a
// load-failure warning on every startup for a file that should never exist.
const DERIVED_FACILITY_IDS = new Set(['RANGES']);


// The shipped Facilities are config/efsp-facility-<id>.json (docs/wip/DATA-1.md): the code
// holds rules, never the Facility's own data. RANGES alone is derived, below.
const SHIPPED_FACILITY_IDS = ['INCIRLIK', 'CENTER', 'TACTICAL', 'CARRIER'];


// The RANGES Facility (guide §4.1's fifth Facility, §4.1 rule 2). Unlike
// every Facility above it, this one's Position set is DERIVED rather than
// listed: a `RANGE` Position exists only for an airspace that has real
// control of its own (airspace-config.js's usingPositionId). An ordinary MOA
// contributes no Position at all — a flight working inside one is approved
// onto a working frequency by whichever ATC Position owns the airspace, and
// there is nobody else to be.
//
// `bays` is empty and stays empty. §4.1: "RANGE works no Strips... Give it a
// Field State board", §4.2: "Airspace board (not a strip rack)". Its board is
// airspace-store.js, which is not a Bay of Strips, so there is nothing for
// getAllBays() to return here — and because the client builds its Position
// tabs from Bays, a range Position correctly never grows a strip-rack tab.
//
// Absent from `coveringChain` deliberately: the chain exists to re-route
// Strips away from a vacated Position (defect D19), and a Position that owns
// no Strips has none to strand.
function _rangesConfig() {
  return {
    facility: 'RANGES',
    positions: airspaceConfig.getRangePositionIds(),
    positionClasses: Object.fromEntries(
      airspaceConfig.getRangePositionIds().map(id => [id, 'USING_AGENCY'])
    ),
    coveringChain: {},
    positionLetters: {},
    // `hiddenBlocks`, not the `blockVisibility` inclusion list docs/adr/0041
    // replaced — this config is derived and never persisted, so the stale key
    // was inert, but leaving it here invited the next reader to copy it.
    hiddenBlocks: {},
    // §4.1 rule 2: a range Position is the using agency and owns airspace state,
    // not a scope. No selectors, and none derived either — unlike `positions`,
    // there is nothing in the airspace config that describes a radar.
    positionRadars: {},
    bays: {},
    dataOnly: false,
    standingReleases: [],
    aitAuthorized: false,
  };
}

/** One Facility's shipped config (config/, never state/), a fresh copy. For tests and tools that need the pristine file. */
function getShippedConfig(facilityId) {
  if (DERIVED_FACILITY_IDS.has(facilityId)) return _rangesConfig();
  return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, FACILITY_CONFIG_FILES[facilityId][0]), 'utf8'));
}

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }


// A missing or invalid facility file is a startup error, never a silent fall back to something else
// (S-ARCH2 (12)): the shipped JSON is the only source of a Facility's data, a copy in state/ or at an
// override path replaces it WHOLE (no key-by-key merge), and what it says must pass the schema.
function _loadOne(facilityId) {
  if (DERIVED_FACILITY_IDS.has(facilityId)) return _rangesConfig();
  const [name, override] = FACILITY_CONFIG_FILES[facilityId];
  const file = _readFrom(name, override);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`[efsp-facility-config] ${facilityId}: cannot read its facility file ${file} (looked at the override, state/ and config/): ${e.message}`);
  }
  // `blockVisibility` was the inclusion list `hiddenBlocks` replaced (docs/adr/0041). No handling is left (ARCH-D5):
  // a file that still has one is an old file, and stops start-up rather than being half read.
  if (config && config.blockVisibility !== undefined) {
    throw new Error(`[efsp-facility-config] ${facilityId}: ${file} still has a "blockVisibility" list, which was replaced by "hiddenBlocks" (docs/adr/0041): restate any narrowing as hiddenBlocks, or delete the file to use the shipped one`);
  }
  const check = schema.validateFacilityConfig(config, facilityId);
  if (!check.ok) throw new Error(`[efsp-facility-config] ${facilityId}: ${file} is not a valid facility config: ${check.detail}`);
  for (const warning of fieldState.runwayInventoryWarnings(config)) {
    log.warn(warning, { facilityId });
  }
  return config;
}

// The file's read path: the override if one is set and exists, else the live copy in state/, else the shipped
// config/ file. (state-paths.js's readPath returns an override whether or not it exists; tests point the
// overrides at temp files that do not.) Writes always go to the override or state/ — FACILITY_CONFIG_PATHS.
function _readFrom(name, override) {
  return override && fs.existsSync(override) ? override : readPath(name);
}

// The facilities, built on first use (or by an explicit load()), never at require time. `null` until then.
let configs = null;

/**
 * Reads every Facility's config. Idempotent: a second call is a no-op unless `reload` is set, because
 * setFacilityConfig changes the live Map and createEfsp may be called more than once in a process.
 * The env overrides are read here, not at require time.
 */
function load({ reload = false } = {}) {
  if (configs && !reload) return;
  FACILITY_CONFIG_FILES.INCIRLIK[1] = process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH;
  FACILITY_CONFIG_FILES.CENTER[1] = process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER;
  FACILITY_CONFIG_FILES.TACTICAL[1] = process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL;
  FACILITY_CONFIG_FILES.CARRIER[1] = process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CARRIER;
  const loaded = new Map();
  for (const id of [...SHIPPED_FACILITY_IDS, ...DERIVED_FACILITY_IDS]) loaded.set(id, _loadOne(id));
  configs = loaded;
}

function _configs() { load(); return configs; }

function _persist(facilityId) {
  if (DERIVED_FACILITY_IDS.has(facilityId)) return; // see DERIVED_FACILITY_IDS
  try {
    const target = FACILITY_CONFIG_PATHS[facilityId];
    ensureDirFor(target);
    fs.writeFileSync(target, JSON.stringify(_configs().get(facilityId), null, 2));
  } catch (e) {
    log.warn('failed to persist facility config', { facilityId, error: e.message });
  }
}

/** Every Facility this server knows about — index.js's composition root iterates this to build one {boardStore, positionStore} pair per Facility, generically (no hard-coded facility count). */
function getFacilityIds() { return [..._configs().keys()]; }

function getFacilityConfig(facilityId = DEFAULT_FACILITY_ID) { return deepClone(_configs().get(facilityId)); }

function getPositionSet(facilityId = DEFAULT_FACILITY_ID) { return [...(_configs().get(facilityId).positions)]; }

function getCoveringChain(facilityId = DEFAULT_FACILITY_ID) { return { ...(_configs().get(facilityId).coveringChain) }; }

/**
 * WP4A second slice — a Position's doctrinal class (guide §4.1's own Class
 * column: MILITARY_ATC/CIVIL_ATC/BASOPS/MRU/MRU_POSITION/NON_ATC/...),
 * permission.js's structural basis for D12 (an MRU/non-ATC Position must
 * never be granted a cross-Facility ATC coordination primitive, regardless
 * of any other Position the same controller also holds). Searches every
 * known Facility's own positionClasses map, not just one — Position IDs
 * are globally unique across Facilities in this slice (permission.js's own
 * header comment), so a caller never needs to know which Facility a
 * Position belongs to just to ask its class. Returns null for a Position
 * with no class recorded anywhere (not an error — a config predating this
 * field, or a genuinely classless test fixture).
 */
function getPositionClass(positionId) {
  for (const config of _configs().values()) {
    const classes = config.positionClasses || {};
    if (Object.prototype.hasOwnProperty.call(classes, positionId)) return classes[positionId];
  }
  return null;
}

/** The one character an ATC scope draws for a contact this Position owns (docs/adr/0088); null when none is configured. */
function getPositionLetter(positionId) {
  for (const config of _configs().values()) {
    const letters = config.positionLetters || {};
    if (Object.prototype.hasOwnProperty.call(letters, positionId)) return letters[positionId];
  }
  return null;
}

/** Every Facility's position letters, `{ facilityId: { positionId: letter } }` — sent in the EFSP snapshot (docs/adr/0088). */
function allPositionLetters() {
  const out = {};
  for (const [facilityId, config] of _configs()) out[facilityId] = { ...(config.positionLetters || {}) };
  return out;
}

/**
 * A Position's radar selectors (docs/adr/0043). Empty for a Position with no
 * scope — Ground and Clearance Delivery genuinely have none, and that is the
 * answer, not a gap.
 */
function getPositionRadars(positionId, facilityId = DEFAULT_FACILITY_ID) {
  const config = _configs().get(facilityId);
  if (!config) return [];
  return deepClone((config.positionRadars || {})[positionId] || []);
}

/** Every Position, anywhere, that has at least one radar selector — what the coverage panel calls a "radar Position". */
function radarBearingPositionIds() {
  const out = [];
  for (const config of _configs().values()) {
    for (const [positionId, selectors] of Object.entries(config.positionRadars || {})) {
      if (Array.isArray(selectors) && selectors.length) out.push(positionId);
    }
  }
  return out;
}

function getBaysFor(positionId, facilityId = DEFAULT_FACILITY_ID) {
  return deepClone(_configs().get(facilityId).bays[positionId] || []);
}

/**
 * May this Facility write this Block on this Role? (guide §8.1 — "the
 * configurability is the specification.")
 *
 * Expressed as what a Facility HIDES, not what it shows. The original shape
 * was an inclusion list, which looked equivalent and was not: a persisted
 * list is a snapshot of "everything that existed the day it was written", so
 * every Block invented afterwards silently fell outside it. The shipped
 * configs had frozen lists from before the separation-model Blocks existed,
 * which meant `IFR`/`RSVC`/`SREG` were unwritable on the real server — and
 * since completing a TOFI exit requires setting `SREG` to ATC, tactical
 * control could be entered and never left. The release Blocks 14A/14D and
 * the frequency Block 22 were caught the same way. Tests never saw it
 * because they build config from the defaults, which are derived from the
 * Block Map and so are always current.
 *
 * An exclusion list cannot drift that way: a new Block is visible until
 * somebody deliberately hides it.
 */
function isBlockVisible(role, blockId, facilityId = DEFAULT_FACILITY_ID) {
  const config = _configs().get(facilityId);
  if (!config) return true;
  const hidden = (config.hiddenBlocks || {})[role];
  return !hidden || !hidden.includes(blockId);
}

// Includes each Bay's owning positionId — lost by a plain Object.values()
// flatten otherwise, and the client needs it to keep Bays "grouped by
// Position, never merged into one undifferentiated pile" (guide §4.8.5
// rule 2). Also stamps facilityId, since a client can now hold Positions
// across both Facilities and needs to know which Board a Bay belongs to.
function getAllBays(facilityId = DEFAULT_FACILITY_ID) {
  const out = [];
  for (const [positionId, bays] of Object.entries(_configs().get(facilityId).bays)) {
    for (const bay of bays) out.push({ ...deepClone(bay), positionId, facilityId });
  }
  return out;
}

/**
 * Is this a Bay this Facility actually has?
 *
 * Nothing checked until a scenario created a Strip in `ctr-overflights` when
 * the Bay is `ctr-overflight`: the Strip was created, took a beacon code, and
 * appeared in no Rack on any Board — invisible and unrecoverable, because
 * every read path goes through a Bay. A typo in a client, or a stale bayId
 * after a config change, produced a ghost.
 */
function bayExists(bayId, facilityId = DEFAULT_FACILITY_ID) {
  return getAllBays(facilityId).some(b => b.bayId === bayId);
}

/** One Bay's descriptor (bayId, rackIds, impliesState, and the `view` / `capacity` flags), with its positionId, or null. */
function getBay(bayId, facilityId = DEFAULT_FACILITY_ID) {
  return getAllBays(facilityId).find(b => b.bayId === bayId) || null;
}

/** A Facility's SFA pool config (guide §4.7), or null when it has none (every Facility but INCIRLIK). */
function getSingleFrequencyApproach(facilityId = DEFAULT_FACILITY_ID) {
  const config = _configs().get(facilityId);
  return config && config.singleFrequencyApproach ? deepClone(config.singleFrequencyApproach) : null;
}

/** A Bay's configured implied EfspState (guide §3.5 rule 4), or null if the Bay doesn't imply one. */
function bayImpliesState(bayId, facilityId = DEFAULT_FACILITY_ID) {
  const bay = getAllBays(facilityId).find(b => b.bayId === bayId);
  return (bay && bay.impliesState) || null;
}

/**
 * Replaces one Facility's whole config (an explicit reload step, guide
 * §8.4 — "a live Board MUST NOT be mutated by a configuration change
 * without an explicit reload"). `next` is the whole file and is checked as one
 * (facility-schema.js's validateFacilityConfig); nothing is merged in from the
 * shipped copy. No editing UI calls this yet; it exists so
 * one is additive later, and so tests can exercise the persist path.
 */
function setFacilityConfig(next, facilityId = DEFAULT_FACILITY_ID) {
  if (!next || typeof next !== 'object') return false;
  if (DERIVED_FACILITY_IDS.has(facilityId)) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `${facilityId}'s Positions are derived from the airspace config — edit that instead` };
  }
  if (!_configs().has(facilityId)) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown facilityId ${facilityId}` };
  const whole = deepClone(next);
  const check = schema.validateFacilityConfig(whole, facilityId);
  if (!check.ok) return check; // {ok:false, reason:'VALIDATION_ERROR', detail} — rejected, not persisted
  _configs().set(facilityId, whole);
  _persist(facilityId);
  return true;
}

/** The Bay whose configured impliesState matches `state` for a Position, or that Position's first Bay as a defensive fallback (guide §3.5 rule 4 accelerator target). */
function bayForImpliedState(positionId, state, facilityId = DEFAULT_FACILITY_ID) {
  const bays = getBaysFor(positionId, facilityId);
  // The fallback never lands on a Role Bay (`holdsRole`, docs/adr/0087): that Bay belongs to one Role, and a caller
  // that gets it back for another Role's Strip files the Strip under the wrong Role.
  return bays.find(b => b.impliesState === state) || bays.find(b => !b.holdsRole) || null;
}

/** The Role a Bay is reserved for (`holdsRole`, docs/adr/0087), or null for an ordinary Bay. */
function bayHoldsRole(bayId, facilityId = DEFAULT_FACILITY_ID) {
  const bay = getAllBays(facilityId).find(b => b.bayId === bayId);
  return (bay && bay.holdsRole) || null;
}

/**
 * The Bay a proposed cross-Facility coordination replica lands in for a
 * Position (WP4A, docs/adr/0015) — the Bay whose id ends '-coordination',
 * present-but-inert for every Position since Phase 2 (guide §16's build-
 * sequencing note) and now genuinely used by HANDOFF/POINT_OUT/TRAFFIC/
 * OPERATIONAL_REQUEST/AIT's PROPOSE action. Returns null if the Position
 * has no Coordination Bay configured (board-store.js treats that as "this
 * Position cannot receive a coordination proposal at all").
 */
function coordinationBayFor(positionId, facilityId = DEFAULT_FACILITY_ID) {
  const bays = getBaysFor(positionId, facilityId);
  return bays.find(b => b.bayId.endsWith('-coordination')) || null;
}

module.exports = {
  DEFAULT_FACILITY_ID, getFacilityIds,
  getFacilityConfig, getPositionSet, getPositionClass, getPositionLetter, allPositionLetters, getCoveringChain, getBaysFor, getAllBays, isBlockVisible,
  getPositionRadars, radarBearingPositionIds, validateRadarSelector,
  bayImpliesState, bayHoldsRole, bayForImpliedState, bayExists, coordinationBayFor, setFacilityConfig, validateConfig,
  getBay, getSingleFrequencyApproach, validateSfaRotationRecord, BAY_VIEWS,
  getShippedConfig, load,
};
