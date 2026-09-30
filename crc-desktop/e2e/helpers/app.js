'use strict';

const { expect } = require('@playwright/test');

/**
 * A bearer token the panel will send and crc-sync will accept.
 *
 * crc-sync's `decodeJWT` base64-decodes the payload and never verifies the
 * signature, so any well-formed three-part token authenticates. That is what
 * makes this harness possible without a Casdoor round trip — and it is worth
 * knowing as a property of the service rather than a trick of the tests. If
 * signature verification is ever added, this helper is the one place to fix.
 */
function fakeToken(name = 'e2e-controller') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    sub: name, name, exp: Math.floor(Date.now() / 1000) + 3600,
  })}.e2e`;
}

/**
 * Opens the panel, authenticated and connected, with the given Positions held.
 *
 * The token is seeded through addInitScript so it is present BEFORE any script
 * on the page runs — set it afterwards and the first connection attempt has
 * already gone out unauthenticated, which fails in a way that looks like a
 * server problem.
 */
async function openPanel(page, { held = ['OPS'], facilityId = 'INCIRLIK', controller = 'e2e-controller' } = {}) {
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.addInitScript(([key, token]) => {
    try { localStorage.setItem(key, token); } catch (_) { /* private mode */ }
  }, ['crc-desktop-sync-token', fakeToken(controller)]);

  await page.goto('/');
  await openEfspPanel(page);
  await page.waitForFunction(() => typeof window.sendEfspSetPositions === 'function');
  await page.evaluate(([f, h]) => window.sendEfspSetPositions(f, h), [facilityId, held]);
  // The ack is what actually makes the Positions held server-side; until it
  // lands every op is refused as NOT_HOLDING_POSITION and a spec fails for a
  // reason that has nothing to do with what it is testing.
  await page.waitForFunction(
    ([f, h]) => (window.getActingPositions ? window.getActingPositions(f) : []).length === h.length,
    [facilityId, held],
  );
  return { consoleErrors };
}

/**
 * The Strip panel is a dockview panel and starts UNMOUNTED.
 *
 * `#efsp-panel` exists in index.html from the first paint but carries
 * `dock-unmounted` until dockview places it, so waiting on it to become
 * visible waits forever. `toggleDockPanel` is the same entry point the UI's
 * own panel controls use, so this opens it the way a controller does rather
 * than reaching past dockview and un-hiding the div.
 */
async function openEfspPanel(page) {
  await page.waitForFunction(() => typeof window.toggleDockPanel === 'function');
  await page.evaluate(() => {
    if (!window.isDockPanelOpen || !window.isDockPanelOpen('efsp')) window.toggleDockPanel('efsp', true);
  });
  await expect(page.locator('#efsp-panel')).toBeVisible({ timeout: 10000 });
}

/**
 * Creates a Strip through the panel's own send function rather than the
 * toolbar.
 *
 * Deliberate: a spec about MARSA should fail when MARSA is broken, not when
 * the create-strip form is. Using the page's real `sendEfspCreateStrip` keeps
 * the seed on the actual wire protocol, so it cannot drift from what the app
 * does, while leaving the form itself to the spec that is about the form.
 */
async function seedStrip(page, { callsign, actingPositionId = 'OPS', bayId = 'ops-proposed', role, facilityId = 'INCIRLIK', fdr = {} }) {
  const before = await page.locator('.efsp-strip').count();
  await page.evaluate(([acting, op, fac]) => window.sendEfspCreateStrip(acting, op, fac), [
    actingPositionId,
    {
      kind: 'CreateStrip', bayId, rackId: 'main', role,
      fdr: { callsign, aircraftType: 'F16', wakeCategory: 'D', ...fdr },
    },
    facilityId,
  ]);
  await expect(page.locator('.efsp-strip')).toHaveCount(before + 1);
  await settleCorrelation(page, callsign);
  return stripByCallsign(page, callsign);
}

// crc-sync's correlation-reconciler.js INELIGIBLE_STATES: a Strip in any other
// state gets a correlation record on the next 1 s tick.
const CORRELATION_INELIGIBLE = ['PROPOSED', 'PENDING_CLEARANCE', 'CLEARED', 'HELD', 'TASKED', 'DROPPED'];

