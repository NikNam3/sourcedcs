'use strict';

// Everything the host has to do BEFORE the first require of anything under
// crc-sync/src/ (briefing §8 T4): every state path points into the soak's temp
// directory, Date.now becomes the virtual clock, Math.random becomes seeded,
// console output is captured into counters, and the two functions the soak
// instruments (order-key's keyBetween, fs.writeFileSync for the Board
// snapshot) are wrapped. Wrapping happens here and only here — no file under
// src/ is edited (briefing D6).

const fs = require('fs');
const path = require('path');
const util = require('util');
const { mulberry32, deriveSeed } = require('./prng');

const SRC = path.join(__dirname, '../../src');

/** The env the host needs, all pointed into `stateDir`. Written by the driver before the host starts; see run.js writeFixtures(). */
function envFor(stateDir) {
  const p = (name) => path.join(stateDir, name);
  return {
    CRCSYNC_STATE_DIR: stateDir,
    // An empty config dir: nothing shipped in crc-sync/config/ is read, so the
    // soak cannot drift with a squadron config edit. facility-config falls back
    // to its in-code DEFAULT_CONFIG exactly as the tests do (briefing §3.6).
    CRCSYNC_CONFIG_DIR: p('config-empty'),
    CRCSYNC_EFSP_FACILITY_CONFIG_PATH: p('facility-incirlik.json'),
    CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: p('facility-center.json'),
    CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: p('facility-tactical.json'),
    CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: p('board.json'),
    CRCSYNC_EFSP_MUTATION_LOG_PATH: p('mutations.jsonl'),
    CRCSYNC_EFSP_AIRSPACES_PATH: p('airspaces.json'),
    CRCSYNC_EFSP_STEREO_ROUTES_PATH: p('stereo-routes.json'),
    CRCSYNC_APT_CONFIG_PATH: p('apt-config.json'),
    CRCSYNC_TERRAIN_CACHE_DIR: p('terrain'),
    CRCSYNC_SENSOR_SPECS_PATH: p('sensor-specs.json'),
    CRCSYNC_DCS_GRPC_HOST: '127.0.0.1:1',
    DCS_GRPC_HOST: '127.0.0.1:1',
    CRCSYNC_SRS_HOST: '127.0.0.1',
    CRCSYNC_SRS_PORT: '1',
    SRS_HOST: '127.0.0.1',
    SRS_PORT: '1',
    CRCSYNC_MAPTILER_KEY: '',
  };
}

/**
 * @param {object} o
 * @param {string} o.stateDir   the temp state directory (already populated with fixtures)
 * @param {number} o.seed
 * @param {number} o.startNow   virtual epoch ms the clock starts at
 * @param {string} [o.logPath]  host.log
 * @param {boolean} [o.patchGlobals=true]
 * @param {number} [o.lifetime=1]  host lifetime (restart count + 1), so seeded ids differ per process
 */
