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
const path = require('path');
const blockMap = require('./block-map');

const DEFAULT_FACILITY_ID = 'INCIRLIK';

// Overridable so tests exercise the mutate/persist path against a temp
// file — same pattern as theater-settings.js's CRCSYNC_THEATER_SETTINGS_PATH.
// One env var per Facility, so a test can override either (or both)
// independently without the two Facilities' on-disk state colliding.
const FACILITY_CONFIG_PATHS = {
  INCIRLIK: process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH
    || path.join(__dirname, '../../config/efsp-facility-incirlik.json'),
  CENTER: process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER
    || path.join(__dirname, '../../config/efsp-facility-center.json'),
};

const DEFAULT_CONFIG = {
  facility: 'INCIRLIK',
  positions: ['OPS', 'CD', 'GND', 'TWR', 'APP'],
  // Still ends at APP, deliberately NOT extended to CTR — the covering
  // chain (guide §4.5 rule 3, §4.8.6) is an INTRAFACILITY occupancy-
  // fallback mechanism ("route to the covering Position within this
  // Facility"), a different thing from the cross-Facility HANDOFF
  // primitive's own PROPOSE/ACCEPT flow (§4.6). APP has no covering
  // Position within INCIRLIK, same as before WP4A. See
  // docs/adr/0013-facility-config-multi-facility.md.
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
      // ops-proposed listed FIRST deliberately — it's what bayForImpliedState's
      // "no match, fall back to this Position's first Bay" default resolves
      // to, and what a Strip dropped on OPS's Position tab generally (not a
      // specific Bay tab) lands in via _defaultBayFor (crc-desktop's
      // bay-view.js). ops-filed is no longer an ordinary Strip-holding Bay
      // at all client-side (its content is the client-local filed-plan
      // queue, guide-analogous to the search pseudo-Bay — see
      // docs/efsp-usage-guide.md §4) — a Strip landing there by accident
      // would become invisible, so it must never be anyone's "default" Bay.
      { bayId: 'ops-proposed', rackIds: ['main'], impliesState: 'PROPOSED' },
      { bayId: 'ops-filed',    rackIds: ['main'] },
      { bayId: 'ops-field-state',   rackIds: ['main'] }, // WP6 hook, inert
      { bayId: 'ops-coordination',  rackIds: ['main'] }, // no cross-Facility primitive reaches OPS this slice — inert
    ],
    CD: [
      { bayId: 'cd-pending-clearance', rackIds: ['main'], impliesState: 'PENDING_CLEARANCE' },
      { bayId: 'cd-cleared',           rackIds: ['main'], impliesState: 'CLEARED' },
      { bayId: 'cd-held',              rackIds: ['main'], impliesState: 'HELD' },
      { bayId: 'cd-coordination',      rackIds: ['main'] }, // inert this slice
    ],
    GND: [
      { bayId: 'gnd-pushback', rackIds: ['main'], impliesState: 'PUSHBACK' },
      { bayId: 'gnd-taxi-out', rackIds: ['main'], impliesState: 'TAXI' },
      { bayId: 'gnd-taxi-in',  rackIds: ['main'], impliesState: 'TAXI_IN' },
      { bayId: 'gnd-coordination', rackIds: ['main'] }, // inert this slice
    ],
    TWR: [
      { bayId: 'twr-runway-queue', rackIds: ['rwy-05', 'rwy-23'], impliesState: 'RUNWAY_QUEUE' }, // one Rack per runway, guide §4.2
      { bayId: 'twr-airborne',     rackIds: ['main'], impliesState: 'DEPARTED' },
      { bayId: 'twr-arrivals',     rackIds: ['main'], impliesState: 'HANDED_TO_TOWER' },
      // NOTE: EfspState 'FINAL' (this Bay's implied state, on strip.state)
      // is unrelated to Strip Role 'FINAL' (guide §7.10's PAR/carrier
      // role, WP7A, still unbuilt — lives on strip.role) — see nla.js's
      // module comment. Don't conflate them when WP7A eventually lands.
      { bayId: 'twr-final',        rackIds: ['main'], impliesState: 'FINAL' },
      { bayId: 'twr-landed',       rackIds: ['main'], impliesState: 'LANDED' },
      { bayId: 'twr-coordination', rackIds: ['main'] }, // inert this slice
    ],
    APP: [
      { bayId: 'app-inbound',      rackIds: ['main'], impliesState: 'INBOUND' },   // receives ARRIVAL Strips via CTR's real HANDOFF (docs/adr/0014, superseding docs/adr/0008's local stub)
      { bayId: 'app-departures',   rackIds: ['main'], impliesState: 'HANDED_OFF' }, // receives DEPARTURE Strips from TWR's real Hand Off (docs/adr/0007)
      // WP4A hook (APP<->CTR) — no longer inert: receives proposed
      // HANDOFF/POINT_OUT/TRAFFIC/AIT replicas from CTR (docs/adr/0015).
      { bayId: 'app-coordination', rackIds: ['main'] },
    ],
  },
  // §4.6.1's data-only-facility 3-minute-verification obligation only
  // branches when the RECEIVING Facility is data-only — neither Facility
  // built this slice is (INCIRLIK/CENTER both have a real controller
  // interface), so this stays false on both, exercised only by a
  // synthetic test fixture. See docs/adr/0021-forwarding-obligations.md.
  dataOnly: false,
  // §4.6.2's standing-release envelopes — APP's own config (CTR has none;
  // a standing release is granted BY the delegating/center facility TO the
  // approach facility, guide §4.6.2's own wording: "the agreement normally
  // converts the per-flight call into a standing release for a named
  // envelope"). Empty by default; a real envelope is facility-config data,
  // not code (release-envelope.js's matchesStandingRelease()).
  standingReleases: [],
};

