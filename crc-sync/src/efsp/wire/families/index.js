'use strict';

// The wire families (the Board path, resync and set-positions stay in efsp-ws.js), in snapshot key order (the snapshot frame's tail is airspaces, correlations, marsa, fieldStates,
// carriers, sfaRotation). See docs/wip/WIRE.md "How to add a family".
const FAMILIES = [
  require('./airspace'),
  require('./correlation'),
  require('./marsa'),
  require('./field-state'),
  require('./carrier'),
  require('./sfa'),
  ...require('./ato'),
];

const byType = Object.fromEntries(FAMILIES.map((f) => [f.type, f]));
const byDeltaType = Object.fromEntries(FAMILIES.filter((f) => f.deltaType).map((f) => [f.deltaType, f]));
const REPLAY_KINDS = FAMILIES.map((f) => f.replayKind).filter(Boolean);

module.exports = { FAMILIES, byType, byDeltaType, REPLAY_KINDS };
