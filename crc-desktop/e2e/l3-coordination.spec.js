'use strict';

/* Lane 3 — cross-Facility coordination, TOFI and the mission line, walked from
 * BOTH sides at once.
 *
 * Every exchange here has a sender and a receiver, and they are different
 * controllers in different Facilities. So every test drives two browser
 * contexts — two separate pages, each authenticated as its own controller,
 * each holding its own Position — against the one crc-sync. A one-sided walk
 * sees the half of the exchange where the button is; these bugs live in the
 * half where the RESULT is supposed to show up.
 *
 * Every test below was a catalogued finding in docs/ui-findings/lane3.md
 * (F-301..F-309, extends F-101). All of them are fixed and none is annotated
 * test.fail() any more, so a failure here is a regression.
 *
 * About `dispatchEvent('click')` on popover buttons: the Coordinate and TOFI
 * popovers cannot be clicked by pointer at all (F-001, and F-301 for why a
 * z-index fix will not be enough). Only the spec that is ABOUT that uses a real
 * click. Everything else fires the button's click event directly, so that it
 * measures the defect it is named for rather than failing on F-001 first.
 */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, startAction } = require('./helpers/app');

// Two controllers, a login each, and a Board that persists across tests in a
// run — longer than the default budget, and every callsign below is unique.
test.describe.configure({ timeout: 60000 });

// ── helpers local to this lane (candidates for e2e/helpers/app.js) ────────

const _contexts = [];
test.afterEach(async () => { while (_contexts.length) await _contexts.pop().close().catch(() => {}); });

/** A second, third… controller: its own context, its own token, its own held Positions. */
async function controller(browser, opts) {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1600, height: 1000 } });
  _contexts.push(ctx);
  const page = await ctx.newPage();
  await openPanel(page, opts);
  return page;
}

const ctr = (browser) => controller(browser, { held: ['CTR'], facilityId: 'CENTER', controller: 'ctr-controller' });
const app = (browser) => controller(browser, { held: ['APP'], facilityId: 'INCIRLIK', controller: 'app-controller' });
const tacC2 = (browser) => controller(browser, { held: ['TAC_C2'], facilityId: 'TACTICAL', controller: 'tac-c2-controller' });

/**
 * The Strip with an element reading exactly this callsign.
 *
 * Not the shared helper's `.efsp-block-1` locator: a MISSION Strip's first
 * Block is not the callsign, so that locator finds nothing on the TAC_C2 side.
 * Not a `\b` regex on the Strip's text either — label and value concatenate
 * ("CALLSIGNVIPER11TYPE…"), so there is no word boundary to match.
 */
function strip(page, callsign) {
  return page.locator('.efsp-strip', { has: page.getByText(callsign, { exact: true }) }).first();
}

async function goBay(page, positionId, bayId) {
  await page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id=\"${positionId}\"]`).click();
  await page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id=\"${bayId}\"]`).click();
}

/** A CENTER ARRIVAL at INBOUND — the state every coordination primitive and TOFI ENTRY is eligible from. */
function seedCtrArrival(page, callsign) {
  return seedStrip(page, { callsign, actingPositionId: 'CTR', bayId: 'ctr-enroute', role: 'ARRIVAL', facilityId: 'CENTER' });
}

/** Every live Strip record for this callsign, as the page's own store has it. */
function recordsFor(page, callsign) {
  return page.evaluate((cs) => [...efspStrips.values()]
    .filter(s => (efspFdrs.get(s.fdrId) || {}).identity && efspFdrs.get(s.fdrId).identity.callsign === cs && s.state !== 'DROPPED')
    .map(s => ({ facilityId: s.facilityId, owner: s.ownerPositionId, bayId: s.bayId, state: s.state, role: s.role,
      coordination: s.coordination && s.coordination.state, tofi: s.tofiCoordination && s.tofiCoordination.state })), callsign);
}

/** Proposes a coordination primitive from CTR's Strip. See the file header for why the Send is dispatched. */
async function propose(page, stripEl, primitive, note) {
  await startAction(stripEl, 'Coordinate…');
  const popover = page.locator('.efsp-coordinate-popover');
  await popover.locator('select').selectOption(primitive);
  if (note) await popover.locator('textarea').fill(note);
  await popover.getByRole('button', { name: 'Send' }).dispatchEvent('click');
}

