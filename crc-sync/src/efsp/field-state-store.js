'use strict';

// Field state (EFSPImplementationGuide.md §9.7) — the STATEFUL half, and the
// sixth EFSP store (docs/adr/0061).
//
// A peer of the Strip model, not a subsidiary of it (§9.1: "the field-state
// model is a peer of the Strip model"). ONE instance for the whole server
// holding one record per Facility that has a runway inventory (today only
// INCIRLIK), for the reason AirspaceStore is single-instance: nothing about a
// runway is ever handed across a Facility boundary, so there is no D13
// replica question and one home per record is enough. `rev` is per Facility
// record, so two controllers reconfiguring the field at once collide on
// STALE_REV, which is correct rather than costly.
//
// Config vs state (decisions.md P5, docs/adr/0048): WHICH runways, ends and
// gear exist is the Facility's `fieldState` inventory, read ONCE here at
// construction and never written back. Everything that changes at runtime —
// status, suspension, closure, inspection, the active end, a runway change,
// a request to tower — lives only in this store and the Board snapshot. This
// store never calls setFacilityConfig and never writes a config file.
//
// The pure rules (status machine, runway resolution, inhibit wording, the
// into-wind end) are field-state.js's; this file applies them to records.
//
// Rule 5's deliberate deviation: field state rides its OWN sequence
// (`currentSeq`, sent as `fieldStateSeq`) and its own efsp-field-state-delta,
// not the Board sequence the guide names — see docs/adr/0061 for why each
// literal reading of "broadcast on the Board sequence" breaks.

const crypto = require('crypto');
const { WALL_CLOCK } = require('../mission-clock');
const permission = require('./permission');
const {
  canGo, buildStatusView, activeEndIntoWind, isRunwayChangeInProgress, isRunwayChangeOpen,
  REQUEST_ACTIONS,
} = require('./field-state');

function deepClone(obj) { return obj === undefined ? undefined : JSON.parse(JSON.stringify(obj)); }

// What each request action needs the runway to be at, and the TWR op an
// accepted request is carried out as — so an accepted request goes through
// the very same checks as tower doing it directly.
const REQUEST_EFFECTS = {
  CLOSE:          { from: 'OPEN',   op: 'CloseRunway' },
  OPEN:           { from: 'CLOSED', op: 'OpenRunway' },
  BARRIER_CHANGE: { from: 'OPEN',   op: 'BeginBarrierChange' },
};

// The system actor for changes no controller made (the active end derived
// from the mission wind). Audited under this id, never a Position.
const SYSTEM_ACTOR = 'crc-sync';

class FieldStateStore {
  /**
   * @param {object} facilityConfig — facility-config.js (injected, the
   *   AirspaceStore precedent, so a test can pass a fixture exposing
   *   getFacilityIds() and getFacilityConfig(id))
   * @param {object} [deps]
   * @param {{now:()=>number}} [deps.clock] the mission clock (docs/adr/0079)
   * @param {(facilityId:string, positionId:string)=>boolean} [deps.isOccupied]
   *   is somebody Primary at that Position — to resolve who acknowledges a
   *   runway change (an unmanned acknowledger reverts or is skipped)
   * @param {(facilityId:string, positionId:string)=>string|null} [deps.primaryOf]
   *   the controllerId Primary at that Position — for SelfCoordinateRunwayChange
   */
  constructor(facilityConfig, { clock = WALL_CLOCK, isOccupied, primaryOf } = {}) {
    this._clock = clock;
    this._isOccupied = isOccupied || (() => false);
    this._primaryOf = primaryOf || (() => null);
    this._inventories = new Map(); // facilityId -> fieldState inventory (config, read once)
    this._positions = new Map();   // facilityId -> its Position set, for resolving acknowledgers
    this._records = new Map();     // facilityId -> record
    this._views = new Map();       // facilityId -> cached status view for rule 1
    this._seq = 0;
    this._mutationLog = null;
    for (const facilityId of facilityConfig.getFacilityIds()) {
      const config = facilityConfig.getFacilityConfig(facilityId);
      if (!config || !config.fieldState) continue; // no inventory, no record
      this._inventories.set(facilityId, deepClone(config.fieldState));
      this._positions.set(facilityId, [...(config.positions || [])]);
      this._records.set(facilityId, this._seed(facilityId));
    }
  }

