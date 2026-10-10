'use strict';

// The CarrierStore (docs/adr/0064 B6, docs/adr/0074): a SIXTH store, peer to
// FlightDataStore, BoardStore, AirspaceStore, CorrelationStore, MarsaStore and
// RunwayStatusStore, keyed by `hullId`.
//
// The Case and the Marshal stack are facts about the SHIP's recovery, spanning
// many flights, so they live neither on the Board nor on flight data, for the reason
// airspace (ADR 0034) and MARSA (ADR 0051) do not. One record per hull:
//
//   { hullId, rev, recoveryCase, overrides, stacks: { [stackId]: MarshalStack }, transitions[] }
//
// v1 has one hull and one `MAIN` stack (decisions H29), so a second stack or
// hull is additive. Entries are keyed by flightDataId, never by Strip or track id.
//
// WHAT IS STORED AND WHAT IS NOT. The stored record holds only authoritative
// values: the Case, the stack index of each flight, and the OVERRIDES a
// controller typed over the ship's state (BRC, final bearing, ramp time, marshal
// radial, first fix, weather, the recovery tanker; carrier/carrier-state.js,
// docs/adr/0113). Every value of that state is resolved, with its source (DCS,
// default, override), each time a view is built. Angels, DME, push time and the
// ship banner are DERIVED the same way, and are never written anywhere (§9.12
// rule 1, D16): marshal-stack.js refuses an entry that carries one, and this store
// never builds one. The ship state and the wind at the ship are held in memory
// only (`setShipState`, `setShipWind`), published by a server tick, and
// re-derived after a restart.
//
// Built on marsa-store.js: own record map, per-record rev with STALE_REV, a
// monotonic `_sync` seq, an audit line for every op INCLUDING refusals, a never-
// throwing `apply`, and snapshot/restore that normalise rather than refuse (a
// restart must come up). Every time comes from the injected mission clock
// (decisions H11); nothing here reads Date.now().
//
// Authority is the caller's two-way check: the wire gate (wire/skeleton.js) verifies the session is
// Primary at the acting Position (docs/adr/0029), and this store asks
// permission.js's one-parameter predicates which Position may do what (D21).

const permission = require('./permission');
const carrier = require('./carrier');
const { resolveZuluHhmm } = require('./zulu-time');
const { WALL_CLOCK } = require('../mission-clock');
const { SyncedStore } = require('./synced-store');
const log = require('../log').logger('efsp:carrier-store');

const TRANSITIONS_CAP = 200; // engineering bound: the newest transitions kept per record; no meaning attached
const STATE_OP = 'SetCarrierState';

function deepClone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

class CarrierStore extends SyncedStore {
  /**
   * @param {object} deps
   * @param {object[]} deps.hulls hull configs (carrier/hull-config.js)
   * @param {(flightDataId:string)=>boolean} [deps.flightDataExists]
   * @param {(positionId:string)=>boolean} [deps.isStaffed] CARRIER Position staffing, for lane feeding
   * @param {{now:()=>number}} [deps.clock] the mission clock
   * @param {object} [deps.tuning] carrier/recovery-tuning.js (the shipped file when absent)
   */
  constructor({ hulls, flightDataExists, isStaffed, clock = WALL_CLOCK, mutationLog = null, tuning = null } = {}) {
    super({ clock, mutationLog });
    this._tuning = tuning || carrier.loadRecoveryTuning();
    this._flightDataExists = flightDataExists || (() => true);
    this._isStaffed = isStaffed || (() => false);
    if (!hulls || !hulls.length) throw new Error('CarrierStore needs at least one hull (config/efsp-carriers.json)');
    this._hulls = hulls.map(deepClone);
    this._records = new Map();
    for (const h of this._hulls) this._records.set(h.hullId, this._fresh(h.hullId));
    this._shipStates = new Map(); // hullId -> banner (derived, never persisted)
    this._shipWinds = new Map();  // hullId -> { windFromDeg, windKt } at the ship (derived, never persisted)
  }

