'use strict';

// Facility adaptation layer (EFSPImplementationGuide.md §8) — Position set,
// Bay/Rack definitions, the covering chain, and the Bay-implies-State
// mapping. Persisted JSON config, same pattern as theater-settings.js/
// apt-config.js: loaded once at require time, mutated and re-persisted
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
const blockMap = require('./block-map');
const fieldState = require('./field-state'); // pure, requires nothing back (docs/adr/0061)
const { validateAlertPadConfig } = require('./alert-scramble'); // pure (docs/adr/0070)
// Required BEFORE this module builds its configs Map: the RANGES Facility's
// Position set is derived from the airspace definitions (see
// RANGES_CONFIG). airspace-config.js deliberately does not require
// this module back, so there is no cycle.
const airspaceConfig = require('./airspace-config');
const path = require('path');
const { CONFIG_DIR, readPath, writePath, ensureDirFor } = require('../state-paths');

const DEFAULT_FACILITY_ID = 'INCIRLIK';

// Overridable so tests exercise the mutate/persist path against a temp
// file — same pattern as theater-settings.js's CRCSYNC_THEATER_SETTINGS_PATH.
// One env var per Facility, so a test can override either (or both)
// independently without the two Facilities' on-disk state colliding.
// `setFacilityConfig` rewrites these, so each has a read path (data/ if a live
// copy exists, else the shipped default) and a write path (always data/) — see
// state-paths.js for why that split exists at all.
const FACILITY_CONFIG_FILES = {
  INCIRLIK: ['efsp-facility-incirlik.json', process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH],
  CENTER: ['efsp-facility-center.json', process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER],
  // WP4A second slice — the TACTICAL Facility (docs/adr/0013's pattern
  // repeated for a third Facility).
  TACTICAL: ['efsp-facility-tactical.json', process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL],
  // docs/adr/0074 — the CARRIER Facility (docs/adr/0064 B1).
  CARRIER: ['efsp-facility-carrier.json', process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CARRIER],
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
const RANGES_CONFIG = {
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

// The shipped defaults, read from config/ (never state/). Step 1 of docs/wip/DATA-1.md keeps the
// old "defaults, overlaid by the on-disk copy" semantics with the JSON as the defaults; the
// behaviour commit that follows removes the overlay.
const DEFAULT_CONFIGS = Object.fromEntries([
  ...SHIPPED_FACILITY_IDS.map(id => [id, JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, FACILITY_CONFIG_FILES[id][0]), 'utf8'))]),
  ['RANGES', RANGES_CONFIG],
]);

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

/**
 * Validates a candidate facility config (guide §8.3): every required Block
 * for each role in `blockVisibility` MUST stay visible, and every Bay's
 * owning Position MUST exist in the Position set (rule 3). Facility-
 * agnostic — operates on whichever candidate object is passed in. Returns
 * {ok:true} or {ok:false, reason:'VALIDATION_ERROR', detail}.
 */
