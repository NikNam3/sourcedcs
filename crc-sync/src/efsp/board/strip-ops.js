'use strict';

// The Strip operations (docs/adr/0095): the dispatch of a Mutation to its op in the table (board/ops/), the NLA
// (precheck, rejected-replica rules, nlaStatusFor) and retirement (Drop, retire). NLA and the ops are one
// collaborator because they call each other: InvokeNla runs TransferStrip, SetState and DropStrip, and the
// rejected-replica rules gate every op.

const { MAX_FREE_TEXT } = require('../flight-data-store');
const { deepClone } = require('./strip-util');
const { undoDeclarationProblem } = require('../undo/undo-history');
const { voidAppendedEntries } = require('../undo/append-only');

// A DEPARTURE in these states has left the ground (docs/adr/0076).
const DEPARTURE_AIRBORNE_STATES = ['DEPARTED', 'HANDED_OFF'];

class StripOps {
  /**
   * @param {object} deps
   * @param {object} deps.rules the Board's rules
   * @param {object} deps.state BoardState
   * @param {object} deps.audit BoardAudit
   * @param {object} deps.placement Placement
   * @param {{now: () => number}} deps.clock the mission clock
   * @param {{now: () => number}} deps.wallClock real time (docs/adr/0096)
   * @param {{ms: number}} deps.nlaGuard the NLA double-tap guard's length, a cell shared by every Board of a process
   * @param {object} deps.flightDataStore
   * @param {object} deps.coordination Coordination (the HANDOFF... ops call it)
   * @param {object} deps.control HandoffControl (ControlRelease, the control-axis check, retirement and owner changes)
   * @param {object} deps.tofi Tofi (the TOFI op calls it)
   * @param {object[]} deps.ops the op table, `{kind, authorize?, apply(ctx, strip, op, meta)}` each (board/ops/index.js)
   * @param {(stripId:string) => void} deps.touch the kernel's `recordTouch` (board/board-state.js)
   * @param {() => string|null} deps.activeCmid the clientMutationId being applied, read late
   * @param {() => Map} deps.nlaHistory the NLA latch Map the facade owns, read late
   * @param {() => Map} deps.droppedWallAt BoardPersistence's Map, read late (restore() replaces it)
   * @param {(stripType:string) => string|undefined} deps.initialStateFor the authority registry's accessor
   * @param {() => import('../undo/undo-history').UndoHistory} deps.undoHistory the one undo history, read late
   */
  constructor(deps) {
    this.rules = deps.rules;
    this.state = deps.state;
    this.placement = deps.placement;
    this.clock = deps.clock;
    this.wallClock = deps.wallClock; // docs/adr/0096: the NLA double-tap latch and the drop stamp
    this.nlaGuard = deps.nlaGuard;
    this.flightDataStore = deps.flightDataStore;
    this.coordination = deps.coordination;
    this.control = deps.control;
    this.tofi = deps.tofi;
    this._audit = deps.audit;
    // docs/adr/0100: every op module declares `undo` ('none' or a scope); a module without it is a start-up error.
    for (const entry of deps.ops) {
      const problem = undoDeclarationProblem(entry);
      if (problem) throw new Error(`op table: ${problem}`);
    }
    this._ops = new Map(deps.ops.map(entry => [entry.kind, entry]));
    this._touchOf = deps.touch;
    this._activeCmidOf = deps.activeCmid;
    this._nlaHistoryOf = deps.nlaHistory;
    this._droppedWallAtOf = deps.droppedWallAt;
    this.initialStateFor = deps.initialStateFor;
    this._undoHistoryOf = deps.undoHistory;
    this.airborneObserver = undefined;
  }

  /** The Board's audit (board/audit.js): the Undo op writes its own entry (docs/adr/0100 §8). */
  get audit() { return this._audit; }

  /** The one undo history (docs/adr/0100), shared by every Board of the process. */
  get undoHistory() { return this._undoHistoryOf(); }

  get _activeCmid() { return this._activeCmidOf(); }
  /** stripId -> the last NLA's latch record; the facade owns the Map. */
  get nlaHistory() { return this._nlaHistoryOf(); }
  /** stripId -> wall ms of its drop (docs/adr/0082); BoardPersistence owns the Map (board/persistence.js). */
  get droppedWallAt() { return this._droppedWallAtOf(); }
  /** The kernel's `recordTouch` (board/board-state.js); `observeTouches` sees every call. */
  touch(stripId) { this._touchOf(stripId); }

  /**
   * Who vouches that a Strip's aircraft is observed airborne (L19's hint
   * monitor: a standing AIRBORNE_ADVANCE hint for the Strip). Unset, no
   * SetState is ever let past the runway gate.
   */
  setAirborneObserver(fn) { this.airborneObserver = fn; }

