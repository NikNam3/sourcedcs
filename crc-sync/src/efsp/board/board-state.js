'use strict';

// The Board's kernel (docs/adr/0095): the Strip map, the seq/`_log` ring, the epoch, the touched-since-drain set and
// the cid counter. The facade (board-store.js) and its collaborators read and write Strips through it.
//
// `touch` is the facade's late-bound `(id) => this._touch(id)`, not recordTouch: bump() and insert() go through it so
// whatever is patched onto the facade's _touch (the soak host's touch recorder, tools/soak/host-core.js) still sees
// every touch. The facade's _touch calls recordTouch.

const { SyncLog } = require('../sync/sync-log');

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
    // The seq, the `_log` ring, the epoch and the touched set: the one sync mechanism (sync/sync-log.js, S3-1).
    this._sync = new SyncLog({ ring: true, touched: true, epoch: true });
    this._cidSeq = 0;
  }

  /** The Strip map itself (stripId -> Strip). */
  get strips() { return this._strips; }
  /** The `_log` ring (read by the facade's `_log` getter for tools and tests). */
  get log() { return this._sync.ring; }
  get seq() { return this._sync.seq; }
  get epoch() { return this._sync.epoch; }
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
  recordTouch(stripId) { this._sync.touch(stripId); }

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

  /** The ids of every Strip touched since the last drain, in first-touch order (sync/sync-log.js). */
  drainTouched() { return this._sync.drainTouched(); }

  /** A `gone` entry for an archived Strip: it advances the seq like a touch, but is not a touch. */
  logGone(stripId) { this._sync.gone(stripId); }

  /** Delta resync (guide §5.6) within this Board lifetime (sync/sync-log.js deltaSince). */
  getDeltaSince(afterSeq) { return this._sync.deltaSince(afterSeq, (id) => this._strips.get(id)); }

  /** `fn(stripId)` after every touch (sync/sync-log.js observeTouches). */
  observeTouches(fn) { return this._sync.observeTouches(fn); }

  nextCid() {
    this._cidSeq += 1;
    // 3-digit, zero-padded, sequential for this store's lifetime —
    // [SOURCE-DEFINED] format for Block 4 (guide §6.2); no real-world
    // format is published. See the implementation plan.
    return String(this._cidSeq).padStart(3, '0');
  }

  // ── restore (the facade's restore() drives these; SYNC moves restore) ──
  replaceStrips(strips) { this._strips = strips; }
  newEpoch() { this._sync.newEpoch(); }
  setCidSeq(cidSeq) { this._cidSeq = cidSeq; }
}

module.exports = { BoardState };
