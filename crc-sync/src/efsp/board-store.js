'use strict';

// Server-authoritative Strip/Bay/Rack aggregate — the Board
// (EFSPImplementationGuide.md §2, §5). Strip set mechanics (revisions,
// ordering, ownership, ring-buffer resync) are modelled closely on
// TrackStore's snapshot+delta-log shape (src/tracks.js).
//
// BoardStore is a facade (docs/adr/0095): it keeps the Board's public API and delegates the work to collaborators.
//   board/board-state.js  the kernel: the Strip map, the seq/ring, the epoch, the touched set (`observeTouches`)
//   board/placement.js    order keys, Bays and Racks
//   board/strip-ops.js    dispatch of a Mutation to its op, the NLA, retirement; the ops are in board/ops/
//   board/coordination.js, board/tofi.js   cross-Facility coordination and TOFI
//   board/persistence.js  snapshot, restore, archive, the persisted replay window
//   board/audit.js        the Mutation-log entries
// Flight data and Position staffing are NOT part of this ring buffer: there are few of each, so efsp-ws.js
// includes flightDataStore.getAll()/positionStore.getAll() in full on every snapshot AND delta message, rather
// than building a second/third ring buffer for state this small. Revisit only if that stops being cheap.
//
// Rule decisions (block routing, Bay-implies-state, NLA, staffing/
// consolidation) are deliberately NOT known to this module — they're
// injected as `rules` functions from the composition root (index.js),
// which is what actually knows the Departure Block Map (block-map.js),
// facility Bay config (facility-config.js), the NLA table (nla.js), and
// Position staffing (position-store.js). This file only knows Strip/Rack/
// Mutation mechanics.
//
// Ordering deviates slightly from the implementation plan's first-pass
// Mutation shape: MoveStrip/TransferStrip/CreateStrip carry neighbor Strip
// references (afterStripId/beforeStripId), not a raw orderKey string — the
// server (the only thing that has order-key.js) resolves the actual key via
// keyBetween(), so the client never needs to reimplement fractional-index
// math in a second language. "orderKey is server-authoritative" (guide
// §5.4) taken literally.

const { deepClone } = require('./board/strip-util');
const { WALL_CLOCK } = require('../mission-clock');
const { NLA_GUARD_MS } = require('./board/ops/invoke-nla');
const { BoardState } = require('./board/board-state');
const { assertRules } = require('./required-rules');
const { BoardAudit } = require('./board/audit');
const { Placement } = require('./board/placement');
const { Coordination } = require('./board/coordination');
const { Tofi } = require('./board/tofi');
const { HandoffControl } = require('./board/handoff-control');
const { StripOps } = require('./board/strip-ops');
const { BoardPersistence } = require('./board/persistence');
const OPS = require('./board/ops');
const { initialStateFor, replicaOnReceipt, senderStateOnAccept } = require('./authority');
const { ReplayCache, replayRecord, REPLAY_PERSIST_WINDOW_MS } = require('./sync/replay-cache');
const { UndoHistory, undoEnv } = require('./undo/undo-history');
const log = require('../log').logger('efsp:board-store');

