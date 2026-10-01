'use strict';

/* Lane 4 — drag and drop in a real browser. docs/ui-findings/lane4.md F-402, F-403, F-404, F-406.
 *
 * Drag has only ever been exercised against strip-drag.js's pure functions and
 * a DOM stub. Everything here is a real pointer: page.mouse down / move / up
 * over the rendered Strip.
 *
 * Isolation: the Board is shared across a run, so each test seeds into a Bay no
 * other spec uses (ops-coordination) or walks its own Strips to TWR, and drops
 * what it created afterwards. dropAll matches by CALLSIGN, so the callsigns
 * have to be unique across the whole suite, not just this file — the
 * autoscroll test's were L4D0..L4D7 and overlapped l4-density.spec.js's
 * L4D1..L4D6 in another Bay, which the cleanup would have retired out from
 * under it had the two files ever run the other way round.
 *
 * Helpers below (openBay, grab, orderOf, dropAll) might belong in
 * e2e/helpers/app.js; kept here under the parallel-lane rule.
 */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, stripByCallsign } = require('./helpers/app');

const BAY = 'ops-coordination';

async function openBay(page, bayId, positionId = 'OPS') {
  await page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id=\"${positionId}\"]`).click();
  await page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id=\"${bayId}\"]`).click();
  await page.waitForTimeout(200);
}

/** Pointer down on the Strip's own left padding — not a chip, which would swallow it. */
async function grab(page, callsign) {
  const r = await stripByCallsign(page, callsign).boundingBox();
  const x = r.x + 8; const y = r.y + r.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Past DRAG_THRESHOLD_PX (5px) so the drag is real.
  await page.mouse.move(x, y + 12, { steps: 3 });
  return { x, y };
}

/** DOM order of just these callsigns, as the controller sees them top to bottom. */
function orderOf(page, callsigns) {
  return page.evaluate((cs) => [...document.querySelectorAll('#efsp-bay-content .efsp-strip .efsp-block-1')]
    .map((e) => e.textContent.trim()).filter((t) => cs.includes(t)), callsigns);
}

/** Midpoint of the gap a controller sees between two Strips, measured NOW (mid-drag). */
function visibleGap(page, upper, lower) {
  return page.evaluate(([u, l]) => {
    const find = (cs) => [...document.querySelectorAll('.efsp-strip:not(.efsp-strip-dragging)')]
      .find((e) => e.querySelector('.efsp-block-1').textContent.trim() === cs).getBoundingClientRect();
    return (find(u).bottom + find(l).top) / 2;
  }, [upper, lower]);
}

async function dropAll(page, callsigns) {
  await page.evaluate((cs) => {
    for (const s of getAllEfspStrips()) {
      const fdr = getEfspFdr(s.fdrId);
      if (!fdr || !cs.includes(fdr.identity.callsign) || s.state === 'DROPPED') continue;
      sendEfspMutation(s.ownerPositionId, s, { kind: 'DropStrip', reason: 'e2e cleanup' });
    }
  }, callsigns);
  await page.waitForTimeout(400);
}

