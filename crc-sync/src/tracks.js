'use strict';

// Every DCS unit crc-sync knows about, as DCS reports it: ground truth.
//
// None of this goes to a client as-is. What a controller is told about a
// track is decided by surveillance/presentation.js from what their sensors
// could know (docs/adr/0059); this store is what the server itself works
// from — the radar sweep, correlation, conformance and conflict alerting.

const STALE_MS = 12000; // remove tracks not updated within this window

class TrackStore {
  constructor() {
    this._tracks   = new Map(); // id → track
    this._lastSeen = new Map(); // id → Date.now()
  }

  // Remove tracks whose last update is older than STALE_MS.
  // Returns the number of tracks expired.
  expireStale() {
    const cutoff = Date.now() - STALE_MS;
    let count = 0;
    for (const [id, ts] of this._lastSeen) {
      if (ts < cutoff) {
        this.remove(id);
        count++;
      }
    }
    return count;
  }

  update(unitData) {
    const prev = this._tracks.get(unitData.id);
    const track = {
      id:        unitData.id,
      callsign:  unitData.callsign,
      // The DCS unit name, which is what the mission scripting API finds a
      // unit by (the datalink's lock poll).
      name:      unitData.name || null,
      coalition: unitData.coalition,
      type:      unitData.type,
      lat:       unitData.lat,
      lon:       unitData.lon,
      alt:       unitData.alt,
      heading:   unitData.heading || 0,
      // docs/adr/0058 — null when DCS sent no velocity for this unit.
      course:        Number.isFinite(unitData.course) ? unitData.course : null,         // degrees, grid
      groundSpeed:   Number.isFinite(unitData.groundSpeed) ? unitData.groundSpeed : null, // m/s
      verticalSpeed: Number.isFinite(unitData.verticalSpeed) ? unitData.verticalSpeed : null, // m/s, + is up
      // When this track first appeared — conflict alerting ignores a track too
      // young to have a stable course.
      firstSeenAt: (prev && prev.firstSeenAt) || Date.now(),
      player:    unitData.player,
      category:  unitData.category,
    };
    this._tracks.set(unitData.id, track);
    this._lastSeen.set(unitData.id, Date.now());
  }

  remove(id) {
    this._tracks.delete(id);
    this._lastSeen.delete(id);
  }

  // Called on mission reload.
  clear() {
    this._tracks.clear();
    this._lastSeen.clear();
  }

  getAll() { return [...this._tracks.values()]; }

  // Tolerates either id type: DCS emits numbers, everything keyed off the
  // wire uses strings.
  get(id) {
    return this._tracks.get(id) || this._tracks.get(Number(id)) || this._tracks.get(String(id)) || null;
  }
}

module.exports = TrackStore;