class BoardStore {
  /**
   * @param {import('./flight-data-store').FlightDataStore} flightDataStore
   * @param {object} rules
   * @param {(blockId:string, stripType:string) => {kind:'flightData',path:string}|{kind:'annotation'}|null} rules.resolveBlockTarget
   * @param {(bayId:string) => string|null} rules.bayHoldsStripType the strip type a Bay is reserved for (docs/adr/0087), or null
   * @param {(bayId:string) => string|null} rules.bayImpliesState
   * @param {(positionId:string, state:string) => {bayId:string,rackIds:string[]}|null} rules.bayForImpliedState
   * @param {(strip:object, flightData:object, now:number, ctx:object) => {toState:string,transferTo?:string}|{inhibited:string}|null} rules.computeNla
   * @param {(positionId:string) => boolean} rules.isStaffed
   * @param {(positionId:string) => string|null} rules.consolidatedAt
   * @param {(state:string, stripType:string) => boolean} rules.isValidState
   * @param {(stripType:string) => boolean} rules.isValidStripType
   * @param {(actingPositionId:string, stripType:string) => boolean} rules.canCreateStripType
   * @param {string} rules.facilityId — this Board's own Facility id (docs/adr/0013)
   * @param {(facilityId:string) => BoardStore|null} rules.peerBoard — the OTHER Facility's BoardStore instance, for cross-Facility coordination (docs/adr/0015)
   * @param {(positionId:string) => {bayId:string,rackIds:string[]}|null} rules.coordinationBayFor
   * @param {(primitive:string) => object|null} rules.coordinationEffect — guide §4.6's primitive table (coordination.js)
   * @param {object} [opts]
   * @param {import('./undo/undo-history').UndoHistory} [opts.undoHistory] the process's one undo history (createEfsp
   *   shares one across the Boards, docs/adr/0100); a Board built alone gets its own on the wall clock
   * @param {(strip:object) => boolean} [opts.airborneObserver] who vouches that a Strip's aircraft is observed airborne (the hint
   *   monitor's AIRBORNE_ADVANCE); unset, no SetState is ever let past the runway gate
   */
  constructor(flightDataStore, rules, { clock = WALL_CLOCK, wallClock = WALL_CLOCK, nlaGuard = { ms: NLA_GUARD_MS }, undoHistory = null, mutationLog = null, airborneObserver = undefined, controlInvariantMode = () => (process.env.CRCSYNC_CONTROL_INVARIANT === 'throw' ? 'throw' : 'repair') } = {}) {
    // The mission clock (docs/adr/0079). Every Strip timestamp, every NLA gate
    // and every Mutation-log `at` reads it. The one exception is the NLA
    // double-tap/Undo latch below, which is a UI debounce measured in real
    // seconds and never shown as a time of day — see board/ops/invoke-nla.js's _applyInvokeNla.
    // It reads the injected wall clock (docs/adr/0096), and `nlaGuard.ms` is its length (a shared, mutable cell: the e2e harness sets it).
    assertRules(rules); // a rule the Board reads and the caller omitted is a start-up error, not a check that is silently off
    this._clock = clock;
    this._wallNowFn = () => wallClock.now();
    this._flightDataStore = flightDataStore;
    this._rules = rules;
    // The kernel (docs/adr/0095): the Strip map, the seq/log ring, the epoch,
    // the touched set and the cid counter. Every touch goes through its recordTouch;
    // observeTouches(fn) sees them all (tools/soak/host-core.js).
    this._state = new BoardState({ clock });
    // docs/adr/0100: every touch is attributed by the undo history (a rebalance's are placement-only).
    this._undoHistory = undoHistory || this._ownUndoHistory(flightDataStore, rules);
    this._state.setTouchHook((id, { unobserved }) => this._undoHistory.observe({ facilityId: rules.facilityId, kind: 'strip', id, unobserved }));
    const touch = (id, opts) => this._state.recordTouch(id, opts);
    this._replay = ReplayCache.forBoard(); // clientMutationId -> compact frozen replay record (replayRecord), idempotency (§5.2, docs/adr/0081)
    this._mutationLog = mutationLog; // the process's Mutation log; null for a Board built alone (a fixture)
    // The Mutation-log entries for a client Mutation and a peer write (board/audit.js).
    this._audit = new BoardAudit({ rules, clock, mutationLog });
    // Order keys and Bays (board/placement.js). touch is the kernel's recordTouch; rebalanceRack is late-bound to the
    // facade (host-core wraps it); rejectedReplicaRefusal is StripOps' (board/strip-ops.js).
    this._placement = new Placement({
      state: this._state, rules, clock, flightDataStore,
      touch,
      rebalanceRack: (bayId, rackId, excludeStripId) => this._rebalanceRack(bayId, rackId, excludeStripId),
      rejectedReplicaRefusal: (strip, toState) => this._stripOps.rejectedReplicaRefusal(strip, toState),
    });
    this._activeCmid = null;  // the clientMutationId being applied, while applyMutation runs
    // Cross-Facility coordination and TOFI (board/coordination.js, board/tofi.js). touch is the kernel's
    // recordTouch; retire is late-bound to StripOps' `retire`, activeCmid and mutationLog are read late,
    // and the per-strip-type tables are the authority registry's accessors (authority/index.js), passed in.
    // Communications, ControlRelease and transfer of control inside a HANDOFF, and the control invariant (docs/adr/0101).
    // CRCSYNC_CONTROL_INVARIANT=throw makes a violation throw (the tests); otherwise it repairs and alerts.
    this._control = new HandoffControl({
      rules, state: this._state, audit: this._audit, clock, flightDataStore,
      activeCmid: () => this._activeCmid,
      mutationLog,
      invariantMode: controlInvariantMode,
    });
    this._coordination = new Coordination({
      rules, state: this._state, audit: this._audit, placement: this._placement, clock, flightDataStore,
      touch,
      activeCmid: () => this._activeCmid,
      retire: (strip, by) => this._stripOps.retire(strip, by),
      control: this._control,
      replicaOnReceipt,
      senderStateOnAccept,
    });
    this._tofi = new Tofi({
      rules, state: this._state, audit: this._audit, placement: this._placement, clock, flightDataStore,
      touch,
      activeCmid: () => this._activeCmid,
      retire: (strip, by) => this._stripOps.retire(strip, by),
      initialStateFor,
    });
    // stripId -> { invokedAt, prevState, expiresAt } — the 400ms double-tap
    // guard and the 30s Undo window for the last NLA transition (§3.5
    // rules 3 and 5). Deliberately NOT part of the Strip's public shape
    // (not serialized/broadcast) and NOT persisted — losing a still-open
    // Undo window across a restart is an acceptable UX gap, not a
    // correctness or safety concern.
    this._nlaHistory = new Map();
    // Snapshot, restore, archive and when each DROPPED Strip dropped (board/persistence.js), which owns that Map.
    this._persistence = new BoardPersistence({
      rules, state: this._state, replay: this._replay, clock, wallClock, audit: this._audit,
      nlaHistory: () => this._nlaHistory,
    });
    // The Strip operations (board/strip-ops.js): the op table, NLA and retirement. The NLA history Map stays
    // here and BoardPersistence's droppedWallAt Map is its own (snapshot, restore and archiveStrip use them); both
    // are read late, because restore replaces them.
    this._stripOps = new StripOps({
      rules, state: this._state, audit: this._audit, placement: this._placement, clock, wallClock, nlaGuard, flightDataStore,
      coordination: this._coordination, control: this._control, tofi: this._tofi, ops: OPS,
      touch,
      activeCmid: () => this._activeCmid,
      nlaHistory: () => this._nlaHistory,
      droppedWallAt: () => this._persistence.droppedWallAt,
      initialStateFor,
      undoHistory: () => this._undoHistory,
      airborneObserver,
    });
  }

