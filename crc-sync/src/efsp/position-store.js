'use strict';

// Position occupancy — Primary/Observer, claim/request/release, the
// covering chain, and self-coordination lookups (EFSPImplementationGuide.md
// §4.8, WP1A). Net-new: WP0 reconnaissance this session confirmed no
// Position/role concept exists anywhere in crc-sync today — auth.js is
// pure per-user Casdoor OAuth with no role selection, and CRCSYNC_COALITION
// is one global env var, not per-controller (see resolve.js).
//
// Deliberately ephemeral, like TrackStore/CollaborativeStore — NOT part of
// the durable persistence this Phase adds for Board/FDR state (ADR 0002).
// Guide §4.8.2 rule 5 is explicit: "Primary status is presence state...
// and it MUST NOT enter the durable Mutation log." What IS durable is
// `actingPositionId` stamped onto each Mutation by board-store.js/
// mutation-log.js — never this store's own state.
//
// Positions are NOT signed into or derived from radar-station selection in
// this implementation (guide's D-9 talks about stations, but Ground/
// Clearance Delivery have no associated radar at all) — see the
// implementation plan's decision: a dedicated Position selector in
// crc-desktop calls setHeldPositions() with the controller's full
// declared set each time it changes.

class PositionStore {
  /**
   * @param {string[]} positionIds — the fixed Position set, e.g. ['OPS','CD','GND','TWR'] for Phase 1
   * @param {object} coveringChain — one-hop covering map, e.g. { CD:'GND', GND:'TWR' } (guide §4.8.6's default chain, Phase-1-truncated at TWR since APP doesn't exist yet). A Position absent from this map (like OPS, and TWR itself) has no covering Position — matches the guide's own chain table, which never lists one for OPS either.
   */
  constructor(positionIds, coveringChain) {
    this._positionIds = new Set(positionIds);
    this._coveringChain = coveringChain || {};
    this._state = new Map(); // positionId -> { primary, observers:[], pendingPrimaryRequest }
    for (const id of positionIds) {
      this._state.set(id, { primary: null, observers: [], pendingPrimaryRequest: null });
    }
    this._sessions = new Map(); // controllerId -> Set(positionId) currently held
  }

  isOccupied(positionId) {
    const s = this._state.get(positionId);
    return !!(s && s.primary);
  }

  primaryOf(positionId) {
    const s = this._state.get(positionId);
    return s && s.primary ? s.primary.controllerId : null;
  }

  observersOf(positionId) {
    const s = this._state.get(positionId);
    return s ? [...s.observers] : [];
  }

  heldBy(controllerId) {
    return [...(this._sessions.get(controllerId) || [])];
  }

  /**
   * Walks the covering chain to the end (guide §4.8.6 rule 3: "If the
   * covering Position is also unoccupied, follow the chain to the end"),
   * returning the first OCCUPIED Position found, or null if the chain
   * bottoms out with nobody occupying any link (defect D19's boundary —
   * callers must treat null distinctly from a stranding they failed to
   * detect, not silently swallow it).
   */
  coveringPositionFor(positionId) {
    let current = this._coveringChain[positionId] || null;
    const seen = new Set([positionId]);
    while (current) {
      if (seen.has(current)) return null; // cycle guard — configuration bug, never a real chain
      seen.add(current);
      if (this.isOccupied(current)) return current;
      current = this._coveringChain[current] || null;
    }
    return null;
  }

  /** True when `controllerId` already holds Primary at `positionId` — the Phase-1 self-coordination test (guide §4.8.3). */
  isSelfCoordinated(controllerId, positionId) {
    return this.primaryOf(positionId) === controllerId;
  }

  getAll() {
    return [...this._state.entries()].map(([positionId, s]) => ({
      positionId,
      primary: s.primary,
      observers: [...s.observers],
      pendingPrimaryRequest: s.pendingPrimaryRequest,
      coveringFor: [...this._positionIds].filter(
        id => id !== positionId && !this.isOccupied(id) && this.coveringPositionFor(id) === positionId
      ),
    }));
  }

