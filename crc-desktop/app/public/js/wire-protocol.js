// The wire protocol number this client speaks (crc-sync docs/adr/0103). A hand copy of
// crc-sync/src/wire-protocol.js; crc-desktop/tests/wire-protocol-parity.test.mjs fails if they differ.
// Bumped by `cd crc-sync && npm run wire:record`, never by hand except for a change the surface scan cannot see.
export const WIRE_PROTOCOL = 2;
