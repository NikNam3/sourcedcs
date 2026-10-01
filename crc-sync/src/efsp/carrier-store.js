'use strict';

// The CarrierStore (docs/adr/0064 B6, docs/adr/0074): a SIXTH store, peer to
// FdrStore, BoardStore, AirspaceStore, CorrelationStore, MarsaStore and
// FieldStateStore, keyed by `hullId`.
//
// The Case and the Marshal stack are facts about the SHIP's recovery, spanning
// many flights, so they live neither on the Board nor on an FDR, for the reason
// airspace (ADR 0034) and MARSA (ADR 0051) do not. One record per hull:
//
//   { hullId, rev, recoveryCase, stacks: { [stackId]: MarshalStack }, shipInputs, transitions[] }
//
// v1 has one hull and one `MAIN` stack (decisions H29), so a second stack or
// hull is additive. Entries are keyed by fdrId, never by Strip or track id.
//
// WHAT IS STORED AND WHAT IS NOT. The stored record holds only authoritative
// values (the Case, the stack index of each flight, the Charlie time, the
// marshal radial, the altimeter a controller set). Angels, DME, push time and
// the ship banner are DERIVED, every time a view is built, and are never
// written anywhere (§9.12 rule 1, D16): marshal-stack.js refuses an entry that
// carries one, and this store never builds one. The ship state is held in
// memory only (`setShipState`), published by a server tick, and re-derived after
// a restart.
//
// Built on marsa-store.js: own record map, per-record rev with STALE_REV, a
// monotonic `_seq`, an audit line for every op INCLUDING refusals, a never-
// throwing `apply`, and snapshot/restore that normalise rather than refuse (a
// restart must come up). Every time comes from the injected mission clock
// (decisions H11); nothing here reads Date.now().
//
// Authority is the caller's two-way check: efsp-ws.js verifies the session is
// Primary at the acting Position (docs/adr/0029), and this store asks
// permission.js's one-parameter predicates which Position may do what (D21).

const permission = require('./permission');
const carrier = require('./carrier');
const { resolveZuluHhmm } = require('./zulu-time');
const { WALL_CLOCK } = require('../mission-clock');

const TRANSITIONS_CAP = 200;
const SHIP_OP = 'SetShipInput';
const CASE_OP = 'SetCase';

function deepClone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

class CarrierStore {
  /**
   * @param {object} deps
   * @param {object[]} deps.hulls hull configs (carrier/hull-config.js)
   * @param {(fdrId:string)=>boolean} [deps.fdrExists]
   * @param {(positionId:string)=>boolean} [deps.isOccupied] CARRIER Position occupancy, for lane feeding
   * @param {{now:()=>number}} [deps.clock] the mission clock
   */
  constructor({ hulls, fdrExists, isOccupied, clock = WALL_CLOCK } = {}) {
    this._clock = clock;
    this._fdrExists = fdrExists || (() => true);
    this._isOccupied = isOccupied || (() => false);
    this._hulls = (hulls && hulls.length ? hulls : [carrier.DEFAULT_HULL]).map(deepClone);
    this._records = new Map();
    for (const h of this._hulls) this._records.set(h.hullId, this._fresh(h.hullId));
    this._shipStates = new Map(); // hullId -> banner (derived, never persisted)
    this._seq = 0;
    this._mutationLog = null;
  }

  _fresh(hullId) {
    return {
      hullId, rev: 0,
      recoveryCase: carrier.initialRecoveryCase(),
      stacks: { [carrier.DEFAULT_STACK_ID]: carrier.emptyStack({ stackId: carrier.DEFAULT_STACK_ID, hullId }) },
      shipInputs: carrier.defaultShipInputs(),
      transitions: [],
    };
  }

  setMutationLog(mutationLog) { this._mutationLog = mutationLog; }
  get currentSeq() { return this._seq; }
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
  inStack(fdrId, hullId = this.defaultHullId) {
    const r = this._records.get(hullId);
    return !!r && Object.values(r.stacks).some(s => s.entries.some(e => e.fdrId === fdrId));
  }

  /**
   * The manned CV_APP lane the stack would feed this flight to, or null
   * (carrier/transfers.js: alternating by push ordinal, the other lane when the
   * preferred one is unmanned, none when neither is).
   */
  laneFor(fdrId, hullId = this.defaultHullId) {
    const r = this._records.get(hullId);
    if (!r) return null;
    for (const stack of Object.values(r.stacks)) {
      const derived = carrier.deriveStack(stack, { caseValue: r.recoveryCase.value, shipState: null });
      const lane = carrier.assignLanes(derived, { isOccupied: this._isOccupied }).find(l => l.fdrId === fdrId);
      if (lane) return lane.lane;
    }
    return null;
  }