/** Proposes TOFI ENTRY from CTR's Strip to TAC_C2. */
async function proposeTofiEntry(page, stripEl, note) {
  await startAction(stripEl, 'TOFI…');
  const popover = page.locator('.efsp-tofi-popover');
  await popover.locator('select').selectOption({ label: 'TAC_C2 (TACTICAL)' });
  if (note) await popover.locator('textarea').fill(note);
  await popover.getByRole('button', { name: 'Send TOFI' }).dispatchEvent('click');
}

async function setSepReg(stripEl, value) {
  const chip = stripEl.locator('.efsp-block-chip', { has: stripEl.page().locator('.efsp-block-label', { hasText: /^SEP REG$/ }) });
  await chip.locator('.efsp-block').first().click({ timeout: 3000 });
  await chip.locator('select').selectOption(value);
  await expect(chip).toContainText(value);
}

/** What elementFromPoint finds at the centre of `locator`, and the rects that explain it. */
function hitTest(locator) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const bay = document.getElementById('efsp-bay-content').getBoundingClientRect();
    return {
      rect: [r.x, r.y, r.width, r.height].map(Math.round),
      bay: [bay.x, bay.y, bay.width, bay.height].map(Math.round),
      hit: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).split(/\s+/)[0]}` : null,
      onTop: !!hit && (el.contains(hit) || hit.contains(el)),
    };
  });
}

// ── extends F-101 ─────────────────────────────────────────────────────────
//
// FIRST in the file on purpose. It depends on what else is in APP's
// Coordination Bay: every later test that rejects a proposal leaves a dead
// replica there (F-303), and with those above it the reflow no longer carries
// the neighbour under the pointer — measured: it passed in a full run while
// failing alone. Board state persists across tests in a run.

test('a double-tap on Accept Hand Off accepts only the replica that was tapped', async ({ browser }) => {
  const a = await ctr(browser);
  const b = await app(browser);
  await propose(a, await seedCtrArrival(a, 'DBLAC1'), 'HANDOFF');
  await a.locator('.efsp-coordinate-popover').waitFor({ state: 'detached' });
  await propose(a, await seedCtrArrival(a, 'DBLAC2'), 'HANDOFF');
  await goBay(b, 'APP', 'app-coordination');
  await expect(strip(b, 'DBLAC2').getByRole('button', { name: 'Accept Hand Off' })).toBeVisible();

  // Earlier tests' rejected replicas stay in this Bay (F-303) and the Bay is
  // 186 px tall, so bring the tapped one into view rather than assume it is.
  const first = strip(b, 'DBLAC1').getByRole('button', { name: 'Accept Hand Off' });
  await first.scrollIntoViewIfNeeded();
  const box = await first.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await b.mouse.click(x, y);
  // Wait for the Rack to reflow rather than a fixed gap. An Accept is a
  // cross-Facility round trip, so when the neighbour arrives under the pointer
  // varies run to run (a fixed 250 ms reproduced once, then not). The claim
  // under test is that it arrives INSIDE the guide's 400 ms double-tap window,
  // and a second tap then lands on it.
  const arrivedAfterMs = await b.evaluate(async ([px, py, cs]) => {
    const t0 = performance.now();
    while (performance.now() - t0 < 400) {
      const hit = document.elementFromPoint(px, py);
      const s = hit && hit.closest('.efsp-strip');
      if (s && s.innerText.includes(cs) && hit.closest('.efsp-coordinate-accept-btn')) return Math.round(performance.now() - t0);
      await new Promise(r => setTimeout(r, 10));
    }
    return null;
  }, [x, y, 'DBLAC2']);
  if (arrivedAfterMs !== null) await b.mouse.click(x, y);
  await b.waitForTimeout(700);

  const second = (await recordsFor(b, 'DBLAC2')).find(r => r.facilityId === 'INCIRLIK');
  expect(second.coordination, `DBLAC2's Accept slid under the pointer ${arrivedAfterMs} ms after the first tap, and the second tap accepted it`).toBe('PROPOSED');
});

// ── F-301 — extends F-001 ─────────────────────────────────────────────────

