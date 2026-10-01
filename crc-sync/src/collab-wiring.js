'use strict';

// Ties the collaborative overlay to the DCS session (docs/adr/0094). Kept apart
// from server.js so the restart walk in tests/collab-persistence.test.mjs runs
// the very same wiring over a fake gRPC stream.
//
// Call it AFTER server.js has registered its own 'mission-load' and 'game-time'
// handlers: listeners fire in registration order, and the overlay must see the
// mission session after it has rolled (mission-session.js) and after its clock
// check (observeClock) for the same event.

function wireCollabSession({ grpcClient, missionSession, collabStore }) {
  collabStore.bindSession(() => missionSession.currentSeq());
  // A new session means new unit ids: nobody's declarations carry over.
  missionSession.onNewSession(() => collabStore.clear());
  // The old mission's ids are void from the moment DCS says so, not from the load.
  grpcClient.on('mission-start', () => collabStore.clear());
  grpcClient.on('mission-load', () => collabStore.noteMissionLoad());
  grpcClient.on('game-time', () => collabStore.noteClockSample());
  grpcClient.on('unit', (u) => collabStore.observeUnit(u));
  grpcClient.on('gone', (id) => collabStore.release(id));
}

module.exports = { wireCollabSession };
