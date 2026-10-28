'use strict';

// Strip<->track correlation (EFSPImplementationGuide.md §6.6) — a FOURTH
// store, peer to FlightDataStore, BoardStore and AirspaceStore.
//
// §6.6 rule 2 is the whole design brief: "Store the correlation as its own
// record with its own history; do not store a raw track ID on the flight data." The
// guide is unusually direct about why — identity reconciliation between the
// flight-data and track domains is a NAMED, MEASURED defect class (defect D1),
// not a join. In the real prototype 100% of Strip selections highlighted their
// target in under a second, and only 85-90% of Strips matched a target at all.
//
// KEYED BY flightDataId, not stripId. One flight data legitimately has several Strips:
// per-Facility replicas (docs/adr/0013), a TOFI MISSION Strip on the same flight data,
// and ConvertToArrival keeping one stripId across a role change
// (docs/adr/0023). A stripId key would let an INCIRLIK replica and its CENTER
// replica hold different answers to "which contact is this airframe" — and two
// answers to an identity question IS the defect class, arriving from inside
// the panel instead of from the track domain. Correlation is a fact about the
// airframe, and the flight data is the airframe (§3.1).
//
// Built on airspace-store.js throughout: own _records Map, per-record rev, own
// _sync seq, setMutationLog, a _recordAudit that logs refusals too, append-only
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
// Obligations (ForwardingObligationMonitor) once lacked exactly this — a
// fire-and-forget alert nothing could retract — and now retract the same way:
// state re-sent whole, cleared by omission (docs/adr/0067).

const { MAX_FREE_TEXT } = require('./flight-data-store');
const { WALL_CLOCK } = require('../mission-clock');
const { SyncedStore } = require('./synced-store');
const log = require('../log').logger('efsp:correlation-store');

const CORRELATION_STATES = ['CORRELATED', 'UNCORRELATED'];

// The ladder, in priority order (§6.6 rule 1; no callsign rung, docs/adr/0142).
const MATCH_KEYS = ['BINDING', 'BEACON'];

const WARNING_KINDS = [
  'TRACK_IDENTITY_LOST',  // the bound contact's id no longer exists
  'TRACK_LOST',           // nothing on any rung matches any more
  'AMBIGUOUS_BEACON',     // several contacts squawk the assigned code
  'CODE_REISSUED',        // the synthetic code now sits on a different AI aircraft (docs/adr/0142)
];

