'use strict';

// The Board's audit (docs/adr/0095, docs/adr/0083): the Mutation-log entry a client Mutation leaves, and the entry a
// PEER write leaves on this Board, and the SYSTEM entries (recordSystem). StripOps (client Mutations) and Coordination and Tofi (peer writes) call it.

const { deepClone } = require('./strip-util');

class BoardAudit {
  /**
   * @param {object} deps
   * @param {object} deps.rules the Board's rules (facilityId)
   * @param {{now: () => number}} deps.clock the mission clock
   * @param {() => object|null} deps.mutationLog the facade's current Mutation log, read late (setMutationLog)
   */
  constructor({ rules, clock, mutationLog }) {
    this._rules = rules;
    this._clock = clock;
    this._mutationLogOf = mutationLog;
  }

  get _mutationLog() { return this._mutationLogOf(); }

  /**
   * The entry a PEER write leaves on THIS Board (docs/adr/0083): coordination and
   * TOFI change the receiving Facility's Board from inside the sender's Mutation.
   * `clientMutationId` stays null so no reader takes it for a second application
   * of the sender's Mutation; `causedBy` names that Mutation. `after` of a peer
   * entry is never a drop the traffic count would count (traffic-count.js).
   */
  recordPeer(op, strip, before, { causedBy, fromFacilityId, by, action }) {
    if (!this._mutationLog) return;
    this._mutationLog.record({
      clientMutationId: null, causedBy: causedBy || null, op,
      ...(action ? { action } : {}),
      stripId: strip.stripId, flightDataId: strip.flightDataId || null,
      facilityId: this._rules.facilityId || null, fromFacilityId: fromFacilityId || null,
      actingPositionId: null, actorId: by || null, at: this._clock.now(),
      before, after: deepClone(strip), source: 'peer',
    });
  }

  /**
   * A SYSTEM write: no client Mutation and no acting Position (a peer dropped, a Position vacated or retaken, an
   * archive). `tail` is spread after `at`, in the order given, so each site keeps the key order its JSONL line
   * always had; `flightDataFirst` puts `flightDataId` before `facilityId` (Archive's order; the others write
   * `facilityId` first). `strip` supplies `stripId` and `flightDataId`.
   */
  recordSystem(op, strip, tail, { flightDataFirst = false } = {}) {
    if (!this._mutationLog) return;
    const flightDataId = strip.flightDataId || null;
    const facilityId = this._rules.facilityId || null;
    this._mutationLog.record({
      clientMutationId: null, op, stripId: strip.stripId,
      ...(flightDataFirst ? { flightDataId, facilityId } : { facilityId, flightDataId }),
      actingPositionId: null, actorId: 'system', at: this._clock.now(),
      ...tail,
    });
  }

  /**
   * @param {object} [extras] the op's own audit keys (the op table's `auditFields`): `head` is spread after `flightDataId`
   *   (before `action`), `tail` after `after` (the keys that used to follow it here), each in the order given.
   */
  recordAudit(mutation, actingPositionId, by, before, result, extras = {}) {
    if (!this._mutationLog || !result.ok) return;
    this._mutationLog.record({
      clientMutationId: mutation.clientMutationId,
      op: mutation.op.kind,
      stripId: result.strip.stripId,
      // Who the entry concerns (docs/adr/0083): the Facility and the flight, so a
      // reader never has to look them up on a Board that may have archived the Strip.
      facilityId: this._rules.facilityId || null,
      flightDataId: result.strip.flightDataId || null,
      // The op kind alone names neither the Block written nor a coordination
      // action (PROPOSE/ACCEPT/REJECT/CANCEL...); the entry says which.
      ...(extras.head || {}),
      ...(typeof mutation.op.action === 'string' ? { action: mutation.op.action } : {}),
      actingPositionId,
      actorId: by || null,
      at: this._clock.now(),
      before,
      after: deepClone(result.strip),
      ...(extras.tail || {}),
    });
  }
}

module.exports = { BoardAudit };
