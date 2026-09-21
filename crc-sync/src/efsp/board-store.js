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
const { keyBetween, rebalance } = require('./order-key');
const { isValidAltitude } = require('./airspace-config');
const { MAX_FREE_TEXT } = require('./fdr-store');

const FLAG_KEYS = ['offset', 'flipped', 'removeIndicator', 'highlight', 'attention'];
const APPLIED_MUTATIONS_CAP = 5000;

// Every Strip Role's own starting EfspState, used by _applyCreateStrip when
// the caller doesn't pass an explicit op.initialState. Deliberately just
// each role's first lifecycle state, not the full STATES_BY_ROLE table
// nla.js owns — board-store.js only ever needs the ONE starting value.
const DEFAULT_INITIAL_STATE_BY_ROLE = { DEPARTURE: 'PROPOSED', ARRIVAL: 'INBOUND', OVERFLIGHT: 'TRANSITING', MISSION: 'TASKED' };

function newFlags() {
  return { offset: false, flipped: false, removeIndicator: false, highlight: null, attention: null };
}

/**
 * An altitude block a flight is restricted to inside an airspace. Feet,
 * whole numbers, upper above lower, and — when the airspace publishes its
 * own vertical limits — inside them, since a controller cannot assign a
 * block the airspace does not contain.
 */
function _validateAltitudeBlock(block, definition) {
  if (block === undefined || block === null) return { ok: true };
  if (typeof block !== 'object') return { ok: false, detail: 'altitudeBlock must be {lowerFt, upperFt}' };
  const { lowerFt, upperFt } = block;
  if (!isValidAltitude(lowerFt) || !isValidAltitude(upperFt)) {
    return { ok: false, detail: 'altitudeBlock needs whole-foot lowerFt and upperFt' };
  }
  if (upperFt <= lowerFt) return { ok: false, detail: 'altitudeBlock upperFt must be above lowerFt' };
  if (isValidAltitude(definition.altLowerFt) && lowerFt < definition.altLowerFt) {
    return { ok: false, detail: `${definition.name} starts at ${definition.altLowerFt} ft — ${lowerFt} is below it` };
  }
  if (isValidAltitude(definition.altUpperFt) && upperFt > definition.altUpperFt) {
    return { ok: false, detail: `${definition.name} tops at ${definition.altUpperFt} ft — ${upperFt} is above it` };
  }
  return { ok: true };
}

function deepClone(obj) {
  return obj == null ? obj : JSON.parse(JSON.stringify(obj));
}

