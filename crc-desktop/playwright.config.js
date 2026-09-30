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
//
// E2E_LANE lets several cataloguing agents run at once without fighting over
// ports or output directories. Lane 0 is the default, so anything that does
// not set it behaves exactly as before.
const LANE = Number(process.env.E2E_LANE || 0);
if (!Number.isInteger(LANE) || LANE < 0 || LANE > 9) {
  throw new Error(`E2E_LANE must be an integer 0-9, got ${process.env.E2E_LANE}`);
}
const CRC_SYNC_PORT = 3010 + LANE;
const APP_PORT = 3110 + LANE;

// Every piece of crc-sync's durable state is redirected into a throwaway
// directory. state-paths.js's override short-circuits BOTH the read and the
// write, so this also escapes the `config/` fallback — which is exactly what
// made a "cleared" Board keep coming back during development.
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), `crc-e2e-lane${LANE}-`));
const stateFile = (name) => path.join(STATE_DIR, name);

const syncEnv = {
  PORT: String(CRC_SYNC_PORT),
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: stateFile('efsp-board.json'),
  CRCSYNC_EFSP_MUTATION_LOG_PATH: stateFile('efsp-mutations.jsonl'),
  CRCSYNC_EFSP_AIRSPACES_PATH: stateFile('efsp-airspaces.json'),
  CRCSYNC_EFSP_STEREO_ROUTES_PATH: stateFile('efsp-stereo-routes.json'),
  CRCSYNC_TERRAIN_CACHE_DIR: stateFile('terrain'),
  // WP8's durable files (crc-sync docs/adr/0065). Without these a run writes
  // metrics into the worktree's crc-sync/state/ and reads old buckets back on
  // the next run (L15, T11). The instrumentation config is read-only, so it
  // points at a copy of the shipped default, never at a stale state/ override.
  CRCSYNC_EFSP_METRICS_PATH: stateFile('efsp-metrics.json'),
  CRCSYNC_EFSP_TRAFFIC_COUNT_PATH: stateFile('efsp-traffic-count.jsonl'),
  CRCSYNC_EFSP_INSTRUMENTATION_CONFIG_PATH: stateFile('efsp-instrumentation.json'),
  // No DCS, no SRS. Both clients retry forever and neither blocks the EFSP
  // subsystem, so pointing them at a closed port keeps the run hermetic and
  // fails fast instead of hanging on a real host.
  //
  // The UNPREFIXED names, because that is what crc-sync's process reads
  // (grpc-client.js / srs-client.js). The CRCSYNC_* names are only
  // infra/docker-compose.yml's .env keys, which compose maps onto these.
  // Setting CRCSYNC_* here was silently ignored, so every run connected to
  // the production defaults (server.sourcedcs.page:50051 and :5002).
  DCS_GRPC_HOST: '127.0.0.1:1',
  SRS_HOST: '127.0.0.1',
  SRS_PORT: '1',
};

fs.writeFileSync(syncEnv.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');
// Opt-in stereo table (crc-sync's docs/adr/0073): E2E_STEREO_ROUTES=<file> copies that table in
// place of the empty one, for the specs that pick a route; every other run is unaffected (P5, T11).
fs.writeFileSync(syncEnv.CRCSYNC_EFSP_STEREO_ROUTES_PATH, process.env.E2E_STEREO_ROUTES ? fs.readFileSync(process.env.E2E_STEREO_ROUTES) : '[]');
fs.copyFileSync(path.join(__dirname, '..', 'crc-sync', 'config', 'efsp-instrumentation.json'), syncEnv.CRCSYNC_EFSP_INSTRUMENTATION_CONFIG_PATH);

module.exports = {
  testDir: './e2e',
  // Per-lane, or two concurrent runs overwrite each other's screenshots and
  // traces — which is exactly the evidence a finding depends on.
  outputDir: `./test-results/lane${LANE}`,
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
        SRS_RADIO_API_PORT: '1',
      },
    },
  ],
};
