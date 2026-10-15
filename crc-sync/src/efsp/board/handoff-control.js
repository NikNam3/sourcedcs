'use strict';

// Check-in, release and transfer of control inside a HANDOFF (docs/adr/0122, which replaces ADR 0101's release model;
// H142, H143, H141 U-RQ2 c). ACCEPT of a HANDOFF moves radar identification and the Strip only. The rest is four fields on
// the `coordination` object of BOTH Strips of the exchange, kept in step by `receiveHandoffRecord`:
//
//   released: boolean                                               the handing-off station's one switch at PROPOSE
//   comms:    { transferred, at, by, byPositionId, trigger? }       transferred = the receiver marked the aircraft CHECKED IN
//   control:  { holder: 'TRANSFERRING'|'RECEIVING', at, by, trigger, airspaceId? }  who has separation responsibility
//   releaseRequest: null | { note, requestedAt, ..., answer }       the receiver asked a not-released handoff to be released
//
// The rule (H142): control never moves before CHECKED IN. Then a released handoff moves control at once; a not-released one
// moves it when the aircraft is inside the receiver's airspace (the control tick: efsp/index.js `settleHandoffControl` asks
// ADR 0125's `isInsideJurisdictionOf`, then `settleAtBoundary` below writes). The receiver never takes control by hand.
//
// `coordination.separationResponsibilityRef` stays the authoritative "who has control" (a Facility and a Position);
// `control.holder` is the readable mirror. "Transferring" is the proposer's Strip, "receiving" the minted replica
// (`mintedForCoordination`).
//
// THE CONTROL INVARIANT (H100 DR-6, ADR 0101): for every flight with an ACTIVE HANDOFF the communications holder and the
// control holder are each one side whose Strip is live and whose owner is staffed or consolidated into a staffed Position.
// `controlPatch` below is the one place control moves; `assertControlInvariant` is the net under every path. The safety
// nets (a retired transferring Strip, a repair) may move control before check-in: they exist because nobody else holds it.

const { MAX_FREE_TEXT, parseAltitude, activeClearanceEntry } = require('../flight-data-store');
const { deepClone } = require('./strip-util');
const { handoffGuardRefusal } = require('../handoff-guards');
const log = require('../../log').logger('efsp:handoff-control');
const { warn } = require('../warnings');

const MARKS = ['CHECKED_IN'];
const RELEASE_ACTIONS = ['REQUEST', 'GRANT', 'REFUSE'];

const refuse = (strip, detail, reason = 'VALIDATION_ERROR') => ({ ok: false, reason, detail, strip });

class HandoffControl {
  /**
   * @param {object} deps
   * @param {object} deps.rules the Board's rules (coordinationEffect, peerBoard, isStaffed, consolidatedAt, facilityId, ...)
   * @param {object} deps.state BoardState
   * @param {object} deps.audit BoardAudit
   * @param {{now: () => number}} deps.clock the mission clock (every `at` and gate here, H11)
   * @param {object} deps.flightDataStore
   * @param {() => string|null} deps.activeCmid the clientMutationId being applied, read late
   * @param {object|null} deps.mutationLog the Mutation log, or null (a Board built alone)
   * @param {() => 'repair'|'throw'} deps.invariantMode what `assertControlInvariant` does with a violation it finds
   */
  constructor({ rules, state, audit, clock, flightDataStore, activeCmid, mutationLog, invariantMode }) {
    this._rules = rules;
    this._state = state;
    this._audit = audit;
    this._clock = clock;
    this._flightDataStore = flightDataStore;
    this._activeCmidOf = activeCmid;
    this._mutationLog = mutationLog;
    this._invariantModeOf = invariantMode;
  }

  get _activeCmid() { return this._activeCmidOf(); }

  // ── the record ──────────────────────────────────────────────────────────

  /** The model a coordination primitive follows: 'STEPS' (HANDOFF), 'AT_ACCEPT' (AIT) or null. */
  _modelOf(link) {
    const effect = link && this._rules.coordinationEffect(link.primitive);
    return (effect && effect.controlModel) || null;
  }

  /** The model of a primitive by name (PROPOSE checks `released` against it). */
  modelOfPrimitive(primitive) {
    const effect = this._rules.coordinationEffect(primitive);
    return (effect && effect.controlModel) || null;
  }

  /** True for a Strip carrying a HANDOFF-family exchange whose control moves in steps. */
  isSteps(strip) {
    return !!strip && !!strip.coordination && this._modelOf(strip.coordination) === 'STEPS';
  }

