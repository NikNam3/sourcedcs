import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// ADR 0095 §4: configuration is read when the composition root builds it, never when a module is required. Requiring
// each of these with config and state directories that do not exist must succeed and touch nothing; a module that
// read a file or an env value at require time would throw (a missing shipped file is a start-up error) or create a path.
const MODULES = [
  'state-paths', 'efsp/mutation-log', 'efsp/metrics', 'efsp/traffic-count', 'efsp/stereo-routes', 'apt-config',
  'radars', 'terrain', 'surveillance/iff', 'efsp/facility-config', 'efsp/index', 'theaters', 'tuning-file', 'efsp/instrumentation-config',
  'efsp/surveillance-hints-config', 'theater-context', 'surveillance/index', 'ws-hub',
];

test('requiring the config-reading modules reads no file and no environment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'no-require-time-'));
  const env = { ...process.env, CRCSYNC_CONFIG_DIR: path.join(root, 'no-config'), CRCSYNC_STATE_DIR: path.join(root, 'no-state') };
  for (const k of Object.keys(env)) if (/^CRCSYNC_(EFSP_|SENSOR_|APT_)/.test(k)) delete env[k];
  const src = path.resolve(import.meta.dirname, '../src');
  const code = MODULES.map(m => `require(${JSON.stringify(path.join(src, m))});`).join('\n');
  const r = spawnSync(process.execPath, ['-e', code], { env, encoding: 'utf8' });
  try {
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(fs.readdirSync(root), [], 'nothing was created');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
