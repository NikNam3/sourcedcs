import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// docs/adr/0103: the wire protocol number cannot be forgotten. The wire surface (message types, EFSP and store op kinds, the carrier's values and keys, top-level
// frame keys) is compared with tests/fixtures/wire-surface.json; a change without `npm run wire:record` fails here.

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { computeSurface } = require('../tools/wire-surface.js');
const { parseProtocol, shouldBump, nextProtocol, releasedProtocol } = require('../tools/wire-record.js');
const { WIRE_PROTOCOL } = require('../src/wire-protocol.js');
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'wire-surface.json'), 'utf8'));

const INSTRUCTION = 'the wire changed: run `npm run wire:record` (bumps WIRE_PROTOCOL in both copies if the last release already shipped this number)';

test('the wire surface matches the recorded fixture', () => {
  const now = computeSurface();
  for (const key of Object.keys({ ...now, ...fixture.surface })) {
    assert.deepEqual(now[key], fixture.surface[key], `${INSTRUCTION}. Differs: ${key}`);
  }
});

// The carrier half was once missing from the scan (S-ARCH-41): a stack op kind, a stack-entry key or a carrier handoff added
// to the server's own list must change the surface, so the comparison above fails until `npm run wire:record`. Run in a
// child process so the patched module is the one every requirer sees, and this process's modules stay real.
test('a carrier stack op kind, stack-entry key or handoff added on the server changes the wire surface', () => {
  const probe = `
    const path = require('path');
    const efsp = path.join(${JSON.stringify(path.join(HERE, '..', 'src', 'efsp'))});
    const patch = (rel, fn) => { const p = require.resolve(path.join(efsp, rel)); require(p); require.cache[p].exports = fn(require.cache[p].exports); };
    patch('carrier/marshal-stack.js', (m) => ({ ...m, STACK_OP_KINDS: Object.freeze([...m.STACK_OP_KINDS, 'WireProbeOp']), ENTRY_KEYS: Object.freeze([...m.ENTRY_KEYS, 'wireProbeKey']) }));
    patch('carrier/handoffs.js', (m) => ({ ...m, CARRIER_HANDOFFS: Object.freeze({ ...m.CARRIER_HANDOFFS, WIRE_PROBE: m.CARRIER_HANDOFFS.COMMENCED_TO_MARSHAL }) }));
    process.stdout.write(JSON.stringify(require(${JSON.stringify(path.join(HERE, '..', 'tools', 'wire-surface.js'))}).computeSurface()));`;
  const patched = JSON.parse(execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8' }));
  assert.ok(patched.storeOpKinds['efsp-carrier-mutation'].includes('WireProbeOp'), 'a new STACK_OP_KINDS entry reaches the surface');
  assert.ok(patched.carrier.entryKeys.includes('wireProbeKey'), 'a new ENTRY_KEYS entry reaches the surface');
  assert.ok(patched.carrier.handoffs.includes('WIRE_PROBE'), 'a new CARRIER_HANDOFFS row reaches the surface');
  for (const key of ['storeOpKinds', 'carrier']) assert.notDeepEqual(patched[key], fixture.surface[key], `${key} would no longer match the fixture`);
});

test('every store family and every synced store is on the wire surface', () => {
  const { FAMILIES } = require('../src/efsp/wire/families');
  const { STORE_SYNC } = require('../src/efsp/stores.js');
  const surface = fixture.surface;
  for (const f of FAMILIES.filter(f => f.type.endsWith('-mutation'))) {
    assert.ok((surface.storeOpKinds[f.type] || []).length, `${f.type} has no op kinds on the surface: add its store's list to storeOpKinds in tools/wire-surface.js`);
  }
  for (const s of STORE_SYNC) {
    assert.ok(surface.frameKeys[s.deltaType], `${s.deltaType} has no frame keys on the surface: build it in frameKeys in tools/wire-surface.js`);
    assert.ok(surface.storeSync.some(e => e.key === s.key), s.key);
  }
  assert.ok(surface.frameKeys['efsp-board-delta']);
  const table = require('../src/efsp/board/ops').map(m => m.kind);
  for (const kind of table) assert.ok(surface.efspOpKinds.includes(kind), `Board op ${kind} is not on the surface`);
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
  assert.equal(releasedProtocol((a) => (a[0] === 'tag' ? '' : '')), 1, 'no tag: the pre-handshake baseline');
  assert.equal(releasedProtocol((a) => { if (a[0] === 'tag') return 'crc-desktop-v1.0.0\n'; throw new Error('missing'); }), 1, 'a tag without the file is protocol 1, not unknown');
  assert.equal(releasedProtocol(() => { throw new Error('git failed'); }), null);
  assert.equal(parseProtocol('module.exports = { WIRE_PROTOCOL: 7 };'), 7);
});

test('wire:record is idempotent: against a tag with no record file, running it twice gives one bump at most, and none at 2', () => {
  // The last release (v1.5.0, say) predates the file: released = 1. The code is at 2, ahead of it.
  assert.equal(nextProtocol({ current: 2, released: 1, changed: true, force: false }), 2, 'a real change while already ahead does not bump');
  assert.equal(nextProtocol({ current: 2, released: 1, changed: true, force: true }), 2);
  // The release shipped 2: the first real change bumps to 3, the second run sees the surface recorded and stays.
  const first = nextProtocol({ current: 2, released: 2, changed: true, force: false });
  assert.equal(first, 3);
  assert.equal(nextProtocol({ current: first, released: 2, changed: false, force: false }), 3);
  assert.equal(nextProtocol({ current: first, released: 2, changed: true, force: false }), 3, 'even a second change before the release shares the bump');
  assert.equal(nextProtocol({ current: 2, released: 2, changed: false, force: false }), 2, 'no change, no bump');
});
