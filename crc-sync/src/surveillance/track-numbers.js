'use strict';

// Every contact in the picture gets a track number, the name it goes by until
// something better identifies it (docs/adr/0059). Sequential and minted on
// first ask; it stays with the contact until the contact leaves, and a
// mission reload starts the count again.

const MAX = 99999;

class TrackNumbers {
  constructor() {
    this._byTrack = new Map(); // trackId -> 'TN00042'
    this._inUse = new Set();
    this._next = 1;
  }

  get(trackId) {
    const id = String(trackId);
    const held = this._byTrack.get(id);
    if (held) return held;
    for (let i = 0; i < MAX; i++) {
      const tn = `TN${String(this._next).padStart(5, '0')}`;
      this._next = this._next >= MAX ? 1 : this._next + 1;
      if (this._inUse.has(tn)) continue;
      this._inUse.add(tn);
      this._byTrack.set(id, tn);
      return tn;
    }
    return null;
  }

  /** Forgets every contact that is no longer live. */
  retain(liveIds) {
    for (const [id, tn] of [...this._byTrack]) {
      if (liveIds.has(id)) continue;
      this._byTrack.delete(id);
      this._inUse.delete(tn);
    }
  }

  clear() {
    this._byTrack.clear();
    this._inUse.clear();
    this._next = 1;
  }
}

module.exports = { TrackNumbers };
