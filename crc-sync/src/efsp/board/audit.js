'use strict';

// The Board's audit (docs/adr/0095, docs/adr/0083): the Mutation-log entry a client Mutation leaves, and the entry a
// PEER write leaves on this Board. Wording and fields unchanged from board-store.js.

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
      stripId: strip.stripId, fdrId: strip.fdrId || null,
      facilityId: this._rules.facilityId || null, fromFacilityId: fromFacilityId || null,
      actingPositionId: null, actorId: by || null, at: this._clock.now(),
      before, after: deepClone(strip), source: 'peer',
    });
  }

  recordAudit(mutation, actingPositionId, by, before, result) {
    if (!this._mutationLog || !result.ok) return;
    this._mutationLog.record({
      clientMutationId: mutation.clientMutationId,
      op: mutation.op.kind,
      stripId: result.strip.stripId,
      // Who the entry concerns (docs/adr/0083): the Facility and the flight, so a
      // reader never has to look them up on a Board that may have archived the Strip.
      facilityId: this._rules.facilityId || null,
      fdrId: result.strip.fdrId || null,
      // The op kind alone names neither the Block written nor a coordination
      // action (PROPOSE/ACCEPT/REJECT/CANCEL...); the entry says which.
      ...(mutation.op.kind === 'SetBlock' ? { blockId: mutation.op.blockId, value: mutation.op.value } : {}),
      ...(typeof mutation.op.action === 'string' ? { action: mutation.op.action } : {}),
      actingPositionId,
      actorId: by || null,
      at: this._clock.now(),
      before,
      after: deepClone(result.strip),
      // Distinguishes a self-coordinated boundary event from a two-party
      // one (guide §4.8.3 rule 4) — undefined for every op except a
      // successful TransferStrip, where board-store.js computes it.
      selfCoordinated: result.selfCoordinated,
      // The carrier hand-over kind and its trigger type (guide §9.12: "four
      // different trigger types"), so an after-action review can tell them apart.
      carrierTransfer: result.carrierTransfer ? result.carrierTransfer.kind : undefined,
      carrierTrigger: result.carrierTransfer ? result.carrierTransfer.trigger : undefined,
      // The SFA rotation transfer and its trigger type (guide §4.7).
      sfaTransfer: result.sfaTransfer ? result.sfaTransfer.kind : undefined,
      sfaTrigger: result.sfaTransfer ? result.sfaTransfer.trigger : undefined,
      // A gate this Mutation was let past, and why (S-L19 open point, decided in
      // docs/wip/UI-B.md). Undefined, so absent from the line, otherwise.
      bypass: result.bypass,
    });
  }
}

module.exports = { BoardAudit };