  /** A Board built alone (tests, tools): its own history over this Board and its peers. Flight data writes reach a history only through the store's `onWrite`. */
  _ownUndoHistory(flightDataStore, rules) {
    const history = new UndoHistory({ wallClock: { now: () => this._wallNowFn() } });
    history.attach(undoEnv({ boardFor: (f) => (f === rules.facilityId ? this : rules.peerBoard(f)), flightDataStore }));
    return history;
  }

  /** The undo history this Board reports to (docs/adr/0100). */
  get undoHistory() { return this._undoHistory; }

  /** A Strip's before-image for the undo history (board/strip-ops.js). */
  captureForUndo(stripId) { return this._stripOps.captureForUndo(stripId); }

  /** Whether `images` of this Board's Strips can be restored now (board/strip-ops.js checkRestore). */
  checkUndoRestore(images) { return this._stripOps.checkRestore(images); }

  /**
   * Another Facility's Undo restores this Board's Strips (docs/adr/0100 §3): the before-images go back, the records
   * that action created here are removed, and one `InterfacilityUndo` entry is written with `causedBy`.
   * @returns {{records: object[], gone: string[]}}
   */
  receiveUndoRestore({ causedBy, undoneActionId, fromFacilityId, images, removeIds = [], voidedBy, by }) {
    const r = this._stripOps.restoreImages(images, removeIds, { voidedBy, by });
    const [first, ...rest] = r.records;
    if (first && this._mutationLog) {
      this._mutationLog.record({
        clientMutationId: null, causedBy: causedBy || null, op: 'InterfacilityUndo',
        stripId: first.stripId, flightDataId: first.flightDataId, facilityId: this._rules.facilityId || null,
        fromFacilityId: fromFacilityId || null, actingPositionId: null, actorId: by || null, at: this._clock.now(),
        before: first.before, after: first.after, undoneActionId, records: rest, source: 'peer',
      });
    }
    return r;
  }


