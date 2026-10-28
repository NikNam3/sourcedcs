import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withPaths } from './helpers/with-paths.mjs';

/* Where runtime state lives, versus where shipped defaults live
 * (docs/adr/0048).
 *
 * The rule worth pinning is the read fallback, because it is what makes an
 * image update that adds a new default file land without a migration — the
 * same question docs/adr/0041 asks of a config list, asked of a deployment.
 * Get it backwards (read only from state/) and a new shipped default is
 * invisible forever; drop it (read only from config/) and nothing a controller
 * changed survives a deploy, which is the bug this replaces.
 */

const paths = withPaths('crcsync-statepaths-', { CRCSYNC_CONFIG_DIR: 'config', CRCSYNC_STATE_DIR: 'state' }).apply();
const tmp = paths.dir;
const CONFIG = paths.file('config');
const STATE = paths.file('state');
fs.mkdirSync(CONFIG, { recursive: true });

const { readPath, writePath, statePaths, ensureDirFor, dirs } =
  await import('../src/state-paths.js');

test('the two directories come from the environment, so a container can point them anywhere', () => {
  assert.deepEqual(dirs(), { configDir: CONFIG, stateDir: STATE });
});

test('the environment is an argument: an injected env wins over process.env and nothing is remembered between calls', () => {
  const other = { CRCSYNC_CONFIG_DIR: '/c', CRCSYNC_STATE_DIR: '/s' };
  assert.deepEqual(dirs(other), { configDir: '/c', stateDir: '/s' });
  assert.equal(writePath('x.json', undefined, other), path.join('/s', 'x.json'));
  assert.equal(writePath('x.json'), path.join(STATE, 'x.json'));
});

test('a write always goes to the state directory, never next to the shipped defaults', () => {
  assert.equal(writePath('thing.json'), path.join(STATE, 'thing.json'));
});

test('with no live copy, a read falls back to the shipped default', () => {
  // First boot in a fresh container: the volume is empty.
  assert.equal(readPath('first-boot.json'), path.join(CONFIG, 'first-boot.json'));
});

test('once a live copy exists, the read prefers it', () => {
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(path.join(STATE, 'edited.json'), '{"live":true}');
  fs.writeFileSync(path.join(CONFIG, 'edited.json'), '{"shipped":true}');
  assert.equal(readPath('edited.json'), path.join(STATE, 'edited.json'));
});

test('the fallback is resolved per call, so it flips the moment something writes', () => {
  // Resolving once at module load would mean a file written during this
  // session is still read from the image until the next restart.
  const name = 'appears-later.json';
  assert.equal(readPath(name), path.join(CONFIG, name));
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(path.join(STATE, name), '{}');
  assert.equal(readPath(name), path.join(STATE, name));
});

test('a NEW shipped default lands without a migration, even beside a volume full of live files', () => {
  // The property that matters on an image update: state/ has plenty in it, but
  // not this file, so the new default is read rather than being invisible.
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(path.join(STATE, 'old-thing.json'), '{}');
  fs.writeFileSync(path.join(CONFIG, 'brand-new-default.json'), '{"new":true}');
  assert.equal(readPath('brand-new-default.json'), path.join(CONFIG, 'brand-new-default.json'));
});

test('an explicit override wins for BOTH read and write — every test file relies on this', () => {
  const override = path.join(tmp, 'override.json');
  assert.equal(readPath('anything.json', override), override);
  assert.equal(writePath('anything.json', override), override);
  const both = statePaths('anything.json', override);
  assert.equal(both.read, override);
  assert.equal(both.write, override);
});

test('an override is honoured even when a live copy exists under the same name', () => {
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(path.join(STATE, 'shadowed.json'), '{}');
  const override = path.join(tmp, 'elsewhere.json');
  assert.equal(readPath('shadowed.json', override), override);
});

test('statePaths gives a read/write pair for a module that loads once and writes later', () => {
  const pair = statePaths('pair.json');
  assert.equal(pair.read, path.join(CONFIG, 'pair.json'));
  assert.equal(pair.write, path.join(STATE, 'pair.json'));
});

test('ensureDirFor creates a missing data directory, because it is a volume mount', () => {
  const nested = path.join(tmp, 'deep', 'deeper', 'file.json');
  ensureDirFor(nested);
  fs.writeFileSync(nested, '{}');
  assert.ok(fs.existsSync(nested));
});

test('ensureDirFor on a directory that already exists is a no-op, not a throw', () => {
  const again = path.join(tmp, 'deep', 'deeper', 'second.json');
  ensureDirFor(again);
  ensureDirFor(again);
});

// ── the real modules, wired through it ─────────────────────────────────────

test('every runtime-written file resolves under the state directory, and nothing writes into config/', () => {
  // This is the assertion that would have caught the original bug: seven
  // separate things were being written into an image directory with no volume
  // behind it. If a new one is added and routed wrongly, add it here.
  const runtimeFiles = [
    'efsp-board.json',
    'efsp-mutations.jsonl',
    'apt-config.json',
    'efsp-airspaces.json',
    'efsp-facility-incirlik.json',
    'efsp-facility-center.json',
    'efsp-facility-tactical.json',
    'efsp-metrics.json',
    'efsp-traffic-count.jsonl',
  ];
  for (const name of runtimeFiles) {
    assert.equal(writePath(name), path.join(STATE, name), `${name} must be written to state/`);
  }
});
