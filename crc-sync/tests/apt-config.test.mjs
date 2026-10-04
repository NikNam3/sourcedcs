import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { withPaths } from './helpers/with-paths.mjs';

// createAptConfig() reads its config path when it is called (the composition root, at start), from the env it is given;
// this file points that env at a temp file so it never touches the real config/apt-config.json.
const paths = withPaths('apt-config-test-', { CRCSYNC_APT_CONFIG_PATH: 'apt-config.json' }).apply();
const tmpDir  = paths.dir;
const tmpFile = paths.file('apt-config.json');

const { createAptConfig } = await import('../src/apt-config.js');
const { getAptConfig, setAptConfig } = createAptConfig();

test('getAptConfig starts empty when no config file exists yet', () => {
  assert.deepEqual(getAptConfig(), {});
});

test('setAptConfig creates an entry from a partial patch, defaulting the rest', () => {
  assert.equal(setAptConfig('UGKO', { freq: '251.000' }), true);
  assert.deepEqual(getAptConfig().UGKO, { freq: '251.000', rwy: '', info: '', manualWx: { vis: '', clouds: [] } });
});

test('setAptConfig merges a later patch instead of replacing the whole entry', () => {
  setAptConfig('UGKO', { rwy: '13', info: 'B' });
  assert.deepEqual(getAptConfig().UGKO, { freq: '251.000', rwy: '13', info: 'B', manualWx: { vis: '', clouds: [] } });
});

test('setAptConfig patches manualWx.vis without touching manualWx.clouds, and vice versa', () => {
  setAptConfig('UGKO', { manualWx: { vis: '8' } });
  assert.deepEqual(getAptConfig().UGKO.manualWx, { vis: '8', clouds: [] });

  setAptConfig('UGKO', { manualWx: { clouds: [{ cover: 'BKN', base: '3000' }] } });
  assert.deepEqual(getAptConfig().UGKO.manualWx, { vis: '8', clouds: [{ cover: 'BKN', base: '3000' }] });
});

test('setAptConfig persists to disk', () => {
  const onDisk = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
  assert.equal(onDisk.UGKO.freq, '251.000');
});

test('setAptConfig rejects an empty key or a non-object patch', () => {
  assert.equal(setAptConfig('', { freq: '251.000' }), false);
  assert.equal(setAptConfig('UGKO', null), false);
});

test('setAptConfig returns false and does not persist when the patch has no known fields', () => {
  const before = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
  assert.equal(setAptConfig('UGKO', {}), false);
  assert.equal(setAptConfig('UGKO', { bogus: 'x' }), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(tmpFile, 'utf8')), before);
});

test('getAptConfig returns a copy, not a live reference', () => {
  const cfg = getAptConfig();
  cfg.UGKO.freq = 'INJECTED';
  assert.notEqual(getAptConfig().UGKO.freq, 'INJECTED');
});