  get currentSeq() { return this._state.seq; }
  /** This Board lifetime's name (docs/adr/0081). A delta is valid only within one epoch. */
  get epoch() { return this._state.epoch; }
  getStrip(stripId) { return this._state.strips.get(stripId) || null; }
  getAll() { return this._state.all(); }

  /** Strips currently placed in a Bay/Rack, in order, excluding DROPPED (board/board-state.js rack()). */
  getRack(bayId, rackId) { return this._state.rack(bayId, rackId); }

  /** Rebalances one Rack (board/placement.js). Kept on the facade: tools/soak/host-core.js wraps it by name. */
  _rebalanceRack(bayId, rackId, excludeStripId) { return this._placement.rebalanceRack(bayId, rackId, excludeStripId); }

  /**
   * `fn(stripId)` after every touch on this Board, synchronously, after its ring entry, in registration order
   * (sync/sync-log.js). Never for an archive's `gone` entry. Returns a function that removes the observer.
   */
  observeTouches(fn) { return this._state.observeTouches(fn); }

  /** How many entries the Board's ring holds now (sync/sync-log.js prunes it past 2,000 to 1,000). */
  get ringLength() { return this._state.log.length; }

  // Kept on the facade for tools and tests (docs/adr/0095): tools/soak/host-core.js reads _strips and _cidSeq.
  get _strips() { return this._state.strips; }
  get _cidSeq() { return this._state.cidSeq; }

  /** The ids of every Strip touched since the last drain (board/board-state.js). */
  drainTouched() { return this._state.drainTouched(); }

  /** Delta resync (guide §5.6), within this Board lifetime (board/board-state.js). */
  getDeltaSince(afterSeq) { return this._state.getDeltaSince(afterSeq); }

  // ── Mutation application ─────────────────────────────────────────────────

  /**
   * Applies a client Mutation (guide §5.2). Returns
   *   { ok:true, strip, flightData?, warnings?, routedTo? }
   * or
   *   { ok:false, reason, strip? }
   * Never throws for an ordinary rejection.
   */
  applyMutation(mutation, actingPositionId, by) {
    const cmid = mutation.clientMutationId;
    const keyed = typeof cmid === 'string' && cmid !== '';
    const cached = keyed ? this._replay.get(null, cmid) : null;
    if (cached) {
      return this._replayResult(cached); // idempotent replay, §5.2
    }

    // This is the ONE choke point every Mutation flows through (guide's
    // "Mutations, not state" architecture), so it's where "never throws"
    // above actually has to be enforced, not just documented — an
    // unexpected exception anywhere inside `StripOps#dispatch` must become a
    // rejection for the ONE Mutation that triggered it, never an uncaught
    // exception that crashes the process for every connected controller.
    // Found in production: a MoveStrip crashed the whole server via an
    // edge case in order-key.js's keyBetween() (see that file's fix) —
    // that specific cause is now handled properly, but this catch is the
    // backstop for whatever the NEXT one turns out to be. Still logged
    // loudly, since reaching here at all means a real bug exists somewhere.
    let result;
    this._activeCmid = keyed ? cmid : null; // what a peer Board's entry names as its cause (docs/adr/0083)
    try {
      result = this._stripOps.dispatch(mutation, actingPositionId, by);
    } catch (err) {
      log.error('unexpected error applying Mutation — rejecting it instead of crashing', { err });
      result = { ok: false, reason: 'INTERNAL_ERROR', detail: 'internal error processing mutation' };
      // An op that threw may already have written (docs/wip/SERVER-BUGS.md, B3). Those writes cannot be taken back in
      // general (the undo frame holds before-images only for a scoped op, and a peer Board or MARSA may have changed
      // too), so the throw is treated as a crash: what changed is audited, and the caller persists it (`partial`).
      if (this._state.hasTouched()) {
        result.partial = true;
        this._audit.recordInternalError(mutation, actingPositionId, by, this.getStrip(mutation.stripId), err);
      }
    } finally {
      this._activeCmid = null;
    }

    if (keyed) this._replay.set(null, cmid, replayRecord(result, this._wallNowFn()));
    return result;
  }

