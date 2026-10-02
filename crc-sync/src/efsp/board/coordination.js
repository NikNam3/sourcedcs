'use strict';

// Cross-Facility coordination (docs/adr/0095; guide §4.6, docs/adr/0013-0018): the five primitives'
// PROPOSE / ACCEPT / REJECT / STAND_BY / CANCEL on the sender's Strip, and the four `receive*` calls a peer Board
// makes on this one. BoardStore's `receiveCoordination*` delegate here.

const { deepClone, trackDegradationRefusal } = require('./strip-util');
const { mintReplica } = require('./replica');

class Coordination {
  /**
   * @param {object} deps
   * @param {object} deps.rules the Board's rules (coordinationEffect, peerBoard, ...)
   * @param {object} deps.state the Board kernel (board/board-state.js)
   * @param {object} deps.audit BoardAudit
   * @param {object} deps.placement Placement
   * @param {{now: () => number}} deps.clock the mission clock
   * @param {object} deps.flightDataStore
   * @param {(stripId:string) => void} deps.touch the kernel's `recordTouch` (board/board-state.js)
   * @param {() => string|null} deps.activeCmid the clientMutationId being applied, read late
   * @param {(strip:object, by:string) => object|null} deps.retire late-bound to StripOps' retire
   * @param {(stripType:string, senderState:string) => string} deps.replicaStateOnReceipt the authority registry's accessor (docs/adr/0087)
   * @param {(primitive:string, stripType:string, senderState:string) => string|undefined} deps.senderStateOnAccept the authority registry's accessor (docs/adr/0087)
   */
  constructor({ rules, state, audit, placement, clock, flightDataStore, touch, activeCmid, retire, replicaStateOnReceipt, senderStateOnAccept }) {
    this._rules = rules;
    this._state = state;
    this._audit = audit;
    this._placement = placement;
    this._clock = clock;
    this._flightDataStore = flightDataStore;
    this._touch = touch;
    this._activeCmidOf = activeCmid;
    this._retire = retire;
    this._replicaStateOnReceipt = replicaStateOnReceipt;
    this._senderStateOnAccept = senderStateOnAccept;
  }

  get _activeCmid() { return this._activeCmidOf(); }

  // ── cross-Facility coordination (guide §4.6, docs/adr/0013-0018) ──
  //
  // "The Strip does not cross the Facility boundary... one logical flight data record, N
  // per-Facility Strip replicas" (guide §4.6, defect D13 if built as a
  // move). Concretely: this BoardStore instance is one Facility's Board
  // (index.js's composition root constructs one {BoardStore,
  // PositionStore} pair PER Facility — see docs/adr/0013). A coordination
  // primitive's PROPOSE action mutates the SENDER's own existing Strip
  // (ownership-gated exactly like every other op — `StripOps#dispatch`'s existing
  // NOT_OWNER check already covers it) and, on success, calls a public
  // method on the RECEIVING Facility's own BoardStore instance
  // (`rules.peerBoard(facilityId)`) to mint a brand-new, independent Strip
  // object there. From that point the two replicas are two rows in two
  // separate `_strips` Maps, linked only by `coordination.peerStripId`/
  // `peerFacilityId` — never a shared identity, never one object moved.
  // Independent removability (acceptance criterion D13) falls out of
  // this for free: board/ops/drop-strip.js's _applyDropStrip on one instance structurally cannot
  // reach the other instance's Map at all.

  /**
   * @param {object} strip — the Strip this Mutation targets (already
   *   verified by `StripOps#dispatch` to be owned by actingPositionId)
   * @param {{kind:string, action:'PROPOSE'|'ACCEPT'|'REJECT', toFacilityId?:string, toPositionId?:string, note?:string}} op
   */
  applyOp(strip, op, by, actingPositionId) {
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
      // The proposer's own way out of its own exchange (U7, docs/adr/0080).
      case 'CANCEL':   return this._applyCoordinationCancel(strip, op, by);
      default:         return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown coordination action: ${op.action}`, strip };
    }
  }

  _applyCoordinationPropose(strip, op, by, actingPositionId) {
    const primitive = op.kind;
    const effect = this._rules.coordinationEffect(primitive);
    if (!effect) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown coordination primitive: ${primitive}`, strip };

