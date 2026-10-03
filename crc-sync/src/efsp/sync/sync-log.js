'use strict';

// One sync mechanism for every EFSP store (S3-1, docs/adr/0095): the sequence, and for a store that asks for them
// the ring, the touched-since-drain set and the epoch. The Board (board/board-state.js) turns all three on; the
// other stores keep a counter only, which is the default. A ring, a touched set or an epoch nobody asked for would
// change output: an epoch is a `crypto.randomUUID()` call (seeded in the soak and the freeze host, so one extra
// call renumbers every later id), and a touched set nobody drains grows for the process lifetime.

const crypto = require('crypto');

// The ring is pruned back to RING_KEEP entries once it exceeds RING_MAX.
const RING_MAX = 2000;
const RING_KEEP = 1000;

// The Board's ring buffer is pruned back to ~1000 entries
// once it exceeds 2000 (see _prune) — stay comfortably inside that
// before declaring a reconnecting client TOO_OLD and sending a full
// snapshot instead of a delta. Two paths only, per guide §5.6.
const RESYNC_RING_WINDOW = 900;

class SyncLog {
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.ring] keep the `[{seq, type, id}]` ring a delta resync is served from
   * @param {boolean} [opts.touched] keep the touched-since-drain set
   * @param {boolean} [opts.epoch] mint an epoch now and on newEpoch()
   */
  constructor({ ring = false, touched = false, epoch = false } = {}) {
    this._seq = 0;
    this._ring = ring ? [] : null; // [{seq, type:'update'|'gone', id}]
    // The Board lifetime a seq belongs to (docs/adr/0081, L6's F2). `_seq` and
    // the `_log` ring are per process and deliberately not persisted, so a
    // seq from before a restart means nothing after it — and once the new
    // lifetime's seq overtakes a client's, nothing but a name for the lifetime
    // can tell the two apart. Minted again by restore(); never persisted.
    this._epoch = epoch ? crypto.randomUUID() : null;
    // Every Strip a Board event touched since efsp-ws.js last drained it
    // (docs/adr/0081, guide §5.4 "one Board event"). A rebalance re-keys
    // Strips the Mutation never named, and a coordination op touches the PEER
    // Board inside the sender's applyMutation; whoever broadcasts a Board's
    // change drains this, so every touched Strip rides in that broadcast.
    this._touched = touched ? new Set() : null;
    this._observers = [];
  }

  get seq() { return this._seq; }
  get epoch() { return this._epoch; }
  /** The ring itself (null for a counter-only log). Read-only use. */
  get ring() { return this._ring; }

  /** One change on a store without a ring: the sequence moves on. */
  advance() {
    this._seq += 1;
    return this._seq;
  }

  /**
   * One record changed: a ring entry (when kept), the touched set (when kept), then every observer, synchronously,
   * in registration order.
   */
  touch(id) {
    this._append('update', id);
    if (this._touched) this._touched.add(id);
    this._prune();
    for (const fn of this._observers) fn(id);
  }

  /** Whether anything was touched since the last drain (without draining). */
  hasTouched() { return !!this._touched && this._touched.size > 0; }

  /** A `gone` entry for a record that left the store: it advances the seq like a touch, but is not a touch. */
  gone(id) {
    this._append('gone', id);
    this._prune();
  }

  _append(type, id) {
    if (this._ring) this._ring.push({ seq: ++this._seq, type, id });
    else this._seq += 1;
  }

  _prune() {
    if (this._ring && this._ring.length > RING_MAX) this._ring.splice(0, this._ring.length - RING_KEEP);
  }

  /**
   * The ids of every Strip touched since the last drain, in first-touch
   * order, and forgets them. Called by whoever puts this Board's change on the
   * wire (efsp-ws.js), on this Board and on the peer Board a coordination op
   * reached — never by the Board itself (docs/adr/0081).
   * @returns {string[]}
   */
  drainTouched() {
    const ids = [...this._touched];
    this._touched.clear();
    return ids;
  }

  /**
   * Delta resync (guide §5.6) — everything changed since `afterSeq`, within
   * this Board lifetime. `updated` holds the Strips still in `_strips`
   * (DROPPED ones included — the caller turns those into `gone`); `gone` holds
   * ids the window touched that are no longer in `_strips` at all. That is
   * always empty until retention removes records (L24, S-R2-13); this is the
   * seam it fills (docs/adr/0081).
   * @param {number} afterSeq
   * @param {(id: string) => object|undefined} lookup the record as it is now, or undefined when it is gone
   */
  deltaSince(afterSeq, lookup) {
    const entries = [];
    for (let i = this._ring.length - 1; i >= 0; i--) {
      if (this._ring[i].seq <= afterSeq) break;
      entries.unshift(this._ring[i]);
    }
    const byId = new Map();
    for (const e of entries) byId.set(e.id, e);
    const updated = [];
    const gone = []; // touched in the window and no longer on the Board: archived (docs/adr/0082)
    for (const e of byId.values()) {
      const record = lookup(e.id);
      if (record !== undefined) updated.push(record);
      else gone.push(e.id);
    }
    return { updated, gone, seq: this._seq };
  }

  /** A new lifetime: a new epoch. The seq, the ring and the touched set are kept. */
  newEpoch() { this._epoch = crypto.randomUUID(); }

  /**
   * `fn(id)` after every touch (not after a `gone`), synchronously, after the ring entry.
   * @returns {() => void} removes the observer
   */
  observeTouches(fn) {
    this._observers.push(fn);
    return () => { const i = this._observers.indexOf(fn); if (i >= 0) this._observers.splice(i, 1); };
  }
}

/**
 * Whether a delta from `lastSeq` would leave this client right. Three ways it
 * cannot, each found the hard way.
 *
 * A different Board LIFETIME (docs/adr/0081, L6's F2). `_seq` and the ring are
 * per process, so after a restart a client's seq names a point in a Board that
 * no longer exists. Once the new lifetime's seq overtakes it, the window and
 * `rewound` checks below both pass and a delta from the wrong ring is served
 * as if continuous: Strips dropped before the restart stay on screen, Strips
 * created are missed. Only the epoch the client last saw can tell. A client
 * that sends none (the shipped client never resyncs, briefing §3.10) gets the
 * snapshot, which is always safe.
 *
 * The client too far BEHIND: `currentSeq - lastSeq > WINDOW` — it missed more
 * than the ring holds, so replaying from there would skip changes.
 *
 * The server having gone BACKWARDS: `lastSeq > currentSeq`. It restarted with
 * no snapshot, or was restored from an older one. The subtraction then went
 * NEGATIVE and sailed through the window check — the server replayed a delta
 * from an empty ring and told a client holding a whole Board of Strips that
 * nothing had changed. Found by clearing the local Board during development
 * and watching a Strip survive it. The epoch now covers this case too; the
 * check stays because it is cheap and still true.
 * @param {{seq: number, epoch: string|null}} current the store's seq and epoch now
 */
function canServeDelta(current, boardEpoch, lastSeq) {
  if (boardEpoch !== current.epoch) return false;
  if (lastSeq < 0) return false;
  if (lastSeq > current.seq) return false; // rewound
  return current.seq - lastSeq <= RESYNC_RING_WINDOW;
}

module.exports = { SyncLog, canServeDelta, RESYNC_RING_WINDOW, RING_MAX, RING_KEEP };