  _fresh(hullId) {
    return {
      hullId, rev: 0,
      recoveryCase: carrier.initialRecoveryCase(),
      overrides: carrier.emptyOverrides(),
      stacks: { [carrier.DEFAULT_STACK_ID]: carrier.emptyStack({ stackId: carrier.DEFAULT_STACK_ID, hullId }) },
      transitions: [],
    };
  }

  get defaultHullId() { return this._hulls[0].hullId; }
  hullIds() { return this._hulls.map(h => h.hullId); }
  hull(hullId = this.defaultHullId) { const h = this._hulls.find(x => x.hullId === hullId); return h ? deepClone(h) : null; }

  // ── reads ───────────────────────────────────────────────────────────────

  getRecord(hullId = this.defaultHullId) { return deepClone(this._records.get(hullId)) || null; }

  /** 'I' | 'II' | 'III' for a hull (default III, ADR 0064). */
  caseValue(hullId = this.defaultHullId) {
    const r = this._records.get(hullId);
    return r ? r.recoveryCase.value : null;
  }

  /** Is this flight in a hull's stack (any entry, pushed or holding)? */
  inStack(flightDataId, hullId = this.defaultHullId) {
    const r = this._records.get(hullId);
    return !!r && Object.values(r.stacks).some(s => s.entries.some(e => e.flightDataId === flightDataId));
  }

  /** The magnetic variation at the ship, or null (a typed magnetic bearing cannot be converted without it). */
  _variation(hullId) {
    const ship = this._shipStates.get(hullId);
    return ship && Number.isFinite(ship.magneticVariationDeg) ? ship.magneticVariationDeg : null;
  }

  /** One hull's resolved state (every value with its source, carrier/carrier-state.js) and what the stack derives from. */
  _resolve(record) {
    const state = carrier.resolveState({
      overrides: record.overrides, recoveryCase: record.recoveryCase, shipState: this._shipStates.get(record.hullId) || null,
      hull: this._hulls.find(h => h.hullId === record.hullId) || null, shipWind: this._shipWinds.get(record.hullId) || null,
      tuning: this._tuning, variationDeg: this._variation(record.hullId),
    });
    return { state, inputs: carrier.recoveryInputs(state, this._tuning) };
  }

  /** The resolved state of a hull (copies), for the callers that read one value: `state.brc.value`, `state.rampTime.source`, ... */
  state(hullId = this.defaultHullId) {
    const r = this._records.get(hullId);
    return r ? deepClone(this._resolve(r).state) : null;
  }

  /**
   * The staffed CV_APP lane the stack would feed this flight to, or null
   * (carrier/handoffs.js: alternating by push ordinal, the other lane when the
   * preferred one is unstaffed, none when neither is).
   */
  laneFor(flightDataId, hullId = this.defaultHullId) {
    const r = this._records.get(hullId);
    if (!r) return null;
    const { inputs } = this._resolve(r);
    for (const stack of Object.values(r.stacks)) {
      const derived = carrier.deriveStack(stack, inputs);
      const lane = carrier.assignLanes(derived, { isStaffed: this._isStaffed }).find(l => l.flightDataId === flightDataId);
      if (lane) return lane.lane;
    }
    return null;
  }

