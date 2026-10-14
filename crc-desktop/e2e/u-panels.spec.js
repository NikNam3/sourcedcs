'use strict';

/* U-PANELS (decisions H138, docs/parallel/live-test-2026-10-13.md U12, U13): every docked panel scrolls instead of cutting its UI
 * off when sized smaller, and the scrollbars are the app's own (thin, a dark track, a grey thumb), not the browser's white default.
 * A panel that must not scroll as a whole (the carrier map, Settings, the Strip panel) scrolls inside instead: the check is the
 * same, that its bottom control can be reached. Run on E2E_LANE=7.
 */

const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');

test.setTimeout(90000);

const ALL_CARRIER = ['CV_MARSHAL', 'CV_APP1', 'CV_APP2', 'CV_PRIFLY'];

// Map and Track Info, Panels and Radio: never removed, only brought to the front.
const REQUIRED = ['map', 'track', 'radars', 'radio'];

/** Docks `id` with no other optional panel open, and makes it the active tab of its group. */
async function dockAlone(page, id) {
  await page.evaluate(([pid, required]) => {
    const api = crc.dock.dock.api;
    for (const p of [...api.panels]) if (!required.includes(p.id) && p.id !== pid) api.removePanel(p);
    if (pid === 'track') crc.dock.ensureTrackPanel(); // Track Info opens from a track, not from the Panels list
    else if (pid === 'radars') { if (!api.getPanel('radars')) document.getElementById('btn-radars').click(); } // its topbar button
    else crc.dock.toggleDockPanel(pid, true);
  }, [id, REQUIRED]);
  await page.waitForFunction((pid) => !!crc.dock.dock.api.getPanel(pid), id);
  await page.evaluate((pid) => crc.dock.dock.api.getPanel(pid).api.setActive(), id);
}

/**
 * What a controller can reach in a panel's root element: whether the root stays inside its dock tab, and for its last visible
 * control, whether scrolling brings it to where a click lands on it.
 */
async function reach(page, rootSel) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    const tab = root.parentElement;
    const r = root.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    const controls = [...root.querySelectorAll('button, input, select, textarea')].filter(el => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    });
    const last = controls.sort((a, b) => a.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom).pop() || null;
    let hit = null;
    if (last) {
      last.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const b = last.getBoundingClientRect();
      const at = document.elementFromPoint(b.left + Math.min(b.width / 2, 8), b.top + b.height / 2);
      hit = !!at && (at === last || last.contains(at));
    }
    return {
      fits: r.height <= t.height + 1, rootH: Math.round(r.height), tabH: Math.round(t.height),
      overflowY: getComputedStyle(root).overflowY, last: last ? (last.textContent || last.placeholder || last.tagName).trim().slice(0, 30) : null, hit,
    };
  }, rootSel);
}

test('Carrier and Marshal sized small: the panel scrolls and its bottom control can be reached (U12)', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await openPanel(page, { signedOn: ALL_CARRIER, facilityId: 'CARRIER', controller: 'u-panels' });
  await page.waitForFunction(() => typeof crc.carrier.getEfspCarrier === 'function' && !!crc.carrier.getEfspCarrier());
  for (const [id, sel] of [['carrier', '#carrier-mgmt-panel'], ['marshal', '#marshal-panel']]) {
    await page.setViewportSize({ width: 1100, height: 900 });
    await dockAlone(page, id);
    await expect(page.locator(sel)).toBeVisible();
    await page.setViewportSize({ width: 700, height: 260 });
    await expect.poll(async () => (await reach(page, sel)).tabH, { message: `${id}: the dock tab shrank` }).toBeLessThan(240);
    const r = await reach(page, sel);
    expect(r.fits, `${id}: the panel stays inside its tab (${r.rootH} > ${r.tabH})`).toBe(true);
    expect(r.overflowY, `${id} scrolls`).toBe('auto');
    expect(r.last, `${id} has a control`).not.toBeNull();
    expect(r.hit, `${id}: its bottom control (${r.last}) can be reached`).toBe(true);
  }
});

test('every panel sized small keeps its bottom control reachable (U12)', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await openPanel(page, { signedOn: ['OPS', 'AP', 'PAR'], controller: 'u-panels-all' });
  const panels = [
    ['track', '#track-panel'], ['radars', '#radars-panel'], ['airport', '#aprt-panel'], ['efsp', '#efsp-panel'],
    ['airspace', '#airspace-panel'], ['runwayStatus', '#runway-status-panel'], ['carrier', '#carrier-mgmt-panel'],
    ['marshal', '#marshal-panel'], ['carrierMap', '#carrier-map-panel'], ['par', '#par-panel'], ['metrics', '#metrics-panel'],
    ['settings', '#settings-panel'], ['radio', '#srs-radio-panel'],
  ];
  const problems = [];
  for (const [id, sel] of panels) {
    await page.setViewportSize({ width: 1100, height: 900 });
    await dockAlone(page, id);
    // The Radio panel hides its content until SRS is connected (srs-radio.js), and the e2e stack has no SRS: show it as a
    // connected client would (a style rule, since every failed SRS reconnect hides it again; Radio is the last panel checked).
    if (id === 'radio') await page.addStyleTag({ content: '#srs-radio-panel { display: block !important; }' });
    if (!(await page.locator(sel).isVisible())) { problems.push(`${id}: not visible`); continue; }
    await page.setViewportSize({ width: 700, height: 260 });
    await expect.poll(async () => (await reach(page, sel)).tabH, { message: `${id}: the dock tab shrank` }).toBeLessThan(240);
    const r = await reach(page, sel);
    if (!r.fits) problems.push(`${id}: ${r.rootH}px root in a ${r.tabH}px tab`);
    if (r.last && !r.hit) problems.push(`${id}: bottom control "${r.last}" cannot be reached`);
  }
  expect(problems).toEqual([]);
});

test('scrollbars are the app\'s own: thin, a dark track and a grey thumb, brighter on hover (U13)', async ({ page }) => {
  await openPanel(page, { signedOn: ['OPS'], controller: 'u-panels-sb' });
  const style = await page.evaluate(() => {
    const el = document.getElementById('efsp-bay-content');
    const cs = getComputedStyle(el);
    return { width: cs.scrollbarWidth, color: cs.scrollbarColor, body: getComputedStyle(document.body).scrollbarColor };
  });
  expect(style.width).toBe('thin');
  // thumb --efsp-line-2 (#4a5560), track --efsp-strip (#1c2228)
  expect(style.color).toBe('rgb(74, 85, 96) rgb(28, 34, 40)');
  await page.locator('#efsp-bay-content').hover();
  const hovered = await page.evaluate(() => getComputedStyle(document.getElementById('efsp-bay-content')).scrollbarColor);
  expect(hovered).toBe('rgb(140, 154, 166) rgb(28, 34, 40)'); // thumb --efsp-muted (#8c9aa6)
});
