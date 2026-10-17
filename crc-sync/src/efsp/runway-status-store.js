'use strict';

// Runway status (EFSPImplementationGuide.md §9.7) — the STATEFUL half, and the
// sixth EFSP store (docs/adr/0061).
//
// A peer of the Strip model, not a subsidiary of it (§9.1: "the runway-status
// model is a peer of the Strip model"). ONE instance for the whole server
// holding one record per Facility that has a runway inventory (today only
// INCIRLIK), for the reason AirspaceStore is single-instance: nothing about a
// runway is ever handed across a Facility boundary, so there is no D13
// replica question and one home per record is enough. `rev` is per Facility
// record, so two controllers reconfiguring the field at once collide on
// STALE_REV, which is correct rather than costly.
//
// Config vs state (decisions.md P5, docs/adr/0048): WHICH runways, ends and
// gear exist is the Facility's `runwayStatus` inventory, read ONCE here at
// construction and never written back. Everything that changes at runtime —
// status, suspension, closure, inspection, the active end, a runway change,
// a request to tower — lives only in this store and the Board snapshot. This
// store never calls setFacilityConfig and never writes a config file.
//
// The pure rules (status machine, runway resolution, inhibit wording, the
// into-wind end) are runway-status.js's; this file applies them to records.
//
// Rule 5's deliberate deviation: runway status rides its OWN sequence
// (`currentSeq`, sent as `runwayStatusSeq`) and its own efsp-runway-status-delta,
// not the Board sequence the guide names — see docs/adr/0061 for why each
// literal reading of "broadcast on the Board sequence" breaks.

const crypto = require('crypto');
const { WALL_CLOCK } = require('../mission-clock');
const { SyncedStore } = require('./synced-store');
const permission = require('./permission');
const authority = require('./authority');
const {
  canGo, buildStatusView, activeEndIntoWind, isRunwayChangeInProgress, isRunwayChangeOpen,
  REQUEST_ACTIONS,
} = require('./runway-status');
const { PAR_VALUE_FIELDS, validateParValue } = require('../surveillance/par');
const log = require('../log').logger('efsp:runway-status-store');

function deepClone(obj) { return obj === undefined ? undefined : JSON.parse(JSON.stringify(obj)); }

// What each request action needs the runway to be at, and the LC op an
// accepted request is carried out as — so an accepted request goes through
// the very same checks as tower doing it directly.
const REQUEST_EFFECTS = {
  CLOSE:          { from: 'OPEN',   op: 'CloseRunway' },
  OPEN:           { from: 'CLOSED', op: 'OpenRunway' },
  WORKS:          { from: 'OPEN',   op: 'BeginRunwayWorks' },
};

const REQUEST_VERBS = { CLOSE: 'close', OPEN: 'open', WORKS: 'suspend for works' };

// The system actor for changes no controller made (the active end derived
// from the mission wind). Audited under this id, never a Position.
const SYSTEM_ACTOR = 'crc-sync';

