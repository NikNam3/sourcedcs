'use strict';

// Airspace state — the `RANGE` Position's board (EFSPImplementationGuide.md
// §4.1 rule 2: "RANGE works no Strips. It owns airspace state — schedule,
// activation, release direction. Give it a Field State board", and §4.2:
// "Airspace board (not a strip rack)").
//
// A THIRD store, peer to FdrStore and BoardStore rather than part of either.
// docs/adr/0032 left the choice open ("does an airspace entity live on the
// FDR, on a Board, or in a third store?") and answered the why: airspace
// state outlives any one flight — "a MOA stays hot after one flight leaves
// it whenever other participants remain". Putting it on the FDR would make
// every flight carry its own private copy of a fact about the world; putting
// it on a Board would make it a Strip, which §4.1 says RANGE never works.
//
// One store shared across every Facility, like FdrStore: an airspace is a
// theater entity that names its controlling Facility, not a per-Facility
// replica. There is no D13 replication question here because nothing is ever
// handed across a boundary — the record has one home.
//
// The four state names are normative (§4.6.4: "Internal state names MUST use
// scheduled / active / released / returned"; "hot" and "cold" are display
// sugar only). They are deliberately NOT paired with a second ownership
// direction field: §4.6.4's prohibition is against a bare `released` BOOLEAN,
// because "released" alone is ambiguous — released *to the using agency*
// means active, released *to the controlling agency* means available. Four
// named states resolve that ambiguity by construction. The per-FDR
// `airspace.owner` direction (docs/adr/0018) is a different fact, about a
// flight rather than about the airspace, and is untouched by this store.

const AIRSPACE_STATES = ['SCHEDULED', 'ACTIVE', 'RELEASED', 'RETURNED'];

// The lifecycle, as a transition table rather than a switch: a reservation is
// scheduled, activated once ATC approves, released by the using agency when
// it is finished, and returned once ATC has it back and it is available
// again. RETURNED is not terminal — an airspace is a standing entity that
// gets scheduled over and over.
const LEGAL_TRANSITIONS = {
  SCHEDULED: ['ACTIVE', 'RETURNED'],   // RETURNED here = a schedule cancelled before it ever went active
  ACTIVE:    ['RELEASED'],
  RELEASED:  ['RETURNED'],
  RETURNED:  ['SCHEDULED'],
};

const INITIAL_STATE = 'RETURNED'; // available, nothing booked

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

class AirspaceStore {
  /**
   * @param {object} airspaceConfig — airspace-config.js (injected rather than
   *   required directly, so tests can drive a fixture without touching disk)
   * @param {{occupancyFor?:(airspaceId:string)=>number}} [deps] —
   *   `occupancyFor` counts the flights currently approved into an airspace,
   *   across every Facility's Board. Injected the same way board-store.js's
   *   `liveStripsForFdr` is, and for the same reason: this store has no
   *   business reaching into Boards, and the Boards do not exist yet when it
   *   is constructed. Optional, so a fixture can drive the store alone.
   */
  constructor(airspaceConfig, { occupancyFor } = {}) {
    this._occupancyFor = occupancyFor || (() => 0);
    this._config = airspaceConfig;
    this._records = new Map(); // airspaceId -> record
    this._seq = 0;
    for (const definition of airspaceConfig.getAirspaces()) this._seed(definition);
  }

  _seed(definition) {
    this._records.set(definition.airspaceId, {
      airspaceId: definition.airspaceId,
      rev: 0,
      state: INITIAL_STATE,
      // The booked window, set by ScheduleAirspace. Null while nothing is booked.
      window: null,
      // A pending activation request awaiting the controlling Position's
      // approval (§9.11: "coordination and approval must precede airspace
      // entry and exit"). Null when there is nothing outstanding.
      pendingRequest: null,
      // Append-only, same shape docs/adr/0032 gave fdr.airspace.transitions
      // and for the same reason — JO 7110.65 ¶2-3-1's "do not erase or
      // overwrite any item". An after-action review has to be able to say
      // when the block went hot and who approved it, not just where it is now.
      transitions: [],
      updatedAt: null,
      updatedBy: null,
    });
  }

  get currentSeq() { return this._seq; }

  getAirspace(airspaceId) {
    const record = this._records.get(airspaceId);
    if (!record) return null;
    return { ...deepClone(record), definition: this._config.getAirspace(airspaceId) };
  }

  /** Every airspace, each merged with its static definition — what the client's board renders. */
  getAll() {
    return [...this._records.keys()].map(id => this.getAirspace(id));
  }

  _touch(record, by, transition) {
    record.rev += 1;
    record.updatedAt = Date.now();
    record.updatedBy = by || null;
    this._seq += 1;
    if (transition) record.transitions.push({ ...transition, at: record.updatedAt, by: by || null });
  }

