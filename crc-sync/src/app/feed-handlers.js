'use strict';

// What createApp's start() attaches to the DCS-gRPC and SRS clients' events, in this order, and stop() detaches again: unit
// telemetry into the TrackStore, the mission session, the mission-load fan-out (clearing the picture, re-deriving everything
// that belonged to the old theater), status, weather and the game clock.

const { reportUnresolvedSelectors, assignableRadars } = require('../efsp/position-coverage');
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

    on(grpcClient, 'mission-start', () => missionSession.noteMissionStart());
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
      // Strips are durably persisted and MUST survive a mission reload, unlike
      // tracks/the IFF overlay (see createApp's EFSP comment and
      // docs/adr/0002-durable-board-persistence.md).
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

      // Fetch the DEM covering this theater's airfield radars up front. Without it
      // the first minutes of a session fail open on every sight line and terrain
      // masks nothing — correct behaviour, but not the behaviour anyone wants.
      //
      // Scoped to radars some Position is actually ASSIGNED, not every airfield in
      // the theater: a 225-airfield map produces 450 airfield radars and would
      // pre-fetch about nine hundred tiles for scopes nobody will ever look
      // through. Not scoped to STAFFED Positions, though — a controller taking
      // Approach mid-session must not then wait for a DEM. Airborne radars are
      // excluded because they move, so there is no fixed circle to fetch, and
      // they warm as they fly.
      terrainStore.prewarmForRadars(
        assignableRadars(facilityConfig, radars)
          .filter(r => r.type === 'airport' || r.type === 'approach'),
      );

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
