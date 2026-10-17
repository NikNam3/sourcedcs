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
   * @param {{consolidation?:object, handBack?:object}} maps — `consolidation`: who is offered a Position's hat, in order, e.g. { CD:['GC','LC','AP'] } (docs/adr/0110; read, never walked); `handBack`: the TACTICAL one-hop reassignment, e.g. { AIC:'TAC_C2' }. A Position in neither (like OPS) has nobody to take it.
   */
  constructor(positionIds, { consolidation = {}, handBack = {} } = {}, { clock = WALL_CLOCK, frequencies = {}, isAbsent = () => false } = {}) {
    // docs/adr/0105: `{ <Position>: [ { label, mhz } ] }` from the facility config. Data only; nothing here acts on it.
    // A function is read at every use, so the runtime frequency table's changes show at once (docs/adr/0131).
    this._frequencies = frequencies || {};
    // The mission clock (docs/adr/0079) — `since` is who has been signed on at a Position
    // from when, which a controller reads as a time of day.
    this._clock = clock;
    this._positionIds = new Set(positionIds);
    this._consolidation = consolidation;
    this._handBack = handBack;
    this._state = new Map(); // positionId -> { primary, observers:[], pendingPrimaryRequest }
    for (const id of positionIds) {
      this._state.set(id, { primary: null, observers: [], pendingPrimaryRequest: null });
    }
    this._sessions = new Map(); // controllerId -> Set(positionId) currently signed on
    // Whether a controller's connection is closed but still within the sign-on grace (ws-hub.js). Such a Primary keeps
    // the Position for a reconnect, but never locks anyone else out: a controller signing on is treated as if the
    // absent one had signed off (docs/wip/DESK-SIGNON.md, S-SIGNON0).
    this._isAbsent = isAbsent;
    // Positions whose absent Primary a sign-on ended (the takeover): read once by the caller that owns the sign-off's effects.
    this._takenOver = [];
  }

  /** The Positions whose held (absent) Primary a sign-on has ended since the last call. */
  drainTakenOver() { const out = this._takenOver; this._takenOver = []; return out; }

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
   * The Position that covers `positionId` while it is unstaffed, or null: the first member of its `consolidation` list that
   * is staffed (docs/adr/0110: read, never walked), else its `handBack` target when that is staffed (TACTICAL). null is
   * defect D19's boundary: callers treat it as "nobody to offer or route to", never swallow it. A Primary inside the
   * sign-on grace counts as staffed.
   */
  consolidatedAt(positionId) {
    return this.hatTakerOf(positionId) || this.handBackTo(positionId);
  }

  /** The first member of `positionId`'s `consolidation` list that is staffed: who is offered its hat. null when none is (or it has no list). */
  hatTakerOf(positionId) {
    for (const id of this._consolidation[positionId] || []) if (this.isStaffed(id)) return id;
    return null;
  }

  /** The Facility's Position ids. */
  positionIds() { return [...this._positionIds]; }

  /** The staffed `handBack` target of `positionId` (TACTICAL: its Strips are reassigned there), or null. */
  handBackTo(positionId) {
    const to = this._handBack[positionId];
    return to && this.isStaffed(to) ? to : null;
  }

  /** True when `positionId` is a `handBack` source: its Strips move rather than wait for the hat. */
  hasHandBack(positionId) { return Object.prototype.hasOwnProperty.call(this._handBack, positionId); }

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
    const all = typeof this._frequencies === 'function' ? this._frequencies() : this._frequencies;
    return ((all && all[positionId]) || []).map(f => ({ ...f }));
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
      else this._promoteObserver(controllerId, id, now);
    }

    if (after.size > 0) this._sessions.set(controllerId, after);
    else this._sessions.delete(controllerId);

    return { signedOn: [...after], vacated };
  }

  /**
   * Declaring a Position this controller already observes, when it has no Primary, makes them its Primary (guide §4.8.2
   * rule 2; docs/adr/0110 §3, finding F1: an Observer left behind by a normal sign-off had no way to take over). Never when
   * there is a Primary: that is a request (requestPrimary), not a declaration.
   */
  _promoteObserver(controllerId, positionId, now) {
    const s = this._state.get(positionId);
    if (!s || s.primary) return;
    const me = s.observers.find(o => o.controllerId === controllerId);
    if (!me) return;
    s.observers = s.observers.filter(o => o !== me);
    s.primary = { controllerId, controllerName: me.controllerName, since: now };
    s.pendingPrimaryRequest = null;
  }

  _signOn(controllerId, controllerName, positionId, now) {
    const s = this._state.get(positionId);
    if (s.primary && s.primary.controllerId !== controllerId && this._isAbsent(s.primary.controllerId)) {
      // The held entry for this Position ends: the absent Primary signs off abruptly (the longest-waiting Observer, if any, is promoted).
      const gone = s.primary.controllerId;
      this._signOff(gone, positionId, { abrupt: true });
      this._takenOver.push(positionId);
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
    const vacated = [...signedOn];
    for (const id of vacated) this._signOff(controllerId, id, { abrupt: true });
    this._sessions.delete(controllerId);
    return { vacated };
  }
}

module.exports = { PositionStore };
