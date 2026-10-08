'use strict';

// The wind at the carrier, from DCS-gRPC (docs/adr/0113): the carrier state's wind over deck is this wind plus the ship's speed.
// The carrier tick asks every second; this answers with the last wind it fetched and refreshes it in the background, at most once
// a minute (airport-weather.js's period). A pure duration, so the injected WALL clock times it (decisions H11).

const { WALL_CLOCK } = require('../mission-clock');
const log = require('../log').logger('ship-wind');

const REFRESH_MS = 60_000;
const DECK_HEIGHT_M = 20; // roughly a carrier's flight deck above the sea; DCS wind varies with height

/**
 * @param {{grpcClient:{getAptWeather:(lat:number, lon:number, altM:number)=>Promise<{windFrom:number, windKt:number}>}, wallNow?:()=>number}} deps
 * @returns {{get:(lat:number, lon:number)=>({windFromDeg:number, windKt:number}|null), reset:()=>void}}
 */
function createShipWind({ grpcClient, wallNow = WALL_CLOCK.now }) {
  let last = null;      // { windFromDeg, windKt }
  let askedAt = -Infinity;
  let inFlight = false;
  return {
    get(lat, lon) {
      if (Number.isFinite(lat) && Number.isFinite(lon) && !inFlight && wallNow() - askedAt >= REFRESH_MS) {
        inFlight = true;
        askedAt = wallNow();
        Promise.resolve()
          .then(() => grpcClient.getAptWeather(lat, lon, DECK_HEIGHT_M))
          .then((w) => { if (w && Number.isFinite(w.windFrom) && Number.isFinite(w.windKt)) last = { windFromDeg: w.windFrom, windKt: w.windKt }; })
          .catch((e) => log.warn('ship wind fetch failed', { error: e && e.message }))
          .then(() => { inFlight = false; });
      }
      return last;
    },
    /** A new mission: the wind of the old one is wrong. */
    reset() { last = null; askedAt = -Infinity; },
  };
}

module.exports = { createShipWind, REFRESH_MS };