test('the Coordinate popover can be reached on a lone Strip, even after scrolling the Bay', async ({ browser }) => {
  const a = await ctr(browser);
  const s = await seedCtrArrival(a, 'PLONE1');
  await startAction(s, 'Coordinate…');
  const popover = a.locator('.efsp-coordinate-popover');
  await expect(popover).toBeVisible();
  // Scroll the Bay as far as it goes — a controller's first move when a
  // popover opens off the bottom. Layout containment on the Strip keeps the
  // popover out of the Bay's scrollable overflow, so this does not help.
  await a.locator('#efsp-bay-content').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const send = popover.getByRole('button', { name: 'Send' });
  const verdict = await hitTest(send);
  expect(verdict.onTop, `Send is at ${verdict.rect}, the Bay is ${verdict.bay}, and ${verdict.hit} is what is there`).toBe(true);
});

test('the TOFI popover can be reached on a lone Strip', async ({ browser }) => {
  const a = await ctr(browser);
  const s = await seedCtrArrival(a, 'PLONE2');
  await startAction(s, 'TOFI…');
  const popover = a.locator('.efsp-tofi-popover');
  await expect(popover).toBeVisible();
  await a.locator('#efsp-bay-content').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const verdict = await hitTest(popover.getByRole('button', { name: 'Send TOFI' }));
  expect(verdict.onTop, `Send TOFI is at ${verdict.rect}, the Bay is ${verdict.bay}, and ${verdict.hit} is what is there`).toBe(true);
});

// ── F-302 ─────────────────────────────────────────────────────────────────

test('the sender can see a HANDOFF is pending, and then that it was accepted', async ({ browser }) => {
  const a = await ctr(browser);
  const b = await app(browser);
  const s = await seedCtrArrival(a, 'HOSEE1');
  await propose(a, s, 'HANDOFF');
  await expect.poll(async () => (await recordsFor(a, 'HOSEE1')).length).toBe(2);

  // TOFI's own badge reads "TOFI ENTRY: PROPOSED". The five coordination
  // primitives have nothing equivalent: the Coordinate button disappears and
  // that is the only change on the sender's Strip.
  await expect(s, 'pending HANDOFF: nothing on the sender\'s Strip says so').toContainText(/HAND ?OFF/i, { timeout: 2000 });

  await goBay(b, 'APP', 'app-coordination');
  await strip(b, 'HOSEE1').getByRole('button', { name: 'Accept Hand Off' }).click({ timeout: 3000 });
  await expect.poll(async () => (await recordsFor(a, 'HOSEE1')).find(r => r.facilityId === 'CENTER').coordination).toBe('ACTIVE');
  await expect(s, 'accepted HANDOFF: nothing on the sender\'s Strip says so').toContainText(/APP|RADAR CONTACT|ACCEPTED/i, { timeout: 2000 });
});

test('a rejected proposal is visible to the controller who sent it', async ({ browser }) => {
  const a = await ctr(browser);
  const b = await app(browser);
  const s = await seedCtrArrival(a, 'REJSEE');
  await propose(a, s, 'OPERATIONAL_REQUEST');
  await goBay(b, 'APP', 'app-coordination');
  await strip(b, 'REJSEE').getByRole('button', { name: 'Unable' }).click({ timeout: 3000 });
  await expect.poll(async () => (await recordsFor(a, 'REJSEE')).find(r => r.facilityId === 'CENTER').coordination).toBe('REJECTED');
  await a.waitForTimeout(300);

  const onStrip = /REJECT|UNABLE/i.test(await s.innerText());
  const banner = (await a.locator('#efsp-mutation-error').textContent() || '').trim();
  expect(onStrip || banner.length > 0,
    'APP said UNABLE; the sender\'s Strip quietly went back to offering Coordinate… and nothing on the panel says the request was refused').toBe(true);
});

// ── F-303 ─────────────────────────────────────────────────────────────────

