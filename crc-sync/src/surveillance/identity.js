'use strict';

// Who a contact is (docs/adr/0059) — the same answer for every controller.
//
// What a controller's own sensors add (code, altitude, datalink) is per
// session and lives in presentation.js. This is only the part that does not
// depend on which radar is looking:
//
//   1. correlated to a flight: the flight's callsign, from its flight data — the
//      flight plan is where a callsign comes from in the first place.
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
   * @param {{getFlightData:(flightDataId:string)=>object|null}} deps.flightDataStore
   * @param {{get:(trackId:string)=>object|null}} deps.collab
   * @param {{get:(trackId:string)=>string}} deps.trackNumbers
   */
  constructor({ correlationStore, flightDataStore, collab, trackNumbers, carrierFlightIds = () => new Set() }) {
    this._correlations = correlationStore;
    // docs/adr/0156: the flights with a live carrier Strip, read once per tick (a carrier Strip names its contact only
    // where presentation.js lets it).
    this._carrierFlightIds = carrierFlightIds;
    this._carrier = new Set();
    this._flightDataList = flightDataStore;
    this._collab = collab;
    this._trackNumbers = trackNumbers;
    this._index = null;
  }

  /** Rebuilds the trackId -> correlation index. Once per tick, before any identify(). */
  indexTick() {
    this._index = this._correlations.trackIndex();
    this._carrier = this._carrierFlightIds();
  }

  _correlationOf(id) {
    if (!this._index) this.indexTick();
    const hit = this._index.get(id);
    if (!hit || hit.state !== 'CORRELATED') return null;
    return hit;
  }

  /**
   * @returns {{flightDataId:string|null, correlation:'CORRELATED'|null,
   *            flightDataCallsign:string|null, flightDataType:string|null, carrierFlight:boolean, tag:string|null, trackNumber:string}}
   */
  identify(trackId) {
    const id = String(trackId);
    const hit = this._correlationOf(id);
    const flightData = hit ? this._flightDataList.getFlightData(hit.flightDataId) : null;
    const entry = this._collab.get(id);
    return {
      flightDataId: flightData ? hit.flightDataId : null,
      correlation: flightData ? hit.state : null,
      flightDataCallsign: (flightData && flightData.identity && flightData.identity.callsign) || null,
      flightDataType: (flightData && flightData.identity && flightData.identity.aircraftType) || null,
      carrierFlight: !!flightData && this._carrier.has(hit.flightDataId),
      tag: (entry && entry.rename && entry.rename.value) || null,
      trackNumber: this._trackNumbers.get(id),
    };
  }

  /** Does a live carrier Strip hold this flight (as of the last indexTick)? docs/adr/0156. */
  isCarrierFlight(flightDataId) {
    return this._carrier.has(flightDataId);
  }

  /** The one name for a contact where there is no per-session picture: alert text. */
  labelFor(trackId) {
    const who = this.identify(trackId);
    return who.flightDataCallsign || who.tag || who.trackNumber;
  }
}

module.exports = { Identity };
