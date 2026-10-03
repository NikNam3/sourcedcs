import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

// DATA-2 (H88): every tuning default lives in config/*.json. A missing or invalid
// shipped file is a startup error that names it; no code literal stands in.
const ROOT = new URL('..', import.meta.url).pathname;

function load(script, configDir) {
  return spawnSync(process.execPath, ['-e', script], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, CRCSYNC_CONFIG_DIR: configDir, CRCSYNC_STATE_DIR: configDir },
  });
}

const CASES = [
  ['alerting', "require('./src/alerting-config').loadAlertingConfig()", 'alerting.json'],
  ['session', "require('./src/session-config').loadSessionConfig()", 'session.json'],
  ['surveillance hints', "require('./src/efsp/surveillance-hints-config')", 'efsp-surveillance-hints.json'],
  ['carrier hulls', "require('./src/efsp/carrier/hull-config')", 'efsp-carriers.json'],
  ['sensor specs', "require('./src/radars').loadSensorSpecs()", 'sensor-specs.json'],
  ['theaters', "require('./src/theaters')", 'theaters.json'],
];

for (const [label, script, file] of CASES) {
  test(`${label}: an empty config dir is a startup error naming ${file}`, () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'tuning-empty-'));
    const r = load(script, empty);
    assert.notEqual(r.status, 0);
    assert.ok(r.stderr.includes(file), r.stderr.slice(0, 400));
  });
}

test('the shipped files load: the defaults are the JSON values', () => {
  const r = load(`
    const a = require('./src/alerting-config').loadAlertingConfig();
    const t = require('./src/theaters');
    const s = require('./src/radars').loadSensorSpecs();
    const h = require('./src/efsp/carrier/hull-config').getDefaultHull();
    console.log(JSON.stringify([a.conflictAlert.lateralNm, t.DEFAULT_TRANSITION_ALT_FT, s.shipRadarDefault, s.defaultCaps.awacs, h.hullId]));
  `, path.join(ROOT, 'config'));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()), [3, 18000, { rangeNm: 40, sweepMs: 5000 }, { height: true, ssr: true, mode4: true }, 'CVN-72']);
});
