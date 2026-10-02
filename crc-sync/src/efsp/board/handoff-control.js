'use strict';

// Communications, ControlRelease and transfer of control inside a HANDOFF (docs/adr/0101; H94, H100).
//
// ACCEPT of a HANDOFF moves radar identification and the Strip only. What was fused with it is three records on the
// `coordination` object of BOTH Strips of the exchange, kept in step by `receiveHandoffRecord`:
//
//   comms:   { transferred, at, by, byPositionId, trigger? }          who is on the frequency
//   control: { holder: 'TRANSFERRING'|'RECEIVING', at, by, trigger }   who has separation responsibility
//   release: null | { scopes, climbLimitFt?, descentLimitFt?, condition, effectiveAt, grantedAt, ..., withdrawnAt? }
//   releaseRequest: null | { scopes, note, requestedAt, ..., answer }
//
// `coordination.separationResponsibilityRef` stays the authoritative "who has control" (a Facility and a Position);
// `control.holder` is the readable mirror. "Transferring" is the proposer's Strip, "receiving" the minted replica
// (`mintedForCoordination`).
//
// THE CONTROL INVARIANT (H100 DR-6, ADR 0101): for every flight with an ACTIVE HANDOFF the communications holder and the
// control holder are each one side whose Strip is live and whose owner is staffed or consolidated into a staffed Position.
// `transferControl` below is the one place control moves; `assertControlInvariant` is the net under every path.

const { MAX_FREE_TEXT, parseAltitude, activeClearanceEntry } = require('../flight-data-store');
const { deepClone } = require('./strip-util');
const log = require('../../log').logger('efsp:handoff-control');

const SCOPES = ['TURNS', 'CLIMB', 'DESCENT', 'FULL'];
const MARKS = ['TRANSFER_COMMS', 'TRANSFER_CONTROL'];
const RELEASE_ACTIONS = ['GRANT', 'REQUEST', 'REFUSE', 'WITHDRAW'];

const refuse = (strip, detail, reason = 'VALIDATION_ERROR') => ({ ok: false, reason, detail, strip });

class HandoffControl {
  /**
   * @param {object} deps
   * @param {object} deps.rules the Board's rules (coordinationEffect, peerBoard, isStaffed, consolidatedAt, facilityId, ...)
   * @param {object} deps.state BoardState
   * @param {object} deps.audit BoardAudit
   * @param {{now: () => number}} deps.clock the mission clock (every `at`, `effectiveAt` and gate here, H11)
   * @param {object} deps.flightDataStore
   * @param {() => string|null} deps.activeCmid the clientMutationId being applied, read late
   * @param {() => object|null} deps.mutationLog read late
   * @param {() => 'repair'|'throw'} deps.invariantMode what `assertControlInvariant` does with a violation it finds
   */
  constructor({ rules, state, audit, clock, flightDataStore, activeCmid, mutationLog, invariantMode }) {
    this._rules = rules;
    this._state = state;
    this._audit = audit;
    this._clock = clock;
    this._flightDataStore = flightDataStore;
    this._activeCmidOf = activeCmid;
    this._mutationLogOf = mutationLog;
    this._invariantModeOf = invariantMode;
  }

  get _activeCmid() { return this._activeCmidOf(); }

  // ── the record ──────────────────────────────────────────────────────────

  /** The model a coordination primitive follows: 'STEPS' (HANDOFF), 'AT_ACCEPT' (AIT) or null. */
  _modelOf(link) {
    const effect = link && this._rules.coordinationEffect(link.primitive);
    return (effect && effect.controlModel) || null;
  }

  /** True for a Strip carrying a HANDOFF-family exchange whose control moves in steps. */
  isSteps(strip) {
    return !!strip && !!strip.coordination && this._modelOf(strip.coordination) === 'STEPS';
  }