  /**
   * A controller declares the FULL set of Positions they hold this session
   * (the dedicated Position selector, not derived from radar stations —
   * see the module comment). Diffs against what they previously held:
   * newly-added Positions are claimed (Primary if unoccupied, else
   * Observer); removed ones are released (§4.8.6 vacate handling, non-
   * abrupt — an Observer promotion, if any, is offered as an explicit
   * prompt by the caller, not auto-applied here; see releasePrimaryTo()).
   *
   * @returns {{held:string[], vacated:string[]}} — `vacated` is what the
   *   caller (index.js/efsp-ws.js) should check against board-store's
   *   Strip counts to build the "this would strand N Strips" warning
   *   (guide §4.8.6 rule 5 — warn, never block).
   */
  setHeldPositions(controllerId, controllerName, heldPositionIds, now = Date.now()) {
    const valid = heldPositionIds.filter(id => this._positionIds.has(id));
    const before = this._sessions.get(controllerId) || new Set();
    const after = new Set(valid);

    const vacated = [];
    for (const id of before) {
      if (!after.has(id)) {
        this._release(controllerId, id, { abrupt: false });
        vacated.push(id);
      }
    }
    for (const id of after) {
      if (!before.has(id)) this._claim(controllerId, controllerName, id, now);
    }

    if (after.size > 0) this._sessions.set(controllerId, after);
    else this._sessions.delete(controllerId);

    return { held: [...after], vacated };
  }

  _claim(controllerId, controllerName, positionId, now) {
    const s = this._state.get(positionId);
    if (!s.primary) {
      s.primary = { controllerId, controllerName, since: now };
    } else if (s.primary.controllerId !== controllerId) {
      // Selecting an already-Primary'd Position makes the selector an
      // Observer (guide §4.8.2 rule 3) — never a second Primary (D18).
      if (!s.observers.some(o => o.controllerId === controllerId)) {
        s.observers.push({ controllerId, controllerName, since: now });
      }
    }
    // s.primary.controllerId === controllerId already: idempotent re-claim, no-op.
  }

  /** An Observer requests Primary (guide §4.8.2 rule 3) — delivered to the current Primary; requires their release via releasePrimaryTo(). Never auto-promotes. */
  requestPrimary(controllerId, positionId, now = Date.now()) {
    const s = this._state.get(positionId);
    if (!s || !s.primary) return { ok: false, reason: 'NOT_OCCUPIED' };
    if (s.primary.controllerId === controllerId) return { ok: false, reason: 'ALREADY_PRIMARY' };
    if (!s.observers.some(o => o.controllerId === controllerId)) return { ok: false, reason: 'NOT_OBSERVER' };
    s.pendingPrimaryRequest = { controllerId, requestedAt: now };
    return { ok: true };
  }

  /** The current Primary explicitly releases Primary to a requesting Observer — a prompt, never automatic (guide §4.8.6 rule 1). */
  releasePrimaryTo(positionId, toControllerId, now = Date.now()) {
    const s = this._state.get(positionId);
    if (!s || !s.primary) return { ok: false, reason: 'NOT_OCCUPIED' };
    const observer = s.observers.find(o => o.controllerId === toControllerId);
    if (!observer) return { ok: false, reason: 'NOT_OBSERVER' };

    const oldPrimary = s.primary;
    s.observers = s.observers.filter(o => o.controllerId !== toControllerId);
    s.observers.push({ controllerId: oldPrimary.controllerId, controllerName: oldPrimary.controllerName, since: now });
    s.primary = { controllerId: observer.controllerId, controllerName: observer.controllerName, since: now };
    s.pendingPrimaryRequest = null;
    return { ok: true };
  }

  /**
   * @param {{abrupt:boolean}} opts — abrupt=true (disconnect) auto-promotes
   *   the longest-waiting Observer (guide §4.8.6 rule 1 exception);
   *   abrupt=false (explicit deselect) leaves the Position simply
   *   unoccupied — the caller offers Observer promotion as an explicit
   *   prompt, not this store's job.
   */
  _release(controllerId, positionId, { abrupt }) {
    const s = this._state.get(positionId);
    if (!s) return;
    if (s.primary && s.primary.controllerId === controllerId) {
      if (abrupt && s.observers.length > 0) {
        const next = s.observers.shift(); // longest-waiting = earliest added
        s.primary = { controllerId: next.controllerId, controllerName: next.controllerName, since: Date.now() };
      } else {
        s.primary = null;
      }
      s.pendingPrimaryRequest = null;
    } else {
      s.observers = s.observers.filter(o => o.controllerId !== controllerId);
      if (s.pendingPrimaryRequest && s.pendingPrimaryRequest.controllerId === controllerId) {
        s.pendingPrimaryRequest = null;
      }
    }
  }

  /** Abrupt disconnect — releases every Position the controller held, auto-promoting where possible (guide §4.8.6 rule 1). */
  onDisconnect(controllerId) {
    const held = this._sessions.get(controllerId) || new Set();
    for (const id of held) this._release(controllerId, id, { abrupt: true });
    this._sessions.delete(controllerId);
  }
}

module.exports = { PositionStore };
