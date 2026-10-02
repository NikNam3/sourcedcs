'use strict';

// The wire protocol number (docs/adr/0103). Bumped whenever the wire changes incompatibly, by `npm run wire:record`
// (tests/wire-protocol.test.mjs fails until it runs). A hand copy lives in
// crc-desktop/app/public/js/wire-protocol.js and a crc-desktop test fails if the two differ.
// This is NOT the per-frame `version: 1` (the envelope's version, which the soak matches literally).
module.exports = { WIRE_PROTOCOL: 2 };
