'use strict';

// Server-authoritative Strip/Bay/Rack aggregate — the Board
// (EFSPImplementationGuide.md §2, §5). Strip set mechanics (revisions,
// ordering, ownership, ring-buffer resync) are modelled closely on
// TrackStore's snapshot+delta-log shape (src/tracks.js).
//
// FDRs and Position occupancy are NOT part of this ring buffer: Phase 1 has
// at most a few dozen Strips/FDRs and four Positions, so efsp-ws.js just
// includes fdrStore.getAll()/positionStore.getAll() in full on every
// snapshot AND delta message, rather than building a second/third
// ring-buffer for state this small. Revisit only if that stops being cheap.
//
// Doctrinal decisions (block routing, Bay-implies-state, NLA, occupancy/
// covering-chain) are deliberately NOT known to this module — they're
// injected as `rules` functions from the composition root (index.js),
// which is what actually knows the Departure Block Map (block-map.js),
// facility Bay config (facility-config.js), the NLA table (nla.js), and
// Position occupancy (position-store.js). This file only knows Strip/Rack/
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
const { BoardState } = require('./board/board-state');
const { BoardAudit } = require('./board/audit');
const { Placement } = require('./board/placement');
const { Coordination } = require('./board/coordination');
const { Tofi } = require('./board/tofi');
const { StripOps } = require('./board/strip-ops');
const OPS = require('./board/ops');
const { initialStateFor, replicaStateOnReceipt, senderStateOnAccept } = require('./authority');
const { ReplayCache, replayRecord, REPLAY_PERSIST_WINDOW_MS } = require('./sync/replay-cache');
const log = require('../log').logger('efsp:board-store');