  /**
   * The wire view of one hull: the record, the banner, and the DERIVED stack,
   * so crc-desktop never reimplements the arithmetic (ADR 0064 B6: one
   * implementation beats a client copy under a parity test).
   */
  view(hullId = this.defaultHullId) {
    const r = this._records.get(hullId);
    if (!r) return null;
    const shipState = this._shipStates.get(hullId) || null;
    const caseValue = r.recoveryCase.value;
    const derived = {};
    const consistency = {};
    for (const [stackId, stack] of Object.entries(r.stacks)) {
      // One implementation of every bearing's magnetic display (H15): the
      // client draws `display`, it never converts.
      const ref = shipState && shipState.headingRef === 'GRID' ? 'GRID' : 'TRUE';
      const mv = shipState && Number.isFinite(shipState.magneticVariationDeg) ? shipState.magneticVariationDeg : null;
      derived[stackId] = carrier.deriveStack(stack, { caseValue, shipState }).map(e => ({
        ...e,
        marshalRadialDisplay: carrier.displayBearing(e.marshalRadialDeg, { ref, magneticVariationDeg: mv }),
        expectedFinalBearingDisplay: carrier.displayBearing(e.expectedFinalBearingDeg, { ref, magneticVariationDeg: mv }),
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
        const d = carrier.deriveEntry({ fdrId: null, stackIndex: i, status: 'HOLDING', caseIAngels: null }, {
          caseValue, charlieTimeUtc: stack.charlieTimeUtc, marshalRadialDeg: stack.marshalRadialDeg, shipState });
        slots[stackId].push({ stackIndex: i, angels: d.angels, marshalDme: d.marshalDme, pushTimeUtc: d.pushTimeUtc });
      }
    }
    const lanes = {};
    for (const [stackId, stack] of Object.entries(r.stacks)) {
      const d = carrier.deriveStack(stack, { caseValue, shipState });
      lanes[stackId] = carrier.assignLanes(d, { isOccupied: this._isOccupied });
    }
    let banner = deepClone(shipState);
    if (banner) {
      const ref = banner.headingRef === 'GRID' ? 'GRID' : 'TRUE';
      const mv = Number.isFinite(banner.magneticVariationDeg) ? banner.magneticVariationDeg : null;
      banner.brcDisplay = carrier.displayBearing(banner.brcDeg, { ref, magneticVariationDeg: mv });
      banner.finalBearingDisplay = carrier.displayBearing(banner.finalBearingDeg, { ref, magneticVariationDeg: mv });
    }
    return {
      ...deepClone(r),
      shipState: banner,
      derived, slots, lanes, consistency,
      advisory: this._advisory(hullId),
      hull: this.hull(hullId),
    };
  }

  getAll() { return this.hullIds().map(id => this.view(id)); }

  _advisory(hullId) {
    const wx = this._wx && this._wx(hullId);
    if (!wx) return null;
    return carrier.caseAdvisory(this.caseValue(hullId), wx);
  }

  /** server.js injects the weather the advisory reads: `(hullId) => { ceilingFt, visibilityNm, night }` or null. */
  setWeatherSource(fn) { this._wx = typeof fn === 'function' ? fn : null; }

  // ── the banner (derived, published by a tick) ───────────────────────────

  /**
   * Sets the banner for a hull; true when it changed enough to broadcast
   * (carrier.shipStateChanged: a whole degree of BRC, speed, altimeter, or a
   * stale/found flip). Not audited per tick, and not persisted.
   */
  setShipState(hullId, next) {
    const prev = this._shipStates.get(hullId) || null;
    if (prev && !carrier.shipStateChanged(prev, next)) return false;
    this._shipStates.set(hullId, next);
    this._seq += 1;
    return true;
  }
  getShipState(hullId = this.defaultHullId) { return deepClone(this._shipStates.get(hullId) || null); }
  shipInputs(hullId = this.defaultHullId) { const r = this._records.get(hullId); return r ? deepClone(r.shipInputs) : null; }

  // ── audit ───────────────────────────────────────────────────────────────

  _audit(mutation, actingPositionId, by, before, result, extra = {}) {
    if (!this._mutationLog) return;
    const op = mutation.op || {};
    this._mutationLog.record({
      clientMutationId: mutation.clientMutationId,
      op: op.kind,
      // Its own id field: a carrier op targets a ship's recovery, which no
      // single stripId/fdrId/marsaId names (marsa-store.js's reasoning).
      carrierHullId: mutation.hullId || this.defaultHullId,
      actingPositionId,
      actorId: by || null,
      at: this._clock.now(),
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      detail: result.ok ? undefined : result.detail,
      before,
      after: result.ok && result.record ? deepClone(result.record) : undefined,
      ...extra,
    });
  }

  _touch(record, by, op, detail) {
    record.rev += 1;
    this._seq += 1;
    record.transitions.push({ at: this._clock.now(), by: by || null, op, detail: detail == null ? null : String(detail).slice(0, 200) });
    if (record.transitions.length > TRANSITIONS_CAP) record.transitions.splice(0, record.transitions.length - TRANSITIONS_CAP);
  }

  // ── controller ops ──────────────────────────────────────────────────────

  /**
   * The one entry point for a controller-driven carrier op (SetCase, a stack
   * op, SetShipInput). Never throws. `changed` on a stack op is the fdrIds
   * whose derived display moved, in stack order, for the one delta.
   *
   * @param {{clientMutationId:string, hullId?:string, baseRev?:number, op:object}} mutation
   * @param {string} actingPositionId already verified by efsp-ws.js to be Primary for the session
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
    let result;
    try {
      result = this._dispatch(record, op, actingPositionId, by);
    } catch (err) {
      console.error('[carrier-store] unexpected error applying a carrier op — rejecting it instead of crashing:', err);
      result = { ok: false, reason: 'VALIDATION_ERROR', detail: 'internal error processing carrier op' };
    }
    if (!result.record) result.record = deepClone(record);
    this._audit(mutation, actingPositionId, by, before, result);
    return result;
  }

  _dispatch(record, op, actingPositionId, by) {
    if (op.kind === CASE_OP) {
      if (!permission.canSetRecoveryCase(actingPositionId)) {
        return { ok: false, reason: 'PERMISSION_DENIED', detail: `${actingPositionId} does not set the recovery Case — PriFly owns it (guide §4.1)` };
      }
      // PriFly's call is never refused on the weather (D11): the advisory only advises.
      const r = carrier.setCase(record.recoveryCase, op.to, { by, at: this._clock.now(), note: op.note });
      if (!r.ok) return r;
      record.recoveryCase = r.case;
      this._touch(record, by, CASE_OP, `${r.case.history[r.case.history.length - 1].from} -> ${r.case.value}`);
      // One record changes, and every client re-renders every carrier Strip from it.
      return { ok: true, record: deepClone(record), changed: 'ALL' };
    }
    if (op.kind === SHIP_OP) {
      if (!permission.canEditShipStateInput(actingPositionId)) {
        return { ok: false, reason: 'PERMISSION_DENIED', detail: `${actingPositionId} may not enter the altimeter` };
      }
      const r = carrier.applyShipStateInput(record.shipInputs, op.input);
      if (!r.ok) return r;
      record.shipInputs = r.inputs;
      this._touch(record, by, SHIP_OP, JSON.stringify(op.input));
      return { ok: true, record: deepClone(record), changed: [], shipInputsChanged: true };
    }
    if (carrier.STACK_OP_KINDS.includes(op.kind)) {
      if (!permission.canSequenceMarshalStack(actingPositionId)) {
        return { ok: false, reason: 'PERMISSION_DENIED', detail: `${actingPositionId} does not sequence the Marshal stack` };
      }
      const prepared = this._prepare(record, op);
      if (!prepared.ok) return prepared;
      return this._stackOp(record, prepared.op, by, false);
    }
    // SetAngels, SetDme and anything else: say why (WP7A bullet 2, D16).
    const r = carrier.applyStackOp(this._stackOf(record, op.stackId), op);
    return r.ok ? { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown carrier op '${op.kind}'` } : r;
  }

  /**
   * A controller types what a controller reads: a Charlie time as Zulu HHMM and
   * a marshal radial MAGNETIC (decisions H15). Both are converted here, on the
   * server, once (the client never converts a typed magnetic value), and the
   * model only ever holds epoch ms and a TRUE bearing.
   */
  _prepare(record, op) {
    if (op.kind === 'SetCharlieTime' && typeof op.hhmm === 'string') {
      const at = resolveZuluHhmm(op.hhmm, this._clock.now());
      if (at == null) return { ok: false, reason: 'VALIDATION_ERROR', detail: `Charlie time must be a Zulu time, HHMM (not ${JSON.stringify(op.hhmm)})` };
      return { ok: true, op: { ...op, charlieTimeUtc: at } };
    }
    if (op.kind === 'SetMarshalRadial' && op.marshalRadialMagDeg !== undefined) {
      const ship = this._shipStates.get(record.hullId);
      const variation = ship && Number.isFinite(ship.magneticVariationDeg) ? ship.magneticVariationDeg : null;
      if (op.marshalRadialMagDeg === null) return { ok: true, op: { ...op, marshalRadialDeg: null } };
      if (variation == null) return { ok: false, reason: 'VALIDATION_ERROR', detail: 'the magnetic variation at the ship is not known, so a magnetic radial cannot be converted' };
      const mag = Number(op.marshalRadialMagDeg);
      if (!Number.isFinite(mag)) return { ok: false, reason: 'VALIDATION_ERROR', detail: 'the marshal radial must be a magnetic bearing, 0 to 360' };
      return { ok: true, op: { ...op, marshalRadialDeg: carrier.normDeg(mag + variation) } };
    }
    return { ok: true, op };
  }

  _stackOf(record, stackId) {
    return record.stacks[stackId || carrier.DEFAULT_STACK_ID] || record.stacks[carrier.DEFAULT_STACK_ID];
  }

  _stackOp(record, op, by, quiet) {
    const stackId = op.stackId || carrier.DEFAULT_STACK_ID;
    const stack = record.stacks[stackId];
    if (!stack) return { ok: false, reason: 'NOT_FOUND', detail: `unknown stack ${stackId}` };
    if ((op.kind === 'InsertAt' || op.kind === 'Append') && !this._fdrExists(op.fdrId)) {
      return { ok: false, reason: 'NOT_FOUND', detail: `unknown FDR ${op.fdrId}` };
    }
    const r = carrier.applyStackOp(stack, op);
    if (!r.ok) return r;
    record.stacks[stackId] = r.stack;
    if (!quiet) this._touch(record, by, op.kind, op.fdrId || null);
    else { record.rev += 1; this._seq += 1; }
    return { ok: true, record: deepClone(record), changed: r.changed };
  }

  // ── effects of Strip transfers (called by board-store through rules) ────

  /**
   * A stack effect of a carrier transfer or a Strip's retirement, audited under
   * the Position that acted. `MARK_PUSHED` (Commence) never renumbers anyone;
   * `REMOVE_NO_CLOSE_UP` leaves a vacancy (decisions H28).
   * @returns {{ok:boolean, reason?:string, detail?:string, changed?:Array}}
   */
  applyEffect(effect, fdrId, { hullId = this.defaultHullId, by = null, actingPositionId = null, clientMutationId = null } = {}) {
    const record = this._records.get(hullId);
    if (!record) return { ok: false, reason: 'NOT_FOUND', detail: `unknown hull ${hullId}` };
    const op = effect === 'MARK_PUSHED' ? { kind: 'MarkPushed', fdrId }
      : effect === 'REMOVE_NO_CLOSE_UP' ? { kind: 'Remove', fdrId, closeUp: false }
      : null;
    if (!op) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown stack effect ${effect}` };
    const before = deepClone(record);
    const r = this._stackOp(record, op, by, false);
    this._audit({ clientMutationId, op: { kind: `Stack:${op.kind}` }, hullId }, actingPositionId, by, before, r);
    return r;
  }

  /** A flight joins the stack at the next free slot (a recovery check-in). */
  appendFlight(fdrId, { hullId = this.defaultHullId, by = null, actingPositionId = null, clientMutationId = null } = {}) {
    const record = this._records.get(hullId);
    if (!record) return { ok: false, reason: 'NOT_FOUND', detail: `unknown hull ${hullId}` };
    if (this.inStack(fdrId, hullId)) return { ok: true, changed: [], already: true };
    const before = deepClone(record);
    const r = this._stackOp(record, { kind: 'Append', fdrId }, by, false);
    this._audit({ clientMutationId, op: { kind: 'Stack:Append' }, hullId }, actingPositionId, by, before, r);
    return r;
  }

  /**
   * A flight is gone from the recovery (its last carrier Strip retired, or its
   * FDR did): its entry leaves WITHOUT closing up, so nobody is re-cleared
   * (H28, ADR 0064).
   * @returns {boolean} whether anything changed
   */
  onFdrRetired(fdrId, by = null) {
    let changed = false;
    for (const record of this._records.values()) {
      for (const [stackId, stack] of Object.entries(record.stacks)) {
        if (!stack.entries.some(e => e.fdrId === fdrId)) continue;
        const r = carrier.remove(stack, { fdrId, closeUp: false });
        if (r.ok) { record.stacks[stackId] = r.stack; this._touch(record, by, 'RetireFlight', fdrId); changed = true; }
      }
    }
    return changed;
  }

  evictMissingFdrs() {
    let n = 0;
    for (const record of this._records.values()) {
      for (const stack of Object.values(record.stacks)) {
        for (const e of stack.entries.slice()) {
          if (!this._fdrExists(e.fdrId) && this.onFdrRetired(e.fdrId, 'system')) n += 1;
        }
      }
    }
    return n;
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
        shipInputs: carrier.normalizeShipInputs(saved.shipInputs),
        transitions: Array.isArray(saved.transitions) ? saved.transitions.slice(-TRANSITIONS_CAP) : [],
      });
    }
  }
}

module.exports = { CarrierStore };
