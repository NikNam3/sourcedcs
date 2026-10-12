'use strict';

// The wire families (the Board path, resync and set-positions stay in efsp-ws.js), in snapshot key order (the snapshot frame's tail is airspaces, correlations, marsa, runwayStatuses,
// carriers). See docs/wip/WIRE.md "How to add a family".
const FAMILIES = [
  require('./airspace'),
  require('./correlation'),
  require('./marsa'),
  require('./runway-status'),
  require('./carrier'),
  ...require('./ato'),
];

const byType = Object.fromEntries(FAMILIES.map((f) => [f.type, f]));
const byDeltaType = Object.fromEntries(FAMILIES.filter((f) => f.deltaType).map((f) => [f.deltaType, f]));
const bySnapshotKey = Object.fromEntries(FAMILIES.filter((f) => f.snapshotKey).map((f) => [f.snapshotKey, f]));
const REPLAY_KINDS = FAMILIES.map((f) => f.replayKind).filter(Boolean);

module.exports = { FAMILIES, byType, byDeltaType, bySnapshotKey, REPLAY_KINDS };
