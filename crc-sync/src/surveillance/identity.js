'use strict';

// Who a contact is (docs/adr/0059) — the same answer for every controller.
//
// What a controller's own sensors add (code, altitude, datalink) is per
// session and lives in presentation.js. This is only the part that does not
// depend on which radar is looking:
//
//   1. correlated to a flight: the flight's callsign, from its FDR — the
//      flight plan is where a callsign comes from in the first place.
//      PROVISIONAL is flagged, so a doubtful match still looks doubtful.
//   2. a controller's tag (collab-store rename), for traffic nothing else
//      identifies. A correlated flight's callsign beats it.
//   3. its track number.
//
// Datalink sits between 1 and 2 but is per session, so presentation.js
// applies it.

class Identity {
  /**
   * @param {object} deps
   * @param {{trackIndex:()=>Map}} deps.correlationStore
   * @param {{getFdr:(fdrId:string)=>object|null}} deps.fdrStore
   * @param {{get:(trackId:string)=>object|null}} deps.collab
   * @param {{get:(trackId:string)=>string}} deps.trackNumbers
   */
  constructor({ correlationStore, fdrStore, collab, trackNumbers }) {
    this._correlations = correlationStore;
    this._fdrs = fdrStore;
    this._collab = collab;
    this._trackNumbers = trackNumbers;
    this._index = null;
  }

  /** Rebuilds the trackId -> correlation index. Once per tick, before any identify(). */
  indexTick() {
    this._index = this._correlations.trackIndex();
  }

  _correlationOf(id) {
    if (!this._index) this.indexTick();
    const hit = this._index.get(id);
    if (!hit || (hit.state !== 'CORRELATED' && hit.state !== 'PROVISIONAL')) return null;
    return hit;
  }

  /**
   * @returns {{fdrId:string|null, correlation:'CORRELATED'|'PROVISIONAL'|null,
   *            fdrCallsign:string|null, fdrType:string|null, tag:string|null, trackNumber:string}}
   */
  identify(trackId) {
    const id = String(trackId);
    const hit = this._correlationOf(id);
    const fdr = hit ? this._fdrs.getFdr(hit.fdrId) : null;
    const entry = this._collab.get(id);
    return {
      fdrId: fdr ? hit.fdrId : null,
      correlation: fdr ? hit.state : null,
      fdrCallsign: (fdr && fdr.identity && fdr.identity.callsign) || null,
      fdrType: (fdr && fdr.identity && fdr.identity.aircraftType) || null,
      tag: (entry && entry.rename && entry.rename.value) || null,
      trackNumber: this._trackNumbers.get(id),
    };
  }

  /** The one name for a contact where there is no per-session picture: alert text. */
  labelFor(trackId) {
    const who = this.identify(trackId);
    return who.fdrCallsign || who.tag || who.trackNumber;
  }
}

module.exports = { Identity };
