'use strict';

// The airspace REGISTRY (docs/adr/0098): definitions per theater AND their operational state, in one store, the
// only writer of both. Before ADR 0098 this was "airspace state" over static configuration (docs/adr/0032, 0034,
// 0036): the definitions were read from a JSON file once, nothing could change them, and a new id had a definition
// and no record. Now a definition is data in the store (Create, Edit, Delete, Import), with a `defRev`, a bounded
// `definitionHistory` and per-field conflicts, persisted inside the one atomic Board snapshot (stores.js).
//
// A THIRD store, peer to FlightDataStore and BoardStore (docs/adr/0032): airspace state outlives any one flight, and
// a record is not a Strip, which §4.1 says RANGE never works. One store for every Facility: an airspace is a theater
// entity that names its controlling Facility, not a per-Facility replica.
//
// The four state names are normative (§4.6.4: scheduled / active / released / returned; "hot" and "cold" are display
// sugar only). They are deliberately NOT paired with a second ownership-direction field: §4.6.4 prohibits a bare
// `released` BOOLEAN because "released" alone is ambiguous. The per-flight-data `airspace.owner` direction
// (docs/adr/0018) is a different fact, about a flight, and is untouched here.
//
// Two revisions, deliberately separate (ADR 0098 §4): `rev` is the STATE revision (schedule, request, approve,
// release, return, delay) and `defRev` the DEFINITION revision (create, edit). A definition edit never makes an
// in-flight state op STALE_REV and the reverse holds too.
//
// Authority is the registry's (authority/airspace.js, ADR 0098 §11), not this file's: the store asks it.

const { WALL_CLOCK } = require('../mission-clock');
const { SyncLog } = require('./sync/sync-log');
const schema = require('./airspace-schema');
const containment = require('./airspace/containment');
const log = require('../log').logger('efsp:airspace-store');
const airspaceAuthority = require('./authority/airspace');
const { internalError, partialAuditTail } = require('./store-throw');

const AIRSPACE_STATES = ['SCHEDULED', 'ACTIVE', 'RELEASED', 'RETURNED'];

// The lifecycle, as a transition table rather than a switch: a reservation is scheduled, activated once ATC approves,
// released by the using agency when it is finished, and returned once ATC has it back and it is available again.
// RETURNED is not terminal: an airspace is a standing entity that gets scheduled over and over.
const LEGAL_TRANSITIONS = {
  SCHEDULED: ['ACTIVE', 'RETURNED'],   // RETURNED here = a schedule cancelled before it ever went active
  ACTIVE:    ['RELEASED'],
  RELEASED:  ['RETURNED'],
  RETURNED:  ['SCHEDULED'],
};

const INITIAL_STATE = 'RETURNED'; // available, nothing booked

const DEFINITION_OP_KINDS = ['CreateAirspace', 'EditAirspace', 'DeleteAirspace', 'ImportAirspaces'];
const STATE_OP_KINDS = ['ScheduleAirspace', 'RequestActivation', 'ApproveActivation', 'DenyActivation', 'DelayActivation', 'ReleaseAirspace', 'ReturnAirspace'];
const AIRSPACE_OP_KINDS = [...DEFINITION_OP_KINDS, ...STATE_OP_KINDS];

const VIAS = ['PANEL', 'WEB', 'SEED'];

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
function same(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }
const refuse = (reason, detail, extra) => ({ ok: false, reason, detail, ...extra });
const verr = (detail, extra) => refuse('VALIDATION_ERROR', detail, extra);

/** The record as clients and the audit see it: the definition included, the bounded history left out. */
function viewOf(record) {
  const { definitionHistory, ...rest } = record;
  return deepClone(rest);
}

/**
 * The hard reference check of ADR 0098 §3/§8 (gap 4; was `_validateAirspaceReferences`, a one-time startup warning):
 * the controlling Facility exists and names the controlling Position, and a using Facility exists and is neither the
 * controlling Facility nor RANGES. Every write runs it; the seed turns its answer into a startup error.
 * @param {object} def a validated definition
 * @param {{hasFacility:(id:string)=>boolean, positionsOf:(facilityId:string)=>string[], facilityOfPosition:(positionId:string)=>string|null}} lookup
 * @returns {{ok:false, reason:string, detail:string}|null}
 */
function checkReferences(def, lookup) {
  const id = def.airspaceId;
  if (!lookup.hasFacility(def.controllingFacilityId)) return verr(`${id}: controllingFacilityId ${def.controllingFacilityId} is not a configured Facility`);
  if (!lookup.positionsOf(def.controllingFacilityId).includes(def.controllingPositionId)) {
    return verr(`${id}: ${def.controllingPositionId} is not a Position of ${def.controllingFacilityId}`);
  }
  if (def.usingFacilityId) {
    if (!lookup.hasFacility(def.usingFacilityId)) return verr(`${id}: usingFacilityId ${def.usingFacilityId} is not a configured Facility`);
    if (def.usingFacilityId === def.controllingFacilityId) return verr(`${id}: the using Facility cannot be the controlling Facility`);
    if (def.usingFacilityId === 'RANGES') return verr(`${id}: the using Facility cannot be RANGES (name a usingPositionId instead)`);
  }
  if (def.usingPositionId) {
    const home = lookup.facilityOfPosition(def.usingPositionId);
    if (home && home !== 'RANGES') return verr(`${id}: ${def.usingPositionId} is already a Position of ${home}; a range-control Position needs an id of its own`);
  }
  return null;
}

