// The two hand copies of the wire protocol number must agree (crc-sync docs/adr/0103). Same pattern as
// client-mirror-parity.test.mjs: read crc-sync's file across the package boundary (test-only).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { WIRE_PROTOCOL } from '../app/public/js/wire-protocol.js';

const require = createRequire(import.meta.url);

test('crc-desktop and crc-sync speak the same WIRE_PROTOCOL', () => {
  const server = require('../../crc-sync/src/wire-protocol.js').WIRE_PROTOCOL;
  assert.ok(Number.isInteger(server) && server >= 1);
  assert.equal(WIRE_PROTOCOL, server, 'run `cd crc-sync && npm run wire:record`, which bumps both copies together; never edit one by hand');
});

test('the client sends its protocol and version on the feed URL', () => {
  const sync = fs.readFileSync(path.join(import.meta.dirname, '../app/public/js/sync.js'), 'utf8');
  assert.match(sync, /\/feed\?ticket=\$\{encodeURIComponent\(ticket\)\}&protocol=\$\{WIRE_PROTOCOL\}&client=/);
});
