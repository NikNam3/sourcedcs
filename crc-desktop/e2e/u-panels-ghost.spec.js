'use strict';

/* U-PANELS-GHOST (human 2026-10-27: "sometimes on first launch the panels panel is closed but the sliders are visible and
 * clickable without the panel behind it on the right side"). Whenever a PANELS toggle can be seen and clicked, the PANELS
 * panel is open and the toggle lies inside its dock group. Each case boots the app on a seeded localStorage: a saved dock
 * layout dockview cannot restore (a panel that no longer exists, such as the old Squawk C/S `calls`), and a remembered
 * float for PANELS that is stale or off the window. Run on E2E_LANE=1.
 */

const { test, expect } = require('./helpers/test');
const { installAppModules } = require('./helpers/modules');

test.setTimeout(90000);

const LAYOUT_KEY = 'crc-desktop-dock-layout-v2';
const FLOAT_KEY = 'crc-desktop-panel-float';

function fakeToken(name) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: name, name, exp: Math.floor(Date.now() / 1000) + 3600 })}.e2e`;
}

const LEFT = { type: 'leaf', data: { views: ['track', 'radars'], activeView: 'radars', id: '2' }, size: 500 };
const MAP = { type: 'leaf', data: { views: ['map'], activeView: 'map', id: '1' }, size: 900 };
const RADIO = { type: 'leaf', data: { views: ['radio'], activeView: 'radio', id: '3' }, size: 200 };
const PANELS = {
  map: { id: 'map', contentComponent: 'map', tabComponent: 'no-close', title: 'map' },
  track: { id: 'track', contentComponent: 'track', title: 'TRACK INFO' },
  radars: { id: 'radars', contentComponent: 'radars', title: 'PANELS' },
  radio: { id: 'radio', contentComponent: 'radio', title: 'RADIO' },
  calls: { id: 'calls', contentComponent: 'calls', title: 'SQUAWK C/S' },
};
const layout = (left, map) => ({
  grid: {
    root: { type: 'branch', data: [{ type: 'branch', data: [left, map], size: 700 }, RADIO], size: 1400 },
    width: 1400, height: 868, orientation: 'VERTICAL',
  },
  panels: PANELS, activeGroup: '2',
});
const withView = (leaf, id) => ({ ...leaf, data: { ...leaf.data, views: [...leaf.data.views, id] } });

const CASES = [
  // The removed Squawk C/S panel saved beside PANELS: dockview throws while restoring that group, after PANELS was created.
  ['a saved layout with a removed panel in the PANELS group', { [LAYOUT_KEY]: layout(withView(LEFT, 'calls'), MAP) }],
  // The same panel in a later group: the PANELS group was restored whole before dockview reverts.
  ['a saved layout with a removed panel in a later group', { [LAYOUT_KEY]: layout(LEFT, withView(MAP, 'calls')) }],
  // A float remembered for PANELS from another window size, and one with an older box's fields.
  ['a remembered PANELS float off the window', { [FLOAT_KEY]: { radars: { top: 2400, left: 3200, width: 320, height: 600 } } }],
  ['a remembered PANELS float with odd fields', { [FLOAT_KEY]: { radars: { x: 1200, y: 40, width: 0, height: 0 } } }],
];

/** Every PANELS toggle a click lands on, and whether each lies inside the open PANELS panel's group. */
async function ghostToggles(page) {
  return page.evaluate(() => {
    const api = crc.dock.dock.api;
    const panel = api.getPanel('radars');
    const groupEl = panel && panel.api.group.element;
    const g = groupEl && groupEl.getBoundingClientRect();
    const out = [];
    for (const t of document.querySelectorAll('#panel-controls .toggle')) {
      const r = t.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!at || !t.contains(at)) continue; // painted under something: not seen, not clickable
      const inside = !!g && r.left >= g.left - 1 && r.right <= g.right + 1 && r.top >= g.top - 1 && r.bottom <= g.bottom + 1;
      if (!panel || !inside) out.push({ x: Math.round(r.left), y: Math.round(r.top), panelOpen: !!panel });
    }
    return out;
  });
}

/** Every legacy panel element (index.html's dock-adapted divs) that paints somewhere dockview does not hold it. */
async function strayPanels(page) {
  return page.evaluate(() => {
    const root = document.getElementById('dock-root');
    return [...document.body.children]
      .filter((el) => el.id && el.id.endsWith('-panel') && !root.contains(el))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none'; })
      .map((el) => el.id);
  });
}

for (const [name, seed] of CASES) {
  test(`no PANELS toggle shows without its panel: ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.addInitScript(([s, token]) => {
      if (sessionStorage.getItem('ghost-seeded')) return; // seed once; a reload keeps what the app saved
      sessionStorage.setItem('ghost-seeded', '1');
      localStorage.setItem('crc-desktop-sync-token', token);
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v));
    }, [seed, fakeToken('u-panels-ghost')]);
    await page.goto('/');
    await installAppModules(page);
    await page.waitForFunction(() => crc.dock.dock !== null);
    // After boot, and again after PANELS is opened and closed from its topbar button, the way a controller does.
    // The layout restore runs inside initDock(); two frames later what it left is painted.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await ghostToggles(page), 'after boot').toEqual([]);
    expect(await strayPanels(page), 'no panel paints outside the dock after boot').toEqual([]);
    for (let i = 0; i < 2; i++) {
      await page.locator('#btn-radars').click();
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      expect(await ghostToggles(page), `after PANELS button press ${i + 1}`).toEqual([]);
    }
    // Close it for certain, then look again.
    await page.evaluate(() => { const p = crc.dock.dock.api.getPanel('radars'); if (p) crc.dock.dock.api.removePanel(p); });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await ghostToggles(page), 'after PANELS closed').toEqual([]);
  });
}