/**
 * The RANGES Facility's Position ids, derived BEFORE the Facilities are built (facility-config.js): every
 * `usingPositionId` of every theater's saved definitions, plus the standing list's not yet seeded. The store applies the
 * same seed after it restores, so the two agree (R3-24: a change takes effect at the next start).
 * @param {object|null} savedAirspaces the `airspaces` key of the saved snapshot (already shape-checked)
 * @param {Object<string, object[]>} standing the standing list
 */
function deriveRangePositionIds(savedAirspaces, standing) {
  const ids = [];
  const add = (def) => { if (def && typeof def.usingPositionId === 'string' && def.usingPositionId) ids.push(def.usingPositionId); };
  const saved = savedAirspaces && !Array.isArray(savedAirspaces) ? savedAirspaces : {};
  for (const records of Object.values(saved.byTheater || {})) for (const r of records || []) add(r && r.definition);
  for (const [theater, defs] of Object.entries(standing || {})) {
    const done = new Set((saved.seeded || {})[theater] || []);
    for (const def of defs) if (!done.has(def.airspaceId)) add(def);
  }
  return [...new Set(ids)];
}

class AirspaceStore {
  /**
   * @param {object} deps
   * @param {{now:()=>number}} [deps.clock] the mission clock (docs/adr/0079): a booking window and every timestamp here is read as a time of day
   * @param {()=>string|null} [deps.currentTheater] the loaded mission's theater (MissionSession); null with no mission
   * @param {(airspaceId:string)=>Array<{stripId:string, callsign:string|null, frequencyMhz:number|null}>} [deps.occupantsFor]
   *   the non-DROPPED Strips whose `airspaceEntry` names the airspace, across every Facility's Board. Injected, as ever:
   *   this store has no business reaching into Boards, and they do not exist yet when it is built.
   * @param {(airspaceId:string)=>number} [deps.routeOccupancyFor] the non-DROPPED Strips whose flight data's
   *   `military.mtr.designator` names the route (ADR 0098 §8). A count, never a warning.
   * @param {object} [deps.facilityLookup] `{hasFacility, positionsOf, facilityOfPosition}`, the hard reference check's eyes
   * @param {{rowOf:(positionId:string)=>object}} [deps.authority] the airspace rows (authority/index.js's airspaceRowOf)
   */
  constructor({ clock = WALL_CLOCK, currentTheater = () => null, occupantsFor = () => [], routeOccupancyFor = () => 0,
    facilityLookup = null, authority = null } = {}) {
    this._clock = clock;
    this._currentTheater = currentTheater;
    this._occupantsFor = occupantsFor;
    this._routeOccupancyFor = routeOccupancyFor;
    this._lookup = facilityLookup || { hasFacility: () => true, positionsOf: () => [], facilityOfPosition: () => null };
    this._rowOf = authority ? authority.rowOf : () => ({ create: null, edit: null, delete: null, use: false });
    this._byTheater = new Map(); // theater -> Map(airspaceId -> record)
    this._seeded = new Map();    // theater -> Set(airspaceId) imported from the standing list at least once
    this._sync = new SyncLog({ epoch: true }); // the store's sequence and its lifetime (epoch, not persisted): no ring, the resync answer is the snapshot slice (docs/adr/0106)
    this._mutationLog = null;
  }

  /**
   * Same wiring the Board's audit has (board/audit.js): who activated a block, who refused a request and why, and when a
   * definition moved are exactly the questions an after-action review asks. The record's own `transitions` hold where
   * the airspace has BEEN; this holds what was asked for, refusals included.
   */
  setMutationLog(mutationLog) { this._mutationLog = mutationLog; }

  get currentSeq() { return this._sync.seq; }
  /** The lifetime this store's seq belongs to (docs/adr/0106): new per process, never persisted. */
  get epoch() { return this._sync.epoch; }

  // ── reading ────────────────────────────────────────────────────────────

  currentTheater() { return this._currentTheater() || null; }

  _theaterMap(theater, create = false) {
    let m = this._byTheater.get(theater);
    if (!m && create) { m = new Map(); this._byTheater.set(theater, m); }
    return m || null;
  }

  _record(theater, airspaceId) {
    const m = theater ? this._theaterMap(theater) : null;
    return (m && m.get(airspaceId)) || null;
  }

  /** One airspace of the current theater (or `theater`), definition merged in; null when unknown or no mission is loaded. */
  getAirspace(airspaceId, theater = this.currentTheater()) {
    const record = this._record(theater, airspaceId);
    return record ? viewOf(record) : null;
  }

  /** Every airspace of the CURRENT theater, what the client's board renders; `[]` with no mission loaded. */
  getAll() { return this.getAllFor(this.currentTheater()); }

  /** Every airspace of any theater (the web admin page's list). */
  getAllFor(theater) {
    const m = theater ? this._theaterMap(theater) : null;
    return m ? [...m.values()].map(viewOf) : [];
  }

  /** `[{theater, count}]` for every theater that holds at least one airspace. */
  listTheaters() {
    return [...this._byTheater.entries()].filter(([, m]) => m.size > 0).map(([theater, m]) => ({ theater, count: m.size }));
  }

  /** The record's bounded definition history (not part of a view), oldest first. */
  getHistory(airspaceId, theater = this.currentTheater()) {
    const record = this._record(theater, airspaceId);
    return record ? deepClone(record.definitionHistory) : [];
  }

  /** Is this airspace of the current theater ACTIVE? Read by the unactivated-entry alert. */
  isActive(airspaceId) {
    const record = this._record(this.currentTheater(), airspaceId);
    return !!(record && record.state === 'ACTIVE');
  }

  // ── the queries other code may call (ADR 0098 §7): pure, synchronous, current theater only ──