  /**
   * The fields a primitive's `coordination` object starts with, on both Strips, at PROPOSE (docs/adr/0122 "The record").
   * `released` is the handing-off station's switch (H142: released unless it says not).
   */
  initialFields(primitive, { released = true } = {}) {
    const model = this.modelOfPrimitive(primitive);
    if (!model) return {};
    const fields = {
      comms: { transferred: false, at: null, by: null, byPositionId: null },
      control: { holder: 'TRANSFERRING', at: null, by: null, trigger: null },
    };
    if (model === 'STEPS') { fields.released = released !== false; fields.releaseRequest = null; fields.repair = null; }
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
    // Always a touch (docs/adr/0100): the undo history attributes this write to the Mutation that is applying, or sees it
    // as a system change that blocks an open undo of this Strip. A caller that already bumped has touched it this frame.
    if (bump) this._state.bump(strip, by);
    else this._state.recordTouch(strip.stripId);
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
   * changes together: every path that moves control — check-in of a released handoff, a granted release, the aircraft
   * inside the receiver's airspace, either retirement trigger, a repair — builds its patch here.
   */
  controlPatch(strip, toSide, trigger, by, extra = {}) {
    const { transferring, receiving } = this._sides(strip);
    const target = toSide === 'RECEIVING' ? receiving : transferring;
    return {
      repair: null, // a holder that moves by a controller's act or a retirement ends any standing repair notice
      control: { holder: toSide, at: this._clock.now(), by: by || null, trigger, ...extra },
      separationResponsibilityRef: { facilityId: target.facilityId, positionId: target.strip ? target.strip.ownerPositionId : null },
    };
  }

  /**
   * The seam ADR 0120 asked for (board/handoff-guards.js): may control move to the receiving Position now? Null when
   * it may; a refusal `{reason, detail}` otherwise. `phase` is 'CONTROL'.
   */
  _controlGuard(strip) {
    const { receiving } = this._sides(strip);
    return handoffGuardRefusal({
      phase: 'CONTROL', strip,
      flightData: this._flightDataStore.getFlightData(strip.flightDataId),
      receivingFacilityId: receiving.facilityId,
      receivingPositionId: receiving.strip ? receiving.strip.ownerPositionId : strip.coordination.peerPositionId,
    });
  }

  /**
   * The exchange this (transferring) Strip is half of waits for the aircraft to be inside the receiver's airspace: a
   * not-released HANDOFF, ACTIVE, checked in, control still with the transferring side. The control tick asks it.
   * @returns {{receivingFacilityId:string, receivingPositionId:string}|null}
   */
  boundaryCandidate(strip) {
    if (!this.isSteps(strip) || strip.state === 'DROPPED' || this.sideOf(strip) !== 'TRANSFERRING') return null;
    const link = strip.coordination;
    if (link.state !== 'ACTIVE' || link.released || !link.comms.transferred || this.controlHolder(link) !== 'TRANSFERRING') return null;
    const { receiving } = this._sides(strip);
    if (!this._live(receiving)) return null;
    return { receivingFacilityId: receiving.facilityId, receivingPositionId: receiving.strip.ownerPositionId };
  }

  /**
   * The control tick found the aircraft inside the receiver's airspace (`airspaceId` null for CENTER's fallback): control
   * moves (trigger `IN_AIRSPACE`), one system entry here and the peer mirror there. Nothing moves when the receiver is
   * not live and staffed, or a guard refuses (the tick asks again next time).
   * @returns {{ok:true, strip, peerFacilityId, peerStrip}|{ok:false, reason, detail?}}
   */
  settleAtBoundary(strip, { airspaceId = null } = {}) {
    if (!this.boundaryCandidate(strip)) return { ok: false }; // nothing waits for the boundary here
    const { receiving } = this._sides(strip);
    if (!receiving.covered) return { ok: false, reason: 'NOT_STAFFED' };
    const guard = this._controlGuard(strip);
    if (guard) return { ok: false, reason: guard.reason, detail: guard.detail };
    const before = deepClone(strip);
    const patch = this.controlPatch(strip, 'RECEIVING', 'IN_AIRSPACE', 'system', { airspaceId });
    const peer = this._commit(strip, patch, 'system', { auditOp: 'InterfacilityCoordinationResponse', action: 'TRANSFER_CONTROL' });
    this._audit.recordSystem('HandoffControlInAirspace', strip, {
      before, after: deepClone(strip), control: { trigger: 'IN_AIRSPACE', airspaceId, to: receiving.strip.ownerPositionId },
    });
    this.assertControlInvariant(strip, 'system');
    return { ok: true, strip, ...peer };
  }

  // ── the receiver's one mark ─────────────────────────────────────────────

  _requireActiveSteps(strip) {
    if (!this.isSteps(strip)) return refuse(strip, 'no HANDOFF exchange on this Strip');
    if (strip.coordination.state !== 'ACTIVE') return refuse(strip, 'the HANDOFF has not been accepted');
    return null;
  }

  /**
   * HANDOFF CHECKED_IN (docs/adr/0122): the receiver records the pilot's call. A released handoff moves control with it
   * (trigger `CHECKED_IN`); a not-released one waits for the aircraft to be inside the receiver's airspace (the tick).
   * Any other action — TRANSFER_COMMS, TRANSFER_CONTROL ("Control to me") — is refused as unknown.
   */
  applyMark(strip, op, by, actingPositionId) {
    if (!MARKS.includes(op.action)) return refuse(strip, `unknown HANDOFF action: ${op.action}`);
    const bad = this._requireActiveSteps(strip);
    if (bad) return bad;
    const link = strip.coordination;
    if (this.sideOf(strip) !== 'RECEIVING') return refuse(strip, `only ${link.peerPositionId}, the receiving Position, marks the aircraft checked in`);
    if (link.comms.transferred) return refuse(strip, 'the aircraft is already checked in');
    const { receiving } = this._sides(strip);
    if (!this._live(receiving) || !receiving.covered) return refuse(strip, `${strip.ownerPositionId} is not staffed`, 'NOT_STAFFED');
    const now = this._clock.now();
    const patch = {
      comms: { transferred: true, at: now, by: by || null, byPositionId: actingPositionId || null, trigger: 'CHECKED_IN' },
      repair: null,
    };
    const controlAudit = { comms: { transferred: true } };
    if (link.released && this.controlHolder(link) === 'TRANSFERRING') {
      const guard = this._controlGuard(strip);
      if (guard) return refuse(strip, guard.detail, guard.reason);
      Object.assign(patch, this.controlPatch(strip, 'RECEIVING', 'CHECKED_IN', by));
      controlAudit.control = { trigger: 'CHECKED_IN' };
    }
    const peer = this._commit(strip, patch, by, { auditOp: 'InterfacilityCoordinationResponse', action: op.action });
    this.assertControlInvariant(strip, by);
    return { ok: true, strip, ...peer, controlAudit };
  }

  // ── Request release (a not-released handoff only) ───────────────────────

  /**
   * ControlRelease REQUEST / GRANT / REFUSE (docs/adr/0122): the receiver asks for a not-released handoff to be released;
   * the handing-off station grants (the handoff becomes released: control moves now when the aircraft is checked in) or
   * refuses. One open request at a time. Never on a released handoff or after control moved (U8). No WITHDRAW (U-RQ2 c).
   * Never undoable (H100 DR-5).
   */
  applyRelease(strip, op, by, actingPositionId) {
    if (!RELEASE_ACTIONS.includes(op.action)) return refuse(strip, `unknown ControlRelease action: ${op.action}`);
    const bad = this._requireActiveSteps(strip);
    if (bad) return bad;
    const link = strip.coordination;
    if (this.controlHolder(link) !== 'TRANSFERRING') return refuse(strip, 'control was already transferred');
    if (link.released) return refuse(strip, 'the handoff is released: control moves at check-in');
    const side = this.sideOf(strip);
    const now = this._clock.now();
    const open = !!link.releaseRequest && link.releaseRequest.answer == null;
    const patch = {};
    const auditFields = { action: op.action };
    let controlAudit;

    if (op.action === 'REQUEST') {
      if (side !== 'RECEIVING') return refuse(strip, 'only the receiving Position requests a release');
      if (open) return refuse(strip, 'a release request is already open');
      patch.releaseRequest = {
        note: typeof op.note === 'string' && op.note.trim() ? op.note.trim().slice(0, MAX_FREE_TEXT) : null,
        requestedAt: now, requestedBy: by || null, requestedByPositionId: actingPositionId || null,
        answer: null, answeredAt: null, answeredBy: null, reason: null,
      };
    } else {
      if (side !== 'TRANSFERRING') return refuse(strip, `only ${link.peerPositionId}, the handing-off Position, may ${op.action.toLowerCase()} a release`);
      if (!open) return refuse(strip, `no open release request to ${op.action.toLowerCase()}`);
      if (op.action === 'GRANT') {
        patch.released = true;
        patch.releaseRequest = { ...link.releaseRequest, answer: 'GRANTED', answeredAt: now, answeredBy: by || null, reason: null };
        // Released and already checked in: control moves now, inside this op's entry (never a second one).
        if (link.comms.transferred) {
          const { receiving } = this._sides(strip);
          if (!this._live(receiving) || !receiving.covered) {
            return refuse(strip, `${receiving.strip ? receiving.strip.ownerPositionId : link.peerPositionId} is not staffed`, 'NOT_STAFFED');
          }
          const guard = this._controlGuard(strip);
          if (guard) return refuse(strip, guard.detail, guard.reason);
          Object.assign(patch, this.controlPatch(strip, 'RECEIVING', 'RELEASED', by));
          controlAudit = { control: { trigger: 'RELEASED' } };
        }
      } else { // REFUSE
        patch.releaseRequest = {
          ...link.releaseRequest, answer: 'REFUSED', answeredAt: now, answeredBy: by || null,
          reason: typeof op.reason === 'string' && op.reason.trim() ? op.reason.trim().slice(0, MAX_FREE_TEXT) : null,
        };
        auditFields.reason = patch.releaseRequest.reason;
      }
    }

    const peer = this._commit(strip, patch, by, { auditOp: 'InterfacilityControlRelease', action: op.action });
    this.assertControlInvariant(strip, by);
    return { ok: true, strip, ...peer, controlAudit: { controlRelease: auditFields, ...(controlAudit || {}) } };
  }

  // ── the control-axis check (SetBlock) ───────────────────────────────────

  /**
   * The axes a control-axis Block write touches, for the attestation's words: TURNS for a heading; for an altitude CLIMB
   * or DESCENT by comparing the new value with the flight's assigned altitude, both when there is none (or the write
   * clears it). `[]` means the write changes nothing vertically (the same altitude again), which needs nothing.
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
   * Before a control Block is written: until control transfers, a heading or altitude instruction from either side needs
   * a "coordinated with" attestation (JO 7110.65BB ¶2-1-14 b, ¶5-4-5 b, ¶5-4-6 c; ADR 0101 "The control-axis check"). An
   * attestation, audited, not a refusal of the instruction (H100 DR-1 b, DR-10 a). Speed is never checked (DR-11 b).
   * ADR 0122: there is no partial release any more, so nothing short of control waives it.
   * @returns {{ok:false}|{ok:true, audit?:object}}
   */
  checkControlAxis(strip, op) {
    if (op.confirmVacated) return { ok: true };
    const axis = this._rules.controlAxisFor(strip.stripType, op.blockId);
    if (!axis) return { ok: true };
    if (!this.isSteps(strip) || strip.coordination.state !== 'ACTIVE') return { ok: true };
    const link = strip.coordination;
    if (this.controlHolder(link) !== 'TRANSFERRING') return { ok: true };
    const scopes = this._neededScopes(axis, strip, op);
    if (!scopes || scopes.needed.length === 0) return { ok: true };

    const side = this.sideOf(strip);
    const { theirs } = this._sides(strip);
    const other = theirs.strip ? theirs.strip.ownerPositionId : link.peerPositionId;
    const accepted = new Set([other, link.peerPositionId]);
    if (typeof op.coordinatedWith !== 'string' || op.coordinatedWith === '') {
      const why = side === 'TRANSFERRING' ? 'the handoff is accepted' : 'control has not transferred';
      return {
        ok: false, reason: 'VALIDATION_ERROR', strip,
        detail: `${scopes.needed.join(' and ')} is a control instruction and ${why}: coordinate with ${other} and say so (coordinatedWith)`,
        // The structured half of the request: the client keys on this, never on the sentence above (DESK-ACKS).
        attestation: { with: other, needs: scopes.needed },
      };
    }
    if (!accepted.has(op.coordinatedWith)) {
      return {
        ok: false, reason: 'VALIDATION_ERROR', strip,
        detail: `coordinatedWith must be ${other}, the other party of this HANDOFF (got ${op.coordinatedWith})`,
      };
    }
    return { ok: true, audit: { controlAxis: scopes.needed.join('+'), coordinatedWith: op.coordinatedWith } };
  }

  // ── retirement, owner changes, restore ──────────────────────────────────

  /**
   * The transferring Strip reached DROPPED (drop, join, any retirement) while the exchange is ACTIVE: whatever it still
   * holds, control and comms both, moves to the receiving side (trigger `TRANSFERRING_RETIRED`), because the receiving
   * Strip is the only live one. One audit entry, inside the drop's own.
   * @returns {{peerFacilityId, peerStrip, controlAudit, warnings?}|null}
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
      warnings: holdsComms ? [warn('COMMS_MOVED_BY_DROP', `communications moved to ${receiving.strip.ownerPositionId} by the drop`)] : undefined,
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
   * This Strip changed owner (a TransferStrip, a NLA transfer, a CarrierHandoff, a consolidation): if its
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
      // Bumped: a repair is a change of its own (a change of staffing or a restart runs it outside any Mutation).
      this._commit(strip, patch, by, { auditOp: 'InterfacilityControlRepair', action: p.axis.toUpperCase() });
      log.warn('control invariant repaired', { stripId: strip.stripId, axis: p.axis, from: p.side, to, why: p.why });
      this._recordRepair(strip, { axis: p.axis, from: p.side, to, why: p.why, repaired: true }, before);
      repairs.push({ axis: p.axis, from: p.side, to });
    }
    return repairs;
  }

  _recordRepair(strip, fields, before = null) {
    if (!this._mutationLog) return;
    this._mutationLog.record({
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

module.exports = { HandoffControl, MARKS, RELEASE_ACTIONS };