// [SOURCE-DEFINED] WP4A (docs/adr/0013) — the guide gives no published
// default Bay set for CENTER/CTR (only INCIRLIK's §4.2 table is grounded).
// This slice's CTR only ever handles ARRIVAL-shaped en-route strips (no
// DEPARTURE lifecycle at CTR at all — see docs/adr/0012's scope-cut ADR),
// so blockVisibility omits DEPARTURE entirely rather than populating it
// with an empty/unused array.
const DEFAULT_CENTER_CONFIG = {
  facility: 'CENTER',
  positions: ['CTR'],
  // CTR has no covering Position this slice — mirrors OPS's "absent from
  // the chain" precedent (there is no second civil ATC Position upstream
  // of CTR built yet).
  coveringChain: {},
  blockVisibility: {
    ARRIVAL: Object.keys(blockMap.ARRIVAL_BLOCK_MAP),
  },
  bays: {
    CTR: [
      { bayId: 'ctr-enroute',           rackIds: ['main'], impliesState: 'INBOUND' },
      { bayId: 'ctr-app-coordination',  rackIds: ['main'] }, // WP4A seam — proposed HANDOFF/POINT_OUT/TRAFFIC/AIT replicas from APP land here
    ],
  },
  dataOnly: false,
  standingReleases: [],
};

const DEFAULT_CONFIGS = { INCIRLIK: DEFAULT_CONFIG, CENTER: DEFAULT_CENTER_CONFIG };

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

/**
 * Validates a candidate facility config (guide §8.3): every required Block
 * for each role in `blockVisibility` MUST stay visible, and every Bay's
 * owning Position MUST exist in the Position set (rule 3). Facility-
 * agnostic — operates on whichever candidate object is passed in. Returns
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

function _loadOne(facilityId) {
  const defaults = DEFAULT_CONFIGS[facilityId];
  let config = deepClone(defaults);
  try {
    const onDisk = JSON.parse(fs.readFileSync(FACILITY_CONFIG_PATHS[facilityId], 'utf8'));
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
  return config;
}

const configs = new Map(Object.keys(DEFAULT_CONFIGS).map(id => [id, _loadOne(id)]));

function _persist(facilityId) {
  try {
    fs.writeFileSync(FACILITY_CONFIG_PATHS[facilityId], JSON.stringify(configs.get(facilityId), null, 2));
  } catch (e) {
    console.warn(`[efsp-facility-config] failed to persist ${facilityId} config:`, e.message);
  }
}

/** Every Facility this server knows about — index.js's composition root iterates this to build one {boardStore, positionStore} pair per Facility, generically (no hard-coded facility count). */
function getFacilityIds() { return [...configs.keys()]; }

function getFacilityConfig(facilityId = DEFAULT_FACILITY_ID) { return deepClone(configs.get(facilityId)); }

function getPositionSet(facilityId = DEFAULT_FACILITY_ID) { return [...(configs.get(facilityId).positions)]; }

function getCoveringChain(facilityId = DEFAULT_FACILITY_ID) { return { ...(configs.get(facilityId).coveringChain) }; }

function getBaysFor(positionId, facilityId = DEFAULT_FACILITY_ID) {
  return deepClone(configs.get(facilityId).bays[positionId] || []);
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
  return bays.find(b => b.impliesState === state) || bays[0] || null;
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
  getFacilityConfig, getPositionSet, getCoveringChain, getBaysFor, getAllBays,
  bayImpliesState, bayForImpliedState, coordinationBayFor, setFacilityConfig, validateConfig,
  DEFAULT_CONFIG, DEFAULT_CENTER_CONFIG, DEFAULT_CONFIGS,
};