test.describe('in one Rack', () => {
  test.use({ viewport: { width: 1600, height: 1600 } });

  // F-402 — was a catalogued finding, now fixed.
  test('dropping at the gap the controller can see puts the Strip there', async ({ page }) => {
    const cs = ['L4A1', 'L4A2', 'L4A3', 'L4A4'];
    await openPanel(page, { held: ['OPS'] });
    // Bay first: seedStrip waits for the new Strip to render, and only the
    // active Bay renders.
    await openBay(page, BAY);
    for (const c of cs) await seedStrip(page, { callsign: c, role: 'DEPARTURE', bayId: BAY });
    try {
      const { x } = await grab(page, 'L4A1');
      // The Rack closes up the moment the drag starts (the Strip goes
      // position:fixed), so this is measured after, not before.
      await page.mouse.move(x, await visibleGap(page, 'L4A3', 'L4A4'), { steps: 5 });
      await page.mouse.up();
      await expect.poll(() => orderOf(page, cs), { timeout: 3000 }).toEqual(['L4A2', 'L4A3', 'L4A1', 'L4A4']);
    } finally { await dropAll(page, cs); }
  });

  // F-403 — was a catalogued finding, now fixed.
  test('the dragged Strip stays inside the Strip panel', async ({ page }) => {
    const cs = ['L4B1', 'L4B2'];
    await openPanel(page, { held: ['OPS'] });
    // Bay first: seedStrip waits for the new Strip to render, and only the
    // active Bay renders.
    await openBay(page, BAY);
    for (const c of cs) await seedStrip(page, { callsign: c, role: 'DEPARTURE', bayId: BAY });
    try {
      await grab(page, 'L4B1');
      const m = await page.evaluate(() => {
        const d = document.querySelector('.efsp-strip-dragging').getBoundingClientRect();
        const p = document.querySelector('#efsp-panel').getBoundingClientRect();
        return { dragW: Math.round(d.width), dragRight: Math.round(d.right), panelRight: Math.round(p.right) };
      });
      await page.mouse.up();
      expect(m.dragRight, `dragged Strip ${m.dragW}px wide, right edge ${m.dragRight} vs panel ${m.panelRight}`).toBeLessThanOrEqual(m.panelRight);
    } finally { await dropAll(page, cs); }
  });

  // F-404 — was a catalogued finding, now fixed.
  test('scrolling the Bay mid-drag still drops where the pointer is', async ({ page }) => {
    const cs = Array.from({ length: 10 }, (_, i) => `L4C${i}`);
    await openPanel(page, { held: ['OPS'] });
    // Bay first: seedStrip waits for the new Strip to render, and only the
    // active Bay renders.
    await openBay(page, BAY);
    for (const c of cs) await seedStrip(page, { callsign: c, role: 'DEPARTURE', bayId: BAY });
    try {
      const { x } = await grab(page, 'L4C0');
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(300);
      // Whichever two of ours are now fully in view, aim between them.
      const pair = await page.evaluate((cs) => {
        const cr = document.querySelector('#efsp-bay-content').getBoundingClientRect();
        return [...document.querySelectorAll('.efsp-strip:not(.efsp-strip-dragging)')]
          .filter((e) => { const r = e.getBoundingClientRect(); return r.top >= cr.top && r.bottom <= cr.bottom; })
          .map((e) => e.querySelector('.efsp-block-1').textContent.trim()).filter((t) => cs.includes(t)).slice(0, 2);
      }, cs);
      expect(pair.length, 'need two Strips in view to aim between').toBe(2);
      await page.mouse.move(x, await visibleGap(page, pair[0], pair[1]), { steps: 3 });
      await page.mouse.up();
      await page.waitForTimeout(600);
      const order = await orderOf(page, cs);
      const i = order.indexOf('L4C0');
      expect([order[i - 1], order[i + 1]], `aimed between ${pair.join('/')}`).toEqual(pair);
    } finally { await dropAll(page, cs); }
  });

  // F-404, second route — was a catalogued finding, now fixed. Holding a Strip at the Bay edge DOES
  // autoscroll (Chromium's own, not the app's), and that moves the Rack under
  // the cached rects exactly as the wheel does.
  test('a Strip autoscrolled to an off-screen slot drops where the pointer is', async ({ page }) => {
    const cs = Array.from({ length: 8 }, (_, i) => `L4S${i}`);
    await openPanel(page, { held: ['OPS'] });
    await openBay(page, BAY);
    for (const c of cs) await seedStrip(page, { callsign: c, role: 'DEPARTURE', bayId: BAY });
    try {
      const content = page.locator('#efsp-bay-content');
      await content.evaluate((e) => { e.scrollTop = 0; });
      const box = await content.boundingBox();
      const { x } = await grab(page, 'L4S0');
      await page.mouse.move(x, box.y + box.height - 4, { steps: 8 });
      await page.waitForTimeout(1500);
      expect(await content.evaluate((e) => e.scrollTop), 'precondition: the Bay autoscrolled').toBeGreaterThan(0);
      const pair = await page.evaluate((cs) => {
        const cr = document.querySelector('#efsp-bay-content').getBoundingClientRect();
        return [...document.querySelectorAll('.efsp-strip:not(.efsp-strip-dragging)')]
          .filter((e) => { const r = e.getBoundingClientRect(); return r.top >= cr.top && r.bottom <= cr.bottom; })
          .map((e) => e.querySelector('.efsp-block-1').textContent.trim()).filter((t) => cs.includes(t)).slice(-2);
      }, cs);
      expect(pair.length, 'need two Strips in view to aim between').toBe(2);
      await page.mouse.move(x, await visibleGap(page, pair[0], pair[1]), { steps: 3 });
      await page.mouse.up();
      await page.waitForTimeout(600);
      const order = await orderOf(page, cs);
      const i = order.indexOf('L4S0');
      expect([order[i - 1], order[i + 1]], `aimed between ${pair.join('/')}`).toEqual(pair);
    } finally { await dropAll(page, cs); }
  });
});

// F-406 — was a catalogued finding, now fixed.
test('a Strip can be dragged from one Rack to another in the same Bay', async ({ page }) => {
  test.setTimeout(60000);
  const cs = ['L4R1', 'L4R2', 'L4R3'];
  await page.setViewportSize({ width: 1600, height: 1600 });
  await openPanel(page, { held: ['OPS', 'CD', 'GND', 'TWR'] });
  try {
    // Walk each to twr-runway-queue through the real NLA chain — TWR cannot
    // create a Strip, and the queue implies RUNWAY_QUEUE.
    for (const c of cs) {
      await seedStrip(page, { callsign: c, role: 'DEPARTURE', fdr: { route: 'DCT', requestedAltitude: 'FL250', departureAirport: 'LTAG', destinationAirport: 'LTAF' } });
      for (let i = 0; i < 5; i++) {
        await page.evaluate((c) => _invokeNla(getAllEfspStrips().find((s) => getEfspFdr(s.fdrId).identity.callsign === c)), c);
        await page.waitForTimeout(500);
      }
    }
    await page.evaluate(() => _moveStrip(getAllEfspStrips().find((s) => getEfspFdr(s.fdrId).identity.callsign === 'L4R3'), 'twr-runway-queue', 'rwy-23', null, null));
    await page.waitForTimeout(500);
    await openBay(page, 'twr-runway-queue', 'TWR');
    const rackOf = (c) => page.evaluate((c) => getAllEfspStrips().find((s) => getEfspFdr(s.fdrId).identity.callsign === c).rackId, c);
    expect(await rackOf('L4R1')).toBe('rwy-05');
    expect(await rackOf('L4R3')).toBe('rwy-23');

    const { x } = await grab(page, 'L4R1');
    const target = await stripByCallsign(page, 'L4R3').boundingBox();
    await page.mouse.move(x, target.y + target.height - 10, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => rackOf('L4R1'), { timeout: 3000 }).toBe('rwy-23');
  } finally { await dropAll(page, cs); }
});