function validateConfig(candidate) {
  // The doctrinal check is unchanged (guide §8.3: every REQUIRED Block MUST
  // stay visible) — only the direction it reads from. What a Facility hides
  // is subtracted from the Block Map, and the remainder still has to contain
  // every required Block.
  for (const role of Object.keys(candidate.hiddenBlocks || {})) {
    const all = Object.keys(blockMap.BLOCK_MAPS[role] || {});
    const visibleBlocks = all.filter(b => !candidate.hiddenBlocks[role].includes(b));
    const result = blockMap.validateFacilityConfig({ role, visibleBlocks });
    if (!result.ok) return result;
  }
  for (const positionId of Object.keys(candidate.bays || {})) {
    if (!(candidate.positions || []).includes(positionId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `Bay set references unknown Position ${positionId}` };
    }
  }
  for (const [positionId, letter] of Object.entries(candidate.positionLetters || {})) {
    if (!(candidate.positions || []).includes(positionId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `positionLetters references unknown Position ${positionId}` };
    }
    if (typeof letter !== 'string' || !/^[A-Z0-9]$/.test(letter)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `positionLetters.${positionId} must be one character A-Z or 0-9` };
    }
  }
  for (const positionId of Object.keys(candidate.positionClasses || {})) {
    if (!(candidate.positions || []).includes(positionId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `positionClasses references unknown Position ${positionId}` };
    }
  }
  // Radar selectors are checked for SHAPE only, not for resolving to anything.
  // A selector naming an airfield this theater does not have is legitimate —
  // the same config has to work across theaters — so an unresolvable selector
  // is a startup warning (index.js's _validateRadarSelectors, following
  // _validateAirspaceReferences), never a config rejection. A malformed one is
  // a different matter: it can never resolve in any theater.
  for (const [positionId, selectors] of Object.entries(candidate.positionRadars || {})) {
    if (!(candidate.positions || []).includes(positionId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `positionRadars references unknown Position ${positionId}` };
    }
    if (!Array.isArray(selectors)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `positionRadars.${positionId} must be an array of selectors` };
    }
    for (const selector of selectors) {
      const problem = validateRadarSelector(selector);
      if (problem) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: `positionRadars.${positionId}: ${problem}` };
      }
    }
  }
  const bayProblem = validateBayDescriptors(candidate);
  if (bayProblem) return { ok: false, reason: 'VALIDATION_ERROR', detail: bayProblem };
  if (candidate.singleFrequencyApproach !== undefined) {
    const problem = validateSingleFrequencyApproach(candidate.singleFrequencyApproach, candidate);
    if (problem) return { ok: false, reason: 'VALIDATION_ERROR', detail: problem };
  }
  // The runway inventory (guide §9.7, docs/adr/0061): malformed can never work
  // anywhere, so it is rejected like a malformed radar selector. How it lines
  // up with the Bays only warns — see _loadOne.
  if (candidate.fieldState !== undefined) {
    const problem = fieldState.validateFieldStateInventory(candidate.fieldState, candidate.positions || []);
    if (problem) return { ok: false, reason: 'VALIDATION_ERROR', detail: problem };
  }
  if (candidate.fieldState && candidate.fieldState.pads) {
    const problem = validateAlertPadConfig(candidate.fieldState.pads.alert);
    if (problem) return { ok: false, reason: 'VALIDATION_ERROR', detail: problem };
  }
  return { ok: true };
}

// The Bay descriptor flags (docs/adr/0093). Only these keys beyond bayId/rackIds/
// impliesState exist, so a typo in a config can never silently mount nothing.
const BAY_VIEWS = Object.freeze(['pattern', 'final', 'sfa-freqs']);
// `holdsRole` is L28's (docs/adr/0087): a Bay that files its Role's Strips whatever their state.
const BAY_DESCRIPTOR_KEYS = Object.freeze(['bayId', 'rackIds', 'impliesState', 'view', 'replacesRacks', 'capacity', 'holdsRole']);

/** A human problem string for a malformed Bay descriptor flag (`view`, `capacity`), or null. */
function validateBayDescriptors(candidate) {
  for (const [positionId, bays] of Object.entries(candidate.bays || {})) {
    for (const bay of bays) {
      if (bay.view !== undefined && !BAY_VIEWS.includes(bay.view)) {
        return `bays.${positionId}.${bay.bayId}: unknown view ${JSON.stringify(bay.view)} (one of ${BAY_VIEWS.join(', ')})`;
      }
      if (bay.capacity !== undefined && !(Number.isInteger(bay.capacity) && bay.capacity >= 1)) {
        return `bays.${positionId}.${bay.bayId}: capacity must be a whole number of at least 1`;
      }
      if (bay.replacesRacks !== undefined && (typeof bay.replacesRacks !== 'boolean' || !bay.view)) {
        return `bays.${positionId}.${bay.bayId}: replacesRacks is true or false and needs a view`;
      }
      if (bay.holdsRole !== undefined && (typeof bay.holdsRole !== 'string' || !bay.holdsRole)) {
        return `bays.${positionId}.${bay.bayId}: holdsRole is a Role name`;
      }
      const stray = Object.keys(bay).find(k => !BAY_DESCRIPTOR_KEYS.includes(k));
      if (stray) return `bays.${positionId}.${bay.bayId}: unknown Bay descriptor key ${JSON.stringify(stray)}`;
    }
  }
  return null;
}

