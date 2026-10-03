'use strict';

/* The wire protocol handshake in a real browser (crc-sync docs/adr/0103).
 *
 * crc-sync is told to speak another protocol through its test hook (POST /__test/wire-protocol, same gates as the reset hook), so the
 * page, which sends its compiled-in protocol, is refused with one update-required frame and close 4426. The overlay must show the right
 * text for older and newer, and no reconnect storm may follow: at most one connect per Retry. Run with E2E_LANE=3.
 */

const { test, expect } = require('./helpers/test');
const { fakeToken } = require('./helpers/app');

const LANE = Number(process.env.E2E_LANE || 0);
const SYNC = `http://127.0.0.1:${3010 + LANE}`;
const CLIENT_PROTOCOL = Number(/WIRE_PROTOCOL\s*=\s*(\d+)/.exec(require('fs').readFileSync(require('path').join(__dirname, '../app/public/js/wire-protocol.js'), 'utf8'))[1]);

async function setServerProtocol(n) {
  const r = await fetch(`${SYNC}/__test/wire-protocol`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ protocol: n }) });
  if (!r.ok) throw new Error(`wire-protocol hook refused: HTTP ${r.status}`);
}

// "Nothing more happened" is proved on the page's own clock: runFor() fires every timer due in the span, so a reconnect
// loop (the old one retried every 2 s) would show up as a new /feed socket after a few milliseconds of real time.
async function quietFor(page, ms) {
  await page.clock.runFor(ms);
  await page.evaluate(() => 0); // a round trip, so the websocket events the span may have caused have arrived
}

async function open(page) {
  await page.clock.install();
  const feeds = [];
  page.on('websocket', (ws) => { if (ws.url().includes('/feed')) feeds.push(ws.url()); });
  await page.addInitScript(([key, token]) => { try { localStorage.setItem(key, token); } catch (_) { /* private mode */ } }, ['crc-desktop-sync-token', fakeToken('e2e-update')]);
  await page.goto('/');
  return feeds;
}

test.afterEach(async () => { await setServerProtocol(CLIENT_PROTOCOL); });

test('an older client sees Update required, does not reconnect, and Retry connects once', async ({ page }) => {
  await setServerProtocol(CLIENT_PROTOCOL + 1);
  const feeds = await open(page);
  const overlay = page.locator('#crc-update-required');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText(`Update required. This crc-sync speaks a newer protocol (server ${CLIENT_PROTOCOL + 1}, CRC ${CLIENT_PROTOCOL})`);
  await expect(overlay).toContainText('No update is published yet');
  expect(feeds[0]).toContain(`protocol=${CLIENT_PROTOCOL}`);
  expect(feeds[0]).toContain('client=dev');

  // No reconnect storm: the old loop retried every 2 s.
  await quietFor(page, 5000);
  expect(feeds.length).toBe(1);

  await page.locator('#crc-update-retry').click();
  await expect.poll(() => feeds.length).toBe(2);
  await expect(overlay).toBeVisible();
  await quietFor(page, 4500);
  expect(feeds.length).toBe(2);
});

test('a newer client is told the server must be updated first', async ({ page }) => {
  await setServerProtocol(CLIENT_PROTOCOL - 1 || 1);
  if (CLIENT_PROTOCOL < 2) test.skip(true, 'there is no protocol below 1');
  await open(page);
  await expect(page.locator('#crc-update-required')).toContainText('The server must be updated first');
});

test('Retry after the server is updated connects and the overlay goes away', async ({ page }) => {
  await setServerProtocol(CLIENT_PROTOCOL + 1);
  const feeds = await open(page);
  await expect(page.locator('#crc-update-required')).toBeVisible();
  await setServerProtocol(CLIENT_PROTOCOL);
  await page.locator('#crc-update-retry').click();
  await expect(page.locator('#crc-update-required')).toHaveCount(0);
  await quietFor(page, 1500);
  expect(feeds.length).toBe(2);
  await expect(page.locator('#crc-update-required')).toHaveCount(0);
});
