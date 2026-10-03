'use strict';

/* DESK-SIGNON (docs/wip/DESK-SIGNON.md): a reconnect must not sign the controller off. crc-sync holds a closed
 * session's sign-ons for a short grace (config/sign-on-grace.json, 15 s), and the client declares its Positions again on every
 * connect and adopts the server's ack. A drop shorter than the grace changes nothing; a drop longer than it is
 * recovered by the re-declaration; an Observer is not offered Primary's actions. */

const { test, expect } = require('./helpers/test');
const { openPanel, dropStrips } = require('./helpers/app');

test.describe.configure({ timeout: 90000 });
test.use({ viewport: { width: 1500, height: 1000 } });

const _contexts = [];
test.afterEach(async () => { while (_contexts.length) await _contexts.pop().close().catch(() => {}); });

async function second(browser, opts) {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1500, height: 1000 } });
  _contexts.push(ctx);
  const page = await ctx.newPage();
  await openPanel(page, opts);
  return page;
}

/** Kills the socket and keeps it down (every attempt is aimed at a dead port) until `up()`. */
async function dropSocket(page) {
  await page.evaluate(() => {
    const Real = window.WebSocket;
    window.__blockWs = true;
    window.__blockedAttempts = 0;
    window.WebSocket = function (url, protocols) { if (window.__blockWs) window.__blockedAttempts += 1; return new Real(window.__blockWs ? 'ws://127.0.0.1:1/' : url, protocols); };
    window.WebSocket.prototype = Real.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) window.WebSocket[k] = Real[k];
    crc.app._ws.close();
  });
  await expect.poll(() => page.evaluate(() => crc.app._ws === null)).toBe(true);
}
const raise = (page) => page.evaluate(() => { window.__blockWs = false; });
const acks = (page) => { const n = []; page.on('websocket', (ws) => ws.on('framereceived', (f) => { try { if (JSON.parse(f.payload).type === 'efsp-positions-ack') n.push(JSON.parse(f.payload)); } catch (_) { /* not JSON */ } })); return n; };

async function createsAStrip(page, callsign) {
  await page.evaluate((cs) => crc.ws.sendEfspCreateStrip('OPS', { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE',
    flightData: { callsign: cs, aircraftType: 'F16', wakeCategory: 'D' } }, 'INCIRLIK'), callsign);
  await expect.poll(() => page.evaluate((cs) => crc.state.getAllEfspStrips().some(s => {
    const f = crc.state.getEfspFlightData(s.flightDataId); return f && f.identity.callsign === cs && s.state !== 'DROPPED';
  }), callsign), { timeout: 10000 }).toBe(true);
}

test('a short drop keeps the controller signed on and actions still work', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS'], controller: 'e2e-signon-blip' });
  const seen = acks(page);
  await dropSocket(page);
  // The drop lasts until the client has tried to reconnect and been refused once; it is far inside the 15 s grace.
  await expect.poll(() => page.evaluate(() => window.__blockedAttempts)).toBeGreaterThanOrEqual(1);
  await raise(page);
  // the reconnect declares again and the server's ack says it is still signed on
  await expect.poll(() => seen.length, { timeout: 15000 }).toBeGreaterThanOrEqual(1);
  expect(seen[seen.length - 1].signedOn).toEqual(['OPS']);
  expect(await page.evaluate(() => crc.ws.getActingPositions('INCIRLIK'))).toEqual(['OPS']);
  const callsign = `SON${Date.now() % 10000}`;
  try { await createsAStrip(page, callsign); } finally { await dropStrips(page, [callsign]); }
});

test('a drop longer than the grace is recovered by the re-declaration', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS'], controller: 'e2e-signon-long' });
  const seen = acks(page);
  await dropSocket(page);
  // Past the 15 s grace: crc-sync has signed the dropped controller off. This is the one wait that stays: the grace is the
  // SERVER's wall clock (config/sign-on-grace.json) and the spec's whole point is that it has run out. The sign-off is not
  // visible to this page, so there is no signal to poll; 17 s is the grace plus its two-second margin.
  await page.waitForTimeout(17000);
  await raise(page);
  await expect.poll(() => seen.length, { timeout: 15000 }).toBeGreaterThanOrEqual(1);
  expect(seen[seen.length - 1].signedOn).toEqual(['OPS']);
  expect(await page.evaluate(() => crc.ws.getActingPositions('INCIRLIK'))).toEqual(['OPS']);
  const callsign = `SOL${Date.now() % 10000}`;
  try { await createsAStrip(page, callsign); } finally { await dropStrips(page, [callsign]); }
});

test('an Observer is not offered Primary’s actions', async ({ browser, page }) => {
  await openPanel(page, { signedOn: ['OPS'], controller: 'e2e-signon-primary' });
  const obs = await second(browser, { signedOn: ['OPS'], controller: 'e2e-signon-observer' });
  await expect.poll(() => obs.evaluate(() => crc.ws.getSignedOnPositions('INCIRLIK')), { timeout: 10000 }).toEqual(['OPS']);
  await expect.poll(() => obs.evaluate(() => crc.ws.isObserverAt('INCIRLIK', 'OPS')), { timeout: 10000 }).toBe(true);
  expect(await obs.evaluate(() => crc.ws.getActingPositions('INCIRLIK'))).toEqual([]);
  expect(await page.evaluate(() => crc.ws.getActingPositions('INCIRLIK'))).toEqual(['OPS']);
});
