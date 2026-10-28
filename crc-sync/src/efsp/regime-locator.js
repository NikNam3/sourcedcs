'use strict';

// Where a flight is relative to the airspaces active for an MRU Facility (docs/adr/0102): `(flightDataId, facilityId) ->
// { located, inside, unknown }`. The track source is a dependency (`locateTrack`), so the locator is built with the
// stores it reads and is never installed later. No correlated contact is `located: false`, which is unknown, never
// outside. Without a `locateTrack` NOTHING can be located: that is a wiring mistake in a real server, so the first
// question says so loudly (once); a fixture with no track store passes `locateTrack: () => null` to mean it.

const log = require('../log').logger('efsp');

/**
 * @param {object} deps
 * @param {((trackId:string) => ({lat:number, lon:number, altFt:number}|null))|null} deps.locateTrack
 * @param {{correlatedTrackId:(flightDataId:string)=>string|null}} deps.correlationStore
 * @param {{activeContaining:Function}} deps.airspaceStore
 */
function createRegimeLocator({ locateTrack, correlationStore, airspaceStore }) {
  let warnedNoTrackSource = false;
  return (flightDataId, forFacilityId) => {
    if (!locateTrack) {
      if (!warnedNoTrackSource) {
        warnedNoTrackSource = true;
        log.error('createEfsp was given no locateTrack: every TOFI regime question answers "unknown" and stays pending', { flightDataId });
      }
      return { located: false, inside: [], unknown: [] };
    }
    const trackId = correlationStore.correlatedTrackId(flightDataId);
    const where = trackId ? locateTrack(trackId) : null;
    if (!where) return { located: false, inside: [], unknown: [] };
    const found = airspaceStore.activeContaining(where, { usingFacilityId: forFacilityId });
    return { located: true, inside: found.inside, unknown: found.unknown };
  };
}

module.exports = { createRegimeLocator };
