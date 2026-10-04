// One place for the "temp state dir + CRCSYNC_*_PATH env" prologue that ~25 test files used to hand-write (SERVER-TIDY).
//
//   const paths = withPaths('efsp-foo-test-', { ...FACILITIES, ...BOARD });
//   paths.env             // a COPY of process.env plus the CRCSYNC_* paths: hand it to createApp({ env }), createEfsp({ env }),
//                         // createFacilityConfig({ env }), ... (config is read at construction from the env it is given)
//   paths.apply()         // only for a module that still reads process.env: sets the same keys on process.env, and
//                         // puts them back (and removes the dir) at process exit; paths.restore() does it earlier
//   paths.dir / paths.file('x.json')
//
// `map` is { ENV_NAME: 'file name under the dir' }. Only the keys a test names are set, so a key the test left alone
// keeps falling back to the isolated state/ the preload (isolate-state.mjs) already provides.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const FACILITIES = {
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
};
export const BOARD = { CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json' };
export const MUTATION_LOG = { CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl' };
export const AIRSPACES = { CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json' };
// Everything createApp() reads a path for: with `shippedConfig` the shipped config/*.json is copied to <dir>/config-empty
// (the Facilities' data and the tuning files have no code defaults), so a test can edit its copy without touching the checkout.
export const APP_PATHS = {
  CRCSYNC_CONFIG_DIR: 'config-empty',
  ...FACILITIES, ...BOARD, ...MUTATION_LOG, ...AIRSPACES,
  CRCSYNC_EFSP_TRAFFIC_COUNT_PATH: 'traffic-count.jsonl',
  CRCSYNC_EFSP_METRICS_PATH: 'metrics.json',
  CRCSYNC_TERRAIN_CACHE_DIR: 'terrain',
  CRCSYNC_MISSION_SESSION_PATH: 'session.json',
};

/**
 * @param {string} prefix  mkdtemp prefix
 * @param {Record<string,string>} [map]  env name -> file name inside the dir
 * @param {{ stateDir?: boolean, extraEnv?: Record<string,string|undefined> }} [opts]  stateDir: also point CRCSYNC_STATE_DIR at the dir
 */
export function withPaths(prefix, map = {}, { stateDir = false, extraEnv = {}, shippedConfig = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  if (shippedConfig) {
    const shipped = new URL('../../config/', import.meta.url);
    fs.mkdirSync(path.join(dir, 'config-empty'));
    for (const f of fs.readdirSync(shipped).filter(f => f.endsWith('.json'))) fs.copyFileSync(new URL(f, shipped), path.join(dir, 'config-empty', f));
  }
  const set = {};
  for (const [k, v] of Object.entries(map)) set[k] = path.join(dir, v);
  if (stateDir) set.CRCSYNC_STATE_DIR = dir;
  Object.assign(set, extraEnv);
  const env = { ...process.env };
  for (const [k, v] of Object.entries(set)) { if (v === undefined) delete env[k]; else env[k] = v; }
  let saved = null;
  const api = {
    dir, env,
    file: (name) => path.join(dir, name),
    apply() {
      if (saved) return api;
      saved = new Map();
      for (const [k, v] of Object.entries(set)) {
        saved.set(k, process.env[k]);
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
      process.on('exit', api.restore);
      return api;
    },
    restore() {
      if (saved) { for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } saved = null; }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
  return api;
}
