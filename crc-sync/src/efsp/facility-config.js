'use strict';

// Facility adaptation layer (EFSPImplementationGuide.md §8) — Position set,
// Bay/Rack definitions, the covering chain, and the Bay-implies-State
// mapping, for the one Facility Phase 1 builds (`INCIRLIK`). Persisted
// JSON config, same pattern as theater-settings.js/apt-config.js: loaded
// once at require time, mutated and re-persisted through setters, survives
// a crc-sync restart. "The configurability is the specification" (§8.1) —
// even though Phase 1 ships no facility-config *editing* UI, the load/
// persist path exists from the start so a future editor is additive, not
// a retrofit.
//
// Bay sets below are the guide's own §4.2 defaults, restricted to Phase
// 1's four Positions. Each Position's `Coordination` Bay is present but
// inert (guide §16's build-sequencing note: "an empty-but-present
// Coordination Bay" is the WP4A seam, not something to populate yet).
// `bayImpliesState` (guide §3.5 rule 4 / §2 "Bay membership expresses
// operational state") only covers Bays whose name cleanly maps to one
// EfspState — Filed/Taxi In/Arrivals/every Coordination Bay have none.

const fs = require('fs');
const path = require('path');
const blockMap = require('./block-map');

// Overridable so tests exercise the mutate/persist path against a temp
// file — same pattern as theater-settings.js's CRCSYNC_THEATER_SETTINGS_PATH.
const FACILITY_CONFIG_PATH = process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH
  || path.join(__dirname, '../../config/efsp-facility-incirlik.json');

const DEFAULT_CONFIG = {
  facility: 'INCIRLIK',
  positions: ['OPS', 'CD', 'GND', 'TWR', 'APP'],
  // Un-truncated at TWR->APP now that APP is a real Position (Phase 2,
  // docs/adr/0007) — matches the guide's default chain table (§4.8.6 rule
  // 2) up to APP; OPS and APP have no covering Position (APP is the end of
  // this Facility's chain until WP4A adds CTR).
  coveringChain: { CD: 'GND', GND: 'TWR', TWR: 'APP' },
  // Per-role visible-Block set (guide §8.2/§8.3) — defaults to "every Block
  // block-map.js defines for that role", i.e. nothing is hidden by default.
  // A facility MAY narrow this (e.g. omit optional 9A sub-fields), but
  // validateConfig() below enforces the doctrinal exceptions (every
  // required Block MUST stay visible) rather than just checking shape.
  blockVisibility: {
    DEPARTURE: Object.keys(blockMap.DEPARTURE_BLOCK_MAP),
    ARRIVAL: Object.keys(blockMap.ARRIVAL_BLOCK_MAP),
  },
  bays: {
    OPS: [
      { bayId: 'ops-filed',    rackIds: ['main'] },
      { bayId: 'ops-proposed', rackIds: ['main'], impliesState: 'PROPOSED' },
      { bayId: 'ops-field-state',   rackIds: ['main'] }, // WP6 hook, inert in Phase 2
      { bayId: 'ops-coordination',  rackIds: ['main'] }, // WP4A hook, inert in Phase 2
    ],
    CD: [
      { bayId: 'cd-pending-clearance', rackIds: ['main'], impliesState: 'PENDING_CLEARANCE' },
      { bayId: 'cd-cleared',           rackIds: ['main'], impliesState: 'CLEARED' },
      { bayId: 'cd-held',              rackIds: ['main'], impliesState: 'HELD' },
      { bayId: 'cd-coordination',      rackIds: ['main'] },
    ],
    GND: [
      { bayId: 'gnd-pushback', rackIds: ['main'], impliesState: 'PUSHBACK' },
      { bayId: 'gnd-taxi-out', rackIds: ['main'], impliesState: 'TAXI' },
      { bayId: 'gnd-taxi-in',  rackIds: ['main'], impliesState: 'TAXI_IN' }, // ARRIVAL role, now populated (Phase 2)
      { bayId: 'gnd-coordination', rackIds: ['main'] },
    ],
    TWR: [
      { bayId: 'twr-runway-queue', rackIds: ['rwy-05', 'rwy-23'], impliesState: 'RUNWAY_QUEUE' }, // one Rack per runway, guide §4.2
      { bayId: 'twr-airborne',     rackIds: ['main'], impliesState: 'DEPARTED' },
      { bayId: 'twr-arrivals',     rackIds: ['main'], impliesState: 'HANDED_TO_TOWER' }, // ARRIVAL role, now populated (Phase 2)
      // NOTE: EfspState 'FINAL' (this Bay's implied state, on strip.state)
      // is unrelated to Strip Role 'FINAL' (guide §7.10's PAR/carrier
      // role, WP7A, still unbuilt — lives on strip.role) — see nla.js's
      // module comment. Don't conflate them when WP7A eventually lands.
      { bayId: 'twr-final',        rackIds: ['main'], impliesState: 'FINAL' },  // ARRIVAL role (Phase 2)
      { bayId: 'twr-landed',       rackIds: ['main'], impliesState: 'LANDED' }, // ARRIVAL role (Phase 2)
      { bayId: 'twr-coordination', rackIds: ['main'] },
    ],
    APP: [
      { bayId: 'app-inbound',      rackIds: ['main'], impliesState: 'INBOUND' },   // ARRIVAL Strips APP originates (docs/adr/0008 stub) or receives
      { bayId: 'app-departures',   rackIds: ['main'], impliesState: 'HANDED_OFF' }, // receives DEPARTURE Strips from TWR's real Hand Off (docs/adr/0007)
      { bayId: 'app-coordination', rackIds: ['main'] }, // WP4A hook (APP<->CTR), inert in Phase 2 — matches every other Position's pattern
    ],
  },
};

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

