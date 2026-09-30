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
  // The default per-test context is created by the `context` fixture, which may have been built
  // before the auto fixture ran; route it explicitly.
  context: async ({ context }, use) => {
    await serveCdnFromNodeModules(context);
    await use(context);
  },
});

module.exports = { test, expect: base.expect, serveCdnFromNodeModules };
