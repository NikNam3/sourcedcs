'use strict';

/* End-to-end tests against the REAL panel in a REAL browser.
 *
 * Why this exists alongside `npm test`: the node --test suite renders
 * bay-view.js against a DOM stub, which proves the wiring — the right op is
 * dispatched, the right control exists — and is structurally incapable of
 * seeing anything else. Every bug found by hand in this panel so far has been
 * in the part it cannot see: a popover rendered behind another Strip, a button
 * that looks pressable and is not, an overlay covering the whole window, a
 * toggle whose state change never reached the reconciler. Those are layout,
 * stacking and live-state questions, and they need a browser.
 *
 * The Electron app is not special here. main.js does
 * `win.loadURL('http://localhost:' + wsPort)` — the window is a Chrome tab
 * pointed at app/server.js. So this drives exactly the same page the app does,
 * with no Electron-specific machinery.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const harness = require('./e2e/helpers/harness-env');

// Deliberately NOT 3000/3100: a developer almost always has the real pair
// running while working on this, and an e2e run must never talk to it.
//
// E2E_LANE lets several cataloguing agents run at once without fighting over
// ports or output directories. Lane 0 is the default, so anything that does
// not set it behaves exactly as before.
const LANE = Number(process.env.E2E_LANE || 0);
if (!Number.isInteger(LANE) || LANE < 0 || LANE > 9) {
  throw new Error(`E2E_LANE must be an integer 0-9, got ${process.env.E2E_LANE}`);
}
// e2e/tools/run-order.js starts the two servers itself and runs one spec file at a time against them,
// to prove a file does not depend on which ran before it; it sets this so Playwright reuses them.
const REUSE = process.env.E2E_REUSE_SERVERS === '1';
const CRC_SYNC_PORT = 3010 + LANE;
const APP_PORT = 3110 + LANE;

// Every piece of crc-sync's durable state is redirected into a throwaway directory (e2e/helpers/harness-env.js builds the
// environment and seeds the files; tests/e2e-boot.test.mjs boots crc-sync on exactly that). The directory belongs to the
// RUNNER: a worker, or a run-order child, finds E2E_STATE_DIR already set and shares it, and only the runner seeds it and
// (globalTeardown) removes it. Before, every config load, in the runner and in each worker, made and leaked its own.
const OWNS_STATE_DIR = !process.env.E2E_STATE_DIR;
process.env.E2E_STATE_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), `crc-e2e-lane${LANE}-`));
if (OWNS_STATE_DIR) process.env.E2E_STATE_DIR_OWNER = String(process.pid);
const STATE_DIR = process.env.E2E_STATE_DIR;

const syncEnv = harness.syncEnv(STATE_DIR, CRC_SYNC_PORT);
// The two-route stereo table (crc-sync's docs/adr/0073) l16-picker-and-times.spec.js picks from. The harness installs it itself so
// a plain `npx playwright test` needs no environment; E2E_STEREO_ROUTES=<file> substitutes another table, and
// E2E_STEREO_ROUTES=none starts with an empty one (P5, T11).
if (OWNS_STATE_DIR) harness.seedState(STATE_DIR, { stereo: process.env.E2E_STEREO_ROUTES || undefined });

module.exports = {
  testDir: './e2e',
  globalTeardown: require.resolve('./e2e/helpers/global-teardown.js'),
  // Per-lane, or two concurrent runs overwrite each other's screenshots and
  // traces — which is exactly the evidence a finding depends on.
  outputDir: `./test-results/lane${LANE}`,
  // A Strip flow is a sequence — file, clear, taxi — so a spec is not a unit
  // test and retrying half of one proves nothing. One worker, no retries, and
  // a failure is a real failure.
  workers: 1,
  retries: 0,
  // A whole-test ceiling, not a wait: every wait inside a spec is an expect/poll on state with its own
  // 5-10 s limit. 20 s sat at 19-21 s for the multi-controller specs under load (E2EH, three files hit it
  // in one run on a busy machine), so a slow machine failed a spec that was progressing.
  timeout: 60000,
  expect: { timeout: 5000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    // On by default rather than on-failure: these tests exist to catch things
    // a human notices by looking, so the artefact of a run should be something
    // a human can look at.
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1600, height: 1000 },
  },
  webServer: [
    {
      // The supervisor restarts crc-sync on a clean state directory when the test reset hook ends it
      // (crc-sync/src/test-reset.js, e2e/helpers/test.js). It adds CRCSYNC_TEST_RESET=1 itself.
      command: 'node e2e/helpers/sync-supervisor.js',
      cwd: __dirname,
      // `port`, not `url`: crc-sync serves no `/` route, so polling for a 2xx
      // there waits forever on a server that is up and working. This just
      // asks whether it is listening, which is the actual question.
      port: CRC_SYNC_PORT,
      reuseExistingServer: REUSE,
      timeout: 60000,
      env: { ...syncEnv, E2E_STATE_DIR: STATE_DIR },
    },
    {
      // app/server.js is what main.js requires; these are the env vars it sets
      // before doing so, minus the ones only the Electron shell uses.
      command: 'node app/server.js',
      cwd: __dirname,
      port: APP_PORT,
      reuseExistingServer: REUSE,
      timeout: 30000,
      env: {
        WS_PORT: String(APP_PORT),
        CRCSYNC_URL: `ws://localhost:${CRC_SYNC_PORT}`,
        CASDOOR_CLIENT_ID: 'e2e',
        CASDOOR_ENDPOINT: 'http://localhost:1',
        SRS_RADIO_API_PORT: '1',
      },
    },
  ],
};