  /** Whether this clientMutationId is in the idempotency cache — index.js's boot reconcile asks (docs/adr/0081). */
  hasApplied(cmid) { return this._replay.has(null, cmid); }

  /** The idempotency cache's Map (sync/replay-cache.js), for tools and tests that measure it. */
  get _appliedMutations() { return this._replay.map; }

  /**
   * A replay's answer (docs/adr/0081): the ORIGINAL outcome with the records
   * as they are NOW. The cache holds ids, never a Strip or flight data, so a replay
   * of a refusal cannot send a client backwards (L6's F11) and an archived
   * Strip is not kept alive by the cache (F4). `replayed: true` tells
   * efsp-ws.js to ack only — the original broadcasts already went out, and
   * marsaChanged/flightDataList/peerStrip are deliberately not rebuilt.
   */
  _replayResult(record) {
    const out = { ok: record.ok, replayed: true };
    for (const k of ['reason', 'detail', 'warnings', 'routedTo', 'selfCoordinated', 'peerFacilityId']) {
      if (record[k] !== null) out[k] = record[k];
    }
    if (record.stripId) out.strip = this.getStrip(record.stripId);
    if (record.flightDataId) out.flightData = this._flightDataStore.getFlightData(record.flightDataId);
    return out;
  }

  /**
   * What pressing this Strip's NLA button would do RIGHT NOW (board/strip-ops.js).
   * efsp-ws.js stamps the result onto every Strip record it puts on the wire.
   */
  nlaStatusFor(strip, now = this._clock.now()) { return this._stripOps.nlaStatusFor(strip, now); }


  // ── Peer calls (rules.peerBoard) ────────────────────────────────────────
  // A peer Facility's Board calls these on THIS facade; the work is board/coordination.js and board/tofi.js.
  // They stay own methods because the soak host wraps them by name (tools/soak/host-core.js).

  /** Proposer cancelled (board/coordination.js). */
  receiveCoordinationCancel(args) { return this._coordination.receiveCoordinationCancel(args); }

  /** The receiver's replica reached DROPPED (board/coordination.js). */
  receiveCoordinationPeerGone(args) { return this._coordination.receiveCoordinationPeerGone(args); }

  /** A coordination primitive was PROPOSEd against this Facility (board/coordination.js). */
  receiveCoordinationProposal(args) { return this._coordination.receiveCoordinationProposal(args); }

  /** The receiver ACCEPTed, REJECTed or stood by (board/coordination.js). */
  receiveCoordinationResponse(args) { return this._coordination.receiveCoordinationResponse(args); }

  /** The other half of a HANDOFF's record changed: comms, control, release, request (board/handoff-control.js). */
  receiveHandoffRecord(args) { return this._control.receiveHandoffRecord(args); }

  /** Is this Strip's owner staffed, or consolidated into a staffed Position? A peer Board asks (the control invariant). */
  stripOwnerCovered(stripId) { return this._control.ownerCovered(this.getStrip(stripId)); }

  /** Does `positionId` hold what answering a `primitive` takes? A peer Board asks before minting a replica here (docs/adr/0101). */
  canTakeCoordination(positionId, primitive) { return this._rules.canMutateAction(positionId, primitive, 'ACCEPT'); }

  /** The control invariant for every live exchange Strip here (restore: `{staffing:false}`, nobody has signed on yet; a change of staffing); returns the repairs made. */
  reconcileExchanges(opts) { return this._control.reconcileExchanges(opts); }

