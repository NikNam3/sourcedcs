'use strict';

/* Starts crc-sync for the Playwright run and restarts it, on a clean state directory, whenever it
 * exits with 75 (the test reset hook, crc-sync/src/test-reset.js). Any other exit ends the
 * supervisor with the same code, so a crash is a crash.
 *
 * Used as the webServer command in playwright.config.js; the environment is the one the config
 * builds (state paths, DCS/SRS pointed at closed ports) plus CRCSYNC_TEST_RESET=1.
 */

const { spawn } = require('child_process');

const { SYNC_DIR, wipeState } = require('./harness-env');
const RESET_EXIT_CODE = 75;
let child = null;

function run() {
  child = spawn(process.execPath, ['server.js'], { cwd: SYNC_DIR, stdio: 'inherit', env: { ...process.env, CRCSYNC_TEST_RESET: '1' } });
  child.once('exit', (code, signal) => {
    child = null;
    if (code === RESET_EXIT_CODE) { wipeState(process.env.E2E_STATE_DIR); run(); return; }
    process.exit(signal ? 1 : code);
  });
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { if (child) { child.once('exit', () => process.exit(0)); child.kill(sig); } else process.exit(0); });
}
run();
