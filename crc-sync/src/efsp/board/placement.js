'use strict';

// Placement (docs/adr/0095): where a Strip goes. The order keys inside a Rack (fractional keys, the rebalance) and the
// Bays (Role Bays, Bay-implied state, capacity, the Bay a new owner gets, the rack a system move picks). Moved verbatim
// from board-store.js; the facade calls these methods.
//
// Late-bound callbacks, all into the facade: `touch` and `rebalanceRack` (tools/soak/host-core.js patches the facade's
// _touch and wraps its _rebalanceRack, so both must go through it), and `rejectedReplicaRefusal` (the NLA cluster's,
// still on the facade).

const { keyBetween, rebalance, needsRebalance } = require('../order-key');
const { runwayRackFor } = require('../runway-status');

class Placement {
  /**
   * @param {object} deps
   * @param {import('./board-state').BoardState} deps.state
   * @param {object} deps.rules the Board's rules
   * @param {{now: () => number}} deps.clock the mission clock
   * @param {import('../flight-data-store').FlightDataStore} deps.flightDataStore
   * @param {(stripId: string) => void} deps.touch
   * @param {(bayId: string, rackId: string, excludeStripId: string|null) => void} deps.rebalanceRack
   * @param {(strip: object, toState: string) => object|null} deps.rejectedReplicaRefusal
   */
  constructor({ rules, state, clock, flightDataStore, touch, rebalanceRack, rejectedReplicaRefusal }) {
    this._state = state;
    this._rules = rules;
    this._clock = clock;
    this._fdrStore = flightDataStore;
    this._touch = touch;
    this._rebalanceRack = rebalanceRack;
    this._rejectedReplicaRefusal = rejectedReplicaRefusal;
  }

  // ── orderKey resolution ──────────────────────────────────────────────────

  resolveOrderKey(bayId, rackId, afterStripId, beforeStripId, excludeStripId) {
    const rackStrips = this._state.rack(bayId, rackId).filter(s => s.stripId !== excludeStripId);
    const findKey = (id) => (id ? (rackStrips.find(s => s.stripId === id) || {}).orderKey ?? null : null);
    let key;
    try {
      key = keyBetween(findKey(afterStripId), findKey(beforeStripId));
    } catch (err) {
      if (err.code !== 'ORDER_KEY_EXHAUSTED') throw err;
      return this.keyAfterRebalance(bayId, rackId, afterStripId, beforeStripId, excludeStripId);
    }
    // The proactive rebalance (docs/adr/0081, L6's F8). Same-slot inserts
    // grow a key by about half a character each, without bound, and nothing
    // ever called needsRebalance — keys reached 183 characters in 400 drags.
    // Once a new key passes REBALANCE_KEY_LENGTH the Rack is re-keyed and the
    // key recomputed between the neighbours' fresh keys, inside this same
    // Board event: the re-keyed Strips are touched, so they leave in this
    // Mutation's broadcast (drainTouched) like every other change it made.
    if (needsRebalance([key])) return this.keyAfterRebalance(bayId, rackId, afterStripId, beforeStripId, excludeStripId);
    return key;
  }

