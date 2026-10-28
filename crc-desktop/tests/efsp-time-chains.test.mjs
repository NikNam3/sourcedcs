/* §10.5's fallback chains (crc-sync's docs/adr/0073), crc-desktop's copy.
 * Same fixture table as crc-sync/tests/efsp-time-chains.test.mjs (T6). */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { moduleBody } from './helpers/module-body.mjs';
import { resolveTimeChain } from '../app/public/js/panels/efsp/time-chains.js';
const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, '../../crc-sync/tests/fixtures/time-chains.json'), 'utf8'));

for (const c of cases) {
  test(`time chains (client): ${c.name}`, () => {
    for (const [name, want] of Object.entries(c.expect)) {
      const got = resolveTimeChain(name, c.flightData);
      assert.deepEqual({ valueUtc: got.valueUtc, source: got.source, via: got.via, estimated: got.estimated }, want, name);
    }
  });
}

// The client copy is an ES module and the server copy CommonJS: compare the bodies (helpers/module-body.mjs).
test('time chains (client): byte-identical to crc-sync\'s copy', () => {
  assert.equal(
    moduleBody(fs.readFileSync(path.join(__dirname, '../app/public/js/panels/efsp/time-chains.js'), 'utf8')),
    moduleBody(fs.readFileSync(path.join(__dirname, '../../crc-sync/src/efsp/time-chains.js'), 'utf8')));
});
