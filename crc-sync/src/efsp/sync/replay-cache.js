'use strict';

// The one idempotency cache (S3-1, docs/adr/0081): one class, two shapes, each kept exactly as it was.
//
// - The families' cache (the default; one instance per createEfsp, `ctx.replayCache`, called by wire/skeleton.js):
//   keyed `kind|cmid`, the kind checked against the wire families' REPLAY_KINDS, compact records whose absent fields
//   stay `undefined` (so they drop out of the JSON ack). Memory only.
// - A Board's cache (`ReplayCache.forBoard()`, one per BoardStore, consulted inside applyMutation): keyed by cmid
//   alone, the frozen record `replayRecord()` builds (absent fields `null`), the last REPLAY_PERSIST_WINDOW_MS of it
//   persisted in the Board snapshot (board/persistence.js) and loaded back whole on restore.
//
// Both: a non-string or empty clientMutationId is never cached, and past the cap the oldest entry goes.

// ── the families' shape ──
//
// Idempotency for the non-Board dispatch paths (guide §5.2, docs/adr/0081;
// L6's F13). BoardStore keeps its own cache inside applyMutation (a forBoard instance); the
// airspace, correlation, MARSA and runway-status paths had none, so a retried
// message was applied and audited a second time — and a retried DeclareMarsa
// minted a second relation.
//
// Holds COMPACT records only ({ ok, reason, detail, warning, id }): never a
// live store record, never a clone of one. A replay answers with the original
// outcome and the record as it is NOW, read from the store's own getter, so a
// retried refusal cannot hand a client an older record than it already holds
// (F11's lesson), and nothing here keeps a retired record alive (F4's).
//
// Memory only (decisions S-W3d, L27-Q3 (a)): these ops are rev-checked and
// rarely retried across a restart. Pure: the wire family registry, which names the kinds, is required on first use
// (so a Board, which needs no kinds, does not load the families).

const REPLAY_CACHE_CAP = 5000;

// ── the Board's shape ──

const APPLIED_MUTATIONS_CAP = 5000;
// How much of the idempotency cache rides in the Board snapshot (docs/adr/0081,
// L6's F5 mode A): a RETRY window, not a history. A client that lost its ack
// to a crash retries within seconds of reconnecting; ten minutes covers a
// restart and a slow reconnect. [SOURCE-DEFINED], a constant rather than a
// tuning value. Wall time, like the NLA latch (ADR 0079's one exception).
const REPLAY_PERSIST_WINDOW_MS = 10 * 60 * 1000;

/**
 * The compact, frozen record the idempotency cache keeps for one applied
 * clientMutationId (docs/adr/0081): the outcome and the ids it concerned.
 * Nothing live and nothing cloned — it is serialisable, which is what lets
 * the last REPLAY_PERSIST_WINDOW_MS of it ride in the Board snapshot.
 * `appliedWallAt` is WALL time (Date.now()): a retry window is a storage
 * lifetime, like the NLA latch, not a time a controller reads (ADR 0079).
 */
function replayRecord(result, appliedWallAt) {
  return Object.freeze({
    ok: !!result.ok,
    reason: result.reason === undefined ? null : result.reason,
    detail: result.detail === undefined ? null : result.detail,
    warning: result.warning === undefined ? null : result.warning,
    routedTo: result.routedTo === undefined ? null : result.routedTo,
    selfCoordinated: result.selfCoordinated === undefined ? null : result.selfCoordinated,
    stripId: result.strip ? result.strip.stripId : null,
    flightDataId: result.flightData ? result.flightData.flightDataId : null,
    peerFacilityId: result.peerFacilityId === undefined ? null : result.peerFacilityId,
    peerStripId: result.peerStrip ? result.peerStrip.stripId : null,
    appliedWallAt,
  });
}

/** The families' compact record: `{ ok, reason, detail, warning, id }`, absent fields `undefined`, id `null`. */
function familyRecord(record) {
  const r = record || {};
  return Object.freeze({
    ok: !!r.ok,
    reason: r.reason === undefined ? undefined : r.reason,
    detail: r.detail === undefined ? undefined : r.detail,
    warning: r.warning === undefined ? undefined : r.warning,
    id: r.id === undefined ? null : r.id,
  });
}

const keyed = (cmid) => typeof cmid === 'string' && cmid !== '';

class ReplayCache {
  /**
   * The families' cache.
   * @param {object} [opts]
   * @param {number} [opts.cap]
   * @param {Iterable<string>} [opts.kinds] the replay kinds; default the wire families' REPLAY_KINDS, read on first use
   */
  constructor({ cap = REPLAY_CACHE_CAP, kinds } = {}) {
    this._cap = cap;
    this._byKind = true;
    this._kinds = kinds ? new Set(kinds) : null;
    this._build = familyRecord;
    this._map = new Map(); // `${kind}|${cmid}` -> frozen record, insertion order
  }

  /** A Board's cache: keyed by cmid alone, records stored as built (replayRecord), no kinds. */
  static forBoard({ cap = APPLIED_MUTATIONS_CAP } = {}) {
    const cache = new ReplayCache({ cap });
    cache._byKind = false;
    cache._build = (record) => record;
    return cache;
  }

  _key(kind, cmid) {
    if (!this._byKind) return cmid;
    if (!this._kinds) this._kinds = new Set(require('../wire/families').REPLAY_KINDS);
    if (!this._kinds.has(kind)) throw new Error(`replay-cache: unknown kind ${kind}`);
    return `${kind}|${cmid}`;
  }

  /** The compact record stored for this clientMutationId, or null. A non-string or empty cmid is never cached. */
  get(kind, cmid) {
    if (!keyed(cmid)) return null;
    return this._map.get(this._key(kind, cmid)) || null;
  }

  /** Whether this clientMutationId is held (no keyed check: a restored record is answered for whatever its key). */
  has(kind, cmid) { return this._map.has(this._key(kind, cmid)); }

  /** Stores the record for this clientMutationId; the oldest entry goes past the cap. */
  set(kind, cmid, record) {
    if (!keyed(cmid)) return;
    const key = this._key(kind, cmid);
    this._map.set(key, this._build(record));
    if (this._map.size > this._cap) this._map.delete(this._map.keys().next().value);
  }

  get size() { return this._map.size; }
  /** The Map itself (key -> record), for tools and tests that measure it. */
  get map() { return this._map; }

  /** `[key, record]` for every record with `appliedWallAt >= horizon`, in insertion order (a Board's persisted window). */
  windowSince(horizon) {
    const out = [];
    for (const [key, record] of this._map) {
      if (record.appliedWallAt >= horizon) out.push([key, record]);
    }
    return out;
  }

  /** Replaces the whole cache with persisted `[key, record]` pairs: no cap, no window, each a frozen copy. */
  load(pairs) {
    this._map = new Map();
    for (const [cmid, record] of (Array.isArray(pairs) ? pairs : [])) {
      if (typeof cmid === 'string' && record && typeof record === 'object') this._map.set(cmid, Object.freeze({ ...record }));
    }
  }
}

module.exports = { ReplayCache, replayRecord, REPLAY_CACHE_CAP, APPLIED_MUTATIONS_CAP, REPLAY_PERSIST_WINDOW_MS };