class BoardStore {
  /**
   * @param {import('./fdr-store').FdrStore} fdrStore
   * @param {object} rules
   * @param {(blockId:string, role:string) => {kind:'fdr',path:string}|{kind:'annotation'}|null} rules.resolveBlockTarget
   * @param {(bayId:string) => string|null} [rules.bayHoldsRole] the Role a Bay is reserved for (docs/adr/0087), or null
   * @param {(bayId:string) => string|null} [rules.bayImpliesState]
   * @param {(positionId:string, state:string) => {bayId:string,rackIds:string[]}|null} [rules.bayForImpliedState]
   * @param {(strip:object, fdr:object, now:number, ctx:object) => {toState:string,transferTo?:string}|{inhibited:string}|null} rules.computeNla
   * @param {(positionId:string) => boolean} rules.isOccupied
   * @param {(positionId:string) => string|null} rules.coveringPositionFor
   * @param {(state:string, role:string) => boolean} [rules.isValidState]
   * @param {(role:string) => boolean} [rules.isValidRole]
   * @param {(actingPositionId:string, role:string) => boolean} [rules.canCreateStripRole]
   * @param {string} [rules.facilityId] — WP4A: this Board's own Facility id (docs/adr/0013)
   * @param {(facilityId:string) => BoardStore|null} [rules.peerBoard] — WP4A: the OTHER Facility's BoardStore instance, for cross-Facility coordination (docs/adr/0015)
   * @param {(positionId:string) => {bayId:string,rackIds:string[]}|null} [rules.coordinationBayFor] — WP4A
   * @param {(primitive:string) => object|null} [rules.coordinationEffect] — WP4A, guide §4.6's primitive table (coordination.js)
   */
  constructor(fdrStore, rules, { clock = WALL_CLOCK } = {}) {
    // The mission clock (docs/adr/0079). Every Strip timestamp, every NLA gate
    // and every Mutation-log `at` reads it. The one exception is the NLA
    // double-tap/Undo latch below, which is a UI debounce measured in real
    // seconds and never shown as a time of day — see _applyInvokeNla.
    this._clock = clock;
    this._fdrStore = fdrStore;
    this._rules = rules;
    // The kernel (docs/adr/0095): the Strip map, the seq/log ring, the epoch,
    // the touched set and the cid counter. `touch` is late-bound to this._touch
    // so a patched _touch (tools/soak/host-core.js) sees every touch.
    this._state = new BoardState({ clock, touch: (id) => this._touch(id) });
    this._replay = ReplayCache.forBoard(); // clientMutationId -> compact frozen replay record (replayRecord), idempotency (§5.2, docs/adr/0081)
    this._mutationLog = null; // optional collaborator, see setMutationLog()
    // The Mutation-log entries for a client Mutation and a peer write (board/audit.js).
    // `mutationLog` is read late: setMutationLog() can come after construction.
    this._audit = new BoardAudit({ rules, clock, mutationLog: () => this._mutationLog });
    // Order keys and Bays (board/placement.js). touch and rebalanceRack are late-bound to the
    // facade (host-core patches both); rejectedReplicaRefusal is the NLA cluster's, still here.
    this._placement = new Placement({
      state: this._state, rules, clock, fdrStore,
      touch: (id) => this._touch(id),
      rebalanceRack: (bayId, rackId, excludeStripId) => this._rebalanceRack(bayId, rackId, excludeStripId),
      rejectedReplicaRefusal: (strip, toState) => this._stripOps.rejectedReplicaRefusal(strip, toState),
    });
    this._activeCmid = null;  // the clientMutationId being applied, while applyMutation runs
    // Cross-Facility coordination and TOFI (board/coordination.js, board/tofi.js). touch and retire are late-bound
    // to the facade (host-core patches _touch; retire is StripOps'), activeCmid and mutationLog are read late,
    // and the per-Role tables are the authority registry's accessors (authority/index.js), passed in.
    this._coordination = new Coordination({
      rules, state: this._state, audit: this._audit, placement: this._placement, clock, fdrStore,
      touch: (id) => this._touch(id),
      activeCmid: () => this._activeCmid,
      retire: (strip, by) => this._stripOps.retire(strip, by),
      mutationLog: () => this._mutationLog,
      replicaStateOnReceipt,
      senderStateOnAccept,
    });
    this._tofi = new Tofi({
      rules, state: this._state, audit: this._audit, placement: this._placement, clock, fdrStore,
      touch: (id) => this._touch(id),
      activeCmid: () => this._activeCmid,
      retire: (strip, by) => this._stripOps.retire(strip, by),
      initialStateFor,
    });
    // stripId -> { invokedAt, prevState, expiresAt } — the 400ms double-tap
    // guard and the 30s Undo window for the last NLA transition (§3.5
    // rules 3 and 5). Deliberately NOT part of the Strip's public shape
    // (not serialized/broadcast) and NOT persisted — losing a still-open
    // Undo window across a restart is an acceptable Phase-1 UX gap, not a
    // correctness or safety concern.
    this._nlaHistory = new Map();
    // stripId -> Date.now() at its drop: when a DROPPED Strip is archived
    // (docs/adr/0082, H36). Wall time on purpose, like the latch above: a
    // retention period is a storage lifetime, and the mission clock rewinds on
    // a reload (H11). Not a Strip field, so the wire is unchanged. Persisted.
    this._droppedWallAt = new Map();
    // The Strip operations (board/strip-ops.js): the op table, NLA and retirement. The two Maps above stay
    // here (snapshot, restore and archiveStrip use them) and are read late, because restore replaces them.
    this._stripOps = new StripOps({
      rules, state: this._state, audit: this._audit, placement: this._placement, clock, fdrStore,
      coordination: this._coordination, tofi: this._tofi, ops: OPS,
      touch: (id) => this._touch(id),
      activeCmid: () => this._activeCmid,
      nlaHistory: () => this._nlaHistory,
      droppedWallAt: () => this._droppedWallAt,
      initialStateFor,
    });
  }

  setMutationLog(mutationLog) { this._mutationLog = mutationLog; }

  get currentSeq() { return this._state.seq; }
  /** This Board lifetime's name (docs/adr/0081). A delta is valid only within one epoch. */
  get epoch() { return this._state.epoch; }
  getStrip(stripId) { return this._state.strips.get(stripId) || null; }
  getAll() { return this._state.all(); }