  /** Rebalances the Rack, then resolves the key between the named neighbours' fresh keys. */
  keyAfterRebalance(bayId, rackId, afterStripId, beforeStripId, excludeStripId) {
    this._rebalanceRack(bayId, rackId, excludeStripId);
    const refreshed = this._state.rack(bayId, rackId).filter(s => s.stripId !== excludeStripId);
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

  /** Rebalances one Rack — MUST run as one atomic Board event, never mid-drag (guide §5.4). */
  rebalanceRack(bayId, rackId, excludeStripId) {
    const ordered = this._state.rack(bayId, rackId).filter(s => s.stripId !== excludeStripId);
    const fresh = rebalance(ordered.map(s => s.stripId));
    for (const s of ordered) {
      s.orderKey = fresh.get(s.stripId);
      s.rev += 1;
      this._touch(s.stripId);
    }
  }

  /**
   * The key that puts a Strip at the END of a Rack, the way _applyCreateStrip
   * places a new one. keyBetween(null, null) is NOT this — it returns the
   * seed key, which lands mid-Rack once anything else is in there.
   */
  appendOrderKey(bayId, rackId, excludeStripId) {
    const rackStrips = this._state.rack(bayId, rackId).filter(s => s.stripId !== excludeStripId);
    const last = rackStrips.length ? rackStrips[rackStrips.length - 1].stripId : null;
    return this.resolveOrderKey(bayId, rackId, last, null, excludeStripId);
  }

  /** {isStaffed, consolidatedAt, facilityId} bound from this._rules — computeNla()'s staffing context (guide §4.5, e.g. DEPARTED's real Hand-Off-to-APP inhibit). `facilityId` (WP4A, docs/adr/0014) lets nla.js distinguish a CENTER-held ARRIVAL Strip's INBOUND state (whose next step is the Coordinate/HANDOFF button, not an intrafacility NLA transfer) from an INCIRLIK one. Built once per call site rather than inline so both computeNla() call sites below stay in lockstep. */
  nlaCtx(target = null) {
    return {
      isStaffed: this._rules.isStaffed, consolidatedAt: this._rules.consolidatedAt,
      facilityId: this._rules.facilityId, standingReleases: this._rules.standingReleases,
      // §9.7 rule 1 (docs/adr/0061) — the runway status view, on every
      // computeNla call site at once: the button, the advisory stamp, and the
      // drag. `targetRackId` is set only on the drag path (decisions.md Q27).
      runwayStatusFor: this._rules.runwayStatusFor,
      targetRackId: target ? target.rackId : undefined,
      // docs/adr/0074 — the recovery Case, the manned lane the stack feeds, and
      // whether the flight is in the stack, for the carrier's NLA tables.
      carrierCase: this._rules.carrierCase,
      carrierLaneFor: this._rules.carrierLaneFor,
      carrierInStack: this._rules.carrierInStack,
    };
  }

  /** This Facility's runway status view, or null (no runways — nothing is runway-gated). */
  runwayStatusView() {
    return this._rules.runwayStatusFor();
  }

  /**
   * The rack a Strip lands in when something other than a drag places it in
   * `bay` (decisions.md Q26, S-R2-1): in a runway-queue Bay, the end its FDR
   * names or else the active end; anywhere else, the Bay's first rack as
   * always. Without it every NLA-queued departure sat in rwy-05 and was judged
   * against 05, whatever the active runway was.
   */
  placementRack(strip, bay) {
    // An SFA frequency Bay is placed by the flight's own frequency, so a Strip put
    // back by a system move (a Position retaken, a covering hand-back) returns to
    // the Rack that IS its frequency, not the first one (guide §4.2, D17).
    if (bay && bay.view === 'sfa-freqs') {
      const fdr = this._fdrStore.getFlightData(strip.fdrId);
      const rack = fdr && fdr.comms ? this._rules.sfaRackFor(bay.bayId, fdr.comms.workingFrequencyMhz) : null;
      if (rack) return rack;
    }
    return runwayRackFor(strip, this._fdrStore.getFlightData(strip.fdrId), this.runwayStatusView(), bay);
  }

  /**
   * The owner's Bay that holds this Strip's Role whatever its state (Bay
   * `holdsRole`, docs/adr/0087), or null. A Role with such a Bay keeps its state
   * on the Strip: no Bay implies it, so a drag never changes it, and a state
   * change never moves it — which also stops an OVERFLIGHT `INBOUND` being filed
   * under ARRIVAL's `INBOUND` Bay, the one thing the shared state names would
   * otherwise do.
   */
  stripTypeBayFor(strip, positionId = strip.ownerPositionId) {
    const bays = this._rules.baysFor(positionId);
    return bays.find(b => b.holdsRole === strip.role) || null;
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
  validateBayImpliedTransition(strip, targetBayId, targetRackId) {
    // A Role Bay (`holdsRole`, docs/adr/0087) takes only its own Role's Strips.
    const holds = this._rules.bayHoldsStripType(targetBayId);
    if (holds && holds !== strip.role) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${targetBayId} holds ${holds} Strips only; a ${strip.role} Strip cannot be placed there` };
    }
    const stripTypeBay = this.stripTypeBayFor(strip);
    if (stripTypeBay) {
      // Another Role's state-implying Bay is not somewhere this Role goes.
      if (this._rules.bayImpliesState(targetBayId)) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: `a ${strip.role} Strip stays in ${stripTypeBay.bayId}; ${targetBayId} is another Role's Bay` };
      }
      return { ok: true, impliedState: null };
    }
    const impliedState = this._rules.bayImpliesState(targetBayId);
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
    if (!this._rules.canActOnState(strip.ownerPositionId, strip.role, strip.state)) {
      return { ok: false, reason: 'PERMISSION_DENIED', detail: `${strip.state} is not ${strip.ownerPositionId}'s to advance` };
    }

    // ...and, for the same reason, a declined replica stays inert on this
    // path too (F-303): the drag IS the other way to make this transition, so
    // gating only the NLA button would leave it reachable by dropping the
    // replica into a state-implying Bay. Non-state-implying Bays returned
    // above, so tidying a dead replica off to one side is unaffected, and no
    // Bay implies DROPPED, so the Drop exception cannot arise here.
    const inert = this._rejectedReplicaRefusal(strip, impliedState);
    if (inert) return { ok: false, reason: inert.reason, detail: inert.detail };

    const fdr = this._fdrStore.getFlightData(strip.fdrId);
    const nla = this._rules.computeNla(strip, fdr, this._clock.now(), this.nlaCtx({ bayId: targetBayId, rackId: targetRackId }));
    if (!nla || nla.inhibited) {
      return { ok: false, reason: 'NLA_INHIBITED', detail: nla ? nla.inhibited : `no legal transition from ${strip.state}` };
    }
    // docs/adr/0074: the four carrier handoffs are four buttons and each
    // records its own trigger type (guide §9.12), so a drag into the Bay that
    // implies the NLA's own state is refused with the button's name rather than
    // moving the Strip without the stack effect and the tag.
    if (nla.carrierTransfer && nla.toState === impliedState) {
      const t = this._rules.carrierHandoffs[nla.carrierTransfer];
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `use the ${t ? t.label : nla.carrierTransfer} button — a carrier hand-over is recorded, not dragged` };
    }
    if (nla.toState !== impliedState && (nla.alsoLegal || []).includes(impliedState)) {
      return { ok: true, impliedState };
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
  requireKnownBay(bayId, strip) {
    if (this._rules.bayExists(bayId)) return null;
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `no such Bay here: ${bayId}`, strip };
  }