    // AIT is configuration, not a default (guide §4.6 rule 7, docs/adr/0022)
    // — every other primitive is always available to AP/CTR; AIT alone
    // additionally requires a written directive on file for this Facility.
    if (primitive === 'AIT' && !this._rules.aitAuthorized) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: "AIT requires a written directive — not authorized in this Facility's configuration", strip };
    }

    // Which (stripType, state) a Strip must be in to propose ANY of the 5
    // primitives (docs/adr/0022) — the mirror of this check the client
    // performs proactively in bay-view.js's _canProposeCoordination; this
    // is the authoritative half, since the client's is only a convenience
    // gate. Only the (stripType, state) combos a receiving Facility actually has
    // a landing Bay configured for are eligible — see coordination.js.
    if (this._rules.coordinationEligibleState(strip.stripType) !== strip.state) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `a ${strip.stripType} Strip may not propose coordination from state ${strip.state}`, strip };
    }

    if (strip.coordination && (strip.coordination.state === 'INITIATED' || strip.coordination.state === 'ACTIVE')) {
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
    const ownCoordinationBay = this._rules.coordinationBayFor(strip.ownerPositionId);
    if (ownCoordinationBay && strip.bayId === ownCoordinationBay.bayId) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'this Strip is a coordination replica, not a flight record you can propose coordination from', strip };
    }
    if (!op.toFacilityId || !op.toPositionId) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'toFacilityId and toPositionId are required', strip };
    }
    if (op.toFacilityId === this._rules.facilityId) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'coordination target must be a different Facility', strip };
    }
    const peer = this._rules.peerBoard(op.toFacilityId);
    if (!peer) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown Facility: ${op.toFacilityId}`, strip };

    // Track-degradation soft interlock (guide §4.6 rule 5): CST/FAIL/IF/NT/
    // TRK force verbal coordination; a non-empty note is the electronic
    // stand-in for "verbal coordination occurred" (docs/adr/0019).
    const flightData = this._flightDataStore.getFlightData(strip.flightDataId);
    const degradation = trackDegradationRefusal(flightData, op.note, strip);
    if (degradation) return degradation;

    const now = this._clock.now();
    const proposal = peer.receiveCoordinationProposal({
      causedBy: this._activeCmid, primitive, fromFacilityId: this._rules.facilityId, fromPositionId: actingPositionId,
      fromStripId: strip.stripId, toPositionId: op.toPositionId, flightDataId: strip.flightDataId,
      fromStripType: strip.stripType, fromState: strip.state,
      note: op.note || null, by,
    });
    if (!proposal.ok) return { ok: false, reason: proposal.reason || 'VALIDATION_ERROR', detail: proposal.detail, strip };

    strip.coordination = {
      primitive,
      state: 'INITIATED',
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
      lastForwardedEtaUtc: flightData ? flightData.filed.estimatedArrivalTimeUtc : null,
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
    if (!strip.coordination || strip.coordination.state !== 'INITIATED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no pending coordination proposal on this Strip', strip };
    }
    const effect = this._rules.coordinationEffect(strip.coordination.primitive);
    if (!effect) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown coordination primitive: ${strip.coordination.primitive}`, strip };

    const now = this._clock.now();
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
    // Position's normal working Bay for whatever (stripType, state) it was
    // already minted with (docs/adr/0022) — the replica's state was set
    // correctly by receiveCoordinationProposal already; accept only
    // relocates it, it never advances the state itself.
    const targetBay = this._placement.stripTypeBayFor(strip) || this._rules.bayForImpliedState(strip.ownerPositionId, strip.state);
    if (targetBay) {
      strip.bayId = targetBay.bayId;
      strip.rackId = this._placement.placementRack(strip, targetBay);
      strip.orderKey = this._placement.resolveOrderKey(targetBay.bayId, strip.rackId, null, null, strip.stripId);
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
    const peer = this._rules.peerBoard(peerFacilityId);
    if (peer) {
      const peerResult = peer.receiveCoordinationResponse({ causedBy: this._activeCmid, stripId: strip.coordination.peerStripId, response: 'ACCEPT', by });
      if (peerResult.ok) peerStrip = peerResult.strip;
    }
    return { ok: true, strip, peerFacilityId, peerStrip };
  }

  _applyCoordinationReject(strip, op, by) {
    if (!strip.coordination || strip.coordination.state !== 'INITIATED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no pending coordination proposal on this Strip', strip };
    }
    strip.coordination.state = 'REJECTED';
    this._state.bump(strip, by);

    const peerFacilityId = strip.coordination.peerFacilityId;
    let peerStrip = null;
    const peer = this._rules.peerBoard(peerFacilityId);
    if (peer) {
      const peerResult = peer.receiveCoordinationResponse({ causedBy: this._activeCmid, stripId: strip.coordination.peerStripId, response: 'REJECT', by });
      if (peerResult.ok) peerStrip = peerResult.strip;
    }
    return { ok: true, strip, peerFacilityId, peerStrip };
  }

  /**
   * The proposer cancels, or closes, its own exchange (U7, docs/adr/0080). A
   * link on the proposer's Strip that the other side can no longer answer — the
   * receiver dropped its replica, its Position is unstaffed, a proposal nobody
   * will get to — used to be unreachable: the guards that keep an open link
   * honest (no Drop, no Convert, no second proposal, no NLA) also kept the
   * proposer from ever leaving it. Legal for any state of the link, on the
   * proposer's Strip only; the receiver answers with ACCEPT/REJECT instead.
   * Returns the Strip to no coordination (audited, like any Mutation), and
   * whatever the peer still holds of it: an unanswered or refused replica is
   * retired, an accepted one simply loses its link.
   */
  _applyCoordinationCancel(strip, op, by) {
    if (!strip.coordination) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no coordination link on this Strip to cancel', strip };
    }
    if (strip.coordination.mintedForCoordination) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'only the proposer can cancel; answer the proposal with ACCEPT or REJECT', strip };
    }
    const link = strip.coordination;
    let peerStrip = null;
    const peer = this._rules.peerBoard(link.peerFacilityId);
    if (peer) {
      const r = peer.receiveCoordinationCancel({ causedBy: this._activeCmid, stripId: link.peerStripId, by });
      if (r.ok && r.strip) peerStrip = r.strip;
    }
    strip.coordination = null;
    this._state.bump(strip, by);
    return { ok: true, strip, peerFacilityId: link.peerFacilityId, peerStrip };
  }

  /**
   * The proposer cancelled (called through rules.peerBoard): whatever this
   * side holds of the exchange ends. An unanswered or refused replica is a
   * proposal artifact and is retired; an accepted one is the receiver's working
   * Strip for the flight, so only its link goes.
   * @returns {{ok:true, strip:object|null}} strip null when there was nothing left to change
   */
  receiveCoordinationCancel({ stripId, by, causedBy }) {
    const strip = this._state.strips.get(stripId);
    if (!strip || strip.state === 'DROPPED' || !strip.coordination) return { ok: true, strip: null };
    const before = deepClone(strip);
    const fromFacilityId = strip.coordination.peerFacilityId;
    if (strip.coordination.state === 'ACTIVE') {
      strip.coordination = null;
      this._state.bump(strip, by);
    } else {
      strip.coordination = null; // so the retire below does not try to tell the proposer back
      this._retire(strip, by);
    }
    this._audit.recordPeer('InterfacilityCoordinationCancel', strip, before, { causedBy, fromFacilityId, by });
    return { ok: true, strip };
  }

  /**
   * The receiver's replica reached DROPPED (called through rules.peerBoard):
   * an exchange still PROPOSED or ACTIVE ends on the proposer's Strip, which
   * would otherwise carry a link nobody can answer for good (U7). Audited as a
   * system change, like a consolidation change.
   * @returns {{ok:boolean, strip?:object}}
   */
  receiveCoordinationPeerGone({ stripId, goneStripId, causedBy }) {
    const strip = this._state.strips.get(stripId);
    const link = strip && strip.coordination;
    if (!link || link.peerStripId !== goneStripId || (link.state !== 'INITIATED' && link.state !== 'ACTIVE')) return { ok: false };
    const before = deepClone(strip);
    strip.coordination = null;
    this._state.bump(strip, null);
    this._audit.recordSystem('SystemCoordinationEnd', strip, { before, after: deepClone(strip), reason: 'peer-dropped', causedBy: causedBy || null });
    return { ok: true, strip };
  }

  /**
   * OPERATIONAL_REQUEST's third response (guide §4.6, docs/adr/0022) — the
   * request is still under consideration, not resolved either way.
   * Deliberately does NOT touch strip.coordination.state (stays PROPOSED);
   * only stamps a timestamp both sides can show so the requester sees the
   * request wasn't silently dropped.
   */
  _applyCoordinationStandBy(strip, op, by) {
    if (!strip.coordination || strip.coordination.state !== 'INITIATED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no pending coordination proposal on this Strip', strip };
    }
    if (strip.coordination.primitive !== 'OPERATIONAL_REQUEST') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'STAND_BY only applies to OPERATIONAL_REQUEST', strip };
    }
    strip.coordination.lastStandByAt = this._clock.now();
    this._state.bump(strip, by);

    const peerFacilityId = strip.coordination.peerFacilityId;
    let peerStrip = null;
    const peer = this._rules.peerBoard(peerFacilityId);
    if (peer) {
      const peerResult = peer.receiveCoordinationResponse({ causedBy: this._activeCmid, stripId: strip.coordination.peerStripId, response: 'STAND_BY', by });
      if (peerResult.ok) peerStrip = peerResult.strip;
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
   * `fromStripType`/`fromState` (docs/adr/0022) — the replica is minted with the
   * SENDER's own strip type/EfspState, not a hardcoded ARRIVAL/INBOUND
   * shape. `_applyCoordinationPropose` already validated the sender's
   * (stripType, state) is one of coordination.js's COORDINATION_ELIGIBLE_STATES
   * combos, so nothing further to check here.
   * @returns {{ok:true, strip}|{ok:false, reason, detail}}
   */
  receiveCoordinationProposal({ primitive, fromFacilityId, fromPositionId, fromStripId, toPositionId, flightDataId, fromStripType, fromState, note, by, causedBy }) {
    const flightData = this._flightDataStore.getFlightData(flightDataId);
    if (!flightData) return { ok: false, reason: 'NOT_FOUND', detail: 'referenced flight data not found' };

    const coordinationBay = this._rules.coordinationBayFor(toPositionId);
    if (!coordinationBay) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `no Coordination Bay configured for ${toPositionId}` };
    }

    // The replica carries the SENDER's own strip type/EfspState (docs/adr/0022) from the moment it's minted, not a
    // separate "not yet accepted" pseudo-state — coordination.state is what actually tracks PROPOSED/ACTIVE/REJECTED.
    // fromState is guaranteed to be one of coordination.js's COORDINATION_ELIGIBLE_STATES combos (checked by
    // _applyCoordinationPropose before this is ever called), so the receiving Facility is guaranteed to have a Bay
    // configured for it.
    const strip = mintReplica({ state: this._state, placement: this._placement, clock: this._clock }, {
      flightDataId, stripType: fromStripType, state: this._replicaStateOnReceipt(fromStripType, fromState),
      toPositionId, coordinationBay, by,
      links: (now) => ({
        coordination: {
          primitive,
          state: 'INITIATED',
          // This Strip exists only because of this exchange — it is the
          // receiver's replica, not a flight record with a life of its own.
          // Read by `StripOps#isRejectedReplica` to keep a declined replica inert
          // wherever it ends up on the Board (F-303); TOFI's `mintedForTofi`
          // is the same field for the same reason.
          mintedForCoordination: true,
          peerFacilityId: fromFacilityId,
          peerStripId: fromStripId,
          peerPositionId: fromPositionId,
          dataOwnerPositionRef: { facilityId: fromFacilityId, positionId: fromPositionId },
          separationResponsibilityRef: { facilityId: fromFacilityId, positionId: fromPositionId },
          radarIdTransferred: false,
          commsTransferred: false,
          lastForwardedEtaUtc: flightData.filed.estimatedArrivalTimeUtc || null,
          note: note || null,
          initiatedAt: now, initiatedBy: by || null,
          acceptedAt: null, acceptedBy: null,
          lastStandByAt: null,
        },
      }),
    });
    this._audit.recordPeer('InterfacilityCoordinationProposal', strip, null, { causedBy, fromFacilityId, by });
    return { ok: true, strip };
  }

  /**
   * Called by the RECEIVING Facility's BoardStore (via rules.peerBoard)
   * once its controller has ACCEPTed or REJECTed a proposal — updates the
   * SENDER's original Strip's coordination record to match, so both
   * replicas agree on the outcome. Bypasses the ordinary Mutation gates
   * for the same reason receiveCoordinationProposal does.
   */
  receiveCoordinationResponse({ stripId, response, by, causedBy }) {
    const strip = this._state.strips.get(stripId);
    if (!strip || !strip.coordination) return { ok: false, reason: 'NOT_FOUND' };
    const before = deepClone(strip);

    const now = this._clock.now();
    if (response === 'ACCEPT') {
      const effect = this._rules.coordinationEffect(strip.coordination.primitive);
      // docs/adr/0087: a HANDed-OFF overflight has left this sector.
      const afterAccept = this._senderStateOnAccept(strip.coordination.primitive, strip.stripType, strip.state);
      if (afterAccept) strip.state = afterAccept;
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
    this._audit.recordPeer('InterfacilityCoordinationResponse', strip, before, { causedBy, fromFacilityId: strip.coordination.peerFacilityId, by, action: response });
    return { ok: true, strip };
  }
}

module.exports = { Coordination };