  _seed(facilityId) {
    const inventory = this._inventories.get(facilityId);
    return {
      facilityId,
      rev: 0,
      // Unset until the mission wind picks one (decisions.md H22) — never a
      // config default, and a restored value outranks a fresh derivation.
      activeRunway: null,
      activeRunwaySource: null,
      runways: inventory.runways.map(def => this._seedRunway(def)),
      runwayChange: null,
      // §12: a deferral leaves its fields present. L12 (hot cargo) and L13
      // (alert pad) give these meaning; no op here touches them.
      hotCargoPad: { occupied: false, occupantFdrId: null },
      alertPad: { occupied: false, occupantFdrId: null },
      transitions: [],
      updatedAt: null,
      updatedBy: null,
    };
  }

  _seedRunway(def) {
    return {
      runwayId: def.runwayId,
      status: 'OPEN',
      suspension: null,     // { kind, since, by, positionId, note, requestedBy? } while SUSPENDED_*
      closure: null,        // { since, by, positionId, reason, requestedBy? } while CLOSED
      lastInspection: null, // { at, by, positionId, note } — rule 2's attribution; survives reopening
      pendingRequest: null, // { requestId, action, requestedBy, requestedPositionId, requestedAt, note }
    };
  }

  /** The same wiring every EFSP store has; refusals are logged too (see _recordAudit). */
  setMutationLog(mutationLog) { this._mutationLog = mutationLog; }

  get currentSeq() { return this._seq; }

  hasFieldState(facilityId) { return this._records.has(facilityId); }

  // ── reads ──────────────────────────────────────────────────────────────

  /**
   * One Facility's field state as the wire carries it: stored state merged
   * with the inventory, so each runway row is self-describing (the ends, the
   * racks, the gear), plus the guide's derived `runwayChangeInProgress`.
   * Cloned — a caller can never mutate the store through it. Null for a
   * Facility with no inventory.
   */
  getFieldState(facilityId) {
    const record = this._records.get(facilityId);
    if (!record) return null;
    const inventory = this._inventories.get(facilityId);
    const out = deepClone(record);
    out.runways = out.runways.map(r => {
      const def = inventory.runways.find(d => d.runwayId === r.runwayId) || {};
      return {
        runwayId: r.runwayId,
        ends: deepClone(def.ends || []),
        endHeadingsTrue: deepClone(def.endHeadingsTrue || {}),
        rackIds: deepClone(def.rackIds || {}),
        status: r.status,
        // Data only (decisions.md H17): the gear as configured, no op changes it.
        arrestingGear: deepClone(def.arrestingGear || []),
        suspension: r.suspension,
        closure: r.closure,
        lastInspection: r.lastInspection,
        pendingRequest: r.pendingRequest,
      };
    });
    const pads = inventory.pads || {};
    out.hotCargoPad = { ...(pads.hotCargo || {}), ...out.hotCargoPad };
    out.alertPad = { ...(pads.alert || {}), ...out.alertPad };
    out.runwayChangeInProgress = isRunwayChangeInProgress(record.runwayChange);
    return out;
  }

  /** Every Facility's field state — what the snapshot carries. */
  getAll() { return [...this._records.keys()].map(id => this.getFieldState(id)); }

  /**
   * Rule 1's read path (nla.js through ctx.fieldStateFor): a frozen, minimal
   * view, cached per Facility and rebuilt only when that record changes —
   * nlaStatusFor runs for every Strip on every stamp, so it must not clone the
   * record each time. Null for a Facility with no inventory, which fails open.
   */
  statusView(facilityId) {
    if (!this._records.has(facilityId)) return null;
    let view = this._views.get(facilityId);
    if (!view) {
      view = buildStatusView(this._inventories.get(facilityId), this._records.get(facilityId));
      this._views.set(facilityId, view);
    }
    return view;
  }

  // ── the audit trail ────────────────────────────────────────────────────

  _recordAudit(mutation, actingPositionId, by, before, result) {
    if (!this._mutationLog) return;
    const op = mutation.op || {};
    this._mutationLog.record({
      clientMutationId: mutation.clientMutationId,
      op: op.kind,
      // Its own id field: Mutation-log readers key on whichever id is present
      // (stripId / airspaceId / fdrId / marsaId), and a field-state op is about
      // a Facility's field, not any of those.
      fieldStateFacilityId: mutation.facilityId,
      runwayId: op.runwayId ?? null,
      actingPositionId: actingPositionId ?? null,
      actorId: by || null,
      at: this._clock.now(),
      ok: result.ok,
      // Refusals are the interesting half of an authority model — a refused
      // BeginRunwayChange above all — so they are logged, STALE_REV included.
      reason: result.ok ? undefined : result.reason,
      detail: result.ok ? undefined : result.detail,
      before,
      after: result.ok ? deepClone(this._records.get(mutation.facilityId)) : undefined,
    });
  }