  /** Strips currently placed in a Bay/Rack, in order, excluding DROPPED (board/board-state.js rack()). */
  getRack(bayId, rackId) { return this._state.rack(bayId, rackId); }

  /** Rebalances one Rack (board/placement.js). Kept on the facade: tools/soak/host-core.js wraps it by name. */
  _rebalanceRack(bayId, rackId, excludeStripId) { return this._placement.rebalanceRack(bayId, rackId, excludeStripId); }

  // Kept on the facade for tools and tests until SYNC replaces them (docs/adr/0095):
  // tools/soak/host-core.js patches _touch and reads _log, _strips and _cidSeq.
  _touch(stripId) { this._state.recordTouch(stripId); }
  get _log() { return this._state.log; }
  get _strips() { return this._state.strips; }
  get _cidSeq() { return this._state.cidSeq; }

  /** The ids of every Strip touched since the last drain (board/board-state.js). */
  drainTouched() { return this._state.drainTouched(); }

  /** Delta resync (guide §5.6), within this Board lifetime (board/board-state.js). */
  getDeltaSince(afterSeq) { return this._state.getDeltaSince(afterSeq); }

  // ── Mutation application ─────────────────────────────────────────────────

  /**
   * Applies a client Mutation (guide §5.2). Returns
   *   { ok:true, strip, fdr?, warning?, routedTo? }
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
    // unexpected exception anywhere inside _dispatch() must become a
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
      result = { ok: false, reason: 'VALIDATION_ERROR', detail: 'internal error processing mutation' };
    } finally {
      this._activeCmid = null;
    }

    if (keyed) this._replay.set(null, cmid, replayRecord(result, Date.now()));
    return result;
  }

  /** Whether this clientMutationId is in the idempotency cache — index.js's boot reconcile asks (docs/adr/0081). */
  hasApplied(cmid) { return this._replay.has(null, cmid); }

  /** The idempotency cache's Map (sync/replay-cache.js), for tools and tests that measure it. */
  get _appliedMutations() { return this._replay.map; }

  /**
   * A replay's answer (docs/adr/0081): the ORIGINAL outcome with the records
   * as they are NOW. The cache holds ids, never a Strip or an FDR, so a replay
   * of a refusal cannot send a client backwards (L6's F11) and an archived
   * Strip is not kept alive by the cache (F4). `replayed: true` tells
   * efsp-ws.js to ack only — the original broadcasts already went out, and
   * marsaChanged/fdrs/peerStrip are deliberately not rebuilt.
   */
  _replayResult(record) {
    const out = { ok: record.ok, replayed: true };
    for (const k of ['reason', 'detail', 'warning', 'routedTo', 'selfCoordinated', 'peerFacilityId']) {
      if (record[k] !== null) out[k] = record[k];
    }
    if (record.stripId) out.strip = this.getStrip(record.stripId);
    if (record.fdrId) out.fdr = this._fdrStore.getFdr(record.fdrId);
    return out;
  }

  /**
   * What pressing this Strip's NLA button would do RIGHT NOW (board/strip-ops.js).
   * efsp-ws.js stamps the result onto every Strip record it puts on the wire.
   */
  nlaStatusFor(strip, now = this._clock.now()) { return this._stripOps.nlaStatusFor(strip, now); }

  /**
   * Who vouches that a Strip's aircraft is observed airborne (board/strip-ops.js). Unset, no
   * SetState is ever let past the runway gate.
   */
  setAirborneObserver(fn) { this._stripOps.setAirborneObserver(fn); }


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

  /** A TOFI ENTRY was proposed against this Facility (board/tofi.js). */
  receiveTofiProposal(args) { return this._tofi.receiveTofiProposal(args); }

  /** A TOFI EXIT was proposed against this Facility (board/tofi.js). */
  receiveTofiExitProposal(args) { return this._tofi.receiveTofiExitProposal(args); }

  /** The MISSION side ACCEPTed, REJECTed or TRANSFER_COMMS'd (board/tofi.js). */
  receiveTofiResponse(args) { return this._tofi.receiveTofiResponse(args); }

