'use strict';

// MARSA — "Military Authority Assumes Responsibility for Separation of
// Aircraft" (EFSPImplementationGuide.md §9.2). A FIFTH store, peer to
// FlightDataStore, BoardStore, AirspaceStore and CorrelationStore.
//
// §9.2's title is the whole design brief: "model it as an edge, not a flag."
// MARSA is a stateful RELATIONSHIP between two or more flights, with a
// declaring party, a start event, an end condition and auto-void conditions.
// A boolean on each participant's flight data would be the flag that section refuses:
// nothing would say who else is in it, nothing could void it as a unit, and
// two participants could disagree about whether they were in the same relation
// at all.
//
// KEYED BY marsaId; PARTICIPANTS ARE flightDataIds, NEVER stripIds — the same call
// docs/adr/0045 made for correlation, for the same reason. One flight's flight data
// legitimately has several Strips (per-Facility replicas docs/adr/0013, a TOFI
// MISSION Strip on the same flight data docs/adr/0025, an arrival converted in place
// docs/adr/0023), and they are all one airframe. A stripId participant list
// would let a tanker's INCIRLIK replica be in the relation while its CENTER
// replica was not — two answers to "is this aircraft separating itself",
// which is the defect class arriving from inside the panel.
//
// THE INTERLOCK VOIDS, IT DOES NOT REFUSE. §9.2 rule 2 — "issuing a course or
// altitude change prior to rendezvous automatically voids MARSA" — is the
// highest-value single military interlock the guide names, and the direction
// matters: the controller's clearance goes through, and the relation ends.
// Refusing the SetBlock would be exactly backwards. A controller who needs to
// turn or climb a joining aircraft must be able to, immediately; what must not
// happen is that they do it while still believing the military is separating
// the pair. So the assignment applies and MARSA voids under it, which is the
// conservative direction: ATC re-assumes separation.
//
// THE ALERT IS A FIELD ON A RECORD, NOT AN EVENT. §9.2 rule 2 also requires
// the void to "alert every participant Strip". `voidedBy`/`voidedDetail` live
// on the relation, which is broadcast whole on every change, so every
// participant Strip renders the alert with no per-Strip fan-out and no
// separate retraction mechanism — docs/adr/0045's shape. Before L7 (decisions
// H39) forwarding-obligations.js's alert was fire-and-forget and could not
// retract; since L7 an obligation leaves the set when its condition clears.
// A relation is state in the same way: the badge goes when the relation does.
//
// Built on airspace-store.js and correlation-store.js throughout: own
// _relations Map, per-record rev, own _sync seq, setMutationLog, a _recordAudit
// that logs refusals too, append-only transitions[], one never-throwing entry
// point, and snapshot/restore that skip records which no longer resolve.

const crypto = require('crypto');

const { MAX_FREE_TEXT } = require('./flight-data-store');
const { WALL_CLOCK } = require('../mission-clock');
const { SyncedStore } = require('./synced-store');
const log = require('../log').logger('efsp:marsa-store');

const MARSA_STATES = ['ACTIVE', 'ENDED', 'VOIDED'];

// §9.2's own MarsaRelation schema, verbatim.
const START_EVENTS = ['TANKER_ACCEPTED', 'MTR_ENTRY', 'LOCAL_DECLARATION'];
const END_CONDITIONS = ['VERTICALLY_POSITIONED', 'MTR_COMPLETE', 'ATC_SEPARATION_ESTABLISHED'];
const VOID_CAUSES = ['CONTROLLER_COURSE_CHANGE', 'CONTROLLER_ALTITUDE_CHANGE', 'MANUAL'];

// NOT in §9.2's schema, which carries `endedAt` with no "why" beside it. Three
// different things end a relation and an after-action review cannot tell them
// apart from a timestamp alone: the end condition was met, a controller ended
// it by hand, or the last participants went home. `voidedBy` already
// distinguishes the void causes; this does the same for the non-void ends.
const END_CAUSES = ['END_CONDITION', 'PARTICIPANT_RETIRED'];

// §9.2 rule 6 — "Use the Pilot/Controller Glossary expansion in UI text."
// Exported so the client renders this string rather than a second hand-typed
// copy that can drift from it.
const MARSA_EXPANSION = 'Military Authority Assumes Responsibility for Separation of Aircraft';

// A relation between one aircraft is not a relation — §9.2: "between two or
// more Strips."
const MIN_PARTICIPANTS = 2;

