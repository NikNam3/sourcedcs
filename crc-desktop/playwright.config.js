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

// Deliberately NOT 3000/3100: a developer almost always has the real pair
// running while working on this, and an e2e run must never talk to it.
const CRC_SYNC_PORT = 3010;
const APP_PORT = 3110;

// Every piece of crc-sync's durable state is redirected into a throwaway
// directory. state-paths.js's override short-circuits BOTH the read and the
// write, so this also escapes the `config/` fallback — which is exactly what
// made a "cleared" Board keep coming back during development.
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crc-e2e-'));
const stateFile = (name) => path.join(STATE_DIR, name);

const syncEnv = {
  PORT: String(CRC_SYNC_PORT),
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: stateFile('efsp-board.json'),
  CRCSYNC_EFSP_MUTATION_LOG_PATH: stateFile('efsp-mutations.jsonl'),
  CRCSYNC_EFSP_AIRSPACES_PATH: stateFile('efsp-airspaces.json'),
  CRCSYNC_EFSP_STEREO_ROUTES_PATH: stateFile('efsp-stereo-routes.json'),
  CRCSYNC_TERRAIN_CACHE_DIR: stateFile('terrain'),
  // No DCS, no SRS. Both clients retry forever and neither blocks the EFSP
  // subsystem, so pointing them at a closed port keeps the run hermetic and
  // fails fast instead of hanging on a real host.
  CRCSYNC_DCS_GRPC_HOST: '127.0.0.1',
  CRCSYNC_DCS_GRPC_PORT: '1',
  CRCSYNC_SRS_HOST: '127.0.0.1',
  CRCSYNC_SRS_PORT: '1',
};

fs.writeFileSync(syncEnv.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');
fs.writeFileSync(syncEnv.CRCSYNC_EFSP_STEREO_ROUTES_PATH, '[]');

module.exports = {
  testDir: './e2e',
  // A Strip flow is a sequence — file, clear, taxi — so a spec is not a unit
  // test and retrying half of one proves nothing. One worker, no retries, and
  // a failure is a real failure.
  workers: 1,
  retries: 0,
  timeout: 20000,
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
      command: 'npm start',
      cwd: path.join(__dirname, '..', 'crc-sync'),
      // `port`, not `url`: crc-sync serves no `/` route, so polling for a 2xx
      // there waits forever on a server that is up and working. This just
      // asks whether it is listening, which is the actual question.
      port: CRC_SYNC_PORT,
      reuseExistingServer: false,
      timeout: 60000,
      env: syncEnv,
    },
    {
      // app/server.js is what main.js requires; these are the env vars it sets
      // before doing so, minus the ones only the Electron shell uses.
      command: 'node app/server.js',
      cwd: __dirname,
      port: APP_PORT,
      reuseExistingServer: false,
      timeout: 30000,
      env: {
        WS_PORT: String(APP_PORT),
        CRC_SYNC_URL: `ws://localhost:${CRC_SYNC_PORT}`,
        CASDOOR_CLIENT_ID: 'e2e',
        CASDOOR_ENDPOINT: 'http://localhost:1',
        SOURCEDCS_WEB_URL: 'http://localhost:1',
        SRS_RADIO_API_PORT: '1',
      },
    },
  ],
};