  /** The violations of the control invariant for the exchange this Strip is half of (undo, the standing alert). */
  exchangeProblems(stripId) { return this._control.exchangeProblems(this.getStrip(stripId)); }

  /** The control invariant for the exchange this Strip is half of, after an undo restored it (board/ops/undo.js); returns the repairs made. */
  assertExchangeInvariant(stripId, by = null) {
    const strip = this.getStrip(stripId);
    return strip ? this._control.assertControlInvariant(strip, by) : [];
  }

  /** A TOFI ENTRY was proposed against this Facility (board/tofi.js). */
  receiveTofiProposal(args) { return this._tofi.receiveTofiProposal(args); }

  /** A TOFI EXIT was proposed against this Facility (board/tofi.js). */
  receiveTofiExitProposal(args) { return this._tofi.receiveTofiExitProposal(args); }

  /** The regime monitor's entry (board/tofi.js, docs/adr/0102): a system write on this Board's MISSION Strip. */
  markTofiEntered(flightDataId, info) { return this._tofi.markEnteredBySystem(flightDataId, info); }

  /** The MISSION side ACCEPTed, REJECTed or TRANSFER_COMMS'd (board/tofi.js). */
  receiveTofiResponse(args) { return this._tofi.receiveTofiResponse(args); }

  /**
   * System-initiated bulk reassignment of every non-DROPPED Strip owned by
   * `fromPositionId` to `toPositionId` — used when a Position becomes
   * fully unstaffed and its Strips must route down the consolidation chain
   * (guide §4.8.6 rule 2). Distinct from applyMutation()'s controller-
   * initiated TransferStrip: there is no controller "sending" this (the
   * Position itself vacated), so it bypasses the ownership/baseRev/
   * permission checks entirely and is audited as a system action rather
   * than attributed to any actingPositionId.
   * @returns {string[]} stripIds that were reassigned
   */
  reassignPositionStrips(fromPositionId, toPositionId) {
    const affected = this.getAll().filter(s => s.ownerPositionId === fromPositionId && s.state !== 'DROPPED');
    const unplaced = [];
    for (const strip of affected) {
      const before = deepClone(strip);
      strip.ownerPositionId = toPositionId;
      // F10: remember whose it was, so it goes back when that Position is taken
      // again (returnConsolidatedStrips). A Strip already consolidated keeps the first name.
      if (!strip.consolidatedFrom) strip.consolidatedFrom = fromPositionId;
      // B3: the Strip moves into the Bay of the Position it is consolidated at, or (no Bay
      // there fits) stays where it is and the caller says so.
      const bay = this._placement.bayForNewOwner(toPositionId, strip.state, strip);
      if (bay) {
        strip.bayId = bay.bayId;
        strip.rackId = bay.rackId;
        strip.orderKey = this._placement.appendOrderKey(bay.bayId, bay.rackId, strip.stripId);
      } else {
        unplaced.push(strip.stripId);
      }
      this._state.bump(strip, null);
      this._control.followOwner(strip, null); // control follows the owner (docs/adr/0101 decision 7)
      this._audit.recordSystem('SystemReassign', strip, { before, after: deepClone(strip), reason: 'position-vacated' });
    }
    // `unplaced` rides along without being an element or an enumerable key.
    return Object.defineProperty(affected.map(s => s.stripId), 'unplaced', { value: unplaced });
  }