  _touch(record, by, transition) {
    record.rev += 1;
    record.updatedAt = this._clock.now();
    record.updatedBy = by || null;
    this._seq += 1;
    this._views.delete(record.facilityId);
    if (transition) record.transitions.push({ ...transition, at: record.updatedAt, by: by || null });
  }

  // ── the one entry point ────────────────────────────────────────────────

  /**
   * Every field-state op. Never throws; every result carries the current
   * record as `fieldState`, success or refusal; every outcome is audited.
   * One op is one rev, one seq and one audit entry, however many runways it
   * touches.
   *
   * @param {{clientMutationId?:string, facilityId:string, baseRev?:number, op:{kind:string}}} mutation
   * @param {string} actingPositionId — verified by efsp-ws.js to be a Position
   *   the session is Primary at, at this Facility (docs/adr/0029)
   * @param {string} by — controllerId
   */
  apply(mutation, actingPositionId, by) {
    let result;
    let before = null;
    try {
      mutation = mutation && typeof mutation === 'object' ? mutation : {};
      const op = mutation.op && typeof mutation.op === 'object' ? mutation.op : {};
      const record = this._records.get(mutation.facilityId);
      if (!record) {
        result = { ok: false, reason: 'NOT_FOUND', detail: `no field state at ${mutation.facilityId}` };
      } else if (mutation.baseRev !== undefined && mutation.baseRev !== null && record.rev !== mutation.baseRev) {
        // Audited, like correlation-store.js and unlike airspace-store.js,
        // which returns here without a trace.
        before = deepClone(record);
        result = { ok: false, reason: 'STALE_REV', detail: `field state is at rev ${record.rev}, not ${mutation.baseRev}` };
      } else if (!permission.canActOnFieldState(actingPositionId, op.kind)) {
        before = deepClone(record);
        result = Object.prototype.hasOwnProperty.call(permission.FIELD_STATE_OP_OWNERS, op.kind)
          ? { ok: false, reason: 'PERMISSION_DENIED', detail: `${op.kind} is not ${actingPositionId}'s` }
          : { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown field-state op: ${op.kind}` };
      } else {
        before = deepClone(record);
        result = this._dispatch(record, op, actingPositionId, by);
      }
    } catch (err) {
      // The backstop every EFSP store has: one bad op must never take the
      // process down for every connected client.
      console.error('[field-state-store] unexpected error applying a field-state op — rejecting it instead of crashing:', err);
      result = { ok: false, reason: 'VALIDATION_ERROR', detail: 'internal error processing field-state op' };
    }
    result.fieldState = this.getFieldState(mutation && mutation.facilityId);
    this._recordAudit(mutation || {}, actingPositionId, by, before, result);
    return result;
  }

  _dispatch(record, op, actingPositionId, by) {
    const ctx = { record, op, actingPositionId, by, inventory: this._inventories.get(record.facilityId) };
    switch (op.kind) {
      case 'CloseRunway':           return this._close(ctx);
      case 'OpenRunway':            return this._open(ctx);
      case 'BeginBarrierChange':    return this._beginBarrierChange(ctx);
      case 'CompleteBarrierChange': return this._completeBarrierChange(ctx);
      case 'CompleteInspection':    return this._completeInspection(ctx);
      case 'RequestRunwayStatus':   return this._request(ctx);
      case 'AcceptRunwayRequest':   return this._acceptRequest(ctx);
      case 'RejectRunwayRequest':   return this._rejectRequest(ctx);
      case 'ProposeRunwayChange':        return this._proposeChange(ctx, { selfCoordinate: false });
      case 'SelfCoordinateRunwayChange': return this._proposeChange(ctx, { selfCoordinate: true });
      case 'AckRunwayChange':            return this._ackChange(ctx);
      case 'RejectRunwayChange':         return this._endChange(ctx, 'REJECTED');
      case 'WithdrawRunwayChange':       return this._endChange(ctx, 'WITHDRAWN');
      case 'BeginRunwayChange':          return this._beginChange(ctx);
      case 'CompleteRunwayChange':       return this._completeChange(ctx);
      default:
        return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown field-state op: ${op.kind}` };
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────

  _runway(record, runwayId) {
    return record.runways.find(r => r.runwayId === runwayId) || null;
  }

  _needRunway(ctx) {
    const runway = this._runway(ctx.record, ctx.op.runwayId);
    if (!runway) return { refusal: { ok: false, reason: 'NOT_FOUND', detail: `no runway ${ctx.op.runwayId} at ${ctx.record.facilityId}` } };
    return { runway };
  }

  _illegal(runway, to) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `runway ${runway.runwayId} is ${runway.status} and cannot go to ${to}` };
  }

  _note(text) { return typeof text === 'string' && text.trim() ? text.trim() : null; }

  /**
   * Moves a runway to `to` and records it. A pending request that the new
   * status has made moot (asking to close a runway that is now suspended, say)
   * is settled in the same transition rather than left dangling.
   */
  _setStatus(ctx, runway, to, extra = {}) {
    const from = runway.status;
    runway.status = to;
    const transition = { op: ctx.op.kind, runwayId: runway.runwayId, from, to, positionId: ctx.actingPositionId, ...extra };
    if (runway.pendingRequest && REQUEST_EFFECTS[runway.pendingRequest.action].from !== to) {
      transition.settledRequest = runway.pendingRequest;
      runway.pendingRequest = null;
    }
    return transition;
  }

  // ── rules 1–2: close, open, the barrier change and the inspection ──────

  _close(ctx, requestedBy = null) {
    const { runway, refusal } = this._needRunway(ctx);
    if (refusal) return refusal;
    if (runway.status !== 'OPEN' || !canGo(runway.status, 'CLOSED')) return this._illegal(runway, 'CLOSED');
    const since = this._clock.now();
    runway.closure = { since, by: ctx.by || null, positionId: ctx.actingPositionId, reason: this._note(ctx.op.reason), requestedBy };
    this._touch(ctx.record, ctx.by, this._setStatus(ctx, runway, 'CLOSED', requestedBy ? { requestedBy } : {}));
    return { ok: true };
  }

  _open(ctx, requestedBy = null) {
    const { runway, refusal } = this._needRunway(ctx);
    if (refusal) return refusal;
    // OPEN is reachable only from CLOSED here: a suspended runway reopens
    // through the inspection and nothing else (rule 2).
    if (runway.status !== 'CLOSED') {
      const detail = runway.status.startsWith('SUSPENDED')
        ? `runway ${runway.runwayId} is ${runway.status} — it reopens only through an inspection`
        : `runway ${runway.runwayId} is already ${runway.status}`;
      return { ok: false, reason: 'VALIDATION_ERROR', detail };
    }
    runway.closure = null;
    this._touch(ctx.record, ctx.by, this._setStatus(ctx, runway, 'OPEN', requestedBy ? { requestedBy } : {}));
    return { ok: true };
  }

  _beginBarrierChange(ctx, requestedBy = null) {
    const { runway, refusal } = this._needRunway(ctx);
    if (refusal) return refusal;
    if (!canGo(runway.status, 'SUSPENDED_BARRIER_CHANGE')) return this._illegal(runway, 'SUSPENDED_BARRIER_CHANGE');
    runway.suspension = {
      kind: 'BARRIER_CHANGE', since: this._clock.now(), by: ctx.by || null, positionId: ctx.actingPositionId,
      note: this._note(ctx.op.note), requestedBy,
    };
    this._touch(ctx.record, ctx.by, this._setStatus(ctx, runway, 'SUSPENDED_BARRIER_CHANGE', requestedBy ? { requestedBy } : {}));
    return { ok: true };
  }

  _completeBarrierChange(ctx) {
    const { runway, refusal } = this._needRunway(ctx);
    if (refusal) return refusal;
    if (runway.status !== 'SUSPENDED_BARRIER_CHANGE') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `runway ${runway.runwayId} is ${runway.status}, not in a barrier change` };
    }
    // Still suspended, now awaiting the inspection; the suspension (and why)
    // is kept, so the inhibit keeps naming the runway until OPS signs it off.
    this._touch(ctx.record, ctx.by, this._setStatus(ctx, runway, 'SUSPENDED_INSPECTION'));
    return { ok: true };
  }

  _completeInspection(ctx) {
    const authority = ctx.inventory.inspectionAuthorityPositionId;
    if (authority && ctx.actingPositionId !== authority) {
      return { ok: false, reason: 'PERMISSION_DENIED', detail: `only ${authority} may sign off a runway inspection here` };
    }
    const { runway, refusal } = this._needRunway(ctx);
    if (refusal) return refusal;
    if (runway.status !== 'SUSPENDED_INSPECTION') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `runway ${runway.runwayId} is ${runway.status}, not awaiting an inspection` };
    }
    const at = this._clock.now();
    // Rule 2's attribution: who signed it off, at which Position, and when.
    runway.lastInspection = { at, by: ctx.by || null, positionId: ctx.actingPositionId, note: this._note(ctx.op.note) };
    const suspension = runway.suspension;
    runway.suspension = null;
    const transition = this._setStatus(ctx, runway, 'OPEN', { suspension });
    this._drainPendingInspection(ctx.record, runway.runwayId, transition);
    this._touch(ctx.record, ctx.by, transition);
    return { ok: true };
  }

  /**
   * Where rules 1–2 and rule 3 meet, and the only place: an inspection that
   * signs off a runway a completed runway change was waiting on. When the last
   * one is inspected the change is over — appended to the history in this
   * same transition, and cleared.
   */
  _drainPendingInspection(record, runwayId, transition) {
    const change = record.runwayChange;
    if (!change || change.state !== 'PENDING_INSPECTION') return;
    if (!change.pendingInspection.includes(runwayId)) return;
    change.pendingInspection = change.pendingInspection.filter(id => id !== runwayId);
    if (change.pendingInspection.length === 0) {
      transition.runwayChangeCompleted = deepClone(change);
      record.runwayChange = null;
    }
  }

  // ── rule 3: the runway change ──────────────────────────────────────────
  //
  // Its own machine on the field-state record. board-store.js's coordination
  // primitives cannot carry it: they are attached to a Strip, cross-Facility
  // by construction (TWR, OPS and APP are all INCIRLIK), and one proposer /
  // one responder with no way to say "OPS AND APP".
  //
  //   null ─Propose(TWR)→ PROPOSED ─(every acknowledger acked, any order)→ ACKNOWLEDGED
  //        ─Begin(TWR)→ IN_PROGRESS ─Complete(TWR)→ PENDING_INSPECTION
  //        ─(OPS CompleteInspection on each runway in the set)→ null
  //   PROPOSED/ACKNOWLEDGED ─Reject(an acknowledger) | Withdraw(TWR)→ REJECTED (terminal)
  //
  // Acknowledgement is coordination, not permission (decisions.md H20): tower
  // alone decides, so an acknowledger nobody holds when the change is proposed
  // is SKIPPED and recorded as such, never a deadlock — and never answered from
  // another Facility (S-R2-15). A controller holding TWR and every acknowledger
  // self-coordinates in ONE input (SelfCoordinateRunwayChange, S-Q24).

  _endOfRunway(ctx, end) {
    return ctx.inventory.runways.find(d => (d.ends || []).includes(end)) || null;
  }

  _proposeChange(ctx, { selfCoordinate }) {
    const { record, op, actingPositionId, by } = ctx;
    if (isRunwayChangeOpen(record.runwayChange)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `a runway change to ${record.runwayChange.toRunwayId} is already ${record.runwayChange.state}` };
    }
    const to = op.toRunwayId;
    const def = typeof to === 'string' ? this._endOfRunway(ctx, to) : null;
    if (!def) return { ok: false, reason: 'NOT_FOUND', detail: `no runway ${to} at ${record.facilityId}` };
    if (to === record.activeRunway) return { ok: false, reason: 'VALIDATION_ERROR', detail: `runway ${to} is already the active runway` };
    const target = this._runway(record, def.runwayId);
    if (target.status === 'CLOSED') return { ok: false, reason: 'VALIDATION_ERROR', detail: `runway ${def.runwayId} is closed` };

    const now = this._clock.now();
    // The acknowledger set is FROZEN here, from config and from who is
    // actually at the field right now.
    const acknowledgers = [...(ctx.inventory.runwayChangeAcknowledgers || [])];
    const acks = {};
    for (const positionId of acknowledgers) {
      acks[positionId] = this._isOccupied(record.facilityId, positionId)
        ? null
        : { skipped: true, reason: 'UNMANNED', at: now };
    }
    const required = acknowledgers.filter(p => acks[p] === null);

    if (selfCoordinate) {
      // One input, legal only when this controller is Primary on every
      // acknowledger that is manned (TWR is checked at the wire).
      const elsewhere = required.filter(p => this._primaryOf(record.facilityId, p) !== by);
      if (elsewhere.length) {
        return { ok: false, reason: 'PERMISSION_DENIED', detail: `a self-coordinated runway change needs you Primary at ${elsewhere.join(' and ')} — ask for the acknowledgement instead` };
      }
      for (const p of required) acks[p] = { by: by || null, positionId: p, at: now, selfCoordinated: true };
    }

    const previous = record.runwayChange; // a REJECTED one, if any — kept in the history below
    record.runwayChange = {
      changeId: crypto.randomUUID(),
      state: required.length === 0 || selfCoordinate ? 'ACKNOWLEDGED' : 'PROPOSED',
      fromRunwayId: record.activeRunway || null,
      toRunwayId: to,
      proposedBy: by || null, proposedPositionId: actingPositionId, proposedAt: now,
      note: this._note(op.note),
      acknowledgers,
      acks,
      selfCoordinated: !!selfCoordinate,
      rejected: null,
      beganAt: null, beganBy: null, completedAt: null, completedBy: null,
      pendingInspection: [],
    };
    const skipped = acknowledgers.filter(p => acks[p] && acks[p].skipped);
    this._touch(record, by, {
      op: op.kind, positionId: actingPositionId, from: record.runwayChange.fromRunwayId, to,
      state: record.runwayChange.state, changeId: record.runwayChange.changeId,
      ...(skipped.length ? { skippedAcknowledgers: skipped } : {}),
      ...(selfCoordinate ? { selfCoordinated: true, acknowledgedAs: required } : {}),
      ...(previous ? { replaced: previous } : {}),
    });
    return { ok: true };
  }

  _ackChange(ctx) {
    const { record, actingPositionId, by } = ctx;
    const change = record.runwayChange;
    if (!change || change.state !== 'PROPOSED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: change ? `the runway change is ${change.state}, not awaiting acknowledgement` : 'no runway change is proposed' };
    }
    if (!change.acknowledgers.includes(actingPositionId)) {
      return { ok: false, reason: 'PERMISSION_DENIED', detail: `${actingPositionId} is not an acknowledger of this runway change` };
    }
    const existing = change.acks[actingPositionId];
    if (existing) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: existing.skipped ? `${actingPositionId} was unmanned when the change was proposed and was skipped` : `${actingPositionId} has already acknowledged` };
    }
    // A boundary event between two Positions one controller holds is a
    // self-coordination (§4.8.3): allowed, and recorded as such.
    const selfCoordinated = !!change.proposedBy && change.proposedBy === (by || null);
    change.acks[actingPositionId] = { by: by || null, positionId: actingPositionId, at: this._clock.now(), selfCoordinated };
    const complete = change.acknowledgers.every(p => change.acks[p]);
    if (complete) change.state = 'ACKNOWLEDGED';
    this._touch(record, by, { op: 'AckRunwayChange', positionId: actingPositionId, changeId: change.changeId, selfCoordinated, state: change.state });
    return { ok: true };
  }

  _endChange(ctx, cause) {
    const { record, op, actingPositionId, by } = ctx;
    const change = record.runwayChange;
    if (!change || (change.state !== 'PROPOSED' && change.state !== 'ACKNOWLEDGED')) {
      const what = cause === 'WITHDRAWN' ? 'withdrawn' : 'rejected';
      return { ok: false, reason: 'VALIDATION_ERROR', detail: change && isRunwayChangeOpen(change) ? `a runway change that is ${change.state} can no longer be ${what} — it is under way` : `no runway change to be ${what}` };
    }
    if (cause === 'REJECTED' && !change.acknowledgers.includes(actingPositionId)) {
      return { ok: false, reason: 'PERMISSION_DENIED', detail: `${actingPositionId} is not an acknowledger of this runway change` };
    }
    change.state = 'REJECTED';
    change.rejected = { by: by || null, positionId: actingPositionId, at: this._clock.now(), cause, note: this._note(op.note) };
    this._touch(record, by, { op: op.kind, positionId: actingPositionId, changeId: change.changeId, cause, note: change.rejected.note });
    return { ok: true };
  }

  _beginChange(ctx) {
    const { record, actingPositionId, by } = ctx;
    const change = record.runwayChange;
    // §13: "A runway change cannot be initiated without OPS and APP
    // acknowledgement." This single guard is that sentence.
    if (!(change && change.state === 'ACKNOWLEDGED')) {
      return {
        ok: false, reason: 'VALIDATION_ERROR',
        detail: change ? `the runway change is ${change.state} — it can begin only once acknowledged` : 'no runway change has been proposed',
      };
    }
    change.state = 'IN_PROGRESS';
    change.beganAt = this._clock.now();
    change.beganBy = by || null;
    this._touch(record, by, { op: 'BeginRunwayChange', positionId: actingPositionId, changeId: change.changeId });
    return { ok: true };
  }

  _completeChange(ctx) {
    const { record, actingPositionId, by } = ctx;
    const change = record.runwayChange;
    if (!change || change.state !== 'IN_PROGRESS') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: change ? `the runway change is ${change.state}, not in progress` : 'no runway change is in progress' };
    }
    // The new direction is inspected before it is used (decisions.md Q29):
    // the pavement it is on, and the old one if it is a different surface.
    const toDef = this._endOfRunway(ctx, change.toRunwayId);
    const fromDef = change.fromRunwayId ? this._endOfRunway(ctx, change.fromRunwayId) : null;
    const set = [toDef, fromDef].filter(Boolean).map(d => d.runwayId).filter((id, i, a) => a.indexOf(id) === i);
    for (const runwayId of set) {
      const rwy = this._runway(record, runwayId);
      if (rwy.status === 'SUSPENDED_BARRIER_CHANGE' || rwy.status === 'CLOSED') {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: `runway ${runwayId} is ${rwy.status} — finish that before completing the runway change` };
      }
    }
    const now = this._clock.now();
    const moved = [];
    for (const runwayId of set) {
      const rwy = this._runway(record, runwayId);
      if (rwy.status === 'OPEN') {
        rwy.status = 'SUSPENDED_INSPECTION';
        rwy.suspension = { kind: 'RUNWAY_CHANGE', since: now, by: by || null, positionId: actingPositionId, note: null, changeId: change.changeId };
        moved.push(runwayId);
      }
      // Already SUSPENDED_INSPECTION (a barrier change awaiting its
      // inspection): the one inspection will cover both.
    }
    const from = record.activeRunway;
    record.activeRunway = change.toRunwayId;
    record.activeRunwaySource = { kind: 'RUNWAY_CHANGE', changeId: change.changeId, at: now };
    change.state = 'PENDING_INSPECTION';
    change.completedAt = now;
    change.completedBy = by || null;
    change.pendingInspection = set;
    this._touch(record, by, {
      op: 'CompleteRunwayChange', positionId: actingPositionId, changeId: change.changeId,
      from, to: change.toRunwayId, suspendedForInspection: moved, pendingInspection: set,
    });
    return { ok: true };
  }

  // ── requests to tower (decisions.md H18) ───────────────────────────────

  _request(ctx) {
    const { runway, refusal } = this._needRunway(ctx);
    if (refusal) return refusal;
    const action = ctx.op.action;
    if (!REQUEST_ACTIONS.includes(action)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `a runway request asks for one of ${REQUEST_ACTIONS.join(', ')}` };
    }
    if (runway.pendingRequest) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${runway.pendingRequest.requestedPositionId} already has a ${runway.pendingRequest.action} request with tower for runway ${runway.runwayId}` };
    }
    if (runway.status !== REQUEST_EFFECTS[action].from) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `runway ${runway.runwayId} is ${runway.status} — nothing to ask tower to ${action.toLowerCase().replace('_', ' ')}` };
    }
    runway.pendingRequest = {
      requestId: crypto.randomUUID(), action,
      requestedBy: ctx.by || null, requestedPositionId: ctx.actingPositionId,
      requestedAt: this._clock.now(), note: this._note(ctx.op.note),
    };
    this._touch(ctx.record, ctx.by, { op: 'RequestRunwayStatus', runwayId: runway.runwayId, action, positionId: ctx.actingPositionId });
    return { ok: true };
  }

  _acceptRequest(ctx) {
    const { runway, refusal } = this._needRunway(ctx);
    if (refusal) return refusal;
    const request = runway.pendingRequest;
    if (!request) return { ok: false, reason: 'VALIDATION_ERROR', detail: `no request is outstanding for runway ${runway.runwayId}` };
    // Carried out AS tower's own op, through the same checks, attributed to
    // tower and naming who asked.
    const effect = REQUEST_EFFECTS[request.action];
    const asked = { positionId: request.requestedPositionId, by: request.requestedBy, requestId: request.requestId };
    runway.pendingRequest = null;
    const inner = { ...ctx, op: { ...ctx.op, kind: effect.op, reason: request.note, note: request.note } };
    let result;
    if (effect.op === 'CloseRunway') result = this._close(inner, asked);
    else if (effect.op === 'OpenRunway') result = this._open(inner, asked);
    else result = this._beginBarrierChange(inner, asked);
    if (!result.ok) runway.pendingRequest = request; // nothing changed; the ask still stands
    return result;
  }

  _rejectRequest(ctx) {
    const { runway, refusal } = this._needRunway(ctx);
    if (refusal) return refusal;
    const request = runway.pendingRequest;
    if (!request) return { ok: false, reason: 'VALIDATION_ERROR', detail: `no request is outstanding for runway ${runway.runwayId}` };
    runway.pendingRequest = null;
    this._touch(ctx.record, ctx.by, {
      op: 'RejectRunwayRequest', runwayId: runway.runwayId, positionId: ctx.actingPositionId,
      request, note: this._note(ctx.op.note),
    });
    return { ok: true };
  }

  // ── the active end from the mission wind (decisions.md H22) ────────────

  /**
   * Called on mission load with the Facility airfield's wind. Sets the active
   * end to the one most into the wind — but only for a mission whose wind has
   * not already set it: crc-sync hears 'mission-load' on every reconnect, and a
   * reconnect (or a restart) must not undo what TWR has since chosen. Never
   * while a runway change is open. Audited as a system change.
   *
   * @returns {{ok:boolean, changed?:boolean, activeRunway?:string, reason?:string}}
   */
  setActiveRunwayFromWind(facilityId, { windFromTrue, windKt = null, missionKey = null } = {}) {
    const record = this._records.get(facilityId);
    if (!record) return { ok: false, reason: 'NOT_FOUND' };
    const source = record.activeRunwaySource;
    if (record.activeRunway && source && missionKey && source.missionKey === missionKey) {
      return { ok: true, changed: false, activeRunway: record.activeRunway };
    }
    if (isRunwayChangeOpen(record.runwayChange)) {
      console.warn(`[field-state] ${facilityId}: a runway change is open — leaving the active runway at ${record.activeRunway} rather than deriving it from the wind`);
      return { ok: true, changed: false, activeRunway: record.activeRunway };
    }
    const end = activeEndIntoWind(this._inventories.get(facilityId), windFromTrue);
    if (!end) return { ok: false, reason: 'VALIDATION_ERROR' };
    const before = deepClone(record);
    const from = record.activeRunway;
    record.activeRunway = end;
    record.activeRunwaySource = { kind: 'WIND', windFromTrue, windKt, missionKey, at: this._clock.now() };
    this._touch(record, SYSTEM_ACTOR, { op: 'ActiveRunwayFromWind', from, to: end, windFromTrue, windKt, missionKey, positionId: null });
    this._recordAudit({ facilityId, op: { kind: 'ActiveRunwayFromWind' } }, null, SYSTEM_ACTOR, before, { ok: true });
    return { ok: true, changed: from !== end, activeRunway: end };
  }

  // ── persistence (durable per docs/adr/0002) ────────────────────────────

  /** State only — the inventory comes from config on every boot. */
  snapshot() { return [...this._records.values()].map(deepClone); }

  /**
   * Reconciled against the inventory, like AirspaceStore.restore: a Facility
   * with no inventory any more is skipped, a runway no longer configured is
   * dropped, a newly configured one starts OPEN. What survives comes back
   * EXACTLY as it was — a suspension comes back suspended, with who suspended
   * it (the MARSA precedent, docs/adr/0051): a fact a person recorded is not
   * made untrue by a crc-sync restart, and coming back OPEN would hand the
   * next controller a lie (§4.8.3).
   */
  restore(data) {
    for (const saved of data || []) {
      if (!saved || !this._records.has(saved.facilityId)) continue;
      const inventory = this._inventories.get(saved.facilityId);
      const fresh = this._seed(saved.facilityId);
      const record = { ...fresh, ...deepClone(saved) };
      record.runways = inventory.runways.map(def => {
        const stored = (saved.runways || []).find(r => r && r.runwayId === def.runwayId);
        if (!stored) return this._seedRunway(def);
        const runway = { ...this._seedRunway(def), ...deepClone(stored) };
        if (!['OPEN', 'CLOSED', 'SUSPENDED_BARRIER_CHANGE', 'SUSPENDED_INSPECTION'].includes(runway.status)) {
          console.warn(`[field-state] ${saved.facilityId}: restored runway ${def.runwayId} had unknown status ${runway.status} — keeping it SUSPENDED_INSPECTION so it is inspected before use`);
          runway.status = 'SUSPENDED_INSPECTION';
          runway.suspension = runway.suspension || { kind: 'BARRIER_CHANGE', since: null, by: null, positionId: null, note: 'restored from an unreadable state' };
        }
        delete runway.arrestingGear; // gear is config, never state
        return runway;
      });
      const ends = inventory.runways.flatMap(d => d.ends);
      if (record.activeRunway && !ends.includes(record.activeRunway)) {
        console.warn(`[field-state] ${saved.facilityId}: restored active runway ${record.activeRunway} is no longer configured — unset until the wind or TWR sets it`);
        record.activeRunway = null;
        record.activeRunwaySource = null;
      }
      const change = record.runwayChange;
      if (change && ![change.fromRunwayId, change.toRunwayId].filter(Boolean).every(e => ends.includes(e))) {
        console.warn(`[field-state] ${saved.facilityId}: restored runway change names a runway end no longer configured — cleared`);
        record.runwayChange = null;
      }
      if (!Array.isArray(record.transitions)) record.transitions = [];
      this._records.set(saved.facilityId, record);
      this._views.delete(saved.facilityId);
    }
  }
}

module.exports = { FieldStateStore, SYSTEM_ACTOR };