class RunwayStatusStore extends SyncedStore {
  /**
   * @param {object} facilityConfig — facility-config.js (injected, the
   *   AirspaceStore precedent, so a test can pass a fixture exposing
   *   getFacilityIds() and getFacilityConfig(id))
   * @param {object} [deps]
   * @param {{now:()=>number}} [deps.clock] the mission clock (docs/adr/0079)
   * @param {(facilityId:string, positionId:string)=>boolean} [deps.isStaffed]
   *   is somebody Primary at that Position — to resolve who acknowledges a
   *   runway change (an unstaffed acknowledger reverts or is skipped)
   * @param {(facilityId:string, positionId:string)=>string|null} [deps.primaryOf]
   *   the controllerId Primary at that Position — for SelfCoordinateRunwayChange
   */
  constructor(facilityConfig, { clock = WALL_CLOCK, isStaffed, primaryOf, mutationLog = null } = {}) {
    super({ clock, mutationLog });
    this._isStaffed = isStaffed || (() => false);
    this._primaryOf = primaryOf || (() => null);
    this._inventories = new Map(); // facilityId -> runwayStatus inventory (config, read once)
    this._positions = new Map();   // facilityId -> its Position set, for resolving acknowledgers
    this._records = new Map();     // facilityId -> record
    this._views = new Map();       // facilityId -> cached status view for rule 1
    this._parEnds = new Map();     // facilityId -> the runway ends with a PAR approach (config `parApproaches`, read once)
    for (const facilityId of facilityConfig.getFacilityIds()) {
      const config = facilityConfig.getFacilityConfig(facilityId);
      if (!config || !config.runwayStatus) continue; // no inventory, no record
      this._inventories.set(facilityId, deepClone(config.runwayStatus));
      this._positions.set(facilityId, [...(config.positions || [])]);
      this._parEnds.set(facilityId, Object.keys(config.parApproaches || {}).filter(k => !k.startsWith('_')));
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
      // The mission session (docs/adr/0086) whose wind has been applied. Kept
      // apart from activeRunwaySource, which an LC runway change replaces: a
      // reconnect after LC's change must still see the wind as applied.
      windDerivedSession: null,
      runways: inventory.runways.map(def => this._seedRunway(def)),
      runwayChange: null,
      // §12: a deferral leaves its fields present. L12 (hot cargo) and L13
      // (alert pad) give these meaning; no op here touches them.
      hotCargoPad: { occupied: false, occupantFlightDataId: null },
      alertPad: { occupied: false, occupantFlightDataId: null },
      // The PAR approach values the PAR controller set (docs/adr/0130, decisions H153): runway end -> { tdzeFt?, tchFt?, dhFt?,
      // gpaDeg? }, only the values set; a missing one is the Facility file's default. Field data, not traffic: the mission reset
      // keeps them, and they stay until changed or reset to the default.
      parValues: {},
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


  hasRunwayStatus(facilityId) { return this._records.has(facilityId); }

  // ── reads ──────────────────────────────────────────────────────────────

  /**
   * One Facility's runway status as the wire carries it: stored state merged
   * with the inventory, so each runway row is self-describing (the ends, the
   * racks, the gear), plus the guide's derived `runwayChangeInProgress`.
   * Cloned — a caller can never mutate the store through it. Null for a
   * Facility with no inventory.
   */
  getRunwayStatus(facilityId) {
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
    // The Facility's configured authorities, so a client mirrors the rule from the
    // wire instead of falling back to the owners table (S-L1b, docs/adr/0083).
    out.runwayChangeAcknowledgers = [...(inventory.runwayChangeAcknowledgers || [])];
    out.inspectionAuthorityPositionId = inventory.inspectionAuthorityPositionId ?? null;
    return out;
  }

  /** Every Facility's runway status — what the snapshot carries. */
  getAll() { return [...this._records.keys()].map(id => this.getRunwayStatus(id)); }

  /**
   * Rule 1's read path (nla.js through ctx.runwayStatusFor): a frozen, minimal
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

  /**
   * The PAR approach values set at a Facility (par-monitor.js reads them every sample): runway end -> { field: value }. A copy;
   * {} when none is set, null for a Facility with no runway inventory.
   */
  parValues(facilityId) {
    const record = this._records.get(facilityId);
    return record ? deepClone(record.parValues || {}) : null;
  }

  // ── the audit trail ────────────────────────────────────────────────────

  _recordAudit(mutation, actingPositionId, by, before, result) {
    // Refusals are the interesting half of an authority model — a refused BeginRunwayChange above all — so they are
    // logged, STALE_REV included.
    this._writeAudit(mutation, {
      // Its own id field: Mutation-log readers key on whichever id is present
      // (stripId / airspaceId / flightDataId / marsaId), and a runway-status op is about
      // a Facility's field, not any of those.
      subject: {
        runwayStatusFacilityId: mutation.facilityId,
        // The one name every reader keys on (docs/adr/0083).
        facilityId: mutation.facilityId ?? null,
        runwayId: (mutation.op || {}).runwayId ?? null,
      },
      actingPositionId: actingPositionId ?? null,
      by, result, before,
      after: () => deepClone(this._records.get(mutation.facilityId)),
    });
  }

  _touch(record, by, transition) {
    this._bump(record);
    record.updatedAt = this._clock.now();
    record.updatedBy = by || null;
    this._views.delete(record.facilityId);
    if (transition) record.transitions.push({ ...transition, at: record.updatedAt, by: by || null });
  }

  // ── the one entry point ────────────────────────────────────────────────

  /**
   * Every runway-status op. Never throws; every result carries the current
   * record as `runwayStatus`, success or refusal; every outcome is audited.
   * One op is one rev, one seq and one audit entry, however many runways it
   * touches.
   *
   * @param {{clientMutationId?:string, facilityId:string, baseRev?:number, op:{kind:string}}} mutation
   * @param {string} actingPositionId — verified by the wire gate (wire/skeleton.js) to be a Position
   *   the session is Primary at, at this Facility (docs/adr/0029)
   * @param {string} by — controllerId
   */
  apply(mutation, actingPositionId, by) {
    let before = null;
    const result = this._guarded('runway-status op', log, () => {
      mutation = mutation && typeof mutation === 'object' ? mutation : {};
      const op = mutation.op && typeof mutation.op === 'object' ? mutation.op : {};
      const record = this._records.get(mutation.facilityId);
      if (!record) return { ok: false, reason: 'NOT_FOUND', detail: `no runway status at ${mutation.facilityId}` };
      before = deepClone(record);
      if (mutation.baseRev !== undefined && mutation.baseRev !== null && record.rev !== mutation.baseRev) {
        // Audited, like correlation-store.js and unlike airspace-store.js, which returns here without a trace.
        return { ok: false, reason: 'STALE_REV', detail: `runway status is at rev ${record.rev}, not ${mutation.baseRev}` };
      }
      if (!permission.canActOnRunwayStatus(actingPositionId, op.kind)) {
        return Object.prototype.hasOwnProperty.call(permission.RUNWAY_STATUS_OP_OWNERS, op.kind)
          ? { ok: false, reason: 'PERMISSION_DENIED', detail: `${op.kind} is not ${actingPositionId}'s` }
          : { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown runway-status op: ${op.kind}` };
      }
      return this._dispatch(record, op, actingPositionId, by);
    });
    result.runwayStatus = this.getRunwayStatus(mutation && mutation.facilityId);
    this._recordAudit(mutation || {}, actingPositionId, by, before, result);
    return result;
  }

  _dispatch(record, op, actingPositionId, by) {
    const ctx = { record, op, actingPositionId, by, inventory: this._inventories.get(record.facilityId) };
    switch (op.kind) {
      case 'CloseRunway':           return this._close(ctx);
      case 'OpenRunway':            return this._open(ctx);
      case 'BeginRunwayWorks':      return this._beginRunwayWorks(ctx);
      case 'CompleteRunwayWorks':   return this._completeRunwayWorks(ctx);
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
      case 'SetParApproach':             return this._setParApproach(ctx);
      default:
        return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown runway-status op: ${op.kind}` };
    }
  }

  // ── PAR approach values (docs/adr/0130) ─────────────────────────────────

  /**
   * `{ kind: 'SetParApproach', runwayEnd, field, value }`: the PAR controller sets one of an approach's TDZE, TCH, decision height or
   * glidepath angle (`value: null` resets it to the default). Who: the Position the final is handed to (RUNWAY_STATUS_OP_OWNERS,
   * positions/incirlik-military.js); the ground controller aligns the glidepath and decision height cursors (Order 8200.1D ch 14
   * ¶17 h), and the final controller is the one who tells the pilot of the decision altitude (JO 7110.65 ¶5-12-6). One value per
   * op, so the audit says exactly what changed. A value equal to the one held is an unchanged success (no rev, no seq).
   */
  _setParApproach(ctx) {
    const { record, op } = ctx;
    const ends = this._parEnds.get(record.facilityId) || [];
    if (!ends.includes(op.runwayEnd)) {
      return { ok: false, reason: 'NOT_FOUND', detail: `no PAR approach to runway ${op.runwayEnd} at ${record.facilityId}${ends.length ? ` (${ends.join(', ')})` : ''}` };
    }
    const v = validateParValue(op.field, op.value);
    if (!v.ok) return v;
    const held = record.parValues[op.runwayEnd] || {};
    const from = Object.prototype.hasOwnProperty.call(held, op.field) ? held[op.field] : null;
    if (from === v.value) return { ok: true, unchanged: true };
    const next = { ...held };
    if (v.value === null) delete next[op.field];
    else next[op.field] = v.value;
    if (Object.keys(next).length) record.parValues[op.runwayEnd] = next;
    else delete record.parValues[op.runwayEnd];
    this._touch(record, ctx.by, { op: 'SetParApproach', runwayEnd: op.runwayEnd, field: op.field, from, to: v.value, positionId: ctx.actingPositionId });
    return { ok: true };
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

  // ── rules 1–2: close, open, runway works and the inspection ──────

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

  _beginRunwayWorks(ctx, requestedBy = null) {
    const { runway, refusal } = this._needRunway(ctx);
    if (refusal) return refusal;
    if (!canGo(runway.status, 'SUSPENDED_WORKS')) return this._illegal(runway, 'SUSPENDED_WORKS');
    runway.suspension = {
      kind: 'WORKS', since: this._clock.now(), by: ctx.by || null, positionId: ctx.actingPositionId,
      note: this._note(ctx.op.note), requestedBy,
    };
    this._touch(ctx.record, ctx.by, this._setStatus(ctx, runway, 'SUSPENDED_WORKS', requestedBy ? { requestedBy } : {}));
    return { ok: true };
  }

  _completeRunwayWorks(ctx) {
    const { runway, refusal } = this._needRunway(ctx);
    if (refusal) return refusal;
    if (runway.status !== 'SUSPENDED_WORKS') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `runway ${runway.runwayId} is ${runway.status}, not in runway works` };
    }
    // Still suspended, now awaiting the inspection; the suspension (and why)
    // is kept, so the inhibit keeps naming the runway until OPS signs it off.
    this._touch(ctx.record, ctx.by, this._setStatus(ctx, runway, 'SUSPENDED_INSPECTION'));
    return { ok: true };
  }

  _completeInspection(ctx) {
    const notAuthority = authority.runwayInspectionRefusal(ctx.actingPositionId, ctx.inventory);
    if (notAuthority) return notAuthority;
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
  // Its own machine on the runway-status record. board/coordination.js's
  // coordination primitives cannot carry it: they are attached to a Strip, cross-Facility
  // by construction (LC, OPS and AP are all INCIRLIK), and one proposer /
  // one responder with no way to say "OPS AND AP".
  //
  //   null ─Propose(LC)→ PROPOSED ─(every acknowledger acked, any order)→ ACKNOWLEDGED
  //        ─Begin(LC)→ IN_PROGRESS ─Complete(LC)→ PENDING_INSPECTION
  //        ─(OPS CompleteInspection on each runway in the set)→ null
  //   PROPOSED/ACKNOWLEDGED ─Reject(an acknowledger) | Withdraw(LC)→ REJECTED (terminal)
  //
  // Acknowledgement is coordination, not permission (decisions.md H20): tower
  // alone decides, so an acknowledger nobody holds when the change is proposed
  // is SKIPPED and recorded as such, never a deadlock — and never answered from
  // another Facility (S-R2-15). A controller signed on to LC and every acknowledger
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
      acks[positionId] = this._isStaffed(record.facilityId, positionId)
        ? null
        : { skipped: true, reason: 'UNSTAFFED', at: now };
    }
    const required = acknowledgers.filter(p => acks[p] === null);

    if (selfCoordinate) {
      // One input, legal only when this controller is Primary on every
      // acknowledger that is staffed (LC is checked at the wire).
      const notPrimary = authority.selfCoordinationRefusal(required, p => this._primaryOf(record.facilityId, p), by);
      if (notPrimary) return notPrimary;
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
      return { ok: false, reason: 'VALIDATION_ERROR', detail: existing.skipped ? `${actingPositionId} was unstaffed when the change was proposed and was skipped` : `${actingPositionId} has already acknowledged` };
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
    // §13: "A runway change cannot be initiated without OPS and AP
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
      if (rwy.status === 'SUSPENDED_WORKS' || rwy.status === 'CLOSED') {
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
      // Already SUSPENDED_INSPECTION (works awaiting their
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
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `runway ${runway.runwayId} is ${runway.status} — nothing to ask tower to ${REQUEST_VERBS[action]}` };
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
    else result = this._beginRunwayWorks(inner, asked);
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
   * end to the one most into the wind — once per mission SESSION
   * (mission-session.js, docs/adr/0086): crc-sync hears 'mission-load' on every
   * reconnect, and a reconnect (or a restart) onto the same session must not
   * undo what LC has since chosen. Never while a runway change is open (the
   * wind then counts as applied: LC is choosing). Audited as a system change.
   *
   * @returns {{ok:boolean, changed?:boolean, skipped?:boolean, activeRunway?:string, reason?:string}}
   *   skipped: this session's wind was already applied, nothing was touched
   */
  setActiveRunwayFromWind(facilityId, { windFromTrue, windKt = null, missionSession = null } = {}) {
    const record = this._records.get(facilityId);
    if (!record) return { ok: false, reason: 'NOT_FOUND' };
    if (missionSession !== null && record.windDerivedSession === missionSession) {
      return { ok: true, changed: false, skipped: true, activeRunway: record.activeRunway };
    }
    if (isRunwayChangeOpen(record.runwayChange)) {
      log.warn('a runway change is open — leaving the active runway as it is rather than deriving it from the wind', { facilityId, activeRunway: record.activeRunway });
      record.windDerivedSession = missionSession;
      return { ok: true, changed: false, activeRunway: record.activeRunway };
    }
    const end = activeEndIntoWind(this._inventories.get(facilityId), windFromTrue);
    if (!end) return { ok: false, reason: 'VALIDATION_ERROR' };
    const before = deepClone(record);
    const from = record.activeRunway;
    record.activeRunway = end;
    record.activeRunwaySource = { kind: 'WIND', windFromTrue, windKt, missionSession, at: this._clock.now() };
    record.windDerivedSession = missionSession;
    this._touch(record, SYSTEM_ACTOR, { op: 'ActiveRunwayFromWind', from, to: end, windFromTrue, windKt, missionSession, positionId: null });
    this._recordAudit({ facilityId, op: { kind: 'ActiveRunwayFromWind' } }, null, SYSTEM_ACTOR, before, { ok: true });
    return { ok: true, changed: from !== end, activeRunway: end };
  }

  /**
   * The mission reset (docs/adr/0108): every runway is OPEN again with no suspension, closure, inspection or pending request,
   * no runway change is open, and the pads are empty. What is kept: the active runway and where it came from. It belongs to the
   * session's wind, which the mission-load that follows re-reads for the new session (setActiveRunwayFromWind), and a stale value
   * is the safer answer if that read fails. Audited as a system change, one entry per Facility that had anything to clear.
   * @returns {string[]} the Facilities that changed
   */
  resetForMission(by = SYSTEM_ACTOR) {
    const changed = [];
    for (const [facilityId, record] of this._records) {
      const fresh = this._seed(facilityId);
      const slice = (r) => JSON.stringify([r.runways, r.runwayChange, r.hotCargoPad, r.alertPad]);
      if (slice(record) === slice(fresh)) continue;
      const before = deepClone(record);
      record.runways = fresh.runways;
      record.runwayChange = null;
      record.hotCargoPad = fresh.hotCargoPad;
      record.alertPad = fresh.alertPad;
      this._touch(record, by, { op: 'MissionReset', positionId: null });
      this._recordAudit({ facilityId, op: { kind: 'MissionReset' } }, null, by, before, { ok: true });
      changed.push(facilityId);
    }
    return changed;
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
        if (!['OPEN', 'CLOSED', 'SUSPENDED_WORKS', 'SUSPENDED_INSPECTION'].includes(runway.status)) {
          log.warn('restored runway had an unknown status — keeping it SUSPENDED_INSPECTION so it is inspected before use', { facilityId: saved.facilityId, runwayId: def.runwayId, status: runway.status });
          runway.status = 'SUSPENDED_INSPECTION';
          runway.suspension = runway.suspension || { kind: 'WORKS', since: null, by: null, positionId: null, note: 'restored from an unreadable state' };
        }
        delete runway.arrestingGear; // gear is config, never state
        return runway;
      });
      const ends = inventory.runways.flatMap(d => d.ends);
      if (record.activeRunway && !ends.includes(record.activeRunway)) {
        log.warn('restored active runway is no longer configured — unset until the wind or LC sets it', { facilityId: saved.facilityId, activeRunway: record.activeRunway });
        record.activeRunway = null;
        record.activeRunwaySource = null;
      }
      const change = record.runwayChange;
      if (change && ![change.fromRunwayId, change.toRunwayId].filter(Boolean).every(e => ends.includes(e))) {
        log.warn('restored runway change names a runway end no longer configured — cleared', { facilityId: saved.facilityId });
        record.runwayChange = null;
      }
      if (!Array.isArray(record.transitions)) record.transitions = [];
      record.parValues = this._restoreParValues(saved.facilityId, saved.parValues);
      this._records.set(saved.facilityId, record);
      this._views.delete(saved.facilityId);
    }
  }

  /**
   * The PAR values of a saved record, against today's config: a runway end with no PAR approach any more, or a value outside
   * today's range, is dropped with a warning (the default applies again), as a runway no longer configured is; an unknown field is
   * an unknown persisted shape and stops start-up (H88). A value that is still valid comes back as it was.
   */
  _restoreParValues(facilityId, saved) {
    const out = {};
    const ends = this._parEnds.get(facilityId) || [];
    for (const [end, values] of Object.entries(saved && typeof saved === 'object' ? saved : {})) {
      if (!ends.includes(end) || !values || typeof values !== 'object') {
        log.warn('restored PAR values for a runway end with no PAR approach any more — dropped', { facilityId, runwayEnd: end });
        continue;
      }
      const kept = {};
      for (const [field, value] of Object.entries(values)) {
        if (!PAR_VALUE_FIELDS.includes(field)) {
          throw new Error(`[efsp] the Board snapshot holds an unknown PAR approach value "${field}" for ${facilityId} runway ${end} (${PAR_VALUE_FIELDS.join(', ')}): delete state/efsp-board.json to start clean`);
        }
        const v = validateParValue(field, value);
        if (v.ok && v.value !== null) kept[field] = v.value;
        else log.warn('restored PAR value is out of range — dropped, the default applies', { facilityId, runwayEnd: end, field, value });
      }
      if (Object.keys(kept).length) out[end] = kept;
    }
    return out;
  }
}

module.exports = { RunwayStatusStore, };
