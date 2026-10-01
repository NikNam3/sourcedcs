'use strict';

// The SFA rotation record (guide §4.7, docs/adr/0075, docs/adr/0093): which
// Position is on which of the pool's frequencies. An EIGHTH store, peer to
// CarrierStore, for the same reason: the record is a fact about the approach as a
// whole, not about a Strip or a flight, so it lives neither on the Board nor on an
// FDR.
//
//   { facilityId, rev, rotation: { [rackId]: positionId }, transitions[] }
//
// It records WHO IS ON A FREQUENCY. It never records a frequency on a Strip and
// never changes one (D17): the Strip's frequency is the FDR's, and the controller
// is what moves.
//
// Authority is two-sided. permission.js's capability table is the CEILING (which
// Position classes may rotate at all); config's `singleFrequencyApproach.
// jurisdiction` NARROWS it to the one Position that holds it, and can never widen
// it (the shape CompleteInspection has). A refusal reads as a permission refusal.
//
// Persisted with the rest of the EFSP state (docs/adr/0048, state/), restored by
// normalising rather than refusing (a restart must come up). Every op is audited,
// refusals included. Every time comes from the injected mission clock (H11).

const permission = require('./permission');
const { validateSfaRotationRecord } = require('./facility-config');
const { WALL_CLOCK } = require('../mission-clock');

const TRANSITIONS_CAP = 100;
const SET_OP = 'SetSfaRotation';

function deepClone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

class SfaStore {
  /**
   * @param {object} deps
   * @param {object} deps.config the Facility's `singleFrequencyApproach` (facility-config.js)
   * @param {string[]} deps.positions the Facility's Positions
   * @param {string} [deps.facilityId]
   * @param {{now:()=>number}} [deps.clock] the mission clock
   */
  constructor({ config, positions, facilityId = 'INCIRLIK', clock = WALL_CLOCK } = {}) {
    if (!config) throw new Error('SfaStore needs a singleFrequencyApproach config');
    this._config = deepClone(config);
    this._positions = [...(positions || [])];
    this._facilityId = facilityId;
    this._clock = clock;
    this._record = this._fresh();
    this._seq = 0;
    this._mutationLog = null;
  }

  _fresh() {
    const initial = this._config.initialRotation || {};
    const ok = !validateSfaRotationRecord(initial, this._config, this._positions);
    return { facilityId: this._facilityId, rev: 0, rotation: ok ? deepClone(initial) : {}, transitions: [] };
  }

  setMutationLog(mutationLog) { this._mutationLog = mutationLog; }
  get currentSeq() { return this._seq; }
  get jurisdiction() { return this._config.jurisdiction; }

  /** The wire view: the record plus the config the client needs to draw the pool, sent whole (it is small). */
  view() {
    const r = this._record;
    return {
      facilityId: r.facilityId, rev: r.rev,
      jurisdiction: this._config.jurisdiction, rotationSize: this._config.rotationSize,
      controllers: permission.sfaControllerPositions().filter(p => this._positions.includes(p)), // who may be put on a frequency
      pool: deepClone(this._config.pool),
      rotation: deepClone(r.rotation),
      transitions: deepClone(r.transitions.slice(-20)),
    };
  }

  /** The Position on a frequency right now, or null. */
  positionOn(rackId) { return this._record.rotation[rackId] || null; }

  _audit(mutation, actingPositionId, by, before, result) {
    if (!this._mutationLog) return;
    const op = mutation.op || {};
    this._mutationLog.record({
      clientMutationId: mutation.clientMutationId,
      op: op.kind,
      facilityId: this._facilityId,
      sfaRackId: op.rackId,
      actingPositionId,
      actorId: by || null,
      at: this._clock.now(),
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      detail: result.ok ? undefined : result.detail,
      before,
      after: result.ok ? deepClone(this._record) : undefined,
    });
  }