// UHF, [SOURCE-DEFINED]: guide §4.7 says "UHF", the squadron's pool lives in 225.000 to 399.975.
const SFA_MIN_MHZ = 225;
const SFA_MAX_MHZ = 399.975;
const SFA_MIN_POOL = 5; // guide §4.7: "at least five discrete UHF frequencies"

/**
 * Guide §4.7's pool, checked as a unit: at least five unique frequencies whose
 * Racks are exactly the SFA Bay's, a rotation smaller than the pool, and APP-style
 * jurisdiction held by a Position of this Facility. Returns a problem string or null.
 */
function validateSingleFrequencyApproach(sfa, candidate) {
  if (!sfa || typeof sfa !== 'object') return 'singleFrequencyApproach must be an object';
  const positions = candidate.positions || [];
  if (!positions.includes(sfa.jurisdiction)) return `singleFrequencyApproach.jurisdiction ${JSON.stringify(sfa.jurisdiction)} is not a Position of this Facility`;
  if (!Array.isArray(sfa.pool) || sfa.pool.length < SFA_MIN_POOL) {
    return `singleFrequencyApproach.pool needs at least ${SFA_MIN_POOL} frequencies (guide §4.7), has ${Array.isArray(sfa.pool) ? sfa.pool.length : 0}`;
  }
  if (!Number.isInteger(sfa.rotationSize) || sfa.rotationSize < 1 || sfa.rotationSize >= sfa.pool.length) {
    return 'singleFrequencyApproach.rotationSize must be a whole number of at least 1 and smaller than the pool';
  }
  const ids = new Set();
  const mhzs = new Set();
  for (const entry of sfa.pool) {
    if (!entry || typeof entry.rackId !== 'string' || !entry.rackId) return 'every singleFrequencyApproach.pool entry needs a rackId';
    if (ids.has(entry.rackId)) return `singleFrequencyApproach.pool repeats rackId ${entry.rackId}`;
    ids.add(entry.rackId);
    if (typeof entry.mhz !== 'number' || !Number.isFinite(entry.mhz) || entry.mhz < SFA_MIN_MHZ || entry.mhz > SFA_MAX_MHZ) {
      return `singleFrequencyApproach.pool ${entry.rackId}: mhz must be a UHF number from ${SFA_MIN_MHZ} to ${SFA_MAX_MHZ}`;
    }
    if (mhzs.has(entry.mhz)) return `singleFrequencyApproach.pool repeats ${entry.mhz} MHz`;
    mhzs.add(entry.mhz);
  }
  const sfaBays = [];
  for (const bays of Object.values(candidate.bays || {})) for (const b of bays) if (b.view === 'sfa-freqs') sfaBays.push(b);
  if (sfaBays.length !== 1) return `exactly one Bay must have view 'sfa-freqs', found ${sfaBays.length}`;
  const bayRacks = sfaBays[0].rackIds || [];
  if (bayRacks.length !== ids.size || !bayRacks.every(r => ids.has(r))) {
    return `the SFA Bay's Racks (${bayRacks.join(', ')}) must be exactly the pool's rackIds (${[...ids].join(', ')})`;
  }
  if (sfa.initialRotation !== undefined) {
    const problem = validateSfaRotationRecord(sfa.initialRotation, sfa, positions);
    if (problem) return `singleFrequencyApproach.initialRotation: ${problem}`;
  }
  return null;
}

/**
 * A rotation record `{ rackId: positionId }` against its config: frequencies
 * from the pool, Positions of the Facility, no more entries than the rotation
 * holds, and one Position on one frequency at a time. Pure; sfa-store.js uses it too.
 */
