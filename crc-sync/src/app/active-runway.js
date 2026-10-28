'use strict';

// Each Facility with runways takes the end most into its airfield's wind as the active runway, once per mission SESSION
// (docs/adr/0061, 0086): the store skips a Facility whose runway was already derived in the current session, so a gRPC
// reconnect or a crc-sync restart keeps the end LC has since chosen, and the same .miz restarted for a new sortie reads the
// wind again. DCS wind is TRUE and is compared with each end's true heading from the inventory, never with the magnetic end number.

const { runwayStatusDelta } = require('../efsp/wire/frames');
const log = require('../log').logger('runway-status');

/**
 * @param {object} deps
 * @param {{currentSeq: () => number}} deps.missionSession
 * @param {object} deps.facilityConfig
 * @param {object} deps.efsp the facade: `runwayStatusStore`, `persist`, `nlaStatusMonitor`
 * @param {{getAptWeather: Function}} deps.grpcClient
 * @param {(frames: object|object[]) => void} deps.deliver sends EFSP frames to every session (WsHub#deliverEfsp)
 * @returns {(missionData: object) => void}
 */
function createActiveRunwayFromWind({ missionSession, facilityConfig, efsp, grpcClient, deliver }) {
  return function deriveActiveRunwaysFromWind(missionData) {
    const missionSessionSeq = missionSession.currentSeq();
    for (const facilityId of facilityConfig.getFacilityIds()) {
      const icao = (facilityConfig.getFacilityConfig(facilityId).runwayStatus || {}).airportIcao;
      if (!icao || !efsp.runwayStatusStore.hasRunwayStatus(facilityId)) continue;
      const airport = (missionData.airports || []).find(a => a.icao === icao);
      if (!airport) { log.warn('no such airport in this mission — active runway left as it is', { facilityId, icao }); continue; }
      grpcClient.getAptWeather(airport.lat, airport.lon, airport.elev || 0)
        .then((w) => {
          const r = efsp.runwayStatusStore.setActiveRunwayFromWind(facilityId, { windFromTrue: w.windFrom, windKt: w.windKt, missionSession: missionSessionSeq });
          // Persisted even when the end is unchanged: the store has recorded
          // that this session's wind is applied (docs/adr/0086).
          if (r.ok && !r.skipped) efsp.persist();
          if (r.ok && r.changed) {
            // The same delta a runway-status op sends (decisions.md S-L1d).
            deliver(runwayStatusDelta(efsp.runwayStatusStore, [efsp.runwayStatusStore.getRunwayStatus(facilityId)]));
            efsp.nlaStatusMonitor.tick();
            log.info('active runway from the mission wind', { facilityId, activeRunway: r.activeRunway, windFromDegTrue: w.windFrom, windKt: w.windKt });
          }
        })
        .catch((e) => log.warn('wind fetch failed, active runway left as it is', { facilityId, error: e.message }));
    }
  };
}

module.exports = { createActiveRunwayFromWind };
