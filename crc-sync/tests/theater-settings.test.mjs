import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// theater-settings.js reads its config path once at module load, so the
// override env var must be set before the first import — this file gets its
// own isolated module registry (node:test runs each file in its own
// worker), so this never touches the real config/theater-settings.json.
const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'theater-settings-test-'));
const tmpFile = path.join(tmpDir, 'theater-settings.json');
process.env.CRCSYNC_THEATER_SETTINGS_PATH = tmpFile;

const { getTheaterSettings, setTheaterSettings } = await import('../src/theater-settings.js');

test('getTheaterSettings starts from defaults when no config file exists yet', () => {
  assert.deepEqual(getTheaterSettings(), { transitionAltFt: 18000, hdgCorrection: 0, gameTimeOffset: 0 });
});

test('setTheaterSettings applies a partial patch and persists it to disk', () => {
  assert.equal(setTheaterSettings({ transitionAltFt: 14000 }), true);
  assert.deepEqual(getTheaterSettings(), { transitionAltFt: 14000, hdgCorrection: 0, gameTimeOffset: 0 });

  const onDisk = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
  assert.equal(onDisk.transitionAltFt, 14000);
});

test('setTheaterSettings ignores unknown or non-finite fields without rejecting the rest', () => {
  assert.equal(setTheaterSettings({ hdgCorrection: 5, bogus: 'x', gameTimeOffset: 'nope' }), true);
  assert.deepEqual(getTheaterSettings(), { transitionAltFt: 14000, hdgCorrection: 5, gameTimeOffset: 0 });
});

test('setTheaterSettings returns false and does not persist when nothing actually changes', () => {
  const before = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
  assert.equal(setTheaterSettings({ hdgCorrection: 5 }), false); // already 5
  assert.equal(setTheaterSettings({}), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(tmpFile, 'utf8')), before);
});

test('getTheaterSettings returns a copy, not a live reference', () => {
  const cfg = getTheaterSettings();
  cfg.transitionAltFt = 99999;
  assert.notEqual(getTheaterSettings().transitionAltFt, 99999);
});
