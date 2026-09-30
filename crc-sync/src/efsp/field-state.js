'use strict';

// Field state (EFSPImplementationGuide.md §9.7) — the PURE half.
//
// This module holds every rule about runways that can be stated as a function
// of plain data: the runway status machine, the enums, how a Strip's runway is
// resolved, what inhibit reason a runway's state produces, which end is most
// into the wind, and the shape check on a Facility's runway inventory. It
// requires nothing from the EFSP tree, deliberately:
//
//   - facility-config.js requires it (to validate the inventory), so a require
//     back would be a cycle;
//   - nla.js reaches it only through `ctx.fieldStateFor()` and so stays a pure
//     function of (strip, fdr, now, ctx);
//   - field-state-store.js (the stateful half, docs/adr/0061) builds on it the
//     way correlation-store.js builds on correlation-match.js.
//
// Later lanes add pure functions HERE rather than to the store: L12's hung-
// ordnance advisory and L1b's `gearMismatchFor(fdr, runway)` (guide §9.7 rule
// 4, not built in L1) are both functions of a runway record and an FDR.
//
// Shape (docs/parallel/decisions.md S-Q23): one record per PHYSICAL runway,
// `{ runwayId: '05/23', ends: ['05', '23'], status, arrestingGear: [...] }`.
// Status belongs to the pavement — runway works close it in both
// directions — and the Facility holds which END is active.

// ── the status machine (rules 1–2) ─────────────────────────────────────────

const RUNWAY_STATUSES = ['OPEN', 'CLOSED', 'SUSPENDED_WORKS', 'SUSPENDED_INSPECTION'];

// airspace-store.js's shape. Two entries are absent ON PURPOSE, and each
// absence is a rule:
//   - SUSPENDED_WORKS -> OPEN. That missing edge IS rule 2
//     ("resumption MUST require an explicit inspection-complete action"),
//     enforced by the table rather than by a check somebody can forget.
//   - SUSPENDED_* -> CLOSED. With it, suspend -> close -> open would reopen a
//     re-rigged runway without an inspection: rule 2 through a side door.
// OPEN -> SUSPENDED_INSPECTION is reached only by CompleteRunwayChange (the
// new direction is inspected before it is used, decisions.md Q29).
const LEGAL_TRANSITIONS = {
  OPEN:                     ['CLOSED', 'SUSPENDED_WORKS', 'SUSPENDED_INSPECTION'],
  CLOSED:                   ['OPEN'],
  SUSPENDED_WORKS:          ['SUSPENDED_INSPECTION'],
  SUSPENDED_INSPECTION:     ['OPEN'],
};

function canGo(from, to) {
  return (LEGAL_TRANSITIONS[from] || []).includes(to);
}

// Why a runway is suspended. Kept as a field rather than folded into the
// status name. WORKS is the generic "runway works + inspection" suspension
// (decisions.md H52, docs/adr/0068): the barrier change L1 built is one kind
// of works, and DCS simulates no arresting wires to make it special (H17).
// A new kind is one entry here and one label below, not a new status.
const SUSPENSION_KINDS = ['WORKS', 'RUNWAY_CHANGE'];

// ── the arresting gear (data only — decisions.md H17) ──────────────────────
//
// DCS does not simulate arresting wires, so the gear is the §9.7 schema's
// data shape and nothing more: no op changes a gear's state. The enums are the
// guide's verbatim.
const GEAR_TYPES = ['BAK_12', 'E_5', 'OTHER'];
const GEAR_POSITIONS = ['APPROACH_END', 'DEPARTURE_END', 'OVERRUN'];
const GEAR_STATES = ['UP', 'DOWN', 'OUT_OF_SERVICE'];

// ── the runway change (rule 3) ─────────────────────────────────────────────

