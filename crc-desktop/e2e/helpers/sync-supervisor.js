'use strict';

/* Starts crc-sync for the Playwright run and restarts it, on a clean state directory, whenever it
 * exits with 75 (the test reset hook, crc-sync/src/test-reset.js). Any other exit ends the
 * supervisor with the same code, so a crash is a crash.
 *
 * Used as the webServer command in playwright.config.js; the environment is the one the config
 * builds (state paths, DCS/SRS pointed at closed ports) plus CRCSYNC_TEST_RESET=1.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SYNC_DIR = path.join(__dirname, '..', '..', '..', 'crc-sync');
const RESET_EXIT_CODE = 75;
let child = null;

// Every durable file the harness redirected, plus the instrumentation config it copied in: the
// config is read-only so it stays; everything the service writes goes.
function wipeState() {
  const keep = new Set(['efsp-instrumentation.json', 'efsp-stereo-routes.json']);
  const dir = process.env.E2E_STATE_DIR;
  for (const name of fs.readdirSync(dir)) {
    if (keep.has(name)) continue;
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
  // airspaces start as an empty list, like the first boot
  fs.writeFileSync(path.join(dir, 'efsp-airspaces.json'), '[]');
}

function run() {
  child = spawn(process.execPath, ['server.js'], { cwd: SYNC_DIR, stdio: 'inherit', env: { ...process.env, CRCSYNC_TEST_RESET: '1' } });
  child.once('exit', (code, signal) => {
    child = null;
    if (code === RESET_EXIT_CODE) { wipeState(); run(); return; }
    process.exit(signal ? 1 : code);
  });
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { if (child) { child.once('exit', () => process.exit(0)); child.kill(sig); } else process.exit(0); });
}
run();