function validateSfaRotationRecord(record, sfa, positions) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return 'must be an object of rackId to Position';
  const pool = new Set(sfa.pool.map(p => p.rackId));
  const entries = Object.entries(record);
  if (entries.length > sfa.rotationSize) return `at most ${sfa.rotationSize} frequencies are in rotation, got ${entries.length}`;
  const held = new Set();
  for (const [rackId, positionId] of entries) {
    if (!pool.has(rackId)) return `${rackId} is not a pool frequency`;
    if (!positions.includes(positionId)) return `${positionId} is not a Position of this Facility`;
    if (held.has(positionId)) return `${positionId} cannot be on two frequencies at once`;
    held.add(positionId);
  }
  return null;
}

// `datalink` is not a radar: it grants the datalink feed (docs/adr/0059).
const RADAR_SELECTOR_KINDS = new Set(['airport', 'approach', 'awacs', 'fighter', 'carrier', 'datalink']);

/** Returns a human problem string, or null when the selector is well formed. */
function validateRadarSelector(selector) {
  if (!selector || typeof selector !== 'object') return 'a selector must be an object';
  if (!RADAR_SELECTOR_KINDS.has(selector.kind)) {
    return `unknown radar kind ${JSON.stringify(selector.kind)} (one of ${[...RADAR_SELECTOR_KINDS].join(', ')})`;
  }
  if (selector.airport !== undefined && typeof selector.airport !== 'string') {
    return 'airport must be an ICAO/name string, or "*"';
  }
  if (selector.coalition !== undefined && selector.coalition !== 'own' && selector.coalition !== 'any') {
    return 'coalition must be "own" or "any"';
  }
  // An airport selector against an airborne kind cannot mean anything, and a
  // config that says it is confused about what it is asking for.
  if (selector.radar !== undefined && (selector.kind !== 'carrier' || (selector.radar !== 'search' && selector.radar !== 'approach'))) {
    return 'radar ("search" or "approach") applies to a carrier selector only';
  }
  if (selector.hull !== undefined && (selector.kind !== 'carrier' || typeof selector.hull !== 'string')) {
    return 'hull (a hull id string) applies to a carrier selector only';
  }
  if (selector.airport && (selector.kind === 'awacs' || selector.kind === 'fighter' || selector.kind === 'datalink')) {
    return selector.kind === 'datalink'
      ? 'the datalink is a network — an airport selector cannot match it'
      : `${selector.kind} radars are airborne — an airport selector cannot match one`;
  }
  return null;
}

function _loadOne(facilityId) {
  const defaults = DEFAULT_CONFIGS[facilityId];
  let config = deepClone(defaults);
  if (DERIVED_FACILITY_IDS.has(facilityId)) return config;
  try {
    const [name, override] = FACILITY_CONFIG_FILES[facilityId];
    const onDisk = JSON.parse(fs.readFileSync(readPath(name, override), 'utf8'));
    // A `blockVisibility` inclusion list from before this was an exclusion
    // list. Dropped rather than converted: every shipped one was a full set
    // for its day, so it expressed no narrowing at all — converting it would
    // faithfully preserve the accidental hiding of every Block added since,
    // which is the bug. Any genuine narrowing has to be restated as
    // `hiddenBlocks`, and the warning says so.
    if (onDisk.blockVisibility) {
      console.warn(`[efsp-facility-config] ${facilityId}: ignoring a legacy blockVisibility list — express any narrowing as hiddenBlocks instead`);
      delete onDisk.blockVisibility;
    }
    const merged = { ...deepClone(defaults), ...onDisk };
    const check = validateConfig(merged);
    if (!check.ok) {
      console.warn(`[efsp-facility-config] ${facilityId} on-disk config failed validation, using defaults:`, check.detail);
    } else {
      config = merged;
    }
  } catch (e) {
    console.warn(`[efsp-facility-config] failed to load ${facilityId} config, using defaults:`, e.message);
  }
  // After the merged config is chosen, so the shipped defaults are checked too.
  for (const warning of fieldState.runwayInventoryWarnings(config)) {
    console.warn(`[efsp-facility-config] ${facilityId}: ${warning}`);
  }
  return config;
}