  /**
   * The one entry point for every airspace op, mirroring BoardStore's
   * applyMutation: never throws, always returns a result the caller can turn
   * into an ack. Optimistic concurrency on the record's own rev.
   *
   * @param {{airspaceId:string, baseRev:number, op:{kind:string}}} mutation
   * @param {string} actingPositionId — already verified by efsp-ws.js to be a
   *   Position the calling session is Primary at (docs/adr/0029)
   * @param {string} by — controllerId, for the audit trail
   */
  apply(mutation, actingPositionId, by) {
    const record = this._records.get(mutation.airspaceId);
    if (!record) return { ok: false, reason: 'NOT_FOUND' };
    const definition = this._config.getAirspace(mutation.airspaceId);
    if (!definition) return { ok: false, reason: 'NOT_FOUND' };
    if (mutation.baseRev !== undefined && mutation.baseRev !== null && record.rev !== mutation.baseRev) {
      return { ok: false, reason: 'STALE_REV', airspace: this.getAirspace(mutation.airspaceId) };
    }

    const op = mutation.op || {};
    let result;
    try {
      switch (op.kind) {
        case 'ScheduleAirspace':  result = this._schedule(record, definition, op, actingPositionId, by); break;
        case 'RequestActivation': result = this._requestActivation(record, definition, op, actingPositionId, by); break;
        case 'ApproveActivation': result = this._approveActivation(record, definition, op, actingPositionId, by); break;
        case 'DenyActivation':    result = this._denyActivation(record, definition, op, actingPositionId, by); break;
        case 'ReleaseAirspace':   result = this._release(record, definition, op, actingPositionId, by); break;
        case 'ReturnAirspace':    result = this._return(record, definition, op, actingPositionId, by); break;
        default:
          result = { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown airspace op: ${op.kind}` };
      }
    } catch (err) {
      // Same backstop as BoardStore.applyMutation, for the same reason: one
      // bad op must never take the process down for every connected client.
      console.error('[airspace-store] unexpected error applying an airspace op — rejecting it instead of crashing:', err);
      result = { ok: false, reason: 'VALIDATION_ERROR', detail: 'internal error processing airspace op' };
    }

    // Every result carries the record, success or not — the client renders
    // from the ack either way, and a rejection that says nothing about the
    // current state leaves the board showing whatever the client last
    // guessed. Handlers that already attached one (the permission and
    // illegal-transition paths) keep theirs.
    if (!result.airspace) result.airspace = this.getAirspace(mutation.airspaceId);
    return result;
  }

  // ── authority ──────────────────────────────────────────────────────────
  //
  // §9.11's split, generalized: the guide says activation authority sits with
  // APP because it assumes a RAPCON-owned range complex. Here each airspace
  // names its own controlling Position, so a MOA inside Ankara Center's
  // airspace is approved by CTR rather than by an Approach that does not own
  // it. The using agency schedules and releases; the controlling agency
  // approves and takes it back.

  _isControlling(definition, actingPositionId) {
    return definition.controllingPositionId === actingPositionId;
  }

  /**
   * An airspace with no `usingPositionId` — an ordinary MOA with no control
   * of its own — has no second party, so its controlling Position acts for
   * both sides. That is not a special case bolted on; it is the common one.
   */
  _isUsing(definition, actingPositionId) {
    if (definition.usingPositionId) return definition.usingPositionId === actingPositionId;
    return this._isControlling(definition, actingPositionId);
  }

  _denied(record, detail) {
    return { ok: false, reason: 'PERMISSION_DENIED', detail, airspace: this.getAirspace(record.airspaceId) };
  }

  _illegal(record, toState) {
    return {
      ok: false, reason: 'VALIDATION_ERROR',
      detail: `an airspace at ${record.state} cannot go to ${toState}`,
      airspace: this.getAirspace(record.airspaceId),
    };
  }

  _canGo(record, toState) {
    return (LEGAL_TRANSITIONS[record.state] || []).includes(toState);
  }

  // ── ops ────────────────────────────────────────────────────────────────

  _schedule(record, definition, op, actingPositionId, by) {
    if (!this._isUsing(definition, actingPositionId) && !this._isControlling(definition, actingPositionId)) {
      return this._denied(record, `${actingPositionId} neither uses nor controls ${definition.name}`);
    }
    if (!this._canGo(record, 'SCHEDULED')) return this._illegal(record, 'SCHEDULED');
    const { fromUtc, toUtc } = op;
    if (typeof fromUtc !== 'number' || typeof toUtc !== 'number' || !(toUtc > fromUtc)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'a schedule needs fromUtc and toUtc, with toUtc after fromUtc', airspace: this.getAirspace(record.airspaceId) };
    }
    record.state = 'SCHEDULED';
    record.window = { fromUtc, toUtc };
    record.pendingRequest = null;
    this._touch(record, by, { state: 'SCHEDULED', actingPositionId, window: { fromUtc, toUtc } });
    return { ok: true };
  }

  _requestActivation(record, definition, op, actingPositionId, by) {
    if (!this._isUsing(definition, actingPositionId)) {
      return this._denied(record, `${actingPositionId} is not the using agency for ${definition.name}`);
    }
    if (record.state !== 'SCHEDULED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'only a SCHEDULED airspace can be requested for activation', airspace: this.getAirspace(record.airspaceId) };
    }
    if (record.pendingRequest) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'an activation request is already outstanding', airspace: this.getAirspace(record.airspaceId) };
    }
    record.pendingRequest = {
      requestedBy: by || null, requestedPositionId: actingPositionId,
      requestedAt: Date.now(), note: op.note || null,
    };
    // Not a state transition — the airspace stays SCHEDULED until approved —
    // so this is deliberately not appended to `transitions`, which records
    // where the airspace has been rather than what was asked for.
    this._touch(record, by, null);
    return { ok: true };
  }

  _approveActivation(record, definition, op, actingPositionId, by) {
    if (!this._isControlling(definition, actingPositionId)) {
      return this._denied(record, `only ${definition.controllingPositionId} may approve activation of ${definition.name}`);
    }
    if (!this._canGo(record, 'ACTIVE')) return this._illegal(record, 'ACTIVE');
    // An airspace with its own using agency must actually have asked. One
    // without has no second party to ask, so its controlling Position
    // activates directly — the ordinary-MOA case.
    if (definition.usingPositionId && !record.pendingRequest) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no activation request is outstanding', airspace: this.getAirspace(record.airspaceId) };
    }
    const request = record.pendingRequest;
    record.state = 'ACTIVE';
    record.pendingRequest = null;
    this._touch(record, by, {
      state: 'ACTIVE', actingPositionId,
      // A boundary event between two Positions held by one controller is a
      // self-coordination (§4.8.3): the state change is mandatory and
      // unconditional, only the two-party dialogue collapses. Recorded so the
      // audit trail distinguishes it from a genuine two-party approval.
      selfCoordinated: !!(request && request.requestedBy && request.requestedBy === (by || null)),
    });
    return { ok: true };
  }

  _denyActivation(record, definition, op, actingPositionId, by) {
    if (!this._isControlling(definition, actingPositionId)) {
      return this._denied(record, `only ${definition.controllingPositionId} may act on activation of ${definition.name}`);
    }
    if (!record.pendingRequest) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no activation request is outstanding', airspace: this.getAirspace(record.airspaceId) };
    }
    record.pendingRequest = null;
    record.lastDenial = { deniedBy: by || null, deniedAt: Date.now(), reason: op.reason || null };
    this._touch(record, by, null);
    return { ok: true };
  }

  _release(record, definition, op, actingPositionId, by) {
    if (!this._isUsing(definition, actingPositionId)) {
      return this._denied(record, `${actingPositionId} is not the using agency for ${definition.name}`);
    }
    if (!this._canGo(record, 'RELEASED')) return this._illegal(record, 'RELEASED');

    // Releasing a block somebody is still working is allowed — the
    // controller may well know the flight is clear and the board simply has
    // not caught up, which is the same judgement §9.11 makes about entering
    // an unactivated one. But it must say so: those flights are still on the
    // block's frequency, and from this moment the panel considers them to be
    // in airspace nobody holds, which is exactly the condition
    // UNACTIVATED_AIRSPACE_ENTRY then alerts on.
    const occupied = this._occupancyFor(record.airspaceId);
    record.state = 'RELEASED';
    this._touch(record, by, { state: 'RELEASED', actingPositionId, occupiedAtRelease: occupied });
    return occupied > 0 ? { ok: true, warning: 'AIRSPACE_STILL_OCCUPIED', occupied } : { ok: true };
  }

  _return(record, definition, op, actingPositionId, by) {
    if (!this._isControlling(definition, actingPositionId)) {
      return this._denied(record, `only ${definition.controllingPositionId} may take ${definition.name} back`);
    }
    if (!this._canGo(record, 'RETURNED')) return this._illegal(record, 'RETURNED');
    record.state = 'RETURNED';
    record.window = null;
    record.pendingRequest = null;
    this._touch(record, by, { state: 'RETURNED', actingPositionId });
    return { ok: true };
  }

  /** Is this airspace currently released to the using agency? Read by the unactivated-entry alert. */
  isActive(airspaceId) {
    const record = this._records.get(airspaceId);
    return !!(record && record.state === 'ACTIVE');
  }

  // ── Persistence (durable per docs/adr/0002) ─────────────────────────────
  //
  // Only the mutable state is persisted; the definitions come from config on
  // every boot. An airspace removed from config simply stops being restored,
  // and one added starts at RETURNED — no migration either way.
  snapshot() { return [...this._records.values()].map(deepClone); }

  restore(data) {
    for (const saved of data || []) {
      if (!this._records.has(saved.airspaceId)) continue; // dropped from config since
      this._records.set(saved.airspaceId, deepClone(saved));
    }
  }
}

module.exports = { AirspaceStore, AIRSPACE_STATES, LEGAL_TRANSITIONS, INITIAL_STATE };