const TRANSITION_REASONS = [
  'FIRST_MATCH', 'REBOUND_ON_BEACON',
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

class CorrelationStore extends SyncedStore {
  /**
   * @param {{flightDataExists?:(flightDataId:string)=>boolean}} [deps] — injected the same
   *   way the Board's `liveStripsForFlightData` rule is (index.js; used by board/strip-ops.js), and for the same reason: this
   *   store has no business reaching into the FlightDataStore, and in index.js's
   *   composition root the stores it would need do not all exist yet.
   */
  constructor({ flightDataExists, clock = WALL_CLOCK, mutationLog = null } = {}) {
    super({ clock, mutationLog });
    this._flightDataExists = flightDataExists || (() => true);
    this._records = new Map(); // flightDataId -> record
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


  _seed(flightDataId) {
    const record = {
      flightDataId,
      // Its own rev, independent of flightData.rev and strip.rev. A correlation
      // changing must not bump either of those: a Strip is broadcast whole on
      // every update (docs/adr/0004), so stamping this onto one would flood
      // the delta ring buffer and invalidate controllers' optimistic edits at
      // reconcile cadence — exactly what §3.1's flight data/Strip split exists to
      // prevent ("every track update invalidates the controller's optimistic
      // edit").
      rev: 0,
      state: INITIAL_STATE,
      // Volatile by design, and nulled on restore: a persisted track id is a
      // lie the instant the process restarts, because DCS re-mints ids.
      trackId: null,
      matchedBy: null,
      binding: null,
      warning: null,
      observedBeacon: null,
      lastMatchedAt: null,
      // Append-only, the shape docs/adr/0032 gave flightData.airspace.transitions and
      // for the same reason: FAA JO 7110.65 para 2-3-1's "do not erase or
      // overwrite any item". Appended only on a CHANGE to state/matchedBy/
      // trackId — never per tick — so a whole flight yields a handful of
      // entries and the array needs no pruning to stay honest.
      transitions: [],
      updatedAt: null,
      updatedBy: null,
    };
    this._records.set(flightDataId, record);
    return record;
  }

  /** The record for the flight data, minted on first ask. */
  _recordFor(flightDataId) {
    return this._records.get(flightDataId) || this._seed(flightDataId);
  }

  getCorrelation(flightDataId) {
    const record = this._records.get(flightDataId);
    return record ? deepClone(record) : null;
  }

  /** Every record — what the client's snapshot carries, one per live flight data. */
  getAll() {
    return [...this._records.values()].map(deepClone);
  }

  /** The contact a flight is CORRELATED to (not lost), or null. A read with no copy: docs/adr/0076's monitor asks per Strip per tick. */
  correlatedTrackId(flightDataId) {
    const record = this._records.get(flightDataId);
    return record && record.state === 'CORRELATED' && record.trackId ? String(record.trackId) : null;
  }

  /**
   * trackId -> { flightDataId, state } for every record bound to a contact, built in
   * one pass with no copying. surveillance/identity.js calls it once per
   * broadcast tick, where getAll()'s deep clone of every record would not do.
   */
  trackIndex() {
    const index = new Map();
    for (const record of this._records.values()) {
      if (record.trackId) index.set(record.trackId, { flightDataId: record.flightDataId, state: record.state });
    }
    return index;
  }

  /** The flight data bound to a contact, or null. Used by the client-side reverse lookup's server-side equivalent. */
  flightDataForTrack(trackId) {
    const wanted = String(trackId);
    for (const record of this._records.values()) {
      if (record.trackId === wanted) return record.flightDataId;
    }
    return null;
  }

  _touch(record, by, transition) {
    this._bump(record);
    record.updatedAt = this._clock.now();
    record.updatedBy = by || null;
    if (transition) {
      record.transitions.push({
        at: record.updatedAt,
        by: by || null,
        state: record.state,
        matchedBy: record.matchedBy,
        trackId: record.trackId,
        fromTrackId: transition.fromTrackId != null ? String(transition.fromTrackId) : null,
        reason: transition.reason,
        detail: capText(transition.detail),
      });
    }
  }

  _recordAudit(mutation, actingPositionId, by, before, result) {
    this._writeAudit(mutation, {
      // No stripId and no airspaceId: a correlation op targets the flight data. A third
      // distinct id field, for the reason airspace-store.js's own audit
      // comment gives — readers key on whichever id is present, rather than
      // one field standing in for something it is not.
      // Theater-wide: the flight data belongs to no Facility (docs/adr/0013, docs/adr/0083).
      subject: { flightDataId: mutation.flightDataId, facilityId: null },
      actingPositionId, by, result, before,
      after: () => this.getCorrelation(mutation.flightDataId),
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
   * @param {{clientMutationId:string, flightDataId:string, baseRev:number, op:{kind:string, trackId?:string, note?:string}}} mutation
   * @param {string} actingPositionId — already verified by efsp-ws.js to be a
   *   Position the calling session is Primary at (docs/adr/0029)
   * @param {string} by — controllerId, for the audit trail
   */
  apply(mutation, actingPositionId, by) {
    if (!mutation.flightDataId) return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no flightDataId' };
    if (!this._flightDataExists(mutation.flightDataId)) {
      const miss = { ok: false, reason: 'NOT_FOUND', detail: `unknown flight data ${mutation.flightDataId}` };
      this._recordAudit(mutation, actingPositionId, by, null, miss);
      return miss;
    }

    const record = this._recordFor(mutation.flightDataId);
    if (mutation.baseRev !== undefined && mutation.baseRev !== null && record.rev !== mutation.baseRev) {
      // Audited like every other refusal. AirspaceStore returns early here
      // without logging, which leaves a rejected ask with no trace anywhere —
      // and "a refusal is the interesting half of an authority model" is the
      // reason this store has an audit hook at all. A deliberate divergence,
      // not an oversight.
      const stale = { ok: false, reason: 'STALE_REV', correlation: this.getCorrelation(mutation.flightDataId) };
      this._recordAudit(mutation, actingPositionId, by, deepClone(record), stale);
      return stale;
    }

    const op = mutation.op || {};
    const before = deepClone(record);
    const result = this._guarded('correlation op', log, () => {
      switch (op.kind) {
        case 'BindTrack':   return this._bind(record, op, actingPositionId, by);
        case 'UnbindTrack': return this._unbind(record, op, actingPositionId, by);
        default:
          return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown correlation op: ${op.kind}` };
      }
    });

    // Every result carries the record, success or not — a rejection that says
    // nothing about current state leaves the client rendering its own guess
    // (airspace-store.js's stated reason).
    if (!result.correlation) result.correlation = this.getCorrelation(mutation.flightDataId);
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
      boundAt: this._clock.now(),
      note: capText(op.note),
    };
    record.trackId = trackId;
    record.matchedBy = 'BINDING';
    record.state = 'CORRELATED';
    record.warning = null;
    record.lastMatchedAt = this._clock.now();
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
    record.state = 'UNCORRELATED';
    record.warning = null;
    this._touch(record, by, { reason: 'EXPLICIT_UNBIND', fromTrackId });
    return { ok: true };
  }

  // ── flight following (H136, docs/wip/LT-VFR.md) ─────────────────────────
  //
  // "Start flight following" and "Radar service terminated" are Board ops (board/ops/start-flight-following.js,
  // terminate-radar-service.js) that also bind or end the contact's correlation, in the same Mutation. The Board
  // audits the whole action (its own entry carries the binding), so these write no correlation audit entry of their
  // own; each returns the changed record for the efsp-correlation-delta that rides the same round trip, or null.

  /**
   * The flight a contact is bound or matched to (CORRELATED), or null: `{ flightDataId, state }`. An
   * explicit binding claims its contact even while the picture does not show it (the reconciler then holds the record
   * UNCORRELATED with the binding kept, until the contact is seen again).
   */
  holderOfTrack(trackId) {
    const wanted = String(trackId);
    for (const record of this._records.values()) {
      if (record.trackId === wanted && record.state !== 'UNCORRELATED') return { flightDataId: record.flightDataId, state: record.state };
    }
    for (const record of this._records.values()) {
      if (record.binding && record.binding.trackId === wanted) return { flightDataId: record.flightDataId, state: record.state };
    }
    return null;
  }

  /** Binds a contact to a flight (rung 1), as BindTrack does. @returns {object} the record */
  bindOnStart(flightDataId, trackId, { actingPositionId = null, by = null, note = null } = {}) {
    const record = this._recordFor(flightDataId);
    this._bind(record, { trackId, note }, actingPositionId, by);
    return this.getCorrelation(flightDataId);
  }

  /** Ends an explicit binding (radar service terminated, or the start undone). @returns {object|null} the record, or null when nothing was bound */
  endBinding(flightDataId, { actingPositionId = null, by = null } = {}) {
    const record = this._records.get(flightDataId);
    if (!record || !record.binding) return null;
    this._unbind(record, {}, actingPositionId, by);
    return this.getCorrelation(flightDataId);
  }

  /** What an undo restores (undo/undo-history.js `correlations`): the explicit binding, or null. */
  bindingImage(flightDataId) {
    const record = this._records.get(flightDataId);
    return record && record.binding ? deepClone(record.binding) : null;
  }

  /**
   * Puts an explicit binding back (an Undo of "Radar service terminated"). Never steals: a contact another flight now
   * holds is left with it. @returns {{record:object|null, warning?:string}}
   */
  restoreBinding(flightDataId, binding, { by = null } = {}) {
    if (!binding || !binding.trackId) return { record: null };
    const holder = this.holderOfTrack(binding.trackId);
    if (holder && holder.flightDataId !== flightDataId) {
      return { record: null, warning: `contact ${binding.trackId} is correlated to another flight now; bind it by hand` };
    }
    const record = this._recordFor(flightDataId);
    if (record.binding && record.binding.trackId === binding.trackId) return { record: null };
    this._bind(record, { trackId: binding.trackId, note: binding.note }, binding.boundPositionId, by);
    return { record: this.getCorrelation(flightDataId) };
  }

  // ── reconciler ──────────────────────────────────────────────────────────

  /**
   * Applies one sweep's resolutions. NOT a Mutation: no actingPositionId, no
   * baseRev, no MutationLog entry — surveillance is not a controller.
   *
   * @param {Map<string, object|null>} resolutions — flightDataId -> a resolution
   *   ({trackId, matchedBy, observedBeacon, warning}) or null for
   *   "nothing matched". A resolution may also be `{warning}` alone.
   * @returns {{changed: object[]}} only the records that actually changed —
   *   what gets broadcast.
   */
  reconcile(resolutions, now = this._clock.now()) {
    const changed = [];

    for (const [flightDataId, resolution] of resolutions) {
      const record = this._recordFor(flightDataId);
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
        record.state = resolution.state;
        record.warning = null;
        record.lastMatchedAt = now;

        const identityChanged = fromTrackId && fromTrackId !== record.trackId;
        if (before.state !== record.state || before.matchedBy !== record.matchedBy || before.trackId !== record.trackId) {
          this._touch(record, null, {
            reason: this._matchReason(before, record, identityChanged, hadWarning),
            fromTrackId: identityChanged ? fromTrackId : null,
          });
          changed.push(this.getCorrelation(flightDataId));
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
            this._bump(record);
            record.updatedAt = now;
          }
          changed.push(this.getCorrelation(flightDataId));
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
          this._bump(record);
          record.updatedAt = now;
        }
        changed.push(this.getCorrelation(flightDataId));
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
    if (identityChanged && record.matchedBy === 'BEACON') return 'REBOUND_ON_BEACON';
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
  resetPicture(reason, now = this._clock.now()) {
    const changed = [];
    for (const record of this._records.values()) {
      const lostTrackId = record.trackId;
      const hadSomething = record.state !== 'UNCORRELATED' || record.binding || record.warning;
      if (!hadSomething) continue;
      record.trackId = null;
      record.matchedBy = null;
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
      changed.push(this.getCorrelation(record.flightDataId));
    }
    return { changed };
  }

  /**
   * Forgets records for flights that are over.
   *
   * `releaseFlightData` does not delete the flight data — it only frees the beacon code — so
   * the flight data with nothing but DROPPED Strips lives forever, and its correlation
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
   * @param {Set<string>} flightDataIdsWithLiveStrips
   * @returns {string[]} the flightDataIds retired
   */
  retireFinished(flightDataIdsWithLiveStrips) {
    const retired = [];
    for (const flightDataId of [...this._records.keys()]) {
      if (flightDataIdsWithLiveStrips.has(flightDataId)) continue;
      this._records.delete(flightDataId);
      retired.push(flightDataId);
    }
    return retired;
  }

  /**
   * The mission reset (docs/adr/0108): every record and binding goes. The flights they were about ended with their Strips.
   * The sequence moves once, so a client whose seq differs resyncs even though the delta has nothing to update.
   * @returns {number} the records forgotten
   */
  forgetAll() {
    const n = this._records.size;
    if (!n) return 0;
    this._records.clear();
    this._sync.advance();
    return n;
  }

  /** Forgets records whose flight data is gone — flight data lifecycle governs correlation lifecycle, with no separate retention policy. */
  evictMissingFlightDataList() {
    let dropped = 0;
    for (const flightDataId of [...this._records.keys()]) {
      if (!this._flightDataExists(flightDataId)) { this._records.delete(flightDataId); dropped += 1; }
    }
    return dropped;
  }

  // ── Persistence (durable per docs/adr/0002) ─────────────────────────────

  snapshot() {
    return [...this._records.values()].filter(r => this._flightDataExists(r.flightDataId)).map(deepClone);
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
      if (!saved || !saved.flightDataId) continue;
      if (!this._flightDataExists(saved.flightDataId)) continue; // its flight data is gone
      const record = deepClone(saved);
      record.trackId = null;
      record.matchedBy = null;
      delete record.confidence; // a pre-docs/adr/0142 snapshot's key (the fuzzy callsign rung's score)
      record.binding = null;
      record.observedBeacon = null;
      record.state = 'UNCORRELATED';
      record.warning = null;
      record.transitions = Array.isArray(record.transitions) ? record.transitions : [];
      this._records.set(record.flightDataId, record);
    }
  }
}

module.exports = {
  CorrelationStore,
  MATCH_KEYS, TRANSITION_REASONS, INITIAL_STATE,
};
