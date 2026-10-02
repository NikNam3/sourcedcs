'use strict';

// TOFI, tactical-control hand-in/hand-out (docs/adr/0095; guide §4.6.3, docs/adr/0025): ENTRY/EXIT PROPOSE,
// ACCEPT / REJECT / TRANSFER_COMMS on the Strip, and the three `receiveTofi*` calls a peer Board makes on this one.
// BoardStore's `receiveTofi*` delegate here.

const crypto = require('crypto');
const { newFlags, deepClone } = require('./strip-util');
const { SEPARATION_REGIMES } = require('../flight-data-store');

class Tofi {
  /**
   * @param {object} deps
   * @param {object} deps.rules the Board's rules (tofiEligibleState, peerBoard, ...)
   * @param {object} deps.state the Board kernel (board/board-state.js)
   * @param {object} deps.audit BoardAudit
   * @param {object} deps.placement Placement
   * @param {{now: () => number}} deps.clock the mission clock
   * @param {object} deps.flightDataStore
   * @param {(stripId:string) => void} deps.touch the kernel's `recordTouch` (board/board-state.js)
   * @param {() => string|null} deps.activeCmid the clientMutationId being applied, read late
   * @param {(strip:object, by:string) => object|null} deps.retire late-bound to StripOps' retire
   * @param {(stripType:string) => string|undefined} deps.initialStateFor the authority registry's accessor
   */
  constructor({ rules, state, audit, placement, clock, flightDataStore, touch, activeCmid, retire, initialStateFor }) {
    this._rules = rules;
    this._state = state;
    this._audit = audit;
    this._placement = placement;
    this._clock = clock;
    this._flightDataStore = flightDataStore;
    this._touch = touch;
    this._activeCmidOf = activeCmid;
    this._retire = retire;
    this._initialStateFor = initialStateFor;
  }

  get _activeCmid() { return this._activeCmidOf(); }

  // ── TOFI (guide §4.6.3, docs/adr/0025) ───────────────
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
  //  4. The receiving side's Strip is a different strip type (MISSION),
  //     not a same-strip-type mirror — and it shares the ATC-side Strip's own
  //     flightDataId rather than getting a fresh one (guide §9.8's "bind it to
  //     the same flight data as any tower Strip for that flight," realized now
  //     rather than deferred to WP7).
  //
  // Both sides of an active exchange carry their own `tofiCoordination`
  // record (symmetric to `coordination`'s peerFacilityId/peerStripId/
  // peerPositionId naming) — PROPOSE always originates on the ATC-side
  // Strip; ACCEPT/REJECT/TRANSFER_COMMS are always invoked on the
  // MISSION-side Strip (the receiving MRU controller's own record),
  // mirroring exactly which side acts in the real-world exchange.

  applyOp(strip, op, by, actingPositionId) {
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
   * sharing this Strip's flightDataId); EXIT re-enters the SAME already-existing
   * link (receiveTofiExitProposal), minting nothing new.
   */
  _applyTofiPropose(strip, op, by, actingPositionId) {
    if (op.direction !== 'ENTRY' && op.direction !== 'EXIT') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'direction must be ENTRY or EXIT', strip };
    }
    if (strip.tofiCoordination && strip.tofiCoordination.state === 'INITIATED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'this Strip already has an open TOFI proposal', strip };
    }
    // The same open-link guard `StripOps#nlaPrecheck` and board/ops/convert-to-arrival.js's _applyConvertToArrival apply.
    // Without it CTR could open tactical control from a handoff replica it had
    // not yet accepted — on a flight AP still worked.
    if (strip.coordination && strip.coordination.state === 'INITIATED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'cannot open a TOFI exchange while a coordination proposal is open — accept or reject it first', strip };
    }

