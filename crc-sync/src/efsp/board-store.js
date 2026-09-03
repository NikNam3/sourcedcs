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

const FLAG_KEYS = ['offset', 'flipped', 'removeIndicator', 'highlight', 'attention'];
const APPLIED_MUTATIONS_CAP = 5000;

function newFlags() {
  return { offset: false, flipped: false, removeIndicator: false, highlight: null, attention: null };
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
      case 'SetBlock':      result = this._applySetBlock(strip, op, by); break;
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
      state: op.initialState || (role === 'ARRIVAL' ? 'INBOUND' : 'PROPOSED'),
      ownerPositionId: actingPositionId,
      bayId: op.bayId,
      rackId: op.rackId,
      orderKey,
      annotations: {},
      flags: newFlags(),
      correlation: { state: 'UNCORRELATED' }, // WP5 hook, inert in Phase 1
      coordination: null, // WP4A hook (docs/adr/0015) — set by _applyCoordinationPropose/receiveCoordinationProposal once this Strip is party to a cross-Facility exchange
      createdAt: now, updatedAt: now, updatedBy: by || null,
    };
    this._strips.set(stripId, strip);
    this._touch(stripId);
    return { ok: true, strip, fdr: created.fdr };
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

  _applyMoveStrip(strip, op, by) {
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

  _applySetBlock(strip, op, by) {
    const target = this._rules.resolveBlockTarget(op.blockId, strip.role);
    if (!target) return { ok: false, reason: 'VALIDATION_ERROR', strip };

    if (target.kind === 'fdr' || target.kind === 'airspace-owner') {
      const fdrResult = target.kind === 'airspace-owner'
        ? this._fdrStore.setAirspaceOwner(strip.fdrId, op.value, { by })
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
      return { ok: true, strip, fdr: fdrResult.fdr, warning: fdrResult.warning };
    }

    return this._applyAnnotationSet(strip, op.blockId, op.value, op.confirmVacated, by);
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
    return this._applySetState(strip, last.prevState, by);
  }

  _applyDropStrip(strip, op, by) {
    strip.state = 'DROPPED';
    strip.flags.removeIndicator = true; // distinct from delete (§3.4) — Strip stays queryable, see getRack()
    strip.rev += 1;
    strip.updatedAt = Date.now();
    strip.updatedBy = by || null;
    this._touch(strip.stripId);
    this._fdrStore.releaseFdr(strip.fdrId);
    return { ok: true, strip };
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
      case 'PROPOSE': return this._applyCoordinationPropose(strip, op, by, actingPositionId);
      case 'ACCEPT':  return this._applyCoordinationAccept(strip, op, by, actingPositionId);
      case 'REJECT':  return this._applyCoordinationReject(strip, op, by, actingPositionId);
      default:        return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown coordination action: ${op.action}`, strip };
    }
  }

  _applyCoordinationPropose(strip, op, by, actingPositionId) {
    const primitive = op.kind;
    const effect = this._rules.coordinationEffect ? this._rules.coordinationEffect(primitive) : null;
    if (!effect) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown coordination primitive: ${primitive}`, strip };

    if (strip.coordination && (strip.coordination.state === 'PROPOSED' || strip.coordination.state === 'ACTIVE')) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'this Strip already has an open coordination link', strip };
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
    };
    strip.rev += 1;
    strip.updatedAt = now;
    strip.updatedBy = by || null;
    this._touch(strip.stripId);
    return { ok: true, strip };
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
    // Position's normal INBOUND working Bay — this Strip's real lifecycle
    // starts now, same as any other ARRIVAL Strip (guide §3.4).
    const targetBay = this._rules.bayForImpliedState ? this._rules.bayForImpliedState(strip.ownerPositionId, 'INBOUND') : null;
    if (targetBay) {
      strip.bayId = targetBay.bayId;
      strip.rackId = targetBay.rackIds[0];
      strip.orderKey = this._resolveOrderKey(targetBay.bayId, targetBay.rackIds[0], null, null, strip.stripId);
    }
    strip.state = 'INBOUND';
    strip.rev += 1;
    strip.updatedAt = now;
    strip.updatedBy = by || null;
    this._touch(strip.stripId);

    // Tell the peer their sender-side Strip is now ACTIVE too — both
    // replicas agree the exchange is live; each proceeds independently
    // from here (D13's "independently removable" acceptance criterion).
    if (this._rules.peerBoard) {
      const peer = this._rules.peerBoard(strip.coordination.peerFacilityId);
      if (peer) peer.receiveCoordinationResponse({ stripId: strip.coordination.peerStripId, response: 'ACCEPT', by });
    }
    return { ok: true, strip };
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

    if (this._rules.peerBoard) {
      const peer = this._rules.peerBoard(strip.coordination.peerFacilityId);
      if (peer) peer.receiveCoordinationResponse({ stripId: strip.coordination.peerStripId, response: 'REJECT', by });
    }
    return { ok: true, strip };
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
   * @returns {{ok:true, strip}|{ok:false, reason, detail}}
   */
  receiveCoordinationProposal({ primitive, fromFacilityId, fromPositionId, fromStripId, toPositionId, fdrId, note, by }) {
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
      // Every coordination primitive in this slice moves an ARRIVAL-shaped
      // Strip (APP<->CTR, guide's recommended civil ATC<->ATC first
      // slice) — state INBOUND from the moment it's minted, not a
      // separate "not yet accepted" pseudo-state; coordination.state is
      // what actually tracks PROPOSED/ACTIVE/REJECTED.
      role: 'ARRIVAL',
      state: 'INBOUND',
      ownerPositionId: toPositionId,
      bayId: coordinationBay.bayId,
      rackId: coordinationBay.rackIds[0],
      orderKey,
      annotations: {},
      flags: newFlags(),
      correlation: { state: 'UNCORRELATED' },
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
    } else {
      strip.coordination.state = 'REJECTED';
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
    this._cidSeq = data?.cidSeq || 0;
    // Idempotency cache (_appliedMutations) is deliberately NOT persisted —
    // it only needs to survive a reconnect *within a session*, not a full
    // server restart; a mutation replayed immediately after a restart would
    // simply reapply, an acceptable Phase-1 edge case.
  }
}

module.exports = { BoardStore };