function setupHostEnv({ stateDir, seed, startNow, logPath, patchGlobals = true, lifetime = 1 }) {
  Object.assign(process.env, envFor(stateDir));

  const clock = { now: startNow };
  function seedIds(life) {
    const nextId = mulberry32(deriveSeed(seed, `host-uuid-${life}`));
    const hex = (n) => Math.floor(nextId() * 16 ** n).toString(16).padStart(n, '0');
    require('crypto').randomUUID = () => `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(nextId() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
  }
  const realDateNow = Date.now;
  if (patchGlobals) {
    // D2: the virtual clock. Every clock read under src/efsp, tracks.js and
    // stca.js is Date.now() or an injected clock — checked while the briefing
    // was written — so a four-hour soak runs in minutes and the 400ms
    // double-tap latch is satisfied by arithmetic, not by sleeping.
    Date.now = () => clock.now;
    // D5: order-key.js's jitter (and anything else that rolls a die) becomes
    // reproducible. crypto.randomUUID is left alone: Strip and FDR ids differ
    // between runs, which no criterion depends on. The report header says the
    // server's randomness was replaced so nobody mistakes it for production.
    Math.random = mulberry32(deriveSeed(seed, 'host-math-random'));
    // crypto.randomUUID too, which the briefing (D5) left alone: getRack()
    // breaks an order-key tie by stripId (board-store.js getRack), so random
    // ids made a stress run's reorder storms diverge between two runs of one
    // seed. Seeded per host lifetime so a restart never re-issues an id.
    seedIds(lifetime);
  }

  // ── console capture (briefing §8 T5) ──────────────────────────────────
  const consoleStats = new Map(); // prefix -> { count, first: [text...] }
  let logFd = null;
  let logLines = 0;
  const LOG_LINE_CAP = 20000;
  if (logPath) logFd = fs.openSync(logPath, 'a');
  const counters = {
    internalErrors: 0,          // '[board-store] unexpected error'
    storeInternalErrors: 0,     // any other store's catch-all
    exhaustedThrows: 0,         // order-key ORDER_KEY_EXHAUSTED thrown by keyBetween
    persistCount: 0,
    persistBytes: 0,
    persistMs: [],              // drained per reply
    crashBeforePersist: false,  // R2 inject: SIGKILL self instead of writing the snapshot
  };
  const prefixOf = (text) => {
    const m = /^(\[[^\]]{1,60}\][^:—\n]{0,60})/.exec(text);
    return (m ? m[1] : text.slice(0, 50)).trim();
  };
  const capture = (level) => (...args) => {
    const text = util.format(...args);
    const prefix = `${level} ${prefixOf(text)}`;
    let s = consoleStats.get(prefix);
    if (!s) { s = { count: 0, first: [] }; consoleStats.set(prefix, s); }
    s.count++;
    if (s.first.length < 20) s.first.push(text.slice(0, 2000));
    if (text.startsWith('[board-store] unexpected error')) counters.internalErrors++;
    else if (/unexpected error applying/.test(text)) counters.storeInternalErrors++;
    if (logFd !== null && logLines < LOG_LINE_CAP && s.count <= 200) {
      logLines++;
      fs.writeSync(logFd, `${new Date(clock.now).toISOString()} ${level} ${text.slice(0, 4000)}\n`);
    }
  };
  if (patchGlobals) {
    console.log = capture('log');
    console.info = capture('info');
    console.warn = capture('warn');
    console.error = capture('error');
    console.debug = capture('debug');
  }

  // ── order-key: count exhaustion throws (briefing §5.7) ────────────────
  // board-store.js destructures keyBetween at require time, so the property
  // has to be replaced before board-store is first required.
  // Called again by an in-process restart, which purges the require cache and
  // so gets a fresh, unwrapped order-key module.
  function wrapOrderKey() {
    const orderKey = require(path.join(SRC, 'efsp/order-key.js'));
    if (orderKey.keyBetween.__soak) return;
    const origKeyBetween = orderKey.keyBetween;
    orderKey.keyBetween = function soakKeyBetween(a, b) {
      try { return origKeyBetween(a, b); } catch (err) {
        if (err && err.code === 'ORDER_KEY_EXHAUSTED') counters.exhaustedThrows++;
        throw err;
      }
    };
    orderKey.keyBetween.__soak = true;
  }
  wrapOrderKey();

  // ── fs.writeFileSync: time _persist, and the R2 crash-before-persist ──
  const snapshotTmp = path.join(stateDir, 'board.json') + '.tmp';
  const origWrite = fs.writeFileSync;
  fs.writeFileSync = function soakWriteFileSync(file, data, ...rest) {
    if (file === snapshotTmp) {
      if (counters.crashBeforePersist) {
        if (patchGlobals && process.send) process.kill(process.pid, 'SIGKILL');
        // In-process there is no process to kill: refuse the write, which
        // _persist's own catch turns into a warning. The host instance is then
        // discarded by the restart, so the on-disk Board is exactly what a
        // crash at this instant would have left.
        counters.crashBeforePersist = false;
        counters.crashed = true;
        throw new Error('soak: simulated crash before persist');
      }
      const t0 = performance.now();
      const r = origWrite.call(fs, file, data, ...rest);
      counters.persistMs.push(performance.now() - t0);
      counters.persistCount++;
      counters.persistBytes += typeof data === 'string' ? Buffer.byteLength(data) : (data.length || 0);
      return r;
    }
    return origWrite.call(fs, file, data, ...rest);
  };

  return {
    clock,
    counters,
    consoleStats,
    realDateNow,
    wrapOrderKey,
    seedIds,
    closeLog() { if (logFd !== null) { fs.closeSync(logFd); logFd = null; } },
  };
}

module.exports = { setupHostEnv, envFor, SRC };
