'use strict';

/* U-CA-OWNER (crc-sync docs/adr/0147, H176): a conflict alert is shown only at the Positions working its aircraft, against
 * the REAL crc-sync with two fake DCS units head-on (helpers/fake-dcs.js `units: true`), each tagged VFR by a controller
 * (ADR 0146: the strip's holder has track control).
 *
 * 1. A (AP) works one aircraft, B (LC) the other, C (PAR) neither, all three seeing both: A and B are sent the CA, C is not;
 *    each sees the other's Position letter on the other aircraft's data block (JO 7110.65BB para 5-14-6: "If another
 *    controller is involved in the alert, initiate coordination"); A's suppress leaves B's alert flashing and the reverse.
 * 2. One controller works both aircraft (AP and LC, consolidated in one session): one SUPPRESS from the data block's menu is
 *    one frame, and the alert stops flashing at both Positions (one person, one acknowledgement).
 *
 * The units are re-sent every 2 s: crc-sync drops a track not updated for 12 s, and alerts only on a track 10 s old.
 * Run on one E2E lane (the fake DCS listens next to the lane's crc-sync).
 */

const { test, expect } = require('./helpers/test');
const { openPanel, dropStrips } = require('./helpers/app');
const { startFakeDcs, fakeDcsPort } = require('./helpers/fake-dcs');

test.describe.configure({ timeout: 120000, mode: 'serial' });

const LANE = Number(process.env.E2E_LANE || 0);
let fake;
let keepAlive = null;
test.beforeAll(async () => { fake = await startFakeDcs(fakeDcsPort(3010 + LANE), { units: true }); });
test.afterAll(async () => { if (fake) await fake.stop(); });
test.afterEach(() => { if (keepAlive) clearInterval(keepAlive); keepAlive = null; });

const _contexts = [];
test.afterEach(async () => { while (_contexts.length) await _contexts.pop().close().catch(() => {}); });

async function controller(browser, opts) {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1500, height: 1000 } });
  _contexts.push(ctx);
  const page = await ctx.newPage();
  await openPanel(page, { facilityId: 'INCIRLIK', ...opts });
  return page;
}

/** Two aircraft 6 nm apart near Incirlik, head-on at the same altitude, closing at about 580 kt: a CA within a minute. */
function flyHeadOn() {
  const n = Date.now() % 10000;
  const one = { id: 71000 + n, name: `CAO${n}A`, lat: 37.15, lon: 35.43, altM: 1500, heading: 0, speed: 150 };
  const two = { id: 72000 + n, name: `CAO${n}B`, lat: 37.25, lon: 35.43, altM: 1500, heading: 180, speed: 150 };
  const send = () => { fake.setUnit(one); fake.setUnit(two); };
  send();
  keepAlive = setInterval(send, 2000);
  const [a, b] = [String(one.id), String(two.id)];
  return { one: a, two: b, conflictId: a < b ? `${a}|${b}` : `${b}|${a}`, n };
}

const inPicture = (page, ids) => expect.poll(() => page.evaluate((xs) => xs.every(x => crc.picture.latestFromServer.has(x)), ids),
  { message: 'both contacts in this picture', timeout: 30000 }).toBe(true);

/** Tags a contact VFR at a Position (StartFlightFollowing, ADR 0146): the strip's holder has the track. */
async function tag(page, positionId, trackId, callsign) {
  const ack = await page.evaluate(([p, id, cs]) => new Promise((resolve) => {
    crc.ws.sendEfspCreateStrip(p, { kind: 'StartFlightFollowing', trackId: id, flightData: { callsign: cs, aircraftData: '' } }, 'INCIRLIK',
      { onAck: (a) => { resolve({ ok: a.ok, reason: a.reason || null, detail: a.detail || null }); return true; } });
    setTimeout(() => resolve(null), 10000);
  }), [positionId, trackId, callsign]);
  expect(ack, `${positionId} tags ${trackId}`).toEqual({ ok: true, reason: null, detail: null });
}

/** This session's view of the alert: { shownAt, suppressedAt, suppressed } or null. */
const alertAt = (page, trackId, conflictId) => page.evaluate(([t, id]) => {
  const c = crc.state.conflictAlertsForTrack(t).find(x => x.id === id);
  return c ? { shownAt: [...c.shownAt].sort(), suppressedAt: [...c.suppressedAt].sort(), suppressed: c.suppressed } : null;
}, [trackId, conflictId]);

/** The ATC data block of a contact: its Position letter and whether its CA flashes. */
const block = (page, trackId) => page.evaluate((t) => {
  const d = crc.atc.atcDisplay(t, crc.picture.tracks.get(t) || crc.picture.latestFromServer.get(t));
  const ca = d.view.line0.find(x => x.text === 'CA');
  return { posChar: d.view.posChar, ca: ca ? { blink: !!ca.blink } : null };
}, trackId);

const suppressFrames = (page) => {
  const sent = [];
  page.on('websocket', ws => ws.on('framesent', f => {
    try { const m = JSON.parse(f.payload); if (m.type === 'efsp-conflict-suppress') sent.push(m); } catch { /* not JSON */ }
  }));
  return sent;
};