  /** ACTIVE, and the using agency is Facility `usingFacilityId` (as `usingFacilityId`, or as a `usingPositionId` of its own). */
  isActiveFor(airspaceId, usingFacilityId) {
    const record = this._record(this.currentTheater(), airspaceId);
    return !!record && record.state === 'ACTIVE' && this._usedBy(record.definition, usingFacilityId);
  }

  _usedBy(def, facilityId) {
    if (!facilityId) return false;
    if (def.usingFacilityId) return def.usingFacilityId === facilityId;
    if (def.usingPositionId) return (this._lookup.positionsOf(facilityId) || []).includes(def.usingPositionId);
    return false;
  }

  /**
   * What is ACTIVE for `usingFacilityId` around `{lat, lon, altFt}` (altFt in indicated feet, §6)?
   * `inside` holds the airspaces the point is in; `unknown` those whose geometry cannot be evaluated (never a guess).
   */
  activeContaining(point, { usingFacilityId }) {
    const inside = []; const unknown = [];
    const m = this._theaterMap(this.currentTheater());
    for (const record of (m ? m.values() : [])) {
      if (record.state !== 'ACTIVE' || !this._usedBy(record.definition, usingFacilityId)) continue;
      const where = containment.evaluate(record.definition, point);
      const row = { airspaceId: record.airspaceId, kind: record.definition.kind, name: record.definition.name };
      if (where === 'inside') inside.push(row);
      else if (where === 'unknown') unknown.push(row);
    }
    return { inside, unknown };
  }

  /** Every airspace of the current theater that contains the point, whatever its state (map and QA use). */
  containing(point) {
    const out = [];
    const m = this._theaterMap(this.currentTheater());
    for (const record of (m ? m.values() : [])) {
      if (containment.evaluate(record.definition, point) === 'inside') {
        out.push({ airspaceId: record.airspaceId, kind: record.definition.kind, name: record.definition.name, state: record.state });
      }
    }
    return out;
  }

  // ── audit ──────────────────────────────────────────────────────────────

  _recordAudit(mutation, actor, theater, before, result) {
    if (!this._mutationLog) return;
    const op = mutation.op || {};
    const afterRecord = (result.ok || result.partial) && !result.removed && mutation.airspaceId ? this._record(theater, mutation.airspaceId) : null;
    const known = (before && before.definition) || (afterRecord && afterRecord.definition) || (op.definition && typeof op.definition === 'object' ? op.definition : null);
    let facilityId = (known && known.controllingFacilityId) || null;
    if (!facilityId && result.created && result.created.length) {
      const first = this._record(theater, result.created[0]);
      facilityId = first ? first.definition.controllingFacilityId : null;
    }
    this._mutationLog.record({
      clientMutationId: mutation.clientMutationId,
      op: op.kind,
      // No stripId: an airspace op targets no Strip. Readers key on whichever id is present.
      airspaceId: mutation.airspaceId,
      theater: theater || null,
      facilityId,
      actingPositionId: actor.positionId || null,
      actorId: actor.controllerId || null,
      ...(actor.actorName ? { actorName: actor.actorName } : {}),
      via: actor.via,
      at: this._clock.now(),
      ok: result.ok,
      // A refusal is the interesting half of an authority model, so failures are logged too (unlike BoardStore's).
      reason: result.ok ? undefined : result.reason,
      detail: result.ok ? undefined : result.detail,
      ...(result.changes ? { changes: result.changes } : {}),
      ...(result.created ? { created: result.created } : {}),
      ...(result.skipped ? { skipped: result.skipped } : {}),
      ...(result.warning ? { warning: result.warning } : {}),
      before,
      after: afterRecord ? viewOf(afterRecord) : undefined,
      ...partialAuditTail(result),
    });
  }

  _touch(record, by, transition) {
    record.rev += 1;
    record.updatedAt = this._clock.now();
    record.updatedBy = by || null;
    this._sync.advance();
    if (transition) record.transitions.push({ ...transition, at: record.updatedAt, by: by || null });
  }

  // ── the one entry point ────────────────────────────────────────────────

  /**
   * Every airspace op, mirroring BoardStore's applyMutation: never throws, always returns a result the caller can turn
   * into an ack. Validation order (ADR 0098 §4): authority, then the R3-23 field gate, then the schema, then the
   * cross-references, and finally the `defRev` conflict check. Every refusal is audited (docs/adr/0083).
   *
   * @param {{clientMutationId?:string, airspaceId?:string, baseRev?:number, baseDefRev?:number, theater?:string, op:{kind:string}}} mutation
   * @param {{positionId?:string|null, controllerId?:string|null, service?:string, via:'PANEL'|'WEB'|'SEED', actorName?:string}} actor
   *   a panel actor's `positionId` is already verified by the wire gate (wire/skeleton.js) to be a Position its session
   *   is signed on to; `service` names a service principal (authority/airspace.js SERVICE_ROWS), whose ops name `mutation.theater`
   */
  apply(mutation, actor) {
    const op = mutation.op || {};
    const theater = actor.service ? (mutation.theater || (op.kind === 'ImportAirspaces' ? op.theater : null) || null) : this.currentTheater();
    let result; let before;
    const seq0 = this._sync.seq;
    try {
      if (!VIAS.includes(actor.via)) throw new Error(`unknown via ${actor.via}`);
      if (!AIRSPACE_OP_KINDS.includes(op.kind)) {
        result = verr(`unknown airspace op: ${op.kind}`);
      } else if (!theater) {
        result = actor.service ? verr('a service op names its theater') : refuse('NOT_FOUND', 'no mission loaded');
      } else if (op.kind === 'ImportAirspaces') {
        result = this._import(mutation, op, actor, theater);
      } else if (op.kind === 'CreateAirspace') {
        result = this._create(mutation, op, actor, theater);
      } else {
        const record = this._record(theater, mutation.airspaceId);
        if (!record) {
          result = refuse('NOT_FOUND');
        } else {
          before = viewOf(record);
          result = this._applyToRecord(mutation, op, actor, theater, record);
        }
      }
    } catch (err) {
      // Same backstop as BoardStore.applyMutation: one bad op must never take the process down for every client.
      log.error('unexpected error applying an airspace op — rejecting it instead of crashing', { err });
      result = internalError('airspace op', err, this._sync.seq !== seq0);
    }
    // Every result carries the record, success or not: the client renders from the ack either way, and a rejection that
    // says nothing about the current state leaves the board showing whatever the client last guessed.
    if (result.airspace === undefined && mutation.airspaceId && !result.removed) result.airspace = this.getAirspace(mutation.airspaceId, theater);
    result.theater = theater;
    this._recordAudit(mutation, actor, theater, before, result);
    return result;
  }