  /** Runs one op of the table: the one way an op reaches another (InvokeNla -> TransferStrip, SetState -> DropStrip). */
  run(kind, strip, op, meta) { return this._ops.get(kind).apply(this, strip, op, meta); }

  dispatch(mutation, actingPositionId, by) {
    const { op } = mutation;

    // Coordination and TOFI notes carry the verbal half of an exchange and
    // are free text, so they get the same ceiling as every other free-text
    // field (see flight-data-store.js's MAX_FREE_TEXT). Bounded HERE, at the one
    // choke point every Mutation passes through, rather than at each of the
    // eight places a note is read — an earlier attempt to patch those
    // individually silently matched nothing and left the cap absent.
    if (typeof op.note === 'string' && op.note.length > MAX_FREE_TEXT) {
      op.note = op.note.slice(0, MAX_FREE_TEXT);
    }

    // Per-acting-Position permission (guide §4.8.4) — evaluated for the
    // single acting Position on this Mutation only, NEVER as a union of
    // every Position the controller happens to hold (defect D21). This
    // check is separate from, and precedes, the ownership check below:
    // ownership answers "does this Position own THIS Strip", permission
    // answers "may this Position class perform this op kind at all"
    // (e.g. only OPS may CreateStrip — guide §4.1 rule 3).
    const entry = this._ops.get(op.kind);
    // docs/adr/0100 §5, §7: Undo names an action, not a Strip state; it has its own gate (the record's Position).
    if (op.kind === 'Undo') return this._dispatchUndo(mutation, actingPositionId, by);
    const denied = entry && entry.authorize
      ? entry.authorize(this, actingPositionId, op)
      : (!this.rules.canMutate(actingPositionId, op.kind) ? { ok: false, reason: 'PERMISSION_DENIED' } : null);
    if (denied) return denied;

    const keyed = typeof mutation.clientMutationId === 'string' && mutation.clientMutationId !== '';
    const frameMeta = (strip, label) => ({
      facilityId: this.rules.facilityId, actingPositionId, actorId: by || null, op: op.kind, label,
      stripId: strip ? strip.stripId : null, at: this.clock.now(),
    });

    if (op.kind === 'CreateStrip') {
      this.undoHistory.begin(keyed ? mutation.clientMutationId : null, frameMeta(null), null);
      let result;
      try { result = this.run('CreateStrip', null, op, { actingPositionId, by }); } catch (err) { this.undoHistory.abort(); throw err; }
      this.undoHistory.commit(result);
      this._audit.recordAudit(mutation, actingPositionId, by, null, result);
      return result;
    }

    const strip = this.state.strips.get(mutation.stripId);
    if (!strip) return { ok: false, reason: 'NOT_FOUND' };
    if (strip.rev !== mutation.baseRev) return { ok: false, reason: 'STALE_REV', strip: deepClone(strip) };

    // Every op below requires the acting Position to be the Strip's
    // current Owner (guide §4.4 rule 2) — TransferStrip is itself an
    // owner-only action (the sender transfers away; the receiver doesn't
    // pull), so this gate covers it too.
    // Two narrow, table-driven exceptions cross it (permission.js's
    // mayActBesideOwner, docs/adr/0080): the TOFI answer on a line a tactical
    // Position is working, and OPS's alert status on a departure. Everything
    // else is the owner's alone. The refusal names the owner (B1/B2 stayed
    // invisible for want of it).
    if (strip.ownerPositionId !== actingPositionId
        && !(this.rules.mayActBesideOwner(actingPositionId, strip, op))) {
      return { ok: false, reason: 'NOT_OWNER', detail: `${strip.ownerPositionId} holds this Strip`, strip: deepClone(strip) };
    }

    // F-303, the rest of it: a rejected replica is inert for every op, not
    // just the NLA and the Bay-implied drag. See `StripOps#rejectedReplicaOpRefusal`.
    const inert = this.rejectedReplicaOpRefusal(strip, op);
    if (inert) return { ok: false, reason: inert.reason, detail: inert.detail, strip: deepClone(strip) };

    const before = deepClone(strip);
    const meta = { by, actingPositionId, clientMutationId: mutation.clientMutationId };
    // docs/adr/0100: the op's undo scope is read BEFORE it applies (the before-images), and the frame sees
    // everything it touches. A keyed Mutation whose module declares a scope is undoable for 10 s.
    const undo = entry && entry.undo !== 'none' && keyed ? entry.undo : null;
    const scope = undo ? undo.scope(this, strip, op) : null;
    this.undoHistory.begin(keyed ? mutation.clientMutationId : null, frameMeta(strip, scope ? undo.label(op, strip, this) : undefined), scope);
    let result;
    try {
      result = entry
        ? entry.apply(this, strip, op, meta)
        : { ok: false, reason: 'VALIDATION_ERROR', strip: deepClone(strip) };
      // docs/adr/0101 decision 7 (DR-4): an owner change inside a Facility carries control with it, whichever op made it
      // (TransferStrip, a NLA transfer, CarrierHandoff, SfaRotation): the one place, not each op.
      if (result.ok && strip.ownerPositionId !== before.ownerPositionId) {
        const followed = this.control.followOwner(strip, by);
        if (followed && followed.peerStrip && !result.peerStrip) { result.peerFacilityId = followed.peerFacilityId; result.peerStrip = followed.peerStrip; }
      }
      // docs/adr/0076, Q-L16-3: a DEPARTURE entering Airborne stamps the takeoff
      // time, however it got there (the NLA, SetState, a drag into the Airborne
      // Bay) — one place, after every op that can change a state.
      if (result.ok && strip.state !== before.state) {
        const stamped = this._stampTakeoffOnStateChange(strip, before.state);
        if (stamped) {
          if (!result.flightData || result.flightData.flightDataId === stamped.flightDataId) result.flightData = stamped;
          else result.flightDataList = [...(result.flightDataList || []), stamped];
        }
      }
    } catch (err) {
      this.undoHistory.abort();
      throw err;
    }
    const created = scope && result.ok && undo.created ? undo.created(result, this) : undefined;
    const undoable = this.undoHistory.commit(result, { created });
    if (undoable) result.undoable = undoable;
    this._audit.recordAudit(mutation, actingPositionId, by, before, result, this.auditFieldsFor(op.kind, result, op));
    return result;
  }