  /**
   * The wire view of one hull: the record, the resolved state, the banner, and the DERIVED stack,
   * so crc-desktop never reimplements the arithmetic (ADR 0064 B6: one
   * implementation beats a client copy under a parity test).
   */
  view(hullId = this.defaultHullId) {
    const r = this._records.get(hullId);
    if (!r) return null;
    const shipState = this._shipStates.get(hullId) || null;
    const { state, inputs } = this._resolve(r);
    const derived = {};
    const consistency = {};
    for (const [stackId, stack] of Object.entries(r.stacks)) {
      // One implementation of every bearing's magnetic display (H15): the
      // client draws `display`, it never converts.
      const mv = this._variation(hullId);
      const ref = (v) => (v == null ? 'TRUE' : v);
      derived[stackId] = carrier.deriveStack(stack, inputs).map(e => ({
        ...e,
        marshalRadialDisplay: carrier.displayBearing(e.marshalRadialDeg, { ref: ref(state.radial.ref), magneticVariationDeg: mv }),
        expectedFinalBearingDisplay: carrier.displayBearing(e.expectedFinalBearingDeg, { ref: ref(state.finalBearing.ref), magneticVariationDeg: mv }),
      }));
      // §9.12's "SHOULD validate": non-empty only when something is wrong (ADR 0058).
      consistency[stackId] = carrier.checkConsistency(derived[stackId]);
    }
    // What each slot WOULD read if a flight stood in it, so a drag-to-slot can
    // preview the new angels, DME and push time without the client doing any
    // arithmetic. The slots run from 0 to one above the top of the stack (a drop higher would leave a gap, which the model refuses).
    const slots = {};
    for (const [stackId, stack] of Object.entries(r.stacks)) {
      const top = stack.entries.reduce((m, e) => Math.max(m, e.stackIndex), -1);
      const last = Math.min(carrier.STACK_DEFAULTS.maxIndex, top + 1); // one open slot above the stack: a drop there appends
      slots[stackId] = [];
      for (let i = 0; i <= last; i++) {
        const d = carrier.deriveEntry({ flightDataId: null, stackIndex: i, status: 'HOLDING', caseIAngels: null }, { ...inputs, deltaMs: stack.deltaMs });
        slots[stackId].push({ stackIndex: i, angels: d.angels, marshalDme: d.marshalDme, pushTimeUtc: d.pushTimeUtc });
      }
    }
    const lanes = {};
    for (const [stackId, stack] of Object.entries(r.stacks)) {
      lanes[stackId] = carrier.assignLanes(carrier.deriveStack(stack, inputs), { isStaffed: this._isStaffed });
    }
    // The banner is what the GAME says about the ship (BRC, final bearing, altimeter as DCS has them). The values in force,
    // overrides included, are `state`; the client draws those.
    let banner = deepClone(shipState);
    if (banner) {
      const ref = banner.headingRef === 'GRID' ? 'GRID' : 'TRUE';
      const mv = Number.isFinite(banner.magneticVariationDeg) ? banner.magneticVariationDeg : null;
      banner.brcDisplay = carrier.displayBearing(banner.brcDeg, { ref, magneticVariationDeg: mv });
      banner.finalBearingDisplay = carrier.displayBearing(banner.finalBearingDeg, { ref, magneticVariationDeg: mv });
    }
    const { overrides, ...rest } = deepClone(r);
    return {
      ...rest,
      overrides,
      state,
      tuning: { fixToRampMs: this._tuning.fixToRampMs, pushSpacingMs: this._tuning.pushSpacingMs },
      shipState: banner,
      derived, slots, lanes, consistency,
      advisory: this._advisory(hullId),
      hull: this.hull(hullId),
    };
  }

  getAll() { return this.hullIds().map(id => this.view(id)); }

  _advisory(hullId) {
    const base = this._wx && this._wx(hullId);
    const r = this._records.get(hullId);
    if (!base || !r) return null;
    // The ceiling and visibility are the ones a controller typed (DCS-gRPC gives neither); night is from the sun.
    const { weather } = this._resolve(r).state;
    return carrier.caseAdvisory(this.caseValue(hullId), { ...base, ceilingFt: weather.ceiling.value, visibilityNm: weather.visibility.value });
  }

  /** server.js injects the weather the advisory reads: `(hullId) => { night }` or null. */
  setWeatherSource(fn) { this._wx = typeof fn === 'function' ? fn : null; }

  // ── the banner and the wind (derived, published by a tick) ───────────────

  /**
   * Sets the banner for a hull; true when it changed enough to broadcast
   * (carrier.shipStateChanged: a whole degree of BRC, speed, altimeter, or a
   * stale/found flip). Not audited per tick, and not persisted.
   */
  setShipState(hullId, next) {
    const prev = this._shipStates.get(hullId) || null;
    if (prev && !carrier.shipStateChanged(prev, next)) return false;
    this._shipStates.set(hullId, next);
    this._sync.advance();
    return true;
  }
  getShipState(hullId = this.defaultHullId) { return deepClone(this._shipStates.get(hullId) || null); }