test('a rejected replica in the receiver\'s Coordination Bay cannot be worked', async ({ browser }) => {
  const a = await ctr(browser);
  const b = await app(browser);
  const s = await seedCtrArrival(a, 'DEADRP');
  await propose(a, s, 'POINT_OUT');
  await goBay(b, 'APP', 'app-coordination');
  const replica = strip(b, 'DEADRP');
  await replica.getByRole('button', { name: 'Reject' }).click({ timeout: 3000 });
  await expect.poll(async () => (await recordsFor(b, 'DEADRP')).find(r => r.facilityId === 'INCIRLIK').coordination).toBe('REJECTED');

  // APP declined this flight. Its NLA must not now hand it to Tower —
  // measured: it did, and the server accepted it (twr-arrivals /
  // HANDED_TO_TOWER) while CENTER still owned the flight.
  //
  // Not toHaveCount(0): removing the button was the catalogue's guess at a
  // fix, not what the finding asked for. §3.5 rule 2 requires the reason to be
  // RENDERED rather than the control merely taken away or greyed out, so the
  // button staying put, disabled, with the reason on the Strip is the shape
  // that answers it — and it is the only shape that tells the controller WHY
  // the flight they declined is still theirs to see.
  const nla = replica.getByRole('button', { name: 'Hand to Tower' });
  await expect(nla, 'the replica APP just rejected offers an enabled Hand to Tower').toBeDisabled({ timeout: 2000 });
  await expect(replica.locator('.efsp-nla-inhibit-reason'),
    'disabled with no reason on the Strip is a control that refuses in silence')
    .toContainText(/rejected/i, { timeout: 2000 });

  // The reason is a line of its own, not a sliver of the row. It used to take
  // whatever the badges and buttons left and break between every letter.
  const [reasonW, stripW] = await replica.evaluate((el) => [
    el.querySelector('.efsp-nla-inhibit-reason').getBoundingClientRect().width,
    el.getBoundingClientRect().width,
  ]);
  expect(reasonW, `the reason is ${Math.round(reasonW)} px wide on a ${Math.round(stripW)} px Strip`).toBeGreaterThan(stripW * 0.5);

  // And nothing that works the flight is offered on it: the server refuses
  // all of it, and MARSA / Bind are flight-level, so hiding them is the guard.
  for (const name of ['Coordinate…', 'Airspace…', 'MARSA…', 'Bind…']) {
    await expect(replica.getByRole('button', { name, exact: true }), `${name} on a dead replica`).toHaveCount(0);
  }
});

// ── F-304 ─────────────────────────────────────────────────────────────────

test('the proposer\'s note reaches the receiver', async ({ browser }) => {
  const a = await ctr(browser);
  const b = await app(browser);
  const s = await seedCtrArrival(a, 'NOTE01');
  const note = 'climbing FL200 on request, verbal done';
  await propose(a, s, 'HANDOFF', note);
  await goBay(b, 'APP', 'app-coordination');
  const replica = strip(b, 'NOTE01');
  await expect(replica.getByRole('button', { name: 'Accept Hand Off' })).toBeVisible();
  const shown = await replica.evaluate((el, n) => el.innerText.includes(n)
    || [...el.querySelectorAll('[title]')].some(t => t.title.includes(n)), note);
  expect(shown, 'the note is stored on the replica (coordination.note) and rendered nowhere').toBe(true);
});

test('a TOFI note reaches the MRU controller', async ({ browser }) => {
  const a = await ctr(browser);
  const b = await tacC2(browser);
  const s = await seedCtrArrival(a, 'NOTE02');
  const note = 'MOA 3 hot, block FL180-FL220';
  await proposeTofiEntry(a, s, note);
  await goBay(b, 'TAC_C2', 'tac-c2-coordination');
  const mission = strip(b, 'NOTE02');
  await expect(mission.getByRole('button', { name: 'Accept TOFI Entry' })).toBeVisible();
  const shown = await mission.evaluate((el, n) => el.innerText.includes(n)
    || [...el.querySelectorAll('[title]')].some(t => t.title.includes(n)), note);
  expect(shown, 'the TOFI note is rendered nowhere on the MRU side').toBe(true);
});

// ── F-305 ─────────────────────────────────────────────────────────────────

test('the +N badge appears on the ATC Strip when a mission line is fragged against it', async ({ browser }) => {
  const a = await ctr(browser);
  const b = await tacC2(browser);
  const s = await seedCtrArrival(a, 'PLUSN1');
  await expect(s.locator('.efsp-shared-fdr-badge')).toHaveCount(0);

  await b.locator('#efsp-dot-command-input').fill('.mission PLUSN1');
  await b.locator('#efsp-dot-command-input').press('Enter');
  await expect.poll(async () => (await recordsFor(a, 'PLUSN1')).length, 'the mission line reached the CTR page\'s store').toBe(2);

  // The badge's own comment: "this badge is how the ATC controller sees that
  // one exists". It is computed from OTHER Strips, and the reconciler only
  // rebuilds a Strip when its OWN rev moves — which a sibling appearing does
  // not do. It appears after a Bay-tab switch forces a full render.
  await expect(s.locator('.efsp-shared-fdr-badge'), 'CTR\'s Strip never shows +1 while they watch it').toHaveText('+1', { timeout: 3000 });
});

