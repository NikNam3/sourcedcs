'use strict';

/* H168 — the Strip's left edge names what it shows, on hover, and a press on
 * the edge is still a press on the Strip (click, double-click, drag). */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, stripByCallsign, settle, frames } = require('./helpers/app');

const BAY = 'ops-coordination';

async function openBay(page, bayId, positionId = 'OPS') {
  await page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id="${positionId}"]`).click();
  await page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id="${bayId}"]`).click();
  await frames(page);
}

function orderOf(page, callsigns) {
  return page.evaluate((cs) => [...document.querySelectorAll('#efsp-bay-content .efsp-strip .efsp-block-1')]
    .map((e) => e.textContent.trim()).filter((t) => cs.includes(t)), callsigns);
}

async function dropAll(page, callsigns) {
  await page.evaluate((cs) => {
    for (const s of crc.state.getAllEfspStrips()) {
      const flightData = crc.state.getEfspFlightData(s.flightDataId);
      if (!flightData || !cs.includes(flightData.identity.callsign) || s.state === 'DROPPED') continue;
      crc.ws.sendEfspMutation(s.ownerPositionId, s, { kind: 'DropStrip', reason: 'e2e cleanup' });
    }
  }, callsigns);
  await settle(page);
}

test.use({ viewport: { width: 1600, height: 1600 } });

test('a Highlighted Strip\'s edge says what it is; the edge still clicks, flips and drags', async ({ page }) => {
  const cs = ['H168A', 'H168B', 'H168C'];
  await openPanel(page, { signedOn: ['OPS'] });
  await openBay(page, BAY);
  for (const c of cs) await seedStrip(page, { callsign: c, stripType: 'DEPARTURE', bayId: BAY });
  try {
    const strip = stripByCallsign(page, 'H168A');
    // No marker, no tip: nothing is added to a plain Strip.
    await expect(strip.locator('.efsp-strip-edge-tip')).toHaveCount(0);

    const box = await strip.boundingBox();
    // Ctrl+click: the one-input Highlight entry point.
    await page.keyboard.down('Control');
    await page.mouse.click(box.x + 8, box.y + box.height / 2);
    await page.keyboard.up('Control');
    const tip = stripByCallsign(page, 'H168A').locator('.efsp-strip-edge-tip');
    await expect(tip).toHaveCount(1);
    await expect(tip).toHaveAttribute('title', /^Highlight: yellow \(your marker\)\. Right-click to change, Ctrl\+click cycles/);

    // The tip covers the visible edge, draws nothing, and is what the pointer is over there.
    const hit = await stripByCallsign(page, 'H168A').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const under = document.elementFromPoint(r.left + 2, r.top + r.height / 2);
      const t = el.querySelector('.efsp-strip-edge-tip');
      const cs = getComputedStyle(t);
      return { isTip: under === t, bg: cs.backgroundColor, border: cs.borderLeftWidth, shadow: cs.boxShadow };
    });
    expect(hit).toEqual({ isTip: true, bg: 'rgba(0, 0, 0, 0)', border: '0px', shadow: 'none' });

    // A double-click on the edge flips the Strip (the press reaches the Strip),
    // and selects no text: an empty box otherwise selects the whole Strip, and
    // the drag below would then start the browser's own text drag instead.
    const edge = await stripByCallsign(page, 'H168A').boundingBox();
    await page.mouse.dblclick(edge.x + 2, edge.y + edge.height / 2);
    await expect(stripByCallsign(page, 'H168A')).toHaveClass(/efsp-strip-flipped/);
    await page.mouse.dblclick(edge.x + 2, edge.y + 10);
    await expect(stripByCallsign(page, 'H168A')).not.toHaveClass(/efsp-strip-flipped/);
    expect(await page.evaluate(() => getSelection().toString())).toBe('');

    // A drag started on the edge moves the Strip two places down (ghost top past C's slot).
    const a = await stripByCallsign(page, 'H168A').boundingBox();
    const c = await stripByCallsign(page, 'H168C').boundingBox();
    const x = a.x + 2; const y = a.y + a.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 12, { steps: 3 });
    await page.mouse.move(x, y + (c.y - a.y) + 20, { steps: 6 });
    await page.mouse.up();
    await settle(page);
    await expect.poll(() => orderOf(page, cs), { timeout: 5000 }).toEqual(['H168B', 'H168C', 'H168A']);
  } finally { await dropAll(page, cs); }
});