const RUNWAY_CHANGE_STATES = ['PROPOSED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'PENDING_INSPECTION', 'REJECTED'];
const RUNWAY_CHANGE_OPEN_STATES = ['PROPOSED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'PENDING_INSPECTION'];

/** The guide §9.7 schema's `runwayChangeInProgress` bool — derived, never stored. */
function isRunwayChangeInProgress(runwayChange) {
  return !!runwayChange && (runwayChange.state === 'IN_PROGRESS' || runwayChange.state === 'PENDING_INSPECTION');
}

/** Is a runway change open at all (anything but none or a terminal REJECTED)? */
function isRunwayChangeOpen(runwayChange) {
  return !!runwayChange && RUNWAY_CHANGE_OPEN_STATES.includes(runwayChange.state);
}

// What a Position other than TWR may ASK tower to do to a runway (decisions.md
// H18: tower is the sole authority over the runways; everyone else requests).
const REQUEST_ACTIONS = ['CLOSE', 'OPEN', 'WORKS'];

// ── runway designators ─────────────────────────────────────────────────────

/**
 * A runway END designator from free text, or null. '5' -> '05', 'RWY 05' ->
 * '05', 'rw23' -> '23', ' 23 ' -> '23', '5L' -> '05L'. Blocks 8A/8B are free
 * text with no validation, so this is the one place their spelling is forgiven.
 */
function normalizeRunwayEnd(text) {
  if (typeof text !== 'string' && typeof text !== 'number') return null;
  const s = String(text).trim().toUpperCase().replace(/^RWY|^RW/, '').replace(/\s+/g, '');
  const m = /^(\d{1,2})([LRC])?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1 || n > 36) return null;
  return String(n).padStart(2, '0') + (m[2] || '');
}

function _compactId(text) {
  return String(text).trim().toUpperCase().replace(/^RWY|^RW/, '').replace(/\s+/g, '');
}

// ── the read view nla.js sees ──────────────────────────────────────────────

/**
 * The minimal, read-only view rule 1 needs, built from the inventory (config)
 * and the stored state. field-state-store.js caches one per Facility and
 * rebuilds it only when that Facility's record changes, because nlaStatusFor
 * runs for every Strip on every stamp.
 *
 * @returns {{activeRunway:string|null, rackEnds:Object<string,string>,
 *   runways:{runwayId:string, ends:string[], status:string, suspension:object|null}[]}}
 */
function buildStatusView(inventory, record) {
  const rackEnds = {};
  const runways = [];
  for (const def of (inventory && inventory.runways) || []) {
    for (const [end, rackId] of Object.entries(def.rackIds || {})) rackEnds[rackId] = end;
    const stored = record && record.runways ? record.runways.find(r => r.runwayId === def.runwayId) : null;
    runways.push(Object.freeze({
      runwayId: def.runwayId,
      ends: Object.freeze([...(def.ends || [])]),
      status: stored ? stored.status : 'OPEN',
      suspension: stored && stored.suspension ? Object.freeze({ ...stored.suspension }) : null,
    }));
  }
  return Object.freeze({
    activeRunway: record ? record.activeRunway || null : null,
    rackEnds: Object.freeze(rackEnds),
    runways: Object.freeze(runways),
  });
}

function _runwayOfEnd(view, end) {
  return (view.runways || []).find(r => r.ends.includes(end)) || null;
}

function _fdrRunwayText(strip, fdr) {
  if (!fdr) return null;
  if (strip.role === 'DEPARTURE') return fdr.filed ? fdr.filed.departureRunway : null;
  if (strip.role === 'ARRIVAL') return fdr.assigned ? fdr.assigned.landingRunway : null;
  return null;
}

function _resolveText(view, text) {
  if (text === null || text === undefined || text === '') return null;
  const end = normalizeRunwayEnd(text);
  if (end) {
    const runway = _runwayOfEnd(view, end);
    if (runway) return { runway, end };
  }
  // A whole-runway designator ('05/23') names the pavement but no direction.
  const compact = _compactId(text);
  const runway = (view.runways || []).find(r => _compactId(r.runwayId) === compact);
  return runway ? { runway, end: null } : null;
}

/**
 * Which runway a Strip is assigned to, and how that was decided
 * (decisions.md S-Q25): the rack it is being dropped into, then the rack it
 * sits in, then its FDR's runway field (8A for a DEPARTURE, 8B for an
 * ARRIVAL), then the Facility's active runway, then nothing — fail open.
 *
 * Rack before FDR: `strip.rackId` is where a controller PUT the Strip, the FDR
 * field is filed intent. The target rack comes first on the drag path
 * (decisions.md Q27): a Strip dropped onto 23's rack is about to use 23,
 * whatever rack it came from.
 *
 * Only DEPARTURE and ARRIVAL Strips have a runway. OVERFLIGHT and MISSION
 * never resolve, so rule 1 never touches them.
 *
 * @returns {{runwayId:string, end:string|null, source:'TARGET_RACK'|'RACK'|'FDR'|'ACTIVE_RUNWAY'}|null}
 */
function resolveRunwayForStrip(strip, fdr, view, { targetRackId } = {}) {
  if (!strip || !view) return null;
  if (strip.role !== 'DEPARTURE' && strip.role !== 'ARRIVAL') return null;
  const byRack = (rackId, source) => {
    const end = rackId ? view.rackEnds[rackId] : null;
    const runway = end ? _runwayOfEnd(view, end) : null;
    return runway ? { runwayId: runway.runwayId, end, source } : null;
  };
  const target = byRack(targetRackId, 'TARGET_RACK');
  if (target) return target;
  const rack = byRack(strip.rackId, 'RACK');
  if (rack) return rack;
  const filed = _resolveText(view, _fdrRunwayText(strip, fdr));
  if (filed) return { runwayId: filed.runway.runwayId, end: filed.end, source: 'FDR' };
  if (view.activeRunway) {
    const runway = _runwayOfEnd(view, view.activeRunway);
    if (runway) return { runwayId: runway.runwayId, end: view.activeRunway, source: 'ACTIVE_RUNWAY' };
  }
  return null;
}

// The states whose entry uses the runway, per Role — rule 1's cases seen from
// the arriving end. nla.js gates the NLA steps into them; board-store.js gates
// a raw SetState into them the same way (decisions.md S-R2-14). ARRIVAL's
// LANDED is absent on purpose: touchdown is an observation, not a clearance.
const RUNWAY_GATED_STATES = Object.freeze({
  DEPARTURE: Object.freeze(['RUNWAY_QUEUE', 'LUAW', 'DEPARTED']),
  ARRIVAL: Object.freeze(['FINAL']),
});

// [SOURCE-DEFINED] inhibit wordings (decisions.md Q40): nla.js's lower-case
// phrase style, naming the runway and what is wrong with it.
const SUSPENSION_LABELS = {
  WORKS: 'works in progress',
};

/** The inhibit reason a runway's status produces, or null when it is usable. */
function runwayStatusReason(runway) {
  if (!runway) return null;
  switch (runway.status) {
    case 'SUSPENDED_WORKS': {
      const kind = runway.suspension && runway.suspension.kind;
      return `runway ${runway.runwayId} suspended — ${SUSPENSION_LABELS[kind] || 'works in progress'}`;
    }
    case 'SUSPENDED_INSPECTION':
      return `runway ${runway.runwayId} suspended — awaiting inspection`;
    // Beyond rule 1's letter, which names only SUSPENDED_* (decisions.md Q28):
    // a closed runway is at least as unavailable, and launching onto one is
    // the worse error. [SOURCE-DEFINED].
    case 'CLOSED':
      return `runway ${runway.runwayId} closed`;
    default:
      return null;
  }
}

/**
 * Rule 1: the reason a Strip's takeoff/landing NLA is inhibited by field
 * state, or null. Null — never an inhibit — when there is no field state, the
 * runway cannot be resolved, or it is OPEN: an inhibit that fires on bad data
 * strands an aircraft on the board.
 */
function runwayInhibitFor(strip, fdr, view, opts) {
  const resolved = resolveRunwayForStrip(strip, fdr, view, opts);
  if (!resolved) return null;
  const runway = view.runways.find(r => r.runwayId === resolved.runwayId);
  return runwayStatusReason(runway);
}

/**
 * An advisory, not an inhibit (decisions.md Q30): a Strip queued in a runway
 * rack for an end that is not the active one — left behind by a runway change,
 * since nothing ever moves a Strip on its own (§10.3). For L1b to render.
 */
function runwayAdvisoryFor(strip, view) {
  if (!strip || !view || !view.activeRunway) return null;
  const end = strip.rackId ? view.rackEnds[strip.rackId] : null;
  if (!end || end === view.activeRunway) return null;
  return `queued for inactive runway ${end}`;
}

/**
 * The rack a Strip is filed into when something other than a drag places it
 * in `bay` — an NLA transfer, an implied-state relocation, an accepted
 * coordination (decisions.md Q26, S-R2-1). In a Bay whose racks are runway
 * ends: the end its FDR names, else the active end. Otherwise — no field
 * state, no runway racks, nothing resolved — the Bay's first rack, which is
 * what every placement site did before.
 */
function runwayRackFor(strip, fdr, view, bay) {
  if (!bay) return null;
  const first = (bay.rackIds || [])[0] || null;
  if (!view || !strip) return first;
  const rackIdsByEnd = {};
  for (const [rackId, end] of Object.entries(view.rackEnds || {})) rackIdsByEnd[end] = rackId;
  const inBay = (rackId) => rackId && (bay.rackIds || []).includes(rackId);
  const filed = _resolveText(view, _fdrRunwayText(strip, fdr));
  if (filed && filed.end && inBay(rackIdsByEnd[filed.end])) return rackIdsByEnd[filed.end];
  if (view.activeRunway && inBay(rackIdsByEnd[view.activeRunway])) return rackIdsByEnd[view.activeRunway];
  return first;
}

// ── the active runway from the mission wind (decisions.md H22) ─────────────

/**
 * The end most into the wind: the largest headwind component. Wind and each
 * end's heading are both TRUE — DCS reports wind in degrees true, and an end's
 * number is magnetic, so the inventory carries each end's true heading
 * (`endHeadingsTrue`) rather than this multiplying the number by ten.
 * Ties (calm included) go to the first end in inventory order.
 *
 * @returns {string|null}
 */
function activeEndIntoWind(inventory, windFromTrue) {
  if (!Number.isFinite(windFromTrue)) return null;
  let best = null;
  let bestHeadwind = -Infinity;
  for (const def of (inventory && inventory.runways) || []) {
    for (const end of def.ends || []) {
      const heading = def.endHeadingsTrue && def.endHeadingsTrue[end];
      if (!Number.isFinite(heading)) continue;
      const headwind = Math.cos((windFromTrue - heading) * Math.PI / 180);
      if (headwind > bestHeadwind + 1e-9) { best = end; bestHeadwind = headwind; }
    }
  }
  return best;
}

/**
 * A fingerprint of the loaded mission. crc-sync hears 'mission-load' on every
 * gRPC (re)connect, not only when a new mission starts, and DCS gives no
 * mission id — so "is this the mission whose wind already set the runway?" is
 * answered by what the mission contains. Same mission, same key: a reconnect
 * or a crc-sync restart keeps whatever TWR has since chosen.
 */
function missionKeyOf(missionData) {
  if (!missionData) return null;
  const names = (list) => (list || []).map(x => (x && (x.name || x.id)) || '').join('|');
  const text = `${missionData.theatre || ''}#${names(missionData.waypoints)}#${names(missionData.drawings)}`;
  // FNV-1a, 32 bit — small, dependency-free, and only ever compared for equality.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${missionData.theatre || '?'}:${h.toString(16)}`;
}

// ── the inventory's shape (read once at startup — decisions.md P5) ─────────

function _isObject(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }

/**
 * Checks a Facility's `fieldState` config for things that can never work in
 * any deployment. Returns a problem string, or null when it is well formed.
 * Cross-references to Bays only warn (runwayInventoryWarnings below).
 */
function validateFieldStateInventory(fieldState, positions = []) {
  if (!_isObject(fieldState)) return 'fieldState must be an object';
  if (!Array.isArray(fieldState.runways)) return 'fieldState.runways must be an array';
  const runwayIds = new Set();
  const allEnds = new Set();
  const allRacks = new Set();
  for (const [i, def] of fieldState.runways.entries()) {
    const where = `fieldState.runways[${i}]`;
    if (!_isObject(def)) return `${where} must be an object`;
    if (typeof def.runwayId !== 'string' || !def.runwayId.trim()) return `${where}.runwayId is required`;
    if (runwayIds.has(def.runwayId)) return `duplicate runwayId ${def.runwayId}`;
    runwayIds.add(def.runwayId);
    if (!Array.isArray(def.ends) || def.ends.length < 1 || def.ends.length > 2) return `runway ${def.runwayId}: ends must list one or two runway ends`;
    for (const end of def.ends) {
      if (normalizeRunwayEnd(end) !== end) return `runway ${def.runwayId}: ${JSON.stringify(end)} is not a runway end designator (e.g. '05', '23L')`;
      if (allEnds.has(end)) return `runway end ${end} is declared twice`;
      allEnds.add(end);
      const heading = def.endHeadingsTrue && def.endHeadingsTrue[end];
      if (!Number.isFinite(heading) || heading < 0 || heading >= 360) return `runway ${def.runwayId}: endHeadingsTrue.${end} must be a true heading in degrees (0–359)`;
    }
    if (def.rackIds !== undefined) {
      if (!_isObject(def.rackIds)) return `runway ${def.runwayId}: rackIds must map an end to a rackId`;
      for (const [end, rackId] of Object.entries(def.rackIds)) {
        if (!def.ends.includes(end)) return `runway ${def.runwayId}: rackIds names ${end}, which is not one of its ends`;
        if (typeof rackId !== 'string' || !rackId) return `runway ${def.runwayId}: rackIds.${end} must be a rackId`;
        if (allRacks.has(rackId)) return `rack ${rackId} is mapped to two runway ends`;
        allRacks.add(rackId);
      }
    }
    if (!Array.isArray(def.arrestingGear)) return `runway ${def.runwayId}: arrestingGear must be an array (empty when there is none)`;
    for (const [j, gear] of def.arrestingGear.entries()) {
      const g = `runway ${def.runwayId} arrestingGear[${j}]`;
      if (!_isObject(gear)) return `${g} must be an object`;
      if (!def.ends.includes(gear.end)) return `${g}: end must be one of ${def.ends.join(', ')}`;
      if (!GEAR_POSITIONS.includes(gear.position)) return `${g}: position must be one of ${GEAR_POSITIONS.join(', ')}`;
      if (!GEAR_TYPES.includes(gear.type)) return `${g}: type must be one of ${GEAR_TYPES.join(', ')}`;
      if (!GEAR_STATES.includes(gear.state)) return `${g}: state must be one of ${GEAR_STATES.join(', ')}`;
      if (!Number.isFinite(gear.distanceFt) || gear.distanceFt < 0) return `${g}: distanceFt must be a non-negative number`;
    }
  }
  const acks = fieldState.runwayChangeAcknowledgers;
  if (acks !== undefined) {
    if (!Array.isArray(acks)) return 'fieldState.runwayChangeAcknowledgers must be an array of Positions';
    for (const p of acks) if (!positions.includes(p)) return `runwayChangeAcknowledgers names unknown Position ${p}`;
  }
  if (fieldState.inspectionAuthorityPositionId !== undefined && !positions.includes(fieldState.inspectionAuthorityPositionId)) {
    return `inspectionAuthorityPositionId names unknown Position ${fieldState.inspectionAuthorityPositionId}`;
  }
  if (fieldState.pads !== undefined) {
    if (!_isObject(fieldState.pads)) return 'fieldState.pads must be an object';
    for (const key of ['hotCargo', 'alert']) {
      const pad = fieldState.pads[key];
      if (pad !== null && pad !== undefined && !(_isObject(pad) && typeof pad.name === 'string')) return `fieldState.pads.${key} must be null or {name}`;
    }
  }
  if (fieldState.airportIcao !== undefined && typeof fieldState.airportIcao !== 'string') return 'fieldState.airportIcao must be an ICAO string';
  return null;
}

/**
 * Cross-references between the inventory and the Bays — warnings, never a
 * rejection (docs/efsp-wp6-plan.md Phase 3): a runway naming a rack that no
 * RUNWAY_QUEUE Bay has, and a RUNWAY_QUEUE rack no runway end claims. Either
 * still works; it just means a Strip there resolves by its FDR instead.
 */
function runwayInventoryWarnings(config) {
  const warnings = [];
  const fieldState = config && config.fieldState;
  if (!fieldState || !Array.isArray(fieldState.runways)) return warnings;
  const queueRacks = new Set();
  for (const bays of Object.values(config.bays || {})) {
    for (const bay of bays || []) {
      if (bay.impliesState === 'RUNWAY_QUEUE') for (const r of bay.rackIds || []) queueRacks.add(r);
    }
  }
  const mapped = new Set();
  for (const def of fieldState.runways) {
    for (const [end, rackId] of Object.entries(def.rackIds || {})) {
      mapped.add(rackId);
      if (!queueRacks.has(rackId)) warnings.push(`runway ${def.runwayId} end ${end} names rack ${rackId}, which no RUNWAY_QUEUE Bay has`);
    }
  }
  for (const rackId of queueRacks) {
    if (!mapped.has(rackId)) warnings.push(`RUNWAY_QUEUE rack ${rackId} is not mapped to any runway end`);
  }
  return warnings;
}

module.exports = {
  RUNWAY_STATUSES, LEGAL_TRANSITIONS, canGo, SUSPENSION_KINDS, SUSPENSION_LABELS,
  GEAR_TYPES, GEAR_POSITIONS, GEAR_STATES,
  RUNWAY_CHANGE_STATES, RUNWAY_CHANGE_OPEN_STATES, isRunwayChangeInProgress, isRunwayChangeOpen,
  REQUEST_ACTIONS,
  RUNWAY_GATED_STATES, normalizeRunwayEnd, buildStatusView, resolveRunwayForStrip, runwayStatusReason, runwayInhibitFor,
  runwayAdvisoryFor, runwayRackFor, activeEndIntoWind, missionKeyOf,
  validateFieldStateInventory, runwayInventoryWarnings,
};