  /** The wind DCS reports at the ship ({ windFromDeg (true), windKt }, whole numbers), or null. True when it moved. Not audited, not persisted. */
  setShipWind(hullId, wind) {
    const prev = this._shipWinds.get(hullId) || null;
    const next = wind && Number.isFinite(wind.windFromDeg) && Number.isFinite(wind.windKt) ? { windFromDeg: wind.windFromDeg, windKt: wind.windKt } : null;
    if ((prev && next && prev.windFromDeg === next.windFromDeg && prev.windKt === next.windKt) || (!prev && !next)) return false;
    if (next) this._shipWinds.set(hullId, next); else this._shipWinds.delete(hullId);
    this._sync.advance();
    return true;
  }

  // ── audit ───────────────────────────────────────────────────────────────

  _audit(mutation, actingPositionId, by, before, result, extra = {}) {
    this._writeAudit(mutation, {
      // Its own id field: a carrier op targets a ship's recovery, which no
      // single stripId/flightDataId/marsaId names (marsa-store.js's reasoning).
      subject: { carrierHullId: mutation.hullId || this.defaultHullId },
      actingPositionId, by, result, before,
      after: () => (result.record ? deepClone(result.record) : undefined),
      // A state change names the field it set or cleared (the typed value is in `after`, the old one in `before`).
      extra: mutation.op && mutation.op.kind === STATE_OP ? { field: mutation.op.field, ...extra } : extra,
    });
  }

  _touch(record, by, op, detail) {
    this._bump(record);
    record.transitions.push({ at: this._clock.now(), by: by || null, op, detail: detail == null ? null : String(detail).slice(0, 200) });
    if (record.transitions.length > TRANSITIONS_CAP) record.transitions.splice(0, record.transitions.length - TRANSITIONS_CAP);
  }

  // ── controller ops ──────────────────────────────────────────────────────

  /**
   * The one entry point for a controller-driven carrier op (SetCarrierState, a stack
   * op). Never throws. `changed` on a stack op is the flightDataIds
   * whose derived display moved, in stack order, for the one delta.
   *
   * @param {{clientMutationId:string, hullId?:string, baseRev?:number, op:object}} mutation
   * @param {string} actingPositionId already verified by the wire gate (wire/skeleton.js) to be Primary for the session
   * @param {string} by controllerId
   */
  apply(mutation, actingPositionId, by) {
    const op = mutation.op || {};
    const hullId = mutation.hullId || this.defaultHullId;
    const record = this._records.get(hullId);
    if (!record) {
      const miss = { ok: false, reason: 'NOT_FOUND', detail: `unknown hull ${hullId}` };
      this._audit(mutation, actingPositionId, by, null, miss);
      return miss;
    }
    if (mutation.baseRev !== undefined && mutation.baseRev !== null && record.rev !== mutation.baseRev) {
      const stale = { ok: false, reason: 'STALE_REV', record: deepClone(record) };
      this._audit(mutation, actingPositionId, by, deepClone(record), stale);
      return stale;
    }
    const before = deepClone(record);
    const result = this._guarded('carrier op', log, () => this._dispatch(record, op, actingPositionId, by));
    if (!result.record) result.record = deepClone(record);
    // Passing a clearance is audited with what was passed: which flight, which fields, the values (docs/adr/0115).
    const extra = result.ok && op.kind === 'PassClearance'
      ? { flightDataId: op.flightDataId, passed: result.passed || [], angels: op.angels, eatUtc: op.eatUtc }
      : {};
    this._audit(mutation, actingPositionId, by, before, result, extra);
    return result;
  }

