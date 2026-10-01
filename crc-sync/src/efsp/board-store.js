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

const crypto = require('crypto');
const { newFlags, _validateAltitudeBlock, deepClone, _frequencyFromBlockValue } = require('./board/strip-util');
const { MAX_FREE_TEXT } = require('./fdr-store');
const { WALL_CLOCK } = require('../mission-clock');
const { BoardState } = require('./board/board-state');
const { BoardAudit } = require('./board/audit');
const { Placement } = require('./board/placement');
const { Coordination } = require('./board/coordination');
const { Tofi } = require('./board/tofi');
const { runwayInhibitFor, RUNWAY_GATED_STATES } = require('./field-state');
const { CARRIER_TRANSFER_EFFECTS } = require('./carrier/transfer-effects'); // pure (docs/adr/0074)

// A DEPARTURE in these states has left the ground (docs/adr/0076).
const DEPARTURE_AIRBORNE_STATES = ['DEPARTED', 'HANDED_OFF'];

const FLAG_KEYS = ['offset', 'flipped', 'removeIndicator', 'highlight', 'attention'];
const APPLIED_MUTATIONS_CAP = 5000;
// How much of the idempotency cache rides in the Board snapshot (docs/adr/0081,
// L6's F5 mode A): a RETRY window, not a history. A client that lost its ack
// to a crash retries within seconds of reconnecting; ten minutes covers a
// restart and a slow reconnect. [SOURCE-DEFINED], a constant rather than a
// tuning value. Wall time, like the NLA latch (ADR 0079's one exception).
const REPLAY_PERSIST_WINDOW_MS = 10 * 60 * 1000;

// Every Strip Role's own starting EfspState, used by _applyCreateStrip when
// the caller doesn't pass an explicit op.initialState. Deliberately just
// each role's first lifecycle state, not the full STATES_BY_ROLE table
// nla.js owns — board-store.js only ever needs the ONE starting value.
// docs/adr/0087 (supersedes 0022's "the replica carries the sender's state" for
// OVERFLIGHT only): the guide's four states are one sector's view of a flight,
// so a flight handed to our next Facility arrives INBOUND there and walks them
// again. { role: { senderState: replicaState } }; absent = the sender's state.
const REPLICA_STATE_ON_RECEIPT = { OVERFLIGHT: { IN_SECTOR: 'INBOUND' } };
// ...and when the receiver ACCEPTs a HANDOFF, the sender's Strip has left its
// sector: { primitive: { role: { senderState: stateAfterAccept } } }.
const SENDER_STATE_ON_ACCEPT = { HANDOFF: { OVERFLIGHT: { IN_SECTOR: 'HANDED_OFF' } } };

const DEFAULT_INITIAL_STATE_BY_ROLE = { DEPARTURE: 'PROPOSED', ARRIVAL: 'INBOUND', OVERFLIGHT: 'INBOUND', MISSION: 'TASKED', MARSHAL: 'IN_STACK', FINAL: 'ON_FINAL', PATTERN: 'IN_PATTERN' };

/**
 * The compact, frozen record the idempotency cache keeps for one applied
 * clientMutationId (docs/adr/0081): the outcome and the ids it concerned.
 * Nothing live and nothing cloned — it is serialisable, which is what lets
 * the last REPLAY_PERSIST_WINDOW_MS of it ride in the Board snapshot.
 * `appliedWallAt` is WALL time (Date.now()): a retry window is a storage
 * lifetime, like the NLA latch, not a time a controller reads (ADR 0079).
 */
