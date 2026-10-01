'use strict';

// Idempotency for the non-Board dispatch paths (guide §5.2, docs/adr/0081;
// L6's F13). BoardStore keeps its own cache inside applyMutation; the
// airspace, correlation, MARSA and field-state paths had none, so a retried
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
// rarely retried across a restart. Pure: no requires.

const REPLAY_CACHE_CAP = 5000;
const KINDS = new Set(['airspace', 'correlation', 'marsa', 'fieldState', 'carrier']);

class ReplayCache {
  constructor({ cap = REPLAY_CACHE_CAP } = {}) {
    this._cap = cap;
    this._map = new Map(); // `${kind}|${cmid}` -> frozen record, insertion order
  }

  _key(kind, cmid) {
    if (!KINDS.has(kind)) throw new Error(`replay-cache: unknown kind ${kind}`);
    return `${kind}|${cmid}`;
  }

  /** The compact record stored for this clientMutationId, or null. A non-string or empty cmid is never cached. */
  get(kind, cmid) {
    if (typeof cmid !== 'string' || cmid === '') return null;
    return this._map.get(this._key(kind, cmid)) || null;
  }

  /** Stores `{ ok, reason, detail, warning, id }` for this clientMutationId; the oldest entry goes past the cap. */
  set(kind, cmid, record) {
    if (typeof cmid !== 'string' || cmid === '') return;
    const key = this._key(kind, cmid);
    const r = record || {};
    this._map.set(key, Object.freeze({
      ok: !!r.ok,
      reason: r.reason === undefined ? undefined : r.reason,
      detail: r.detail === undefined ? undefined : r.detail,
      warning: r.warning === undefined ? undefined : r.warning,
      id: r.id === undefined ? null : r.id,
    }));
    if (this._map.size > this._cap) this._map.delete(this._map.keys().next().value);
  }

  get size() { return this._map.size; }
}

module.exports = { ReplayCache, REPLAY_CACHE_CAP };