    const now = this._clock.now();

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
      // TOFI's own (stripType, state) gate — the 5 primitives have had one since
      // docs/adr/0022 and TOFI never did, so a controller could open tactical
      // control on a Strip that was not yet airborne, or on a MISSION Strip
      // (the strip type TOFI itself creates). See coordination.js.
      const required = this._rules.tofiEligibleState(strip.stripType);
      if (!required || strip.state !== required) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: required
          ? `a ${strip.stripType} Strip must be at ${required} to enter tactical control, not ${strip.state}`
          : `a ${strip.stripType} Strip can never open a TOFI exchange`, strip };
      }
      const allowed = this._rules.tofiCounterparts(actingPositionId) || [];
      if (!allowed.some(c => c.facilityId === op.toFacilityId && c.positionId === op.toPositionId)) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: `${op.toPositionId} is not a valid TOFI counterpart for ${actingPositionId}`, strip };
      }
      const peer = this._rules.peerBoard(op.toFacilityId);
      if (!peer) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown Facility: ${op.toFacilityId}`, strip };

      // Track-degradation soft interlock (guide §4.6 rule 5), same as the 5
      // ATC<->ATC primitives (docs/adr/0019) — TOFI is named in the same
      // §4.6 primitive table this rule sits directly under, so it applies
      // here too, for both directions.
      const entryFlightData = this._flightDataStore.getFlightData(strip.flightDataId);
      const entryDegraded = entryFlightData && entryFlightData.identity.trackDegradationFlag && entryFlightData.identity.trackDegradationFlag !== 'NONE';
      if (entryDegraded && !op.note) {
        return {
          ok: false, reason: 'VALIDATION_ERROR',
          detail: `track degradation (${entryFlightData.identity.trackDegradationFlag}) forces verbal coordination — a note is required`,
          strip,
        };
      }

      const proposal = peer.receiveTofiProposal({
        causedBy: this._activeCmid, fromFacilityId: this._rules.facilityId, fromPositionId: actingPositionId,
        fromStripId: strip.stripId, toPositionId: op.toPositionId, flightDataId: strip.flightDataId, note: op.note || null, by,
      });
      if (!proposal.ok) return { ok: false, reason: proposal.reason || 'VALIDATION_ERROR', detail: proposal.detail, strip };

      strip.tofiCoordination = {
        direction: 'ENTRY', state: 'INITIATED',
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
    const peer = this._rules.peerBoard(prior.peerFacilityId);
    if (!peer) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown Facility: ${prior.peerFacilityId}`, strip };

    const exitFlightData = this._flightDataStore.getFlightData(strip.flightDataId);
    const exitDegraded = exitFlightData && exitFlightData.identity.trackDegradationFlag && exitFlightData.identity.trackDegradationFlag !== 'NONE';
    if (exitDegraded && !op.note) {
      return {
        ok: false, reason: 'VALIDATION_ERROR',
        detail: `track degradation (${exitFlightData.identity.trackDegradationFlag}) forces verbal coordination — a note is required`,
        strip,
      };
    }

    const exitResult = peer.receiveTofiExitProposal({ causedBy: this._activeCmid, stripId: prior.peerStripId, note: op.note || null, by });
    if (!exitResult.ok) return { ok: false, reason: exitResult.reason || 'VALIDATION_ERROR', detail: exitResult.detail, strip };

    strip.tofiCoordination = {
      ...prior, direction: 'EXIT', state: 'INITIATED',
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
    if (!tofi || tofi.state !== 'INITIATED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no pending TOFI proposal on this Strip', strip };
    }
    // A soft warning, deliberately NOT a second hard gate beside
    // separation_regime's. Both fields describe authority over the same
    // real-world moment, and nothing cross-checked them before — a flight
    // could return to ATC control with the airspace still booked out to the
    // using agency. But the two are genuinely separable in our model
    // (a MOA can stay hot after one flight leaves it), so this is the §4.6
    // verbal-path soft-interlock shape, not rule 3's hard precondition.
    let warning;
    // The flight data this accept writes, carried out on the result so the ack and the
    // board-delta actually take it to every connected client. Without it the
    // regime the MRU controller stated on the accept landed server-side and
    // reached nobody until they next took a full snapshot — SEP REG read blank
    // on BOTH pages for the whole of tactical control, which is precisely what
    // docs/adr/0053 was written to stop (docs/ui-findings/lane3.md F-306,
    // lane1.md F-111's class).
    let writtenFlightData;
    if (tofi.direction === 'EXIT') {
      const flightData = this._flightDataStore.getFlightData(strip.flightDataId);
      if (!flightData || !flightData.tofi || flightData.tofi.separationRegime !== 'ATC') {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: 'separation_regime must be set back to ATC before completing a TOFI exit', strip };
      }
      if (flightData.airspace && flightData.airspace.owner === 'USING_AGENCY') {
        warning = 'AIRSPACE_STILL_WITH_USING_AGENCY';
      }
    }

    // ENTRY — the MRU controller MUST say under which regime they are taking
    // the aircraft (docs/adr/0053). Nothing required this before, and
    // flightData.tofi.separationRegime starts as null, so the whole of tactical
    // control could run with the flight data saying nothing at all about who was
    // separating: §4.8.3's "a second controller takes TAC_C2 ten minutes later
    // and inherits a lie", arriving by a route nobody was watching. It also
    // failed the EXIT gate below twenty minutes later, with the cause long out
    // of sight.
    //
    // ASKED FOR, never derived. §4.6.3 rule 1 and defect D14 are explicit that
    // the regime comes from the governing agreement and is not computable from
    // airspace type or anything else — so the fix is to make the controller
    // state it, not to guess it.
    if (tofi.direction === 'ENTRY') {
      const activeMarsa = this._rules.activeMarsaFor(strip.flightDataId);
      if (activeMarsa) {
        // The relation owns the regime while it is ACTIVE (docs/adr/0051), and
        // board/ops/set-block.js's _applySetBlock refuses a direct SREG write for the same reason.
        // Accepting tactical control does not change who is separating, so
        // asking here would offer a choice that cannot be honoured.
        if (op.separationRegime !== undefined && op.separationRegime !== 'MARSA') {
          return {
            ok: false, reason: 'VALIDATION_ERROR',
            detail: `this flight is in an active MARSA relation declared by ${activeMarsa.declaringCallsign} — it separates itself until that relation ends`,
            strip,
          };
        }
      } else {
        if (!SEPARATION_REGIMES.has(op.separationRegime)) {
          return {
            ok: false, reason: 'VALIDATION_ERROR',
            detail: `accepting tactical control requires a separation regime (${[...SEPARATION_REGIMES].join(', ')}) — it comes from the governing agreement and cannot be derived`,
            strip,
          };
        }
        const wrote = this._flightDataStore.setTofi(strip.flightDataId, { separationRegime: op.separationRegime }, { by });
        if (!wrote.ok) return { ok: false, reason: wrote.reason, detail: wrote.detail, strip };
        writtenFlightData = wrote.flightData;
      }
    }

    const now = this._clock.now();
    tofi.state = tofi.direction === 'EXIT' ? 'COMPLETE' : 'ACTIVE';
    tofi.acceptedAt = now;
    tofi.acceptedBy = by || null;

    // ENTRY only, and only for a Strip THIS exchange minted — relocate the
    // MISSION Strip out of the Coordination Bay into its normal working Bay
    // for its own (already-correct) state, mirroring
    // board/coordination.js's _applyCoordinationAccept's relocation pattern. EXIT never moved the
    // Strip into the Coordination Bay in the first place
    // (receiveTofiExitProposal doesn't touch bayId/rackId at all), so there's
    // nothing to relocate back.
    //
    // `mintedForTofi` is what makes this safe now that a TOFI can land on a
    // mission line that already existed (docs/adr/0054). Such a Strip is
    // sitting in a real working Bay, and relocating it would be actively
    // wrong: bayForImpliedState FALLS BACK TO bays[0] when no Bay implies the
    // state (facility-config.js), TAC_C2's bays[0] is `tac-c2-tasked`, and
    // TAC_C2 has no Bay implying OFF_STATION or RTB — so accepting a TOFI on a
    // mission line at RTB would file it back under Tasked.
    //
    // Recorded at propose time rather than re-derived here by comparing
    // strip.bayId against coordinationBayFor(): that derives the same answer
    // until a controller drags the replica somewhere else in between, and then
    // silently skips a relocation that should have happened.
    if (tofi.direction === 'ENTRY' && tofi.mintedForTofi) {
      const targetBay = this._rules.bayForImpliedState(strip.ownerPositionId, strip.state);
      if (targetBay) {
        strip.bayId = targetBay.bayId;
        strip.rackId = targetBay.rackIds[0];
        strip.orderKey = this._placement.resolveOrderKey(targetBay.bayId, targetBay.rackIds[0], null, null, strip.stripId);
      }
    }

    strip.rev += 1; strip.updatedAt = now; strip.updatedBy = by || null;
    this._touch(strip.stripId);

    let peerStrip = null;
    const peer = this._rules.peerBoard(tofi.peerFacilityId);
    if (peer) {
      const peerResult = peer.receiveTofiResponse({ causedBy: this._activeCmid, stripId: tofi.peerStripId, response: 'ACCEPT', by });
      if (peerResult.ok) peerStrip = peerResult.strip;
    }
    return { ok: true, strip, flightData: writtenFlightData, peerFacilityId: tofi.peerFacilityId, peerStrip, warning };
  }

  /** Always invoked on the MISSION-side Strip, mirroring _applyTofiAccept's own side. */
  _applyTofiReject(strip, op, by) {
    const tofi = strip.tofiCoordination;
    if (!tofi || tofi.state !== 'INITIATED') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'no pending TOFI proposal on this Strip', strip };
    }
    tofi.state = 'REJECTED';
    // A Strip this exchange minted has no life of its own, so a refused
    // exchange leaves nothing behind (docs/adr/0054). Without this it lingers
    // as residue: find-before-mint would then see a MISSION Strip at the
    // Position that just said no, and refuse the ATC controller's perfectly
    // reasonable retry to the OTHER counterpart — which
    // efsp-scenario-military's "the MRU refuses, and the ATC side recovers"
    // walks, and which caught this.
    //
    // A mission line TAC_C2 tasked itself is NOT residue: it existed before
    // the exchange and outlives it, rejection or not. That is exactly what
    // `mintedForTofi` distinguishes.
    //
    // Retired rather than deleted, so the Mutation log and any client that
    // already has it see a normal DROPPED transition. The beacon is safe:
    // _releaseFlightDataIfLastStrip only releases when no other live Strip shares the
    // flight data, and the ATC-side Strip is still live by construction here.
    let retired = null;
    if (tofi.mintedForTofi) {
      // Through _retireStrip like every other route to DROPPED (S-L24): the
      // archive clock, the remove indicator, the beacon release and the MARSA
      // retirement. Its active-TOFI guard cannot fire (the state is REJECTED).
      retired = this._retire(strip, by);
    } else {
      this._state.bump(strip, by);
    }

    let peerStrip = null;
    const peer = this._rules.peerBoard(tofi.peerFacilityId);
    if (peer) {
      const peerResult = peer.receiveTofiResponse({ causedBy: this._activeCmid, stripId: tofi.peerStripId, response: 'REJECT', by });
      if (peerResult.ok) peerStrip = peerResult.strip;
    }
    const out = { ok: true, strip, peerFacilityId: tofi.peerFacilityId, peerStrip };
    if (retired && retired.marsaChanged) { out.marsaChanged = retired.marsaChanged; out.flightDataList = retired.flightDataList; }
    return out;
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
    const now = this._clock.now();
    tofi.commsTransferred = true;
    tofi.commsTransferredAt = now;
    tofi.commsTransferredBy = by || null;
    strip.rev += 1; strip.updatedAt = now; strip.updatedBy = by || null;
    this._touch(strip.stripId);

    let peerStrip = null;
    const peer = this._rules.peerBoard(tofi.peerFacilityId);
    if (peer) {
      const peerResult = peer.receiveTofiResponse({ causedBy: this._activeCmid, stripId: tofi.peerStripId, response: 'TRANSFER_COMMS', by });
      if (peerResult.ok) peerStrip = peerResult.strip;
    }
    return { ok: true, strip, peerFacilityId: tofi.peerFacilityId, peerStrip };
  }

  /**
   * Called by the ATC-side Facility's BoardStore (via rules.peerBoard) on a
   * TOFI ENTRY PROPOSE — mints a brand-new, independent MISSION Strip in
   * THIS Facility's own `_strips` Map, landing in the receiving Position's
   * Coordination Bay. Shares the ATC-side Strip's own flightDataId (guide §9.8's
   * binding, realized now) rather than minting a fresh flight data — the one
   * genuinely new piece of D13-style replication this slice adds: every
   * one of the 5 ATC<->ATC primitives already does this (their replica
   * shares the sender's flightDataId too), but always with the SAME strip type on
   * both sides; TOFI is the first primitive to bind two DIFFERENT strip types
   * (the ATC-side stripType, and MISSION) to one shared flight data.
   * @returns {{ok:true, strip}|{ok:false, reason, detail}}
   */
  receiveTofiProposal({ fromFacilityId, fromPositionId, fromStripId, toPositionId, flightDataId, note, by, causedBy }) {
    const flightData = this._flightDataStore.getFlightData(flightDataId);
    if (!flightData) return { ok: false, reason: 'NOT_FOUND', detail: 'referenced flight data not found' };

    // FIND BEFORE MINT (docs/adr/0054). A mission line can now exist before
    // any TOFI — TAC_C2 tasks it and binds it to the flight at fragging time —
    // so this exchange must land on the Strip that is already there rather
    // than create a second MRU record for one airframe. Two mission lines with
    // independent lifecycles is docs/adr/0045's "two answers to one identity
    // question" wearing a different hat.
    const existing = [...this._state.strips.values()].find(
      s => s.flightDataId === flightDataId && s.stripType === 'MISSION' && s.state !== 'DROPPED');

    if (existing) {
      if (existing.ownerPositionId !== toPositionId) {
        // Do not silently re-own it. Ownership is per-Position (§4.8.1) and
        // the sender picked the wrong counterpart — say so, rather than mint a
        // duplicate beside the real one.
        return {
          ok: false, reason: 'VALIDATION_ERROR',
          detail: `this flight already has a mission line at ${existing.ownerPositionId} — propose tactical control to them`,
        };
      }
      const open = existing.tofiCoordination;
      if (open && (open.state === 'INITIATED' || open.state === 'ACTIVE')) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: 'a TOFI exchange is already open on this mission line' };
      }
      // Reuse. Deliberately touches NOTHING but the exchange record: this
      // Strip sits in a real working Bay at a real state, and both belong to
      // the MRU controller, not to this exchange. `mintedForTofi` is absent,
      // which is what stops _applyTofiAccept relocating it (see there).
      const reusedAt = this._clock.now();
      const existingBefore = deepClone(existing);
      existing.tofiCoordination = {
        direction: 'ENTRY', state: 'INITIATED',
        peerFacilityId: fromFacilityId, peerStripId: fromStripId, peerPositionId: fromPositionId,
        commsTransferred: false, commsTransferredAt: null, commsTransferredBy: null,
        note: note || null,
        initiatedAt: reusedAt, initiatedBy: by || null, acceptedAt: null, acceptedBy: null,
      };
      existing.rev += 1;
      existing.updatedAt = reusedAt;
      existing.updatedBy = by || null;
      this._touch(existing.stripId);
      this._audit.recordPeer('TofiProposal', existing, existingBefore, { causedBy, fromFacilityId, by });
      return { ok: true, strip: existing };
    }

    const coordinationBay = this._rules.coordinationBayFor(toPositionId);
    if (!coordinationBay) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `no Coordination Bay configured for ${toPositionId}` };
    }

    const stripId = crypto.randomUUID();
    const now = this._clock.now();
    const rackStrips = this._state.rack(coordinationBay.bayId, coordinationBay.rackIds[0]);
    const afterStripId = rackStrips.length ? rackStrips[rackStrips.length - 1].stripId : null;
    const orderKey = this._placement.resolveOrderKey(coordinationBay.bayId, coordinationBay.rackIds[0], afterStripId, null, null);

    const strip = {
      stripId,
      cid: this._state.nextCid(),
      flightDataId, // shared with the ATC-side Strip — guide §9.8's binding
      rev: 1,
      stripType: 'MISSION',
      state: this._initialStateFor('MISSION'),
      ownerPositionId: toPositionId,
      bayId: coordinationBay.bayId,
      rackId: coordinationBay.rackIds[0],
      orderKey,
      annotations: {},
      flags: newFlags(),
      // No `correlation` — it is keyed by flightDataId, and a replica shares the
      // originator's flight data (docs/adr/0013), so it shares the correlation too.
      // That is the case a per-Strip field got wrong: both halves of a
      // cross-Facility exchange are looking at one airframe.
      coordination: null,
      tofiCoordination: {
        direction: 'ENTRY', state: 'INITIATED',
        peerFacilityId: fromFacilityId, peerStripId: fromStripId, peerPositionId: fromPositionId,
        commsTransferred: false, commsTransferredAt: null, commsTransferredBy: null,
        note: note || null,
        initiatedAt: now, initiatedBy: by || null, acceptedAt: null, acceptedBy: null,
        // This exchange put the Strip in a Coordination Bay, so this
        // exchange is the one allowed to move it out again on ACCEPT.
        // Absent on the reuse path above, deliberately.
        mintedForTofi: true,
      },
      createdAt: now, updatedAt: now, updatedBy: by || null,
    };
    this._state.insert(strip);
    this._audit.recordPeer('TofiProposal', strip, null, { causedBy, fromFacilityId, by });
    return { ok: true, strip };
  }

  /**
   * Called by the ATC-side Facility's BoardStore on a TOFI EXIT PROPOSE —
   * re-enters the ALREADY-EXISTING MISSION Strip's tofiCoordination record
   * rather than minting a new one (the mission has been live in TACTICAL's
   * own Board throughout ENTRY's ACTIVE window).
   */
  receiveTofiExitProposal({ stripId, note, by, causedBy }) {
    const strip = this._state.strips.get(stripId);
    if (!strip || !strip.tofiCoordination) return { ok: false, reason: 'NOT_FOUND' };
    const before = deepClone(strip);

    const now = this._clock.now();
    strip.tofiCoordination.direction = 'EXIT';
    strip.tofiCoordination.state = 'INITIATED';
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
    this._audit.recordPeer('TofiExitProposal', strip, before, { causedBy, fromFacilityId: strip.tofiCoordination.peerFacilityId, by });
    return { ok: true, strip };
  }

  /**
   * Called by the MISSION-side Facility's BoardStore once its controller
   * has ACCEPTed/REJECTed a TOFI proposal, or TRANSFER_COMMS'd — updates
   * the ATC-side Strip's own tofiCoordination record to match, so both
   * sides agree on the outcome. Mirrors receiveCoordinationResponse exactly.
   */
  receiveTofiResponse({ stripId, response, by, causedBy }) {
    const strip = this._state.strips.get(stripId);
    if (!strip || !strip.tofiCoordination) return { ok: false, reason: 'NOT_FOUND' };
    const before = deepClone(strip);

    const now = this._clock.now();
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
    this._audit.recordPeer('TofiResponse', strip, before, { causedBy, fromFacilityId: tofi.peerFacilityId, by, action: response });
    return { ok: true, strip };
  }
}

module.exports = { Tofi };
