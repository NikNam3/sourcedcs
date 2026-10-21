'use strict';

/* What the Playwright harness gives crc-sync: the environment, and the files in its throwaway state directory.
 *
 * One module, three users: playwright.config.js (the first boot), e2e/helpers/sync-supervisor.js (every reset restart), and
 * tests/e2e-boot.test.mjs (which boots crc-sync exactly as the harness does, in `npm test`, so a change to a state or
 * config shape that the harness's files no longer satisfy fails there in two seconds instead of killing every spec;
 * `371bedde` was that break). The airspace file is a COPY of crc-sync's shipped default, never a literal, so it follows
 * the default's shape.
 */

const fs = require('fs');
const path = require('path');
const { fakeDcsPort } = require('./fake-dcs');

const SYNC_DIR = path.join(__dirname, '..', '..', '..', 'crc-sync');
const STEREO_FIXTURE = path.join(__dirname, '..', 'fixtures', 'l16-stereo-routes.json');

// Written once at the first boot and kept across resets: read-only inputs, not state the service writes. `terrain` is the
// DCS terrain cache directory (crc-sync docs/adr/0133), also read-only to crc-sync; empty unless a spec writes a synthetic
// grid there before its fake DCS loads the mission (terrain-contours.spec.js, which removes it again).
const KEEP = ['efsp-instrumentation.json', 'efsp-stereo-routes.json', 'terrain'];

/** crc-sync's environment for the harness: every durable file redirected into `stateDir`, no DCS, no SRS. */
function syncEnv(stateDir, port) {
  const stateFile = (name) => path.join(stateDir, name);
  return {
    PORT: String(port),
    // state-paths.js's override short-circuits BOTH the read and the write, so this also escapes the `config/` fallback,
    // which is what made a "cleared" Board keep coming back during development.
    CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: stateFile('efsp-board.json'),
    CRCSYNC_EFSP_MUTATION_LOG_PATH: stateFile('efsp-mutations.jsonl'),
    CRCSYNC_EFSP_AIRSPACES_PATH: stateFile('efsp-airspaces.json'),
    CRCSYNC_EFSP_STEREO_ROUTES_PATH: stateFile('efsp-stereo-routes.json'),
    // The runtime frequency table (crc-sync docs/adr/0131): a reset starts from the facility files' frequencies.
    CRCSYNC_EFSP_FREQUENCIES_PATH: stateFile('efsp-frequencies.json'),
    CRCSYNC_TERRAIN_CACHE_DIR: stateFile('terrain'),
    // No MapTiler key. server.js runs dotenv, and dotenv never overrides a key already set, so an empty value here keeps
    // the developer's key in crc-sync/.env out of every run: with it, each run pre-warmed the DEM into an empty cache and
    // re-asked for every failed tile on each coverage tick, against the real account's quota.
    CRCSYNC_MAPTILER_KEY: '',
    CRCSYNC_MAPTILER_CLIENT_KEY: '',
    // WP8's durable files (crc-sync docs/adr/0065). Without these a run writes metrics into the worktree's crc-sync/state/ and
    // reads old buckets back on the next run (L15, T11). The instrumentation config is read-only, so it points at a copy of
    // the shipped default, never at a stale state/ override.
    CRCSYNC_EFSP_METRICS_PATH: stateFile('efsp-metrics.json'),
    CRCSYNC_EFSP_TRAFFIC_COUNT_PATH: stateFile('efsp-traffic-count.jsonl'),
    CRCSYNC_EFSP_INSTRUMENTATION_CONFIG_PATH: stateFile('efsp-instrumentation.json'),
    // The NLA double-tap guard off (crc-sync docs/adr/0096): a spec that presses twice must not depend on how fast crc-sync
    // received the first. e2e/nla-guard.spec.js turns a guard back on for itself through the test hook.
    CRCSYNC_NLA_GUARD_MS: '0',
    // No DCS, no SRS. Both clients retry forever and neither blocks the EFSP subsystem, so a closed port keeps the run hermetic
    // and fails fast instead of hanging on a real host. crc-sync reads CRCSYNC_* first and the unprefixed names second
    // (grpc-client.js / srs-client.js), and dotenv never overrides a key already set, so both are set here: a CRCSYNC_* key
    // in crc-sync/.env must not point a run at a real DCS.
    // Nothing listens here unless a spec starts helpers/fake-dcs.js, so this is "no DCS" for every spec that does not.
    CRCSYNC_DCS_GRPC_HOST: `127.0.0.1:${fakeDcsPort(Number(port))}`,
    DCS_GRPC_HOST: `127.0.0.1:${fakeDcsPort(Number(port))}`,
    // The mission session (which theater is loaded) belongs to the throwaway state directory: without this a loaded mission
    // is written into the checkout's crc-sync/state/ and read back by every later run.
    CRCSYNC_MISSION_SESSION_PATH: stateFile('mission-session.json'),
    CRCSYNC_SRS_HOST: '127.0.0.1',
    CRCSYNC_SRS_PORT: '1',
    SRS_HOST: '127.0.0.1',
    SRS_PORT: '1',
  };
}

/** The airspace list as a first boot has it: a copy of crc-sync's shipped default. */
function seedAirspaces(stateDir) {
  fs.copyFileSync(path.join(SYNC_DIR, 'config', 'efsp-airspaces.json'), path.join(stateDir, 'efsp-airspaces.json'));
}

/**
 * Fills a state directory the way the first boot needs it. `stereo` is a file, or 'none' for an empty table
 * (E2E_STEREO_ROUTES in playwright.config.js; the default is the two-route fixture l16-picker-and-times.spec.js picks from).
 */
function seedState(stateDir, { stereo = STEREO_FIXTURE } = {}) {
  seedAirspaces(stateDir);
  fs.writeFileSync(path.join(stateDir, 'efsp-stereo-routes.json'), stereo === 'none' ? '[]' : fs.readFileSync(stereo));
  fs.copyFileSync(path.join(SYNC_DIR, 'config', 'efsp-instrumentation.json'), path.join(stateDir, 'efsp-instrumentation.json'));
}

/** What a reset does between two crc-sync processes: everything the service wrote goes, the airspace list starts as a first boot's. */
function wipeState(stateDir) {
  for (const name of fs.readdirSync(stateDir)) {
    if (KEEP.includes(name)) continue;
    fs.rmSync(path.join(stateDir, name), { recursive: true, force: true });
  }
  seedAirspaces(stateDir);
}

module.exports = { SYNC_DIR, STEREO_FIXTURE, syncEnv, seedState, wipeState };