const configs = new Map(Object.keys(DEFAULT_CONFIGS).map(id => [id, _loadOne(id)]));

function _persist(facilityId) {
  if (DERIVED_FACILITY_IDS.has(facilityId)) return; // see DERIVED_FACILITY_IDS
  try {
    const target = FACILITY_CONFIG_PATHS[facilityId];
    ensureDirFor(target);
    fs.writeFileSync(target, JSON.stringify(configs.get(facilityId), null, 2));
  } catch (e) {
    console.warn(`[efsp-facility-config] failed to persist ${facilityId} config:`, e.message);
  }
}

/** Every Facility this server knows about — index.js's composition root iterates this to build one {boardStore, positionStore} pair per Facility, generically (no hard-coded facility count). */
function getFacilityIds() { return [...configs.keys()]; }

function getFacilityConfig(facilityId = DEFAULT_FACILITY_ID) { return deepClone(configs.get(facilityId)); }

function getPositionSet(facilityId = DEFAULT_FACILITY_ID) { return [...(configs.get(facilityId).positions)]; }

function getCoveringChain(facilityId = DEFAULT_FACILITY_ID) { return { ...(configs.get(facilityId).coveringChain) }; }

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
  for (const config of configs.values()) {
    const classes = config.positionClasses || {};
    if (Object.prototype.hasOwnProperty.call(classes, positionId)) return classes[positionId];
  }
  return null;
}

/** The one character an ATC scope draws for a contact this Position owns (docs/adr/0088); null when none is configured. */
function getPositionLetter(positionId) {
  for (const config of configs.values()) {
    const letters = config.positionLetters || {};
    if (Object.prototype.hasOwnProperty.call(letters, positionId)) return letters[positionId];
  }
  return null;
}

/** Every Facility's position letters, `{ facilityId: { positionId: letter } }` — sent in the EFSP snapshot (docs/adr/0088). */
function allPositionLetters() {
  const out = {};
  for (const [facilityId, config] of configs) out[facilityId] = { ...(config.positionLetters || {}) };
  return out;
}

/**
 * A Position's radar selectors (docs/adr/0043). Empty for a Position with no
 * scope — Ground and Clearance Delivery genuinely have none, and that is the
 * answer, not a gap.
 */
function getPositionRadars(positionId, facilityId = DEFAULT_FACILITY_ID) {
  const config = configs.get(facilityId);
  if (!config) return [];
  return deepClone((config.positionRadars || {})[positionId] || []);
}

/** Every Position, anywhere, that has at least one radar selector — what the coverage panel calls a "radar Position". */
function radarBearingPositionIds() {
  const out = [];
  for (const config of configs.values()) {
    for (const [positionId, selectors] of Object.entries(config.positionRadars || {})) {
      if (Array.isArray(selectors) && selectors.length) out.push(positionId);
    }
  }
  return out;
}

function getBaysFor(positionId, facilityId = DEFAULT_FACILITY_ID) {
  return deepClone(configs.get(facilityId).bays[positionId] || []);
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
  const config = configs.get(facilityId);
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
  for (const [positionId, bays] of Object.entries(configs.get(facilityId).bays)) {
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
  const config = configs.get(facilityId);
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
 * without an explicit reload"). No editing UI calls this yet; it exists so
 * one is additive later, and so tests can exercise the persist path.
 */
function setFacilityConfig(next, facilityId = DEFAULT_FACILITY_ID) {
  if (!next || typeof next !== 'object') return false;
  if (DERIVED_FACILITY_IDS.has(facilityId)) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `${facilityId}'s Positions are derived from the airspace config — edit that instead` };
  }
  if (!DEFAULT_CONFIGS[facilityId]) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown facilityId ${facilityId}` };
  const merged = { ...deepClone(DEFAULT_CONFIGS[facilityId]), ...deepClone(next) };
  const check = validateConfig(merged);
  if (!check.ok) return check; // {ok:false, reason:'VALIDATION_ERROR', detail} — rejected, not persisted
  configs.set(facilityId, merged);
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
  DEFAULT_CONFIGS,
};