function _replayRecord(result, appliedWallAt) {
  return Object.freeze({
    ok: !!result.ok,
    reason: result.reason === undefined ? null : result.reason,
    detail: result.detail === undefined ? null : result.detail,
    warning: result.warning === undefined ? null : result.warning,
    routedTo: result.routedTo === undefined ? null : result.routedTo,
    selfCoordinated: result.selfCoordinated === undefined ? null : result.selfCoordinated,
    stripId: result.strip ? result.strip.stripId : null,
    fdrId: result.fdr ? result.fdr.fdrId : null,
    peerFacilityId: result.peerFacilityId === undefined ? null : result.peerFacilityId,
    peerStripId: result.peerStrip ? result.peerStrip.stripId : null,
    appliedWallAt,
  });
}

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
    this._appliedMutations = new Map(); // clientMutationId -> compact frozen replay record (_replayRecord), idempotency (§5.2, docs/adr/0081)
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
      rejectedReplicaRefusal: (strip, toState) => this._rejectedReplicaRefusal(strip, toState),
    });
    this._activeCmid = null;  // the clientMutationId being applied, while applyMutation runs
    // Cross-Facility coordination and TOFI (board/coordination.js, board/tofi.js). touch and retire are late-bound
    // to the facade (host-core patches _touch; _retireStrip moves in BOARD-3), activeCmid and mutationLog are read
    // late, and the per-Role tables stay here and are passed as values.
    this._coordination = new Coordination({
      rules, state: this._state, audit: this._audit, placement: this._placement, clock, fdrStore,
      touch: (id) => this._touch(id),
      activeCmid: () => this._activeCmid,
      retire: (strip, by) => this._retireStrip(strip, by),
      mutationLog: () => this._mutationLog,
      replicaStateOnReceipt: REPLICA_STATE_ON_RECEIPT,
      senderStateOnAccept: SENDER_STATE_ON_ACCEPT,
    });
    this._tofi = new Tofi({
      rules, state: this._state, audit: this._audit, placement: this._placement, clock, fdrStore,
      touch: (id) => this._touch(id),
      activeCmid: () => this._activeCmid,
      retire: (strip, by) => this._retireStrip(strip, by),
      defaultInitialStateByRole: DEFAULT_INITIAL_STATE_BY_ROLE,
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
    if (keyed && this._appliedMutations.has(cmid)) {
      return this._replayResult(this._appliedMutations.get(cmid)); // idempotent replay, §5.2
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
      result = this._dispatch(mutation, actingPositionId, by);
    } catch (err) {
      console.error('[board-store] unexpected error applying Mutation — rejecting it instead of crashing:', err);
      result = { ok: false, reason: 'VALIDATION_ERROR', detail: 'internal error processing mutation' };
    } finally {
      this._activeCmid = null;
    }

    if (keyed) this._rememberApplied(cmid, _replayRecord(result, Date.now()));
    return result;
  }

  /** Whether this clientMutationId is in the idempotency cache — index.js's boot reconcile asks (docs/adr/0081). */
  hasApplied(cmid) { return this._appliedMutations.has(cmid); }

  _rememberApplied(cmid, record) {
    this._appliedMutations.set(cmid, record);
    if (this._appliedMutations.size > APPLIED_MUTATIONS_CAP) {
      const oldestKey = this._appliedMutations.keys().next().value;
      this._appliedMutations.delete(oldestKey);
    }
  }

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

  _dispatch(mutation, actingPositionId, by) {
    const { op } = mutation;

    // Coordination and TOFI notes carry the verbal half of an exchange and
    // are free text, so they get the same ceiling as every other free-text
    // field (see fdr-store.js's MAX_FREE_TEXT). Bounded HERE, at the one
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
    // CarrierTransfer (docs/adr/0074) is not an OP_KINDS grant: which Position
    // may record WHICH of the four hand-overs is the model's own `from` list
    // (permission.js's canRecordCarrierTransfer), one acting Position and one kind.
    if (op.kind === 'CarrierTransfer') {
      if (!(this._rules.canRecordCarrierTransfer && this._rules.canRecordCarrierTransfer(actingPositionId, op.transfer))) {
        return { ok: false, reason: 'PERMISSION_DENIED', detail: `${actingPositionId} may not record ${op.transfer || 'that transfer'}` };
      }
    } else if (op.kind === 'SfaRotation') {
      // The SFA_ROTATION transfer (docs/adr/0075, 0093) is not an OP_KINDS grant
      // either: permission.js's capability table says which Position may send it.
      if (!(this._rules.canSendSfaRotationTransfer && this._rules.canSendSfaRotationTransfer(actingPositionId))) {
        return { ok: false, reason: 'PERMISSION_DENIED', detail: `${actingPositionId} may not rotate an aircraft onto PAR` };
      }
    } else if (this._rules.canMutate && !this._rules.canMutate(actingPositionId, op.kind)) {
      return { ok: false, reason: 'PERMISSION_DENIED' };
    }

    if (op.kind === 'CreateStrip') {
      const result = this._applyCreateStrip(op, actingPositionId, by);
      this._audit.recordAudit(mutation, actingPositionId, by, null, result);
      return result;
    }

    const strip = this._state.strips.get(mutation.stripId);
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
        && !(this._rules.mayActBesideOwner && this._rules.mayActBesideOwner(actingPositionId, strip, op))) {
      return { ok: false, reason: 'NOT_OWNER', detail: `${strip.ownerPositionId} holds this Strip`, strip: deepClone(strip) };
    }

    // F-303, the rest of it: a rejected replica is inert for every op, not
    // just the NLA and the Bay-implied drag. See _rejectedReplicaOpRefusal.
    const inert = this._rejectedReplicaOpRefusal(strip, op);
    if (inert) return { ok: false, reason: inert.reason, detail: inert.detail, strip: deepClone(strip) };

    const before = deepClone(strip);
    let result;
    switch (op.kind) {
      case 'MoveStrip':     result = this._applyMoveStrip(strip, op, by); break;
      case 'SetBlock':      result = this._applySetBlock(strip, op, by, actingPositionId, mutation.clientMutationId); break;
      case 'TransferStrip': result = this._applyTransferStrip(strip, op, by); break;
      case 'SetFlag':       result = this._applySetFlag(strip, op, by); break;
      case 'SetState':      result = this._applySetStateGated(strip, op, actingPositionId, by); break;
      case 'InvokeNla':     result = this._applyInvokeNla(strip, by); break;
      case 'Undo':          result = this._applyUndo(strip, by); break;
      case 'DropStrip':     result = this._applyDropStrip(strip, op, by); break;
      // WP4A cross-Facility coordination primitives (guide §4.6,
      // docs/adr/0015) — all 5 share one handler; op.kind IS the primitive,
      // op.action selects PROPOSE/ACCEPT/REJECT. See board/coordination.js applyOp.
      case 'HANDOFF':
      case 'POINT_OUT':
      case 'TRAFFIC':
      case 'OPERATIONAL_REQUEST':
      case 'AIT':
        result = this._coordination.applyOp(strip, op, by, actingPositionId); break;
      // WP4A second slice (docs/adr/0025) — TOFI (guide §4.6.3), the
      // ATC<->MRU sub-protocol. Kept structurally separate from the 5
      // primitives above (own strip.tofiCoordination field, own dispatcher)
      // rather than folded into Coordination.applyOp — TOFI is a two-step
      // exchange (ENTRY and EXIT) plus a distinct comms-transfer action,
      // none of which the single-shot PROPOSE/ACCEPT/REJECT shape above
      // was built to express. See board/tofi.js applyOp.
      case 'TOFI':
        result = this._tofi.applyOp(strip, op, by, actingPositionId); break;
      // docs/adr/0023 — converts this Strip's role IN PLACE, same Strip/
      // FDR throughout, for a returning flight at the same Facility.
      case 'ConvertToArrival':
        result = this._applyConvertToArrival(strip, by, actingPositionId); break;
      // The RANGE slice — a flight is approved onto an airspace's working
      // frequency. Deliberately an ordinary Strip Mutation and NOT a
      // coordination primitive: nothing crosses a Facility boundary, no
      // replica is minted, and above all no jurisdiction moves (guide §4.7 /
      // defect D17 — "the frequency is an attribute of the Strip; the
      // controller is what moves"). The approving controller keeps the Strip.
      case 'ApproveAirspaceEntry':
        result = this._applyApproveAirspaceEntry(strip, op, by); break;
      case 'ClearAirspaceEntry':
        result = this._applyClearAirspaceEntry(strip, by); break;
      // docs/adr/0074 — the carrier's four hand-overs, each its own button with
      // its own trigger type recorded (guide §9.12). One implementation: the NLA
      // button reaches the same method.
      case 'CarrierTransfer':
        result = this._applyCarrierTransfer(strip, op.transfer, op.toPositionId, by, actingPositionId, mutation.clientMutationId); break;
      // docs/adr/0075, 0093 — Single Frequency Approach (guide §4.7): the
      // controller rotates, the frequency does not. Same shape as a carrier hand-over.
      case 'SfaRotation':
        result = this._applySfaRotation(strip, by, actingPositionId); break;
      default:              result = { ok: false, reason: 'VALIDATION_ERROR', strip: deepClone(strip) };
    }
    // docs/adr/0076, Q-L16-3: a DEPARTURE entering Airborne stamps the takeoff
    // time, however it got there (the NLA, SetState, a drag into the Airborne
    // Bay) — one place, after every op that can change a state.
    if (result.ok && strip.state !== before.state) {
      const stamped = this._stampTakeoffOnStateChange(strip, before.state);
      if (stamped) {
        if (!result.fdr || result.fdr.fdrId === stamped.fdrId) result.fdr = stamped;
        else result.fdrs = [...(result.fdrs || []), stamped];
      }
    }
    this._audit.recordAudit(mutation, actingPositionId, by, before, result);
    return result;
  }

  /**
   * The takeoff time the state change gives (docs/adr/0076). Stamped when a
   * DEPARTURE first reaches an airborne state, with the mission clock; cleared
   * when it is taken back out of one (an Undo, a SetState back), because the
   * takeoff then did not happen. A DROP keeps it. The first stamp wins.
   * @returns {object|null} the FDR it changed, for the ack's broadcast.
   */
  _stampTakeoffOnStateChange(strip, prevState) {
    if (strip.role !== 'DEPARTURE' || !this._fdrStore || !this._fdrStore.setTakeoffStamp) return null;
    const airborne = (st) => DEPARTURE_AIRBORNE_STATES.includes(st);
    const fdr = this._fdrStore.getFdr(strip.fdrId);
    if (!fdr) return null;
    let r = null;
    if (airborne(strip.state) && !airborne(prevState) && prevState !== 'DROPPED') {
      if (fdr.timeInputs && fdr.timeInputs.takeoffStampedUtc != null) return null;
      r = this._fdrStore.setTakeoffStamp(strip.fdrId, this._clock.now());
    } else if (!airborne(strip.state) && strip.state !== 'DROPPED' && airborne(prevState)) {
      r = this._fdrStore.setTakeoffStamp(strip.fdrId, null);
    }
    return r && r.ok && r.changed ? r.fdr : null;
  }

  _applyCreateStrip(op, actingPositionId, by) {
    // A Strip in a Bay this Facility does not have is invisible on every
    // Board — every read path goes through a Bay — while still holding a
    // beacon code. Cheaper to refuse than to hunt for later.
    const bayCheck = this._placement.requireKnownBay(op.bayId);
    if (bayCheck) return bayCheck;
    const role = op.role || 'DEPARTURE';
    if (this._rules.isValidRole && !this._rules.isValidRole(role)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown Strip Role: ${role}` };
    }
    // Role-scoped CreateStrip (OPS/DEPARTURE: guide §4.1 rule 3; APP/ARRIVAL: docs/adr/0008) — a
    // SECOND permission check beyond the coarse canMutate('CreateStrip')
    // gate already applied in _dispatch: OPS may only originate DEPARTURE,
    // APP may only originate ARRIVAL. Checked before touching fdrStore so
    // a denied CreateStrip has no side effects.
    if (this._rules.canCreateStripRole && !this._rules.canCreateStripRole(actingPositionId, role)) {
      return { ok: false, reason: 'PERMISSION_DENIED' };
    }

    // BIND, rather than originate (docs/adr/0054). `op.fdrId` attaches this
    // new Strip to a flight that already exists instead of minting a fresh
    // FDR — which is how a mission line comes to be the SAME flight as the
    // ATC Strip, at tasking time, long before any TOFI.
    //
    // A field on this op rather than an op of its own: every gate above
    // (known Bay, valid Role, canCreateStripRole) and everything below
    // (cid, orderKey, the Strip literal) applies identically, and ADR 0023's
    // precedent is that ARRIVAL Strips already originate "both ways" through
    // this one op. It also keeps the reverse direction free — WP7's ATO-first
    // case is this same op with a different Role and acting Position.
    let created;
    if (op.fdrId !== undefined && op.fdrId !== null) {
      if (op.fdr) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: 'CreateStrip takes either fdr (a new flight) or fdrId (an existing one), not both' };
      }
      const bound = this._fdrStore.getFdr(op.fdrId);
      // Same reason code and wording receiveTofiProposal already uses, so
      // both binding paths fail identically.
      if (!bound) return { ok: false, reason: 'NOT_FOUND', detail: 'referenced FDR not found' };

      // Scanned LOCALLY, not through rules.liveStripsForFdr — that one is
      // global and role-blind, and the 5 ATC<->ATC primitives legitimately put
      // same-role Strips for one FDR on two Boards (docs/adr/0013). Within ONE
      // Board, two same-role Strips on one FDR is §3.6's duplicate
      // origination. Role-agnostic rather than MISSION-specific, so the
      // ATO-first direction reuses this unchanged.
      const clash = [...this._state.strips.values()].find(
        s => s.fdrId === op.fdrId && s.role === role && s.state !== 'DROPPED');
      if (clash) {
        return {
          ok: false, reason: 'VALIDATION_ERROR',
          detail: `${bound.identity.callsign} already has a live ${role} Strip at ${clash.ownerPositionId}`,
        };
      }
      // No createFdr, so NO BEACON CODE IS MINTED: the mission line shares the
      // flight's Mode 3/A, which is guide §9.8's own "bridge field" and the
      // strongest argument for a shared fdrId over copying fields across.
      created = { ok: true, fdr: bound };
      // docs/adr/0074: the recovery Strip binds to the flight whose launch Strip
      // was dropped, and that drop released the flight's squawk once no Strip
      // referenced it. Re-claim it, or the next CreateStrip is handed a code a
      // live aircraft is squawking (D23: reacquireFdr never steals a code another
      // flight took in the meantime, and is a no-op for a flight still holding it).
      if (this._fdrStore.reacquireFdr) this._fdrStore.reacquireFdr(op.fdrId);
    } else {
      created = this._fdrStore.createFdr(op.fdr, { by });
    }
    if (!created.ok) return { ok: false, reason: created.reason, detail: created.detail };

    const stripId = crypto.randomUUID();
    const rackStrips = this.getRack(op.bayId, op.rackId);
    const afterStripId = op.afterStripId !== undefined
      ? op.afterStripId
      : (rackStrips.length ? rackStrips[rackStrips.length - 1].stripId : null);
    const orderKey = this._placement.resolveOrderKey(op.bayId, op.rackId, afterStripId, op.beforeStripId || null, null);

    const now = this._clock.now();
    const strip = {
      stripId,
      cid: this._state.nextCid(),
      fdrId: created.fdr.fdrId,
      rev: 1,
      role,
      // docs/adr/0023 bug fix — this used to be a raw `role === 'ARRIVAL' ?
      // 'INBOUND' : 'PROPOSED'` binary, which silently gave a new
      // OVERFLIGHT Strip the invalid state 'PROPOSED' (a DEPARTURE-only
      // state, not even in OVERFLIGHT_STATE_SET) since no caller passes
      // op.initialState explicitly. A small per-role table, not a wider
      // rules-injection — board-store.js only ever needs each role's own
      // starting state, never the full STATES_BY_ROLE list nla.js owns.
      state: op.initialState || DEFAULT_INITIAL_STATE_BY_ROLE[role] || 'PROPOSED',
      ownerPositionId: actingPositionId,
      bayId: op.bayId,
      rackId: op.rackId,
      orderKey,
      annotations: {},
      flags: newFlags(),
      // No `correlation` field. The inert `{ state: 'UNCORRELATED' }` hook that
      // used to sit here was keyed wrongly: one FDR legitimately has several
      // Strips (per-Facility replicas, docs/adr/0013; a TOFI MISSION Strip;
      // ConvertToArrival keeping one stripId across a role change), so a
      // per-Strip correlation lets two replicas hold different answers to
      // "which contact is this airframe" — and two answers to an identity
      // question IS the defect class §6.6 exists to prevent. The correlation
      // is keyed by fdrId in correlation-store.js (docs/adr/0045), and the
      // client joins on fdrId to render it.
      coordination: null, // WP4A hook (docs/adr/0015) — set by _applyCoordinationPropose/receiveCoordinationProposal once this Strip is party to a cross-Facility exchange
      tofiCoordination: null, // WP4A second slice hook — set by _applyTofiPropose/receiveTofiProposal once this Strip is party to a TOFI exchange
      airspaceEntry: null, // the RANGE slice — set by _applyApproveAirspaceEntry while this flight is working an airspace
      previousLeg: null,   // set by ConvertToArrival — the departure leg's archived annotations
      createdAt: now, updatedAt: now, updatedBy: by || null,
    };
    this._state.insert(strip);
    // docs/adr/0074: a recovery check-in (a MARSHAL Strip in IN_STACK) joins the
    // Marshal stack at the next free slot. The Marshal re-sequences with one
    // Move; a full stack is a warning, not a refusal of the check-in.
    let warning;
    let carrierChanged;
    if (role === 'MARSHAL' && strip.state === 'IN_STACK' && this._rules.carrierAppendFlight) {
      const a = this._rules.carrierAppendFlight(strip.fdrId, { by, actingPositionId });
      if (a && a.ok === false) warning = `not in the Marshal stack: ${a.detail || a.reason}`;
      else if (a && a.changed && a.changed.length) carrierChanged = true;
    }
    return { ok: true, strip, fdr: created.fdr, warning, carrierChanged };
  }

  /**
   * docs/adr/0023 — converts a DEPARTURE Strip at its HANDED_OFF terminus
   * into an ARRIVAL Strip IN PLACE: same stripId, same fdrId, throughout.
   * A deliberate departure from guide §3.6's turnaround rule ("an ARRIVAL
   * Strip that reaches DROPPED and a later DEPARTURE Strip for the same
   * airframe are separate Strips referencing separate FDRs") — chosen
   * explicitly over spawning a second Strip/FDR pair (the first version of
   * this feature) after live testing found the two-Strip approach left a
   * stale departure Strip behind and required copying every field by hand
   * (route, altitude, remarks, identity, beacon code — the last of which
   * can't even be copied cleanly, since fdr-store.js's createFdr always
   * auto-allocates a fresh code). Reusing the same FDR makes every one of
   * those problems structurally impossible: there is nothing to copy,
   * because nothing new was created.
   *
   * Annotations/flags/coordination all reset to their fresh-Strip defaults —
   * none of them carry a meaning that survives a role change (a DEPARTURE-
   * phase annotation note, an old coordination link that already resolved,
   * an attention flag from the outbound leg). The correlation is the one
   * thing that does survive, and used to be reset here in error — see the
   * comment at the reset site below, and docs/adr/0045. And
   * this Strip's `role`-scoped Block Map, EfspState set and NLA table all
   * genuinely change underneath it, so starting those fields clean avoids
   * carrying over state that no longer means what it used to.
   */
  _applyConvertToArrival(strip, by, actingPositionId) {
    if (strip.role !== 'DEPARTURE' || strip.state !== 'HANDED_OFF') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'only a DEPARTURE Strip at HANDED_OFF can be converted to ARRIVAL', strip };
    }
    // Role-scoped, same two-tier permission shape _applyCreateStrip uses —
    // the coarse canMutate('ConvertToArrival') gate already applied in
    // _dispatch restricts this to APP/CTR; this is the fine-grained half,
    // reusing canCreateStripRole's existing ARRIVAL-origination check
    // rather than a parallel table that would only ever say the same thing.
    if (this._rules.canCreateStripRole && !this._rules.canCreateStripRole(actingPositionId, 'ARRIVAL')) {
      return { ok: false, reason: 'PERMISSION_DENIED', strip };
    }
    // The conversion nulls both coordination records wholesale below, so an
    // unresolved link has to be refused here rather than silently discarded.
    // Exactly the guard set _applyDropStrip uses, and asymmetric for the same
    // reason: an ACTIVE *coordination* link is the normal condition of a
    // Strip that has been handed off and accepted — jurisdiction moved, the
    // exchange is finished, and converting for the return leg is precisely
    // what CTR does next — whereas an ACTIVE *TOFI* link means tactical
    // control is live right now (docs/adr/0025: jurisdiction never transfers,
    // so the exchange stays open for its whole duration).
    //
    // Found by an end-to-end scenario trace, and reachable precisely because
    // TOFI never changes the ATC-side Strip's own state: it sits at
    // DEPARTURE/HANDED_OFF throughout, which is this op's entry condition. So
    // "Convert to Arrival" was live mid-exchange — against a PROPOSED link it
    // orphaned a replica that would wait forever for a response, and against
    // an ACTIVE TOFI it ended tactical control with no notification to the
    // MRU side at all.
    if (strip.coordination && strip.coordination.state === 'PROPOSED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'cannot convert a Strip with an open coordination proposal — accept, reject, or wait for a response first', strip };
    }
    if (strip.tofiCoordination && strip.tofiCoordination.state === 'PROPOSED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'cannot convert a Strip with an open TOFI proposal — accept, reject, or wait for a response first', strip };
    }
    if (strip.tofiCoordination && strip.tofiCoordination.state === 'ACTIVE') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'cannot convert a Strip under active tactical control — complete a TOFI exit first', strip };
    }
    const targetBay = this._rules.bayForImpliedState ? this._rules.bayForImpliedState(strip.ownerPositionId, 'INBOUND') : null;
    if (!targetBay) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `no ARRIVAL Bay configured for ${strip.ownerPositionId}`, strip };
    }

    // Bug found in live testing: DEPARTURE and ARRIVAL read DIFFERENT FDR
    // fields for the same underlying idea — DEPARTURE's Block 8 is
    // filed.departureAirport, ARRIVAL's Block 8 is filed.originAirport
    // (block-map.js). Converting in place never touches the FDR otherwise
    // (that's the whole point — same FDR throughout), so originAirport
    // stayed permanently blank even though departureAirport still held the
    // right value right next to it. The flight's real point of origin
    // doesn't change just because it's airborne — for a sortie that
    // departed Incirlik and never actually landed anywhere else, the
    // departure record's own departureAirport IS the honest answer to
    // "where is this arrival coming from." destinationAirport needs no
    // equivalent remap — ARRIVAL has no "destination" field at all, since
    // this Facility itself is the implicit destination.
    //
    // Block 7 is deliberately NOT remapped the same way: DEPARTURE's is
    // filed.requestedAltitude (what was filed), ARRIVAL's is annotation-
    // routed (guide §3.7's append-only sequence of ATC-ASSIGNED altitude
    // clearances during descent) — genuinely different concepts, not two
    // field names for the same fact. Seeding it from the filed altitude
    // would misrepresent a filed value as an issued clearance; leaving it
    // blank for the controller to actively assign is correct, not a gap.
    const fdr = this._fdrStore.getFdr(strip.fdrId);
    let updatedFdr = fdr;
    if (fdr && fdr.filed.departureAirport) {
      // Captured so it can ride in this method's own return value below —
      // without it, efsp-ws.js's ack/broadcast has no fdr to include
      // (mirrors _applySetBlock's own result.fdr pattern), and a connected
      // client would never actually see originAirport update at all.
      const fdrResult = this._fdrStore.setField(strip.fdrId, 'filed.originAirport', fdr.filed.departureAirport, { by });
      if (fdrResult.ok) updatedFdr = fdrResult.fdr;
    }

    strip.role = 'ARRIVAL';
    strip.state = 'INBOUND';
    strip.bayId = targetBay.bayId;
    strip.rackId = this._placement.placementRack(strip, targetBay);
    strip.orderKey = this._placement.resolveOrderKey(targetBay.bayId, strip.rackId, null, null, strip.stripId);
    // The departure leg's annotations are ARCHIVED, not erased. Clearing the
    // live set is right — a DEPARTURE Strip's Block 9A means something
    // different on an ARRIVAL, so carrying the values across would mislabel
    // them — but erasing them outright destroyed controller-entered data on
    // one click, with no undo (ConvertToArrival records no NLA history, so
    // §3.5 rule 5's window does not cover it). The append-only annotation
    // model exists because JO 7110.65 ¶2-3-1 forbids erasing an item; a role
    // change is not an exception to that.
    //
    // Kept on the Strip rather than left to the Mutation log: the log has it
    // either way, but a controller asking "what did Ground tell them before
    // they went out" is looking at the Strip, not reading a JSONL file.
    strip.previousLeg = {
      role: 'DEPARTURE',
      annotations: strip.annotations,
      flags: strip.flags,
      convertedAt: this._clock.now(),
      convertedBy: by || null,
    };
    strip.annotations = {};
    strip.flags = newFlags();
    strip.coordination = null;
    strip.tofiCoordination = null;
    // The correlation is deliberately NOT reset, and the line that used to do
    // it here was wrong even while it was inert (docs/adr/0045). This fires on
    // the same stripId, the same fdrId, the same airframe — still airborne,
    // still squawking the code docs/adr/0023 went out of its way to keep. It
    // threw away a correct binding for the one aircraft that certainly has
    // one, which is §6.6 rule 3's silent break reached through a role change
    // instead of a track-id change. Under the fdrId key there is nothing here
    // to reset: the correlation is a fact about the airframe, and the airframe
    // did not change legs — the paperwork did.
    this._state.bump(strip, by);
    return { ok: true, strip, fdr: updatedFdr };
  }

  /**
   * Approves this flight to work inside an airspace, on a frequency.
   *
   * The frequency defaults from the airspace itself — a range with a control
   * tower of its own hands the flight to that tower's frequency, an ordinary
   * MOA to its working frequency — and an explicit `frequencyMhz` overrides
   * both, because a controller assigning something off-config is a normal
   * thing to do and refusing it would be worse than recording it.
   *
   * Entry into an airspace that is not ACTIVE is WARNED, never refused
   * (guide §9.11: "aircraft entering unactivated airspace MUST alert").
   * Refusing would be wrong every time the airspace is hot in reality and
   * the board has simply not caught up, which is the situation the alert
   * exists to surface.
   *
   * An optional `altitudeBlock` restricts this flight to a slice of the
   * airspace — the ordinary way two aircraft share one block, or the way a
   * working flight is pushed out of the way while somebody transits. Re-
   * issuing this op on a Strip already in the same airspace AMENDS the
   * restriction rather than being refused, because tightening or lifting a
   * block mid-sortie is the normal case, not an error.
   */
  _applyApproveAirspaceEntry(strip, op, by) {
    if (!op.airspaceId) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'an airspace entry needs an airspaceId', strip };
    }
    const airspace = this._rules.airspaceFor ? this._rules.airspaceFor(op.airspaceId) : null;
    if (!airspace) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown airspace: ${op.airspaceId}`, strip };
    }

    const definition = airspace.definition || {};
    const frequencyMhz = op.frequencyMhz !== undefined && op.frequencyMhz !== null
      ? op.frequencyMhz
      : (definition.controlFrequencyMhz || definition.workingFrequencyMhz || null);

    const blockCheck = _validateAltitudeBlock(op.altitudeBlock, definition);
    if (!blockCheck.ok) return { ok: false, reason: 'VALIDATION_ERROR', detail: blockCheck.detail, strip };

    const fdrResult = this._fdrStore.setWorkingFrequency(strip.fdrId, frequencyMhz, { airspaceId: op.airspaceId, by });
    if (!fdrResult.ok) return { ok: false, reason: fdrResult.reason, detail: fdrResult.detail, strip };

    strip.airspaceEntry = {
      airspaceId: op.airspaceId,
      frequencyMhz,
      // null means "the whole block", which is what an aircraft working
      // alone gets. It is deliberately not defaulted to the airspace's own
      // vertical limits: "unrestricted within the airspace" and "restricted
      // to exactly the airspace's limits" read the same on a Strip but mean
      // different things to the controller who has to deconflict later.
      altitudeBlock: op.altitudeBlock || null,
      approvedAt: this._clock.now(),
      approvedBy: by || null,
    };
    this._state.bump(strip, by);

    const warning = airspace.state !== 'ACTIVE' ? 'AIRSPACE_NOT_ACTIVE' : undefined;
    return { ok: true, strip, fdr: fdrResult.fdr, warning };
  }

  /** The flight leaves the airspace and comes back to the controller's own frequency. */
  _applyClearAirspaceEntry(strip, by) {
    if (!strip.airspaceEntry) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'this Strip is not working an airspace', strip };
    }
    const fdrResult = this._fdrStore.setWorkingFrequency(strip.fdrId, null, { airspaceId: null, by });
    if (!fdrResult.ok) return { ok: false, reason: fdrResult.reason, detail: fdrResult.detail, strip };
    strip.airspaceEntry = null;
    this._state.bump(strip, by);
    return { ok: true, strip, fdr: fdrResult.fdr };
  }

  /**
   * SetState is owner-checked (decisions.md S-R2-14, docs/adr/0080, B7). Until
   * now it was ADR 0027's unchecked escape hatch: any Position holding the op
   * and owning the Strip could put it in any state, which let AIC do the very
   * thing H2 says it never does (advance a mission line) and leave the Strip in
   * a Bay that implied another state. The acting Position must own the Strip's
   * CURRENT state per STATE_OWNERS_BY_ROLE — the authority InvokeNla and the
   * Bay-implied drag already apply — for every Role. Checked before the runway
   * inhibit (authority before availability), and ONLY on the controller's
   * SetState: the Undo / NLA paths that reach _applySetState carry their own.
   */
  _setStateOwnerRefusal(strip, toState, actingPositionId) {
    if (!this._rules.canActOnState) return null;
    if (this._rules.canActOnState(actingPositionId, strip.role, strip.state)) return null;
    return {
      ok: false, reason: 'PERMISSION_DENIED', strip,
      detail: `${strip.state} is not ${actingPositionId}'s to change`,
    };
  }

  /**
   * SetState: owner check, then the runway inhibit, then the write. The one
   * exception to H19's "the Strip waits" is an OBSERVED departure
   * (`op.observedAirborne`, set only by the surveillance chip): the aircraft is
   * already off the ground, so refusing the record would only make the Board
   * wrong. It bypasses the RUNWAY gate alone (never the owner check), only for a
   * DEPARTURE going to DEPARTED, only when the server's own surveillance agrees
   * (`setAirborneObserver`: the client's flag is a claim, never evidence), and
   * the audit line carries `bypass` with the reason. A typed SetState has no
   * flag and is refused as before.
   */
  _applySetStateGated(strip, op, actingPositionId, by) {
    const owner = this._setStateOwnerRefusal(strip, op.toState, actingPositionId);
    if (owner) return owner;
    let refusal = this._setStateRunwayRefusal(strip, op.toState);
    let bypass = null;
    if (refusal && this._observedDeparture(strip, op)) {
      bypass = { gate: 'RUNWAY_INHIBIT', inhibit: refusal.detail, reason: 'OBSERVED_AIRBORNE' };
      refusal = null;
    }
    if (refusal) return refusal;
    const result = this._applySetStateOp(strip, op.toState, by);
    if (bypass && result.ok) result.bypass = bypass;
    return result;
  }

  _observedDeparture(strip, op) {
    return op.observedAirborne === true && strip.role === 'DEPARTURE' && op.toState === 'DEPARTED'
      && typeof this._airborneObserver === 'function' && this._airborneObserver(strip) === true;
  }

  /**
   * Who vouches that a Strip's aircraft is observed airborne (L19's hint
   * monitor: a standing AIRBORNE_ADVANCE hint for the Strip). Unset, no
   * SetState is ever let past the runway gate.
   */
  setAirborneObserver(fn) { this._airborneObserver = fn; }

  /**
   * SetState honours the runway inhibit (decisions.md S-R2-14, H19): the raw
   * state override may not put a Strip into a runway-using state while its
   * runway is suspended or closed — the Strip waits, whichever path is used.
   * The only runway gate SetState carries; it still bypasses every other NLA
   * gate (who may use SetState at all is L23's).
   */
  _setStateRunwayRefusal(strip, toState) {
    if (!(RUNWAY_GATED_STATES[strip.role] || []).includes(toState)) return null;
    const bay = this._rules.bayForImpliedState ? this._rules.bayForImpliedState(strip.ownerPositionId, toState) : null;
    const targetRackId = bay && bay.impliesState === toState ? this._placement.placementRack(strip, bay) : undefined;
    const inhibit = runwayInhibitFor(strip, this._fdrStore.getFdr(strip.fdrId), this._placement.fieldStateView(), { targetRackId });
    return inhibit ? { ok: false, reason: 'NLA_INHIBITED', detail: inhibit, strip } : null;
  }

  _applyMoveStrip(strip, op, by) {
    const bayCheck = this._placement.requireKnownBay(op.bayId, strip);
    if (bayCheck) return bayCheck;
    const check = this._placement.validateBayImpliedTransition(strip, op.bayId, op.rackId);
    if (!check.ok) return { ok: false, reason: check.reason, detail: check.detail, strip };
    const full = this._placement.bayFullRefusal(op.bayId, strip);
    if (full) return { ok: false, reason: full.reason, detail: full.detail, strip };

    strip.bayId = op.bayId;
    strip.rackId = op.rackId;
    strip.orderKey = this._placement.resolveOrderKey(op.bayId, op.rackId, op.afterStripId || null, op.beforeStripId || null, strip.stripId);
    if (check.impliedState && check.impliedState !== strip.state) strip.state = check.impliedState;
    const fdrResult = this._assignSfaFrequency(strip, by);

    this._state.bump(strip, by);
    return { ok: true, strip, fdr: fdrResult ? fdrResult.fdr : undefined };
  }

  /**
   * Placing a Strip on an SFA frequency Rack assigns it that frequency (guide
   * §4.2: one Rack per frequency): the FDR's working frequency, the same field the
   * airspace approval writes, so a frequency is one number on one flight. This is
   * the controller choosing a frequency, which is not what SFA forbids; it forbids
   * a CONTROLLER CHANGE being a frequency change, and no transfer or rotation
   * reaches this (D17). Returns the FDR result, or null when the Rack is no SFA
   * frequency or the flight already has that frequency.
   */
  _assignSfaFrequency(strip, by) {
    const mhz = this._rules.sfaFrequencyFor ? this._rules.sfaFrequencyFor(strip.bayId, strip.rackId) : null;
    if (mhz == null) return null;
    const fdr = this._fdrStore.getFdr(strip.fdrId);
    if (!fdr || (fdr.comms && fdr.comms.workingFrequencyMhz === mhz)) return null;
    const r = this._fdrStore.setWorkingFrequency(strip.fdrId, mhz, { by });
    return r.ok ? r : null;
  }

  /**
   * The FDRs a MARSA side effect just rewrote the separation regime on (ending
   * or voiding a relation writes ATC back on every participant). A relation is
   * not a Strip and its participants' Strips may sit in another Facility, so
   * those FDR writes reach nobody unless they are collected here and put in the
   * board-delta's own `fdrs.updated` — the same gap F-111 found on the declare
   * side, arriving from the Strip-op direction. See marsa-store.js's
   * drainRegimeWrites().
   */
  _drainMarsaRegimeWrites() {
    const fdrs = this._rules.drainMarsaRegimeWrites ? this._rules.drainMarsaRegimeWrites() : [];
    return fdrs && fdrs.length ? fdrs : undefined;
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
  _marsaVoidFor(strip, op, by, actingPositionId, clientMutationId) {
    if (!this._rules.marsaInterlockFor || !this._rules.voidMarsaForAssignment) return null;
    if (op.confirmVacated) return null;
    const interlock = this._rules.marsaInterlockFor(strip.role, op.blockId);
    if (!interlock) return null;
    return this._rules.voidMarsaForAssignment(strip.fdrId, {
      cause: interlock === 'COURSE' ? 'CONTROLLER_COURSE_CHANGE' : 'CONTROLLER_ALTITUDE_CHANGE',
      blockId: op.blockId,
      clientMutationId,
      actingPositionId,
      by,
    });
  }

  _applySetBlock(strip, op, by, actingPositionId, clientMutationId) {
    const target = this._rules.resolveBlockTarget(op.blockId, strip.role);
    if (!target) return { ok: false, reason: 'VALIDATION_ERROR', strip };

    // WP6 (docs/adr/0051) — while an ACTIVE MARSA relation holds this flight,
    // the relation owns its separation regime and a direct Block write to it is
    // refused.
    //
    // Two answers to "who is separating these aircraft" is the defect class
    // this subsystem exists to prevent, and §4.8.3 names the exact failure: "if
    // a second controller takes TAC_C2 ten minutes later, the state must
    // already be correct, or they inherit a lie." marsa-store.js writes the
    // regime on declare and writes it back on end/void; letting SREG be edited
    // underneath that would let the FDR and the relation disagree with nothing
    // saying which was right.
    //
    // Refused rather than silently overridden, and the reason names the way
    // out: End or Void the relation, which sets the regime back to ATC as part
    // of doing so. That IS the action the controller wanted.
    if (target.kind === 'tofi' && target.field === 'separationRegime' && this._rules.activeMarsaFor) {
      const active = this._rules.activeMarsaFor(strip.fdrId);
      if (active) {
        return {
          ok: false, reason: 'VALIDATION_ERROR',
          detail: `this flight is in an active MARSA relation declared by ${active.declaringCallsign} — end or void it to hand separation back to ATC`,
          strip,
        };
      }
    }
    // §8.1 — a Facility that hides a Block hides it for writes too, not just
    // for rendering. Enforced here because this is the only path a Block
    // value reaches an FDR or an annotation by.
    if (this._rules.isBlockVisible && !this._rules.isBlockVisible(strip.role, op.blockId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `Block ${op.blockId} is not visible for ${strip.role} at this Facility`, strip };
    }

    if (target.kind === 'fdr' || target.kind === 'airspace-owner' || target.kind === 'tofi' || target.kind === 'frequency' || target.kind === 'military') {
      const fdrResult = target.kind === 'airspace-owner'
        ? this._fdrStore.setAirspaceOwner(strip.fdrId, op.value, { by })
        : target.kind === 'frequency'
          ? this._fdrStore.setWorkingFrequency(strip.fdrId, _frequencyFromBlockValue(op.value), { by })
          : target.kind === 'tofi'
            ? this._fdrStore.setTofi(strip.fdrId, { [target.field]: op.value }, { by })
            // WP6 (docs/adr/0052), guide §6.4 — the military extension
            // namespace, routed exactly like 'tofi' above.
            : target.kind === 'military'
              ? this._fdrStore.setMilitary(strip.fdrId, { [target.field]: op.value }, { by })
              : target.path === 'identity.beaconAssigned'
                ? this._fdrStore.setBeaconAssigned(strip.fdrId, op.value, { by })
                : this._fdrStore.setField(strip.fdrId, target.path, op.value, { by });
      if (!fdrResult.ok) return { ok: false, reason: fdrResult.reason, detail: fdrResult.detail, strip };

      // FDR keeps its own independent rev (guide §3.1); the Strip's rev is
      // also bumped here as a deliberate Phase-1 simplification so the
      // ack/broadcast cycle has one consistent rev to key off per Strip,
      // rather than building a fully separate FDR-level optimistic-
      // concurrency protocol on the wire. See the implementation plan.
      this._state.bump(strip, by);
      const marsaVoided = this._marsaVoidFor(strip, op, by, actingPositionId, clientMutationId);
      return {
        ok: true, strip, fdr: fdrResult.fdr, warning: fdrResult.warning,
        marsaVoided, fdrs: marsaVoided ? this._drainMarsaRegimeWrites() : undefined,
      };
    }

    // docs/adr/0074 — a flight's own carrier fields, written to the FDR
    // (`fdr.military.carrier`) so they survive from the launch Strip to the
    // recovery Strip. A `carrier-derived` Block never reaches here: its target
    // resolves to null above, so SetBlock on CASE, DME, ANGELS, EAT/PUSH or the
    // expected final bearing is a VALIDATION_ERROR (WP7A bullets 2 and 5).
    if (target.kind === 'carrier') {
      const fdrResult = this._fdrStore.setCarrier(strip.fdrId, target.field, op.value, { by });
      if (!fdrResult.ok) return { ok: false, reason: fdrResult.reason, detail: fdrResult.detail, strip };
      this._state.bump(strip, by);
      return { ok: true, strip, fdr: fdrResult.fdr };
    }

    // docs/adr/0058 — the flight's assigned altitude or heading. On the FDR,
    // not the Strip, so every Facility's copy reads the same value; history
    // and confirmVacated work exactly as they do for a Strip annotation.
    if (target.kind === 'clearance') {
      const fdrResult = this._fdrStore.setClearance(strip.fdrId, target.field,
        { value: op.value, confirmVacated: !!op.confirmVacated }, { by });
      if (!fdrResult.ok) return { ok: false, reason: fdrResult.reason, detail: fdrResult.detail, strip };
      this._state.bump(strip, by);
      const marsaVoided = this._marsaVoidFor(strip, op, by, actingPositionId, clientMutationId);
      return {
        ok: true, strip, fdr: fdrResult.fdr,
        marsaVoided, fdrs: marsaVoided ? this._drainMarsaRegimeWrites() : undefined,
      };
    }

    const result = this._applyAnnotationSet(strip, op.blockId, op.value, op.confirmVacated, by);
    // Every Block the interlock tags is annotation-routed today (DEPARTURE's
    // 20/21, ARRIVAL's 7 and 9A-VECTOR, OVERFLIGHT's 7A and 9A-VECTOR), so in
    // practice this is the branch that fires — but the check sits on both paths
    // because which routing a Block uses is a Block Map decision that can
    // change, and an interlock that silently stops covering a Block when its
    // target kind changes is the failure mode docs/adr/0041 is about.
    if (result.ok) {
      result.marsaVoided = this._marsaVoidFor(strip, op, by, actingPositionId, clientMutationId);
      if (result.marsaVoided) result.fdrs = this._drainMarsaRegimeWrites();
    }
    return result;
  }

  /**
   * Append-only annotation supersession (guide §3.7). A normal amendment
   * always marks the prior entry SUPERSEDED, never STRUCK — a vacated
   * altitude MUST NOT be struck automatically on assignment (rule 3).
   * confirmVacated is a distinct action: it marks the currently ACTIVE
   * entry STRUCK, with no new value (the controller confirming the
   * aircraft has actually left, not amending to something new).
   */
  _applyAnnotationSet(strip, blockId, value, confirmVacated, by) {
    // Same ceiling the FDR's free-text fields get, for the same reason: an
    // annotation rides in every broadcast of this Strip and is append-only,
    // so an oversized one is permanent as well as repeated.
    if (typeof value === 'string' && value.length > MAX_FREE_TEXT) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `an annotation is limited to ${MAX_FREE_TEXT} characters`, strip };
    }
    const cell = strip.annotations[blockId] || (strip.annotations[blockId] = { blockId, entries: [] });
    const active = cell.entries.find(e => e.status === 'ACTIVE');

    if (confirmVacated) {
      if (!active) return { ok: false, reason: 'VALIDATION_ERROR', strip };
      active.status = 'STRUCK';
    } else {
      if (active) active.status = 'SUPERSEDED';
      cell.entries.push({ value, status: 'ACTIVE', at: this._clock.now(), by: by || null });
    }

    this._state.bump(strip, by);
    return { ok: true, strip };
  }

  _applyTransferStrip(strip, op, by) {
    const bayCheck = this._placement.requireKnownBay(op.bayId, strip);
    if (bayCheck) return bayCheck;
    // H2 / H40 (docs/adr/0080): a working Position with a hand-back row may
    // transfer a line only to the Positions the capability table names. The
    // acting Position is the owner (_dispatch verified it).
    const handBack = this._rules.handBackTargetsFor ? this._rules.handBackTargetsFor(strip.ownerPositionId) : null;
    if (handBack && !handBack.includes(op.toPositionId)) {
      return {
        ok: false, reason: 'PERMISSION_DENIED', strip,
        detail: `${strip.ownerPositionId} may only hand a line back to ${handBack.join(' or ')}`,
      };
    }
    // B4: the Bay is one of the RECEIVING Position's, or the Strip's owner and
    // its Bay disagree and it drops off both Positions' panels.
    if (this._rules.baysFor) {
      const own = this._rules.baysFor(op.toPositionId);
      if (!own.some(b => b.bayId === op.bayId)) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: `${op.bayId} is not a Bay of ${op.toPositionId}`, strip };
      }
    }
    // Same check _applyMoveStrip uses (§3.5 rule 4) — a Transfer landing in
    // a Bay configured with an implied EfspState is validated EXACTLY like
    // pressing that NLA button would be, before anything else about this
    // Mutation is applied. This is what stops a single controller
    // self-coordinating two Positions (guide §4.8.3) — or two separate
    // controllers, the gap isn't specific to self-coordination — from
    // dragging a Strip straight past every doctrine check NLA enforces
    // (e.g. PROPOSED directly into a CLEARED Bay with no flight plan and
    // no beacon code at all). Validated before the owner/occupancy checks
    // below too, so a rejected transfer never partially mutates the Strip.
    const check = this._placement.validateBayImpliedTransition(strip, op.bayId, op.rackId);
    if (!check.ok) return { ok: false, reason: check.reason, detail: check.detail, strip };
    const full = this._placement.bayFullRefusal(op.bayId, strip);
    if (full) return { ok: false, reason: full.reason, detail: full.detail, strip };

    let destPositionId = op.toPositionId;
    let routedTo = null;
    let warning;

    if (!this._rules.isOccupied(op.toPositionId)) {
      const covering = this._rules.coveringPositionFor(op.toPositionId);
      if (!covering || !this._rules.isOccupied(covering)) {
        return { ok: false, reason: 'NO_RECEIVING_POSITION', strip };
      }
      destPositionId = covering;
      routedTo = covering;
    }

    // Self-coordination (guide §4.8.3): when the same controller who is
    // sending the Strip also holds Primary on the destination Position,
    // the two-party dialogue collapses — but the transfer itself is still
    // the ONE input that applies it (rule 3), and the event MUST be
    // recorded distinctly (rule 4) so an after-action review can tell it
    // apart from a genuine two-party handoff. Phase 1 has no separation-
    // regime/radar-service state to also flip (that's WP4A/WP9 territory,
    // not yet built) — this tag is the Phase-1 analogue: the audit log
    // never silently collapses the boundary event away (defect D20).
    const selfCoordinated = this._rules.isSelfCoordinated
      ? this._rules.isSelfCoordinated(by, destPositionId)
      : false;

    strip.ownerPositionId = destPositionId;
    delete strip.coveredFrom; // it has a new owner by decision, not by cover (F10)
    if (check.impliedState && check.impliedState !== strip.state) strip.state = check.impliedState;
    const routedBay = routedTo ? this._placement.bayForNewOwner(destPositionId, strip.state, strip) : null;
    if (routedBay) {
      // B3: routed to the covering Position, so the line lands in ITS Bay, not
      // the absent Position's (which no panel of the covering one builds).
      strip.bayId = routedBay.bayId;
      strip.rackId = routedBay.rackId;
      strip.orderKey = this._placement.appendOrderKey(strip.bayId, strip.rackId, strip.stripId);
    } else {
      strip.bayId = op.bayId;
      strip.rackId = op.rackId;
      strip.orderKey = this._placement.resolveOrderKey(op.bayId, op.rackId, op.afterStripId || null, op.beforeStripId || null, strip.stripId);
      if (routedTo) warning = `${routedTo} has no Bay for this Strip; it stays in ${op.bayId}`;
    }

    const sfaFdr = routedBay ? null : this._assignSfaFrequency(strip, by);

    this._state.bump(strip, by);
    // A pending Undo window (§3.5 rule 5) is for reverting a STATE change —
    // once ownership has also moved, "revert the state" no longer means
    // what it did when it was recorded (the Strip may now be under a
    // different Position's Bay/lifecycle entirely). Drop it rather than
    // let a stale Undo fire against a Strip that's since changed hands,
    // regardless of whether this transfer came from a drag or an NLA-
    // driven transfer-shaped transition (board-store.js's own _applyInvokeNla).
    this._nlaHistory.delete(strip.stripId);
    return { ok: true, strip, routedTo, selfCoordinated, warning, fdr: sfaFdr ? sfaFdr.fdr : undefined };
  }

  /**
   * The carrier's four hand-overs, as one operation (docs/adr/0064, 0074; guide
   * §9.12: "MUST NOT be unified behind one button"). Reached by the dedicated
   * CarrierTransfer op and by the NLA button (computeNla's `carrierTransfer`),
   * so there is exactly one implementation of what each does.
   *
   * Each kind carries its own TRIGGER TYPE, recorded on the Strip
   * (`carrierTransfer`) and on the audit line, and rendered distinctly. Every
   * trigger is a controller gesture: "radar contact", "ball" and "see you" are
   * the controller recording what they saw or the pilot said, never a
   * surveillance advance (guide §10.3, D5).
   *
   * Order: validate everything, then the stack effect (the one step that can
   * refuse after validation), then the Strip. Nothing is half applied.
   */
  _applyCarrierTransfer(strip, kind, toPositionId, by, actingPositionId, clientMutationId) {
    const fx = typeof kind === 'string' && Object.prototype.hasOwnProperty.call(CARRIER_TRANSFER_EFFECTS, kind) ? CARRIER_TRANSFER_EFFECTS[kind] : null;
    if (!fx) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown carrier transfer '${kind}'`, strip };
    const row = this._rules.carrierTransfers && this._rules.carrierTransfers[kind];
    const label = row ? row.label : kind;
    if (strip.role !== fx.role || strip.state !== fx.state) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${label} applies to a ${fx.role} Strip in ${fx.state}, not ${strip.role} in ${strip.state}`, strip };
    }
    const blocked = this._nlaPrecheck(strip);
    if (blocked) return { ok: false, reason: blocked.reason, detail: blocked.detail, strip };

    let dest = strip.ownerPositionId;
    if (fx.owner === 'TO') {
      dest = toPositionId || fx.defaultTo || (this._rules.carrierLaneFor ? this._rules.carrierLaneFor(strip) : null);
      if (!dest) return { ok: false, reason: 'NO_RECEIVING_POSITION', detail: 'no receiving Position present', strip };
    }
    const caseValue = this._rules.carrierCase ? this._rules.carrierCase() : null;
    if (this._rules.validateCarrierTransfer) {
      const v = this._rules.validateCarrierTransfer(kind, {
        caseValue, fromPositionId: actingPositionId, toPositionId: fx.owner === 'TO' ? dest : (kind === 'FINAL_TO_LSO' ? null : undefined),
      });
      if (!v.ok) return { ok: false, reason: v.reason || 'VALIDATION_ERROR', detail: v.detail, strip };
    }

    let routedTo = null;
    if (fx.owner === 'TO' && !this._rules.isOccupied(dest)) {
      const covering = this._rules.coveringPositionFor(dest);
      if (!covering || !this._rules.isOccupied(covering)) return { ok: false, reason: 'NO_RECEIVING_POSITION', strip };
      dest = covering;
      routedTo = covering;
    }

    // The stack effect: Commence marks the flight pushed (nobody renumbers, the
    // drift defect D16 names); a hand-over to PriFly removes it leaving a
    // vacancy (H28). A flight that was never in the stack has nothing to remove.
    let carrierChanged = false;
    const effect = row ? row.stackEffect : null;
    if (effect && this._rules.carrierApplyEffect) {
      const r = this._rules.carrierApplyEffect(effect, strip.fdrId, { by, actingPositionId, clientMutationId });
      if (!r.ok && !(effect === 'REMOVE_NO_CLOSE_UP' && r.reason === 'NOT_FOUND')) {
        return { ok: false, reason: r.reason || 'VALIDATION_ERROR', detail: r.detail, strip };
      }
      carrierChanged = !!(r.ok && r.changed && r.changed.length);
    }

    const now = this._clock.now();
    const from = { role: strip.role, state: strip.state, ownerPositionId: strip.ownerPositionId };
    strip.role = fx.toRole;
    strip.state = fx.toState;
    strip.ownerPositionId = dest;
    delete strip.coveredFrom; // a new owner by decision, not by cover (F10)
    let warning;
    if (dest !== from.ownerPositionId) {
      const bay = this._placement.bayForNewOwner(dest, strip.state, strip);
      if (bay) {
        strip.bayId = bay.bayId;
        strip.rackId = bay.rackId;
        strip.orderKey = this._placement.appendOrderKey(bay.bayId, bay.rackId, strip.stripId);
      } else {
        warning = `${dest} has no Bay for this Strip; it stays in ${strip.bayId}`;
      }
    } else {
      this._placement.relocateForImpliedState(strip, strip.state);
    }
    strip.carrierTransfer = {
      kind, trigger: row ? row.trigger : null, label, at: now, by: by || null,
      from: from.ownerPositionId, to: dest, fromRole: from.role, toRole: strip.role,
    };
    strip.rev += 1;
    strip.updatedAt = now;
    strip.updatedBy = by || null;
    this._touch(strip.stripId);
    this._nlaHistory.delete(strip.stripId);
    return {
      ok: true, strip, routedTo: routedTo || undefined, warning,
      carrierTransfer: { kind, trigger: strip.carrierTransfer.trigger },
      carrierChanged: carrierChanged || undefined,
    };
  }

  /**
   * The SFA_ROTATION transfer (guide §4.7, docs/adr/0075, 0093): an ARRIVAL Strip
   * at INBOUND with APP or SFA becomes a FINAL Strip at ON_FINAL with PAR. The
   * controller moves; the aircraft's frequency does not, and nothing here reads or
   * writes the FDR (D17). The Role changes IN PLACE (same Strip, same FDR, as
   * ConvertToArrival, ADR 0023), the trigger type is recorded on the Strip and the
   * audit line, and the frequency Rack the Strip left is kept on the record so an
   * after-action review sees which frequency the rotation was on.
   *
   * PAR must be manned: there is no covering fallback, because a FINAL Strip at
   * APP would sit in a Bay APP does not have. Refused, with the aircraft staying
   * where it is. PAR's final Bay holds one Strip (§7.10): a second is refused.
   * Nothing is half applied: validate everything, then change the Strip.
   */
  _applySfaRotation(strip, by, actingPositionId) {
    const fx = this._rules.sfaTransfers && this._rules.sfaTransfers.SFA_ROTATION;
    if (!fx) return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no SFA rotation in this Facility', strip };
    if (strip.role !== fx.role || strip.state !== fx.state) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${fx.label} applies to an ${fx.role} Strip in ${fx.state}, not ${strip.role} in ${strip.state}`, strip };
    }
    const blocked = this._nlaPrecheck(strip);
    if (blocked) return { ok: false, reason: blocked.reason, detail: blocked.detail, strip };
    const dest = this._rules.sfaRotationReceiver ? this._rules.sfaRotationReceiver() : null;
    if (!dest) return { ok: false, reason: 'NO_RECEIVING_POSITION', detail: 'this Facility has no Position to rotate onto', strip };
    if (!this._rules.isOccupied(dest)) {
      return { ok: false, reason: 'NO_RECEIVING_POSITION', detail: `${dest} is not manned — the aircraft stays with ${strip.ownerPositionId}`, strip };
    }
    const bay = this._rules.bayForImpliedState ? this._rules.bayForImpliedState(dest, fx.toState) : null;
    if (!bay || bay.impliesState !== fx.toState) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${dest} has no Bay for ${fx.toState}`, strip };
    }
    const full = this._placement.bayFullRefusal(bay.bayId, strip);
    if (full) return { ok: false, reason: full.reason, detail: full.detail, strip };

    const now = this._clock.now();
    const from = { role: strip.role, state: strip.state, ownerPositionId: strip.ownerPositionId, bayId: strip.bayId, rackId: strip.rackId };
    strip.role = fx.toRole;
    strip.state = fx.toState;
    strip.ownerPositionId = dest;
    delete strip.coveredFrom; // a new owner by decision, not by cover (F10)
    strip.bayId = bay.bayId;
    strip.rackId = this._placement.placementRack(strip, bay);
    strip.orderKey = this._placement.appendOrderKey(strip.bayId, strip.rackId, strip.stripId);
    strip.sfaTransfer = {
      kind: 'SFA_ROTATION', trigger: fx.trigger, label: fx.label, at: now, by: by || null,
      from: from.ownerPositionId, to: dest, fromRole: from.role, toRole: strip.role, frequencyRackId: from.rackId,
    };
    strip.rev += 1;
    strip.updatedAt = now;
    strip.updatedBy = by || null;
    this._touch(strip.stripId);
    this._nlaHistory.delete(strip.stripId);
    return { ok: true, strip, sfaTransfer: { kind: 'SFA_ROTATION', trigger: fx.trigger } };
  }

  _applySetFlag(strip, op, by) {
    if (!FLAG_KEYS.includes(op.flag)) return { ok: false, reason: 'VALIDATION_ERROR', strip };
    strip.flags[op.flag] = op.value;
    this._state.bump(strip, by);
    return { ok: true, strip };
  }

  /**
   * The controller's SetState (after the owner and runway checks): the state
   * change, plus a warning when it leaves the Strip in a Bay that implies a
   * different state because its owner has no Bay for the new one (B7's second
   * defect, decisions Q5): nothing moves the Strip, and the ack says so.
   */
  _applySetStateOp(strip, toState, by) {
    // DROPPED goes through the one retiring path (S-L24): the same open-proposal
    // and active-TOFI guards, the remove indicator, the beacon release and the
    // archive clock, not a bare state write that skips all four.
    if (toState === 'DROPPED') return this._applyDropStrip(strip, {}, by);
    const result = this._applySetState(strip, toState, by);
    if (result.ok && this._rules.bayImpliesState) {
      const implied = this._rules.bayImpliesState(strip.bayId);
      if (implied && implied !== strip.state) {
        result.warning = `no ${strip.ownerPositionId} Bay for ${strip.state}; the Strip stays in ${strip.bayId}`;
      }
    }
    return result;
  }

  _applySetState(strip, toState, by) {
    if (this._rules.isValidState && !this._rules.isValidState(toState, strip.role)) {
      return { ok: false, reason: 'VALIDATION_ERROR', strip };
    }
    // A state change that files the Strip into a full Bay (a missed approach coming
    // back on final while another aircraft is on it) is refused, not silently doubled.
    const into = this._rules.bayForImpliedState ? this._rules.bayForImpliedState(strip.ownerPositionId, toState) : null;
    if (into && into.impliesState === toState && into.bayId !== strip.bayId) {
      const full = this._placement.bayFullRefusal(into.bayId, strip);
      if (full) return { ok: false, reason: full.reason, detail: full.detail, strip };
    }
    strip.state = toState;
    this._placement.relocateForImpliedState(strip, toState);
    this._state.bump(strip, by);
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
   * `mintedForTofi` exists (see _applyTofiAccept): the alternative — deriving
   * it from the Strip still sitting in its owner's Coordination Bay, as
   * _applyCoordinationPropose does — gives the same answer right up until
   * somebody drags the replica somewhere else, and then silently stops
   * applying. The Bay derivation is kept as the fallback so a replica minted
   * before this field existed, and restored from a persisted Board
   * (docs/adr/0002), is still recognized.
   */
  _isRejectedReplica(strip) {
    if (!strip.coordination || strip.coordination.state !== 'REJECTED') return false;
    if (strip.coordination.mintedForCoordination) return true;
    const ownCoordinationBay = this._rules.coordinationBayFor ? this._rules.coordinationBayFor(strip.ownerPositionId) : null;
    return !!ownCoordinationBay && strip.bayId === ownCoordinationBay.bayId;
  }

  /**
   * Everything that refuses an NLA BEFORE the state table is consulted —
   * shared by _applyInvokeNla (which decides) and nlaStatusFor (which only
   * reports), so there is exactly one wording per reason.
   * @returns {{reason:string, detail:string}|null}
   */
  _nlaPrecheck(strip) {
    // Per-State authority (guide §3.4's "normally owned by" column,
    // permission.js's canActOnState) — the acting Position (==
    // strip.ownerPositionId; _dispatch() already verified that above)
    // must be authorized for the Strip's CURRENT state, not just own the
    // Strip. This is what stops e.g. OPS from single-handedly walking a
    // Strip through CD's, GND's and TWR's entire job just because nobody
    // ever transferred it away — raw ownership alone used to be sufficient
    // to invoke ANY NLA on a Strip you held, regardless of whose job that
    // state's action actually is.
    if (this._rules.canActOnState && !this._rules.canActOnState(strip.ownerPositionId, strip.role, strip.state)) {
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
    // _applyCoordinationPropose — same open-link concept, different action.
    if (strip.coordination && strip.coordination.state === 'PROPOSED') {
      return { reason: 'VALIDATION_ERROR', detail: 'cannot advance a Strip with an open coordination proposal — accept, reject, or wait for a response first' };
    }
    // Same open-link guard, extended to TOFI's own coordination record
    // (WP4A second slice) — a Strip with an open (unresolved) TOFI
    // proposal shouldn't silently advance its own lifecycle out from under
    // the pending exchange.
    if (strip.tofiCoordination && strip.tofiCoordination.state === 'PROPOSED') {
      return { reason: 'VALIDATION_ERROR', detail: 'cannot advance a Strip with an open TOFI proposal — accept, reject, or wait for a response first' };
    }
    return null;
  }

  /**
   * F-303: a declined replica is "left inert" — _applyCoordinationPropose's
   * own comment has said so since WP4A, and nothing anywhere enforced it
   * beyond stopping a re-propose. So APP could reject a Point Out from CTR and
   * then hand that same flight to its own Tower, and the server took it:
   * INCIRLIK Tower holding an arrival for a flight CENTER still owns and APP
   * explicitly declined. The sender's own Strip is untouched — see
   * _isRejectedReplica for how the two are told apart.
   *
   * Drop is the deliberate exception, and the only NLA a dead replica should
   * have left: it is how the controller clears it off their Board, and a
   * rejected HANDED_OFF replica having no way to be Dropped at all was itself
   * a bug found in live testing (see efsp-board-store-coordination's own
   * "CTR can Drop a HANDED_OFF DEPARTURE Strip it owns" test).
   *
   * @returns {{reason:string, detail:string}|null}
   */
  _rejectedReplicaRefusal(strip, toState) {
    if (toState === 'DROPPED' || !this._isRejectedReplica(strip)) return null;
    return { reason: 'VALIDATION_ERROR', detail: this._rejectedReplicaDetail(strip) };
  }

  _rejectedReplicaDetail(strip) {
    return `this ${strip.coordination.primitive} was rejected — the replica is inert, and ${strip.coordination.peerPositionId} still works the flight`;
  }

  /**
   * The op-level half of F-303. _rejectedReplicaRefusal only ever guarded the
   * NLA and the Bay-implied drag, so a controller who had just rejected a
   * handoff could still open a TOFI on the dead replica (minting a MISSION
   * Strip on TACTICAL for a flight the sender still controls), approve an
   * airspace entry, convert it to an arrival, or write Blocks into the FDR it
   * shares with the sender's live Strip.
   *
   * Three op kinds stay allowed, because each already enforces the rule
   * itself and each is how a dead replica gets cleared away: DropStrip,
   * InvokeNla (which _rejectedReplicaRefusal limits to DROPPED), and
   * MoveStrip (which Placement.validateBayImpliedTransition refuses into any Bay that
   * would change the Strip's state — moving it aside is fine).
   *
   * MARSA and correlation are flight-level and never reach _dispatch; the
   * client hides their controls on a rejected replica instead.
   *
   * @returns {{reason:string, detail:string}|null}
   */
  _rejectedReplicaOpRefusal(strip, op) {
    if (!this._isRejectedReplica(strip)) return null;
    if (op.kind === 'DropStrip' || op.kind === 'InvokeNla' || op.kind === 'MoveStrip') return null;
    return { reason: 'VALIDATION_ERROR', detail: this._rejectedReplicaDetail(strip) };
  }

  /**
   * What pressing this Strip's NLA button would do RIGHT NOW, computed for
   * its owner — who is the only Position ever offered it (guide §3.5's one
   * NLA per State, _dispatch's NOT_OWNER gate).
   *
   * Advisory only: _applyInvokeNla still decides, and still refuses. This
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
  nlaStatusFor(strip, now = this._clock.now()) {
    if (!strip || !this._rules.computeNla) return null;
    const fdr = this._fdrStore.getFdr(strip.fdrId);
    const result = this._rules.computeNla(strip, fdr, now, this._placement.nlaCtx());
    // No NLA at all for this State (every Role's terminal DROPPED) — null, not
    // a reason. _applyInvokeNla runs the precheck FIRST and so answers a press
    // on a terminal Strip with whichever precheck refusal comes up; that is
    // right for a press, and wrong here, where reporting a reason would have
    // the panel render an explanation for a button that does not exist.
    if (!result) return null;

    const blocked = this._nlaPrecheck(strip);
    if (blocked) return { inhibited: blocked.detail, reason: blocked.reason };
    if (result.inhibited) return { inhibited: result.inhibited, reason: 'NLA_INHIBITED' };

    const inert = this._rejectedReplicaRefusal(strip, result.toState);
    if (inert) return { inhibited: inert.detail, reason: inert.reason };

    // The two refusals that live inside the apply path rather than in the
    // state table, reproduced here with their exact wordings so the advisory
    // never disagrees with the press.
    if (result.transferTo) {
      const targetBay = this._rules.bayForImpliedState ? this._rules.bayForImpliedState(result.transferTo, result.toState) : null;
      if (!targetBay) return { inhibited: `no Bay configured for ${result.transferTo}/${result.toState}`, reason: 'NLA_INHIBITED' };
    } else if (result.toState === 'DROPPED' && strip.tofiCoordination && strip.tofiCoordination.state === 'ACTIVE') {
      return { inhibited: 'cannot drop a Strip under active tactical control — complete a TOFI exit first', reason: 'VALIDATION_ERROR' };
    }
    const status = result.transferTo ? { toState: result.toState, transferTo: result.transferTo } : { toState: result.toState };
    // docs/adr/0074: which carrier hand-over this NLA button records, and the
    // Role it changes the Strip to, so the panel labels it from the model's own
    // table (and renders "See you" beside it in Case II).
    if (result.carrierTransfer) status.carrierTransfer = result.carrierTransfer;
    if (result.roleChange) status.roleChange = result.roleChange;
    return status;
  }

  _applyInvokeNla(strip, by) {
    // Two clocks, deliberately. The latch (400ms double tap, 30s Undo) is how
    // long a person's finger took, in real time; the NLA gate is a release
    // time or a void deadline, in mission time (docs/adr/0079).
    const wallNow = Date.now();
    const now = this._clock.now();
    const lastInvoke = this._nlaHistory.get(strip.stripId);
    if (lastInvoke && wallNow - lastInvoke.invokedAt < 400) {
      // Idempotent double-tap guard (§3.5 rule 3): a second press within
      // 400ms is discarded, not queued — the first tap already applied,
      // so from the controller's perspective this is a no-op success, not
      // an error and not a second transition.
      return { ok: true, strip };
    }

    const blocked = this._nlaPrecheck(strip);
    if (blocked) return { ok: false, reason: blocked.reason, detail: blocked.detail, strip };

    const fdr = this._fdrStore.getFdr(strip.fdrId);
    const result = this._rules.computeNla(strip, fdr, now, this._placement.nlaCtx());
    if (!result || result.inhibited) {
      return { ok: false, reason: 'NLA_INHIBITED', detail: result ? result.inhibited : 'no NLA for this state', strip };
    }
    const inert = this._rejectedReplicaRefusal(strip, result.toState);
    if (inert) return { ok: false, reason: inert.reason, detail: inert.detail, strip };

    // docs/adr/0074: a carrier hand-over is one implementation whichever way it
    // is reached. Not the undoable state-only NLA path: it moves the stack.
    if (result.carrierTransfer) {
      return this._applyCarrierTransfer(strip, result.carrierTransfer, result.transferTo || null, by, strip.ownerPositionId, null);
    }

    const prevState = strip.state;
    let applied;
    if (result.transferTo) {
      // Transfer-shaped NLA transition (Phase 2's real TWR->APP "Hand
      // Off", per docs/adr/0007 superseding the old always-stub DEPARTED
      // case — and ARRIVAL's INBOUND->TWR/LANDED->GND steps). Routed
      // through the EXACT SAME atomic _applyTransferStrip a controller-
      // initiated drag transfer uses — owner, Bay, Rack and state change
      // together, in one Mutation — not a separate, easier-to-drift path
      // (guide §3.5 rule 4: NLA is an accelerator FOR the same operation,
      // not a shortcut around its checks).
      const targetBay = this._rules.bayForImpliedState
        ? this._rules.bayForImpliedState(result.transferTo, result.toState)
        : null;
      if (!targetBay) {
        return { ok: false, reason: 'NLA_INHIBITED', detail: `no Bay configured for ${result.transferTo}/${result.toState}`, strip };
      }
      applied = this._applyTransferStrip(strip, { toPositionId: result.transferTo, bayId: targetBay.bayId, rackId: this._placement.placementRack(strip, targetBay) }, by);
    } else if (result.toState === 'DROPPED') {
      // Every Role's terminal NLA is a Drop (DEPARTURE at HANDED_OFF,
      // ARRIVAL at TAXI_IN, OVERFLIGHT at HANDED_OFF, MISSION at RTB), and
      // it has to mean exactly what the explicit DropStrip op means —
      // same guards, same remove indicator, same beacon release. Routed
      // through the one shared path rather than the generic state setter,
      // for the same reason the transfer-shaped branch above reuses
      // _applyTransferStrip (§3.5 rule 4: NLA accelerates an operation, it
      // does not route around that operation's checks).
      applied = this._retireStrip(strip, by);
    } else {
      applied = this._applySetState(strip, result.toState, by);
    }

    // Undo (§3.5 rule 5) stays scoped to state-only NLA transitions in
    // Phase 2 (docs/adr/0009) — a transfer-shaped transition's failure
    // mode is the existing transfer-timeout-revert path (§4.5 rule 5), not
    // this button, and _applyTransferStrip already clears any stale entry
    // here regardless of how the transfer happened.
    if (applied.ok && !result.transferTo) {
      this._nlaHistory.set(strip.stripId, { invokedAt: wallNow, prevState, expiresAt: wallNow + 30000 });
    }
    return applied;
  }

  /** Reverts the last NLA-driven transition, within its 30s window (guide §3.5 rule 5). */
  _applyUndo(strip, by) {
    const last = this._nlaHistory.get(strip.stripId);
    if (!last || Date.now() > last.expiresAt) { // the latch's real-time window, see _applyInvokeNla
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no Undo available', strip };
    }
    this._nlaHistory.delete(strip.stripId);
    // A terminal NLA Drop now does more than set a state (see _retireStrip),
    // so undoing one has to put back what it took: clear the remove
    // indicator and re-claim the beacon code. The code can only have been
    // taken by another flight if one was created inside this 30s window —
    // reacquireFdr leaves it alone in that case rather than minting a
    // silent duplicate, exactly as a controller override would (D23).
    if (strip.state === 'DROPPED') {
      strip.flags.removeIndicator = false;
      this._fdrStore.reacquireFdr(strip.fdrId);
      this._droppedWallAt.delete(strip.stripId);
    }
    return this._applySetState(strip, last.prevState, by);
  }

  _applyDropStrip(strip, op, by) {
    // Same open-coordination-link guard as _applyInvokeNla above, for the
    // explicit DropStrip op (dot-command) path — see that guard's comment.
    if (strip.coordination && strip.coordination.state === 'PROPOSED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'cannot drop a Strip with an open coordination proposal — accept, reject, or wait for a response first', strip };
    }
    if (strip.tofiCoordination && strip.tofiCoordination.state === 'PROPOSED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'cannot drop a Strip with an open TOFI proposal — accept, reject, or wait for a response first', strip };
    }
    return this._retireStrip(strip, by);
  }

  /**
   * The ONE path by which a Strip reaches DROPPED, whichever op asked for it
   * (the explicit DropStrip op, or a terminal NLA transition whose toState is
   * DROPPED — every Role has one, labelled "Drop" in the UI).
   *
   * Found by an end-to-end scenario trace: this used to live entirely inside
   * _applyDropStrip, which only the `.drop` dot-command ever reaches. The
   * ordinary Drop *button* routes through InvokeNla -> _applySetState, a
   * generic two-line state setter — so the guide §4.6.3 rule 2 rejection
   * below was trivially bypassable from the default UI (dropping a Strip out
   * from under a live TOFI exchange, leaving the peer's own record stuck at
   * ACTIVE pointing at a Strip that no longer exists), and neither the remove
   * indicator nor the beacon release ever happened on that path at all.
   */
  _retireStrip(strip, by) {
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
    this._droppedWallAt.set(strip.stripId, Date.now()); // the archive's clock, docs/adr/0082
    strip.flags.removeIndicator = true; // distinct from delete (§3.4) — Strip stays queryable, see getRack()
    this._state.bump(strip, by);
    // `marsaChanged` rather than `marsaVoided`: this is a flight ENDING, not a
    // clearance voiding a relation, and the two must not render as the same
    // thing. A tanker landing mid-AR leaves the relation `ENDED` with
    // `endedBy: 'PARTICIPANT_RETIRED'`; nothing went wrong and no alert is due.
    const marsaChanged = this._releaseFdrIfLastStrip(strip, by);
    // docs/adr/0074: a flight that leaves the recovery leaves the stack, with a
    // vacancy and no close-up (H28). A LAUNCH Strip is not in the stack; the
    // removal is a no-op for it.
    let carrierChanged;
    if (this._rules.carrierRetireFlight && ['MARSHAL', 'FINAL', 'PATTERN'].includes(strip.role)) {
      carrierChanged = this._rules.carrierRetireFlight(strip.fdrId, by) || undefined;
    }
    // U7: a replica that ends takes the proposer's link with it.
    let peerFacilityId; let peerStrip;
    const link = strip.coordination;
    if (link && link.mintedForCoordination && this._rules.peerBoard) {
      const peer = this._rules.peerBoard(link.peerFacilityId);
      const ended = peer ? peer.receiveCoordinationPeerGone({ causedBy: this._activeCmid, stripId: link.peerStripId, goneStripId: strip.stripId }) : null;
      if (ended && ended.ok) { peerFacilityId = link.peerFacilityId; peerStrip = ended.strip; }
    }
    return {
      ok: true, strip,
      marsaChanged: marsaChanged && marsaChanged.length ? marsaChanged : undefined,
      fdrs: marsaChanged && marsaChanged.length ? this._drainMarsaRegimeWrites() : undefined,
      peerFacilityId, peerStrip, carrierChanged,
    };
  }

  /**
   * Releases the FDR's beacon code only once NO other live Strip still
   * references that FDR, anywhere (this Facility or any other).
   *
   * One FDR meant one live Strip until TOFI, which deliberately binds a
   * MISSION Strip and its ATC-side Strip to one shared fdrId (docs/adr/0025)
   * with independent lifecycles. An unconditional release therefore handed
   * the shared Mode 3/A code back to the allocator when the MRU controller
   * retired their MISSION Strip — while the ATC-side flight was still
   * airborne and still squawking it — and the next CreateStrip could then
   * mint that same code for an unrelated flight. Silent: the duplicate check
   * (code-allocator.js's validateAssignment) only fires on a manual override,
   * never on the automatic allocate() scan.
   */
  _releaseFdrIfLastStrip(strip, by) {
    const othersLive = this._rules.liveStripsForFdr
      ? this._rules.liveStripsForFdr(strip.fdrId, strip.stripId)
      : 0;
    if (othersLive !== 0) return null;
    this._fdrStore.releaseFdr(strip.fdrId);
    // WP6 (docs/adr/0051) — the flight is over, so it leaves any MARSA relation
    // it was in. Left alone the relation would keep naming an aircraft on the
    // ground, keep its separation regime at MARSA on an FDR nobody is working,
    // and keep arming an interlock for a flight that cannot be assigned
    // anything. Same shape correlation-store.js's retireFinished has, arriving
    // from the other direction: correlation is swept by a 1Hz reconciler and
    // MARSA has no sweep, so the Strip lifecycle has to say so out loud.
    return this._rules.retireMarsaForFdr ? this._rules.retireMarsaForFdr(strip.fdrId, by) : null;
  }

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
    const replay = [];
    for (const [cmid, record] of this._appliedMutations) {
      if (record.appliedWallAt >= horizon) replay.push([cmid, record]);
    }
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
    this._appliedMutations = new Map();
    for (const [cmid, record] of (Array.isArray(data?.replay) ? data.replay : [])) {
      if (typeof cmid === 'string' && record && typeof record === 'object') this._appliedMutations.set(cmid, Object.freeze({ ...record }));
    }
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
