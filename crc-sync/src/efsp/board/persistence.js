'use strict';

// The Board's persistence (docs/adr/0095, H87): the snapshot and restore, the archive of a DROPPED Strip, when each
// DROPPED Strip dropped, and the persisted window of the Board's idempotency cache (sync/replay-cache.js). BoardStore delegates to it.
//
// `nlaHistory` is read late: it is the facade's. The `droppedWallAt` Map is this object's; restore() replaces it,
// so StripOps reads it late through this object.

const { REPLAY_PERSIST_WINDOW_MS } = require('../sync/replay-cache');

class BoardPersistence {
  /**
   * @param {object} deps
   * @param {object} deps.rules the Board's rules (facilityId)
   * @param {import('./board-state').BoardState} deps.state
   * @param {import('../sync/replay-cache').ReplayCache} deps.replay the Board's idempotency cache
   * @param {{now: () => number}} deps.clock the mission clock
   * @param {{now: () => number}} deps.wallClock real time: the drop stamp and the replay window
   * @param {object} deps.audit BoardAudit (the Archive entry)
   * @param {() => Map} deps.nlaHistory the facade's NLA history, read late
   */
  constructor({ rules, state, replay, clock, wallClock, audit, nlaHistory }) {
    this._rules = rules;
    this._state = state;
    this._replay = replay;
    this._clock = clock;
    this._wallClock = wallClock; // docs/adr/0096
    this._audit = audit;
    this._nlaHistoryOf = nlaHistory;
    // stripId -> Date.now() at its drop: when a DROPPED Strip is archived
    // (docs/adr/0082, H36). Wall time on purpose, like the NLA latch (board/ops/invoke-nla.js): a
    // retention period is a storage lifetime, and the mission clock rewinds on
    // a reload (H11). Not a Strip field, so the wire is unchanged. Persisted.
    this._droppedWallAt = new Map();
  }

  get _nlaHistory() { return this._nlaHistoryOf(); }
  /** stripId -> wall ms of its drop (replaced by restore(), so read it through this getter). */
  get droppedWallAt() { return this._droppedWallAt; }

  /**
   * When this DROPPED Strip dropped, in wall ms (docs/adr/0082). A Strip that
   * reached DROPPED by a path other than `StripOps#retire` (board/strip-ops.js) (a refused TOFI's minted
   * Strip, a SetState) is stamped the first time anyone asks, so it is
   * archived at most one sweep late rather than never. Null for a live Strip.
   */
  droppedWallAtOf(stripId) {
    const strip = this._state.strips.get(stripId);
    if (!strip || strip.state !== 'DROPPED') {
      this._droppedWallAt.delete(stripId);
      return null;
    }
    if (!this._droppedWallAt.has(stripId)) this._droppedWallAt.set(stripId, this._wallClock.now());
    return this._droppedWallAt.get(stripId);
  }

  /**
   * Archives one DROPPED Strip (docs/adr/0082, H36): it leaves memory and the
   * snapshot, and the Mutation log keeps its history. Nothing archived comes
   * back — an Undo of its drop is NOT_FOUND, like any Mutation on it. The
   * archiver (archiver.js) decides WHEN; this only does it.
   *
   * The ring gets a `gone` entry, so the archive advances the Board's seq and
   * a resync from before it reports the Strip in getDeltaSince's `gone`.
   * @param {string} stripId
   * @param {string} reason 'AGE' | 'MISSION_CHANGE'
   * @param {object} [extra] fields added to the audit line (e.g. the session)
   * @returns {string|null} the Strip's flightDataId, or null when it was not a DROPPED Strip here
   */
  archiveStrip(stripId, reason, extra = {}) {
    const strip = this._state.strips.get(stripId);
    if (!strip || strip.state !== 'DROPPED') return null;
    this._state.strips.delete(stripId);
    this._droppedWallAt.delete(stripId);
    this._nlaHistory.delete(stripId);
    this._state.logGone(stripId);
    // L26 (decisions.md S-L5) puts facilityId on every Board entry; this line carries it from the start.
    this._audit.recordSystem('Archive', strip, { reason, ...extra }, { flightDataFirst: true });
    return strip.flightDataId || null;
  }

  // ── Persistence (durable per ADR 0002 — mission reload must NOT clear this) ──
  snapshot() {
    // `replay`: the idempotency records of the last REPLAY_PERSIST_WINDOW_MS,
    // so a retry after a restart answers from the cache instead of applying a
    // second time (docs/adr/0081, L6's F5 mode A). Compact records only.
    const horizon = this._wallClock.now() - REPLAY_PERSIST_WINDOW_MS;
    const replay = this._replay.windowSince(horizon);
    return { strips: this._state.all(), cidSeq: this._state.cidSeq, replay, droppedWallAt: [...this._droppedWallAt] };
  }
  restore(data) {
    // The shape snapshot() writes, and only that (ARCH-D5, H88): a snapshot with a part missing, or a Strip from
    // before docs/adr/0045, is an old file and stops start-up. Nothing is defaulted or dropped quietly.
    const where = `Board ${this._rules.facilityId || ''} snapshot`.replace('  ', ' ');
    if (!data || !Array.isArray(data.strips) || !Number.isFinite(data.cidSeq) || !Array.isArray(data.replay) || !Array.isArray(data.droppedWallAt)) {
      throw new Error(`[efsp] the ${where} is not in the current shape (needs strips[], cidSeq, replay[], droppedWallAt[]): delete state/efsp-board.json to start clean`);
    }
    const legacy = data.strips.find(s => 'correlation' in s);
    if (legacy) {
      throw new Error(`[efsp] the ${where}: Strip ${legacy.stripId} still has the per-Strip "correlation" field of docs/adr/0045: delete state/efsp-board.json to start clean`);
    }
    this._state.replaceStrips(new Map(data.strips.map(s => [s.stripId, s])));
    // A restored Board is a new lifetime: the ring and the seq did not come
    // back, so no seq a client holds from before can be served a delta.
    this._state.newEpoch();
    this._state.setCidSeq(data.cidSeq);
    // The persisted slice of the idempotency cache (docs/adr/0081). Loaded whole: the snapshot already cut
    // it to the retry window, and index.js's boot reconcile needs every record
    // that was persisted to tell a persisted Mutation from an unpersisted one.
    // It ages out through the cap and the next snapshot's window.
    this._replay.load(data.replay);
    // docs/adr/0082 — when each DROPPED Strip dropped. Every DROPPED Strip has its entry.
    const dropped = new Map(data.droppedWallAt);
    this._droppedWallAt = new Map();
    for (const strip of this._state.strips.values()) {
      if (strip.state !== 'DROPPED') continue;
      const at = dropped.get(strip.stripId);
      if (!Number.isFinite(at)) throw new Error(`[efsp] the ${where}: DROPPED Strip ${strip.stripId} has no drop time (droppedWallAt): delete state/efsp-board.json to start clean`);
      this._droppedWallAt.set(strip.stripId, at);
    }
  }
}

module.exports = { BoardPersistence };