  _applyToRecord(mutation, op, actor, theater, record) {
    if (op.kind === 'EditAirspace') return this._edit(mutation, op, actor, theater, record);
    if (op.kind === 'DeleteAirspace') return this._delete(mutation, op, actor, theater, record);
    // State ops: an optimistic check on the record's own `rev`, then the op.
    if (mutation.baseRev !== undefined && mutation.baseRev !== null && record.rev !== mutation.baseRev) {
      return refuse('STALE_REV', undefined, { airspace: viewOf(record) });
    }
    if (actor.service) return this._denied(record, `${actor.service} may not act on airspace state`);
    const def = record.definition;
    const by = actor.controllerId; const pos = actor.positionId;
    switch (op.kind) {
      case 'ScheduleAirspace':  return this._schedule(record, def, op, pos, by);
      case 'RequestActivation': return this._requestActivation(record, def, op, pos, by);
      case 'ApproveActivation': return this._approveActivation(record, def, op, pos, by);
      case 'DenyActivation':    return this._denyActivation(record, def, op, pos, by);
      case 'DelayActivation':   return this._delayActivation(record, def, op, pos, by);
      case 'ReleaseAirspace':   return this._signOff(record, def, op, pos, by);
      case 'ReturnAirspace':    return this._return(record, def, op, pos, by);
      default: return verr(`unknown airspace op: ${op.kind}`);
    }
  }

  // ── authority (the registry's rows, authority/airspace.js) ─────────────

  _deps() { return { rowOf: this._rowOf, facilityOf: (id) => this._lookup.facilityOfPosition(id) }; }
  _principal(actor) { return actor.service ? { service: actor.service } : { positionId: actor.positionId }; }
  _isControlling(def, positionId) { return airspaceAuthority.isControlling(def, positionId); }
  _isUsing(def, positionId) { return airspaceAuthority.isUsing(def, positionId, this._deps()); }

  _denied(record, detail) {
    return refuse('PERMISSION_DENIED', detail, record ? { airspace: viewOf(record) } : undefined);
  }

  _illegal(record, toState) {
    return verr(`an airspace at ${record.state} cannot go to ${toState}`, { airspace: viewOf(record) });
  }

  _canGo(record, toState) { return (LEGAL_TRANSITIONS[record.state] || []).includes(toState); }

  _who(actor) { return actor.service ? actor.service : (actor.positionId || 'a session signed on to nothing'); }

  // ── definition ops ─────────────────────────────────────────────────────

  _names(theater, exceptId) {
    const m = this._theaterMap(theater);
    return new Set([...(m ? m.values() : [])].filter(r => r.airspaceId !== exceptId).map(r => r.definition.name.toLowerCase()));
  }

  _source(actor) { return actor.via === 'WEB' ? 'WEB' : actor.via === 'SEED' ? 'STANDING' : 'PANEL'; }

  _checkNew(def, theater, taken, source) {
    const check = schema.validateAirspaceDefinition(def, { derived: 'refuse' });
    if (!check.ok) return check;
    const out = { ...check.definition, source };
    const bad = checkReferences(out, this._lookup);
    if (bad) return bad;
    if (taken.has(out.name.toLowerCase())) return verr(`${out.airspaceId}: the name "${out.name}" is already used in ${theater}`);
    return { ok: true, definition: out };
  }

  _newRecord(def, theater, by) {
    return {
      airspaceId: def.airspaceId, theater, definition: def, defRev: 1,
      definitionHistory: [], rev: 0, state: INITIAL_STATE,
      // The booked window, set by ScheduleAirspace. Null while nothing is booked.
      window: null,
      // A pending activation request awaiting the controlling Position's answer (§9.11).
      pendingRequest: null,
      // Append-only, same shape docs/adr/0032 gave flightData.airspace.transitions and for the same reason: JO 7110.65
      // para 2-3-1's "do not erase or overwrite any item".
      transitions: [],
      updatedAt: this._clock.now(), updatedBy: by || null,
    };
  }