  /** The fields a primitive's `coordination` object starts with, on both Strips, at PROPOSE (docs/adr/0101 "The record"). */
  initialFields(primitive) {
    const effect = this._rules.coordinationEffect(primitive);
    const model = effect && effect.controlModel;
    if (!model) return {};
    const fields = {
      comms: { transferred: false, at: null, by: null, byPositionId: null },
      control: { holder: 'TRANSFERRING', at: null, by: null, trigger: null },
    };
    if (model === 'STEPS') { fields.release = null; fields.releaseRequest = null; fields.repair = null; }
    return fields;
  }

  /** What an ACCEPT stamps for a primitive whose comms and control move with it (AIT, `controlModel: 'AT_ACCEPT'`). */
  acceptFields(link, now, by) {
    if (this._modelOf(link) !== 'AT_ACCEPT') return {};
    return {
      comms: { transferred: true, at: now, by: by || null, byPositionId: null, trigger: 'AIT' },
      control: { holder: 'RECEIVING', at: now, by: by || null, trigger: 'AIT' },
    };
  }

  /** The side of the exchange this Strip is. */
  sideOf(strip) { return strip.coordination.mintedForCoordination ? 'RECEIVING' : 'TRANSFERRING'; }

  commsHolder(link) { return link.comms && link.comms.transferred ? 'RECEIVING' : 'TRANSFERRING'; }

  controlHolder(link) { return link.control ? link.control.holder : 'TRANSFERRING'; }

  /** Is this Strip's owner staffed, or consolidated into a staffed Position? (This Board's Positions.) */
  ownerCovered(strip) {
    if (!strip) return false;
    return !!(this._rules.isStaffed(strip.ownerPositionId) || this._rules.consolidatedAt(strip.ownerPositionId));
  }

  /** The peer Board and its Strip of this exchange (the Strip is null when it is gone from that Board). */
  _peerOf(strip) {
    const link = strip.coordination;
    const board = this._rules.peerBoard(link.peerFacilityId);
    return { board, strip: board ? board.getStrip(link.peerStripId) : null, facilityId: link.peerFacilityId };
  }

  /** The transferring and the receiving Strip of the exchange `strip` is one half of, with each one's Board facilityId. */
  _sides(strip) {
    const peer = this._peerOf(strip);
    const mine = { strip, facilityId: this._rules.facilityId, covered: this.ownerCovered(strip) };
    const theirs = { strip: peer.strip, facilityId: peer.facilityId, covered: !!(peer.board && peer.strip && peer.board.stripOwnerCovered(peer.strip.stripId)) };
    const transferring = this.sideOf(strip) === 'TRANSFERRING' ? mine : theirs;
    const receiving = transferring === mine ? theirs : mine;
    return { mine, theirs, transferring, receiving, peer };
  }

  _live(side) { return !!side.strip && side.strip.state !== 'DROPPED'; }

  // ── writing both halves ─────────────────────────────────────────────────

  /**
   * Applies `patch` to this Strip's `coordination` and to the peer's through `receiveHandoffRecord`, in one causal chain.
   * @param {object} opts `{ bump: bool, auditOp, action }` — `bump` false when the caller already bumped this Strip
   * @returns {{peerFacilityId:string, peerStrip:object|null}}
   */
  _commit(strip, patch, by, { bump = true, auditOp, action }) {
    Object.assign(strip.coordination, deepClone(patch));
    if (bump) this._state.bump(strip, by);
    const peer = this._peerOf(strip);
    let peerStrip = null;
    if (peer.board && peer.strip) {
      const r = peer.board.receiveHandoffRecord({
        causedBy: this._activeCmid, stripId: peer.strip.stripId, patch, by, auditOp, action, fromFacilityId: this._rules.facilityId,
      });
      if (r.ok) peerStrip = r.strip;
    }
    return { peerFacilityId: peer.facilityId, peerStrip };
  }