const TRANSITION_REASONS = [
  'DECLARED', 'RENDEZVOUS', 'PARTICIPANT_ADDED', 'PARTICIPANT_REMOVED',
  'ENDED', 'VOIDED', 'VOID_ACKNOWLEDGED',
];

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function capText(value) {
  if (value == null) return null;
  const s = String(value);
  return s.length > MAX_FREE_TEXT ? s.slice(0, MAX_FREE_TEXT) : s;
}

class MarsaStore extends SyncedStore {
  /**
   * @param {object} [deps]
   * @param {(flightDataId:string)=>boolean} [deps.flightDataExists]
   * @param {(flightDataId:string, regime:string|null, opts:{by?:string})=>object} [deps.setSeparationRegime]
   *   — writes flightData.tofi.separationRegime. Injected rather than reached for, the
   *   same way correlation-store.js takes flightDataExists and the Board's rules
   *   take `liveStripsForFlightData` (index.js): this store has no business holding a FlightDataStore, and in
   *   index.js's composition root the stores it would need do not all exist
   *   yet.
   *
   *   Why it writes the regime at all, rather than letting the client derive it
   *   from the relation: guide §4.6.3 models `separation_regime` as one of
   *   three INDEPENDENT fields on the flight, and §4.8.3 is explicit that a
   *   flight entering the block "genuinely changes" it — "ATC stops separating
   *   participants ... MARSA takes over", and "if a second controller takes
   *   TAC_C2 ten minutes later, the state must already be correct, or they
   *   inherit a lie." A relation that left the field alone would BE that lie.
   *   The other half of keeping the two agreed is board/ops/set-block.js refusing a
   *   direct SREG write while an ACTIVE relation holds the flight data.
   */
  constructor({ flightDataExists, setSeparationRegime, clock = WALL_CLOCK, mutationLog = null } = {}) {
    super({ clock, mutationLog });
    this._flightDataExists = flightDataExists || (() => true);
    this._setSeparationRegime = setSeparationRegime || (() => ({ ok: true }));
    this._relations = new Map(); // marsaId -> relation
    // The flight data _applyRegime wrote during the op currently being applied, for
    // the caller to drain and broadcast. See drainRegimeWrites().
    this._regimeWrites = [];
  }

  /**
   * The flight data whose `tofi.separationRegime` this store wrote during the op just
   * applied, most recent value per flight data, and clears the list.
   *
   * It exists because the write was invisible. Declaring a relation writes
   * MARSA on every participant and ending or voiding one writes ATC back, and
   * none of that reached a single connected client: the marsa-delta carries the
   * RELATION, and flight data rides an efsp-board-delta. So SEP REG stayed blank on
   * every already-connected page until it next took a full snapshot, and only
   * someone who reconnected saw the truth — §4.8.3's "they inherit a lie", in
   * the direction it warns about (docs/ui-findings/lane1.md F-111).
   *
   * Drained rather than returned from each op because a regime write happens
   * six call sites deep in three different lifecycle paths (declare, add/remove
   * participant, end/void, interlock void, participant retired), and threading
   * a return value through all of them would be more bookkeeping than one
   * journal that every public entry point clears on the way in.
   *
   * @returns {object[]} flight data records, deduplicated by flightDataId
   */
  drainRegimeWrites() {
    const byId = new Map();
    for (const flightData of this._regimeWrites) if (flightData && flightData.flightDataId) byId.set(flightData.flightDataId, flightData);
    this._regimeWrites = [];
    return [...byId.values()];
  }


  getRelation(marsaId) {
    const relation = this._relations.get(marsaId);
    return relation ? deepClone(relation) : null;
  }

  /** Every relation, live and finished — what the client's snapshot carries. */
  getAll() {
    return [...this._relations.values()].map(deepClone);
  }

  /**
   * The ACTIVE relation this flight is in, or null. At most one, enforced by
   * _declare and _addParticipant below — "one flight, one answer"
   * (docs/adr/0050's phrase), which is also what makes the auto-void and the
   * SREG refusal decidable with no tiebreak.
   */
  activeFor(flightDataId) {
    for (const relation of this._relations.values()) {
      if (relation.state === 'ACTIVE' && relation.participants.includes(flightDataId)) return deepClone(relation);
    }
    return null;
  }

  /** Every relation this flight has been in, live or finished. */
  allFor(flightDataId) {
    return [...this._relations.values()].filter(r => r.participants.includes(flightDataId)).map(deepClone);
  }

