'use strict';

// What createApp's start() attaches to the DCS-gRPC and SRS clients' events, in this order, and stop() detaches again: unit
// telemetry into the TrackStore, the mission session, the mission-load fan-out (clearing the picture, re-deriving everything
// that belonged to the old theater), status, weather and the game clock.

const { reportUnresolvedSelectors } = require('../efsp/position-coverage');
const { wireCollabSession } = require('../collab-wiring');
const log = require('../log').logger('app');

/**
 * @param {object} d
 * @param {{lastMissionData: object|null}} d.missionState written here on every mission load, read by the airport-weather ticker
 * @returns {{attach: () => void, detach: () => void}}
 */
function createFeedHandlers({ grpcClient, srsClient, trackStore, surveillance, missionSession, missionClock, theaterContext, wsHub, correlationReconciler, coverageEngine, terrainStore, facilityConfig, currentRadars, airportWeather, deriveActiveRunwaysFromWind, collabStore, missionState }) {
  const { transponders } = surveillance;
  const attached = []; // [emitter, event, fn], so detach() removes exactly these
  function on(emitter, event, fn) { emitter.on(event, fn); attached.push([emitter, event, fn]); }
  const grpcTap = { on: (event, fn) => on(grpcClient, event, fn) };

  function attach() {
    on(grpcClient, 'unit', (unitData) => {
      trackStore.update(unitData);
    });
    on(grpcClient, 'gone', (id) => { trackStore.remove(id); transponders.release(id); });

    // The pre-restart sample is the old mission's time: forget it before the session rolls, so the new session's
    // startedAt comes from the new mission's first sample (ADR 0129).
    on(grpcClient, 'mission-start', () => { if (missionClock.forget) missionClock.forget(); });
    on(grpcClient, 'mission-start', () => missionSession.noteMissionStart());
    // Hold through a pause only while the link is up (ADR 0129); a reconnect forgets the sample.
    if (missionClock.setLink) {
      missionClock.setLink(grpcClient.linkState);
      on(grpcClient, 'link', (state) => missionClock.setLink(state));
    }
    on(grpcClient, 'mission-load', (missionData) => {
      missionState.lastMissionData = missionData;
      missionSession.noteMissionLoad(missionData);
    });

    on(grpcClient, 'mission-load', (missionData) => {
      trackStore.clear();
      surveillance.clear();
      // collabStore is NOT cleared here: a mission-load that does not roll the mission
      // session keeps the same unit ids (docs/adr/0094); a roll cleared it above.
      // Every radar id, sweep phase and line-of-sight answer belonged to the
      // theater that just went away.
      coverageEngine.reset();
      // And so did every track id. This is defect D1 in its most brutal form —
      // nothing about any airframe changed and every contact was re-minted — so
      // every Strip's correlation is dropped with a warning naming why, and the
      // next tick re-binds each one on its beacon code. §6.6 rule 3 permits
      // exactly two outcomes on an identity change; this does both, in order,
      // rather than leaving a stale binding pointing at a contact that is gone.
      correlationReconciler.resetPicture('MISSION_RELOAD');
      // Do NOT add efsp.boardStore.clear()/efsp.flightDataStore.clear() here — EFSP
      // Strips are durably persisted and a bare mission-load (every gRPC connect) MUST NOT clear them (docs/adr/0002). The Board is
      // cleared only by the mission reset, which mission-session.js decides and app.js wires (docs/adr/0108).
      // A mission is running even when GetTheatre failed, so that is an unknown
      // theater (offset 0, flagged), not "no theater yet" (the wall clock).
      missionClock.setTheatre(missionData.theatre || 'UNKNOWN');
      wsHub.setMissionData(missionData);
      wsHub.broadcastGameTime();
      theaterContext.setMission(missionData);
      wsHub.broadcastTheater();
      log.info('mission init', { airports: missionData.airports.length, theater: missionData.theatre || 'unknown' });

      // Which selectors found nothing in THIS theater — the only point at which
      // that question has an answer, since a selector naming an airfield the map
      // lacks is legitimate config.
      const radars = currentRadars();
      reportUnresolvedSelectors(facilityConfig, radars);

      // The theater's terrain cache (docs/adr/0133): a local file the build command wrote, read here and nowhere else.
      // No file means one log line and no masking; nothing asks DCS or the web for terrain.
      terrainStore.loadTheater(missionData.theatre || null);

      airportWeather.reset();
      airportWeather.refresh(missionData);

      // ── L1 runway status: active runway from wind (H22) ─────────────────────────
      deriveActiveRunwaysFromWind(missionData);
      // ── end L1 runway status ────────────────────────────────────────────────────
    });

    on(grpcClient, 'status', (state) => wsHub.setGrpcStatus(state));
    on(grpcClient, 'weather', (data) => wsHub.setWeather(data));
    on(grpcClient, 'game-time', (dt) => {
      if (!missionClock.sample(dt)) return;
      wsHub.broadcastGameTime();
      // Variation depends on the mission date: a new day, or the first mission
      // sample after the wall clock, moves it.
      if (theaterContext.noteClock()) wsHub.broadcastTheater();
    });
    // F3: after the sample, so the step-back check reads this poll's time (ADR 0086).
    on(grpcClient, 'game-time', () => missionSession.observeClock());
    wireCollabSession({ grpcClient: grpcTap, missionSession, collabStore }); // after the handlers it orders against (docs/adr/0094)

    on(srsClient, 'status', (state) => wsHub.setSrsStatus(state));
  }

  function detach() {
    for (const [emitter, event, fn] of attached.splice(0)) emitter.removeListener(event, fn);
  }

  return { attach, detach };
}

module.exports = { createFeedHandlers };