test('A works one aircraft, B the other: both are shown the CA with the other\'s letter, C is not; each suppress is their own', async ({ browser }) => {
  const a = await controller(browser, { signedOn: ['AP'], controller: 'ca-owner-a' });
  const b = await controller(browser, { signedOn: ['LC'], controller: 'ca-owner-b' });
  const c = await controller(browser, { signedOn: ['PAR'], controller: 'ca-owner-c' });
  await expect.poll(() => a.evaluate(() => crc.airspaceLayer.currentTheater()), { timeout: 30000 }).toBe('Syria');
  const { one, two, conflictId, n } = flyHeadOn();
  const [csA, csB] = [`CAA${n}`, `CAB${n}`];
  for (const p of [a, b, c]) await inPicture(p, [one, two]);
  try {
    await tag(a, 'AP', one, csA);
    await tag(b, 'LC', two, csB);

    await expect.poll(() => alertAt(a, one, conflictId), { timeout: 40000 }).toEqual({ shownAt: ['AP'], suppressedAt: [], suppressed: false });
    await expect.poll(() => alertAt(b, two, conflictId), { timeout: 10000 }).toEqual({ shownAt: ['LC'], suppressedAt: [], suppressed: false });
    // C sees both aircraft and works neither: nothing, over several alert ticks.
    await inPicture(c, [one, two]);
    for (let i = 0; i < 3; i++) {
      expect(await alertAt(c, one, conflictId), 'C is not shown the alert').toBe(null);
      await c.waitForTimeout(1000);
    }

    // The coordination cue: each sees the other's Position letter on the other aircraft (LC is T, AP is A).
    await expect.poll(() => block(a, two)).toMatchObject({ posChar: 'T', ca: { blink: true } });
    await expect.poll(() => block(b, one)).toMatchObject({ posChar: 'A', ca: { blink: true } });
    await a.screenshot({ path: test.info().outputPath('a-sees-ca-with-lc.png') });

    // A suppresses from its own data block's menu: A stops flashing, B does not.
    const sentA = suppressFrames(a);
    await a.evaluate((t) => crc.labelMenu.openLabelMenu(t, 400, 300), one);
    await a.locator('.label-menu .label-menu-suppress').click();
    await expect.poll(() => sentA.length).toBe(1);
    expect(sentA[0]).toMatchObject({ conflictId, actingPositionId: 'AP', suppress: true });
    await expect.poll(() => alertAt(a, one, conflictId)).toMatchObject({ suppressedAt: ['AP'], suppressed: true });
    await expect.poll(() => block(a, two)).toMatchObject({ ca: { blink: false } });
    expect(await alertAt(b, two, conflictId)).toMatchObject({ suppressedAt: [], suppressed: false });
    expect(await block(b, one)).toMatchObject({ ca: { blink: true } });

    // B's own suppress; then A restores, and B's stays suppressed.
    await b.evaluate(([id]) => crc.ws.sendEfspConflictSuppress('LC', id, true), [conflictId]);
    await expect.poll(() => alertAt(b, two, conflictId)).toMatchObject({ suppressedAt: ['LC'], suppressed: true });
    await a.evaluate(([id]) => crc.ws.sendEfspConflictSuppress('AP', id, false), [conflictId]);
    await expect.poll(() => alertAt(a, one, conflictId)).toMatchObject({ suppressedAt: [], suppressed: false });
    expect(await alertAt(b, two, conflictId)).toMatchObject({ suppressedAt: ['LC'], suppressed: true });

    // C may not suppress what it is not shown.
    const refused = await c.evaluate(([id]) => new Promise((resolve) => {
      crc.ws.sendEfspConflictSuppress('PAR', id, true, { onAck: (ack) => { resolve({ ok: ack.ok, reason: ack.reason || null }); return true; } });
      setTimeout(() => resolve(null), 8000);
    }), [conflictId]);
    expect(refused).toEqual({ ok: false, reason: 'NOT_FOUND' });

    // B's data block of A's aircraft opens no menu for B: the track is A's (the track panel instead).
    expect(await b.evaluate((t) => crc.labelMenu.openLabelMenu(t, 400, 300), one)).toBe(false);
  } finally {
    await dropStrips(a, [csA]);
    await dropStrips(b, [csB]);
  }
});

test('one controller works both aircraft (AP and LC): one SUPPRESS is one frame and stops the alert at both', async ({ browser }) => {
  const page = await controller(browser, { signedOn: ['AP', 'LC'], controller: 'ca-owner-both' });
  await expect.poll(() => page.evaluate(() => crc.airspaceLayer.currentTheater()), { timeout: 30000 }).toBe('Syria');
  const { one, two, conflictId, n } = flyHeadOn();
  const [csA, csB] = [`CAC${n}`, `CAD${n}`];
  await inPicture(page, [one, two]);
  try {
    await tag(page, 'AP', one, csA);
    await tag(page, 'LC', two, csB);
    await expect.poll(() => alertAt(page, one, conflictId), { timeout: 40000 }).toEqual({ shownAt: ['AP', 'LC'], suppressedAt: [], suppressed: false });

    const sent = suppressFrames(page);
    await page.evaluate((t) => crc.labelMenu.openLabelMenu(t, 400, 300), one);
    await page.locator('.label-menu .label-menu-suppress').click();
    await expect.poll(() => alertAt(page, one, conflictId)).toEqual({ shownAt: ['AP', 'LC'], suppressedAt: ['AP', 'LC'], suppressed: true });
    expect(sent.length, 'one frame: the server applies it at both Positions').toBe(1);
    await expect.poll(() => block(page, one)).toMatchObject({ ca: { blink: false } });
    await expect.poll(() => block(page, two)).toMatchObject({ ca: { blink: false } });
    await page.screenshot({ path: test.info().outputPath('consolidated-suppressed.png') });
  } finally {
    await dropStrips(page, [csA, csB]);
  }
});
