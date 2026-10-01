'use strict';

// The Board's kernel (docs/adr/0095): the Strip map, the seq/`_log` ring, the epoch, the touched-since-drain set and
// the cid counter. The facade (board-store.js) and its collaborators read and write Strips through it.
//
// `touch` is the facade's late-bound `(id) => this._touch(id)`, not recordTouch: bump() and insert() go through it so
// whatever is patched onto the facade's _touch (the soak host's touch recorder, tools/soak/host-core.js) still sees
// every touch. The facade's _touch calls recordTouch.

const crypto = require('crypto');

class BoardState {
  /**
   * @param {object} deps
   * @param {{now: () => number}} deps.clock the mission clock (docs/adr/0079)
   * @param {(stripId: string) => void} deps.touch the facade's late-bound touch
   */
  constructor({ clock, touch }) {
    this._clock = clock;
    this._touch = touch;
    this._strips = new Map(); // stripId -> Strip
    this._log = [];           // [{seq, type:'update'|'gone', id}]
    this._seq = 0;
    // The Board lifetime a seq belongs to (docs/adr/0081, L6's F2). `_seq` and
    // the `_log` ring are per process and deliberately not persisted, so a
    // seq from before a restart means nothing after it — and once the new
    // lifetime's seq overtakes a client's, nothing but a name for the lifetime
    // can tell the two apart. Minted again by restore(); never persisted.
    this._epoch = crypto.randomUUID();
    this._cidSeq = 0;
    // Every Strip a Board event touched since efsp-ws.js last drained it
    // (docs/adr/0081, guide §5.4 "one Board event"). A rebalance re-keys
    // Strips the Mutation never named, and a coordination op touches the PEER
    // Board inside the sender's applyMutation; whoever broadcasts a Board's
    // change drains this, so every touched Strip rides in that broadcast.
    this._touchedSinceDrain = new Set();
  }

  /** The Strip map itself (stripId -> Strip). */
  get strips() { return this._strips; }
  /** The `_log` ring (read by the facade's `_log` getter for tools and tests). */
  get log() { return this._log; }
  get seq() { return this._seq; }
  get epoch() { return this._epoch; }
  get cidSeq() { return this._cidSeq; }

  get(stripId) { return this._strips.get(stripId); }
  all() { return [...this._strips.values()]; }

  /** Strips currently placed in a Bay/Rack, in order, excluding DROPPED — a DROPPED Strip stays queryable via getStrip()/getAll() but leaves the visible Board (guide §3.4). */
  rack(bayId, rackId) {
    return this.all()
      .filter(s => s.bayId === bayId && s.rackId === rackId && s.state !== 'DROPPED')
      .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : (a.stripId < b.stripId ? -1 : 1)));
  }

  /** The kernel's touch: the facade's _touch calls this; everything else calls the facade's (late-bound) touch. */
  recordTouch(stripId) {
    this._log.push({ seq: ++this._seq, type: 'update', id: stripId });
    this._touchedSinceDrain.add(stripId);
    this._pruneLog();
  }

  /**
   * One Strip changed by `by`: rev+1, updatedAt from the clock, updatedBy, touch.
   * The four lines used to be repeated at every write site.
   */
  bump(strip, by) {
    strip.rev += 1;
    strip.updatedAt = this._clock.now();
    strip.updatedBy = by || null;
    this._touch(strip.stripId);
  }

  /** A new Strip (created, or a minted replica) joins the Board and is touched. */
  insert(strip) {
    this._strips.set(strip.stripId, strip);
    this._touch(strip.stripId);
  }

  /**
   * The ids of every Strip touched since the last drain, in first-touch
   * order, and forgets them. Called by whoever puts this Board's change on the
   * wire (efsp-ws.js), on this Board and on the peer Board a coordination op
   * reached — never by board-store itself (docs/adr/0081).
   * @returns {string[]}
   */
  drainTouched() {
    const ids = [...this._touchedSinceDrain];
    this._touchedSinceDrain.clear();
    return ids;
  }
  _pruneLog() {
    if (this._log.length > 2000) this._log.splice(0, this._log.length - 1000);
  }

  /** A `gone` entry for an archived Strip: it advances the seq like a touch, but is not a touch. */
  logGone(stripId) {
    this._log.push({ seq: ++this._seq, type: 'gone', id: stripId });
    this._pruneLog();
  }

  /**
   * Delta resync (guide §5.6) — everything changed since `afterSeq`, within
   * this Board lifetime. `updated` holds the Strips still in `_strips`
   * (DROPPED ones included — the caller turns those into `gone`); `gone` holds
   * ids the window touched that are no longer in `_strips` at all. That is
   * always empty until retention removes records (L24, S-R2-13); this is the
   * seam it fills (docs/adr/0081).
   */
  getDeltaSince(afterSeq) {
    const entries = [];
    for (let i = this._log.length - 1; i >= 0; i--) {
      if (this._log[i].seq <= afterSeq) break;
      entries.unshift(this._log[i]);
    }
    const byId = new Map();
    for (const e of entries) byId.set(e.id, e);
    const updated = [];
    const gone = []; // touched in the window and no longer on the Board: archived (docs/adr/0082)
    for (const e of byId.values()) {
      if (this._strips.has(e.id)) updated.push(this._strips.get(e.id));
      else gone.push(e.id);
    }
    return { updated, gone, seq: this._seq };
  }

  nextCid() {
    this._cidSeq += 1;
    // 3-digit, zero-padded, sequential for this store's lifetime —
    // [SOURCE-DEFINED] format for Block 4 (guide §6.2); no real-world
    // format is published. See the implementation plan.
    return String(this._cidSeq).padStart(3, '0');
  }

  // ── restore (the facade's restore() drives these; SYNC moves restore) ──
  replaceStrips(strips) { this._strips = strips; }
  newEpoch() { this._epoch = crypto.randomUUID(); }
  setCidSeq(cidSeq) { this._cidSeq = cidSeq; }
}

module.exports = { BoardState };