/**
 * Validates a candidate facility config (guide §8.3): every required Block
 * for each role in `blockVisibility` MUST stay visible, and every Bay's
 * owning Position MUST exist in the Position set (rule 3). Returns
 * {ok:true} or {ok:false, reason:'VALIDATION_ERROR', detail}.
 */
function validateConfig(candidate) {
  for (const role of Object.keys(candidate.blockVisibility || {})) {
    const result = blockMap.validateFacilityConfig({ role, visibleBlocks: candidate.blockVisibility[role] });
    if (!result.ok) return result;
  }
  for (const positionId of Object.keys(candidate.bays || {})) {
    if (!(candidate.positions || []).includes(positionId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `Bay set references unknown Position ${positionId}` };
    }
  }
  return { ok: true };
}

let config = deepClone(DEFAULT_CONFIG);
try {
  const onDisk = JSON.parse(fs.readFileSync(FACILITY_CONFIG_PATH, 'utf8'));
  const merged = { ...deepClone(DEFAULT_CONFIG), ...onDisk };
  const check = validateConfig(merged);
  if (!check.ok) {
    console.warn('[efsp-facility-config] on-disk config failed validation, using defaults:', check.detail);
  } else {
    config = merged;
  }
} catch (e) {
  console.warn('[efsp-facility-config] failed to load config/efsp-facility-incirlik.json, using defaults:', e.message);
}

function _persist() {
  try {
    fs.writeFileSync(FACILITY_CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.warn('[efsp-facility-config] failed to persist config/efsp-facility-incirlik.json:', e.message);
  }
}

function getFacilityConfig() { return deepClone(config); }

function getPositionSet() { return [...config.positions]; }

function getCoveringChain() { return { ...config.coveringChain }; }

function getBaysFor(positionId) { return deepClone(config.bays[positionId] || []); }

// Includes each Bay's owning positionId — lost by a plain Object.values()
// flatten otherwise, and the client needs it to keep Bays "grouped by
// Position, never merged into one undifferentiated pile" (guide §4.8.5
// rule 2).
function getAllBays() {
  const out = [];
  for (const [positionId, bays] of Object.entries(config.bays)) {
    for (const bay of bays) out.push({ ...deepClone(bay), positionId });
  }
  return out;
}

/** A Bay's configured implied EfspState (guide §3.5 rule 4), or null if the Bay doesn't imply one. */
function bayImpliesState(bayId) {
  const bay = getAllBays().find(b => b.bayId === bayId);
  return (bay && bay.impliesState) || null;
}

/**
 * Replaces the whole config (an explicit reload step, guide §8.4 — "a live
 * Board MUST NOT be mutated by a configuration change without an explicit
 * reload"). Phase 1 has no editing UI calling this yet; it exists so one
 * is additive later, and so tests can exercise the persist path.
 */
function setFacilityConfig(next) {
  if (!next || typeof next !== 'object') return false;
  const merged = { ...deepClone(DEFAULT_CONFIG), ...deepClone(next) };
  const check = validateConfig(merged);
  if (!check.ok) return check; // {ok:false, reason:'VALIDATION_ERROR', detail} — rejected, not persisted
  config = merged;
  _persist();
  return true;
}

/** The Bay whose configured impliesState matches `state` for a Position, or that Position's first Bay as a defensive fallback (guide §3.5 rule 4 accelerator target). */
function bayForImpliedState(positionId, state) {
  const bays = getBaysFor(positionId);
  return bays.find(b => b.impliesState === state) || bays[0] || null;
}

module.exports = {
  getFacilityConfig, getPositionSet, getCoveringChain, getBaysFor, getAllBays,
  bayImpliesState, bayForImpliedState, setFacilityConfig, validateConfig, DEFAULT_CONFIG,
};
