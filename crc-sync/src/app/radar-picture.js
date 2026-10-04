'use strict';

// The radar picture (docs/adr/0042): radars, their sweep phase, terrain masking and who may look through what all live in
// crc-sync rather than in each renderer. The chain is:
//
//   sensor-specs.json + missionData + tracks  ->  buildRadars()
//   PositionCoverage    which Positions grant which of those radars
//   CoverageEngine     what each of those radars is illuminating, one phase for everybody, terrain included
//   WsHub              each session gets only what its Positions can see
//
// plus what a controller is told about a contact (docs/adr/0059): what its transponder sends (SRS for players, a synthetic
// code for own/neutral AI), who it is (its flight, a tag, or its track number), and the datalink feed. Moved out of createApp.

const { buildRadars, loadSensorSpecs } = require('../radars');
const { TerrainStore } = require('../terrain');
const { CoverageEngine } = require('../coverage');
const { PositionCoverage } = require('../efsp/position-coverage');
const { DatalinkFeed } = require('../surveillance/datalink');
const { createSurveillance } = require('../surveillance');

/**
 * @param {object} deps
 * @param {object} deps.env
 * @param {{get: () => {getMissionData: () => object|null}}} deps.hubLink the hub is built after this (it takes the picture), so the loaded
 *   mission is read through the link at call time
 * @param {object} deps.trackStore
 * @param {object} deps.efsp the facade: `positionStoreFor`, `correlationStore`, `flightDataStore`
 * @param {object} deps.facilityConfig
 * @param {number} deps.ownCoalition
 * @param {object} deps.collabStore
 * @param {object} deps.srsClient
 * @param {object} deps.grpcClient
 * @param {object} deps.theaterContext
 */
function buildRadarPicture({ env, hubLink, trackStore, efsp, facilityConfig, ownCoalition, collabStore, srsClient, grpcClient, theaterContext }) {
  const sensorSpecs  = loadSensorSpecs(undefined, env);
  const terrainStore = new TerrainStore({ env });
  const coverageEngine = new CoverageEngine({ terrain: terrainStore });

  // The radar list is rebuilt per tick rather than cached: it depends on live tracks (an AWACS taking off is a new radar)
  // and the cost is a walk over the airfield list plus the tracks, which the sweep does anyway.
  function currentRadars() {
    return buildRadars({
      missionData: hubLink.get().getMissionData(),
      tracks: trackStore.getAll(),
      radarSpecs: sensorSpecs,
    });
  }

  const positionCoverage = new PositionCoverage({
    facilityConfig,
    positionStoreFor: efsp.positionStoreFor,
    radars: currentRadars,
    ownCoalition,
  });

  const picture = {
    coverageFor: (controllerId) => {
      const result = positionCoverage.forController(controllerId);
      // Stamp each radar with the server's own sweep phase. The client draws the
      // debug beam overlay from it, and that overlay used to be decorative —
      // each renderer guessed its own phase, so the beam it drew was nowhere
      // near where the beam that actually revealed a contact was. Now they are
      // the same number.
      const now = Date.now();
      result.radars = result.radars.map(r => ({ ...r, sweepStart: coverageEngine.sweepStartFor(r.id, now) }));
      return result;
    },
    illuminated: () => coverageEngine.illuminatedNow,
    radars: currentRadars,
  };

  // The datalink feed: own participants report themselves, and what their radar is locked on (docs/adr/0059). Ticked with
  // the hub; locks polled from the mission on their own, slower, rhythm.
  const datalink = new DatalinkFeed({
    evalLua: (lua) => grpcClient.evalLua(lua), trackStore, config: sensorSpecs.datalink, ownCoalition,
  });

  const surveillance = createSurveillance({
    datalink,
    collab: collabStore,
    srs: srsClient,
    sensorSpecs,
    ownCoalition,
    correlationStore: efsp.correlationStore,
    flightDataStore: efsp.flightDataStore,
    env: () => ({ weather: grpcClient.getWeather(), transitionAltFt: theaterContext.transitionAltFt() }),
  });

  return { sensorSpecs, terrainStore, coverageEngine, currentRadars, positionCoverage, picture, datalink, surveillance };
}

module.exports = { buildRadarPicture };
