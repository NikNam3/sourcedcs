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

/**
 * Puts INCIRLIK's field state back to OPEN with no change open, whatever an earlier spec file left.
 *
 * crc-sync is started once for the whole run, so a spec that fails between "suspend the runway" and
 * its own clean-up leaves 05/23 suspended for every file after it (l4-chain and l4-drag then get a
 * flight stuck at TAXI: "runway 05/23 suspended — works in progress"). One controller holding TWR,
 * OPS and APP can walk every reset step, so a fresh page does it. Cheap when nothing is wrong.
 */
async function resetFieldState(browser, baseURL) {
  const { openPanel } = require('./app');
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1600, height: 1000 } });
  try {
    const page = await ctx.newPage();
    await openPanel(page, { held: ['TWR', 'OPS', 'APP'], controller: 'e2e-reset' });
    await page.waitForFunction(() => typeof getEfspFieldState === 'function' && !!getEfspFieldState('INCIRLIK'), null, { timeout: 10000 });
    for (let i = 0; i < 8; i++) {
      const op = await page.evaluate(() => {
        const f = getEfspFieldState('INCIRLIK');
        const r = f.runways[0];
        const c = f.runwayChange;
        if (r.pendingRequest) return ['TWR', { kind: 'RejectRunwayRequest', runwayId: r.runwayId, note: 'e2e reset' }];
        if (c && ['PROPOSED', 'ACKNOWLEDGED'].includes(c.state)) return ['TWR', { kind: 'WithdrawRunwayChange' }];
        if (c && c.state === 'IN_PROGRESS') return ['TWR', { kind: 'CompleteRunwayChange' }];
        if (r.status === 'CLOSED') return ['TWR', { kind: 'OpenRunway', runwayId: r.runwayId }];
        if (r.status === 'SUSPENDED_WORKS') return ['OPS', { kind: 'CompleteRunwayWorks', runwayId: r.runwayId }];
        if (r.status === 'SUSPENDED_INSPECTION') return ['OPS', { kind: 'CompleteInspection', runwayId: r.runwayId }];
        return null;
      });
      if (!op) return;
      const before = await page.evaluate(() => getEfspFieldState('INCIRLIK').rev);
      await page.evaluate(([p, o]) => sendEfspFieldStateMutation(p, 'INCIRLIK', getEfspFieldState('INCIRLIK').rev, o), op);
      await base.expect.poll(() => page.evaluate(() => getEfspFieldState('INCIRLIK').rev), { timeout: 5000 }).toBeGreaterThan(before);
    }
    throw new Error('e2e reset: the field would not go back to OPEN');
  } finally {
    await ctx.close().catch(() => {});
    // Positions are released on disconnect; let crc-sync see it before the spec takes them.
    await new Promise((r) => setTimeout(r, 300));
  }
}

let lastFile = null;

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
  // First test of each spec file: undo whatever field state the previous file left behind.
  _freshField: [async ({ browser }, use, testInfo) => {
    if (testInfo.file !== lastFile) {
      lastFile = testInfo.file;
      await resetFieldState(browser, testInfo.project.use.baseURL);
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

module.exports = { test, expect: base.expect, serveCdnFromNodeModules, resetFieldState };
