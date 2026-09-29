'use strict';

// The surveillance layer (docs/adr/0059), assembled: what each aircraft's
// transponder sends, who each contact is, and the datalink feed. ws-hub.js
// asks it about a contact; presentation.js turns the answers into the wire.

const { Transponders } = require('./transponder');
const { TrackNumbers } = require('./track-numbers');
const { Identity } = require('./identity');
const { resolveIff } = require('./iff');

const NO_CORRELATIONS = { trackIndex: () => new Map() };
const NO_FDRS = { getFdr: () => null };

/**
 * @param {object} deps
 * @param {object} deps.collab                CollaborativeStore (IFF declarations, tags)
 * @param {object} [deps.srs]                 srs-client, for players' transponders
 * @param {object} [deps.sensorSpecs]         loadSensorSpecs()
 * @param {object} [deps.correlationStore]
 * @param {object} [deps.fdrStore]
 * @param {object} [deps.datalink]            DatalinkFeed, or null
 * @param {() => {weather:object, transitionAltFt:number}} [deps.env]
 */
function createSurveillance({ collab, srs = null, sensorSpecs = null, correlationStore, fdrStore, datalink = null, env }) {
  const transponders = new Transponders({ srs, config: sensorSpecs && sensorSpecs.transponder });
  const trackNumbers = new TrackNumbers();
  const identity = new Identity({
    correlationStore: correlationStore || NO_CORRELATIONS,
    fdrStore: fdrStore || NO_FDRS,
    collab,
    trackNumbers,
  });
  return {
    transponders, trackNumbers, identity, datalink,
    env: env || (() => ({ weather: {}, transitionAltFt: 18000 })),

    /** Everything about a contact that does not depend on which controller is looking. */
    describe(track, missionData) {
      const id = String(track.id);
      const transponder = transponders.transponderOf(track);
      const entry = collab.get(id);
      return {
        who: identity.identify(id),
        transponder,
        iffState: resolveIff(track, entry, missionData, !!transponder),
        iffOverride: (entry && entry.iff) ? entry.iff.state : null,
      };
    },

    /** A contact left the picture. */
    forget(liveIds) {
      transponders.retain(liveIds);
      trackNumbers.retain(liveIds);
    },

    /** Mission reload. */
    clear() {
      transponders.clear();
      trackNumbers.clear();
      if (datalink) datalink.clear();
    },
  };
}

module.exports = { createSurveillance };
