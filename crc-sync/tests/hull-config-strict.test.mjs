import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

// H127: the carrier hull config (config/efsp-carriers.json, or its state/ copy) is strict like every other strict
// state/ file: a key this build does not know, at any level, stops start-up naming the file and the key path.
const ROOT = new URL('..', import.meta.url).pathname;
const CONFIG = path.join(ROOT, 'config');
const SHIPPED = JSON.parse(fs.readFileSync(path.join(CONFIG, 'efsp-carriers.json'), 'utf8'));

function load(env) {
  return spawnSync(process.execPath, ['-e', "console.log(JSON.stringify(require('./src/efsp/carrier/hull-config').getHulls().map(h => h.hullId)))"], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, CRCSYNC_CONFIG_DIR: CONFIG, ...env },
  });
}

/** A state dir holding a copy of the shipped hull config, changed by `edit`. */
function stateWith(edit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hull-strict-'));
  const body = structuredClone(SHIPPED);
  edit(body);
  fs.writeFileSync(path.join(dir, 'efsp-carriers.json'), JSON.stringify(body));
  return { dir, file: path.join(dir, 'efsp-carriers.json') };
}

function refuses(edit, keyPath) {
  const { dir, file } = stateWith(edit);
  const r = load({ CRCSYNC_STATE_DIR: dir });
  assert.notEqual(r.status, 0, 'start-up must refuse');
  assert.ok(r.stderr.includes(`[efsp-carriers] ${file} has an unknown key "${keyPath}"`), r.stderr.slice(0, 600));
}

test('the shipped hull config starts (no state copy)', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'hull-strict-empty-'));
  const r = load({ CRCSYNC_STATE_DIR: empty });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()), ['CVN-72']);
});

test('an unchanged state/ copy, with a _comment at every level, starts', () => {
  const { dir } = stateWith((b) => { b.hulls[0]._note = 'x'; b.hulls[0].match._note = 'y'; });
  const r = load({ CRCSYNC_STATE_DIR: dir });
  assert.equal(r.status, 0, r.stderr);
});

test('an unknown top-level key refuses start-up, naming the file and the key', () => {
  refuses((b) => { b.stacks = []; }, 'stacks');
});

test('an unknown per-hull key refuses start-up, naming the file and the key', () => {
  refuses((b) => { b.hulls[0].angledDeck = 9; }, 'hulls[].angledDeck');
});

test('the removed hull `approach` (ADR 0116) refuses start-up, naming the file and the key', () => {
  refuses((b) => { b.hulls[0].approach = { glideslopeDeg: 3.5, tchFt: 50 }; }, 'hulls[].approach');
});

test('an unknown key under match refuses start-up, naming the file and the key', () => {
  refuses((b) => { b.hulls[0].match.trackId = 12; }, 'hulls[].match.trackId');
});

test('an override path (CRCSYNC_EFSP_CARRIERS_PATH) is checked the same way', () => {
  const { file } = stateWith((b) => { b.hulls[0].approach = {}; });
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'hull-strict-empty-'));
  const r = load({ CRCSYNC_STATE_DIR: empty, CRCSYNC_EFSP_CARRIERS_PATH: file });
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes(`${file} has an unknown key "hulls[].approach"`), r.stderr.slice(0, 600));
});