  _touch(relation, by, transition) {
    this._bump(relation);
    relation.updatedAt = this._clock.now();
    relation.updatedBy = by || null;
    if (transition) {
      relation.transitions.push({
        at: relation.updatedAt,
        by: by || null,
        state: relation.state,
        participants: [...relation.participants],
        reason: transition.reason,
        detail: capText(transition.detail),
      });
    }
  }

  _auditFlightDataIds(mutation, result, before) {
    const op = mutation.op || {};
    const ids = new Set();
    for (const rel of [result.relation, before]) {
      for (const id of (rel && rel.participants) || []) ids.add(id);
    }
    for (const id of Array.isArray(op.participants) ? op.participants : []) ids.add(String(id));
    if (op.flightDataId != null) ids.add(String(op.flightDataId));
    return [...ids].filter(Boolean);
  }

  _recordAudit(mutation, actingPositionId, by, before, result) {
    this._writeAudit(mutation, {
      // Its own id field, not stripId/flightDataId/airspaceId — a MARSA op targets a
      // relation BETWEEN several flights, so no single one of those names it.
      // The reasoning airspace-store.js's own audit comment gives for adding
      // airspaceId rather than letting stripId stand in for something it is
      // not: readers key on whichever id is present.
      // Theater-wide (docs/adr/0013); the flights it concerns are named instead
      // (docs/adr/0083): the relation's participants, or the op's own.
      subject: {
        marsaId: (result.relation && result.relation.marsaId) || mutation.marsaId || null,
        facilityId: null,
        flightDataIds: this._auditFlightDataIds(mutation, result, before),
      },
      actingPositionId, by, result, before,
      after: () => (result.relation ? deepClone(result.relation) : undefined),
    });
  }

  // ── controller ops ──────────────────────────────────────────────────────