// Every legacy panel, not just PANELS: a removed panel saved beside the Strip panel, Settings and Airport.
test('no legacy panel paints outside the dock after a failed layout restore', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const left = { type: 'leaf', data: { views: ['track', 'efsp', 'airport', 'radars', 'calls'], activeView: 'efsp', id: '2' }, size: 500 };
  const map = { type: 'leaf', data: { views: ['map', 'settings'], activeView: 'map', id: '1' }, size: 900 };
  const seed = layout(left, map);
  seed.panels = { ...seed.panels,
    efsp: { id: 'efsp', contentComponent: 'efsp', title: 'STRIPS' },
    airport: { id: 'airport', contentComponent: 'airport', title: 'AIRPORT' },
    settings: { id: 'settings', contentComponent: 'settings', title: 'SETTINGS' } };
  await page.addInitScript(([s, token]) => {
    localStorage.setItem('crc-desktop-sync-token', token);
    localStorage.setItem('crc-desktop-dock-layout-v2', JSON.stringify(s));
  }, [seed, fakeToken('u-panels-ghost-all')]);
  await page.goto('/');
  await installAppModules(page);
  await page.waitForFunction(() => crc.dock.dock !== null);
  expect(await strayPanels(page)).toEqual([]);
  expect(await ghostToggles(page)).toEqual([]);
});

// The other side of the same sweep (human 2026-10-27: "previously open panels are empty until closed and reopened after
// app launch"): a restored layout's background tabs stay in <body> until first shown, so the sweep hides them; selecting
// one must show it, not an empty tab.
test('a restored background tab shows its panel when selected', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const left = { type: 'leaf', data: { views: ['track', 'efsp', 'metrics', 'radars'], activeView: 'track', id: '2' }, size: 500 };
  const map = { type: 'leaf', data: { views: ['map', 'settings'], activeView: 'map', id: '1' }, size: 900 };
  const seed = layout(left, map);
  seed.panels = { map: PANELS.map, track: PANELS.track, radars: PANELS.radars, radio: PANELS.radio,
    efsp: { id: 'efsp', contentComponent: 'efsp', title: 'STRIPS' },
    metrics: { id: 'metrics', contentComponent: 'metrics', title: 'METRICS' },
    settings: { id: 'settings', contentComponent: 'settings', title: 'SETTINGS' } };
  await page.addInitScript(([s, token]) => {
    localStorage.setItem('crc-desktop-sync-token', token);
    localStorage.setItem('crc-desktop-dock-layout-v2', JSON.stringify(s));
  }, [seed, fakeToken('u-panels-restore')]);
  await page.goto('/');
  await installAppModules(page);
  await page.waitForFunction(() => crc.dock.dock !== null);
  for (const [id, domId] of [['efsp', 'efsp-panel'], ['metrics', 'metrics-panel'], ['radars', 'radars-panel'], ['settings', 'settings-panel']]) {
    expect(await page.evaluate((p) => !!crc.dock.dock.api.getPanel(p), id), `${id} restored`).toBe(true);
    await page.evaluate((p) => crc.dock.dock.api.getPanel(p).api.setActive(), id);
    await expect(page.locator(`#${domId}`), `${id} shows when its tab is selected`).toBeVisible();
  }
  expect(await strayPanels(page)).toEqual([]);
});
