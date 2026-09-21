'use strict';

// Strip<->track correlation (EFSPImplementationGuide.md §6.6) — a FOURTH
// store, peer to FdrStore, BoardStore and AirspaceStore.
//
// §6.6 rule 2 is the whole design brief: "Store the correlation as its own
// record with its own history; do not store a raw track ID on the FDR." The
// guide is unusually direct about why — identity reconciliation between the
// flight-data and track domains is a NAMED, MEASURED defect class (defect D1),
// not a join. In the real prototype 100% of Strip selections highlighted their
// target in under a second, and only 85-90% of Strips matched a target at all.
//
// KEYED BY fdrId, not stripId. One FDR legitimately has several Strips:
// per-Facility replicas (docs/adr/0013), a TOFI MISSION Strip on the same FDR,
// and ConvertToArrival keeping one stripId across a role change
// (docs/adr/0023). A stripId key would let an INCIRLIK replica and its CENTER
// replica hold different answers to "which contact is this airframe" — and two
// answers to an identity question IS the defect class, arriving from inside
// the panel instead of from the track domain. Correlation is a fact about the
// airframe, and the FDR is the airframe (§3.1).
//
// Built on airspace-store.js throughout: own _records Map, per-record rev, own
// _seq, setMutationLog, a _recordAudit that logs refusals too, append-only
// transitions[], one never-throwing entry point, and snapshot/restore that
// skip records which no longer resolve.
//
// THE WARNING IS A FIELD, NOT AN EVENT — and that is deliberate. §6.6 rule 3
// says a track identity change "MUST NOT silently break the binding. It MUST
// either re-bind on the beacon code or raise an uncorrelated warning". Raising
// is easy; RETRACTING is what needs a shape. `record.warning` is set when a
// match is lost and set back to null on the next successful match, and since
// the record arrives whole in every delta, retraction needs no new mechanism
// at all — the next delta simply carries `warning: null`. Nothing is erased:
// the raise AND the retraction both sit in transitions[].
//
// This is deliberately NOT the obligation-alert shape. ForwardingObligation-
// Monitor cannot retract, because an alert is a fire-and-forget broadcast with
// no record behind it to update — efsp-state.js's own comment admits as much
// ("the server never retracts an alert once raised this slice"). Do not copy
// that here.

const { MAX_FREE_TEXT } = require('./fdr-store');

const CORRELATION_STATES = ['CORRELATED', 'PROVISIONAL', 'UNCORRELATED'];

// The ladder, in priority order (§6.6 rule 1).
const MATCH_KEYS = ['BINDING', 'BEACON', 'CALLSIGN_EXACT', 'CALLSIGN_FUZZY'];

const WARNING_KINDS = [
  'TRACK_IDENTITY_LOST',  // the bound contact's id no longer exists
  'TRACK_LOST',           // nothing on any rung matches any more
  'AMBIGUOUS_BEACON',     // several contacts squawk the assigned code
  'AMBIGUOUS_CALLSIGN',   // several contacts answer to the callsign
];

const TRANSITION_REASONS = [
  'FIRST_MATCH', 'REBOUND_ON_BEACON', 'REBOUND_ON_CALLSIGN',
  'EXPLICIT_BIND', 'EXPLICIT_UNBIND',
  'TRACK_GONE', 'MISSION_RELOAD', 'AMBIGUOUS',
  'WARNING_RETRACTED', 'DEGRADED', 'PROMOTED',
];

const INITIAL_STATE = 'UNCORRELATED';

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function capText(value) {
  if (value == null) return null;
  const s = String(value);
  return s.length > MAX_FREE_TEXT ? s.slice(0, MAX_FREE_TEXT) : s;
}

class CorrelationStore {
  /**
   * @param {{fdrExists?:(fdrId:string)=>boolean}} [deps] — injected the same
   *   way board-store.js's liveStripsForFdr is, and for the same reason: this
   *   store has no business reaching into the FdrStore, and in index.js's
   *   composition root the stores it would need do not all exist yet.
   */
  constructor({ fdrExists } = {}) {
    this._fdrExists = fdrExists || (() => true);
    this._records = new Map(); // fdrId -> record
    this._seq = 0;
    this._mutationLog = null;
  }

