'use strict';

// What controllers have said about contacts, shared by all of them: IFF
// declarations and tags (a name for a contact nothing else identifies —
// docs/adr/0059). In memory; a mission reload wipes it for everybody.
//
// Track numbers are not here any more: every contact gets one from
// surveillance/track-numbers.js whether or not anybody has touched it.
//
// Nothing needs a change log: ws-hub.js re-describes every contact each tick
// and sees a change by comparing (surveillance/presentation.js).

const { IFF_STATES } = require('./surveillance/iff');

class CollaborativeStore {
  constructor() {
    this._overlay = new Map(); // id (string) -> { id, iff, rename }
  }

  get(id) { return this._overlay.get(String(id)) || null; }

  _entry(id) {
    const key = String(id);
    let e = this._overlay.get(key);
    if (!e) {
      e = { id: key, iff: null, rename: null };
      this._overlay.set(key, e);
    }
    return e;
  }

  // Drops an entry entirely once it is empty, so evictStale does not carry
  // empty husks forever.
  _dropIfEmpty(id) {
    const key = String(id);
    const e = this._overlay.get(key);
    if (e && !e.iff && !e.rename) this._overlay.delete(key);
  }

  // ── IFF declaration ───────────────────────────────────────────────────────

  declare(id, state, by) {
    if (!IFF_STATES.includes(state)) return null;
    const e = this._entry(id);
    e.iff = { state, by: by || null, at: Date.now() };
    return e;
  }

  clearDeclare(id) {
    const e = this._overlay.get(String(id));
    if (!e || !e.iff) return;
    e.iff = null;
    this._dropIfEmpty(id);
  }

  // ── Tag ────────────────────────────────────────────────────────────────────

  rename(id, value, by) {
    const clean = String(value || '').trim().toUpperCase();
    if (!clean) return this.clearRename(id);
    const e = this._entry(id);
    e.rename = { value: clean, by: by || null, at: Date.now() };
    return e;
  }

  clearRename(id) {
    const e = this._overlay.get(String(id));
    if (!e || !e.rename) return;
    e.rename = null;
    this._dropIfEmpty(id);
  }

  // ── Mission reload ────────────────────────────────────────────────────────

  clear() { this._overlay.clear(); }

  // ── Stale-track eviction ─────────────────────────────────────────────────
  // Called from the same tick as TrackStore's stale-reaper. Without this, a
  // declared or tagged track that despawns leaves its entry orphaned forever,
  // and a later track reusing the same DCS unit id would silently inherit a
  // declaration nobody made for it.

  evictStale(activeTrackIds) {
    let count = 0;
    for (const id of [...this._overlay.keys()]) {
      if (!activeTrackIds.has(id)) {
        this._overlay.delete(id);
        count++;
      }
    }
    return count;
  }

  getAll() { return [...this._overlay.values()]; }
}

module.exports = CollaborativeStore;
