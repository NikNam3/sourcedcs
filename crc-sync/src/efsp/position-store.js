'use strict';

// Position staffing — Primary/Observer, sign on/request/release, the
// consolidation, and self-coordination lookups (EFSPImplementationGuide.md
// §4.8, WP1A). Net-new: WP0 reconnaissance this session confirmed no
// Position/role concept exists anywhere in crc-sync today — auth.js is
// pure per-user Casdoor OAuth with no role selection, and CRCSYNC_COALITION
// is one global env var, not per-controller (see surveillance/iff.js).
//
// Deliberately ephemeral, like TrackStore/CollaborativeStore — NOT part of
// the durable persistence this Phase adds for Board/flight data state (ADR 0002).
// Guide §4.8.2 rule 5 is explicit: "Primary status is presence state...
// and it MUST NOT enter the durable Mutation log." What IS durable is
// `actingPositionId` stamped onto each Mutation by the Board (board/audit.js) and
// mutation-log.js — never this store's own state.
//
// Positions are NOT signed on from or derived from radar-station selection in
// this implementation (guide's D-9 talks about radar stations, but Ground/
// Clearance Delivery have no associated radar at all) — see the
// implementation plan's decision: a dedicated Position selector in
// crc-desktop calls setSignedOnPositions() with the controller's full
// declared set each time it changes.

const { WALL_CLOCK } = require('../mission-clock');

class PositionStore {
  /**
   * @param {string[]} positionIds — the fixed Position set, e.g. ['OPS','CD','GC','LC'] (a Facility's Position set)
   * @param {object} consolidation — one-hop consolidation map, e.g. { CD:'GC', GC:'LC' } (guide §4.8.6 rule 2's default consolidation, cut where the Facility ends). A Position absent from this map (like OPS) is consolidated nowhere — and OPS is on no chain in the guide's default either.
   */
  constructor(positionIds, consolidation, { clock = WALL_CLOCK, frequencies = {} } = {}) {
    // docs/adr/0105: `{ <Position>: [ { label, mhz } ] }` from the facility config. Data only; nothing here acts on it.
    this._frequencies = frequencies || {};
    // The mission clock (docs/adr/0079) — `since` is who has been signed on at a Position
    // from when, which a controller reads as a time of day.
    this._clock = clock;
    this._positionIds = new Set(positionIds);
    this._consolidation = consolidation || {};
    this._state = new Map(); // positionId -> { primary, observers:[], pendingPrimaryRequest }
    for (const id of positionIds) {
      this._state.set(id, { primary: null, observers: [], pendingPrimaryRequest: null });
    }
    this._sessions = new Map(); // controllerId -> Set(positionId) currently signed on
    // Whether a controller's connection is closed but still within the sign-on grace (ws-hub.js). Such a Primary keeps
    // the Position for a reconnect, but never locks anyone else out: a controller signing on is treated as if the
    // absent one had signed off (docs/wip/DESK-SIGNON.md, S-SIGNON0).
    this._isAbsent = () => false;
  }

  setAbsentCheck(fn) { this._isAbsent = typeof fn === 'function' ? fn : () => false; }