  /**
   * Same wiring BoardStore and AirspaceStore have. What it records is what a
   * CONTROLLER asked for, refusals included — a refused BindTrack leaves no
   * transition at all, so without this it would leave no trace anywhere.
   *
   * Reconciler-driven changes are deliberately NOT logged here: at one tick a
   * second, re-binds would drown the log. Where the correlation has BEEN lives
   * in the record's own transitions[]. Same split airspace-store.js documents.
   */
  setMutationLog(mutationLog) { this._mutationLog = mutationLog; }

  get currentSeq() { return this._seq; }

  _seed(fdrId) {
    const record = {
      fdrId,
      // Its own rev, independent of fdr.rev and strip.rev. A correlation
      // changing must not bump either of those: a Strip is broadcast whole on
      // every update (docs/adr/0004), so stamping this onto one would flood
      // the delta ring buffer and invalidate controllers' optimistic edits at
      // reconcile cadence — exactly what §3.1's FDR/Strip split exists to
      // prevent ("every track update invalidates the controller's optimistic
      // edit").
      rev: 0,
      state: INITIAL_STATE,
      // Volatile by design, and nulled on restore: a persisted track id is a
      // lie the instant the process restarts, because DCS re-mints ids.
      trackId: null,
      matchedBy: null,
      confidence: null,
      binding: null,
      warning: null,
      observedBeacon: null,
      lastMatchedAt: null,
      // Append-only, the shape docs/adr/0032 gave fdr.airspace.transitions and
      // for the same reason: FAA JO 7110.65 para 2-3-1's "do not erase or
      // overwrite any item". Appended only on a CHANGE to state/matchedBy/
      // trackId — never per tick — so a whole flight yields a handful of
      // entries and the array needs no pruning to stay honest.
      transitions: [],
      updatedAt: null,
      updatedBy: null,
    };
    this._records.set(fdrId, record);
    return record;
  }

  /** The record for an FDR, minted on first ask. */
  _recordFor(fdrId) {
    return this._records.get(fdrId) || this._seed(fdrId);
  }

  getCorrelation(fdrId) {
    const record = this._records.get(fdrId);
    return record ? deepClone(record) : null;
  }

  /** Every record — what the client's snapshot carries, one per live FDR. */
  getAll() {
    return [...this._records.values()].map(deepClone);
  }

  /** The FDR bound to a contact, or null. Used by the client-side reverse lookup's server-side equivalent. */
  fdrForTrack(trackId) {
    const wanted = String(trackId);
    for (const record of this._records.values()) {
      if (record.trackId === wanted) return record.fdrId;
    }
    return null;
  }

  _touch(record, by, transition) {
    record.rev += 1;
    record.updatedAt = Date.now();
    record.updatedBy = by || null;
    this._seq += 1;
    if (transition) {
      record.transitions.push({
        at: record.updatedAt,
        by: by || null,
        state: record.state,
        matchedBy: record.matchedBy,
        trackId: record.trackId,
        fromTrackId: transition.fromTrackId != null ? String(transition.fromTrackId) : null,
        confidence: record.confidence,
        reason: transition.reason,
        detail: capText(transition.detail),
      });
    }
  }

  _recordAudit(mutation, actingPositionId, by, before, result) {
    if (!this._mutationLog) return;
    this._mutationLog.record({
      clientMutationId: mutation.clientMutationId,
      op: mutation.op && mutation.op.kind,
      // No stripId and no airspaceId: a correlation op targets an FDR. A third
      // distinct id field, for the reason airspace-store.js's own audit
      // comment gives — readers key on whichever id is present, rather than
      // one field standing in for something it is not.
      fdrId: mutation.fdrId,
      actingPositionId,
      actorId: by || null,
      at: Date.now(),
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      detail: result.ok ? undefined : result.detail,
      before,
      after: result.ok ? this.getCorrelation(mutation.fdrId) : undefined,
    });
  }

  // ── controller ops ──────────────────────────────────────────────────────
  //
  // Exactly two: BindTrack and UnbindTrack. An explicit binding is rung 1 of
  // §6.6's ladder and outranks everything the reconciler can work out, which
  // is the point of having it — an aircraft with its transponder off and a
  // callsign nothing matches is still a contact the controller can see.