  /**
   * The one entry point. Never throws. `mutation` is `{ clientMutationId, baseRev?, op: { kind: 'SetSfaRotation', rackId, positionId|null } }`.
   * Moving a Position that is already on another frequency takes it off that one;
   * `positionId: null` takes a frequency out of the rotation. The result's `changed` is false for a no-op.
   */
  apply(mutation, actingPositionId, by) {
    const before = deepClone(this._record);
    let result;
    try {
      result = this._dispatch(mutation, actingPositionId, by);
    } catch (err) {
      console.error('[sfa-store] unexpected error applying an SFA op — rejecting it instead of crashing:', err);
      result = { ok: false, reason: 'VALIDATION_ERROR', detail: 'internal error processing SFA op' };
    }
    this._audit(mutation, actingPositionId, by, before, result);
    return result;
  }

  _dispatch(mutation, actingPositionId, by) {
    const op = mutation.op || {};
    if (op.kind !== SET_OP) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown SFA op ${JSON.stringify(op.kind)}` };
    if (!permission.canRotateSfa(actingPositionId) || actingPositionId !== this._config.jurisdiction) {
      return { ok: false, reason: 'PERMISSION_DENIED', detail: `${this._config.jurisdiction} holds jurisdiction over the SFA rotation (guide §4.7), not ${actingPositionId}` };
    }
    if (mutation.baseRev !== undefined && mutation.baseRev !== null && mutation.baseRev !== this._record.rev) {
      return { ok: false, reason: 'STALE_REV', record: deepClone(this._record) };
    }
    if (!this._config.pool.some(p => p.rackId === op.rackId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${JSON.stringify(op.rackId)} is not one of the SFA pool's frequencies` };
    }
    if (op.positionId !== null && !this._positions.includes(op.positionId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${JSON.stringify(op.positionId)} is not a Position of ${this._facilityId}` };
    }
    // Only a Position the capability table gives an SFA column can be on a frequency.
    if (op.positionId !== null && !permission.sfaControllerPositions().includes(op.positionId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${op.positionId} does not work the SFA frequencies` };
    }
    const next = deepClone(this._record.rotation);
    if (op.positionId === null) {
      delete next[op.rackId];
    } else {
      for (const [rackId, positionId] of Object.entries(next)) if (positionId === op.positionId) delete next[rackId];
      next[op.rackId] = op.positionId;
    }
    const problem = validateSfaRotationRecord(next, this._config, this._positions);
    if (problem) return { ok: false, reason: 'VALIDATION_ERROR', detail: problem };
    const same = JSON.stringify(Object.entries(next).sort()) === JSON.stringify(Object.entries(this._record.rotation).sort());
    if (same) return { ok: true, changed: false, record: deepClone(this._record) };
    this._record.rotation = next;
    this._record.rev += 1;
    this._seq += 1;
    this._record.transitions.push({
      at: this._clock.now(), by: by || null, rackId: op.rackId, positionId: op.positionId,
    });
    if (this._record.transitions.length > TRANSITIONS_CAP) this._record.transitions.splice(0, this._record.transitions.length - TRANSITIONS_CAP);
    return { ok: true, changed: true, record: deepClone(this._record) };
  }

  // ── persistence ─────────────────────────────────────────────────────────

  snapshot() { return deepClone(this._record); }

  /** Normalises rather than refuses: a saved record that no longer fits the config (a pool edited between runs) comes back as the configured start. */
  restore(data) {
    if (!data || typeof data !== 'object') return;
    const rotation = data.rotation && typeof data.rotation === 'object' && !Array.isArray(data.rotation) ? data.rotation : null;
    if (!rotation || validateSfaRotationRecord(rotation, this._config, this._positions)) return;
    this._record = {
      facilityId: this._facilityId,
      rev: Number.isInteger(data.rev) ? data.rev : 0,
      rotation: deepClone(rotation),
      transitions: Array.isArray(data.transitions) ? data.transitions.slice(-TRANSITIONS_CAP) : [],
    };
  }
}

module.exports = { SfaStore };