  /** Called through `rules.peerBoard`: the other half's record changed; mirror it here (docs/adr/0101 "Replicas, peers"). */
  receiveHandoffRecord({ stripId, patch, by, causedBy, auditOp, action, fromFacilityId }) {
    const strip = this._state.strips.get(stripId);
    if (!strip || !strip.coordination) return { ok: false, reason: 'NOT_FOUND' };
    const before = deepClone(strip);
    Object.assign(strip.coordination, deepClone(patch));
    this._state.bump(strip, by);
    this._audit.recordPeer(auditOp, strip, before, { causedBy, fromFacilityId: fromFacilityId || strip.coordination.peerFacilityId, by, action });
    return { ok: true, strip };
  }

  // ── the one transfer of control ─────────────────────────────────────────

  /**
   * The patch that moves control (and so `separationResponsibilityRef`) to `toSide`. The one place the pair of them
   * changes together: every path that moves control — the two marks, a FULL release with comms, either retirement trigger,
   * a repair — builds its patch here.
   */
  controlPatch(strip, toSide, trigger, by) {
    const { transferring, receiving } = this._sides(strip);
    const target = toSide === 'RECEIVING' ? receiving : transferring;
    return {
      repair: null, // a holder that moves by a controller's act or a retirement ends any standing repair notice
      control: { holder: toSide, at: this._clock.now(), by: by || null, trigger },
      separationResponsibilityRef: { facilityId: target.facilityId, positionId: target.strip ? target.strip.ownerPositionId : null },
    };
  }

  /** A FULL release that is in effect (not withdrawn) and due on the mission clock. */
  _fullReleaseDue(link) {
    const r = link.release;
    return !!r && !r.withdrawnAt && r.scopes.includes('FULL') && (r.effectiveAt == null || r.effectiveAt <= this._clock.now());
  }

  /**
   * A FULL release with a future `effectiveAt` schedules nothing (ADR 0101 decision 4); the first later op that checks
   * it settles it. Called by the control-axis check and the marks. @returns {{peerFacilityId, peerStrip, control}|null}
   */
  settleDueRelease(strip, by) {
    const link = strip.coordination;
    if (!this.isSteps(strip) || link.state !== 'ACTIVE' || this.controlHolder(link) !== 'TRANSFERRING') return null;
    if (!link.comms.transferred || !this._fullReleaseDue(link)) return null;
    const { receiving } = this._sides(strip);
    if (!this._live(receiving) || !receiving.covered) return null;
    const patch = this.controlPatch(strip, 'RECEIVING', 'COMMS_AND_FULL_RELEASE', by);
    const peer = this._commit(strip, patch, by, { bump: false, auditOp: 'InterfacilityCoordinationResponse', action: 'TRANSFER_CONTROL' });
    this.assertControlInvariant(strip, by);
    return { ...peer, control: { trigger: 'COMMS_AND_FULL_RELEASE' } };
  }

  // ── the two marks ───────────────────────────────────────────────────────

  _requireActiveSteps(strip) {
    if (!this.isSteps(strip)) return refuse(strip, 'no HANDOFF exchange on this Strip');
    if (strip.coordination.state !== 'ACTIVE') return refuse(strip, 'the HANDOFF has not been accepted');
    return null;
  }

  /** HANDOFF TRANSFER_COMMS / TRANSFER_CONTROL (docs/adr/0101, "Who may do what"): the owner of either Strip records it. */
  applyMark(strip, op, by, actingPositionId) {
    if (!MARKS.includes(op.action)) return refuse(strip, `unknown HANDOFF action: ${op.action}`);
    const bad = this._requireActiveSteps(strip);
    if (bad) return bad;
    const link = strip.coordination;
    const { receiving } = this._sides(strip);
    if (op.action === 'TRANSFER_COMMS' && link.comms.transferred) return refuse(strip, 'communications were already transferred');
    if (op.action === 'TRANSFER_CONTROL' && this.controlHolder(link) !== 'TRANSFERRING') return refuse(strip, 'control was already transferred');
    // The move is refused unless its target is live and staffed (the control invariant).
    if (!this._live(receiving) || !receiving.covered) {
      return refuse(strip, `${receiving.strip ? receiving.strip.ownerPositionId : link.peerPositionId} is not staffed`, 'NOT_STAFFED');
    }
    const now = this._clock.now();
    const patch = {};
    const controlAudit = {};
    if (op.action === 'TRANSFER_COMMS') {
      patch.comms = { transferred: true, at: now, by: by || null, byPositionId: actingPositionId || null };
      patch.repair = null;
      controlAudit.comms = { transferred: true };
      if (this.controlHolder(link) === 'TRANSFERRING' && this._fullReleaseDue({ ...link, comms: patch.comms })) {
        Object.assign(patch, this.controlPatch(strip, 'RECEIVING', 'COMMS_AND_FULL_RELEASE', by));
        controlAudit.control = { trigger: 'COMMS_AND_FULL_RELEASE' };
      }
    } else {
      Object.assign(patch, this.controlPatch(strip, 'RECEIVING', 'BOUNDARY', by));
      controlAudit.control = { trigger: 'BOUNDARY' };
    }
    const peer = this._commit(strip, patch, by, { auditOp: 'InterfacilityCoordinationResponse', action: op.action });
    this.assertControlInvariant(strip, by);
    return { ok: true, strip, ...peer, controlAudit };
  }