  /**
   * The one entry point for a controller-driven MARSA op, mirroring
   * AirspaceStore.apply and CorrelationStore.apply: never throws, always
   * returns a result the caller can turn into an ack. Optimistic concurrency on
   * the relation's own rev.
   *
   * @param {{clientMutationId:string, marsaId?:string, baseRev?:number, op:object}} mutation
   * @param {string} actingPositionId — already verified by the wire gate (wire/skeleton.js) to be a
   *   Position the calling session is Primary at (docs/adr/0029)
   * @param {string} by — controllerId, for the audit trail
   */
  apply(mutation, actingPositionId, by) {
    const op = mutation.op || {};
    // Nothing from a previous op may ride out on this one's result.
    this._regimeWrites = [];

    // DeclareMarsa mints the relation, so it has no marsaId to look up and no
    // baseRev to check — the same shape CreateStrip has in board/strip-ops.js's
    // `dispatch`, handled before the record lookup rather than inside it.
    if (op.kind === 'DeclareMarsa') {
      const result = this._guarded('MARSA declaration', log, () => this._declare(op, actingPositionId, by));
      // The relation it minted before a throw is the newest one (a Map keeps insertion order).
      if (result.partial) result.relation = this.getRelation([...this._relations.keys()].pop());
      if (result.ok || result.partial) result.flightDataList = this.drainRegimeWrites();
      this._recordAudit(mutation, actingPositionId, by, null, result);
      return result;
    }

    const relation = this._relations.get(mutation.marsaId);
    if (!relation) {
      const miss = { ok: false, reason: 'NOT_FOUND', detail: `unknown MARSA relation ${mutation.marsaId}` };
      this._recordAudit(mutation, actingPositionId, by, null, miss);
      return miss;
    }
    if (mutation.baseRev !== undefined && mutation.baseRev !== null && relation.rev !== mutation.baseRev) {
      // Audited like every other refusal — the divergence from AirspaceStore
      // that correlation-store.js already made and gave its reason for: a
      // rejected ask that leaves no trace anywhere is the interesting half of
      // an authority model going missing.
      const stale = { ok: false, reason: 'STALE_REV', relation: this.getRelation(mutation.marsaId) };
      this._recordAudit(mutation, actingPositionId, by, deepClone(relation), stale);
      return stale;
    }

    const before = deepClone(relation);
    const result = this._guarded('MARSA op', log, () => {
      switch (op.kind) {
        case 'MarkRendezvous':    return this._markRendezvous(relation, op, by);
        case 'AddParticipant':    return this._addParticipant(relation, op, by);
        case 'RemoveParticipant': return this._removeParticipant(relation, op, by);
        case 'EndMarsa':          return this._end(relation, op, by);
        case 'VoidMarsa':         return this._void(relation, 'MANUAL', capText(op.note), by);
        case 'AcknowledgeVoid':   return this._acknowledgeVoid(relation, actingPositionId, by);
        default:
          return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown MARSA op: ${op.kind}` };
      }
    });

    // Every result carries the relation, success or not — a rejection that says
    // nothing about current state leaves the client rendering its own guess
    // (airspace-store.js's stated reason).
    if (!result.relation) result.relation = this.getRelation(mutation.marsaId);
    // The regime writes this op made, for wire/families/marsa.js to put on the wire beside
    // the marsa-delta — see drainRegimeWrites().
    if (result.ok || result.partial) result.flightDataList = this.drainRegimeWrites();
    this._recordAudit(mutation, actingPositionId, by, before, result);
    return result;
  }

  _declare(op, actingPositionId, by) {
    const participants = [...new Set((op.participants || []).map(String).filter(Boolean))];
    if (participants.length < MIN_PARTICIPANTS) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `MARSA is a relation between ${MIN_PARTICIPANTS} or more flights` };
    }
    for (const flightDataId of participants) {
      if (!this._flightDataExists(flightDataId)) {
        return { ok: false, reason: 'NOT_FOUND', detail: `unknown flight data ${flightDataId}` };
      }
    }
    if (!START_EVENTS.includes(op.startEvent)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `startEvent must be one of ${START_EVENTS.join(', ')}` };
    }
    if (!END_CONDITIONS.includes(op.endCondition)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `endCondition must be one of ${END_CONDITIONS.join(', ')}` };
    }
    // §9.2 rule 1: "The declaration is the tanker's, and it is verbal — the
    // EFSP records it, it does not decide it." Required, and free text: a
    // relation nobody is named as having declared is an unattributable
    // assertion that ATC is not separating two aircraft.
    const declaringCallsign = capText(op.declaringCallsign || '');
    if (!declaringCallsign) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'MARSA needs the callsign that declared it' };
    }
    // One ACTIVE relation per flight. Not a convenience: activeFor() is what
    // the auto-void and the SREG refusal both key on, and a flight in two
    // simultaneous relations would make each of them a guess between the two.
    for (const flightDataId of participants) {
      const existing = this.activeFor(flightDataId);
      if (existing) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: `${flightDataId} is already in an active MARSA relation (${existing.marsaId})` };
      }
    }

    const now = this._clock.now();
    const relation = {
      marsaId: crypto.randomUUID(),
      // Its own rev, independent of every participant's flightData.rev and every
      // Strip's rev — correlation-store.js's reasoning applies unchanged. A
      // Strip is broadcast whole on every update (docs/adr/0004), so stamping a
      // relation change onto N participants' Strips would invalidate N
      // controllers' optimistic edits for something that is not about any one
      // Strip.
      rev: 0,
      state: 'ACTIVE',
      declaringCallsign,
      participants,
      startEvent: op.startEvent,
      endCondition: op.endCondition,
      startedAt: now,
      declaredBy: by || null,
      declaredPositionId: actingPositionId || null,
      // §9.2 rule 2 arms the interlock "prior to rendezvous", and §9.2's own
      // MarsaRelation schema has no field for when that is. Without one the
      // interlock has no off switch: either it never disarms, so a routine
      // altitude assignment voids an AR that joined up twenty minutes ago, or
      // it is never armed and rule 2 does nothing. Null means "not yet" — i.e.
      // armed. Set only by an explicit MarkRendezvous; see that method for why
      // this is not inferred from the radar picture.
      rendezvousAt: null,
      rendezvousBy: null,
      voidedBy: null,
      voidedDetail: null,
      // docs/adr/0118 (T14, H134 LT-RQ15 a): the void notice stands until a controller holding one of the Strips acknowledges it.
      voidAcknowledgedAt: null,
      voidAcknowledgedBy: null,
      endedAt: null,
      endedBy: null,
      note: capText(op.note),
      // Append-only, the shape docs/adr/0032 gave flightData.airspace.transitions and
      // docs/adr/0045 gave correlation records, for the same reason: FAA JO
      // 7110.65 para 2-3-1's "do not erase or overwrite any item".
      transitions: [],
      updatedAt: null,
      updatedBy: null,
    };
    this._relations.set(relation.marsaId, relation);
    this._touch(relation, by, { reason: 'DECLARED', detail: `${op.startEvent} declared by ${declaringCallsign}` });
    // The separation regime genuinely changes (guide §4.8.3) — see the
    // constructor's comment for why this store writes it.
    this._applyRegime(relation.participants, 'MARSA', by);
    return { ok: true, relation: this.getRelation(relation.marsaId) };
  }

  _requireActive(relation) {
    if (relation.state !== 'ACTIVE') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `this MARSA relation is already ${relation.state}` };
    }
    return null;
  }

  /**
   * The rendezvous happened — the interlock disarms from here on.
   *
   * Deliberately its own controller action rather than something inferred from
   * the radar picture. WP5 declined to invent a definition of "detected
   * airborne" (docs/adr/0047) and this is the same question one step further
   * on: "have they joined up" is a judgement a controller or the tanker makes
   * and says out loud, not a proximity-and-closure threshold this codebase gets
   * to pick. Inventing one would be defect D11, and getting it wrong would
   * silently disarm the highest-value interlock in the military layer — which
   * is strictly worse than asking for one click.
   */
  _markRendezvous(relation, op, by) {
    const notActive = this._requireActive(relation);
    if (notActive) return notActive;
    if (relation.rendezvousAt) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'rendezvous is already marked' };
    }
    relation.rendezvousAt = this._clock.now();
    relation.rendezvousBy = by || null;
    this._touch(relation, by, { reason: 'RENDEZVOUS', detail: capText(op.note) });
    return { ok: true };
  }

  /**
   * A receiver joining late.
   *
   * Walked as a controller/pilot REQUEST rather than inferred from the
   * lifecycle (docs/adr/0050's lesson): "SHELL71, VIPER13 is joining you"
   * arrives mid-relation, and the alternative — void and re-declare — would
   * lose the start event, the declaring callsign and the whole history of a
   * relation that never actually ended.
   */
  _addParticipant(relation, op, by) {
    const notActive = this._requireActive(relation);
    if (notActive) return notActive;
    const flightDataId = op.flightDataId != null ? String(op.flightDataId) : '';
    if (!flightDataId) return { ok: false, reason: 'VALIDATION_ERROR', detail: 'AddParticipant needs an flightDataId' };
    if (!this._flightDataExists(flightDataId)) return { ok: false, reason: 'NOT_FOUND', detail: `unknown flight data ${flightDataId}` };
    if (relation.participants.includes(flightDataId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'that flight is already a participant' };
    }
    const existing = this.activeFor(flightDataId);
    if (existing) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${flightDataId} is already in an active MARSA relation (${existing.marsaId})` };
    }
    relation.participants.push(flightDataId);
    this._touch(relation, by, { reason: 'PARTICIPANT_ADDED', detail: flightDataId });
    this._applyRegime([flightDataId], 'MARSA', by);
    return { ok: true };
  }

  /**
   * One receiver breaking off while the rest continue. Dropping below
   * MIN_PARTICIPANTS ends the relation rather than leaving a one-aircraft
   * "relation" behind.
   */
  _removeParticipant(relation, op, by) {
    const notActive = this._requireActive(relation);
    if (notActive) return notActive;
    const flightDataId = op.flightDataId != null ? String(op.flightDataId) : '';
    if (!relation.participants.includes(flightDataId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'that flight is not a participant' };
    }
    relation.participants = relation.participants.filter(id => id !== flightDataId);
    this._touch(relation, by, { reason: 'PARTICIPANT_REMOVED', detail: flightDataId });
    // The one leaving is back under ATC separation immediately, whatever
    // happens to the rest of the relation below.
    this._applyRegime([flightDataId], 'ATC', by);
    if (relation.participants.length < MIN_PARTICIPANTS) {
      this._finish(relation, 'END_CONDITION', `fell below ${MIN_PARTICIPANTS} participants`, by);
    }
    return { ok: true };
  }

  /** The end condition was met — §9.2 rule 1's "the tanker advises ATC that tanker and receivers are vertically positioned", and its MTR and ATC-separation equivalents. */
  _end(relation, op, by) {
    const notActive = this._requireActive(relation);
    if (notActive) return notActive;
    this._finish(relation, 'END_CONDITION', capText(op.note), by);
    return { ok: true };
  }

  _void(relation, cause, detail, by) {
    const notActive = this._requireActive(relation);
    if (notActive) return notActive;
    if (!VOID_CAUSES.includes(cause)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `voidedBy must be one of ${VOID_CAUSES.join(', ')}` };
    }
    relation.state = 'VOIDED';
    relation.voidedBy = cause;
    relation.voidedDetail = capText(detail);
    relation.endedAt = this._clock.now();
    this._touch(relation, by, { reason: 'VOIDED', detail });
    // Whatever voided it, ATC is separating these aircraft again from this
    // instant. Writing the regime back is the half of the void that makes the
    // flight's own separation fields true, rather than only the relation's
    // state.
    this._applyRegime(relation.participants, 'ATC', by);
    return { ok: true };
  }