class BoardStore {
  /**
   * @param {import('./fdr-store').FdrStore} fdrStore
   * @param {object} rules
   * @param {(blockId:string, role:string) => {kind:'fdr',path:string}|{kind:'annotation'}|null} rules.resolveBlockTarget
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
  constructor(fdrStore, rules) {
    this._fdrStore = fdrStore;
    this._rules = rules;
    this._strips = new Map(); // stripId -> Strip
    this._log = [];           // [{seq, type:'update'|'gone', id}]
    this._seq = 0;
    this._cidSeq = 0;
    this._appliedMutations = new Map(); // clientMutationId -> result, idempotency (§5.2)
    this._mutationLog = null; // optional collaborator, see setMutationLog()
    // stripId -> { invokedAt, prevState, expiresAt } — the 400ms double-tap
    // guard and the 30s Undo window for the last NLA transition (§3.5
    // rules 3 and 5). Deliberately NOT part of the Strip's public shape
    // (not serialized/broadcast) and NOT persisted — losing a still-open
    // Undo window across a restart is an acceptable Phase-1 UX gap, not a
    // correctness or safety concern.
    this._nlaHistory = new Map();
  }

  setMutationLog(mutationLog) { this._mutationLog = mutationLog; }

  get currentSeq() { return this._seq; }
  getStrip(stripId) { return this._strips.get(stripId) || null; }
  getAll() { return [...this._strips.values()]; }

  /** Strips currently placed in a Bay/Rack, in order, excluding DROPPED — a DROPPED Strip stays queryable via getStrip()/getAll() but leaves the visible Board (guide §3.4). */
  getRack(bayId, rackId) {
    return this.getAll()
      .filter(s => s.bayId === bayId && s.rackId === rackId && s.state !== 'DROPPED')
      .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : (a.stripId < b.stripId ? -1 : 1)));
  }

  _touch(stripId) {
    this._log.push({ seq: ++this._seq, type: 'update', id: stripId });
    this._pruneLog();
  }
  _pruneLog() {
    if (this._log.length > 2000) this._log.splice(0, this._log.length - 1000);
  }

  /** Delta resync (guide §5.6) — everything changed since `afterSeq`. */
  getDeltaSince(afterSeq) {
    const entries = [];
    for (let i = this._log.length - 1; i >= 0; i--) {
      if (this._log[i].seq <= afterSeq) break;
      entries.unshift(this._log[i]);
    }
    const byId = new Map();
    for (const e of entries) byId.set(e.id, e);
    const updated = [];
    for (const e of byId.values()) {
      if (this._strips.has(e.id)) updated.push(this._strips.get(e.id));
    }
    return { updated, seq: this._seq };
  }

  // ── orderKey resolution ──────────────────────────────────────────────────

  _resolveOrderKey(bayId, rackId, afterStripId, beforeStripId, excludeStripId) {
    const rackStrips = this.getRack(bayId, rackId).filter(s => s.stripId !== excludeStripId);
    const findKey = (id) => (id ? (rackStrips.find(s => s.stripId === id) || {}).orderKey ?? null : null);
    try {
      return keyBetween(findKey(afterStripId), findKey(beforeStripId));
    } catch (err) {
      if (err.code !== 'ORDER_KEY_EXHAUSTED') throw err;
      this._rebalanceRack(bayId, rackId, excludeStripId);
      const refreshed = this.getRack(bayId, rackId).filter(s => s.stripId !== excludeStripId);
      const findKey2 = (id) => (id ? (refreshed.find(s => s.stripId === id) || {}).orderKey ?? null : null);
      let a = findKey2(afterStripId);
      let b = findKey2(beforeStripId);
      // The ONLY way this retry can still fail after a rebalance (which
      // guarantees every Strip in the Rack gets a fresh, distinct key) is
      // a > b — which can genuinely happen when afterStripId/beforeStripId
      // were bounding two Strips that had COLLIDING keys before the
      // rebalance (order-key.js's jitter tolerance): rebalance() preserves
      // the Rack's own tie-broken order (by stripId), which can come out
      // opposite to whatever the caller's after/before labels assumed.
      // The caller's real intent — "insert between these two specific
      // Strips" — doesn't actually depend on which one is labelled
      // "after" vs "before" once already in this recovery path, so
      // normalize direction here rather than let a second, unrecoverable
      // throw reach applyMutation's catch-all and reject a perfectly
      // resolvable Mutation.
      if (a !== null && b !== null && a > b) { [a, b] = [b, a]; }
      return keyBetween(a, b);
    }
  }

  /** Rebalances one Rack — MUST run as one atomic Board event, never mid-drag (guide §5.4). */
  _rebalanceRack(bayId, rackId, excludeStripId) {
    const ordered = this.getRack(bayId, rackId).filter(s => s.stripId !== excludeStripId);
    const fresh = rebalance(ordered.map(s => s.stripId));
    for (const s of ordered) {
      s.orderKey = fresh.get(s.stripId);
      s.rev += 1;
      this._touch(s.stripId);
    }
  }

  _nextCid() {
    this._cidSeq += 1;
    // 3-digit, zero-padded, sequential for this store's lifetime —
    // [SOURCE-DEFINED] format for Block 4 (guide §6.2); no real-world
    // format is published. See the implementation plan.
    return String(this._cidSeq).padStart(3, '0');
  }

  // ── Mutation application ─────────────────────────────────────────────────

  /**
   * Applies a client Mutation (guide §5.2). Returns
   *   { ok:true, strip, fdr?, warning?, routedTo? }
   * or
   *   { ok:false, reason, strip? }
   * Never throws for an ordinary rejection.
   */
  applyMutation(mutation, actingPositionId, by) {
    if (this._appliedMutations.has(mutation.clientMutationId)) {
      return this._appliedMutations.get(mutation.clientMutationId); // idempotent replay, §5.2
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
    try {
      result = this._dispatch(mutation, actingPositionId, by);
    } catch (err) {
      console.error('[board-store] unexpected error applying Mutation — rejecting it instead of crashing:', err);
      result = { ok: false, reason: 'VALIDATION_ERROR', detail: 'internal error processing mutation' };
    }

    this._appliedMutations.set(mutation.clientMutationId, result);
    if (this._appliedMutations.size > APPLIED_MUTATIONS_CAP) {
      const oldestKey = this._appliedMutations.keys().next().value;
      this._appliedMutations.delete(oldestKey);
    }
    return result;
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
    if (this._rules.canMutate && !this._rules.canMutate(actingPositionId, op.kind)) {
      return { ok: false, reason: 'PERMISSION_DENIED' };
    }

    if (op.kind === 'CreateStrip') {
      const result = this._applyCreateStrip(op, actingPositionId, by);
      this._recordAudit(mutation, actingPositionId, by, null, result);
      return result;
    }

    const strip = this._strips.get(mutation.stripId);
    if (!strip) return { ok: false, reason: 'NOT_FOUND' };
    if (strip.rev !== mutation.baseRev) return { ok: false, reason: 'STALE_REV', strip: deepClone(strip) };

    // Every op below requires the acting Position to be the Strip's
    // current Owner (guide §4.4 rule 2) — TransferStrip is itself an
    // owner-only action (the sender transfers away; the receiver doesn't
    // pull), so this gate covers it too.
    if (strip.ownerPositionId !== actingPositionId) {
      return { ok: false, reason: 'NOT_OWNER', strip: deepClone(strip) };
    }

    const before = deepClone(strip);
    let result;
    switch (op.kind) {
      case 'MoveStrip':     result = this._applyMoveStrip(strip, op, by); break;
      case 'SetBlock':      result = this._applySetBlock(strip, op, by, actingPositionId, mutation.clientMutationId); break;
      case 'TransferStrip': result = this._applyTransferStrip(strip, op, by); break;
      case 'SetFlag':       result = this._applySetFlag(strip, op, by); break;
      case 'SetState':      result = this._applySetState(strip, op.toState, by); break;
      case 'InvokeNla':     result = this._applyInvokeNla(strip, by); break;
      case 'Undo':          result = this._applyUndo(strip, by); break;
      case 'DropStrip':     result = this._applyDropStrip(strip, op, by); break;
      // WP4A cross-Facility coordination primitives (guide §4.6,
      // docs/adr/0015) — all 5 share one handler; op.kind IS the primitive,
      // op.action selects PROPOSE/ACCEPT/REJECT. See _applyCoordinationOp.
      case 'HANDOFF':
      case 'POINT_OUT':
      case 'TRAFFIC':
      case 'OPERATIONAL_REQUEST':
      case 'AIT':
        result = this._applyCoordinationOp(strip, op, by, actingPositionId); break;
      // WP4A second slice (docs/adr/0025) — TOFI (guide §4.6.3), the
      // ATC<->MRU sub-protocol. Kept structurally separate from the 5
      // primitives above (own strip.tofiCoordination field, own dispatcher)
      // rather than folded into _applyCoordinationOp — TOFI is a two-step
      // exchange (ENTRY and EXIT) plus a distinct comms-transfer action,
      // none of which the single-shot PROPOSE/ACCEPT/REJECT shape above
      // was built to express. See _applyTofiOp.
      case 'TOFI':
        result = this._applyTofiOp(strip, op, by, actingPositionId); break;
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
      default:              result = { ok: false, reason: 'VALIDATION_ERROR', strip: deepClone(strip) };
    }
    this._recordAudit(mutation, actingPositionId, by, before, result);
    return result;
  }

  _recordAudit(mutation, actingPositionId, by, before, result) {
    if (!this._mutationLog || !result.ok) return;
    this._mutationLog.record({
      clientMutationId: mutation.clientMutationId,
      op: mutation.op.kind,
      stripId: result.strip.stripId,
      actingPositionId,
      actorId: by || null,
      at: Date.now(),
      before,
      after: deepClone(result.strip),
      // Distinguishes a self-coordinated boundary event from a two-party
      // one (guide §4.8.3 rule 4) — undefined for every op except a
      // successful TransferStrip, where board-store computes it above.
      selfCoordinated: result.selfCoordinated,
    });
  }

  _applyCreateStrip(op, actingPositionId, by) {
    // A Strip in a Bay this Facility does not have is invisible on every
    // Board — every read path goes through a Bay — while still holding a
    // beacon code. Cheaper to refuse than to hunt for later.
    const bayCheck = this._requireKnownBay(op.bayId);
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

    const created = this._fdrStore.createFdr(op.fdr, { by });
    if (!created.ok) return { ok: false, reason: created.reason, detail: created.detail };

    const stripId = crypto.randomUUID();
    const rackStrips = this.getRack(op.bayId, op.rackId);
    const afterStripId = op.afterStripId !== undefined
      ? op.afterStripId
      : (rackStrips.length ? rackStrips[rackStrips.length - 1].stripId : null);
    const orderKey = this._resolveOrderKey(op.bayId, op.rackId, afterStripId, op.beforeStripId || null, null);

    const now = Date.now();
    const strip = {
      stripId,
      cid: this._nextCid(),
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
    this._strips.set(stripId, strip);
    this._touch(stripId);
    return { ok: true, strip, fdr: created.fdr };
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
    strip.rackId = targetBay.rackIds[0];
    strip.orderKey = this._resolveOrderKey(targetBay.bayId, targetBay.rackIds[0], null, null, strip.stripId);
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
      convertedAt: Date.now(),
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
    strip.rev += 1;
    strip.updatedAt = Date.now();
    strip.updatedBy = by || null;
    this._touch(strip.stripId);
    return { ok: true, strip, fdr: updatedFdr };
  }

  /**
   * A Bay configured with an implied EfspState (facility-config.js) is
   * treated as EXACTLY EQUIVALENT to pressing the NLA button for that
   * transition (guide §3.5 rule 4: "every NLA transition MUST also be
   * reachable by drag-and-drop... NLA is an accelerator, not the only
   * path" — accelerator for a specific transition, not an unrestricted
   * teleport to any state). Dropping into a Bay whose implied state isn't
   * the CURRENT state's one legal next step — or IS that step but it's
   * presently inhibited (no beacon code, incomplete flight plan, a hold in
   * force, ...) — is rejected exactly like invoking that NLA would be.
   * Without this, a drag (or a same-controller self-coordinated Transfer,
   * guide §4.8.3) could silently skip a Strip past every doctrine check
   * NLA enforces — e.g. straight from PROPOSED into a CLEARED Bay with no
   * flight plan at all, which is exactly the bug this closes.
   * @returns {{ok:true, impliedState:string|null}|{ok:false, reason:string, detail:string}}
   */
  /** {isOccupied, coveringPositionFor, facilityId} bound from this._rules — computeNla()'s occupancy context (guide §4.5, e.g. DEPARTED's real Hand-Off-to-APP inhibit). `facilityId` (WP4A, docs/adr/0014) lets nla.js distinguish a CENTER-held ARRIVAL Strip's INBOUND state (whose next step is the Coordinate/HANDOFF button, not an intrafacility NLA transfer) from an INCIRLIK one. Built once per call site rather than inline so both computeNla() call sites below stay in lockstep. */
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
      approvedAt: Date.now(),
      approvedBy: by || null,
    };
    strip.rev += 1;
    strip.updatedAt = Date.now();
    strip.updatedBy = by || null;
    this._touch(strip.stripId);

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
    strip.rev += 1;
    strip.updatedAt = Date.now();
    strip.updatedBy = by || null;
    this._touch(strip.stripId);
    return { ok: true, strip, fdr: fdrResult.fdr };
  }

  _nlaCtx() {
    return {
      isOccupied: this._rules.isOccupied, coveringPositionFor: this._rules.coveringPositionFor,
      facilityId: this._rules.facilityId, standingReleases: this._rules.standingReleases,
    };
  }

  _validateBayImpliedTransition(strip, targetBayId) {
    const impliedState = this._rules.bayImpliesState ? this._rules.bayImpliesState(targetBayId) : null;
    if (!impliedState || impliedState === strip.state) return { ok: true, impliedState }; // non-state-implying Bay, or already there — always fine

    // Per-State authority (guide §3.4's "normally owned by" column,
    // permission.js's canActOnState) — checked here too, not just in
    // _applyInvokeNla, because dragging into an implied-state Bay is the
    // OTHER path to the exact same transition (§3.5 rule 4: NLA is an
    // accelerator, never the only path). Gating only the NLA button would
    // leave this reachable by drag regardless of who "should" be advancing
    // the Strip. strip.ownerPositionId is the acting Position here —
    // _dispatch() already verified actingPositionId === strip.ownerPositionId
    // before any _apply* method runs.
    if (this._rules.canActOnState && !this._rules.canActOnState(strip.ownerPositionId, strip.role, strip.state)) {
      return { ok: false, reason: 'PERMISSION_DENIED', detail: `${strip.state} is not ${strip.ownerPositionId}'s to advance` };
    }

    const fdr = this._fdrStore.getFdr(strip.fdrId);
    const nla = this._rules.computeNla ? this._rules.computeNla(strip, fdr, Date.now(), this._nlaCtx()) : null;
    if (!nla || nla.inhibited) {
      return { ok: false, reason: 'NLA_INHIBITED', detail: nla ? nla.inhibited : `no legal transition from ${strip.state}` };
    }
    if (nla.toState !== impliedState) {
      return {
        ok: false, reason: 'VALIDATION_ERROR',
        detail: `dropping here would set state to ${impliedState}, but the only valid next state from ${strip.state} is ${nla.toState}`,
      };
    }
    return { ok: true, impliedState };
  }

  /** @returns {object|null} a rejection when this Facility has no such Bay, else null. */
  _requireKnownBay(bayId, strip) {
    if (!this._rules.bayExists || this._rules.bayExists(bayId)) return null;
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `no such Bay here: ${bayId}`, strip };
  }

  _applyMoveStrip(strip, op, by) {
    const bayCheck = this._requireKnownBay(op.bayId, strip);
    if (bayCheck) return bayCheck;
    const check = this._validateBayImpliedTransition(strip, op.bayId);
    if (!check.ok) return { ok: false, reason: check.reason, detail: check.detail, strip };

    strip.bayId = op.bayId;
    strip.rackId = op.rackId;
    strip.orderKey = this._resolveOrderKey(op.bayId, op.rackId, op.afterStripId || null, op.beforeStripId || null, strip.stripId);
    if (check.impliedState && check.impliedState !== strip.state) strip.state = check.impliedState;

    strip.rev += 1;
    strip.updatedAt = Date.now();
    strip.updatedBy = by || null;
    this._touch(strip.stripId);
    return { ok: true, strip };
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

    if (target.kind === 'fdr' || target.kind === 'airspace-owner' || target.kind === 'tofi' || target.kind === 'frequency') {
      const fdrResult = target.kind === 'airspace-owner'
        ? this._fdrStore.setAirspaceOwner(strip.fdrId, op.value, { by })
        : target.kind === 'frequency'
          ? this._fdrStore.setWorkingFrequency(strip.fdrId, op.value === '' || op.value === undefined ? null : op.value, { by })
          : target.kind === 'tofi'
            ? this._fdrStore.setTofi(strip.fdrId, { [target.field]: op.value }, { by })
            : target.path === 'identity.beaconAssigned'
              ? this._fdrStore.setBeaconAssigned(strip.fdrId, op.value, { by })
              : this._fdrStore.setField(strip.fdrId, target.path, op.value, { by });
      if (!fdrResult.ok) return { ok: false, reason: fdrResult.reason, detail: fdrResult.detail, strip };

      // FDR keeps its own independent rev (guide §3.1); the Strip's rev is
      // also bumped here as a deliberate Phase-1 simplification so the
      // ack/broadcast cycle has one consistent rev to key off per Strip,
      // rather than building a fully separate FDR-level optimistic-
      // concurrency protocol on the wire. See the implementation plan.
      strip.rev += 1;
      strip.updatedAt = Date.now();
      strip.updatedBy = by || null;
      this._touch(strip.stripId);
      return {
        ok: true, strip, fdr: fdrResult.fdr, warning: fdrResult.warning,
        marsaVoided: this._marsaVoidFor(strip, op, by, actingPositionId, clientMutationId),
      };
    }

    const result = this._applyAnnotationSet(strip, op.blockId, op.value, op.confirmVacated, by);
    // Every Block the interlock tags is annotation-routed today (DEPARTURE's
    // 20/21, ARRIVAL's 7 and 9A-VECTOR, OVERFLIGHT's 7A and 9A-VECTOR), so in
    // practice this is the branch that fires — but the check sits on both paths
    // because which routing a Block uses is a Block Map decision that can
    // change, and an interlock that silently stops covering a Block when its
    // target kind changes is the failure mode docs/adr/0041 is about.
    if (result.ok) result.marsaVoided = this._marsaVoidFor(strip, op, by, actingPositionId, clientMutationId);
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
      cell.entries.push({ value, status: 'ACTIVE', at: Date.now(), by: by || null });
    }

    strip.rev += 1;
    strip.updatedAt = Date.now();
    strip.updatedBy = by || null;
    this._touch(strip.stripId);
    return { ok: true, strip };
  }

  _applyTransferStrip(strip, op, by) {
    const bayCheck = this._requireKnownBay(op.bayId, strip);
    if (bayCheck) return bayCheck;
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
    const check = this._validateBayImpliedTransition(strip, op.bayId);
    if (!check.ok) return { ok: false, reason: check.reason, detail: check.detail, strip };

    let destPositionId = op.toPositionId;
    let routedTo = null;

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
    strip.bayId = op.bayId;
    strip.rackId = op.rackId;
    strip.orderKey = this._resolveOrderKey(op.bayId, op.rackId, op.afterStripId || null, op.beforeStripId || null, strip.stripId);
    if (check.impliedState && check.impliedState !== strip.state) strip.state = check.impliedState;

    strip.rev += 1;
    strip.updatedAt = Date.now();
    strip.updatedBy = by || null;
    this._touch(strip.stripId);
    // A pending Undo window (§3.5 rule 5) is for reverting a STATE change —
    // once ownership has also moved, "revert the state" no longer means
    // what it did when it was recorded (the Strip may now be under a
    // different Position's Bay/lifecycle entirely). Drop it rather than
    // let a stale Undo fire against a Strip that's since changed hands,
    // regardless of whether this transfer came from a drag or an NLA-
    // driven transfer-shaped transition (board-store.js's own _applyInvokeNla).
    this._nlaHistory.delete(strip.stripId);
    return { ok: true, strip, routedTo, selfCoordinated };
  }

  _applySetFlag(strip, op, by) {
    if (!FLAG_KEYS.includes(op.flag)) return { ok: false, reason: 'VALIDATION_ERROR', strip };
    strip.flags[op.flag] = op.value;
    strip.rev += 1;
    strip.updatedAt = Date.now();
    strip.updatedBy = by || null;
    this._touch(strip.stripId);
    return { ok: true, strip };
  }

  _applySetState(strip, toState, by) {
    if (this._rules.isValidState && !this._rules.isValidState(toState, strip.role)) {
      return { ok: false, reason: 'VALIDATION_ERROR', strip };
    }
    strip.state = toState;
    strip.rev += 1;
    strip.updatedAt = Date.now();
    strip.updatedBy = by || null;
    this._touch(strip.stripId);
    return { ok: true, strip };
  }

  _applyInvokeNla(strip, by) {
    const now = Date.now();
    const lastInvoke = this._nlaHistory.get(strip.stripId);
    if (lastInvoke && now - lastInvoke.invokedAt < 400) {
      // Idempotent double-tap guard (§3.5 rule 3): a second press within
      // 400ms is discarded, not queued — the first tap already applied,
      // so from the controller's perspective this is a no-op success, not
      // an error and not a second transition.
      return { ok: true, strip };
    }

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
      return { ok: false, reason: 'PERMISSION_DENIED', detail: `${strip.state} is not ${strip.ownerPositionId}'s to advance`, strip };
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
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'cannot advance a Strip with an open coordination proposal — accept, reject, or wait for a response first', strip };
    }
    // Same open-link guard, extended to TOFI's own coordination record
    // (WP4A second slice) — a Strip with an open (unresolved) TOFI
    // proposal shouldn't silently advance its own lifecycle out from under
    // the pending exchange.
    if (strip.tofiCoordination && strip.tofiCoordination.state === 'PROPOSED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'cannot advance a Strip with an open TOFI proposal — accept, reject, or wait for a response first', strip };
    }

    const fdr = this._fdrStore.getFdr(strip.fdrId);
    const result = this._rules.computeNla(strip, fdr, now, this._nlaCtx());
    if (!result || result.inhibited) {
      return { ok: false, reason: 'NLA_INHIBITED', detail: result ? result.inhibited : 'no NLA for this state', strip };
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
      applied = this._applyTransferStrip(strip, { toPositionId: result.transferTo, bayId: targetBay.bayId, rackId: targetBay.rackIds[0] }, by);
    } else if (result.toState === 'DROPPED') {
      // Every Role's terminal NLA is a Drop (DEPARTURE at HANDED_OFF,
      // ARRIVAL at TAXI_IN, OVERFLIGHT at TRANSITING, MISSION at RTB), and
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
      this._nlaHistory.set(strip.stripId, { invokedAt: now, prevState, expiresAt: now + 30000 });
    }
    return applied;
  }

  /** Reverts the last NLA-driven transition, within its 30s window (guide §3.5 rule 5). */
  _applyUndo(strip, by) {
    const last = this._nlaHistory.get(strip.stripId);
    if (!last || Date.now() > last.expiresAt) {
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
    strip.flags.removeIndicator = true; // distinct from delete (§3.4) — Strip stays queryable, see getRack()
    strip.rev += 1;
    strip.updatedAt = Date.now();
    strip.updatedBy = by || null;
    this._touch(strip.stripId);
    // `marsaChanged` rather than `marsaVoided`: this is a flight ENDING, not a
    // clearance voiding a relation, and the two must not render as the same
    // thing. A tanker landing mid-AR leaves the relation `ENDED` with
    // `endedBy: 'PARTICIPANT_RETIRED'`; nothing went wrong and no alert is due.
    const marsaChanged = this._releaseFdrIfLastStrip(strip, by);
    return { ok: true, strip, marsaChanged: marsaChanged && marsaChanged.length ? marsaChanged : undefined };
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

  // ── WP4A: cross-Facility coordination (guide §4.6, docs/adr/0013-0018) ──
  //
  // "The Strip does not cross the Facility boundary... one logical FDR, N
  // per-Facility Strip replicas" (guide §4.6, defect D13 if built as a
  // move). Concretely: this BoardStore instance is one Facility's Board
  // (index.js's composition root now constructs one {BoardStore,
  // PositionStore} pair PER Facility — see docs/adr/0013). A coordination
  // primitive's PROPOSE action mutates the SENDER's own existing Strip
  // (ownership-gated exactly like every other op — _dispatch's existing
  // NOT_OWNER check already covers it) and, on success, calls a public
  // method on the RECEIVING Facility's own BoardStore instance
  // (`rules.peerBoard(facilityId)`) to mint a brand-new, independent Strip
  // object there. From that point the two replicas are two rows in two
  // separate `_strips` Maps, linked only by `coordination.peerStripId`/
  // `peerFacilityId` — never a shared identity, never one object moved.
  // Independent removability (a WP4A acceptance criterion) falls out of
  // this for free: _applyDropStrip on one instance structurally cannot
  // reach the other instance's Map at all.

  /**
   * @param {object} strip — the Strip this Mutation targets (already
   *   verified by _dispatch to be owned by actingPositionId)
   * @param {{kind:string, action:'PROPOSE'|'ACCEPT'|'REJECT', toFacilityId?:string, toPositionId?:string, note?:string}} op
   */
  _applyCoordinationOp(strip, op, by, actingPositionId) {
    switch (op.action) {
      case 'PROPOSE':  return this._applyCoordinationPropose(strip, op, by, actingPositionId);
      case 'ACCEPT':   return this._applyCoordinationAccept(strip, op, by, actingPositionId);
      case 'REJECT':   return this._applyCoordinationReject(strip, op, by, actingPositionId);
      // OPERATIONAL_REQUEST's 3-way response (guide §4.6: APPROVED/UNABLE/
      // STAND BY) — ACCEPT/REJECT already cover APPROVED/UNABLE
      // semantically (coordination.js's acceptPhrase:'APPROVED'), so
      // STAND_BY is the only genuinely new action, and only valid for that
      // one primitive (docs/adr/0022).
      case 'STAND_BY': return this._applyCoordinationStandBy(strip, op, by);
      default:         return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown coordination action: ${op.action}`, strip };
    }
  }

  _applyCoordinationPropose(strip, op, by, actingPositionId) {
    const primitive = op.kind;
    const effect = this._rules.coordinationEffect ? this._rules.coordinationEffect(primitive) : null;
    if (!effect) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown coordination primitive: ${primitive}`, strip };

    // AIT is configuration, not a default (guide §4.6 rule 7, docs/adr/0022)
    // — every other primitive is always available to APP/CTR; AIT alone
    // additionally requires a written directive on file for this Facility.
    if (primitive === 'AIT' && !this._rules.aitAuthorized) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: "AIT requires a written directive — not authorized in this Facility's configuration", strip };
    }

    // Which (role, state) a Strip must be in to propose ANY of the 5
    // primitives (docs/adr/0022) — the mirror of this check the client
    // performs proactively in bay-view.js's _canProposeCoordination; this
    // is the authoritative half, since the client's is only a convenience
    // gate. Only the (role, state) combos a receiving Facility actually has
    // a landing Bay configured for are eligible — see coordination.js.
    if (this._rules.coordinationEligibleState && this._rules.coordinationEligibleState(strip.role) !== strip.state) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `a ${strip.role} Strip may not propose coordination from state ${strip.state}`, strip };
    }

    if (strip.coordination && (strip.coordination.state === 'PROPOSED' || strip.coordination.state === 'ACTIVE')) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'this Strip already has an open coordination link', strip };
    }
    // A Strip currently sitting in ITS OWNER'S Coordination Bay is always
    // the RECEIVER-side replica/proposal artifact, never a legitimate
    // flight record to propose FROM — accept relocates a Strip OUT of the
    // Coordination Bay (_applyCoordinationAccept), so one still there is
    // either awaiting a response (already caught above) or REJECTED and
    // left inert. Bug found in live testing: without this, a rejected
    // receiver-side replica could re-propose right back to its own
    // sender, minting a spurious third replica. Authoritative half of
    // bay-view.js's _canProposeCoordination client-side gate.
    const ownCoordinationBay = this._rules.coordinationBayFor ? this._rules.coordinationBayFor(strip.ownerPositionId) : null;
    if (ownCoordinationBay && strip.bayId === ownCoordinationBay.bayId) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'this Strip is a coordination replica, not a flight record you can propose coordination from', strip };
    }
    if (!op.toFacilityId || !op.toPositionId) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'toFacilityId and toPositionId are required', strip };
    }
    if (op.toFacilityId === this._rules.facilityId) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'coordination target must be a different Facility', strip };
    }
    const peer = this._rules.peerBoard ? this._rules.peerBoard(op.toFacilityId) : null;
    if (!peer) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown Facility: ${op.toFacilityId}`, strip };

    // Track-degradation soft interlock (guide §4.6 rule 5): CST/FAIL/IF/NT/
    // TRK force verbal coordination; a non-empty note is the electronic
    // stand-in for "verbal coordination occurred" (docs/adr/0019).
    const fdr = this._fdrStore.getFdr(strip.fdrId);
    const degraded = fdr && fdr.identity.trackDegradationFlag && fdr.identity.trackDegradationFlag !== 'NONE';
    if (degraded && !op.note) {
      return {
        ok: false, reason: 'VALIDATION_ERROR',
        detail: `track degradation (${fdr.identity.trackDegradationFlag}) forces verbal coordination — a note is required`,
        strip,
      };
    }

    const now = Date.now();
    const proposal = peer.receiveCoordinationProposal({
      primitive, fromFacilityId: this._rules.facilityId, fromPositionId: actingPositionId,
      fromStripId: strip.stripId, toPositionId: op.toPositionId, fdrId: strip.fdrId,
      fromRole: strip.role, fromState: strip.state,
      note: op.note || null, by,
    });
    if (!proposal.ok) return { ok: false, reason: proposal.reason || 'VALIDATION_ERROR', detail: proposal.detail, strip };

    strip.coordination = {
      primitive,
      state: 'PROPOSED',
      peerFacilityId: op.toFacilityId,
      peerStripId: proposal.strip.stripId,
      peerPositionId: op.toPositionId,
      // Jurisdiction stays with the initiator until (and unless) ACCEPT
      // moves it — guide §4.6's table, modelled as two independent refs
      // because POINT_OUT is the one primitive where they split (rule 1).
      dataOwnerPositionRef: { facilityId: this._rules.facilityId, positionId: actingPositionId },
      separationResponsibilityRef: { facilityId: this._rules.facilityId, positionId: actingPositionId },
      radarIdTransferred: false,
      commsTransferred: false,
      lastForwardedEtaUtc: fdr ? fdr.filed.estimatedArrivalTimeUtc : null,
      note: op.note || null,
      initiatedAt: now, initiatedBy: by || null,
      acceptedAt: null, acceptedBy: null,
      lastStandByAt: null, // OPERATIONAL_REQUEST-only (docs/adr/0022) — stamped by _applyCoordinationStandBy
    };
    strip.rev += 1;
    strip.updatedAt = now;
    strip.updatedBy = by || null;
    this._touch(strip.stripId);
    // Bug found in live testing: receiveCoordinationProposal mints a real
    // Strip in the PEER Facility's own BoardStore (a live-in-memory side
    // effect, correct), but nothing surfaced that to efsp-ws.js — meaning
    // no connected client was ever told about it over the wire. Only a
    // full resync (reconnect) would ever pick it up. peerFacilityId/
    // peerStrip let _handleMutation broadcast a SECOND efsp-board-delta,
    // scoped to the peer Facility, alongside the normal one for this side.
    return { ok: true, strip, peerFacilityId: op.toFacilityId, peerStrip: proposal.strip };
  }

  _applyCoordinationAccept(strip, op, by, actingPositionId) {
    if (!strip.coordination || strip.coordination.state !== 'PROPOSED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no pending coordination proposal on this Strip', strip };
    }
    const effect = this._rules.coordinationEffect ? this._rules.coordinationEffect(strip.coordination.primitive) : null;
    if (!effect) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown coordination primitive: ${strip.coordination.primitive}`, strip };

    const now = Date.now();
    strip.coordination.state = 'ACTIVE';
    strip.coordination.radarIdTransferred = effect.radarIdTransfers;
    strip.coordination.commsTransferred = effect.commsTransfers;
    strip.coordination.acceptedAt = now;
    strip.coordination.acceptedBy = by || null;
    if (effect.dataOwnershipMoves) {
      strip.coordination.dataOwnerPositionRef = { facilityId: this._rules.facilityId, positionId: actingPositionId };
    }
    if (effect.separationResponsibilityMoves) {
      strip.coordination.separationResponsibilityRef = { facilityId: this._rules.facilityId, positionId: actingPositionId };
    }

    // Move the Strip out of the Coordination Bay into the receiving
    // Position's normal working Bay for whatever (role, state) it was
    // already minted with (docs/adr/0022) — the replica's state was set
    // correctly by receiveCoordinationProposal already; accept only
    // relocates it, it never advances the state itself.
    const targetBay = this._rules.bayForImpliedState ? this._rules.bayForImpliedState(strip.ownerPositionId, strip.state) : null;
    if (targetBay) {
      strip.bayId = targetBay.bayId;
      strip.rackId = targetBay.rackIds[0];
      strip.orderKey = this._resolveOrderKey(targetBay.bayId, targetBay.rackIds[0], null, null, strip.stripId);
    }
    strip.rev += 1;
    strip.updatedAt = now;
    strip.updatedBy = by || null;
    this._touch(strip.stripId);

    // Tell the peer their sender-side Strip is now ACTIVE too — both
    // replicas agree the exchange is live; each proceeds independently
    // from here (D13's "independently removable" acceptance criterion).
    // Its return value is captured (previously discarded) for the same
    // reason _applyCoordinationPropose's is — see that method's comment.
    const peerFacilityId = strip.coordination.peerFacilityId;
    let peerStrip = null;
    if (this._rules.peerBoard) {
      const peer = this._rules.peerBoard(peerFacilityId);
      if (peer) {
        const peerResult = peer.receiveCoordinationResponse({ stripId: strip.coordination.peerStripId, response: 'ACCEPT', by });
        if (peerResult.ok) peerStrip = peerResult.strip;
      }
    }
    return { ok: true, strip, peerFacilityId, peerStrip };
  }

  _applyCoordinationReject(strip, op, by) {
    if (!strip.coordination || strip.coordination.state !== 'PROPOSED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no pending coordination proposal on this Strip', strip };
    }
    strip.coordination.state = 'REJECTED';
    strip.rev += 1;
    strip.updatedAt = Date.now();
    strip.updatedBy = by || null;
    this._touch(strip.stripId);

    const peerFacilityId = strip.coordination.peerFacilityId;
    let peerStrip = null;
    if (this._rules.peerBoard) {
      const peer = this._rules.peerBoard(peerFacilityId);
      if (peer) {
        const peerResult = peer.receiveCoordinationResponse({ stripId: strip.coordination.peerStripId, response: 'REJECT', by });
        if (peerResult.ok) peerStrip = peerResult.strip;
      }
    }
    return { ok: true, strip, peerFacilityId, peerStrip };
  }

  /**
   * OPERATIONAL_REQUEST's third response (guide §4.6, docs/adr/0022) — the
   * request is still under consideration, not resolved either way.
   * Deliberately does NOT touch strip.coordination.state (stays PROPOSED);
   * only stamps a timestamp both sides can show so the requester sees the
   * request wasn't silently dropped.
   */
  _applyCoordinationStandBy(strip, op, by) {
    if (!strip.coordination || strip.coordination.state !== 'PROPOSED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no pending coordination proposal on this Strip', strip };
    }
    if (strip.coordination.primitive !== 'OPERATIONAL_REQUEST') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'STAND_BY only applies to OPERATIONAL_REQUEST', strip };
    }
    strip.coordination.lastStandByAt = Date.now();
    strip.rev += 1;
    strip.updatedAt = Date.now();
    strip.updatedBy = by || null;
    this._touch(strip.stripId);

    const peerFacilityId = strip.coordination.peerFacilityId;
    let peerStrip = null;
    if (this._rules.peerBoard) {
      const peer = this._rules.peerBoard(peerFacilityId);
      if (peer) {
        const peerResult = peer.receiveCoordinationResponse({ stripId: strip.coordination.peerStripId, response: 'STAND_BY', by });
        if (peerResult.ok) peerStrip = peerResult.strip;
      }
    }
    return { ok: true, strip, peerFacilityId, peerStrip };
  }

  /**
   * Called by the SENDING Facility's BoardStore (via rules.peerBoard) when
   * a coordination primitive is PROPOSEd against it — mints a brand-new,
   * independent Strip in THIS Facility's own `_strips` Map, landing in the
   * receiving Position's Coordination Bay. This is the actual "two
   * replicas" mechanism (guide §4.6/D13): a new object, a new stripId, a
   * new orderKey within this Board — never the sender's Strip relocated.
   * Bypasses the normal ownership/baseRev/ordinary-permission gates
   * entirely, same justification as reassignPositionStrips(): there is no
   * controller "sending into" this Board from the inside to check against;
   * the only gate that matters is which Bay the receiving Position has
   * configured to accept it (coordinationBayFor — absent means refused).
   *
   * `fromRole`/`fromState` (docs/adr/0022) — the replica is minted with the
   * SENDER's own Strip Role/EfspState, not a hardcoded ARRIVAL/INBOUND
   * shape. `_applyCoordinationPropose` already validated the sender's
   * (role, state) is one of coordination.js's COORDINATION_ELIGIBLE_STATES
   * combos, so nothing further to check here.
   * @returns {{ok:true, strip}|{ok:false, reason, detail}}
   */
  receiveCoordinationProposal({ primitive, fromFacilityId, fromPositionId, fromStripId, toPositionId, fdrId, fromRole, fromState, note, by }) {
    const fdr = this._fdrStore.getFdr(fdrId);
    if (!fdr) return { ok: false, reason: 'NOT_FOUND', detail: 'referenced FDR not found' };

    const coordinationBay = this._rules.coordinationBayFor ? this._rules.coordinationBayFor(toPositionId) : null;
    if (!coordinationBay) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `no Coordination Bay configured for ${toPositionId}` };
    }

    const stripId = crypto.randomUUID();
    const now = Date.now();
    const rackStrips = this.getRack(coordinationBay.bayId, coordinationBay.rackIds[0]);
    const afterStripId = rackStrips.length ? rackStrips[rackStrips.length - 1].stripId : null;
    const orderKey = this._resolveOrderKey(coordinationBay.bayId, coordinationBay.rackIds[0], afterStripId, null, null);

    const strip = {
      stripId,
      cid: this._nextCid(),
      fdrId,
      rev: 1,
      // The replica carries the SENDER's own Role/EfspState (docs/adr/0022)
      // from the moment it's minted, not a separate "not yet accepted"
      // pseudo-state — coordination.state is what actually tracks
      // PROPOSED/ACTIVE/REJECTED. fromState is guaranteed to be one of
      // coordination.js's COORDINATION_ELIGIBLE_STATES combos (checked by
      // _applyCoordinationPropose before this is ever called), so the
      // receiving Facility is guaranteed to have a Bay configured for it.
      role: fromRole,
      state: fromState,
      ownerPositionId: toPositionId,
      bayId: coordinationBay.bayId,
      rackId: coordinationBay.rackIds[0],
      orderKey,
      annotations: {},
      flags: newFlags(),
      // No `correlation` — it is keyed by fdrId, and a replica shares the
      // originator's FDR (docs/adr/0013), so it shares the correlation too.
      // That is the case a per-Strip field got wrong: both halves of a
      // cross-Facility exchange are looking at one airframe.
      coordination: {
        primitive,
        state: 'PROPOSED',
        peerFacilityId: fromFacilityId,
        peerStripId: fromStripId,
        peerPositionId: fromPositionId,
        dataOwnerPositionRef: { facilityId: fromFacilityId, positionId: fromPositionId },
        separationResponsibilityRef: { facilityId: fromFacilityId, positionId: fromPositionId },
        radarIdTransferred: false,
        commsTransferred: false,
        lastForwardedEtaUtc: fdr.filed.estimatedArrivalTimeUtc || null,
        note: note || null,
        initiatedAt: now, initiatedBy: by || null,
        acceptedAt: null, acceptedBy: null,
        lastStandByAt: null,
      },
      createdAt: now, updatedAt: now, updatedBy: by || null,
    };
    this._strips.set(stripId, strip);
    this._touch(stripId);
    return { ok: true, strip };
  }

  /**
   * Called by the RECEIVING Facility's BoardStore (via rules.peerBoard)
   * once its controller has ACCEPTed or REJECTed a proposal — updates the
   * SENDER's original Strip's coordination record to match, so both
   * replicas agree on the outcome. Bypasses the ordinary Mutation gates
   * for the same reason receiveCoordinationProposal does.
   */
  receiveCoordinationResponse({ stripId, response, by }) {
    const strip = this._strips.get(stripId);
    if (!strip || !strip.coordination) return { ok: false, reason: 'NOT_FOUND' };

    const now = Date.now();
    if (response === 'ACCEPT') {
      const effect = this._rules.coordinationEffect ? this._rules.coordinationEffect(strip.coordination.primitive) : null;
      strip.coordination.state = 'ACTIVE';
      strip.coordination.acceptedAt = now;
      strip.coordination.acceptedBy = by || null;
      if (effect) {
        strip.coordination.radarIdTransferred = effect.radarIdTransfers;
        strip.coordination.commsTransferred = effect.commsTransfers;
        if (effect.dataOwnershipMoves) {
          strip.coordination.dataOwnerPositionRef = { facilityId: strip.coordination.peerFacilityId, positionId: strip.coordination.peerPositionId };
        }
        if (effect.separationResponsibilityMoves) {
          strip.coordination.separationResponsibilityRef = { facilityId: strip.coordination.peerFacilityId, positionId: strip.coordination.peerPositionId };
        }
      }
    } else if (response === 'STAND_BY') {
      // Doesn't resolve anything — just lets the requester's own Strip
      // show the request wasn't dropped (docs/adr/0022). state stays
      // whatever it already was (PROPOSED).
      strip.coordination.lastStandByAt = now;
    } else {
      strip.coordination.state = 'REJECTED';
    }
    strip.rev += 1;
    strip.updatedAt = now;
    strip.updatedBy = by || null;
    this._touch(strip.stripId);
    return { ok: true, strip };
  }

  // ── WP4A second slice: TOFI (guide §4.6.3, docs/adr/0025) ───────────────
  //
  // A genuinely different sub-protocol from the 5 primitives above, not a
  // 6th row in the same table — deliberately kept structurally separate:
  //
  //  1. TWO independent exchanges over one Strip's life (ENTRY, then EXIT),
  //     not one-shot — the ATC-side Strip's tofiCoordination re-enters
  //     PROPOSED for EXIT after ENTRY's already resolved, which the 5
  //     primitives' "already has an open link, ever" guard would forbid.
  //  2. Jurisdiction (data ownership, separation responsibility) NEVER
  //     transfers — the ATC-side Strip stays live and posted throughout
  //     (rule 2). There is nothing analogous to dataOwnerPositionRef/
  //     separationResponsibilityRef to move.
  //  3. A distinct, separate comms-transfer ACTION (guide: "followed by a
  //     SEPARATE transfer of communications") — not a boolean baked into
  //     ACCEPT's effect the way commsTransfers is for the 5 primitives.
  //  4. The receiving side's Strip is a different Strip ROLE (MISSION),
  //     not a same-role mirror — and it shares the ATC-side Strip's own
  //     fdrId rather than getting a fresh one (guide §9.8's "bind it to
  //     the same FDR as any tower Strip for that flight," realized now
  //     rather than deferred to WP7).
  //
  // Both sides of an active exchange carry their own `tofiCoordination`
  // record (symmetric to `coordination`'s peerFacilityId/peerStripId/
  // peerPositionId naming) — PROPOSE always originates on the ATC-side
  // Strip; ACCEPT/REJECT/TRANSFER_COMMS are always invoked on the
  // MISSION-side Strip (the receiving MRU controller's own record),
  // mirroring exactly which side acts in the real-world exchange.

  _applyTofiOp(strip, op, by, actingPositionId) {
    switch (op.action) {
      case 'PROPOSE':        return this._applyTofiPropose(strip, op, by, actingPositionId);
      case 'ACCEPT':         return this._applyTofiAccept(strip, op, by);
      case 'REJECT':         return this._applyTofiReject(strip, op, by);
      case 'TRANSFER_COMMS': return this._applyTofiTransferComms(strip, op, by);
      default:                return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown TOFI action: ${op.action}`, strip };
    }
  }

  /**
   * Always invoked on the ATC-side Strip. ENTRY mints a brand-new MISSION
   * Strip on the target MRU Facility's own Board (receiveTofiProposal,
   * sharing this Strip's fdrId); EXIT re-enters the SAME already-existing
   * link (receiveTofiExitProposal), minting nothing new.
   */
  _applyTofiPropose(strip, op, by, actingPositionId) {
    if (op.direction !== 'ENTRY' && op.direction !== 'EXIT') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'direction must be ENTRY or EXIT', strip };
    }
    if (strip.tofiCoordination && strip.tofiCoordination.state === 'PROPOSED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'this Strip already has an open TOFI proposal', strip };
    }

    const now = Date.now();

    if (op.direction === 'ENTRY') {
      if (strip.tofiCoordination && strip.tofiCoordination.state === 'ACTIVE') {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: 'tactical control is already active on this Strip', strip };
      }
      if (!op.toFacilityId || !op.toPositionId) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: 'toFacilityId and toPositionId are required', strip };
      }
      if (op.toFacilityId === this._rules.facilityId) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: 'TOFI target must be a different Facility', strip };
      }
      // TOFI's own (role, state) gate — the 5 primitives have had one since
      // docs/adr/0022 and TOFI never did, so a controller could open tactical
      // control on a Strip that was not yet airborne, or on a MISSION Strip
      // (the Role TOFI itself creates). See coordination.js.
      if (this._rules.tofiEligibleState) {
        const required = this._rules.tofiEligibleState(strip.role);
        if (!required || strip.state !== required) {
          return { ok: false, reason: 'VALIDATION_ERROR', detail: required
            ? `a ${strip.role} Strip must be at ${required} to enter tactical control, not ${strip.state}`
            : `a ${strip.role} Strip can never open a TOFI exchange`, strip };
        }
      }
      if (this._rules.tofiCounterparts) {
        const allowed = this._rules.tofiCounterparts(actingPositionId) || [];
        if (!allowed.some(c => c.facilityId === op.toFacilityId && c.positionId === op.toPositionId)) {
          return { ok: false, reason: 'VALIDATION_ERROR', detail: `${op.toPositionId} is not a valid TOFI counterpart for ${actingPositionId}`, strip };
        }
      }
      const peer = this._rules.peerBoard ? this._rules.peerBoard(op.toFacilityId) : null;
      if (!peer) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown Facility: ${op.toFacilityId}`, strip };

      // Track-degradation soft interlock (guide §4.6 rule 5), same as the 5
      // ATC<->ATC primitives (docs/adr/0019) — TOFI is named in the same
      // §4.6 primitive table this rule sits directly under, so it applies
      // here too, for both directions.
      const entryFdr = this._fdrStore.getFdr(strip.fdrId);
      const entryDegraded = entryFdr && entryFdr.identity.trackDegradationFlag && entryFdr.identity.trackDegradationFlag !== 'NONE';
      if (entryDegraded && !op.note) {
        return {
          ok: false, reason: 'VALIDATION_ERROR',
          detail: `track degradation (${entryFdr.identity.trackDegradationFlag}) forces verbal coordination — a note is required`,
          strip,
        };
      }

      const proposal = peer.receiveTofiProposal({
        fromFacilityId: this._rules.facilityId, fromPositionId: actingPositionId,
        fromStripId: strip.stripId, toPositionId: op.toPositionId, fdrId: strip.fdrId, note: op.note || null, by,
      });
      if (!proposal.ok) return { ok: false, reason: proposal.reason || 'VALIDATION_ERROR', detail: proposal.detail, strip };

      strip.tofiCoordination = {
        direction: 'ENTRY', state: 'PROPOSED',
        peerFacilityId: op.toFacilityId, peerStripId: proposal.strip.stripId, peerPositionId: op.toPositionId,
        commsTransferred: false, commsTransferredAt: null, commsTransferredBy: null,
        note: op.note || null,
        initiatedAt: now, initiatedBy: by || null, acceptedAt: null, acceptedBy: null,
      };
      strip.rev += 1; strip.updatedAt = now; strip.updatedBy = by || null;
      this._touch(strip.stripId);
      return { ok: true, strip, peerFacilityId: op.toFacilityId, peerStrip: proposal.strip };
    }

    // EXIT — re-enters the existing link; never mints a new Strip.
    const prior = strip.tofiCoordination;
    if (!prior || prior.state !== 'ACTIVE') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no active tactical control to exit', strip };
    }
    const peer = this._rules.peerBoard ? this._rules.peerBoard(prior.peerFacilityId) : null;
    if (!peer) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown Facility: ${prior.peerFacilityId}`, strip };

    const exitFdr = this._fdrStore.getFdr(strip.fdrId);
    const exitDegraded = exitFdr && exitFdr.identity.trackDegradationFlag && exitFdr.identity.trackDegradationFlag !== 'NONE';
    if (exitDegraded && !op.note) {
      return {
        ok: false, reason: 'VALIDATION_ERROR',
        detail: `track degradation (${exitFdr.identity.trackDegradationFlag}) forces verbal coordination — a note is required`,
        strip,
      };
    }

    const exitResult = peer.receiveTofiExitProposal({ stripId: prior.peerStripId, note: op.note || null, by });
    if (!exitResult.ok) return { ok: false, reason: exitResult.reason || 'VALIDATION_ERROR', detail: exitResult.detail, strip };

    strip.tofiCoordination = {
      ...prior, direction: 'EXIT', state: 'PROPOSED',
      commsTransferred: false, commsTransferredAt: null, commsTransferredBy: null,
      note: op.note || null,
      initiatedAt: now, initiatedBy: by || null, acceptedAt: null, acceptedBy: null,
    };
    strip.rev += 1; strip.updatedAt = now; strip.updatedBy = by || null;
    this._touch(strip.stripId);
    return { ok: true, strip, peerFacilityId: prior.peerFacilityId, peerStrip: exitResult.strip };
  }

  /**
   * Always invoked on the MISSION-side Strip (the receiving MRU
   * controller's own record) — ENTRY's accept transitions to ACTIVE; EXIT's
   * accept transitions to COMPLETE (rule 3: exit is the safety-critical
   * direction, ATC separation MUST be re-established BEFORE the exchange
   * completes — enforced here as a hard precondition, not derived as a
   * side effect of accepting).
   */
  _applyTofiAccept(strip, op, by) {
    const tofi = strip.tofiCoordination;
    if (!tofi || tofi.state !== 'PROPOSED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no pending TOFI proposal on this Strip', strip };
    }
    // A soft warning, deliberately NOT a second hard gate beside
    // separation_regime's. Both fields describe authority over the same
    // real-world moment, and nothing cross-checked them before — a flight
    // could return to ATC control with the airspace still booked out to the
    // using agency. But the two are genuinely separable in real operations
    // (a MOA can stay hot after one flight leaves it), so this is the §4.6
    // verbal-path soft-interlock shape, not rule 3's hard precondition.
    let warning;
    if (tofi.direction === 'EXIT') {
      const fdr = this._fdrStore.getFdr(strip.fdrId);
      if (!fdr || !fdr.tofi || fdr.tofi.separationRegime !== 'ATC') {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: 'separation_regime must be set back to ATC before completing a TOFI exit', strip };
      }
      if (fdr.airspace && fdr.airspace.owner === 'USING_AGENCY') {
        warning = 'AIRSPACE_STILL_WITH_USING_AGENCY';
      }
    }

    const now = Date.now();
    tofi.state = tofi.direction === 'EXIT' ? 'COMPLETE' : 'ACTIVE';
    tofi.acceptedAt = now;
    tofi.acceptedBy = by || null;

    // ENTRY only — relocate the MISSION Strip out of the Coordination Bay
    // into its normal working Bay for its own (already-correct) state,
    // mirroring _applyCoordinationAccept's exact relocation pattern. EXIT
    // never moved the Strip into the Coordination Bay in the first place
    // (receiveTofiExitProposal doesn't touch bayId/rackId at all), so
    // there's nothing to relocate back.
    if (tofi.direction === 'ENTRY') {
      const targetBay = this._rules.bayForImpliedState ? this._rules.bayForImpliedState(strip.ownerPositionId, strip.state) : null;
      if (targetBay) {
        strip.bayId = targetBay.bayId;
        strip.rackId = targetBay.rackIds[0];
        strip.orderKey = this._resolveOrderKey(targetBay.bayId, targetBay.rackIds[0], null, null, strip.stripId);
      }
    }

    strip.rev += 1; strip.updatedAt = now; strip.updatedBy = by || null;
    this._touch(strip.stripId);

    let peerStrip = null;
    if (this._rules.peerBoard) {
      const peer = this._rules.peerBoard(tofi.peerFacilityId);
      if (peer) {
        const peerResult = peer.receiveTofiResponse({ stripId: tofi.peerStripId, response: 'ACCEPT', by });
        if (peerResult.ok) peerStrip = peerResult.strip;
      }
    }
    return { ok: true, strip, peerFacilityId: tofi.peerFacilityId, peerStrip, warning };
  }

  /** Always invoked on the MISSION-side Strip, mirroring _applyTofiAccept's own side. */
  _applyTofiReject(strip, op, by) {
    const tofi = strip.tofiCoordination;
    if (!tofi || tofi.state !== 'PROPOSED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no pending TOFI proposal on this Strip', strip };
    }
    tofi.state = 'REJECTED';
    strip.rev += 1; strip.updatedAt = Date.now(); strip.updatedBy = by || null;
    this._touch(strip.stripId);

    let peerStrip = null;
    if (this._rules.peerBoard) {
      const peer = this._rules.peerBoard(tofi.peerFacilityId);
      if (peer) {
        const peerResult = peer.receiveTofiResponse({ stripId: tofi.peerStripId, response: 'REJECT', by });
        if (peerResult.ok) peerStrip = peerResult.strip;
      }
    }
    return { ok: true, strip, peerFacilityId: tofi.peerFacilityId, peerStrip };
  }

  /**
   * Guide §4.6.3's own "separate transfer of communications" — a distinct
   * action from ACCEPT, invocable on EITHER side of an accepted exchange
   * (whoever currently holds the frequency initiates handing it off).
   * Mirrored to the peer's own record so both sides agree comms have moved.
   */
  _applyTofiTransferComms(strip, op, by) {
    const tofi = strip.tofiCoordination;
    // Three distinct causes, previously one shared message — split out so
    // the ack's `detail` actually says which one happened, rather than
    // leaving a live-testing session to guess from "no accepted TOFI
    // exchange awaiting a comms transfer" alone.
    if (!tofi) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'this Strip has no TOFI exchange at all', strip };
    }
    if (!tofi.acceptedAt) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `TOFI ${tofi.direction} has not been accepted yet (state: ${tofi.state})`, strip };
    }
    if (tofi.commsTransferred) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'comms were already transferred for this exchange', strip };
    }
    const now = Date.now();
    tofi.commsTransferred = true;
    tofi.commsTransferredAt = now;
    tofi.commsTransferredBy = by || null;
    strip.rev += 1; strip.updatedAt = now; strip.updatedBy = by || null;
    this._touch(strip.stripId);

    let peerStrip = null;
    if (this._rules.peerBoard) {
      const peer = this._rules.peerBoard(tofi.peerFacilityId);
      if (peer) {
        const peerResult = peer.receiveTofiResponse({ stripId: tofi.peerStripId, response: 'TRANSFER_COMMS', by });
        if (peerResult.ok) peerStrip = peerResult.strip;
      }
    }
    return { ok: true, strip, peerFacilityId: tofi.peerFacilityId, peerStrip };
  }

  /**
   * Called by the ATC-side Facility's BoardStore (via rules.peerBoard) on a
   * TOFI ENTRY PROPOSE — mints a brand-new, independent MISSION Strip in
   * THIS Facility's own `_strips` Map, landing in the receiving Position's
   * Coordination Bay. Shares the ATC-side Strip's own fdrId (guide §9.8's
   * binding, realized now) rather than minting a fresh FDR — the one
   * genuinely new piece of D13-style replication this slice adds: every
   * one of the 5 ATC<->ATC primitives already does this (their replica
   * shares the sender's fdrId too), but always with the SAME Strip Role on
   * both sides; TOFI is the first primitive to bind two DIFFERENT roles
   * (the ATC-side role, and MISSION) to one shared FDR.
   * @returns {{ok:true, strip}|{ok:false, reason, detail}}
   */
  receiveTofiProposal({ fromFacilityId, fromPositionId, fromStripId, toPositionId, fdrId, note, by }) {
    const fdr = this._fdrStore.getFdr(fdrId);
    if (!fdr) return { ok: false, reason: 'NOT_FOUND', detail: 'referenced FDR not found' };

    const coordinationBay = this._rules.coordinationBayFor ? this._rules.coordinationBayFor(toPositionId) : null;
    if (!coordinationBay) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `no Coordination Bay configured for ${toPositionId}` };
    }

    const stripId = crypto.randomUUID();
    const now = Date.now();
    const rackStrips = this.getRack(coordinationBay.bayId, coordinationBay.rackIds[0]);
    const afterStripId = rackStrips.length ? rackStrips[rackStrips.length - 1].stripId : null;
    const orderKey = this._resolveOrderKey(coordinationBay.bayId, coordinationBay.rackIds[0], afterStripId, null, null);

    const strip = {
      stripId,
      cid: this._nextCid(),
      fdrId, // shared with the ATC-side Strip — guide §9.8's binding
      rev: 1,
      role: 'MISSION',
      state: DEFAULT_INITIAL_STATE_BY_ROLE.MISSION,
      ownerPositionId: toPositionId,
      bayId: coordinationBay.bayId,
      rackId: coordinationBay.rackIds[0],
      orderKey,
      annotations: {},
      flags: newFlags(),
      // No `correlation` — it is keyed by fdrId, and a replica shares the
      // originator's FDR (docs/adr/0013), so it shares the correlation too.
      // That is the case a per-Strip field got wrong: both halves of a
      // cross-Facility exchange are looking at one airframe.
      coordination: null,
      tofiCoordination: {
        direction: 'ENTRY', state: 'PROPOSED',
        peerFacilityId: fromFacilityId, peerStripId: fromStripId, peerPositionId: fromPositionId,
        commsTransferred: false, commsTransferredAt: null, commsTransferredBy: null,
        note: note || null,
        initiatedAt: now, initiatedBy: by || null, acceptedAt: null, acceptedBy: null,
      },
      createdAt: now, updatedAt: now, updatedBy: by || null,
    };
    this._strips.set(stripId, strip);
    this._touch(stripId);
    return { ok: true, strip };
  }

  /**
   * Called by the ATC-side Facility's BoardStore on a TOFI EXIT PROPOSE —
   * re-enters the ALREADY-EXISTING MISSION Strip's tofiCoordination record
   * rather than minting a new one (the mission has been live in TACTICAL's
   * own Board throughout ENTRY's ACTIVE window).
   */
  receiveTofiExitProposal({ stripId, note, by }) {
    const strip = this._strips.get(stripId);
    if (!strip || !strip.tofiCoordination) return { ok: false, reason: 'NOT_FOUND' };

    const now = Date.now();
    strip.tofiCoordination.direction = 'EXIT';
    strip.tofiCoordination.state = 'PROPOSED';
    strip.tofiCoordination.commsTransferred = false;
    strip.tofiCoordination.commsTransferredAt = null;
    strip.tofiCoordination.commsTransferredBy = null;
    strip.tofiCoordination.note = note || null;
    strip.tofiCoordination.initiatedAt = now;
    strip.tofiCoordination.initiatedBy = by || null;
    strip.tofiCoordination.acceptedAt = null;
    strip.tofiCoordination.acceptedBy = null;
    strip.rev += 1; strip.updatedAt = now; strip.updatedBy = by || null;
    this._touch(strip.stripId);
    return { ok: true, strip };
  }

  /**
   * Called by the MISSION-side Facility's BoardStore once its controller
   * has ACCEPTed/REJECTed a TOFI proposal, or TRANSFER_COMMS'd — updates
   * the ATC-side Strip's own tofiCoordination record to match, so both
   * sides agree on the outcome. Mirrors receiveCoordinationResponse exactly.
   */
  receiveTofiResponse({ stripId, response, by }) {
    const strip = this._strips.get(stripId);
    if (!strip || !strip.tofiCoordination) return { ok: false, reason: 'NOT_FOUND' };

    const now = Date.now();
    const tofi = strip.tofiCoordination;
    if (response === 'ACCEPT') {
      tofi.state = tofi.direction === 'EXIT' ? 'COMPLETE' : 'ACTIVE';
      tofi.acceptedAt = now;
      tofi.acceptedBy = by || null;
    } else if (response === 'REJECT') {
      tofi.state = 'REJECTED';
    } else if (response === 'TRANSFER_COMMS') {
      tofi.commsTransferred = true;
      tofi.commsTransferredAt = now;
      tofi.commsTransferredBy = by || null;
    }
    strip.rev += 1;
    strip.updatedAt = now;
    strip.updatedBy = by || null;
    this._touch(strip.stripId);
    return { ok: true, strip };
  }

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
    for (const strip of affected) {
      const before = deepClone(strip);
      strip.ownerPositionId = toPositionId;
      strip.rev += 1;
      strip.updatedAt = Date.now();
      strip.updatedBy = null;
      this._touch(strip.stripId);
      if (this._mutationLog) {
        this._mutationLog.record({
          clientMutationId: null, op: 'SystemReassign', stripId: strip.stripId,
          actingPositionId: null, actorId: 'system', at: Date.now(),
          before, after: deepClone(strip), reason: 'position-vacated',
        });
      }
    }
    return affected.map(s => s.stripId);
  }

  // ── Persistence (durable per ADR 0002 — mission reload must NOT clear this) ──
  snapshot() {
    return { strips: this.getAll(), cidSeq: this._cidSeq };
  }
  restore(data) {
    this._strips = new Map((data?.strips || []).map(s => [s.stripId, s]));
    // A snapshot written before docs/adr/0045 carries a per-Strip
    // `correlation` field. Dropped rather than migrated: it was always the
    // inert `{ state: 'UNCORRELATED' }` placeholder, so there is nothing in it
    // to carry forward, and leaving it would put a second, stale answer to
    // "which contact is this" next to the real one — which is the defect the
    // key change removes, preserved through a restore.
    for (const strip of this._strips.values()) delete strip.correlation;
    this._cidSeq = data?.cidSeq || 0;
    // Idempotency cache (_appliedMutations) is deliberately NOT persisted —
    // it only needs to survive a reconnect *within a session*, not a full
    // server restart; a mutation replayed immediately after a restart would
    // simply reapply, an acceptable Phase-1 edge case.
  }
}

module.exports = { BoardStore };