  _dispatch(record, op, actingPositionId, by) {
    if (op.kind === STATE_OP) return this._setState(record, op, actingPositionId, by);
    if (carrier.STACK_OP_KINDS.includes(op.kind)) {
      if (!permission.canSequenceMarshalStack(actingPositionId)) {
        return { ok: false, reason: 'PERMISSION_DENIED', detail: `${actingPositionId} does not sequence the Marshal stack` };
      }
      return this._stackOp(record, op, by, false);
    }
    // SetAngels, SetDme and anything else: say why (WP7A bullet 2, D16).
    const r = carrier.applyStackOp(this._stackOf(record, op.stackId), op);
    return r.ok ? { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown carrier op '${op.kind}'` } : r;
  }

  /**
   * `{ kind: 'SetCarrierState', field, value }`: type a value over the ship's state, or clear the override with `value: null`
   * ("Use DCS" / "Use default", ADR 0113). PriFly and the Marshal both edit it; every other Position reads.
   *
   * A controller types what a controller reads: a MAGNETIC bearing, a Zulu HHMM, feet, knots. The conversion happens here, on the
   * server, once (the client never converts a typed value), and the record only ever holds a TRUE bearing and epoch ms.
   * The Case is PriFly's call and is never refused on the weather (D11): the advisory only advises.
   */
  _setState(record, op, actingPositionId, by) {
    if (!permission.canEditCarrierState(actingPositionId)) {
      return { ok: false, reason: 'PERMISSION_DENIED', detail: `${actingPositionId} does not set the carrier state — PriFly and the Marshal do` };
    }
    const at = this._clock.now();
    // A Case or ramp-time change moves holding flights' angels or EATs: those are marked until passed (docs/adr/0115).
    const derivedBefore = this._derivedAll(record);
    if (op.field === carrier.CASE_FIELD) {
      const r = (op.value === null || op.value === undefined || op.value === '')
        ? carrier.clearCase(record.recoveryCase, { by, at, note: op.note })
        : carrier.setCase(record.recoveryCase, op.value, { by, at, note: op.note });
      if (!r.ok) return r;
      const last = r.case.history[r.case.history.length - 1];
      record.recoveryCase = r.case;
      this._markChanges(record, derivedBefore);
      this._touch(record, by, STATE_OP, `case ${last.from} -> ${r.case.value}`);
      // One record changes, and every client re-renders every carrier Strip from it.
      return { ok: true, record: deepClone(record), changed: 'ALL' };
    }
    const v = carrier.validateField(op.field, op.value, { variationDeg: this._variation(record.hullId), now: at });
    if (!v.ok) return v;
    if (record.overrides[v.key] === v.stored) return { ok: true, record: deepClone(record), changed: [], unchanged: true };
    record.overrides[v.key] = v.stored;
    // A new ramp time starts the schedule afresh: a Delta (docs/adr/0114) was a delay on the OLD one, and the Marshal who types
    // a new ramp time has already allowed for it.
    if (v.key === 'rampTimeUtc') for (const stack of Object.values(record.stacks)) stack.deltaMs = 0;
    this._markChanges(record, derivedBefore);
    this._touch(record, by, STATE_OP, `${op.field} ${v.stored === null ? 'cleared' : JSON.stringify(v.stored)}`);
    return { ok: true, record: deepClone(record), changed: 'ALL' };
  }

  /** Every stack of a record, derived as it stands: { [stackId]: derived[] }. */
  _derivedAll(record) {
    const { inputs } = this._resolve(record);
    const out = {};
    for (const [stackId, stack] of Object.entries(record.stacks)) out[stackId] = carrier.deriveStack(stack, inputs);
    return out;
  }

  /**
   * The server decides what counts as a change to a holding flight's clearance (docs/adr/0115): compare each stack, derived,
   * with `before` and mark the angels or EAT that moved (carrier.markClearanceChanges). Called after every op that can move one.
   */
  _markChanges(record, before) {
    const after = this._derivedAll(record);
    for (const [stackId, stack] of Object.entries(record.stacks)) {
      record.stacks[stackId] = carrier.markClearanceChanges(stack, before[stackId] || [], after[stackId] || []);
    }
  }

  _stackOf(record, stackId) {
    return record.stacks[stackId || carrier.DEFAULT_STACK_ID] || record.stacks[carrier.DEFAULT_STACK_ID];
  }

  _stackOp(record, op, by, quiet) {
    const stackId = op.stackId || carrier.DEFAULT_STACK_ID;
    const stack = record.stacks[stackId];
    if (!stack) return { ok: false, reason: 'NOT_FOUND', detail: `unknown stack ${stackId}` };
    if ((op.kind === 'InsertAt' || op.kind === 'Append') && !this._flightDataExists(op.flightDataId)) {
      return { ok: false, reason: 'NOT_FOUND', detail: `unknown flight data ${op.flightDataId}` };
    }
    const opts = { ...carrier.STACK_DEFAULTS };
    const derivedBefore = this._derivedAll(record);
    if (op.kind === 'PassClearance') {
      // What the flight's clearance reads now; the op must name the same values (it was passed as read).
      const d = derivedBefore[stackId].find(e => e.flightDataId === op.flightDataId);
      if (d) opts.current = { angels: d.angels, eatUtc: d.pushTimeUtc };
    }
    if (op.kind === 'Delta' || op.kind === 'MarkPushed') {
      const { inputs } = this._resolve(record);
      if (op.kind === 'Delta' && !Number.isFinite(inputs.rampTimeUtc)) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no ramp time is set, so there is no EAT to move' };
      }
      if (op.kind === 'MarkPushed') {
        // The moment it commences and the EAT it was working to, from the mission clock and the derivation (docs/adr/0114).
        opts.nowMs = this._clock.now();
        const entry = stack.entries.find(e => e.flightDataId === op.flightDataId);
        if (entry) opts.eatUtc = carrier.deriveEntry(entry, { ...inputs, deltaMs: stack.deltaMs }).pushTimeUtc;
      }
    }
    const r = carrier.applyStackOp(stack, op, opts);
    if (!r.ok) return r;
    if (r.unchanged) return { ok: true, record: deepClone(record), changed: [], unchanged: true, passed: [] };
    record.stacks[stackId] = r.stack;
    this._markChanges(record, derivedBefore);
    if (!quiet) this._touch(record, by, op.kind, op.kind === 'Delta' ? op.minutes : (op.flightDataId || null));
    else this._bump(record);
    return { ok: true, record: deepClone(record), changed: r.changed, ...(r.passed ? { passed: r.passed } : {}) };
  }

  // ── effects of carrier handoffs (called by board/ops/carrier-handoff.js through the rules) ────

  /**
   * A stack effect of a carrier handoff or a Strip's retirement, audited under
   * the Position that acted. `MARK_PUSHED` (Commence) never renumbers anyone and records when the flight left and the EAT it
   * worked to (docs/adr/0114); `RETURN_TO_STACK` (Back to stack) takes the next free slot at the top; `REMOVE_NO_CLOSE_UP`
   * leaves a vacancy (decisions H28).
   * @returns {{ok:boolean, reason?:string, detail?:string, changed?:Array}}
   */
  applyEffect(effect, flightDataId, { hullId = this.defaultHullId, by = null, actingPositionId = null, clientMutationId = null } = {}) {
    const record = this._records.get(hullId);
    if (!record) return { ok: false, reason: 'NOT_FOUND', detail: `unknown hull ${hullId}` };
    const op = effect === 'MARK_PUSHED' ? { kind: 'MarkPushed', flightDataId }
      : effect === 'RETURN_TO_STACK' ? { kind: 'BackToStack', flightDataId }
      : effect === 'REMOVE_NO_CLOSE_UP' ? { kind: 'Remove', flightDataId, closeUp: false }
      : null;
    if (!op) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown stack effect ${effect}` };
    const before = deepClone(record);
    const r = this._stackOp(record, op, by, false);
    this._audit({ clientMutationId, op: { kind: `Stack:${op.kind}` }, hullId }, actingPositionId, by, before, r);
    return r;
  }

