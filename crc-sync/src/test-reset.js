'use strict';

/* TEST-ONLY reset hook for the Playwright harness (crc-desktop/e2e). docs/wip/E2EH.md, Q3-14.
 *
 * The browser suite shares one crc-sync for a whole run, so a spec that leaves anything behind (a
 * suspended runway, a scramble, a Strip, an active runway) changes every later spec. "Clear every
 * store" would have to know every store, monitor, replay cache and ring buffer in the process, and
 * the next store added would silently not be in the list. So the hook does not clear anything: it
 * ends the process with exit code 75 (EX_TEMPFAIL) and the harness's supervisor
 * (crc-desktop/e2e/helpers/sync-supervisor.js) wipes the throwaway state directory and starts a new
 * one. A new process is a known Board by construction (about 0.8 s).
 *
 * It cannot run in production:
 *   - nothing is mounted unless CRCSYNC_TEST_RESET is exactly '1' (no Dockerfile, compose file or
 *     .env.example sets it; tests/test-reset.test.mjs asserts that),
 *   - mounting with NODE_ENV=production throws, so a mis-set variable stops the service at boot
 *     instead of exposing a route that kills it,
 *   - the routes answer loopback peers only (the harness is on the same machine; behind nginx the
 *     peer is the proxy, which is not loopback in the Docker stack).
 */

const crypto = require('crypto');

const RESET_EXIT_CODE = 75;
const BOOT_ID = crypto.randomUUID();

function isLoopback(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * @returns {boolean} whether the hook was mounted
 */
function mountTestReset(app, { env = process.env, exit = (code) => process.exit(code), delayMs = 50 } = {}) {
  if (env.CRCSYNC_TEST_RESET !== '1') return false;
  if (env.NODE_ENV === 'production') {
    throw new Error('CRCSYNC_TEST_RESET=1 with NODE_ENV=production: the test reset hook must never run in production');
  }
  const guard = (req, res, next) => (isLoopback(req.socket && req.socket.remoteAddress) ? next() : res.status(404).end());

  app.get('/__test/boot', guard, (_req, res) => res.json({ bootId: BOOT_ID }));
  app.post('/__test/reset', guard, (_req, res) => {
    res.json({ ok: true, bootId: BOOT_ID });
    // Let the response flush, then die; the supervisor starts a clean process.
    setTimeout(() => exit(RESET_EXIT_CODE), delayMs);
  });
  return true;
}

module.exports = { mountTestReset, RESET_EXIT_CODE };