  /**
   * The one entry point for a controller-driven correlation op, mirroring
   * AirspaceStore.apply: never throws, always returns a result the caller can
   * turn into an ack. Optimistic concurrency on the record's own rev.
   *
   * @param {{clientMutationId:string, fdrId:string, baseRev:number, op:{kind:string, trackId?:string, note?:string}}} mutation
   * @param {string} actingPositionId — already verified by efsp-ws.js to be a
   *   Position the calling session is Primary at (docs/adr/0029)
   * @param {string} by — controllerId, for the audit trail
   */
  apply(mutation, actingPositionId, by) {
    if (!mutation.fdrId) return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no fdrId' };
    if (!this._fdrExists(mutation.fdrId)) {
      const miss = { ok: false, reason: 'NOT_FOUND', detail: `unknown FDR ${mutation.fdrId}` };
      this._recordAudit(mutation, actingPositionId, by, null, miss);
      return miss;
    }

    const record = this._recordFor(mutation.fdrId);
    if (mutation.baseRev !== undefined && mutation.baseRev !== null && record.rev !== mutation.baseRev) {
      // Audited like every other refusal. AirspaceStore returns early here
      // without logging, which leaves a rejected ask with no trace anywhere —
      // and "a refusal is the interesting half of an authority model" is the
      // reason this store has an audit hook at all. A deliberate divergence,
      // not an oversight.
      const stale = { ok: false, reason: 'STALE_REV', correlation: this.getCorrelation(mutation.fdrId) };
      this._recordAudit(mutation, actingPositionId, by, deepClone(record), stale);
      return stale;
    }

    const op = mutation.op || {};
    const before = deepClone(record);
    let result;
    try {
      switch (op.kind) {
        case 'BindTrack':   result = this._bind(record, op, actingPositionId, by); break;
        case 'UnbindTrack': result = this._unbind(record, op, actingPositionId, by); break;
        default:
          result = { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown correlation op: ${op.kind}` };
      }
    } catch (err) {
      // Same backstop BoardStore and AirspaceStore have: one bad op must never
      // take the process down for every connected client.
      console.error('[correlation-store] unexpected error applying a correlation op — rejecting it instead of crashing:', err);
      result = { ok: false, reason: 'VALIDATION_ERROR', detail: 'internal error processing correlation op' };
    }

    // Every result carries the record, success or not — a rejection that says
    // nothing about current state leaves the client rendering its own guess
    // (airspace-store.js's stated reason).
    if (!result.correlation) result.correlation = this.getCorrelation(mutation.fdrId);
    this._recordAudit(mutation, actingPositionId, by, before, result);
    return result;
  }

  _bind(record, op, actingPositionId, by) {
    const trackId = op.trackId != null ? String(op.trackId) : '';
    if (!trackId) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'BindTrack needs a trackId' };
    }
    const fromTrackId = record.trackId;
    record.binding = {
      trackId,
      boundBy: by || null,
      boundPositionId: actingPositionId || null,
      boundAt: Date.now(),
      note: capText(op.note),
    };
    record.trackId = trackId;
    record.matchedBy = 'BINDING';
    record.confidence = null;
    record.state = 'CORRELATED';
    record.warning = null;
    record.lastMatchedAt = Date.now();
    this._touch(record, by, { reason: 'EXPLICIT_BIND', fromTrackId });
    return { ok: true };
  }

  _unbind(record, op, actingPositionId, by) {
    if (!record.binding) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'nothing is explicitly bound' };
    }
    const fromTrackId = record.trackId;
    record.binding = null;
    // Dropped to UNCORRELATED rather than guessing a lower rung here: the next
    // reconcile tick is a second away and is the thing that knows what the
    // live picture contains. Leaving a stale trackId behind would be the
    // silent break §6.6 rule 3 forbids.
    record.trackId = null;
    record.matchedBy = null;
    record.confidence = null;
    record.state = 'UNCORRELATED';
    record.warning = null;
    this._touch(record, by, { reason: 'EXPLICIT_UNBIND', fromTrackId });
    return { ok: true };
  }

  // ── reconciler ──────────────────────────────────────────────────────────

  /**
   * Applies one sweep's resolutions. NOT a Mutation: no actingPositionId, no
   * baseRev, no MutationLog entry — surveillance is not a controller.
   *
   * @param {Map<string, object|null>} resolutions — fdrId -> a resolution
   *   ({trackId, matchedBy, confidence, observedBeacon, warning}) or null for
   *   "nothing matched". A resolution may also be `{warning}` alone.
   * @returns {{changed: object[]}} only the records that actually changed —
   *   what gets broadcast.
   */
  reconcile(resolutions, now = Date.now()) {
    const changed = [];

    for (const [fdrId, resolution] of resolutions) {
      const record = this._recordFor(fdrId);
      const before = {
        state: record.state, matchedBy: record.matchedBy, trackId: record.trackId,
        warningKind: record.warning ? record.warning.kind : null,
        observedBeacon: record.observedBeacon,
      };

      const observedBeacon = resolution ? (resolution.observedBeacon || null) : null;
      record.observedBeacon = observedBeacon;

      if (resolution && resolution.trackId) {
        // The contact we were on, which may have been cleared a tick ago when
        // the match was lost. Falling back to the warning's `lostTrackId`
        // matters: without it a re-bind that passed through an intermediate
        // UNCORRELATED tick reads as a FIRST_MATCH, and the identity change —
        // the whole thing §6.6 rule 3 is about — becomes invisible in the
        // history. That is the silent break, relocated into the audit trail.
        const fromTrackId = record.trackId
          || (record.warning && record.warning.lostTrackId)
          || null;
        const hadWarning = !!record.warning;
        record.trackId = String(resolution.trackId);
        record.matchedBy = resolution.matchedBy;
        record.confidence = resolution.confidence != null ? resolution.confidence : null;
        record.state = resolution.state;
        record.warning = null;
        record.lastMatchedAt = now;

        const identityChanged = fromTrackId && fromTrackId !== record.trackId;
        if (before.state !== record.state || before.matchedBy !== record.matchedBy || before.trackId !== record.trackId) {
          this._touch(record, null, {
            reason: this._matchReason(before, record, identityChanged, hadWarning),
            fromTrackId: identityChanged ? fromTrackId : null,
          });
          changed.push(this.getCorrelation(fdrId));
          continue;
        }
        // Nothing about the identity changed, but the warning may have been
        // retracted or the observed code may have moved — both are visible to
        // a controller, so both are a change worth broadcasting even though
        // they are not a transition.
        if (hadWarning || before.observedBeacon !== observedBeacon) {
          if (hadWarning) {
            this._touch(record, null, { reason: 'WARNING_RETRACTED', fromTrackId: null });
          } else {
            record.rev += 1;
            record.updatedAt = now;
            this._seq += 1;
          }
          changed.push(this.getCorrelation(fdrId));
        }
        continue;
      }

      // Nothing matched. Losing a binding or a match is exactly the case §6.6
      // rule 3 is about, so it is never silent: the state drops and a warning
      // is raised naming why.
      const warning = (resolution && resolution.warning) || null;
      const lostTrackId = record.trackId;
      const wasCorrelated = record.state !== 'UNCORRELATED';
      record.trackId = null;
      record.matchedBy = null;
      record.confidence = null;
      record.state = 'UNCORRELATED';
      record.warning = warning
        ? { ...warning, raisedAt: now, lostTrackId: lostTrackId || null, detail: capText(warning.detail) }
        : null;

      const warningChanged = (record.warning ? record.warning.kind : null) !== before.warningKind;
      if (wasCorrelated || warningChanged || before.observedBeacon !== observedBeacon) {
        if (wasCorrelated || warningChanged) {
          this._touch(record, null, {
            reason: warning && warning.kind.startsWith('AMBIGUOUS') ? 'AMBIGUOUS' : 'TRACK_GONE',
            fromTrackId: lostTrackId,
            detail: warning ? warning.detail : null,
          });
        } else {
          record.rev += 1;
          record.updatedAt = now;
          this._seq += 1;
        }
        changed.push(this.getCorrelation(fdrId));
      }
    }

    return { changed };
  }

  /**
   * Order matters here. A re-bind outranks a retraction, because an identity
   * change is the fact worth reading; a retraction outranks a first match,
   * because coming back to the SAME contact after a warning is not a first
   * sighting even though the intervening tick cleared the field.
   */
  _matchReason(before, record, identityChanged, hadWarning) {
    if (identityChanged) {
      return record.matchedBy === 'BEACON' ? 'REBOUND_ON_BEACON' : 'REBOUND_ON_CALLSIGN';
    }
    if (hadWarning) return 'WARNING_RETRACTED';
    if (!before.trackId) return 'FIRST_MATCH';
    // Same contact, different rung: either the evidence improved or it decayed.
    const rankBefore = MATCH_KEYS.indexOf(before.matchedBy);
    const rankAfter = MATCH_KEYS.indexOf(record.matchedBy);
    return rankAfter < rankBefore ? 'PROMOTED' : 'DEGRADED';
  }

  /**
   * The theater's contacts were all re-minted — a DCS mission reload, which is
   * defect D1 in its most brutal form: nothing about any airframe changed, and
   * every track id did.
   *
   * Every record drops to UNCORRELATED with TRACK_IDENTITY_LOST, and the
   * explicit bindings are dropped with them. Dropping the binding is the
   * load-bearing call: it named a SPECIFIC contact which provably no longer
   * exists, and keeping it would let the reconciler prefer a dead id over a
   * live beacon match — the silent break itself. §6.6 rule 3 permits exactly
   * two outcomes and this does both in sequence within one tick: warn
   * immediately, re-bind on the beacon next tick.
   */
  resetPicture(reason, now = Date.now()) {
    const changed = [];
    for (const record of this._records.values()) {
      const lostTrackId = record.trackId;
      const hadSomething = record.state !== 'UNCORRELATED' || record.binding || record.warning;
      if (!hadSomething) continue;
      record.trackId = null;
      record.matchedBy = null;
      record.confidence = null;
      record.binding = null;
      record.state = 'UNCORRELATED';
      record.observedBeacon = null;
      record.warning = {
        kind: 'TRACK_IDENTITY_LOST',
        raisedAt: now,
        lostTrackId: lostTrackId || null,
        detail: capText(reason === 'MISSION_RELOAD'
          ? 'mission reload — every track id was re-minted'
          : reason),
      };
      this._touch(record, null, {
        reason: reason === 'MISSION_RELOAD' ? 'MISSION_RELOAD' : 'TRACK_GONE',
        fromTrackId: lostTrackId,
        detail: record.warning.detail,
      });
      changed.push(this.getCorrelation(record.fdrId));
    }
    return { changed };
  }

  /**
   * Forgets records for flights that are over.
   *
   * `releaseFdr` does not delete the FDR — it only frees the beacon code — so
   * an FDR with nothing but DROPPED Strips lives forever, and its correlation
   * record used to live with it: never swept again (eligibility needs a live
   * Strip), stuck at whatever it last was, still carrying a `trackId` for a
   * contact the flight has no claim on, and still sent in every snapshot. Over
   * a long session that grows without bound.
   *
   * Retired rather than cleared, because the flight is finished rather than
   * lost: a warning would say something is wrong when nothing is. What a
   * controller did survives in the Mutation log, which is where "who bound
   * what" belongs anyway.
   *
   * @param {Set<string>} fdrIdsWithLiveStrips
   * @returns {string[]} the fdrIds retired
   */
  retireFinished(fdrIdsWithLiveStrips) {
    const retired = [];
    for (const fdrId of [...this._records.keys()]) {
      if (fdrIdsWithLiveStrips.has(fdrId)) continue;
      this._records.delete(fdrId);
      retired.push(fdrId);
    }
    return retired;
  }

  /** Forgets records whose FDR is gone — FDR lifecycle governs correlation lifecycle, with no separate retention policy. */
  evictMissingFdrs() {
    let dropped = 0;
    for (const fdrId of [...this._records.keys()]) {
      if (!this._fdrExists(fdrId)) { this._records.delete(fdrId); dropped += 1; }
    }
    return dropped;
  }

  // ── Persistence (durable per docs/adr/0002) ─────────────────────────────

  snapshot() {
    return [...this._records.values()].filter(r => this._fdrExists(r.fdrId)).map(deepClone);
  }

  /**
   * A persisted track id is a lie the moment the process restarts, because DCS
   * re-mints ids. So every record comes back UNCORRELATED with its trackId and
   * its binding's trackId nulled, and transitions[] intact.
   *
   * An explicit binding therefore does NOT survive a restart, which is
   * correct: it was a statement about a contact on a scope that no longer
   * exists. That it happened is preserved in the history; the claim that it is
   * still true is not.
   */
  restore(data) {
    for (const saved of data || []) {
      if (!saved || !saved.fdrId) continue;
      if (!this._fdrExists(saved.fdrId)) continue; // its FDR is gone
      const record = deepClone(saved);
      record.trackId = null;
      record.matchedBy = null;
      record.confidence = null;
      record.binding = null;
      record.observedBeacon = null;
      record.state = 'UNCORRELATED';
      record.warning = null;
      record.transitions = Array.isArray(record.transitions) ? record.transitions : [];
      this._records.set(record.fdrId, record);
    }
  }
}

module.exports = {
  CorrelationStore,
  CORRELATION_STATES, MATCH_KEYS, WARNING_KINDS, TRANSITION_REASONS, INITIAL_STATE,
};