  // ── ControlRelease ──────────────────────────────────────────────────────

  _scopesProblem(scopes) {
    if (!Array.isArray(scopes) || scopes.length === 0) return 'scopes must list at least one of TURNS, CLIMB, DESCENT, FULL';
    for (const s of scopes) if (!SCOPES.includes(s)) return `unknown release scope: ${s}`;
    return null;
  }

  /** ControlRelease GRANT / REQUEST / REFUSE / WITHDRAW. Never undoable (docs/adr/0101 "Undo"). */
  applyRelease(strip, op, by, actingPositionId) {
    if (!RELEASE_ACTIONS.includes(op.action)) return refuse(strip, `unknown ControlRelease action: ${op.action}`);
    const bad = this._requireActiveSteps(strip);
    if (bad) return bad;
    const link = strip.coordination;
    if (this.controlHolder(link) !== 'TRANSFERRING') return refuse(strip, 'control was already transferred');
    const side = this.sideOf(strip);
    const now = this._clock.now();
    const patch = {};
    const auditFields = { action: op.action };

    if (op.action === 'REQUEST') {
      if (side !== 'RECEIVING') return refuse(strip, 'only the receiving side requests a release');
      const problem = this._scopesProblem(op.scopes);
      if (problem) return refuse(strip, problem);
      if (link.releaseRequest && link.releaseRequest.answer == null) return refuse(strip, 'a release request is already open');
      patch.releaseRequest = {
        scopes: [...op.scopes], note: typeof op.note === 'string' ? op.note.slice(0, MAX_FREE_TEXT) : null,
        requestedAt: now, requestedBy: by || null, requestedByPositionId: actingPositionId || null,
        answer: null, answeredAt: null, answeredBy: null, reason: null,
      };
      auditFields.scopes = patch.releaseRequest.scopes;
    } else {
      if (side !== 'TRANSFERRING') return refuse(strip, `only ${link.peerPositionId}, the transferring side, may ${op.action.toLowerCase()} a release`);
      if (op.action === 'GRANT') {
        const problem = this._scopesProblem(op.scopes);
        if (problem) return refuse(strip, problem);
        const full = op.scopes.includes('FULL');
        for (const [key, scope] of [['climbLimitFt', 'CLIMB'], ['descentLimitFt', 'DESCENT']]) {
          if (op[key] == null) continue;
          if (!Number.isFinite(op[key])) return refuse(strip, `${key} must be a number of feet`);
          if (full || !op.scopes.includes(scope)) return refuse(strip, `${key} only goes with the ${scope} scope`);
        }
        if (op.effectiveAt != null && !Number.isFinite(op.effectiveAt)) return refuse(strip, 'effectiveAt must be a mission time');
        patch.release = {
          scopes: [...op.scopes],
          ...(op.climbLimitFt != null ? { climbLimitFt: op.climbLimitFt } : {}),
          ...(op.descentLimitFt != null ? { descentLimitFt: op.descentLimitFt } : {}),
          condition: typeof op.condition === 'string' && op.condition.trim() ? op.condition.trim().slice(0, MAX_FREE_TEXT) : null,
          effectiveAt: op.effectiveAt == null ? null : op.effectiveAt,
          grantedAt: now, grantedBy: by || null, grantedByPositionId: actingPositionId || null,
        };
        // A grant while a request is open answers it.
        if (link.releaseRequest && link.releaseRequest.answer == null) {
          patch.releaseRequest = { ...link.releaseRequest, answer: 'GRANTED', answeredAt: now, answeredBy: by || null, reason: null };
        }
        auditFields.scopes = patch.release.scopes;
        auditFields.condition = patch.release.condition;
        auditFields.effectiveAt = patch.release.effectiveAt;
      } else if (op.action === 'REFUSE') {
        if (!link.releaseRequest || link.releaseRequest.answer != null) return refuse(strip, 'no open release request to refuse');
        patch.releaseRequest = {
          ...link.releaseRequest, answer: 'REFUSED', answeredAt: now, answeredBy: by || null,
          reason: typeof op.reason === 'string' && op.reason.trim() ? op.reason.trim().slice(0, MAX_FREE_TEXT) : null,
        };
      } else { // WITHDRAW
        if (!link.release || link.release.withdrawnAt) return refuse(strip, 'no release in effect to withdraw');
        patch.release = { ...link.release, withdrawnAt: now, withdrawnBy: by || null };
      }
    }

    let controlAudit;
    // A FULL grant with comms already moved (and due) moves control (ADR 0101 decision 4 a): the control record is
    // written inside this op's entry, never as a second one.
    if (op.action === 'GRANT' && patch.release.scopes.includes('FULL') && link.comms.transferred) {
      const due = patch.release.effectiveAt == null || patch.release.effectiveAt <= now;
      const { receiving } = this._sides(strip);
      if (due && this._live(receiving) && receiving.covered) {
        Object.assign(patch, this.controlPatch(strip, 'RECEIVING', 'COMMS_AND_FULL_RELEASE', by));
        controlAudit = { control: { trigger: 'COMMS_AND_FULL_RELEASE' } };
      }
    }
    const peer = this._commit(strip, patch, by, { auditOp: 'InterfacilityControlRelease', action: op.action });
    this.assertControlInvariant(strip, by);
    return { ok: true, strip, ...peer, controlAudit: { controlRelease: auditFields, ...(controlAudit || {}) } };
  }