  _create(mutation, op, actor, theater) {
    const def = op.definition;
    if (!def || typeof def !== 'object' || Array.isArray(def)) return verr('CreateAirspace needs a definition');
    const id = def.airspaceId;
    if (typeof id === 'string' && !mutation.airspaceId) mutation.airspaceId = id;
    if (typeof id === 'string' && id !== mutation.airspaceId) return verr('the definition\'s airspaceId must match the message\'s');
    // 1. authority, against the definition being created
    if (!airspaceAuthority.definitionAuthority(this._principal(actor), 'create', def, this._deps())) {
      return this._denied(null, `${this._who(actor)} may not create ${id}: not its controlling Position, nor OPS of ${def.controllingFacilityId}`);
    }
    // 3-4. schema, references, name
    const checked = this._checkNew(def, theater, this._names(theater), this._source(actor));
    if (!checked.ok) return checked;
    const m = this._theaterMap(theater, true);
    if (m.has(checked.definition.airspaceId)) return verr(`${checked.definition.airspaceId} already exists in ${theater}`);
    const record = this._newRecord(checked.definition, theater, actor.controllerId);
    m.set(record.airspaceId, record);
    this._sync.advance();
    return { ok: true, airspace: viewOf(record), changes: [] };
  }

  _import(mutation, op, actor, theater) {
    if (!airspaceAuthority.mayImport(this._principal(actor))) return this._denied(null, `${this._who(actor)} may not import airspaces`);
    if (op.source !== 'STANDING' && op.source !== 'ACO') return verr('ImportAirspaces needs source STANDING or ACO');
    if (!Array.isArray(op.definitions)) return verr('ImportAirspaces needs a definitions array');
    const m = this._theaterMap(theater, true);
    const taken = this._names(theater);
    const accepted = []; const skipped = []; const seen = new Set();
    for (const def of op.definitions) {
      const id = def && def.airspaceId;
      if (seen.has(id)) return verr(`import refused, nothing created: ${theater} lists ${id} twice`);
      seen.add(id);
      if (typeof id === 'string' && m.has(id)) { skipped.push({ airspaceId: id, reason: 'EXISTS' }); continue; }
      const checked = this._checkNew(def, theater, taken, op.source);
      if (!checked.ok) return verr(`import refused, nothing created: ${checked.detail}`);
      taken.add(checked.definition.name.toLowerCase());
      accepted.push(checked.definition);
    }
    const created = [];
    for (const def of accepted) {
      m.set(def.airspaceId, this._newRecord(def, theater, actor.controllerId));
      created.push(def.airspaceId);
    }
    if (actor.via === 'SEED') {
      const set = this._seeded.get(theater) || new Set();
      for (const id of seen) if (typeof id === 'string') set.add(id);
      this._seeded.set(theater, set);
    }
    if (created.length) this._sync.advance();
    return { ok: true, created, skipped, updated: created.map(id => viewOf(m.get(id))) };
  }

  /** The value `field` had at `baseDefRev`: the `from` of the earliest later change to it, else today's value. */
  _baseValue(record, field, baseDefRev) {
    for (const h of record.definitionHistory) {
      if (h.defRev <= baseDefRev) continue;
      const c = h.changes.find(x => x.field === field);
      if (c) return c.from;
    }
    return record.definition[field];
  }

  /** The per-field conflict check of ADR 0098 §4: null when the edit applies, else `conflicts` ([{field, base, theirs}]). */
  _conflicts(record, baseDefRev, fields) {
    if (baseDefRev === record.defRev) return null;
    const after = record.definitionHistory.filter(h => h.defRev > baseDefRev);
    // The history holds the last DEFINITION_HISTORY_CAP edits; a base older than it is refused with every field a conflict.
    if (after.length !== record.defRev - baseDefRev) return fields.map(field => ({ field, base: null, theirs: record.definition[field] ?? null }));
    const touched = new Set(after.flatMap(h => h.changes.map(c => c.field)));
    const hits = fields.filter(f => touched.has(f));
    if (!hits.length) return null;
    return hits.map(field => ({ field, base: this._baseValue(record, field, baseDefRev) ?? null, theirs: record.definition[field] ?? null }));
  }

  _checkBase(op, mutation, record, fields) {
    const base = mutation.baseDefRev;
    if (!Number.isInteger(base)) return verr(`${op.kind} needs baseDefRev`, { airspace: viewOf(record) });
    if (base > record.defRev || base < 1) return verr(`baseDefRev ${base} is not a revision of ${record.airspaceId} (it is at ${record.defRev})`, { airspace: viewOf(record) });
    const conflicts = this._conflicts(record, base, fields);
    if (conflicts) {
      return refuse('STALE_REV', `${record.airspaceId} was edited since revision ${base}: ${conflicts.map(c => c.field).join(', ')}`, { conflicts, airspace: viewOf(record) });
    }
    return null;
  }

  _flightsDetail(record) {
    if (record.definition.kind !== 'AREA') return '';
    const flights = this._occupantsFor(record.airspaceId);
    return flights.length ? `; flights working it: ${flights.map(f => f.callsign || f.stripId).join(', ')}` : '';
  }