  /**
   * Undo (docs/adr/0100): `op.actionId` names the action; the history says whether it may be undone and by whom,
   * and board/ops/undo.js validates and applies its Plan. No Strip-state gate (owner, baseRev) applies: the undoer
   * may no longer own the Strip (Q-U5 a), and the Undo voids later changes on purpose.
   */
  _dispatchUndo(mutation, actingPositionId, by) {
    const { op } = mutation;
    if (typeof op.actionId !== 'string' || op.actionId === '') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'an Undo names the action it undoes (actionId)' };
    }
    if (!this.rules.isStaffed(actingPositionId)) {
      return { ok: false, reason: 'NOT_STAFFED', detail: `${actingPositionId} is not staffed` };
    }
    const history = this.undoHistory;
    const got = history.undo(op.actionId, actingPositionId);
    if (!got.ok) return { ok: false, reason: got.reason, detail: got.detail };
    const { plan } = got;
    if (plan.meta.facilityId !== this.rules.facilityId) {
      return { ok: false, reason: 'UNDO_UNAVAILABLE', detail: `that action was at ${plan.meta.facilityId}: send the Undo there` };
    }
    const keyed = typeof mutation.clientMutationId === 'string' && mutation.clientMutationId !== '';
    history.begin(keyed ? mutation.clientMutationId : null, {
      facilityId: this.rules.facilityId, actingPositionId, actorId: by || null, op: 'Undo', undo: true, at: this.clock.now(),
    }, null);
    let result;
    try {
      result = this.run('Undo', null, op, { by, actingPositionId, clientMutationId: keyed ? mutation.clientMutationId : null, plan });
    } catch (err) {
      history.abort();
      throw err;
    }
    history.commit(result);
    if (result.ok) history.complete(plan);
    return result;
  }

  // ── undo restore (docs/adr/0100 §3), this Board's half ─────────────────────

  /** A Strip's before-image for the undo history: the record, where it sits, and its drop's wall time. */
  captureForUndo(stripId) {
    const strip = this.state.strips.get(stripId);
    if (!strip) return null;
    const wallAt = this.droppedWallAt.get(stripId);
    return { strip: deepClone(strip), placement: this.placement.placementOf(strip), droppedWallAt: wallAt == null ? null : wallAt };
  }

  /**
   * What can have changed underneath a restore of `images` (Strips of this Board): an archived Strip
   * (`NOT_FOUND`, ADR 0082 rule 4), an owner no longer staffed (`NOT_STAFFED`), a full Bay (`BAY_FULL`). The op
   * gates are not re-run: the state was valid a few seconds ago.
   * @returns {{ok:false, reason:string, detail:string}|null}
   */
  checkRestore(images) {
    for (const img of images) {
      if (!img.strip) continue;
      const live = this.state.strips.get(img.stripId);
      if (!live) return { ok: false, reason: 'NOT_FOUND', detail: `${img.stripId} has been archived; nothing archived can be undone` };
      if (img.strip.state === 'DROPPED') continue;
      const owner = img.strip.ownerPositionId;
      if (owner !== live.ownerPositionId && !this.rules.isStaffed(owner)) {
        return { ok: false, reason: 'NOT_STAFFED', detail: `${owner} is no longer staffed, so ${img.stripId} cannot go back to it` };
      }
      if (img.placement && img.placement.bayId !== live.bayId) {
        const full = this.placement.bayFullRefusal(img.placement.bayId, live);
        if (full) return { ok: false, reason: 'BAY_FULL', detail: full.detail };
      }
    }
    return null;
  }

  /**
   * Restores `images` (whole records: every field but `rev`, `updatedAt`, `updatedBy`; placement after the recorded
   * predecessor; annotation entries added since VOIDED, never erased) and removes `removeIds` (records the action
   * created: the ring gets a `gone`). Call checkRestore first: this does not refuse.
   * @returns {{records: {stripId:string, flightDataId:string|null, before:object, after:object|null}[], gone: string[]}}
   */
  restoreImages(images, removeIds, { voidedBy, by }) {
    const records = [];
    for (const img of images) {
      if (!img.strip) continue;
      const live = this.state.strips.get(img.stripId);
      if (!live) continue;
      const before = deepClone(live);
      const annotations = deepClone(live.annotations || {});
      for (const [blockId, cell] of Object.entries(annotations)) {
        voidAppendedEntries(img.strip.annotations && img.strip.annotations[blockId], cell, voidedBy);
      }
      for (const k of Object.keys(live)) delete live[k];
      Object.assign(live, deepClone(img.strip), { annotations });
      if (img.strip.state !== 'DROPPED' && img.placement) this.placement.restorePlacement(live, img.placement);
      if (img.strip.state === 'DROPPED' && img.droppedWallAt != null) this.droppedWallAt.set(live.stripId, img.droppedWallAt);
      else this.droppedWallAt.delete(live.stripId);
      live.rev = before.rev + 1;
      live.updatedAt = this.clock.now();
      live.updatedBy = by || null;
      this.touch(live.stripId);
      records.push({ stripId: live.stripId, flightDataId: live.flightDataId || null, before, after: deepClone(live) });
    }
    const gone = [];
    for (const stripId of removeIds) {
      const live = this.state.strips.get(stripId);
      if (!live) continue;
      this.touch(stripId); // in this Board event's delta, where a missing Strip goes out as `gone`
      this.state.remove(stripId);
      this.droppedWallAt.delete(stripId);
      gone.push(stripId);
      records.push({ stripId, flightDataId: live.flightDataId || null, before: deepClone(live), after: null });
    }
    return { records, gone };
  }

  /** The op's own audit keys (`auditFields` in its table entry): `{head, tail}`, or none. */
  auditFieldsFor(kind, result, op) {
    const entry = this._ops.get(kind);
    return entry && entry.auditFields && result.ok ? entry.auditFields(this, result, op) : {};
  }


  /**
   * The takeoff time the state change gives (docs/adr/0076). Stamped when a
   * DEPARTURE first reaches an airborne state, with the mission clock; cleared
   * when it is taken back out of one (an Undo, a SetState back), because the
   * takeoff then did not happen. A DROP keeps it. The first stamp wins.
   * @returns {object|null} the flight data it changed, for the ack's broadcast.
   */
  _stampTakeoffOnStateChange(strip, prevState) {
    if (strip.stripType !== 'DEPARTURE' || !this.flightDataStore || !this.flightDataStore.setTakeoffStamp) return null;
    const airborne = (st) => DEPARTURE_AIRBORNE_STATES.includes(st);
    const flightData = this.flightDataStore.getFlightData(strip.flightDataId);
    if (!flightData) return null;
    let r = null;
    if (airborne(strip.state) && !airborne(prevState) && prevState !== 'DROPPED') {
      if (flightData.timeInputs && flightData.timeInputs.takeoffStampedUtc != null) return null;
      r = this.flightDataStore.setTakeoffStamp(strip.flightDataId, this.clock.now());
    } else if (!airborne(strip.state) && strip.state !== 'DROPPED' && airborne(prevState)) {
      r = this.flightDataStore.setTakeoffStamp(strip.flightDataId, null);
    }
    return r && r.ok && r.changed ? r.flightData : null;
  }

  /**
   * Placing a Strip on an SFA frequency Rack assigns it that frequency (guide
   * §4.2: one Rack per frequency): the flight data's working frequency, the same field the
   * airspace approval writes, so a frequency is one number on one flight. This is
   * the controller choosing a frequency, which is not what SFA forbids; it forbids
   * a CONTROLLER CHANGE being a frequency change, and no transfer or rotation
   * reaches this (D17). Returns the flight data result, or null when the Rack is no SFA
   * frequency or the flight already has that frequency.
   */
  assignSfaFrequency(strip, by) {
    const mhz = this.rules.sfaFrequencyFor(strip.bayId, strip.rackId);
    if (mhz == null) return null;
    const flightData = this.flightDataStore.getFlightData(strip.flightDataId);
    if (!flightData || (flightData.comms && flightData.comms.workingFrequencyMhz === mhz)) return null;
    const r = this.flightDataStore.setWorkingFrequency(strip.flightDataId, mhz, { by });
    return r.ok ? r : null;
  }

  /**
   * The flight data a MARSA side effect just rewrote the separation regime on (ending
   * or voiding a relation writes ATC back on every participant). A relation is
   * not a Strip and its participants' Strips may sit in another Facility, so
   * those flight data writes reach nobody unless they are collected here and put in the
   * board-delta's own `flightDataList.updated` — the same gap F-111 found on the declare
   * side, arriving from the Strip-op direction. See marsa-store.js's
   * drainRegimeWrites().
   */
  drainMarsaRegimeWrites() {
    const flightDataList = this.rules.drainMarsaRegimeWrites();
    return flightDataList && flightDataList.length ? flightDataList : undefined;
  }

  /**
   * WP6 (docs/adr/0051), §9.2 rule 2 — the MARSA course/altitude void
   * interlock, applied AFTER the write has succeeded.
   *
   * It voids; it does not refuse, and the direction is the whole point. A
   * controller who needs to turn or climb a joining aircraft must be able to,
   * immediately — refusing the clearance would leave them arguing with the
   * panel about an aircraft in the air. So the assignment applies and the
   * relation ends under it, which is the conservative outcome: ATC re-assumes
   * separation. See marsa-store.js's module comment.
   *
   * `confirmVacated` is deliberately excluded. It carries no value and issues
   * no instruction — it is the controller recording that the aircraft has LEFT
   * an altitude it was assigned earlier (§3.7 rule 3). Voiding a live AR on
   * that would be the interlock firing at the one moment nothing was issued.
   */
  marsaVoidFor(strip, op, by, actingPositionId, clientMutationId) {
    if (op.confirmVacated) return null;
    const interlock = this.rules.marsaInterlockFor(strip.stripType, op.blockId);
    if (!interlock) return null;
    return this.rules.voidMarsaForAssignment(strip.flightDataId, {
      cause: interlock === 'COURSE' ? 'CONTROLLER_COURSE_CHANGE' : 'CONTROLLER_ALTITUDE_CHANGE',
      blockId: op.blockId,
      clientMutationId,
      actingPositionId,
      by,
    });
  }

  applySetState(strip, toState, by) {
    if (!this.rules.isValidState(toState, strip.stripType)) {
      return { ok: false, reason: 'VALIDATION_ERROR', strip };
    }
    // A state change that files the Strip into a full Bay (a missed approach coming
    // back on final while another aircraft is on it) is refused, not silently doubled.
    const into = this.rules.bayForImpliedState(strip.ownerPositionId, toState);
    if (into && into.impliesState === toState && into.bayId !== strip.bayId) {
      const full = this.placement.bayFullRefusal(into.bayId, strip);
      if (full) return { ok: false, reason: full.reason, detail: full.detail, strip };
    }
    strip.state = toState;
    this.placement.relocateForImpliedState(strip, toState);
    this.state.bump(strip, by);
    return { ok: true, strip };
  }

  /**
   * True when this Strip is a coordination replica the receiving Facility
   * already DECLINED (docs/ui-findings/lane3.md F-303).
   *
   * The distinction matters because BOTH sides' records read REJECTED once
   * the response is mirrored back (receiveCoordinationResponse) — and the
   * sender's Strip is a real flight the sender must carry on working.
   *
   * `mintedForCoordination` is stamped by receiveCoordinationProposal and is
   * the authoritative answer, for exactly the reason TOFI's own
   * `mintedForTofi` exists (see board/tofi.js's _applyTofiAccept): the alternative — deriving
   * it from the Strip still sitting in its owner's Coordination Bay, as
   * board/coordination.js's _applyCoordinationPropose does — gives the same answer right up until
   * somebody drags the replica somewhere else, and then silently stops
   * applying. The Bay derivation is kept as the fallback so a replica minted
   * before this field existed, and restored from a persisted Board
   * (docs/adr/0002), is still recognized.
   */
  isRejectedReplica(strip) {
    if (!strip.coordination || strip.coordination.state !== 'REJECTED') return false;
    if (strip.coordination.mintedForCoordination) return true;
    const ownCoordinationBay = this.rules.coordinationBayFor(strip.ownerPositionId);
    return !!ownCoordinationBay && strip.bayId === ownCoordinationBay.bayId;
  }

  /**
   * Everything that refuses an NLA BEFORE the state table is consulted —
   * shared by board/ops/invoke-nla.js's _applyInvokeNla (which decides) and nlaStatusFor (which only
   * reports), so there is exactly one wording per reason.
   * @returns {{reason:string, detail:string}|null}
   */
  nlaPrecheck(strip) {
    // Per-State authority (guide §3.4's "normally owned by" column,
    // permission.js's canActOnState) — the acting Position (==
    // strip.ownerPositionId; `StripOps#dispatch` already verified that above)
    // must be authorized for the Strip's CURRENT state, not just own the
    // Strip. This is what stops e.g. OPS from single-handedly walking a
    // Strip through CD's, GC's and LC's entire job just because nobody
    // ever transferred it away — raw ownership alone used to be sufficient
    // to invoke ANY NLA on a Strip you held, regardless of whose job that
    // state's action actually is.
    if (!this.rules.canActOnState(strip.ownerPositionId, strip.stripType, strip.state)) {
      return { reason: 'PERMISSION_DENIED', detail: `${strip.state} is not ${strip.ownerPositionId}'s to advance` };
    }

    // Bug found in live testing (docs/adr/0022's HANDOFF/HANDED_OFF case):
    // a DEPARTURE Strip's only NLA at HANDED_OFF is Drop, which stayed
    // live right alongside the new Coordinate button — nothing stopped a
    // controller from dropping a Strip with a still-open (PROPOSED, i.e.
    // not yet accepted/rejected) coordination proposal. Dropping never
    // notifies the peer (only ACCEPT/REJECT call receiveCoordinationResponse),
    // so the receiving Facility's replica was silently orphaned, waiting
    // forever for a response that would never come. Mirrors the existing
    // "a Strip cannot have two open coordination links at once" guard in
    // board/coordination.js's _applyCoordinationPropose — same open-link concept, different action.
    if (strip.coordination && strip.coordination.state === 'INITIATED') {
      return { reason: 'VALIDATION_ERROR', detail: 'cannot advance a Strip with an open coordination proposal — accept, reject, or wait for a response first' };
    }
    // Same open-link guard, extended to TOFI's own coordination record
    // (WP4A second slice) — a Strip with an open (unresolved) TOFI
    // proposal shouldn't silently advance its own lifecycle out from under
    // the pending exchange.
    if (strip.tofiCoordination && strip.tofiCoordination.state === 'INITIATED') {
      return { reason: 'VALIDATION_ERROR', detail: 'cannot advance a Strip with an open TOFI proposal — accept, reject, or wait for a response first' };
    }
    return null;
  }

  /**
   * F-303: a declined replica is "left inert" — board/coordination.js's _applyCoordinationPropose's
   * own comment has said so since WP4A, and nothing anywhere enforced it
   * beyond stopping a re-propose. So AP could reject a Point Out from CTR and
   * then hand that same flight to its own Tower, and the server took it:
   * INCIRLIK Tower holding an arrival for a flight CENTER still owns and AP
   * explicitly declined. The sender's own Strip is untouched — see
   * `StripOps#isRejectedReplica` for how the two are told apart.
   *
   * Drop is the deliberate exception, and the only NLA a dead replica should
   * have left: it is how the controller clears it off their Board, and a
   * rejected HANDED_OFF replica having no way to be Dropped at all was itself
   * a bug found in live testing (see efsp-board-store-coordination's own
   * "CTR can Drop a HANDED_OFF DEPARTURE Strip it owns" test).
   *
   * @returns {{reason:string, detail:string}|null}
   */
  rejectedReplicaRefusal(strip, toState) {
    if (toState === 'DROPPED' || !this.isRejectedReplica(strip)) return null;
    return { reason: 'VALIDATION_ERROR', detail: this.rejectedReplicaDetail(strip) };
  }

  rejectedReplicaDetail(strip) {
    return `this ${strip.coordination.primitive} was rejected — the replica is inert, and ${strip.coordination.peerPositionId} still works the flight`;
  }

  /**
   * The op-level half of F-303. `StripOps#rejectedReplicaRefusal` only ever guarded the
   * NLA and the Bay-implied drag, so a controller who had just rejected a
   * handoff could still open a TOFI on the dead replica (minting a MISSION
   * Strip on TACTICAL for a flight the sender still controls), approve an
   * airspace entry, convert it to an arrival, or write Blocks into the flight data it
   * shares with the sender's live Strip.
   *
   * Three op kinds stay allowed, because each already enforces the rule
   * itself and each is how a dead replica gets cleared away: DropStrip,
   * InvokeNla (which `StripOps#rejectedReplicaRefusal` limits to DROPPED), and
   * MoveStrip (which Placement.validateBayImpliedTransition refuses into any Bay that
   * would change the Strip's state — moving it aside is fine).
   *
   * MARSA and correlation are flight-level and never reach `StripOps#dispatch`; the
   * client hides their controls on a rejected replica instead.
   *
   * @returns {{reason:string, detail:string}|null}
   */
  rejectedReplicaOpRefusal(strip, op) {
    if (!this.isRejectedReplica(strip)) return null;
    if (op.kind === 'DropStrip' || op.kind === 'InvokeNla' || op.kind === 'MoveStrip') return null;
    return { reason: 'VALIDATION_ERROR', detail: this.rejectedReplicaDetail(strip) };
  }

  /**
   * What pressing this Strip's NLA button would do RIGHT NOW, computed for
   * its owner — who is the only Position ever offered it (guide §3.5's one
   * NLA per State, `StripOps#dispatch`'s NOT_OWNER gate).
   *
   * Advisory only: board/ops/invoke-nla.js's _applyInvokeNla still decides, and still refuses. This
   * exists because §3.5 rule 2 requires the inhibit REASON to be rendered
   * rather than the control merely greyed out, and until now every reason was
   * computed on the press and never reached the client at all — an NLA the
   * server would refuse looked exactly like one it would accept
   * (docs/ui-findings/lane4.md F-408). efsp-ws.js stamps the result onto every
   * Strip record it puts on the wire, beside `facilityId`.
   *
   * @returns {{toState:string, transferTo?:string}
   *          |{inhibited:string, reason:'NLA_INHIBITED'|'PERMISSION_DENIED'|'VALIDATION_ERROR'}
   *          |null} null means no NLA is defined for this State at all.
   */
  nlaStatusFor(strip, now = this.clock.now()) {
    if (!strip) return null;
    const flightData = this.flightDataStore.getFlightData(strip.flightDataId);
    const result = this.rules.computeNla(strip, flightData, now, this.placement.nlaCtx());
    // No NLA at all for this State (every strip type's terminal DROPPED) — null, not
    // a reason. board/ops/invoke-nla.js's _applyInvokeNla runs the precheck FIRST and so answers a press
    // on a terminal Strip with whichever precheck refusal comes up; that is
    // right for a press, and wrong here, where reporting a reason would have
    // the panel render an explanation for a button that does not exist.
    if (!result) return null;

    const blocked = this.nlaPrecheck(strip);
    if (blocked) return { inhibited: blocked.detail, reason: blocked.reason };
    if (result.inhibited) return { inhibited: result.inhibited, reason: 'NLA_INHIBITED' };

    const inert = this.rejectedReplicaRefusal(strip, result.toState);
    if (inert) return { inhibited: inert.detail, reason: inert.reason };

    // The two refusals that live inside the apply path rather than in the
    // state table, reproduced here with their exact wordings so the advisory
    // never disagrees with the press.
    if (result.transferTo) {
      const targetBay = this.rules.bayForImpliedState(result.transferTo, result.toState);
      if (!targetBay) return { inhibited: `no Bay configured for ${result.transferTo}/${result.toState}`, reason: 'NLA_INHIBITED' };
    } else if (result.toState === 'DROPPED' && strip.tofiCoordination && strip.tofiCoordination.state === 'ACTIVE') {
      return { inhibited: 'cannot drop a Strip under active tactical control — complete a TOFI exit first', reason: 'VALIDATION_ERROR' };
    }
    const status = result.transferTo ? { toState: result.toState, transferTo: result.transferTo } : { toState: result.toState };
    // docs/adr/0074: which carrier handoff this NLA button records, and the
    // strip type it changes the Strip to, so the panel labels it from the model's own
    // table (and renders "See you" beside it in Case II).
    if (result.carrierHandoff) status.carrierHandoff = result.carrierHandoff;
    if (result.stripTypeChange) status.stripTypeChange = result.stripTypeChange;
    return status;
  }

  /**
   * The ONE path by which a Strip reaches DROPPED, whichever op asked for it
   * (the explicit DropStrip op, or a terminal NLA transition whose toState is
   * DROPPED — every strip type has one, labelled "Drop" in the UI).
   *
   * Found by an end-to-end scenario trace: this used to live entirely inside
   * board/ops/drop-strip.js's _applyDropStrip, which only the `.drop` dot-command ever reaches. The
   * ordinary Drop *button* routes through InvokeNla -> `StripOps#applySetState`, a
   * generic two-line state setter — so the guide §4.6.3 rule 2 rejection
   * below was trivially bypassable from the default UI (dropping a Strip out
   * from under a live TOFI exchange, leaving the peer's own record stuck at
   * ACTIVE pointing at a Strip that no longer exists), and neither the remove
   * indicator nor the beacon release ever happened on that path at all.
   */
  retire(strip, by) {
    // WP4A second slice, guide §4.6.3 rule 2: "the Strip stays live and
    // posted throughout tactical control... dropping the Strip breaks all
    // three [separation-model fields]." A hard rejection, not a soft warn
    // like the verbal-path interlocks elsewhere in §4.6 — this is a
    // data-integrity fact (the flight retains its IFR clearance and
    // ATC-assigned beacon code while under tactical control), not a
    // coordination nicety. Applies on EITHER side of the exchange (the
    // ATC-side Strip and the MISSION-side Strip both carry their own
    // tofiCoordination record — see receiveTofiProposal).
    if (strip.tofiCoordination && strip.tofiCoordination.state === 'ACTIVE') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'cannot drop a Strip under active tactical control — complete a TOFI exit first', strip };
    }
    strip.state = 'DROPPED';
    this.droppedWallAt.set(strip.stripId, this.wallClock.now()); // the archive's clock, docs/adr/0082
    strip.flags.removeIndicator = true; // distinct from delete (§3.4) — Strip stays queryable, see getRack()
    this.state.bump(strip, by);
    // `marsaChanged` rather than `marsaVoided`: this is a flight ENDING, not a
    // clearance voiding a relation, and the two must not render as the same
    // thing. A tanker landing mid-AR leaves the relation `ENDED` with
    // `endedBy: 'PARTICIPANT_RETIRED'`; nothing went wrong and no alert is due.
    const marsaChanged = this._releaseFlightDataIfLastStrip(strip, by);
    // docs/adr/0074: a flight that leaves the recovery leaves the stack, with a
    // vacancy and no close-up (H28). A LAUNCH Strip is not in the stack; the
    // removal is a no-op for it.
    let carrierChanged;
    if (['MARSHAL', 'FINAL', 'PATTERN'].includes(strip.stripType)) {
      carrierChanged = this.rules.carrierRetireFlight(strip.flightDataId, by) || undefined;
    }
    // U7: a replica that ends takes the proposer's link with it.
    let peerFacilityId; let peerStrip; let controlAudit; let warnings;
    const link = strip.coordination;
    // docs/adr/0101 (TRANSFERRING_RETIRED): the proposer's Strip ends (drop, join, anything that retires it) while it
    // still holds comms or control: both move to the receiving side, so the flight is never left with nobody on it.
    const implicit = this.control.onTransferringRetired(strip, by);
    if (implicit) {
      peerFacilityId = implicit.peerFacilityId; peerStrip = implicit.peerStrip; controlAudit = implicit.controlAudit; warnings = implicit.warnings;
    }
    if (link && link.mintedForCoordination) {
      const peer = this.rules.peerBoard(link.peerFacilityId);
      const ended = peer ? peer.receiveCoordinationPeerGone({ causedBy: this._activeCmid, stripId: link.peerStripId, goneStripId: strip.stripId }) : null;
      if (ended && ended.ok) { peerFacilityId = link.peerFacilityId; peerStrip = ended.strip; }
    }
    return {
      ok: true, strip,
      marsaChanged: marsaChanged && marsaChanged.length ? marsaChanged : undefined,
      flightDataList: marsaChanged && marsaChanged.length ? this.drainMarsaRegimeWrites() : undefined,
      peerFacilityId, peerStrip, carrierChanged, controlAudit, warnings,
    };
  }

  /**
   * Releases the flight data's beacon code only once NO other live Strip still
   * references that flight data, anywhere (this Facility or any other).
   *
   * One flight data meant one live Strip until TOFI, which deliberately binds a
   * MISSION Strip and its ATC-side Strip to one shared flightDataId (docs/adr/0025)
   * with independent lifecycles. An unconditional release therefore handed
   * the shared Mode 3/A code back to the allocator when the MRU controller
   * retired their MISSION Strip — while the ATC-side flight was still
   * airborne and still squawking it — and the next CreateStrip could then
   * mint that same code for an unrelated flight. Silent: the duplicate check
   * (code-allocator.js's validateAssignment) only fires on a manual override,
   * never on the automatic allocate() scan.
   */
  _releaseFlightDataIfLastStrip(strip, by) {
    const othersLive = this.rules.liveStripsForFlightData(strip.flightDataId, strip.stripId);
    if (othersLive !== 0) return null;
    this.flightDataStore.releaseFlightData(strip.flightDataId);
    // WP6 (docs/adr/0051) — the flight is over, so it leaves any MARSA relation
    // it was in. Left alone the relation would keep naming an aircraft on the
    // ground, keep its separation regime at MARSA on flight data nobody is working,
    // and keep arming an interlock for a flight that cannot be assigned
    // anything. Same shape correlation-store.js's retireFinished has, arriving
    // from the other direction: correlation is swept by a 1Hz reconciler and
    // MARSA has no sweep, so the Strip lifecycle has to say so out loud.
    return this.rules.retireMarsaForFlightData(strip.flightDataId, by);
  }
}

module.exports = { StripOps };
