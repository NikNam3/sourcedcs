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
// Required BEFORE this module builds its configs Map: the RANGES Facility's
// Position set is derived from the airspace definitions (see
// DEFAULT_RANGES_CONFIG). airspace-config.js deliberately does not require
// this module back, so there is no cycle.
const airspaceConfig = require('./airspace-config');

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
  // WP4A second slice — the TACTICAL Facility (docs/adr/0013's pattern
  // repeated for a third Facility).
  TACTICAL: process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL
    || path.join(__dirname, '../../config/efsp-facility-tactical.json'),
  RANGES: process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_RANGES
    || path.join(__dirname, '../../config/efsp-facility-ranges.json'),
};

const DEFAULT_CONFIG = {
  facility: 'INCIRLIK',
  positions: ['OPS', 'CD', 'GND', 'TWR', 'APP'],
  // WP4A second slice — every Position's doctrinal class (guide §4.1's own
  // Class column), read by permission.js's getPositionClass() to gate the
  // cross-Facility coordination primitives and TOFI structurally rather
  // than by a hand-maintained per-ID list alone (docs/adr/0020's own
  // directive). INCIRLIK has no MRU/NON_ATC Positions, so nothing here is
  // ever excluded from coordination by class — CD/GND/TWR/OPS are excluded
  // today purely because they don't sit on a Facility boundary, a
  // different, pre-existing reason (see permission.js).
  positionClasses: { OPS: 'BASOPS', CD: 'MILITARY_ATC', GND: 'MILITARY_ATC', TWR: 'MILITARY_ATC', APP: 'MILITARY_ATC' },
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
    OVERFLIGHT: Object.keys(blockMap.OVERFLIGHT_BLOCK_MAP), // docs/adr/0023
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
      { bayId: 'app-inbound',      rackIds: ['main'], impliesState: 'INBOUND' },   // receives ARRIVAL Strips via CTR's real HANDOFF (docs/adr/0014, superseding docs/adr/0008's local stub) AND self-originated pop-up ARRIVALs (docs/adr/0023)
      { bayId: 'app-departures',   rackIds: ['main'], impliesState: 'HANDED_OFF' }, // receives DEPARTURE Strips from TWR's real Hand Off (docs/adr/0007)
      // docs/adr/0023 — a flight transiting APP's delegated airspace
      // without landing or departing at Incirlik (guide §2's OVERFLIGHT
      // Strip Role), self-originated by APP directly (no sending Facility
      // to receive a coordination proposal from).
      { bayId: 'app-overflight',   rackIds: ['main'], impliesState: 'TRANSITING' },
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
  // AIT is configuration, not a default (guide §4.6 rule 7) — false until
  // a real written directive is on file (docs/adr/0022).
  aitAuthorized: false,
};

// [SOURCE-DEFINED] WP4A (docs/adr/0013) — the guide gives no published
// default Bay set for CENTER/CTR (only INCIRLIK's §4.2 table is grounded).
// docs/adr/0020 originally scoped CTR to ARRIVAL-shaped en-route strips
// only; docs/adr/0022 narrowly corrects that — CTR can now also RECEIVE a
// handed-off DEPARTURE Strip via APP's own HANDOFF (the mirror of CTR's
// existing ARRIVAL HANDOFF to APP), with a Drop-only terminus, same as
// APP's own DEPARTURE terminus today. No further DEPARTURE lifecycle
// stages exist at CTR beyond that — the TACTICAL Facility/MRU Positions/
// D12 audit/TOFI deferral from ADR 0012 still stands untouched.
const DEFAULT_CENTER_CONFIG = {
  facility: 'CENTER',
  positions: ['CTR'],
  positionClasses: { CTR: 'CIVIL_ATC' },
  // CTR has no covering Position this slice — mirrors OPS's "absent from
  // the chain" precedent (there is no second civil ATC Position upstream
  // of CTR built yet).
  coveringChain: {},
  blockVisibility: {
    ARRIVAL: Object.keys(blockMap.ARRIVAL_BLOCK_MAP),
    DEPARTURE: Object.keys(blockMap.DEPARTURE_BLOCK_MAP), // docs/adr/0022
    OVERFLIGHT: Object.keys(blockMap.OVERFLIGHT_BLOCK_MAP), // docs/adr/0023
  },
  bays: {
    CTR: [
      { bayId: 'ctr-enroute',           rackIds: ['main'], impliesState: 'INBOUND' },
      // docs/adr/0022 — receives a DEPARTURE Strip handed off from APP;
      // mirrors app-departures' exact shape (INCIRLIK's own DEPARTURE
      // terminus Bay).
      { bayId: 'ctr-departures',        rackIds: ['main'], impliesState: 'HANDED_OFF' },
      // docs/adr/0023 — a flight transiting CENTER's airspace without
      // landing or departing at Incirlik at all (guide §2's OVERFLIGHT
      // Strip Role), self-originated by CTR directly.
      { bayId: 'ctr-overflight',        rackIds: ['main'], impliesState: 'TRANSITING' },
      { bayId: 'ctr-app-coordination',  rackIds: ['main'] }, // WP4A seam — proposed HANDOFF/POINT_OUT/TRAFFIC/OPERATIONAL_REQUEST/AIT replicas from APP land here
    ],
  },
  dataOnly: false,
  standingReleases: [],
  aitAuthorized: false, // docs/adr/0022 — configuration, not a default
};