  _edit(mutation, op, actor, theater, record) {
    const def = record.definition;
    const patch = op.patch;
    const keep = { airspace: viewOf(record) };
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length) return verr('EditAirspace needs a non-empty patch', keep);
    const fields = Object.keys(patch);
    // 1. authority against the CURRENT definition (a Position reassigned away loses it at once)
    const scope = airspaceAuthority.definitionAuthority(this._principal(actor), 'edit', def, this._deps());
    if (!scope) return this._denied(record, `${this._who(actor)} may not edit ${def.name}: not its controlling Position, nor OPS of ${def.controllingFacilityId}`);
    if (scope === 'FREQUENCY') {
      const denied = fields.filter(f => f !== 'controlFrequencyMhz');
      if (denied.length) return this._denied(record, `${this._who(actor)} may change only the control frequency of ${def.name} (not ${denied.join(', ')})`);
    }
    // not patchable at all, whoever asks
    for (const f of fields) {
      if (!schema.DEFINITION_FIELDS.includes(f)) return verr(`an airspace has no field ${f}`, keep);
      if (schema.IMMUTABLE_FIELDS.includes(f)) return verr(`${f} cannot be changed after the airspace is created`, keep);
      if (f === 'source') return verr('source is stamped by the registry and cannot be edited', keep);
      if (def.kind === 'ROUTE' && schema.DERIVED_ROUTE_FIELDS.includes(f)) return verr(`${f} of a ROUTE is derived from its segments and cannot be edited`, keep);
      if (def.kind === 'AREA' && (f === 'segments' || f === 'defaultWidthNm')) return verr(`an AREA has a geometry, not ${f}`, keep);
      if (def.kind === 'ROUTE' && f === 'geometry') return verr('a ROUTE has segments, not a geometry', keep);
    }
    // 2. R3-23: while SCHEDULED, ACTIVE or RELEASED, or with a pending request, only the name and the frequencies
    if (record.state !== 'RETURNED' || record.pendingRequest) {
      const locked = fields.filter(f => !schema.LIVE_EDITABLE_FIELDS.includes(f));
      if (locked.length) {
        return verr(`${def.name} is ${record.state}${record.pendingRequest ? ' with an activation request outstanding' : ''}: only ${schema.LIVE_EDITABLE_FIELDS.join(', ')} can change, not ${locked.join(', ')}${this._flightsDetail(record)}`, keep);
      }
    }
    // 3. schema, on the merged definition
    const merged = { ...def };
    for (const f of fields) {
      if (patch[f] === null && !schema.OPTIONAL_FIELDS.includes(f)) return verr(`${f} cannot be cleared`, keep);
      merged[f] = patch[f];
    }
    const checked = schema.validateAirspaceDefinition(merged, { derived: 'recompute' });
    if (!checked.ok) return { ...checked, ...keep };
    const next = { ...checked.definition, source: def.source };
    // 4. references and the name
    const bad = checkReferences(next, this._lookup);
    if (bad) return { ...bad, ...keep };
    if (fields.includes('name') && this._names(theater, record.airspaceId).has(next.name.toLowerCase())) {
      return verr(`the name "${next.name}" is already used in ${theater}`, keep);
    }
    // 5. defRev
    const stale = this._checkBase(op, mutation, record, fields);
    if (stale) return stale;

    const changes = Object.keys(next).filter(k => !same(def[k], next[k])).map(k => ({ field: k, from: def[k] ?? null, to: next[k] ?? null }));
    if (!changes.length) return { ok: true, changes: [], airspace: viewOf(record) };
    const occupied = def.kind === 'AREA' ? this._occupantsFor(record.airspaceId) : [];
    const now = this._clock.now();
    record.definition = next;
    record.defRev += 1;
    record.definitionHistory.push({ defRev: record.defRev, at: now, by: actor.controllerId || null, positionId: actor.positionId || null, via: actor.via, changes });
    while (record.definitionHistory.length > schema.DEFINITION_HISTORY_CAP) record.definitionHistory.shift();
    record.updatedAt = now; record.updatedBy = actor.controllerId || null;
    this._sync.advance();