  // ── undo compensators (docs/adr/0100 §3) ────────────────────────────────

  /** One flight's stack entry as it is now, for an undo's before-image, or null when it is in no stack. */
  entryImage(flightDataId) {
    for (const record of this._records.values()) {
      for (const [stackId, stack] of Object.entries(record.stacks)) {
        const e = stack.entries.find(x => x.flightDataId === flightDataId);
        if (e) return { hullId: record.hullId, stackId, entry: deepClone(e) };
      }
    }
    return null;
  }

  /**
   * What putting `image` back needs: nothing, `RestoreEntry` (Commence or Back to stack undone: the entry goes back as it was,
   * slot, status and the push time on record) or `Reinsert` at the vacated index (a PriFly removal or a retirement undone).
   * Either is refused when the slot it needs has been refilled since.
   * @returns {{ok:true, action:'NONE'|'RESTORE_ENTRY'|'REINSERT'}|{ok:false, reason:'UNDO_BLOCKED', detail:string}}
   */
  restoreCheck(flightDataId, image) {
    if (!image) return { ok: true, action: 'NONE' };
    const now = this.entryImage(flightDataId);
    const record = this._records.get(image.hullId);
    const stack = record && record.stacks[image.stackId];
    if (now) {
      const a = now.entry;
      const b = image.entry;
      if (a.status === b.status && a.stackIndex === b.stackIndex) return { ok: true, action: 'NONE' };
      const occupant = stack && stack.entries.find(e => e.stackIndex === b.stackIndex && e.flightDataId !== flightDataId);
      if (occupant) {
        return { ok: false, reason: 'UNDO_BLOCKED', detail: `Marshal stack slot ${b.stackIndex} has been refilled by ${occupant.flightDataId}` };
      }
      return { ok: true, action: 'RESTORE_ENTRY' };
    }
    if (!stack) return { ok: false, reason: 'UNDO_BLOCKED', detail: `the Marshal stack ${image.stackId} is gone` };
    const occupant = stack.entries.find(e => e.stackIndex === image.entry.stackIndex);
    if (occupant) {
      return { ok: false, reason: 'UNDO_BLOCKED', detail: `Marshal stack slot ${image.entry.stackIndex} has been refilled by ${occupant.flightDataId}` };
    }
    return { ok: true, action: 'REINSERT' };
  }