  /**
   * System-initiated bulk reassignment of every non-DROPPED Strip owned by
   * `fromPositionId` to `toPositionId` — used when a Position becomes
   * fully unoccupied and its Strips must route down the covering chain
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
      // again (returnCoveredStrips). A Strip already covered keeps the first name.
      if (!strip.coveredFrom) strip.coveredFrom = fromPositionId;
      // B3: the Strip moves into the covering Position's own Bay, or (no Bay
      // there fits) stays where it is and the caller says so.
      const bay = this._placement.bayForNewOwner(toPositionId, strip.state, strip);
      if (bay) {
        strip.bayId = bay.bayId;
        strip.rackId = bay.rackId;
        strip.orderKey = this._placement.appendOrderKey(bay.bayId, bay.rackId, strip.stripId);
      } else if (this._rules.baysFor) {
        unplaced.push(strip.stripId);
      }
      this._state.bump(strip, null);
      if (this._mutationLog) {
        this._mutationLog.record({
          clientMutationId: null, op: 'SystemReassign', stripId: strip.stripId,
        facilityId: this._rules.facilityId || null, fdrId: strip.fdrId || null,
          actingPositionId: null, actorId: 'system', at: this._clock.now(),
          before, after: deepClone(strip), reason: 'position-vacated',
        });
      }
    }
    // `unplaced` rides along without being an element or an enumerable key.
    return Object.defineProperty(affected.map(s => s.stripId), 'unplaced', { value: unplaced });
  }

  /**
   * F10 (docs/adr/0080): `positionId` is occupied again, so the Strips that were
   * routed away from it to a covering Position — which may not advance them
   * (PENDING_CLEARANCE is not GND's to advance) and which nothing ever returned
   * — go back, each into a Bay of the returning Position. Only a Strip still
   * owned by cover: a Strip anyone transferred on by decision has lost its
   * `coveredFrom` (_applyTransferStrip). Recorded like the reassignment.
   * @returns {string[]} stripIds returned
   */
  returnCoveredStrips(positionId) {
    const back = this.getAll().filter(s => s.coveredFrom === positionId && s.ownerPositionId !== positionId && s.state !== 'DROPPED');
    for (const strip of back) {
      const before = deepClone(strip);
      strip.ownerPositionId = positionId;
      delete strip.coveredFrom;
      const bay = this._placement.bayForNewOwner(positionId, strip.state, strip);
      if (bay) {
        strip.bayId = bay.bayId;
        strip.rackId = bay.rackId;
        strip.orderKey = this._placement.appendOrderKey(bay.bayId, bay.rackId, strip.stripId);
      }
      this._state.bump(strip, null);
      if (this._mutationLog) {
        this._mutationLog.record({
          clientMutationId: null, op: 'SystemReassign', stripId: strip.stripId,
        facilityId: this._rules.facilityId || null, fdrId: strip.fdrId || null,
          actingPositionId: null, actorId: 'system', at: this._clock.now(),
          before, after: deepClone(strip), reason: 'position-retaken',
        });
      }
    }
    return back.map(s => s.stripId);
  }

  /**
   * When this DROPPED Strip dropped, in wall ms (docs/adr/0082). A Strip that
   * reached DROPPED by a path other than _retireStrip (a refused TOFI's minted
   * Strip, a SetState) is stamped the first time anyone asks, so it is
   * archived at most one sweep late rather than never. Null for a live Strip.
   */
  droppedWallAtOf(stripId) {
    const strip = this._state.strips.get(stripId);
    if (!strip || strip.state !== 'DROPPED') {
      this._droppedWallAt.delete(stripId);
      return null;
    }
    if (!this._droppedWallAt.has(stripId)) this._droppedWallAt.set(stripId, Date.now());
    return this._droppedWallAt.get(stripId);
  }

