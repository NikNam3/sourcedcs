'use strict';

/* §10.5's fallback chains (crc-sync's docs/adr/0073), crc-desktop's copy.
 * Same fixture table as crc-sync/tests/efsp-time-chains.test.mjs (T6). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { resolveTimeChain } = require('../app/public/js/panels/efsp/time-chains.js');
const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, '../../crc-sync/tests/fixtures/time-chains.json'), 'utf8'));

for (const c of cases) {
  test(`time chains (client): ${c.name}`, () => {
    for (const [name, want] of Object.entries(c.expect)) {
      const got = resolveTimeChain(name, c.fdr);
      assert.deepEqual({ valueUtc: got.valueUtc, source: got.source, via: got.via, estimated: got.estimated }, want, name);
    }
  });
}

test('time chains (client): byte-identical to crc-sync\'s copy', () => {
  assert.equal(
    fs.readFileSync(path.join(__dirname, '../app/public/js/panels/efsp/time-chains.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../../crc-sync/src/efsp/time-chains.js'), 'utf8'));
});
