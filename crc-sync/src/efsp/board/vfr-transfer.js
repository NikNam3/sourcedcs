'use strict';

// A VFR handoff ACROSS Facilities (docs/adr/0162, amending ADR 0146): AP to CENTER's CTR, CTR to any Position of
// INCIRLIK. The STARS/ERAM automated handoff between facilities (JO 7110.65BB para 5-4-5, 5-4-6): the transferring
// controller initiates, the receiving controller accepts, and the strip is then the receiver's. A VFR has no separation
// responsibility or control to release (H174, H175), so none of the cross-Facility HANDOFF's replicas or check-in
// (ADR 0101, 0122) applies: nothing is minted at INITIATE, and ACCEPT moves the strip.
//
// A Strip lives on one Facility's Board, so "the strip moves" is: the receiving Board mints a VFR strip on the same flight
// data (the correlation and the binding are keyed by flight data, so they follow; the code, HDG/SPD/ALT and history are
// the flight data's), in the receiver's VFR Bay, carrying the strip's annotations; then the sending Board ends its strip
// (DROPPED, counted as this Facility's operation, ADR 0065). Minting first keeps the flight data alive across the move
// (`liveStripsForFlightData` never reaches zero).
//
// This class is one Board's half of both sides: `receiverRefusal` and `mint` run on the RECEIVING Board, `release` on
// the SENDING Board. board/ops/vfr-handoff.js calls them, through rules.peerBoard for the other Board.

const { mintReplica, deepClone } = require('./strip-util');

class VfrTransfer {
  /**
   * @param {object} deps
   * @param {object} deps.rules the Board's rules (facility-rules.js)
   * @param {object} deps.state the Board kernel
   * @param {object} deps.placement the Board's Placement
   * @param {{now: () => number}} deps.clock the mission clock
   * @param {object} deps.audit the Board's BoardAudit
   * @param {(strip:object, by:string|null) => object} deps.retire StripOps' retire
   */
  constructor({ rules, state, placement, clock, audit, retire }) {
    this._rules = rules;
    this._state = state;
    this._placement = placement;
    this._clock = clock;
    this._audit = audit;
    this._retire = retire;
  }

  /** Why `positionId` of this Facility cannot be handed a VFR strip, or null: it works VFR strips and someone is on it. */
  receiverRefusal(positionId) {
    if (!(this._rules.baysFor(positionId) || []).length) {
      return { reason: 'VALIDATION_ERROR', detail: `${positionId} is not a Position of ${this._rules.facilityId}` };
    }
    if (!this._rules.canMutateAction(positionId, 'VfrHandoff', 'ACCEPT') || !this._placement.vfrBayFor(positionId)) {
      return { reason: 'VALIDATION_ERROR', detail: `${positionId} does not work VFR strips` };
    }
    if (!this._rules.isStaffed(positionId) && !this._rules.consolidatedAt(positionId)) {
      return { reason: 'NO_RECEIVING_POSITION', detail: `${positionId} is not staffed` };
    }
    return null;
  }

  /**
   * Mint the receiver's strip from `fromStrip` (the sender's, a copy) at `toPositionId`'s VFR Bay. Writes nothing on a refusal.
   * @returns {{ok:true, strip:object}|{ok:false, reason:string, detail:string}}
   */
  mint({ fromStrip, toPositionId, by }) {
    const bay = this._placement.vfrBayFor(toPositionId);
    if (!bay) return { ok: false, reason: 'VALIDATION_ERROR', detail: `${toPositionId} has no Bay to keep a VFR strip in` };
    const full = this._placement.bayFullRefusal(bay.bayId, { stripId: null });
    if (full) return { ok: false, reason: full.reason, detail: full.detail };
    const strip = mintReplica({ state: this._state, placement: this._placement, clock: this._clock }, {
      flightDataId: fromStrip.flightDataId, stripType: 'VFR', state: fromStrip.state,
      toPositionId, coordinationBay: bay, by,
      links: () => ({ vfrHandoff: null }),
    });
    strip.annotations = deepClone(fromStrip.annotations || {});
    const rackId = this._placement.placementRack(strip, bay);
    if (rackId && rackId !== strip.rackId) {
      strip.rackId = rackId;
      strip.orderKey = this._placement.appendOrderKey(bay.bayId, rackId, strip.stripId);
    }
    return { ok: true, strip };
  }

  /**
   * The sending Board's half of the receiver's ACCEPT: its strip, handed off to `toFacilityId`/`toPositionId` and minted
   * there as `toStripId`, ends here. (An INITIATE accepted at once ends the strip inside its own Mutation instead, which
   * audits it.)
   * @returns {{ok:true, strip:object, retired:object}|{ok:false, reason:string, detail:string}}
   */
  release({ stripId, toFacilityId, toPositionId, toStripId, by, causedBy }) {
    const strip = this._state.strips.get(stripId);
    if (!strip || strip.stripType !== 'VFR' || strip.state === 'DROPPED') return { ok: false, reason: 'NOT_FOUND', detail: 'that VFR strip is gone' };
    const before = deepClone(strip);
    strip.vfrHandoff = null;
    const retired = this._retire(strip, by);
    if (!retired.ok) {
      Object.assign(strip, before);
      return { ok: false, reason: retired.reason, detail: retired.detail };
    }
    // A system entry (not a peer one) so the drop is this Facility's count (traffic-count.js reads `source: 'peer'` as a
    // replica's change). It names the strip the flight continues on.
    this._audit.recordSystem('VfrHandoffAccepted', strip, {
      causedBy: causedBy || null, actorId: by || null, before, after: deepClone(strip),
      vfrHandoff: { to: toPositionId, toFacilityId, toStripId },
    });
    return { ok: true, strip, retired };
  }
}

module.exports = { VfrTransfer };