  /**
   * Archives one DROPPED Strip (docs/adr/0082, H36): it leaves memory and the
   * snapshot, and the Mutation log keeps its history. Nothing archived comes
   * back — an Undo of its drop is NOT_FOUND, like any Mutation on it. The
   * archiver (archiver.js) decides WHEN; this only does it.
   *
   * The ring gets a `gone` entry, so the archive advances the Board's seq and
   * a resync from before it reports the Strip in getDeltaSince's `gone`.
   * @param {string} stripId
   * @param {string} reason 'AGE' | 'MISSION_CHANGE'
   * @param {object} [extra] fields added to the audit line (e.g. the session)
   * @returns {string|null} the Strip's fdrId, or null when it was not a DROPPED Strip here
   */
  archiveStrip(stripId, reason, extra = {}) {
    const strip = this._state.strips.get(stripId);
    if (!strip || strip.state !== 'DROPPED') return null;
    this._state.strips.delete(stripId);
    this._droppedWallAt.delete(stripId);
    this._nlaHistory.delete(stripId);
    this._state.logGone(stripId);
    if (this._mutationLog) {
      this._mutationLog.record({
        clientMutationId: null, op: 'Archive', stripId, fdrId: strip.fdrId || null,
        // L26 (decisions.md S-L5) puts facilityId on every Board entry; this
        // line carries it from the start.
        facilityId: this._rules.facilityId || null,
        actingPositionId: null, actorId: 'system', at: this._clock.now(), reason, ...extra,
      });
    }
    return strip.fdrId || null;
  }

  // ── Persistence (durable per ADR 0002 — mission reload must NOT clear this) ──
  snapshot() {
    // `replay`: the idempotency records of the last REPLAY_PERSIST_WINDOW_MS,
    // so a retry after a restart answers from the cache instead of applying a
    // second time (docs/adr/0081, L6's F5 mode A). Compact records only.
    const horizon = Date.now() - REPLAY_PERSIST_WINDOW_MS;
    const replay = this._replay.windowSince(horizon);
    return { strips: this.getAll(), cidSeq: this._state.cidSeq, replay, droppedWallAt: [...this._droppedWallAt] };
  }
  restore(data) {
    this._state.replaceStrips(new Map((data?.strips || []).map(s => [s.stripId, s])));
    // A restored Board is a new lifetime: the ring and the seq did not come
    // back, so no seq a client holds from before can be served a delta.
    this._state.newEpoch();
    // A snapshot written before docs/adr/0045 carries a per-Strip
    // `correlation` field. Dropped rather than migrated: it was always the
    // inert `{ state: 'UNCORRELATED' }` placeholder, so there is nothing in it
    // to carry forward, and leaving it would put a second, stale answer to
    // "which contact is this" next to the real one — which is the defect the
    // key change removes, preserved through a restore.
    for (const strip of this._state.strips.values()) delete strip.correlation;
    this._state.setCidSeq(data?.cidSeq || 0);
    // The persisted slice of the idempotency cache (docs/adr/0081). It used to
    // be dropped here, so a CreateStrip whose ack died with the process was
    // created twice on retry (L6's F5). Loaded whole: the snapshot already cut
    // it to the retry window, and index.js's boot reconcile needs every record
    // that was persisted to tell a persisted Mutation from an unpersisted one.
    // It ages out through the cap and the next snapshot's window.
    this._replay.load(data?.replay);
    // docs/adr/0082 — when each DROPPED Strip dropped. One restored with no
    // entry (a snapshot written before it) starts its 2 h now: it was counted
    // before it was persisted (L5 backfills from the log at boot anyway).
    const dropped = new Map(Array.isArray(data?.droppedWallAt) ? data.droppedWallAt : []);
    this._droppedWallAt = new Map();
    const restoredAt = Date.now();
    for (const strip of this._state.strips.values()) {
      if (strip.state !== 'DROPPED') continue;
      const at = dropped.get(strip.stripId);
      this._droppedWallAt.set(strip.stripId, Number.isFinite(at) ? at : restoredAt);
    }
  }
}

module.exports = { BoardStore, REPLAY_PERSIST_WINDOW_MS };