/**
 * Waits until a just-seeded Strip has been redrawn with its correlation record.
 *
 * The record arrives on the reconciler's next tick (about 0.5 s idle, seconds
 * on a loaded machine) and changes the Strip's render signature, so the
 * element is REPLACED. A spec that grabbed the Strip before then clicks or
 * screenshots a detached node — measured as "element was detached from the
 * DOM" on the ⋯ button and on locator.screenshot, only under load.
 */
async function settleCorrelation(page, callsign) {
  await expect.poll(() => page.evaluate(([cs, ineligible]) => {
    const s = [...efspStrips.values()].find((x) => x.state !== 'DROPPED'
      && (efspFdrs.get(x.fdrId) || {}).identity && efspFdrs.get(x.fdrId).identity.callsign === cs);
    if (!s || ineligible.includes(s.state)) return true;
    const el = document.querySelector(`.efsp-strip[data-strip-id="${s.stripId}"]`);
    return !!el && /\|cor:\d/.test(el.dataset.sig || '');
  }, [callsign, CORRELATION_INELIGIBLE]), { message: `${callsign} redrawn with its correlation record`, timeout: 10000 }).toBe(true);
}

/** The Strip element showing this callsign. */
function stripByCallsign(page, callsign) {
  return page.locator('.efsp-strip', { has: page.locator('.efsp-block-1', { hasText: callsign }) }).first();
}

// ── the two standing rules ───────────────────────────────────────────────
//
// Applied across flows rather than per-control, because both failures found
// by hand were of a KIND rather than a one-off: a control that looks pressable
// and does nothing, and a refusal nobody can see.

/**
 * Rule 1 — an enabled control must DO something.
 *
 * Clicks it and requires either a mutation on the wire or a visible DOM
 * change. Silence is the failure: that is precisely what "the button does
 * nothing" means, and it is invisible to a test that only asserts a handler
 * was registered.
 */
async function expectDoesSomething(page, locator, what) {
  await expect(locator, `${what}: not visible`).toBeVisible();
  await expect(locator, `${what}: rendered disabled`).toBeEnabled();

  await page.evaluate(() => { window.__e2eSent = []; });
  await page.evaluate(() => {
    if (window.__e2eHooked) return;
    window.__e2eHooked = true;
    for (const fn of ['sendEfspMutation', 'sendEfspCreateStrip', 'sendEfspMarsaMutation',
      'sendEfspAirspaceMutation', 'sendEfspCorrelationMutation', 'sendEfspSetPositions']) {
      const original = window[fn];
      if (typeof original !== 'function') continue;
      window[fn] = (...args) => { (window.__e2eSent = window.__e2eSent || []).push({ fn, args }); return original(...args); };
    }
  });

  const domBefore = await page.locator('#efsp-bay-content').innerHTML();
  // A short click timeout on purpose. Playwright retries a click for the whole
  // test budget while something covers the target, which turns "this control
  // is unreachable" into a 20s hang and — worse — into a TIMEOUT, which
  // test.fail() does not convert into an expected failure. Three seconds is
  // far longer than any real click needs, and failing fast keeps an
  // unreachable control reported as what it is.
  await locator.click({ timeout: 3000 });
  await page.waitForTimeout(250);

  const sent = await page.evaluate(() => window.__e2eSent || []);
  const domAfter = await page.locator('#efsp-bay-content').innerHTML();
  expect(sent.length > 0 || domAfter !== domBefore,
    `${what}: enabled, clicked, and nothing happened — no mutation sent and nothing on screen changed`).toBe(true);
  return sent;
}

/**
 * Rule 2 — a refusal must be legible.
 *
 * The server refusing is correct; the controller not being told is the defect.
 * Checks the panel's own error surfaces rather than the console, because a
 * console message is not something anybody working a Board will ever read.
 */
async function expectRefusalIsVisible(page, what) {
  const surfaces = ['#efsp-mutation-error', '#efsp-create-strip-msg', '#efsp-dot-command-preview'];
  for (const sel of surfaces) {
    const el = page.locator(sel);
    if (await el.count() && (await el.textContent() || '').trim()) return (await el.textContent()).trim();
  }
  throw new Error(`${what}: the server refused and no surface in the panel says so`);
}