  /**
   * Applies what restoreCheck said (`RestoreEntry` / `Reinsert`), audited with `causedBy` = the Undo's id.
   * @returns {{ok:boolean, changed:string[]}}
   */
  restoreEntry(flightDataId, image, { causedBy = null, by = null } = {}) {
    const check = this.restoreCheck(flightDataId, image);
    if (!check.ok) return { ...check, changed: [] };
    if (check.action === 'NONE') return { ok: true, changed: [] };
    const record = this._records.get(image.hullId);
    const before = deepClone(record);
    const stack = record.stacks[image.stackId];
    let kind;
    if (check.action === 'RESTORE_ENTRY') {
      kind = 'RestoreEntry';
      stack.entries = [...stack.entries.filter(e => e.flightDataId !== flightDataId), deepClone(image.entry)].sort((a, b) => a.stackIndex - b.stackIndex);
    } else {
      kind = 'Reinsert';
      stack.entries = [...stack.entries, deepClone(image.entry)].sort((a, b) => a.stackIndex - b.stackIndex);
    }
    this._touch(record, by, kind, flightDataId);
    const result = { ok: true, record: deepClone(record), changed: [flightDataId] };
    this._audit({ clientMutationId: null, op: { kind: `Stack:${kind}` }, hullId: image.hullId }, null, by, before, result, { causedBy });
    return result;
  }

