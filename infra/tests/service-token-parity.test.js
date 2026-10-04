'use strict';
// The service-token helper is a hand copy per service (B15). Keep the copies, and the shared status table, identical.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('service-token.js is identical in sourcedcs-web and crc-sync', () => {
  assert.equal(read('sourcedcs-web/service-token.js'), read('crc-sync/src/service-token.js'));
});

test('the status table is identical in both suites', () => {
  assert.equal(read('sourcedcs-web/test/fixtures/service-token-table.json'), read('crc-sync/tests/fixtures/service-token-table.json'));
});