/**
 * Is this element actually clickable where it is drawn?
 *
 * The MARSA popover disappearing behind another Strip is a stacking bug, and
 * a test that only asserts `toBeVisible()` passes straight through it —
 * Playwright's visibility means "has a box and is not hidden", not "is on
 * top". This asks the document what is actually at the element's centre.
 */
async function expectOnTop(page, locator, what) {
  await expect(locator, `${what}: not visible at all`).toBeVisible();
  const verdict = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { ok: false, why: 'zero-sized' };
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return { ok: false, why: `off-screen at ${Math.round(cx)},${Math.round(cy)}` };
    const hit = document.elementFromPoint(cx, cy);
    if (!hit) return { ok: false, why: 'nothing at its centre — clipped by an ancestor' };
    if (el.contains(hit) || hit.contains(el)) return { ok: true };
    return { ok: false, why: `covered by ${hit.tagName.toLowerCase()}.${(hit.className || '').toString().split(/\s+/)[0]}` };
  });
  expect(verdict.ok, `${what}: ${verdict.why}`).toBe(true);
}

/**
 * Touch-target floor — WP3's acceptance criterion, 44x44 CSS px, MEASURED.
 *
 * It used to assert 32, and only on height, while its own message quoted 44: a
 * deliberately lenient tripwire, set while nothing in the panel had ever been
 * measured and a 44 assert would have failed on nearly every control at once,
 * which reports nothing useful. That was left for the pass that could see the
 * whole picture, because raising it reclassifies findings rather than tidying
 * a helper.
 *
 * F-105 has landed and the controls have real 44x44 border boxes, so this now
 * enforces the criterion it names — BOTH dimensions, because 44x44 is two
 * numbers and a 26px-wide control is no more hittable for being 44 tall.
 *
 * Two controls are still under it, deliberately: `⌿` (.efsp-confirm-vacated-btn,
 * 32x44) and `*` (.efsp-annotation-overflow, 26x32), both of which sit 2px from
 * an editable value cell that a full 44 would start stealing clicks from. Those
 * two specs stay test.fail() and say so — see l2-block-editing.spec.js.
 */
const TOUCH_TARGET_FLOOR = 44;
async function expectTouchTarget(locator, what) {
  const box = await locator.boundingBox();
  expect(box, `${what}: no box`).not.toBeNull();
  const measured = `${Math.round(box.width)}x${Math.round(box.height)}`;
  expect(
    Math.round(box.width),
    `${what}: ${measured} — width is under WP3's ${TOUCH_TARGET_FLOOR}x${TOUCH_TARGET_FLOOR} floor`,
  ).toBeGreaterThanOrEqual(TOUCH_TARGET_FLOOR);
  expect(
    Math.round(box.height),
    `${what}: ${measured} — height is under WP3's ${TOUCH_TARGET_FLOOR}x${TOUCH_TARGET_FLOOR} floor`,
  ).toBeGreaterThanOrEqual(TOUCH_TARGET_FLOOR);
}

/**
 * A Strip's ⋯ menu item. Layout C (docs/adr/0056) moved everything a
 * controller STARTS — Coordinate…, TOFI…, Airspace…, MARSA…, Bind…, Convert,
 * Offset — off the Strip's face into that menu, which is portalled to <body>
 * like every popover (F-001), so the item is NOT inside `strip`.
 */
async function stripMenuItem(strip, name) {
  const page = strip.page();
  const menu = page.locator('.efsp-strip-menu');
  if (!(await menu.isVisible().catch(() => false))) {
    await strip.locator('.efsp-strip-menu-btn').click({ timeout: 3000 });
  }
  return menu.getByRole('menuitem', { name, exact: true });
}

/** Presses a Strip's ⋯ menu item — the replacement for clicking the old on-Strip button. */
async function startAction(strip, name, opts = {}) {
  const item = await stripMenuItem(strip, name);
  await item.click({ timeout: 3000, ...opts });
}

module.exports = {
  fakeToken, openPanel, openEfspPanel, seedStrip, stripByCallsign,
  expectDoesSomething, expectRefusalIsVisible, expectOnTop, expectTouchTarget,
  stripMenuItem, startAction,
};