  /**
   * F10 (docs/adr/0080): `positionId` is staffed again, so the Strips that were
   * routed away from it to the Position it is consolidated at — which may not advance them
   * (PENDING_CLEARANCE is not GC's to advance) and which nothing ever returned
   * — go back, each into a Bay of the returning Position. Only a Strip still
   * owned by cover: a Strip anyone transferred on by decision has lost its
   * `consolidatedFrom` (board/ops/transfer-strip.js's _applyTransferStrip). Recorded like the reassignment.
   * @returns {string[]} stripIds returned
   */
  returnConsolidatedStrips(positionId) {
    const back = this.getAll().filter(s => s.consolidatedFrom === positionId && s.ownerPositionId !== positionId && s.state !== 'DROPPED');
    for (const strip of back) {
      const before = deepClone(strip);
      strip.ownerPositionId = positionId;
      delete strip.consolidatedFrom;
      const bay = this._placement.bayForNewOwner(positionId, strip.state, strip);
      if (bay) {
        strip.bayId = bay.bayId;
        strip.rackId = bay.rackId;
        strip.orderKey = this._placement.appendOrderKey(bay.bayId, bay.rackId, strip.stripId);
      }
      this._state.bump(strip, null);
      this._control.followOwner(strip, null);
      this._audit.recordSystem('SystemReassign', strip, { before, after: deepClone(strip), reason: 'position-retaken' });
    }
    return back.map(s => s.stripId);
  }

  /**
   * The mission reset (docs/adr/0108, decisions.md H108): the DCS mission rolled over, so every live Strip on this Board
   * ends. One system pass: each live Strip goes to DROPPED through `retire` (so its flight data, MARSA, carrier stack,
   * peer link and code are released exactly as a controller's Drop would), with one `MissionResetStrip` entry each (the
   * traffic count reads those, like any drop) and one `MissionReset` entry for the Board with the counts. Not a client
   * Mutation: no acting Position, no Undo. Refuses nothing: an active TOFI exchange ends with the flight.
   * @param {{session?: {seq?:number, reason?:string}|null}} [opts]
   * @returns {{facilityId:string|null, dropped:string[], flightDataIds:string[]}}
   */
  resetForMission({ session = null } = {}) {
    const live = this.getAll().filter(s => s.state !== 'DROPPED');
    const befores = new Map(live.map(s => [s.stripId, deepClone(s)]));
    for (const strip of live) {
      if (strip.state === 'DROPPED') continue;
      this._stripOps.retire(strip, 'system', { force: true });
    }
    const extra = { missionSession: session ? (session.seq ?? null) : null, sessionReason: session ? (session.reason ?? null) : null };
    const dropped = [];
    const flightDataIds = new Set();
    for (const strip of live) {
      if (strip.state !== 'DROPPED') continue;
      dropped.push(strip.stripId);
      flightDataIds.add(strip.flightDataId);
      this._audit.recordSystem('MissionResetStrip', strip, { before: befores.get(strip.stripId), after: deepClone(strip), reason: 'mission-reset', ...extra });
    }
    if (this._mutationLog) {
      this._mutationLog.record({
        clientMutationId: null, op: 'MissionReset', facilityId: this._rules.facilityId || null,
        actingPositionId: null, actorId: 'system', at: this._clock.now(),
        reason: 'mission-reset', strips: dropped.length, flightDataList: flightDataIds.size, ...extra,
      });
    }
    return { facilityId: this._rules.facilityId || null, dropped, flightDataIds: [...flightDataIds] };
  }

  /** When this DROPPED Strip dropped, in wall ms (board/persistence.js). Null for a live Strip. */
  droppedWallAtOf(stripId) { return this._persistence.droppedWallAtOf(stripId); }

  /** Archives one DROPPED Strip (board/persistence.js, docs/adr/0082). */
  archiveStrip(stripId, reason, extra = {}) {
    // docs/adr/0101 (I4): a transferring Strip that reached DROPPED by a path that skipped `retire` still hands what it
    // holds to the receiving side before it leaves memory; a no-op when its exchange is settled (the usual case).
    const strip = this.getStrip(stripId);
    if (strip && strip.state === 'DROPPED') this._control.onTransferringRetired(strip, 'system');
    return this._persistence.archiveStrip(stripId, reason, extra);
  }

  /** The Board snapshot (board/persistence.js; durable per ADR 0002). */
  snapshot() { return this._persistence.snapshot(); }
  restore(data) { return this._persistence.restore(data); }

  /** stripId -> wall ms of its drop (board/persistence.js), for tests. */
  get _droppedWallAt() { return this._persistence.droppedWallAt; }
}

module.exports = { BoardStore, REPLAY_PERSIST_WINDOW_MS };