  /**
   * A Bay with a `capacity` (facility-config.js's Bay descriptor flag; PAR's final
   * Bay holds one, §7.10) refuses one more Strip. Returns a refusal or null. A
   * DROPPED Strip does not count (it has left the Board), nor does `strip` itself,
   * so re-ordering inside the Bay is never refused.
   */
  bayFullRefusal(bayId, strip) {
    const bay = this._rules.bayDescriptor(bayId);
    if (!bay || !Number.isInteger(bay.capacity)) return null;
    const held = this._state.all().filter(s => s.bayId === bayId && s.state !== 'DROPPED' && s.stripId !== strip.stripId);
    if (held.length < bay.capacity) return null;
    return {
      reason: 'VALIDATION_ERROR',
      detail: `${bayId} holds ${bay.capacity} Strip${bay.capacity === 1 ? '' : 's'} at a time and ${held[0].callsign || held[0].stripId} is in it`,
    };
  }

  /**
   * The Bay a Strip in `state` sits in when `positionId` becomes its owner
   * without choosing one (docs/adr/0080, B3): the owner's Bay that implies the
   * state; else its first Bay that implies none (its coordination-style Bay);
   * else null, and the caller keeps the current Bay and says so. The rack is
   * the placement rule's (a runway queue's end), as for every other placement.
   * @returns {{bayId:string, rackId:string}|null}
   */
  bayForNewOwner(positionId, state, strip = null) {
    const bays = this._rules.baysFor(positionId);
    const stripTypeBay = strip ? bays.find(b => b.holdsRole === strip.role) : null;
    if (stripTypeBay) return { bayId: stripTypeBay.bayId, rackId: this.placementRack(strip, stripTypeBay) };
    // Never another Role's Bay (`holdsRole`, docs/adr/0087): a Role Bay implies no state, so the
    // "first Bay implying none" fallback used to pick app-overflight for a DEPARTURE.
    const bay = bays.find(b => b.impliesState === state) || bays.find(b => !b.impliesState && !b.holdsRole) || null;
    if (!bay) return null;
    return { bayId: bay.bayId, rackId: strip ? this.placementRack(strip, bay) : bay.rackIds[0] };
  }

  /**
   * Moves a Strip into its owner's Bay for a state it has just reached, when
   * that Position has one configured (guide §2, "Bay membership expresses
   * operational state"; §3.5 rule 4).
   *
   * A state-only transition used to change `state` and nothing else, so Mark
   * Cleared left the Strip in `cd-pending-clearance` reading CLEARED while
   * `cd-cleared` stayed empty, and the same at GND (`gnd-taxi-out`) and TWR
   * (`twr-airborne`) — the Bay name and the Strip contradicting each other
   * (docs/ui-findings/lane1.md F-102). The config already asserts the
   * equivalence in the other direction: dragging INTO one of these Bays
   * changes the state (validateBayImpliedTransition), so the Bay means the
   * state whichever way the Strip got there.
   *
   * Nothing happens when this owner has no Bay for the state — LUAW is the
   * live example, and TWR's Strip correctly stays in `twr-runway-queue`.
   * `bayForImpliedState` FALLS BACK to the Position's first Bay when nothing
   * matches (facility-config.js), which is what a transfer wants and is
   * exactly wrong here: it would file a Strip reaching LUAW back under
   * `twr-runway-queue`'s own implied RUNWAY_QUEUE. Hence the explicit
   * `impliesState` re-check rather than trusting the lookup.
   */
  relocateForImpliedState(strip, toState) {
    if (this.stripTypeBayFor(strip)) return; // its Bay holds it in every state (docs/adr/0087)
    const bay = this._rules.bayForImpliedState(strip.ownerPositionId, toState);
    if (!bay || bay.impliesState !== toState || bay.bayId === strip.bayId) return;
    strip.bayId = bay.bayId;
    strip.rackId = this.placementRack(strip, bay);
    strip.orderKey = this.appendOrderKey(bay.bayId, strip.rackId, strip.stripId);
  }
}

module.exports = { Placement };
