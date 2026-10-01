'use strict';

// The 1 Hz carrier tick (docs/adr/0074; ADR 0064 B6): matches each configured
// hull to its live ship track and publishes the banner when it changed enough to
// matter. Follows the correlation reconciler's tick pattern: injected inputs, a
// `tick()` the server calls on an interval, a callback with the whole hull view
// when something changed. Not audited per tick, and nothing it produces is
// persisted: the banner is derived, so after a restart it is simply rebuilt.
//
// The tick injects what the model deliberately does not own:
//  - the own coalition (decisions H42: CRCSYNC_COALITION), so a hull is matched
//    among OUR ships only;
//  - the grid convergence at the ship (F2's per-theater table), so DCS's grid
//    heading becomes a TRUE heading (decisions H15), and the magnetic variation
//    at the ship (the World Magnetic Model at the mission date, ADR 0085), which
//    the client needs to show bearings magnetic;
//  - the theater sea-level pressure (the default altimeter);
//  - night, from the mission clock and the ship's position (carrier/sun.js).

const carrier = require('./carrier');
const { isNight } = require('./carrier/sun');

class CarrierTick {
  /**
   * @param {object} deps
   * @param {object} deps.carrierStore
   * @param {()=>object[]} deps.tracks all live tracks
   * @param {()=>number|null} deps.ownCoalition
   * @param {{now:()=>number}} deps.clock the mission clock
   * @param {(lat:number, lon:number)=>number|null} [deps.convergenceAt]
   * @param {(lat:number, lon:number)=>number|null} [deps.variationAt]
   * @param {()=>number|null} [deps.weatherPa]
   * @param {(hullId:string)=>void} [deps.onChange] called once per tick that changed a banner
   */
  constructor({ carrierStore, tracks, ownCoalition, clock, convergenceAt, variationAt, weatherPa, onChange }) {
    this._store = carrierStore;
    this._tracks = tracks;
    this._own = ownCoalition || (() => null);
    this._clock = clock;
    this._convergenceAt = convergenceAt || (() => null);
    this._variationAt = variationAt || (() => null);
    this._weatherPa = weatherPa || (() => null);
    this._onChange = onChange || (() => {});
    // The advisory's weather: night at the ship, nothing else (the ship's own
    // ceiling and visibility are not sourced; ADR 0064 B8). Unknown stays quiet.
    this._store.setWeatherSource((hullId) => {
      const s = this._store.getShipState(hullId);
      if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return null;
      const night = isNight(s.lat, s.lon, this._clock.now());
      return night == null ? null : { night, ceilingFt: null, visibilityNm: null };
    });
  }

  /** @returns {boolean} whether any banner was republished */
  tick() {
    let any = false;
    const tracks = this._tracks() || [];
    const now = this._clock.now();
    for (const hullId of this._store.hullIds()) {
      const hull = this._store.hull(hullId);
      const track = carrier.matchHullTrack(hull, tracks, { ownCoalition: this._own() });
      const prev = this._store.getShipState(hullId);
      let next;
      if (track) {
        const gamma = this._convergenceAt(track.lat, track.lon);
        next = carrier.buildShipState({
          hull, track, now, inputs: this._store.shipInputs(hullId),
          weatherPa: this._weatherPa(), gridConvergenceDeg: Number.isFinite(gamma) ? gamma : null,
        });
        const v = this._variationAt(track.lat, track.lon);
        next.magneticVariationDeg = Number.isFinite(v) ? v : null;
        next.hullProblem = null;
      } else if (prev && prev.found) {
        next = carrier.staleFrom(prev, now);
        next.hullProblem = carrier.hullMatchProblem(hull, tracks, { ownCoalition: this._own() });
      } else {
        next = carrier.buildShipState({ hull, track: null, now, inputs: this._store.shipInputs(hullId), weatherPa: this._weatherPa() });
        next.hullProblem = carrier.hullMatchProblem(hull, tracks, { ownCoalition: this._own() });
        next.magneticVariationDeg = null;
      }
      // `hullProblem` and the variation are not in shipStateChanged's compare:
      // fold a change of either in so a banner that says "hull ambiguous" moves.
      if (this._store.setShipState(hullId, next) || (prev && (prev.hullProblem !== next.hullProblem || prev.magneticVariationDeg !== next.magneticVariationDeg) && this._store.setShipState(hullId, { ...next, _rev: now }))) {
        any = true;
        this._onChange(hullId);
      }
    }
    return any;
  }
}

module.exports = { CarrierTick };
