'use strict';

// One sync cursor for everything that has a position on the server (DESK-SYNC, docs/wip/ARCH-C.md §1.4):
// each Facility's Board (`board:<facilityId>`, crc-sync docs/adr/0081, 0104) and each of the six stores outside
// the Board (`store:<key>`, docs/adr/0106). A cursor is `{ seq, epoch }` (a seq only means something inside one
// lifetime, the epoch) plus how many heartbeats in a row named a seq ahead of ours. Bookkeeping only: this module
// holds the positions, the heartbeat-gap rule and the one-request-in-flight rule, and sends nothing.
//
// A leaf on purpose (it imports nothing). efsp-state.js adopts positions from frames, efsp-ws.js asks for resyncs.

export const RESYNC_RETRY_HEARTBEATS = 10; // 5 s at the server's 500 ms beat

export const boardCursorName = (facilityId) => `board:${facilityId}`;
export const storeCursorName = (key) => `store:${key}`;

const _cursors = new Map();   // name -> { seq, epoch, behind }
const _inFlight = new Map();  // name -> heartbeats waited since its resync went out

/** Forget every position and every request in flight (a snapshot replaces all of them). */
export function clearCursors() { _cursors.clear(); _inFlight.clear(); }

/** Sets a cursor's position; a field left out keeps its value. Does not touch the heartbeat count. */
export function adoptCursor(name, { seq, epoch }) {
  const c = _cursors.get(name) || { seq: undefined, epoch: undefined, behind: 0 };
  if (seq !== undefined) c.seq = seq;
  if (epoch !== undefined) c.epoch = epoch;
  _cursors.set(name, c);
}

/** A slice or snapshot landed: position replaced, heartbeat count reset. */
export function replaceCursor(name, { seq, epoch }) { _cursors.set(name, { seq, epoch, behind: 0 }); }

/** Where this client stands: `{ seq, epoch }`, or null when nothing named it. */
export function getCursor(name) { const c = _cursors.get(name); return c ? { seq: c.seq, epoch: c.epoch } : null; }

/** A frame's epoch differs from the lifetime we hold: the server restarted (or restored), our seq names a point that no longer exists. */
export function epochMoved(name, epoch) {
  const c = _cursors.get(name);
  return !!c && c.epoch !== undefined && epoch !== undefined && epoch !== c.epoch;
}

/**
 * A store's delta or ack names its position (`seq` + `epoch`). Call BEFORE applying it. Another epoch is another
 * lifetime; a seq more than one ahead of ours, on a store that declares `gapFromDeltas` (the server's word that a
 * delta moves seq by exactly one change), is a delta we never received. Either way the position is NOT adopted and
 * true is returned (resync). On a store without `gapFromDeltas` a jump is left for the heartbeat (adopting it would
 * hide the loss). A frame without a seq (a supplement) changes nothing.
 */
export function storeFrameGap(name, { seq, epoch, gapFromDeltas }) {
  const c = _cursors.get(name);
  if (!c || !Number.isFinite(seq)) return false;
  if (epochMoved(name, epoch)) return true;
  if (seq > c.seq + 1) return !!gapFromDeltas;
  if (seq > c.seq) c.seq = seq;
  return false;
}

/**
 * An efsp-heartbeat names every position this session is sent: `boards: { [facilityId]: { seq, epoch } }` and
 * `stores: { [key]: { seq, epoch } }`. Deltas arrive in order on one socket, so after each the two must be equal:
 * ahead means a change reached us in no delta (a Board's seq jumps by more than one per change, so only the
 * heartbeat can tell). Ahead on two beats in a row, so a delta in flight is not a gap; another epoch at once. A
 * cursor we hold no position for is ignored (the connect snapshot names it).
 * @returns {string[]} the cursor names to resync
 */
export function heartbeatGaps(msg) {
  const out = [];
  const beats = [[boardCursorName, msg && msg.boards], [storeCursorName, msg && msg.stores]];
  for (const [nameOf, named] of beats) {
    for (const [id, b] of Object.entries(named || {})) {
      const name = nameOf(id);
      const c = _cursors.get(name);
      if (!c || !b || c.seq === undefined) { if (c) c.behind = 0; continue; }
      if (epochMoved(name, b.epoch)) { out.push(name); continue; }
      if (!Number.isFinite(b.seq) || b.seq <= c.seq) { c.behind = 0; continue; }
      c.behind++;
      if (c.behind >= 2) out.push(name);
    }
  }
  return out;
}

/** What an efsp-resync for this cursor must say, or null when we hold no position for it. */
export function resyncPositionOf(name) {
  const c = _cursors.get(name);
  if (!c) return null;
  if (name.startsWith('board:')) {
    if (c.epoch === undefined) return null;
    return { facilityId: name.slice('board:'.length), lastBoardSeq: c.seq, boardEpoch: c.epoch };
  }
  return { stores: { [name.slice('store:'.length)]: { lastSeq: c.seq, epoch: c.epoch } } };
}

/** At most one resync per cursor in flight: false when one already is. */
export function beginResync(name) {
  if (_inFlight.has(name)) return false;
  _inFlight.set(name, 0);
  return true;
}
/** Its answer landed (or the snapshot that makes it moot). With no name: every request; with a prefix (`'store:'`): that kind. */
export function endResync(name) { _inFlight.delete(name); }
export function endResyncs(prefix = '') { for (const n of [..._inFlight.keys()]) if (n.startsWith(prefix)) _inFlight.delete(n); }
/** Each heartbeat ages the requests in flight; a lost answer is dropped (so the next gap asks again) after RESYNC_RETRY_HEARTBEATS. */
export function ageResyncs() {
  for (const [n, waited] of _inFlight) {
    if (waited + 1 >= RESYNC_RETRY_HEARTBEATS) _inFlight.delete(n); else _inFlight.set(n, waited + 1);
  }
}