test('Accept TOFI Exit enables once CTR has set SEP REG back to ATC', async ({ browser }) => {
  const a = await ctr(browser);
  const b = await tacC2(browser);
  const s = await seedCtrArrival(a, 'EXIT01');
  await proposeTofiEntry(a, s);
  await goBay(b, 'TAC_C2', 'tac-c2-coordination');
  const mission = strip(b, 'EXIT01');
  await mission.locator('select.efsp-tofi-regime-select').selectOption('DUE_REGARD');
  await mission.getByRole('button', { name: 'Accept TOFI Entry' }).click({ timeout: 3000 });
  await expect.poll(async () => (await recordsFor(a, 'EXIT01')).find(r => r.role === 'MISSION').tofi).toBe('ACTIVE');

  await startAction(s, 'TOFI Exit…', { timeout: 3000 });
  await goBay(b, 'TAC_C2', 'tac-c2-tasked');
  const accept = mission.getByRole('button', { name: 'Accept TOFI Exit' });
  await expect(accept, 'SREG is not ATC yet, so disabled is right here').toBeDisabled();
  // ...and it has to LOOK disabled. The accept button's own rule used to win
  // over the denied style, so a refused Accept drew as a live green button.
  const look = await accept.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { cursor: cs.cursor, borderStyle: cs.borderTopStyle };
  });
  expect(look, 'a disabled Accept TOFI Exit is drawn as the live button').toEqual({ cursor: 'not-allowed', borderStyle: 'dashed' });

  await setSepReg(s, 'ATC');
  // The MRU page's own FDR store does get the change...
  await expect.poll(() => b.evaluate(() => [...efspFdrs.values()].find(f => f.identity && f.identity.callsign === 'EXIT01').tofi.separationRegime)).toBe('ATC');
  // ...but the MISSION Strip is not rebuilt (its rev did not move), so the
  // button keeps saying "CTR must set separation regime back to ATC" after
  // CTR has done exactly that.
  await expect(accept, 'still disabled after CTR set SEP REG to ATC').toBeEnabled({ timeout: 3000 });
});

// ── F-306 ─────────────────────────────────────────────────────────────────

test('the regime stated when accepting TOFI shows in SEP REG on both sides', async ({ browser }) => {
  const a = await ctr(browser);
  const b = await tacC2(browser);
  const s = await seedCtrArrival(a, 'SREG01');
  await proposeTofiEntry(a, s);
  await goBay(b, 'TAC_C2', 'tac-c2-coordination');
  const mission = strip(b, 'SREG01');
  await mission.locator('select.efsp-tofi-regime-select').selectOption('DUE_REGARD');
  await mission.getByRole('button', { name: 'Accept TOFI Entry' }).click({ timeout: 3000 });
  await expect.poll(async () => (await recordsFor(a, 'SREG01')).find(r => r.role === 'ARRIVAL').tofi).toBe('ACTIVE');

  // crc-sync writes fdr.tofi.separationRegime = DUE_REGARD on this accept —
  // a page opened AFTERWARDS gets it in its snapshot. Neither page that was
  // connected at the time ever receives it.
  const fdrRegime = (page) => page.evaluate(() => [...efspFdrs.values()].find(f => f.identity && f.identity.callsign === 'SREG01').tofi.separationRegime);
  await expect.poll(() => fdrRegime(a), { message: 'the CTR page never learns the regime', timeout: 3000 }).toBe('DUE_REGARD');
  await expect.poll(() => fdrRegime(b), { message: 'the TAC_C2 page that set it never learns it either', timeout: 3000 }).toBe('DUE_REGARD');
});