  // ── the control-axis check (SetBlock) ───────────────────────────────────

  /** Does a release cover every scope in `needed`, for a write whose new altitude band is `next`? */
  _releaseCovers(release, needed, next) {
    if (!release || release.withdrawnAt) return false;
    if (release.effectiveAt != null && release.effectiveAt > this._clock.now()) return false;
    const full = release.scopes.includes('FULL');
    for (const scope of needed) {
      if (!full && !release.scopes.includes(scope)) return false;
    }
    if (!full) {
      if (needed.includes('CLIMB') && release.climbLimitFt != null && !(next && next.highFt <= release.climbLimitFt)) return false;
      if (needed.includes('DESCENT') && release.descentLimitFt != null && !(next && next.lowFt >= release.descentLimitFt)) return false;
    }
    return true;
  }

  /**
   * The scopes a control-axis Block write needs. TURNS for a heading; for an altitude CLIMB or DESCENT by comparing the
   * new value with the flight's assigned altitude, both when there is none (or the write clears it). `[]` means the
   * write changes nothing vertically (the same altitude again), which needs nothing.
   */
  _neededScopes(axis, strip, op) {
    if (axis === 'TURNS') return { needed: ['TURNS'], next: null };
    const flightData = this._flightDataStore.getFlightData(strip.flightDataId);
    const cur = activeClearanceEntry(flightData, 'altitude');
    const text = op.value == null ? '' : String(op.value);
    const next = text.trim() === '' ? null : parseAltitude(text.trim().toUpperCase());
    if (text.trim() !== '' && !next) return null; // not an altitude: SetBlock refuses it itself
    if (!cur || !next) return { needed: ['CLIMB', 'DESCENT'], next };
    const low = cur.block ? cur.block.lowFt : cur.parsed;
    const high = cur.block ? cur.block.highFt : cur.parsed;
    if (!Number.isFinite(low) || !Number.isFinite(high)) return { needed: ['CLIMB', 'DESCENT'], next };
    if (next.lowFt > high) return { needed: ['CLIMB'], next };
    if (next.highFt < low) return { needed: ['DESCENT'], next };
    return { needed: [], next };
  }

