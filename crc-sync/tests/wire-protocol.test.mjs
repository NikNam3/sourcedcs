import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// docs/adr/0103: the wire protocol number cannot be forgotten. The wire surface (message types, EFSP op kinds, top-level
// frame keys) is compared with tests/fixtures/wire-surface.json; a change without `npm run wire:record` fails here.

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { computeSurface } = require('../tools/wire-surface.js');
const { parseProtocol, shouldBump, releasedProtocol } = require('../tools/wire-record.js');
const { WIRE_PROTOCOL } = require('../src/wire-protocol.js');
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'wire-surface.json'), 'utf8'));

const INSTRUCTION = 'the wire changed: run `npm run wire:record` (bumps WIRE_PROTOCOL in both copies if the last release already shipped this number)';

test('the wire surface matches the recorded fixture', () => {
  const now = computeSurface();
  for (const key of Object.keys({ ...now, ...fixture.surface })) {
    assert.deepEqual(now[key], fixture.surface[key], `${INSTRUCTION}. Differs: ${key}`);
  }
});

test('the fixture was recorded at the current WIRE_PROTOCOL', () => {
  assert.equal(fixture.protocol, WIRE_PROTOCOL, `${INSTRUCTION}. (fixture says ${fixture.protocol}, the code says ${WIRE_PROTOCOL})`);
});

test('WIRE_PROTOCOL is a positive integer and update-required is on the wire surface', () => {
  assert.ok(Number.isInteger(WIRE_PROTOCOL) && WIRE_PROTOCOL >= 1);
  assert.ok(fixture.surface.serverToClient.includes('update-required'));
});

test('the per-frame envelope version stays 1 (the soak matches the literal)', () => {
  for (const [type, keys] of Object.entries(fixture.surface.frameKeys)) assert.ok(keys.includes('version'), type);
  assert.match(fs.readFileSync(path.join(HERE, '..', 'src', 'ws-hub.js'), 'utf8'), /^const VERSION  = 1;/m);
});

test('wire:record bump rule: bump only when the last release already shipped the current number', () => {
  assert.equal(shouldBump(2, 2), true);
  assert.equal(shouldBump(3, 2), false, 'already ahead of the release: lanes share one bump');
  assert.equal(shouldBump(2, null), true, 'no tag or no file at the tag');
});

test('wire:record reads the released protocol from the newest crc-desktop tag', () => {
  const calls = [];
  const git = (args) => { calls.push(args.join(' ')); return args[0] === 'tag' ? 'crc-desktop-v1.4.0\ncrc-desktop-v1.3.9\n' : 'export const WIRE_PROTOCOL = 5;\n'; };
  assert.equal(releasedProtocol(git), 5);
  assert.match(calls[1], /^show crc-desktop-v1\.4\.0:crc-desktop\/app\/public\/js\/wire-protocol\.js$/);
  assert.equal(releasedProtocol((a) => (a[0] === 'tag' ? '' : '')), null);
  assert.equal(releasedProtocol((a) => { if (a[0] === 'tag') return 'crc-desktop-v1.0.0\n'; throw new Error('missing'); }), null);
  assert.equal(parseProtocol('module.exports = { WIRE_PROTOCOL: 7 };'), 7);
});