// The picker used by a real pointer. Every other spec here uses selectOption,
// which sets the value without clicking — and a real click was what reset it:
// the click bubbled to the Strip, selected it, rebuilt it, and the new select
// read MARSA again. No regime but MARSA could be chosen, so every TOFI exit
// was then blocked on SEP REG.
test('the regime picker can be opened with a real click and keeps what was chosen', async ({ browser }) => {
  const a = await ctr(browser);
  const b = await tacC2(browser);
  const s = await seedCtrArrival(a, 'SREG02');
  await proposeTofiEntry(a, s);
  await goBay(b, 'TAC_C2', 'tac-c2-coordination');
  const mission = strip(b, 'SREG02');
  const select = mission.locator('select.efsp-tofi-regime-select');
  await select.evaluate((el) => { el.dataset.probe = 'original'; });

  await select.click();
  await b.waitForTimeout(300);
  await expect(select, 'clicking the picker rebuilt the Strip under it').toHaveAttribute('data-probe', 'original');
  await expect(b.locator('.efsp-strip.efsp-strip-selected')).toHaveCount(0);

  // Choose ATC from the keyboard, the way an open native dropdown is driven.
  await b.keyboard.press('Escape');
  await select.focus();
  await select.press('ArrowDown');
  await expect(select).toHaveValue('ATC');
  await mission.getByRole('button', { name: 'Accept TOFI Entry' }).click({ timeout: 3000 });

  const fdrRegime = (page) => page.evaluate(() => [...efspFdrs.values()].find(f => f.identity && f.identity.callsign === 'SREG02').tofi.separationRegime);
  await expect.poll(() => fdrRegime(a), { timeout: 3000 }).toBe('ATC');
});

// ── F-307 ─────────────────────────────────────────────────────────────────

test('CTR is told what is blocking the TOFI exit they proposed', async ({ browser }) => {
  const a = await ctr(browser);
  const b = await tacC2(browser);
  const s = await seedCtrArrival(a, 'EXIT02');
  await proposeTofiEntry(a, s);
  await goBay(b, 'TAC_C2', 'tac-c2-coordination');
  const mission = strip(b, 'EXIT02');
  await mission.locator('select.efsp-tofi-regime-select').selectOption('MARSA');
  await mission.getByRole('button', { name: 'Accept TOFI Entry' }).click({ timeout: 3000 });
  await expect.poll(async () => (await recordsFor(a, 'EXIT02')).find(r => r.role === 'ARRIVAL').tofi).toBe('ACTIVE');

  await startAction(s, 'TOFI Exit…', { timeout: 3000 });
  await expect(s.locator('.efsp-tofi-badge')).toContainText(/EXIT[\s\S]*PROPOSED/);
  await a.waitForTimeout(500);
  // Only CTR can fix it — SREG is on the ATC-side Strip alone — and only the
  // MRU side is told, in the title of a disabled button.
  const onStrip = /SEP ?REG|ATC/i.test(await s.locator('.efsp-tofi-badge').evaluate(el => el.textContent + ' ' + el.title));
  const banner = (await a.locator('#efsp-mutation-error').textContent() || '').trim();
  expect(onStrip || banner.length > 0, 'CTR\'s Strip says "TOFI EXIT: PROPOSED" and nothing about SEP REG').toBe(true);
});

// ── F-308 / F-309 — the mission-line bind picker and .mission ──────────────

test('a mission line bound from the picker does not need a callsign retyped', async ({ browser }) => {
  const a = await ctr(browser);
  const b = await tacC2(browser);
  await seedCtrArrival(a, 'BINDA1');
  await seedCtrArrival(a, 'BINDA2');
  const bind = b.locator('#efsp-create-strip-bind');
  await expect(bind.locator('option', { hasText: /^BINDA1\b/ })).toHaveCount(1);
  await bind.selectOption({ label: await bind.locator('option', { hasText: /^BINDA1\b/ }).textContent() });
  await b.locator('#efsp-create-strip-btn').click();
  // Measured: "Enter a callsign first". And the callsign that IS typed is
  // then thrown away — a bound CreateStrip carries no `fdr` — so typing
  // BINDA2 with BINDA1 picked frags BINDA1 without a word.
  await expect.poll(async () => (await recordsFor(b, 'BINDA1')).some(r => r.role === 'MISSION'),
    { message: `refused: "${await b.locator('#efsp-create-strip-msg').textContent()}"`, timeout: 3000 }).toBe(true);
});

test('.mission on a flight that already has a mission line says so', async ({ browser }) => {
  const a = await ctr(browser);
  const b = await tacC2(browser);
  await seedCtrArrival(a, 'TWICE1');
  const input = b.locator('#efsp-dot-command-input');
  await input.fill('.mission TWICE1');
  await input.press('Enter');
  await expect.poll(async () => (await recordsFor(b, 'TWICE1')).length).toBe(2);
  await input.fill('.mission TWICE1');
  await input.press('Enter');
  // Measured: "no live flight TWICE1 available to frag against" — about a
  // flight that is live and on screen.
  await expect(b.locator('#efsp-dot-command-preview')).toContainText(/already/i, { timeout: 2000 });
});