  /**
   * Before a control Block is written: until control transfers, an instruction outside the release in effect needs a
   * "coordinated with" attestation (JO 7110.65 5-4-5; ADR 0101 "The control-axis check"). An attestation, audited, not a
   * refusal of the instruction (H100 DR-1 b, DR-10 a). Speed is never checked (DR-11 b: the Block Map says no axis).
   * @returns {{ok:false}|{ok:true, audit?:object, peerFacilityId?:string, peerStrip?:object}}
   */
  checkControlAxis(strip, op, by) {
    if (op.confirmVacated) return { ok: true };
    const axis = this._rules.controlAxisFor(strip.stripType, op.blockId);
    if (!axis) return { ok: true };
    if (!this.isSteps(strip) || strip.coordination.state !== 'ACTIVE') return { ok: true };
    const settled = this.settleDueRelease(strip, by);
    const extra = settled ? { peerFacilityId: settled.peerFacilityId, peerStrip: settled.peerStrip, settled: settled.control } : {};
    const link = strip.coordination;
    if (this.controlHolder(link) !== 'TRANSFERRING') return { ok: true, ...extra };
    const scopes = this._neededScopes(axis, strip, op);
    if (!scopes || scopes.needed.length === 0) return { ok: true, ...extra };

    const side = this.sideOf(strip);
    const { theirs } = this._sides(strip);
    if (side === 'RECEIVING' && this._releaseCovers(link.release, scopes.needed, scopes.next)) {
      return { ok: true, audit: { controlAxis: scopes.needed.join('+'), release: 'WITHIN' }, ...extra };
    }
    const other = theirs.strip ? theirs.strip.ownerPositionId : link.peerPositionId;
    const accepted = new Set([other, link.peerPositionId]);
    if (typeof op.coordinatedWith !== 'string' || op.coordinatedWith === '') {
      const why = side === 'TRANSFERRING' ? 'control has not transferred' : 'outside the release in effect';
      return {
        ok: false, reason: 'VALIDATION_ERROR', strip,
        detail: `${scopes.needed.join(' and ')} is a control instruction and ${why}: coordinate with ${other} and say so (coordinatedWith)`,
        coordinateWith: other, needs: scopes.needed,
      };
    }
    if (!accepted.has(op.coordinatedWith)) {
      return {
        ok: false, reason: 'VALIDATION_ERROR', strip,
        detail: `coordinatedWith must be ${other}, the other party of this HANDOFF (got ${op.coordinatedWith})`,
        coordinateWith: other, needs: scopes.needed,
      };
    }
    return { ok: true, audit: { controlAxis: scopes.needed.join('+'), coordinatedWith: op.coordinatedWith }, ...extra };
  }

  // ── retirement, owner changes, restore ──────────────────────────────────