  isStaffed(positionId) {
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

  signedOnBy(controllerId) {
    return [...(this._sessions.get(controllerId) || [])];
  }

  /**
   * Walks the consolidation to its end (guide §4.8.6 rule 3: "If that
   * Position is also unstaffed, follow the consolidation to its end"),
   * returning the first STAFFED Position found, or null if the chain
   * bottoms out with nobody signed on at any link (defect D19's boundary —
   * callers must treat null distinctly from a stranding they failed to
   * detect, not silently swallow it).
   */
  consolidatedAt(positionId) {
    let current = this._consolidation[positionId] || null;
    const seen = new Set([positionId]);
    while (current) {
      if (seen.has(current)) return null; // cycle guard — configuration bug, never a real chain
      seen.add(current);
      if (this.isStaffed(current)) return current;
      current = this._consolidation[current] || null;
    }
    return null;
  }

  /** True when `controllerId` already holds Primary at `positionId` — the Phase-1 self-coordination test (guide §4.8.3). */
  isSelfCoordinated(controllerId, positionId) {
    return this.primaryOf(positionId) === controllerId;
  }

  /** The Positions `controllerId` is PRIMARY at (a controller who only observes a Position has not taken it on). */
  primaryPositionsOf(controllerId) {
    return [...this._state.entries()].filter(([, s]) => s.primary && s.primary.controllerId === controllerId).map(([id]) => id);
  }

  /** A Position's frequencies, `[{label, mhz}]` (a copy). */
  frequenciesOf(positionId) {
    return (this._frequencies[positionId] || []).map(f => ({ ...f }));
  }

  /**
   * What `controllerId` has to monitor: the frequencies of every Position they are Primary at, so a controller who holds
   * LC and GC has both (JO 7210.3 3-3-3). docs/adr/0105.
   * @returns {{positionId:string, label:string, mhz:number}[]}
   */
  frequenciesHeldBy(controllerId) {
    const out = [];
    for (const positionId of this.primaryPositionsOf(controllerId)) for (const f of this.frequenciesOf(positionId)) out.push({ positionId, ...f });
    return out;
  }

  /** The other Positions whose Primary is the same controller as `positionId`'s (a combination, docs/adr/0105). */
  combinedWith(positionId) {
    const c = this.primaryOf(positionId);
    return c ? this.primaryPositionsOf(c).filter(id => id !== positionId) : [];
  }

  getAll() {
    return [...this._state.entries()].map(([positionId, s]) => ({
      positionId,
      frequencies: this.frequenciesOf(positionId),
      combinedWith: this.combinedWith(positionId),
      primary: s.primary,
      observers: [...s.observers],
      pendingPrimaryRequest: s.pendingPrimaryRequest,
      consolidatedPositions: [...this._positionIds].filter(
        id => id !== positionId && !this.isStaffed(id) && this.consolidatedAt(id) === positionId
      ),
    }));
  }

  /**
   * A controller declares the FULL set of Positions they are signed on at this session
   * (the dedicated Position selector, not derived from radar stations —
   * see the module comment). Diffs against what they were signed on at:
   * newly-added Positions are signed on (Primary if unstaffed, else
   * Observer); removed ones are signed off (§4.8.6 vacate handling, non-
   * abrupt — an Observer promotion, if any, is offered as an explicit
   * prompt by the caller, not auto-applied here; see releasePrimaryTo()).
   *
   * @returns {{signedOn:string[], vacated:string[]}} — `vacated` is what the
   *   caller (index.js/efsp-ws.js) should check against the Board's
   *   (board-store.js) Strip counts to build the "this would strand N Strips" warning
   *   (guide §4.8.6 rule 5 — warn, never block).
   */
  setSignedOnPositions(controllerId, controllerName, signedOnPositionIds, now = this._clock.now()) {
    const valid = signedOnPositionIds.filter(id => this._positionIds.has(id));
    const before = this._sessions.get(controllerId) || new Set();
    const after = new Set(valid);

    const vacated = [];
    for (const id of before) {
      if (!after.has(id)) {
        this._signOff(controllerId, id, { abrupt: false });
        vacated.push(id);
      }
    }
    for (const id of after) {
      if (!before.has(id)) this._signOn(controllerId, controllerName, id, now);
    }

    if (after.size > 0) this._sessions.set(controllerId, after);
    else this._sessions.delete(controllerId);

    return { signedOn: [...after], vacated };
  }

  _signOn(controllerId, controllerName, positionId, now) {
    const s = this._state.get(positionId);
    if (s.primary && s.primary.controllerId !== controllerId && this._isAbsent(s.primary.controllerId)) {
      // The held entry for this Position ends: the absent Primary signs off abruptly (the longest-waiting Observer, if any, is promoted).
      const gone = s.primary.controllerId;
      this._signOff(gone, positionId, { abrupt: true });
      const held = this._sessions.get(gone);
      if (held) { held.delete(positionId); if (held.size === 0) this._sessions.delete(gone); }
    }
    if (!s.primary) {
      s.primary = { controllerId, controllerName, since: now };
    } else if (s.primary.controllerId !== controllerId) {
      // Selecting an already-Primary'd Position makes the selector an
      // Observer (guide §4.8.2 rule 3) — never a second Primary (D18).
      if (!s.observers.some(o => o.controllerId === controllerId)) {
        s.observers.push({ controllerId, controllerName, since: now });
      }
    }
    // s.primary.controllerId === controllerId already: idempotent re-sign-on, no-op.
  }

  /** An Observer requests Primary (guide §4.8.2 rule 3) — delivered to the current Primary; requires their release via releasePrimaryTo(). Never auto-promotes. */
  requestPrimary(controllerId, positionId, now = this._clock.now()) {
    const s = this._state.get(positionId);
    if (!s || !s.primary) return { ok: false, reason: 'NOT_STAFFED' };
    if (s.primary.controllerId === controllerId) return { ok: false, reason: 'ALREADY_PRIMARY' };
    if (!s.observers.some(o => o.controllerId === controllerId)) return { ok: false, reason: 'NOT_OBSERVER' };
    s.pendingPrimaryRequest = { controllerId, requestedAt: now };
    return { ok: true };
  }

  /** The current Primary explicitly releases Primary to a requesting Observer — a prompt, never automatic (guide §4.8.6 rule 1). */
  releasePrimaryTo(positionId, toControllerId, now = this._clock.now()) {
    const s = this._state.get(positionId);
    if (!s || !s.primary) return { ok: false, reason: 'NOT_STAFFED' };
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
   *   unstaffed — the caller offers Observer promotion as an explicit
   *   prompt, not this store's job.
   */
  _signOff(controllerId, positionId, { abrupt }) {
    const s = this._state.get(positionId);
    if (!s) return;
    if (s.primary && s.primary.controllerId === controllerId) {
      if (abrupt && s.observers.length > 0) {
        const next = s.observers.shift(); // longest-waiting = earliest added
        s.primary = { controllerId: next.controllerId, controllerName: next.controllerName, since: this._clock.now() };
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

  /** Abrupt disconnect — signs the controller off every Position they were signed on at, auto-promoting where possible (guide §4.8.6 rule 1). */
  onDisconnect(controllerId) {
    const signedOn = this._sessions.get(controllerId) || new Set();
    for (const id of signedOn) this._signOff(controllerId, id, { abrupt: true });
    this._sessions.delete(controllerId);
  }
}

module.exports = { PositionStore };
