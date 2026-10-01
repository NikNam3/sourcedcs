'use strict';

/* UI-B (docs/wip/UI-B.md): the client resync (S-12, ADR 0081) on screen. The websocket is killed
 * mid-session, a change is made by someone else while it is down, and the reconnect has to
 * (a) send an efsp-resync carrying the epoch and last seq the client held and (b) end with the
 * Board the server has. The Strip it creates is dropped at the end. */

const { test, expect } = require('./helpers/test');
const { openPanel, dropStrips } = require('./helpers/app');

test.describe.configure({ timeout: 60000 });
test.use({ viewport: { width: 1500, height: 1000 } });

const _contexts = [];
test.afterEach(async () => { while (_contexts.length) await _contexts.pop().close().catch(() => {}); });

async function controller(browser, opts) {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1500, height: 1000 } });
  _contexts.push(ctx);
  const page = await ctx.newPage();
  await openPanel(page, opts);
  return { page, ctx };
}

const has = (page, callsign) => page.evaluate((cs) => getAllEfspStrips().some(s => {
  const f = getEfspFdr(s.fdrId); return f && f.identity.callsign === cs && s.state !== 'DROPPED';
}), callsign);

test('a websocket killed mid-session reconnects, resyncs from its epoch and seq, and holds what it missed', async ({ browser, page }) => {
  await openPanel(page, { held: ['CD'], controller: 'e2e-ui-b-watcher' });
  const { page: other } = await controller(browser, { held: ['OPS'], controller: 'e2e-ui-b-actor' });

  const sent = [];
  page.on('websocket', (ws) => ws.on('framesent', (f) => { try { const m = JSON.parse(f.payload); if (m.type === 'efsp-resync') sent.push(m); } catch (_) { /* not JSON */ } }));

  const before = await page.evaluate(() => ({ epoch: efspResyncPositionFor(getEfspFacility()).boardEpoch, seq: getEfspBoardSeq() }));
  expect(before.epoch).toBeTruthy();

  // kill the socket (and keep it down) ...
  // (connect() builds its socket from the global WebSocket: while blocked, every attempt is aimed at a dead port,
  // errors, and retries on app.js's own 2 s timer, which is exactly a server that is down)
  await page.evaluate(() => {
    const Real = window.WebSocket;
    window.__blockWs = true;
    window.WebSocket = function (url, protocols) { return new Real(window.__blockWs ? 'ws://127.0.0.1:1/' : url, protocols); };
    window.WebSocket.prototype = Real.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) window.WebSocket[k] = Real[k];
    _ws.close();
  });
  await expect.poll(() => page.evaluate(() => _ws === null)).toBe(true);

  // ... while another controller changes the Board
  const callsign = `UIB${Date.now() % 10000}`;
  try {
    await other.evaluate((cs) => window.sendEfspCreateStrip('OPS', { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE',
      fdr: { callsign: cs, aircraftType: 'F16', wakeCategory: 'D' } }, 'INCIRLIK'), callsign);
    await expect.poll(() => has(other, callsign), { timeout: 10000 }).toBe(true);
    expect(await has(page, callsign), 'the watcher is offline and has not seen it').toBe(false);

    await page.evaluate(() => { window.__blockWs = false; });
    await expect.poll(() => has(page, callsign), { timeout: 15000 }).toBe(true);

    // the reconnect said where it was
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0].boardEpoch).toBe(before.epoch);
    expect(sent[0].lastBoardSeq).toBe(before.seq);
    expect(sent[0].facilityId).toBeTruthy();

    // and it converged on exactly the server's Board
    const server = await other.evaluate(() => JSON.stringify(getAllEfspStrips().map(s => `${s.stripId}:${s.rev}`).sort()));
    await expect.poll(() => page.evaluate(() => JSON.stringify(getAllEfspStrips().map(s => `${s.stripId}:${s.rev}`).sort()))).toBe(server);
  } finally {
    await dropStrips(other, [callsign]);
  }
});