    const result = { ok: true, changes, airspace: viewOf(record) };
    if (changes.some(c => c.field === 'usingPositionId')) result.effectiveAtRestart = true;
    if (occupied.length) {
      // AIRSP-4: an AREA edit while flights work it warns and lists them; `staleEntries` are the Strips whose entry
      // frequency is neither of the new frequencies.
      result.warning = 'AIRSPACE_EDITED_OCCUPIED';
      result.occupied = occupied.map(o => ({ stripId: o.stripId, callsign: o.callsign }));
      const freqChanged = changes.some(c => c.field === 'workingFrequencyMhz' || c.field === 'controlFrequencyMhz');
      const current = [next.workingFrequencyMhz, next.controlFrequencyMhz].filter(v => v != null);
      result.staleEntries = freqChanged
        ? occupied.filter(o => o.frequencyMhz != null && !current.includes(o.frequencyMhz)).map(o => ({ stripId: o.stripId, callsign: o.callsign, frequencyMhz: o.frequencyMhz }))
        : [];
    }
    return result;
  }

  _delete(mutation, op, actor, theater, record) {
    const def = record.definition;
    if (!airspaceAuthority.definitionAuthority(this._principal(actor), 'delete', def, this._deps())) {
      return this._denied(record, `${this._who(actor)} may not delete ${def.name}: not its controlling Position, nor OPS of ${def.controllingFacilityId}`);
    }
    // The guard (AIRSP-5): RETURNED, no pending request, and (AREA) nobody working it.
    const blockers = [];
    if (record.state !== 'RETURNED') blockers.push(`it is ${record.state}`);
    if (record.pendingRequest) blockers.push('an activation request is outstanding');
    if (def.kind === 'AREA') {
      const flights = this._occupantsFor(record.airspaceId);
      if (flights.length) blockers.push(`${flights.length} flight${flights.length === 1 ? ' is' : 's are'} working it (${flights.map(f => f.callsign || f.stripId).join(', ')})`);
    }
    if (blockers.length) return verr(`${def.name} cannot be deleted: ${blockers.join('; ')}`, { blockers, airspace: viewOf(record) });
    // A delete conflicts with any edit since its base (the editor has not seen what it is deleting).
    const base = mutation.baseDefRev;
    const touchedSince = Number.isInteger(base) ? [...new Set(record.definitionHistory.filter(h => h.defRev > base).flatMap(h => h.changes.map(c => c.field)))] : [];
    const stale = this._checkBase(op, mutation, record, touchedSince);
    if (stale) return stale;
    if (Number.isInteger(base) && base < record.defRev && !touchedSince.length) {
      return refuse('STALE_REV', `${record.airspaceId} was edited since revision ${base}`, { conflicts: [], airspace: viewOf(record) });
    }
    this._theaterMap(theater).delete(record.airspaceId);
    this._sync.advance();
    return { ok: true, removed: record.airspaceId, airspace: null };
  }

  // ── state ops ──────────────────────────────────────────────────────────

  _schedule(record, def, op, pos, by) {
    if (!this._isUsing(def, pos) && !this._isControlling(def, pos)) return this._denied(record, `${pos} neither uses nor controls ${def.name}`);
    if (!this._canGo(record, 'SCHEDULED')) return this._illegal(record, 'SCHEDULED');
    const { fromUtc, toUtc } = op;
    if (typeof fromUtc !== 'number' || typeof toUtc !== 'number' || !(toUtc > fromUtc)) {
      return verr('a schedule needs fromUtc and toUtc, with toUtc after fromUtc', { airspace: viewOf(record) });
    }
    record.state = 'SCHEDULED';
    record.window = { fromUtc, toUtc };
    record.pendingRequest = null;
    this._touch(record, by, { state: 'SCHEDULED', actingPositionId: pos, window: { fromUtc, toUtc } });
    return { ok: true };
  }

  _requestActivation(record, def, op, pos, by) {
    if (!this._isUsing(def, pos)) return this._denied(record, `${pos} is not the using agency for ${def.name}`);
    if (record.state !== 'SCHEDULED') return verr('only a SCHEDULED airspace can be requested for activation', { airspace: viewOf(record) });
    if (record.pendingRequest) return verr('an activation request is already outstanding', { airspace: viewOf(record) });
    record.pendingRequest = { requestedBy: by || null, requestedPositionId: pos, requestedAt: this._clock.now(), note: op.note || null };
    // Not a state transition (the airspace stays SCHEDULED until answered), so not appended to `transitions`.
    this._touch(record, by, null);
    return { ok: true };
  }

  _approveActivation(record, def, op, pos, by) {
    // For a ROUTE this is CONFIRM (ADR 0098 §4, S-R3-80): allowed with or without a request.
    if (!this._isControlling(def, pos)) return this._denied(record, `only ${def.controllingPositionId} may ${def.kind === 'ROUTE' ? 'confirm' : 'approve'} activation of ${def.name}`);
    if (!this._canGo(record, 'ACTIVE')) return this._illegal(record, 'ACTIVE');
    // An AREA with its own using agency must actually have asked. One without has no second party to ask, so its
    // controlling Position activates directly: the ordinary-MOA case.
    if (schema.ACTIVATION_BY_KIND[def.kind] === 'APPROVE' && (def.usingPositionId || def.usingFacilityId) && !record.pendingRequest) {
      return verr('no activation request is outstanding', { airspace: viewOf(record) });
    }
    const request = record.pendingRequest;
    record.state = 'ACTIVE';
    record.pendingRequest = null;
    this._touch(record, by, {
      state: 'ACTIVE', actingPositionId: pos,
      // A boundary event between two Positions held by one controller is a self-coordination (§4.8.3): the state change
      // is mandatory, only the two-party dialogue collapses. Recorded so the audit trail can tell it from a real approval.
      selfCoordinated: !!(request && request.requestedBy && request.requestedBy === (by || null)),
    });
    return { ok: true };
  }

  _denyActivation(record, def, op, pos, by) {
    if (def.kind === 'ROUTE') return verr('a route cannot be denied, delay it', { airspace: viewOf(record) });
    if (!this._isControlling(def, pos)) return this._denied(record, `only ${def.controllingPositionId} may act on activation of ${def.name}`);
    if (!record.pendingRequest) return verr('no activation request is outstanding', { airspace: viewOf(record) });
    record.pendingRequest = null;
    record.lastDenial = { deniedBy: by || null, deniedAt: this._clock.now(), reason: op.reason || null };
    this._touch(record, by, null);
    return { ok: true };
  }

  /** ROUTE only: "ATC should not deny, only delay" (JO 7610.14 6-6-5, S-R3-80). The request stays pending. */
  _delayActivation(record, def, op, pos, by) {
    if (def.kind !== 'ROUTE') return verr('only a route activation is delayed; an area request is approved or denied', { airspace: viewOf(record) });
    if (!this._isControlling(def, pos)) return this._denied(record, `only ${def.controllingPositionId} may delay activation of ${def.name}`);
    if (!record.pendingRequest) return verr('no activation request is outstanding', { airspace: viewOf(record) });
    record.pendingRequest.delay = { note: op.note || null, at: this._clock.now(), by: by || null };
    this._touch(record, by, null);
    return { ok: true };
  }

  _signOff(record, def, op, pos, by) {
    if (!this._isUsing(def, pos)) return this._denied(record, `${pos} is not the using agency for ${def.name}`);
    if (!this._canGo(record, 'RELEASED')) return this._illegal(record, 'RELEASED');
    // Releasing a block somebody is still working is allowed (the board may simply not have caught up), but it must
    // say so: from this moment the panel considers those flights to be in airspace nobody holds, which is exactly
    // what UNACTIVATED_AIRSPACE_ENTRY alerts on. A ROUTE is never "occupied" (a count only, S-R3-80).
    const occupied = def.kind === 'AREA' ? this._occupantsFor(record.airspaceId).length : 0;
    record.state = 'RELEASED';
    this._touch(record, by, { state: 'RELEASED', actingPositionId: pos, occupiedAtRelease: occupied });
    return occupied > 0 ? { ok: true, warning: 'AIRSPACE_STILL_OCCUPIED', occupied } : { ok: true };
  }

  _return(record, def, op, pos, by) {
    if (!this._isControlling(def, pos)) return this._denied(record, `only ${def.controllingPositionId} may take ${def.name} back`);
    if (!this._canGo(record, 'RETURNED')) return this._illegal(record, 'RETURNED');
    record.state = 'RETURNED';
    record.window = null;
    record.pendingRequest = null;
    this._touch(record, by, { state: 'RETURNED', actingPositionId: pos });
    return { ok: true };
  }

  /** A ROUTE's occupancy: a count of the Strips whose MTR designator names it. Shown, never warned on. */
  routeOccupancy(airspaceId) { return this._routeOccupancyFor(airspaceId); }

  // ── the standing list (R3-26, ADR 0098 §10) ────────────────────────────

  /**
   * Applies the standing list as `ImportAirspaces` (via 'SEED') for each theater's ids not yet in `seeded[theater]`. An
   * id is seeded once: a later delete is not resurrected and a later addition to the shipped file lands. A definition
   * that fails validation or the reference check is a START-UP error naming the theater and the id (ARCH-D5).
   * @param {Object<string, object[]>} standing
   * @returns {number} airspaces created
   */
  seed(standing) {
    let created = 0;
    for (const [theater, defs] of Object.entries(standing || {})) {
      const done = this._seeded.get(theater) || new Set();
      const fresh = defs.filter(d => !done.has(d.airspaceId));
      if (!fresh.length) continue;
      const result = this.apply(
        { clientMutationId: null, op: { kind: 'ImportAirspaces', theater, source: 'STANDING', definitions: fresh } },
        { service: 'SEED', via: 'SEED', controllerId: 'system', positionId: null },
      );
      if (!result.ok) throw new Error(`[efsp] the standing airspace list (theater ${theater}) cannot be seeded: ${result.detail}`);
      created += result.created.length;
    }
    return created;
  }

  /** The `usingPositionId`s of every theater's definitions (the RANGES Facility's Positions, derived at the next start). */
  rangePositionIds() {
    const ids = [];
    for (const m of this._byTheater.values()) for (const r of m.values()) if (r.definition.usingPositionId) ids.push(r.definition.usingPositionId);
    return [...new Set(ids)];
  }

  // ── persistence (durable per docs/adr/0002; one atomic Board snapshot, ADR 0098 §10) ──

  snapshot() {
    const byTheater = {};
    for (const [theater, m] of this._byTheater) if (m.size) byTheater[theater] = [...m.values()].map(deepClone);
    const seeded = {};
    for (const [theater, set] of this._seeded) if (set.size) seeded[theater] = [...set];
    return { byTheater, seeded };
  }

  /** Throws on the pre-0098 array shape and on a definition that does not validate (an unknown persisted shape is never read half-way). */
  restore(data) {
    if (data === undefined || data === null) return;
    if (Array.isArray(data)) {
      throw new Error('[efsp] the Board snapshot holds airspaces in the pre-ADR-0098 shape (a bare array of records): delete state/efsp-board.json to start clean');
    }
    this._byTheater = new Map();
    this._seeded = new Map();
    for (const [theater, records] of Object.entries(data.byTheater || {})) {
      const m = this._theaterMap(theater, true);
      for (const saved of records) {
        const check = schema.validateAirspaceDefinition(saved.definition, { derived: 'recompute' });
        if (!check.ok || saved.airspaceId !== saved.definition.airspaceId || !AIRSPACE_STATES.includes(saved.state)) {
          throw new Error(`[efsp] the Board snapshot holds airspace ${saved.airspaceId} (theater ${theater}) in a shape this build does not read${check.ok ? '' : `: ${check.detail}`}: delete state/efsp-board.json to start clean`);
        }
        const record = deepClone(saved);
        record.theater = theater;
        record.definition = check.definition;
        record.definitionHistory = Array.isArray(saved.definitionHistory) ? saved.definitionHistory : [];
        m.set(record.airspaceId, record);
        const bad = checkReferences(record.definition, this._lookup);
        if (bad) log.warn('a restored airspace names a Facility or Position this build does not have: nobody can act on it until it is edited', { theater, airspaceId: record.airspaceId, detail: bad.detail });
      }
    }
    for (const [theater, ids] of Object.entries(data.seeded || {})) this._seeded.set(theater, new Set(ids));
  }

  /**
   * Did this audited Mutation (a Mutation-log entry) reach the restored snapshot? Used by the boot reconcile
   * (docs/adr/0081, 0083): a crash between the audit line and the persist leaves a line for a change the restored
   * store does not have. Judged on the revisions the line's `after` recorded.
   */
  hasApplied(entry) {
    if (!entry || !entry.theater) return true;
    if (entry.op === 'ImportAirspaces') return (entry.created || []).every(id => !!this._record(entry.theater, id));
    const record = this._record(entry.theater, entry.airspaceId);
    if (entry.op === 'DeleteAirspace') return !record;
    if (!record) return false;
    if (!entry.after) return true;
    return record.rev >= entry.after.rev && record.defRev >= entry.after.defRev;
  }
}

module.exports = {
  AirspaceStore, AIRSPACE_STATES, LEGAL_TRANSITIONS, INITIAL_STATE, AIRSPACE_OP_KINDS, DEFINITION_OP_KINDS, STATE_OP_KINDS,
  checkReferences, deriveRangePositionIds,
};
