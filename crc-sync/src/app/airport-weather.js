'use strict';

// Per-airport weather, pulled from DCS-gRPC when a mission loads and then once a minute, and served by GET /api/apt-weather.

const { WALL_CLOCK } = require('../mission-clock');
const log = require('../log').logger('weather');

/**
 * @param {{grpcClient: {getAptWeather: Function}, wallNow?: () => number}} deps
 */
function createAirportWeather({ grpcClient, wallNow = WALL_CLOCK.now }) {
  // airport name -> { windFrom (true, as DCS gives it), windKt, tempC, pressureHpa, updatedAt }
  let byAirport = new Map();
  return {
    get: (airportName) => byAirport.get(airportName),
    /** A new mission: every airport of the old theater is gone. */
    reset() { byAirport = new Map(); },
    async refresh(missionData) {
      if (!missionData || !missionData.airports) return;
      for (const ap of missionData.airports) {
        try {
          const w = await grpcClient.getAptWeather(ap.lat, ap.lon, ap.elev || 0);
          byAirport.set(ap.name, { ...w, updatedAt: wallNow() });
        } catch (e) {
          log.warn('apt-weather fetch failed', { airport: ap.name, error: e.message });
        }
      }
    },
  };
}

module.exports = { createAirportWeather };
