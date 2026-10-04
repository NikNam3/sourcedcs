'use strict';

// The bookkeeping the six sequenced EFSP stores (airspace, carrier, correlation, MARSA, runway status, SFA) share
// (ARCH-S #6): the clock and the Mutation log they are built with, the SyncLog that owns the store's `seq` and lifetime
// `epoch` (docs/adr/0106), the rev bump, the catch-all every `apply` has (store-throw.js) and the audit line's common
// shape. A base class, not a framework: each store keeps its own ops, its own records and its own audit SUBJECT (the id
// fields its readers key on: airspaceId, carrierHullId, flightDataId, marsaId, runwayStatusFacilityId, sfaRackId).
//
// The Board (board/board-state.js) and the flight data store keep their own: the Board's SyncLog has a ring and a touched
// set, and the flight data store has no sequence.

const { SyncLog } = require('./sync/sync-log');
const { internalError, partialAuditTail } = require('./store-throw');
const { WALL_CLOCK } = require('../mission-clock');

class SyncedStore {
  /**
   * @param {object} [deps]
   * @param {{now:()=>number}} [deps.clock] the mission clock (docs/adr/0079)
   * @param {{record:Function}|null} [deps.mutationLog] the Mutation log (docs/adr/0081); null for a fixture with none
   */
  constructor({ clock = WALL_CLOCK, mutationLog = null } = {}) {
    this._clock = clock;
    // The store's sequence and its lifetime (epoch, not persisted): no ring, the resync answer is the snapshot slice (docs/adr/0106).
    this._sync = new SyncLog({ epoch: true });
    this._mutationLog = mutationLog;
  }

  get currentSeq() { return this._sync.seq; }
  /** The lifetime this store's seq belongs to (docs/adr/0106): new per process, never persisted. */
  get epoch() { return this._sync.epoch; }

  /** One change to `record`: its rev moves and so does the store's sequence. Returns the record. */
  _bump(record) {
    record.rev += 1;
    this._sync.advance();
    return record;
  }

  /**
   * `fn()` with the store's backstop (docs/wip/STORE-THROWS.md, B3): a throw is `INTERNAL_ERROR`, never `VALIDATION_ERROR`, and one
   * after a write (the sequence moved) is marked `partial` so the caller audits, persists and broadcasts what is now there.
   * @param {string} what e.g. 'carrier op'
   * @param {object} log the store's logger
   * @param {() => object} fn
   */
  _guarded(what, log, fn) {
    const seq0 = this._sync.seq;
    try {
      return fn();
    } catch (err) {
      log.error(`unexpected error applying ${what} — rejecting it instead of crashing`, { err });
      return internalError(what, err, this._sync.seq !== seq0);
    }
  }

  /**
   * One Mutation-log line (a refusal is logged too). `after` (a value or a function, run only for an ok or partial result) is the record as it stands. The common keys come first, in the order every store used; `subject`
   * holds the store's own id fields (and its `facilityId`), `actorExtra` any further actor keys, `resultExtra` what the
   * result added, `extra` anything last.
   */
  _writeAudit(mutation, { subject, actingPositionId, by, actorExtra, result, before, after, resultExtra, extra }) {
    if (!this._mutationLog) return;
    const op = mutation.op || {};
    this._mutationLog.record({
      clientMutationId: mutation.clientMutationId,
      op: op.kind,
      ...subject,
      actingPositionId,
      actorId: by || null,
      ...actorExtra,
      at: this._clock.now(),
      ok: result.ok,
      // A refusal is the interesting half of an authority model, so failures are logged too (unlike BoardStore's).
      reason: result.ok ? undefined : result.reason,
      detail: result.ok ? undefined : result.detail,
      ...resultExtra,
      before,
      after: (result.ok || result.partial) ? (typeof after === 'function' ? after() : after) : undefined,
      ...partialAuditTail(result),
      ...extra,
    });
  }
}

module.exports = { SyncedStore };