  /**
   * The "MARSA voided" notice is acknowledged (docs/adr/0118, T14, H134 LT-RQ15 a): the orders say an ATC course or altitude
   * change voids MARSA (JO 7110.65BB para 9-2-13 d NOTE) and nothing about a notice; ours is that it stands on every
   * participant Strip until a controller holding one of them acknowledges it, then goes from all of them. The wire gate
   * checks the Strip is held (wire/families/marsa.js); the relation keeps who and when.
   */
  _acknowledgeVoid(relation, actingPositionId, by) {
    if (relation.state !== 'VOIDED') return { ok: false, reason: 'VALIDATION_ERROR', detail: `this MARSA relation is ${relation.state}, not voided` };
    if (relation.voidAcknowledgedAt) return { ok: false, reason: 'VALIDATION_ERROR', detail: 'the void is already acknowledged' };
    relation.voidAcknowledgedAt = this._clock.now();
    relation.voidAcknowledgedBy = actingPositionId || null;
    this._touch(relation, by, { reason: 'VOID_ACKNOWLEDGED', detail: actingPositionId || null });
    return { ok: true };
  }

  _finish(relation, cause, detail, by) {
    relation.state = 'ENDED';
    relation.endedBy = END_CAUSES.includes(cause) ? cause : 'END_CONDITION';
    relation.endedAt = this._clock.now();
    this._touch(relation, by, { reason: 'ENDED', detail });
    this._applyRegime(relation.participants, 'ATC', by);
  }