  /** A flight joins the stack at the next free slot (a recovery check-in). */
  appendFlight(flightDataId, { hullId = this.defaultHullId, by = null, actingPositionId = null, clientMutationId = null } = {}) {
    const record = this._records.get(hullId);
    if (!record) return { ok: false, reason: 'NOT_FOUND', detail: `unknown hull ${hullId}` };
    if (this.inStack(flightDataId, hullId)) return { ok: true, changed: [], already: true };
    const before = deepClone(record);
    const r = this._stackOp(record, { kind: 'Append', flightDataId }, by, false);
    this._audit({ clientMutationId, op: { kind: 'Stack:Append' }, hullId }, actingPositionId, by, before, r);
    return r;
  }

  /**
   * A flight is gone from the recovery (its last carrier Strip retired, or its
   * flight data did): its entry leaves WITHOUT closing up, so nobody is re-cleared
   * (H28, ADR 0064).
   * @returns {boolean} whether anything changed
   */
  onFlightDataRetired(flightDataId, by = null) {
    let changed = false;
    for (const record of this._records.values()) {
      for (const [stackId, stack] of Object.entries(record.stacks)) {
        if (!stack.entries.some(e => e.flightDataId === flightDataId)) continue;
        const r = carrier.remove(stack, { flightDataId, closeUp: false });
        if (r.ok) { record.stacks[stackId] = r.stack; this._touch(record, by, 'RetireFlight', flightDataId); changed = true; }
      }
    }
    return changed;
  }

  evictMissingFlightDataList() {
    let n = 0;
    for (const record of this._records.values()) {
      for (const stack of Object.values(record.stacks)) {
        for (const e of stack.entries.slice()) {
          if (!this._flightDataExists(e.flightDataId) && this.onFlightDataRetired(e.flightDataId, 'system')) n += 1;
        }
      }
    }
    return n;
  }

  /**
   * The mission reset (docs/adr/0108): each hull goes back to the start of a recovery (Case, empty stacks, no overrides).
   * The ship banner is derived from DCS, not stored, so it stays. One audit entry per hull that had anything to clear.
   * @returns {string[]} the hulls that changed
   */
  resetForMission(by = 'system') {
    const changed = [];
    for (const [hullId, record] of this._records) {
      const fresh = this._fresh(hullId);
      const slice = (r) => JSON.stringify([r.recoveryCase, r.stacks, r.overrides]);
      if (slice(record) === slice(fresh)) continue;
      const before = deepClone(record);
      record.recoveryCase = fresh.recoveryCase;
      record.stacks = fresh.stacks;
      record.overrides = fresh.overrides;
      this._touch(record, by, 'MissionReset', null);
      this._audit({ clientMutationId: null, hullId, op: { kind: 'MissionReset' } }, null, by, before, { ok: true, record });
      changed.push(hullId);
    }
    return changed;
  }

  // ── persistence (durable per docs/adr/0002; Case and stack are declarations) ──

  snapshot() { return [...this._records.values()].map(deepClone); }

  /** Normalises rather than refuses (a restart must come up); the banner is NOT restored, it is re-derived. */
  restore(data) {
    for (const saved of Array.isArray(data) ? data : []) {
      if (!saved || !this._records.has(saved.hullId)) continue; // a hull no longer configured is skipped
      const fresh = this._fresh(saved.hullId);
      const stacks = {};
      for (const [stackId, raw] of Object.entries(saved.stacks && typeof saved.stacks === 'object' ? saved.stacks : {})) {
        stacks[stackId] = carrier.normalizeStack(raw, { stackId, hullId: saved.hullId }).stack;
      }
      if (!stacks[carrier.DEFAULT_STACK_ID]) stacks[carrier.DEFAULT_STACK_ID] = fresh.stacks[carrier.DEFAULT_STACK_ID];
      this._records.set(saved.hullId, {
        hullId: saved.hullId,
        rev: Number.isInteger(saved.rev) ? saved.rev : 0,
        recoveryCase: carrier.normalizeRecoveryCase(saved.recoveryCase),
        stacks,
        overrides: carrier.normalizeOverrides(saved.overrides),
        transitions: Array.isArray(saved.transitions) ? saved.transitions.slice(-TRANSITIONS_CAP) : [],
      });
    }
  }
}

module.exports = { CarrierStore };
