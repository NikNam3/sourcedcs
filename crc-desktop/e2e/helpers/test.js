'use strict';

/* The `test`/`expect` every spec uses, instead of requiring '@playwright/test' directly.
 *
 * index.html loads dockview-core from cdn.jsdelivr.net and maplibre-gl from unpkg.com. Every e2e
 * page load therefore depended on two public CDNs, and when they hiccup (or a dozen agents reload
 * at once) initDock() never completes and the run fails with an ENV error that says nothing about
 * the product ("toggleDockPanel: Cannot read properties of null (reading 'api')").
 *
 * This serves both from node_modules (devDependencies, pinned to the versions index.html names) on
 * EVERY browser context, including the ones specs open by hand with browser.newContext().
 */

const base = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const NM = path.join(__dirname, '..', '..', 'node_modules');
const VENDORED = [
  [/^https:\/\/cdn\.jsdelivr\.net\/npm\/dockview-core@[^/]+\/dist\/dockview-core\.js(\?.*)?$/, 'dockview-core/dist/dockview-core.js', 'application/javascript'],
  [/^https:\/\/unpkg\.com\/maplibre-gl@[^/]+\/dist\/maplibre-gl\.js(\?.*)?$/, 'maplibre-gl/dist/maplibre-gl.js', 'application/javascript'],
  [/^https:\/\/unpkg\.com\/maplibre-gl@[^/]+\/dist\/maplibre-gl\.css(\?.*)?$/, 'maplibre-gl/dist/maplibre-gl.css', 'text/css'],
];

async function serveCdnFromNodeModules(context) {
  for (const [re, rel, type] of VENDORED) {
    await context.route(re, (route) => route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(path.join(NM, rel)) }));
  }
  // MAPKEY: the e2e crc-sync has no MapTiler key, so the client has none. Nothing may leave the machine for MapTiler:
  // answer it as MapTiler does a key-less request (403), which is the no-key path the app really takes. Sprite and
  // tiles both land here; the Background layer is the basemap.
  await context.route(/^https:\/\/api\.maptiler\.com\//, (route) => route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"Invalid key"}' }));
}

const PATCHED = Symbol('cdn-patched');

const LANE = Number(process.env.E2E_LANE || 0);
const SYNC_URL = `http://127.0.0.1:${3010 + LANE}`;
// Which spec file the running crc-sync process was last reset for: "<bootId>|<file>". The boot id
// makes a marker left by an earlier run, or by a crc-sync that has since restarted, harmless.
const MARKER = path.join(os.tmpdir(), `crc-e2e-lane${LANE}-fresh-for`);

async function bootId() {
  const r = await fetch(`${SYNC_URL}/__test/boot`);
  if (!r.ok) throw new Error(`crc-sync has no test reset hook (HTTP ${r.status}); the harness must start it with CRCSYNC_TEST_RESET=1 (e2e/helpers/sync-supervisor.js)`);
  return (await r.json()).bootId;
}

/**
 * Gives the spec file a brand-new crc-sync: no Strips, no flight-data records, runway status as shipped, no
 * carrier/ATO/metrics/replay history, no Positions held. The hook ends the process and the
 * supervisor starts a clean one (crc-sync/src/test-reset.js), so nothing an earlier spec did, or
 * failed to undo, is visible and a spec file means the same thing alone or in any order. Called before
 * every test (`_freshSync`), or, for a file whose tests build on each other (`test.use({ resetScope: 'file' })`),
 * once per file by the first test of it. `force` skips the once-per-file marker.
 */
async function resetSync(file, { force = false } = {}) {
  const before = await bootId();
  let marker = '';
  try { marker = fs.readFileSync(MARKER, 'utf8'); } catch (_) { /* first run */ }
  // A worker restarts after a failed test; for a once-per-file file the marker lets the restart carry on with the file's
  // Board. A failed test clears the marker (`_freshSync`'s teardown), so the next test never starts on a dirty Board.
  if (!force && marker === `${before}|${file}`) return;
  const r = await fetch(`${SYNC_URL}/__test/reset`, { method: 'POST' });
  if (!r.ok) throw new Error(`crc-sync reset refused: HTTP ${r.status}`);
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const now = await bootId();
      if (now !== before) { fs.writeFileSync(MARKER, `${now}|${file}`); return; }
    } catch (e) { if (/no test reset hook/.test(e.message)) throw e; /* between processes */ }
    if (Date.now() > deadline) throw new Error('crc-sync did not come back after the test reset');
    await new Promise((res) => setTimeout(res, 100));
  }
}

const test = base.test.extend({
  _vendoredCdn: [async ({ browser }, use) => {
    if (!browser[PATCHED]) {
      browser[PATCHED] = true;
      const orig = browser.newContext.bind(browser);
      browser.newContext = async (...args) => {
        const ctx = await orig(...args);
        await serveCdnFromNodeModules(ctx);
        return ctx;
      };
      const origPage = browser.newPage.bind(browser);
      browser.newPage = async (...args) => {
        const page = await origPage(...args);
        await serveCdnFromNodeModules(page.context());
        return page;
      };
    }
    await use();
  }, { auto: true }],
  // 'test' (the default): every test starts on a new crc-sync, so a failure never leaks into the next test. A file whose
  // tests build on each other (runway-status's serial walk) says `test.use({ resetScope: 'file' })` and gets one reset per file.
  resetScope: ['test', { option: true }],
  _freshSync: [async ({ resetScope }, use, testInfo) => {
    await resetSync(testInfo.file, { force: resetScope === 'test' });
    await use();
    // Always reset after a failed test: the worker restart that follows must not find the marker and skip the reset.
    if (testInfo.status !== testInfo.expectedStatus) { try { fs.rmSync(MARKER, { force: true }); } catch (_) { /* nothing to clear */ } }
  }, { auto: true }],
  // The default per-test context is created by the `context` fixture, which may have been built
  // before the auto fixture ran; route it explicitly.
  context: async ({ context }, use) => {
    await serveCdnFromNodeModules(context);
    await use(context);
  },
});

module.exports = { test, expect: base.expect, serveCdnFromNodeModules, resetSync };
