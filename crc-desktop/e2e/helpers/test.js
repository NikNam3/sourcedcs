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
 * Gives the spec file a brand-new crc-sync: no Strips, no FDRs, field state as shipped, no
 * carrier/ATO/metrics/replay history, no Positions held. The hook ends the process and the
 * supervisor starts a clean one (crc-sync/src/test-reset.js), so nothing an earlier spec did, or
 * failed to undo, is visible and a spec file means the same thing alone or in any order. Called once
 * per file, by the first test of it (`_freshSync`).
 */
async function resetSync(file) {
  const before = await bootId();
  let marker = '';
  try { marker = fs.readFileSync(MARKER, 'utf8'); } catch (_) { /* first run */ }
  if (marker === `${before}|${file}`) return; // a worker restart after a failed test must not wipe the rest of the file
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
  // First test of each spec file: a new crc-sync, whatever the previous file left behind.
  _freshSync: [async ({}, use, testInfo) => {
    await resetSync(testInfo.file);
    await use();
  }, { auto: true }],
  // The default per-test context is created by the `context` fixture, which may have been built
  // before the auto fixture ran; route it explicitly.
  context: async ({ context }, use) => {
    await serveCdnFromNodeModules(context);
    await use(context);
  },
});

module.exports = { test, expect: base.expect, serveCdnFromNodeModules, resetSync };