  /**
   * The transferring Strip reached DROPPED (drop, join, any retirement) while the exchange is ACTIVE: whatever it still
   * holds, control and comms both, moves to the receiving side (trigger `TRANSFERRING_RETIRED`), because the receiving
   * Strip is the only live one. One audit entry, inside the drop's own.
   * @returns {{peerFacilityId, peerStrip, controlAudit, warning?}|null}
   */
  onTransferringRetired(strip, by) {
    const link = strip.coordination;
    if (!this.isSteps(strip) || link.state !== 'ACTIVE' || link.mintedForCoordination) return null;
    const { receiving } = this._sides(strip);
    if (!this._live(receiving)) return null; // both retired: the flight has no live Strip, the invariant is vacuous
    const holdsComms = !link.comms.transferred;
    const holdsControl = this.controlHolder(link) === 'TRANSFERRING';
    if (!holdsComms && !holdsControl) return null;
    const now = this._clock.now();
    const patch = {};
    const controlAudit = {};
    if (holdsComms) {
      patch.comms = { transferred: true, at: now, by: by || null, byPositionId: strip.ownerPositionId, trigger: 'TRANSFERRING_RETIRED' };
      patch.repair = null;
      controlAudit.comms = { transferred: true, trigger: 'TRANSFERRING_RETIRED' };
    }
    if (holdsControl) {
      Object.assign(patch, this.controlPatch(strip, 'RECEIVING', 'TRANSFERRING_RETIRED', by));
      controlAudit.control = { trigger: 'TRANSFERRING_RETIRED' };
    }
    const peer = this._commit(strip, patch, by, { bump: false, auditOp: 'InterfacilityCoordinationResponse', action: 'TRANSFERRING_RETIRED' });
    this.assertControlInvariant(strip, by);
    return {
      ...peer, controlAudit,
      warning: holdsComms ? `communications moved to ${receiving.strip.ownerPositionId} by the drop` : undefined,
    };
  }

  /**
   * What the receiver's retirement leaves in the mutation log on the proposer's Strip (the exchange ends there and the
   * proposer keeps both: `RECEIVING_RETIRED`). Read by `Coordination#receiveCoordinationPeerGone` before it clears the link.
   * @returns {object|null} the `control` entry to log, or null when the receiver held neither
   */
  receivingRetiredEntry(strip) {
    const link = strip.coordination;
    if (!this.isSteps(strip)) return null;
    const returned = [];
    if (link.comms && link.comms.transferred) returned.push('comms');
    if (this.controlHolder(link) === 'RECEIVING') returned.push('control');
    return { trigger: 'RECEIVING_RETIRED', returned };
  }

  /**
   * This Strip changed owner (a TransferStrip, a NLA transfer, a CarrierHandoff, an SfaRotation, a consolidation): if its
   * side holds control, `separationResponsibilityRef` follows the owner — control moves with ownership inside a Facility
   * (ADR 0101 decision 7, DR-4). One helper, called from the ownership-change points, not from each op. The caller has
   * already bumped the Strip.
   * @returns {{peerFacilityId, peerStrip}|null}
   */
  followOwner(strip, by) {
    const link = strip.coordination;
    if (!this.isSteps(strip) || link.state !== 'ACTIVE' || !link.control) return null;
    if (this.controlHolder(link) !== this.sideOf(strip)) return null;
    const ref = link.separationResponsibilityRef;
    if (ref && ref.facilityId === this._rules.facilityId && ref.positionId === strip.ownerPositionId) return null;
    const patch = { separationResponsibilityRef: { facilityId: this._rules.facilityId, positionId: strip.ownerPositionId } };
    return this._commit(strip, patch, by, { bump: false, auditOp: 'InterfacilityCoordinationResponse', action: 'CONTROL_FOLLOWS_OWNER' });
  }

  // ── the invariant ───────────────────────────────────────────────────────

  /**
   * The violations of the control invariant for the exchange `strip` is half of (empty when it holds). Pure.
   * @returns {{axis:'comms'|'control', side:string, why:string}[]}
   */
  invariantProblems(strip, { staffing = true } = {}) {
    if (!this.isSteps(strip)) return [];
    const { mine, theirs, transferring, receiving } = this._sides(strip);
    const view = this._live(mine) ? strip : (this._live(theirs) ? theirs.strip : null);
    const link = view && view.coordination;
    if (!link || link.state !== 'ACTIVE' || !link.comms || !link.control) return [];
    const problems = [];
    for (const [axis, side] of [['comms', this.commsHolder(link)], ['control', this.controlHolder(link)]]) {
      const holder = side === 'TRANSFERRING' ? transferring : receiving;
      if (!this._live(holder)) problems.push({ axis, side, why: 'its Strip is retired' });
      else if (staffing && !holder.covered) problems.push({ axis, side, why: `${holder.strip.ownerPositionId} is not staffed` });
    }
    return problems;
  }