// [SOURCE-DEFINED] WP4A second slice (docs/adr/0025) — the TACTICAL
// Facility and its 4 MRU/non-ATC Positions (TAC_C2, AIC, GCI, JTAC), the
// deferred remainder of WP4A per docs/adr/0020. No guide-published default
// Bay set exists for TACTICAL (only INCIRLIK's §4.2 table is grounded) —
// this follows the guide's own §4.2 Bay-name table for TAC_C2/AIC/GCI
// verbatim, plus a read-only viewing Bay for JTAC (guide §4.1: "MISSION
// (read-only)" — enforced by JTAC never being granted ownership/mutation
// rights anywhere in permission.js, not by a separate mechanism here).
const DEFAULT_TACTICAL_CONFIG = {
  facility: 'TACTICAL',
  positions: ['TAC_C2', 'AIC', 'GCI', 'JTAC'],
  positionClasses: { TAC_C2: 'MRU', GCI: 'MRU', AIC: 'MRU_POSITION', JTAC: 'NON_ATC' },
  // AIC/GCI -> TAC_C2 is a legal INTRAFACILITY covering-chain entry (stays
  // inside this Facility's own PositionStore instance). TAC_C2 -> CTR is
  // deliberately NOT extended here, even though the guide's own §4.8.6
  // text writes it as one chain — that hop crosses a Facility boundary,
  // and position-store.js's coveringPositionFor() is structurally scoped
  // to one Facility's own PositionStore (ADR 0013 point 4 already rejected
  // extending APP -> CTR the identical way, after an earlier draft tried
  // it and was reverted). An unoccupied TAC_C2 with no successor is an
  // accepted "warn the controller, route nowhere" stranding case per guide
  // §4.8.6 rule 5 ("warn, do not block"), not a silent gap.
  coveringChain: { AIC: 'TAC_C2', GCI: 'TAC_C2' },
  blockVisibility: {
    MISSION: Object.keys(blockMap.MISSION_BLOCK_MAP),
  },
  bays: {
    TAC_C2: [
      { bayId: 'tac-c2-tasked',       rackIds: ['main'], impliesState: 'TASKED' },
      { bayId: 'tac-c2-airborne',     rackIds: ['main'], impliesState: 'AIRBORNE' },
      { bayId: 'tac-c2-on-station',   rackIds: ['main'], impliesState: 'ON_STATION' },
      { bayId: 'tac-c2-tanker',       rackIds: ['main'] }, // guide's own Bay name — inert this slice, no AR-line/tanker join until WP7
      { bayId: 'tac-c2-coordination', rackIds: ['main'] }, // TOFI lands here — a genuinely used Coordination Bay
    ],
    AIC: [
      { bayId: 'aic-on-station',   rackIds: ['main'], impliesState: 'ON_STATION' },
      { bayId: 'aic-committed',    rackIds: ['main'] },
      { bayId: 'aic-coordination', rackIds: ['main'] }, // present but inert — AIC never holds a TOFI grant (permission.js)
    ],
    GCI: [
      { bayId: 'gci-on-station',   rackIds: ['main'], impliesState: 'ON_STATION' },
      { bayId: 'gci-committed',    rackIds: ['main'] },
      { bayId: 'gci-coordination', rackIds: ['main'] }, // TOFI lands here, same as TAC_C2's
    ],
    JTAC: [
      { bayId: 'jtac-mission', rackIds: ['main'] }, // read-only viewing Bay — ownership/permission alone enforces read-only
    ],
  },
  dataOnly: false,
  standingReleases: [],
  aitAuthorized: false,
};

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
const DEFAULT_RANGES_CONFIG = {
  facility: 'RANGES',
  positions: airspaceConfig.getRangePositionIds(),
  positionClasses: Object.fromEntries(
    airspaceConfig.getRangePositionIds().map(id => [id, 'USING_AGENCY'])
  ),
  coveringChain: {},
  blockVisibility: {},
  bays: {},
  dataOnly: false,
  standingReleases: [],
  aitAuthorized: false,
};

const DEFAULT_CONFIGS = {
  INCIRLIK: DEFAULT_CONFIG,
  CENTER: DEFAULT_CENTER_CONFIG,
  TACTICAL: DEFAULT_TACTICAL_CONFIG,
  RANGES: DEFAULT_RANGES_CONFIG,
};

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
  for (const positionId of Object.keys(candidate.positionClasses || {})) {
    if (!(candidate.positions || []).includes(positionId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `positionClasses references unknown Position ${positionId}` };
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

function getBaysFor(positionId, facilityId = DEFAULT_FACILITY_ID) {
  return deepClone(configs.get(facilityId).bays[positionId] || []);
}

/**
 * May this Facility write this Block on this Role? (guide §8.1 — "the
 * configurability is the specification.")
 *
 * blockVisibility was previously read only by validateConfig() at load time,
 * to check that a narrowed config kept every REQUIRED Block visible. Nothing
 * consulted it on the write path, so a Block a Facility had hidden was still
 * writable by any client that named it. Neither shipped config narrows
 * anything today, so this is latent rather than exploited — but the contract
 * is that the config decides, and it has to decide at the point of the write.
 *
 * A Role with no entry at all is unrestricted, not invisible: a Facility that
 * simply doesn't describe a Role (TACTICAL lists only MISSION) is saying
 * nothing about it, not hiding every Block of it.
 */
function isBlockVisible(role, blockId, facilityId = DEFAULT_FACILITY_ID) {
  const config = configs.get(facilityId);
  if (!config) return true;
  const visible = (config.blockVisibility || {})[role];
  if (!visible) return true;
  return visible.includes(blockId);
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
  getFacilityConfig, getPositionSet, getPositionClass, getCoveringChain, getBaysFor, getAllBays, isBlockVisible,
  bayImpliesState, bayForImpliedState, coordinationBayFor, setFacilityConfig, validateConfig,
  DEFAULT_CONFIG, DEFAULT_CENTER_CONFIG, DEFAULT_TACTICAL_CONFIG, DEFAULT_CONFIGS,
};