  /**
   * Writes flightData.tofi.separationRegime for a set of participants, tolerating a
   * missing flight data rather than failing the op around it.
   *
   * Deliberately best-effort: the relation is the record of what was declared,
   * and it must not be left half-applied because one participant's flight data went
   * away between the check and the write. A failure is logged, not returned —
   * the relation's own state stays the authoritative answer to "is this pair
   * under MARSA", and board/ops/set-block.js and board/tofi.js read it directly (`activeMarsaFor`).
   */
  _applyRegime(flightDataIds, regime, by) {
    const written = [];
    for (const flightDataId of flightDataIds) {
      if (!this._flightDataExists(flightDataId)) continue;
      const result = this._setSeparationRegime(flightDataId, regime, { by });
      if (result && result.ok === false) {
        log.warn('could not set separation regime', { regime, flightDataId, reason: result.reason });
        continue;
      }
      // Journalled so the caller can broadcast it — see drainRegimeWrites().
      if (result && result.flightData) this._regimeWrites.push(result.flightData);
      written.push(flightDataId);
    }
    return written;
  }

  // ── the interlock (§9.2 rule 2) ─────────────────────────────────────────

  /**
   * A controller issued a course or altitude assignment to this flight. If it
   * is in an ACTIVE relation that has not reached rendezvous, that relation
   * voids.
   *
   * NOT a Mutation of its own: no baseRev, and the caller is board/strip-ops.js
   * (`marsaVoidFor`) partway through applying somebody else's SetBlock. It still lands in the
   * Mutation log under the clientMutationId of the SetBlock that caused it, so
   * the audit trail answers "why did SHELL71's MARSA void" with the exact
   * clearance that did it.
   *
   * Returns the voided relation, or null. board/ops/set-block.js turns a non-null
   * return into `marsaVoided` on its own result, which the wire broadcasts as
   * a marsa-delta beside the board-delta — so every participant Strip learns
   * about it in the same round trip as the clearance.
   *
   * @param {string} flightDataId
   * @param {{cause:string, blockId?:string, clientMutationId?:string, actingPositionId?:string, by?:string}} ctx
   */
  voidForAssignment(flightDataId, { cause, blockId, clientMutationId, actingPositionId, by } = {}) {
    this._regimeWrites = [];
    const active = this.activeFor(flightDataId);
    if (!active) return null;
    // Rendezvous has happened: the aircraft are joined up and the interlock is
    // spent. §9.2 rule 2 arms it "prior to rendezvous" specifically, and
    // voiding an established AR every time the tanker is given a new altitude
    // would make the whole relation unusable.
    if (active.rendezvousAt) return null;

    const relation = this._relations.get(active.marsaId);
    const before = deepClone(relation);
    const detail = `${cause === 'CONTROLLER_COURSE_CHANGE' ? 'course' : 'altitude'} assignment to ${flightDataId}${blockId ? ` (Block ${blockId})` : ''} before rendezvous`;
    const result = this._void(relation, cause, detail, by);
    if (!result.ok) return null;

    const voided = this.getRelation(relation.marsaId);
    this._recordAudit(
      { clientMutationId, marsaId: relation.marsaId, op: { kind: 'VoidMarsa' } },
      actingPositionId, by, before, { ok: true, relation: voided },
    );
    return voided;
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  /**
   * A flight is over — its last live Strip was dropped, so board/strip-ops.js has
   * just released its beacon code (`retireMarsaForFlightData`).
   *
   * Left alone, the relation would keep naming a flight that is on the ground,
   * keep its separation regime at MARSA on flight data nobody is working, and keep
   * arming an interlock for an aircraft that cannot be assigned anything. This
   * is correlation-store.js's retireFinished arriving from the other direction:
   * there a 1Hz reconciler sweeps the record, here there is no sweep, so the
   * Strip lifecycle has to say so explicitly.
   *
   * @returns {object[]} the relations that changed — broadcast by the caller
   */
  onFlightDataRetired(flightDataId, by) {
    this._regimeWrites = [];
    const changed = [];
    for (const relation of this._relations.values()) {
      if (relation.state !== 'ACTIVE' || !relation.participants.includes(flightDataId)) continue;
      relation.participants = relation.participants.filter(id => id !== flightDataId);
      this._touch(relation, by, { reason: 'PARTICIPANT_REMOVED', detail: `${flightDataId} — flight ended` });
      if (relation.participants.length < MIN_PARTICIPANTS) {
        this._finish(relation, 'PARTICIPANT_RETIRED', `fewer than ${MIN_PARTICIPANTS} participants remain`, by);
      }
      changed.push(this.getRelation(relation.marsaId));
    }
    return changed;
  }

  // ── undo compensator (docs/adr/0100 §3) ─────────────────────────────────

  /** The relations an undo scope names, as they are now: a relationId, or every ACTIVE relation of a flight. */
  relationImages(ref) {
    if (typeof ref === 'string') { const r = this.getRelation(ref); return r ? [r] : []; }
    if (ref && ref.flightDataId) return this.allFor(ref.flightDataId).filter(r => r.state === 'ACTIVE');
    return [];
  }

  /**
   * Whether `image` (a relation before the undone action) can be put back: nothing to do when it is unchanged, a
   * `ReopenRelation` when this flight's retirement removed a participant or ended it (`PARTICIPANT_RETIRED`), and
   * a block for anything else (someone ended or voided it since).
   * @returns {{ok:true, action:'NONE'|'REOPEN'}|{ok:false, reason:'UNDO_BLOCKED', detail:string}}
   */
  reopenCheck(image) {
    const now = this._relations.get(image.marsaId);
    if (!now) return { ok: false, reason: 'UNDO_BLOCKED', detail: `MARSA relation ${image.marsaId} is gone` };
    const same = now.state === image.state && now.participants.length === image.participants.length;
    if (same) return { ok: true, action: 'NONE' };
    const subset = now.participants.every(id => image.participants.includes(id));
    const retiredOnly = now.state === 'ACTIVE' || (now.state === 'ENDED' && now.endedBy === 'PARTICIPANT_RETIRED');
    if (image.state === 'ACTIVE' && subset && retiredOnly) return { ok: true, action: 'REOPEN' };
    return { ok: false, reason: 'UNDO_BLOCKED', detail: `MARSA relation ${image.marsaId} has changed since (${now.state})` };
  }

  /**
   * ReopenRelation: the relation goes back to its before-image's state and participants, the regime MARSA again
   * on every participant, audited with `causedBy` = the Undo's id. Returns the reopened relation, or null.
   */
  reopenRelation(image, { causedBy = null, by = null } = {}) {
    const check = this.reopenCheck(image);
    if (!check.ok || check.action === 'NONE') return null;
    this._regimeWrites = [];
    const relation = this._relations.get(image.marsaId);
    const before = deepClone(relation);
    relation.state = image.state;
    relation.participants = [...image.participants];
    relation.endedBy = image.endedBy === undefined ? null : image.endedBy;
    relation.endedAt = image.endedAt === undefined ? null : image.endedAt;
    this._touch(relation, by, { reason: 'REOPENED', detail: 'undo of the action that ended it (docs/adr/0100)' });
    this._applyRegime(relation.participants, 'MARSA', by);
    if (this._mutationLog) {
      this._mutationLog.record({
        clientMutationId: null, causedBy, op: 'ReopenRelation', marsaId: relation.marsaId, facilityId: null,
        flightDataIds: [...relation.participants], actingPositionId: null, actorId: by || null, at: this._clock.now(),
        ok: true, before, after: deepClone(relation),
      });
    }
    return deepClone(relation);
  }

  /** Forgets relations whose participants are all gone — flight data lifecycle governs relation lifecycle, with no separate retention policy (correlation-store.js's evictMissingFlightDataList, same contract). */
  evictMissingFlightDataList() {
    let dropped = 0;
    for (const [marsaId, relation] of [...this._relations.entries()]) {
      if (relation.participants.some(flightDataId => this._flightDataExists(flightDataId))) continue;
      this._relations.delete(marsaId);
      dropped += 1;
    }
    return dropped;
  }

  /**
   * The mission reset (docs/adr/0108): any relation still ACTIVE after the Strips ended (a participant without a Strip) ends,
   * as `PARTICIPANT_RETIRED`, which is what it is: the flights are gone. Finished relations stay until their flight data is
   * archived (evictMissingFlightDataList). One audit entry per relation ended.
   * @returns {string[]} the marsaIds ended
   */
  resetForMission(by = 'system') {
    this._regimeWrites = [];
    const ended = [];
    for (const relation of this._relations.values()) {
      if (relation.state !== 'ACTIVE') continue;
      const before = deepClone(relation);
      this._finish(relation, 'PARTICIPANT_RETIRED', 'mission reset', by);
      ended.push(relation.marsaId);
      if (this._mutationLog) {
        this._mutationLog.record({
          clientMutationId: null, op: 'MissionReset', marsaId: relation.marsaId, facilityId: null,
          flightDataIds: [...relation.participants], actingPositionId: null, actorId: by, at: this._clock.now(),
          ok: true, before, after: deepClone(relation),
        });
      }
    }
    this._regimeWrites = [];
    return ended;
  }

  // ── Persistence (durable per docs/adr/0002) ─────────────────────────────

  snapshot() {
    return [...this._relations.values()]
      .filter(r => r.participants.some(flightDataId => this._flightDataExists(flightDataId)))
      .map(deepClone);
  }

  /**
   * Unlike a correlation record (docs/adr/0045), a MARSA relation comes back
   * INTACT — state, participants, rendezvous and all. The two differ for a
   * reason worth being explicit about: a correlation names a DCS track id,
   * which the process re-mints on restart, so the persisted value is a lie. A
   * MARSA relation names flightDataIds and records a verbal declaration a tanker crew
   * made. Nothing about a crc-sync restart makes that declaration untrue, and
   * coming back up with every AR silently reverted to ATC separation would be
   * the "second controller inherits a lie" failure §4.8.3 names, caused by us.
   *
   * Relations whose participants are all gone are skipped, matching snapshot().
   */
  restore(data) {
    for (const saved of data || []) {
      if (!saved || !saved.marsaId) continue;
      if (!Array.isArray(saved.participants) || !saved.participants.some(flightDataId => this._flightDataExists(flightDataId))) continue;
      const relation = deepClone(saved);
      relation.participants = relation.participants.filter(flightDataId => this._flightDataExists(flightDataId));
      relation.transitions = Array.isArray(relation.transitions) ? relation.transitions : [];
      // A relation that came back with too few participants to BE one is
      // finished, not active — the same rule _removeParticipant applies live.
      if (relation.state === 'ACTIVE' && relation.participants.length < MIN_PARTICIPANTS) {
        relation.state = 'ENDED';
        relation.endedBy = 'PARTICIPANT_RETIRED';
        relation.endedAt = relation.endedAt || this._clock.now();
      }
      this._relations.set(relation.marsaId, relation);
    }
  }
}

module.exports = {
  MarsaStore,
  TRANSITION_REASONS, MARSA_EXPANSION, MIN_PARTICIPANTS,
};