  /**
   * Holds after every HANDOFF-family mutation, every retirement and every restore. Under test (`invariantMode` 'throw') a
   * violation throws; in production it repairs by moving the holder to the other side when that side's Strip is live and
   * its owner staffed, writing an `InterfacilityControlRepair` entry (a safety net, never the primary mechanism). A
   * violation nothing can repair (both sides unstaffed) is logged and left for a controller.
   * @returns {object[]} the repairs made
   */
  assertControlInvariant(strip, by = null, opts = {}) {
    const staffing = opts.staffing !== false;
    const problems = this.invariantProblems(strip, { staffing });
    if (problems.length === 0) return [];
    const text = problems.map(p => `${p.axis} held by the ${p.side} side: ${p.why}`).join('; ');
    if (this._invariantModeOf() === 'throw') throw new Error(`control invariant violated on ${strip.stripId}: ${text}`);
    const repairs = [];
    const { transferring, receiving } = this._sides(strip);
    for (const p of problems) {
      const to = p.side === 'TRANSFERRING' ? 'RECEIVING' : 'TRANSFERRING';
      const target = to === 'RECEIVING' ? receiving : transferring;
      if (!this._live(target) || (staffing && !target.covered)) {
        log.error('control invariant violated and not repairable: nobody live and staffed holds it', { stripId: strip.stripId, axis: p.axis, why: p.why });
        this._recordRepair(strip, { axis: p.axis, from: p.side, to: null, why: p.why, repaired: false });
        continue;
      }
      const before = deepClone(strip);
      const patch = p.axis === 'control'
        ? this.controlPatch(strip, to, 'REPAIR', by)
        : { comms: { transferred: to === 'RECEIVING', at: this._clock.now(), by: by || null, byPositionId: null, trigger: 'REPAIR' } };
      // The standing notice both Facilities' panels show (CONTROL_REPAIRED, forwarding-obligations.js): the flight and what moved.
      patch.repair = { at: this._clock.now(), axis: p.axis, from: p.side, to, why: p.why };
      this._commit(strip, patch, by, { bump: false, auditOp: 'InterfacilityControlRepair', action: p.axis.toUpperCase() });
      log.warn('control invariant repaired', { stripId: strip.stripId, axis: p.axis, from: p.side, to, why: p.why });
      this._recordRepair(strip, { axis: p.axis, from: p.side, to, why: p.why, repaired: true }, before);
      repairs.push({ axis: p.axis, from: p.side, to });
    }
    return repairs;
  }

  _recordRepair(strip, fields, before = null) {
    const mutationLog = this._mutationLogOf();
    if (!mutationLog) return;
    mutationLog.record({
      clientMutationId: null, causedBy: this._activeCmid || null, op: 'InterfacilityControlRepair',
      stripId: strip.stripId, flightDataId: strip.flightDataId || null, facilityId: this._rules.facilityId || null,
      actingPositionId: null, actorId: 'system', at: this._clock.now(),
      ...(before ? { before } : {}), after: deepClone(strip), ...fields,
    });
  }

  /** The unrepairable violations of the exchange `strip` is half of, for the standing CONTROL_UNCOVERED alert (forwarding-obligations.js). */
  exchangeProblems(strip) { return this.invariantProblems(strip); }

  /** Restore, and a change of staffing: the invariant for every live exchange Strip on this Board. @returns {number} repairs */
  reconcileExchanges(opts = {}) {
    let n = 0;
    for (const strip of this._state.all()) {
      if (strip.state === 'DROPPED' || !this.isSteps(strip)) continue;
      n += this.assertControlInvariant(strip, null, opts).length;
    }
    return n;
  }
}

module.exports = { HandoffControl, SCOPES, MARKS, RELEASE_ACTIONS };
