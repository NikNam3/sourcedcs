'use strict';

/* The WP6 Phase 3 walk (docs/efsp-wp6-plan.md "Verification" 4 and 5), in a
 * real browser: the FIELD STATE panel, runway works and the inspection, the
 * Strip's RWY chip and NLA inhibit, the runway change with its
 * acknowledgements, and the pilot requests the client can show.
 *
 * crc-desktop docs/adr/0068 (the client) over crc-sync docs/adr/0061 (the
 * server). Screenshots go to docs/wip/L1b/ — each is listed with what it proves
 * in docs/wip/L1b.md.
 *
 * Several controllers, each in their own browser context, because the D21
 * checks are about WHO acts: a request from OPS is accepted by a different
 * person at TWR, and an acknowledgement sent as one Position never counts as
 * another's. The e2e crc-sync has no DCS, so the active end starts unset
 * (docs/wip/L1b.md V14) — the walk sets it with a runway change first.
 *
 * The Board and the field are shared by every test in the file (and every
 * spec in a run), so each test drives the runway back to OPEN with no change
 * open before it ends (briefing T12).
 */

const path = require('path');
const { test, expect } = require('./helpers/test');
const { openPanel, stripByCallsign, expectRefusalIsVisible } = require('./helpers/app');

test.describe.configure({ mode: 'serial', timeout: 240000 });

const SHOTS = path.join(__dirname, '..', '..', 'docs', 'wip', 'L1b');
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });

const FDR = { route: 'DCT', requestedAltitude: 'FL250', departureAirport: 'LTAG', destinationAirport: 'LTAF' };
const RUN = String(Date.now()).slice(-3); // callsigns unique per run, since the Board is shared

const _contexts = [];
const _errors = [];
test.beforeEach(() => { _errors.length = 0; });
test.afterEach(async () => {
  while (_contexts.length) await _contexts.pop().close().catch(() => {});
  // Positions are released on disconnect; let crc-sync see it before the next test takes them.
  await new Promise((r) => setTimeout(r, 300));
});

/**
 * Script errors on any page this test opened. A failed network fetch is not
 * one: with no DCS and no map key the harness answers tiles and mission data
 * with 503s, which the browser logs as console errors on every run.
 */
function appErrors() {
  return _errors.flatMap(e => e.consoleErrors).filter(t => !/^Failed to load resource/.test(t));
}

async function controller(browser, held, name) {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1920, height: 1200 } });
  _contexts.push(ctx);
  const page = await ctx.newPage();
  const { consoleErrors } = await openPanel(page, { held, controller: name });
  // The radio strip stays open: closing it makes srs-radio.js throw on every
  // poll (docs/wip/L1b.md, Findings), which would drown the console check.
  _errors.push({ name, consoleErrors });
  return page;
}

// ── the field ────────────────────────────────────────────────────────────

const field = (page) => page.evaluate(() => getEfspFieldState('INCIRLIK'));
const runway = async (page) => (await field(page)).runways[0];

/** Sends a field-state op with the current rev, as `positionId`, and waits for the record to move. */
async function fieldOp(page, positionId, op) {
  const before = (await field(page)).rev;
  await page.evaluate(([p, o]) => sendEfspFieldStateMutation(p, 'INCIRLIK', getEfspFieldState('INCIRLIK').rev, o), [positionId, op]);
  await expect.poll(async () => (await field(page)).rev, { message: `${op.kind} as ${positionId}` }).toBeGreaterThan(before);
}

/** Opens FIELD STATE the way a controller does: its row in the PANELS list. */
async function openFieldPanel(page) {
  if (!(await page.evaluate(() => isDockPanelOpen('fieldState')))) {
    if (!(await page.evaluate(() => isDockPanelOpen('radars')))) await page.locator('#btn-radars').click();
    await page.evaluate(() => dock.api.getPanel('radars').api.setActive());
    await page.locator('#panel-controls .panel-ctrl-label', { hasText: /^FIELD STATE/ }).click();
  }
  await expect(page.locator('#field-state-panel')).toBeVisible();
}

/**
 * Puts FIELD STATE in its own column beside the Strip panel, so a controller
 * (and a screenshot) sees the field and the Strips at once. Also sidesteps
 * the Strip panel rendering while dockview has it detached behind another tab
 * of its group (docs/wip/L1b.md, Findings: the arrivals line duplicates).
 */
async function besideStrips(page) {
  await page.evaluate(() => {
    const p = dock.api.getPanel('fieldState');
    if (p) dock.api.removePanel(p);
    dock.addPanel({ id: 'fieldState', component: 'fieldState', title: PANEL_TITLES.fieldState, position: { referencePanel: 'efsp', direction: 'right' } });
    dock.api.getPanel('efsp').api.setActive();
  });
  await expect(page.locator('#field-state-panel')).toBeVisible();
  await expect(page.locator('#efsp-panel')).toBeVisible();
}

/** Brings a dock panel to the front of its tab group. */
async function front(page, id) {
  await page.evaluate((id) => dock.api.getPanel(id).api.setActive(), id);
}

/** A field-state button in the panel, pressed. The panel must be in front. */
async function press(page, kind, { positionId, action } = {}) {
  await front(page, 'fieldState');
  let sel = `#field-state-panel button[data-kind="${kind}"]`;
  if (positionId) sel += `[data-position-id="${positionId}"]`;
  if (action) sel += `[data-action="${action}"]`;
  const btn = page.locator(sel);
  await expect(btn, `${kind} is offered`).toHaveCount(1);
  const before = (await field(page)).rev;
  await btn.click({ timeout: 3000 });
  await expect.poll(async () => (await field(page)).rev, { message: `${kind} applied` }).toBeGreaterThan(before);
}

const offered = (page, kind) => page.locator(`#field-state-panel button[data-kind="${kind}"]`);

/** Back to OPEN with no change open, whatever the walk left (briefing T12). Needs TWR and OPS held. */
async function resetField(page) {
  for (let i = 0; i < 8; i++) {
    const f = await field(page);
    const change = f.runwayChange;
    const r = f.runways[0];
    if (r.pendingRequest) await fieldOp(page, 'TWR', { kind: 'RejectRunwayRequest', runwayId: r.runwayId, note: 'e2e cleanup' });
    else if (change && ['PROPOSED', 'ACKNOWLEDGED'].includes(change.state)) await fieldOp(page, 'TWR', { kind: 'WithdrawRunwayChange' });
    else if (change && change.state === 'IN_PROGRESS') await fieldOp(page, 'TWR', { kind: 'CompleteRunwayChange' });
    else if (r.status === 'CLOSED') await fieldOp(page, 'TWR', { kind: 'OpenRunway', runwayId: r.runwayId });
    else if (r.status === 'SUSPENDED_WORKS') await fieldOp(page, 'OPS', { kind: 'CompleteRunwayWorks', runwayId: r.runwayId });
    else if (r.status === 'SUSPENDED_INSPECTION') await fieldOp(page, 'OPS', { kind: 'CompleteInspection', runwayId: r.runwayId });
    else return;
  }
  throw new Error('the field would not go back to OPEN');
}

// ── Strips ───────────────────────────────────────────────────────────────

const stripOf = (page, cs) => page.evaluate((cs) => getAllEfspStrips().find((x) => {
  const f = getEfspFdr(x.fdrId);
  return f && f.identity.callsign === cs && x.state !== 'DROPPED';
}) || null, cs);

/** A Strip op sent as `positionId`, else its owner when held here, else the first Position held here. */
async function stripOp(page, cs, op, positionId) {
  await page.evaluate(([cs, op, p]) => {
    const s = getAllEfspStrips().find((x) => getEfspFdr(x.fdrId).identity.callsign === cs && x.state !== 'DROPPED');
    const held = getActingPositions('INCIRLIK');
    sendEfspMutation(p || (held.includes(s.ownerPositionId) ? s.ownerPositionId : held[0]), s, op);
  }, [cs, op, positionId || null]);
}

/** Creates a Strip over the real wire and waits for it in client state (not in whatever Bay is on screen). */
async function seed(page, { callsign, role, actingPositionId = 'OPS', bayId = 'ops-proposed', fdr = {} }) {
  await page.evaluate(([acting, op]) => window.sendEfspCreateStrip(acting, op, 'INCIRLIK'), [
    actingPositionId, { kind: 'CreateStrip', bayId, rackId: 'main', role, fdr: { callsign, aircraftType: 'F16', wakeCategory: 'D', ...FDR, ...fdr } },
  ]);
  await expect.poll(() => stripOf(page, callsign), { message: `${callsign} created` }).not.toBeNull();
}

async function setState(page, cs, toState) {
  await stripOp(page, cs, { kind: 'SetState', toState });
  await expect.poll(async () => (await stripOf(page, cs)).state, { message: `${cs} -> ${toState}` }).toBe(toState);
}

/** Presses the Strip's NLA `n` times through the page's own _invokeNla, as the real button does. */
async function nla(page, cs, n = 1) {
  for (let i = 0; i < n; i++) {
    const before = (await stripOf(page, cs)).state;
    await page.evaluate((cs) => _invokeNla(getAllEfspStrips().find((x) => getEfspFdr(x.fdrId).identity.callsign === cs && x.state !== 'DROPPED')), cs);
    await expect.poll(async () => (await stripOf(page, cs)).state, { message: `${cs} NLA from ${before}` }).not.toBe(before);
    await page.waitForTimeout(450); // the server's per-Strip 400 ms double-tap guard (T5)
  }
}

async function goBay(page, positionId, bayId) {
  await front(page, 'efsp');
  // `force`: a tab lit by the arrival flash (docs/adr/0057) animates, and
  // Playwright would wait for it to be "stable" until the test times out.
  const pos = page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id="${positionId}"]`);
  if (!/\bactive\b/.test(await pos.getAttribute('class') || '')) await pos.click({ force: true });
  const bay = page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id="${bayId}"]`);
  if (!/\bactive\b/.test(await bay.getAttribute('class') || '')) await bay.click({ force: true });
  await expect(bay).toHaveClass(/\bactive\b/);
}

const chip = (strip) => strip.locator('.efsp-ind[data-slot="rwy"]');
const nlaBtn = (strip) => strip.locator('.efsp-nla-btn');
const nlaReason = (strip) => strip.locator('.efsp-nla-inhibit-reason');

/** Drops each Strip from whichever page holds its owner. */
async function dropAll(pages, callsigns) {
  for (const cs of callsigns) {
    for (const page of pages) {
      const s = await stripOf(page, cs);
      if (!s) break;
      if (await page.evaluate((o) => getActingPositions('INCIRLIK').includes(o), s.ownerPositionId)) {
        await stripOp(page, cs, { kind: 'DropStrip', reason: 'e2e cleanup' });
        break;
      }
    }
  }
}

// ── the walk ─────────────────────────────────────────────────────────────

test('Phase 3 walk: OPS asks for runway works, TWR suspends, the Strips hold, FINAL still lands, OPS inspects and reopens', async ({ browser }) => {
  const ops = await controller(browser, ['OPS', 'CD', 'GND', 'APP'], 'goose');
  const twr = await controller(browser, ['TWR'], 'maverick');
  await openFieldPanel(ops);
  await openFieldPanel(twr);

  // 1. The panel, opened from the PANELS list.
  await expect(twr.locator('#field-state-panel .field-state-runway-id')).toHaveText('05/23');
  await expect(twr.locator('#field-state-panel .field-state-badge')).toHaveText('OPEN');
  await expect(twr.locator('#field-state-panel .field-state-active')).toHaveText(/ACTIVE/);
  await shot(twr, '01-panel-open');
  await besideStrips(twr);
  await besideStrips(ops);

  // 2. The traffic: a departure taxiing for 05, one queued in 05's rack, an
  // arrival handed to tower for 05, and a hook-equipped arrival on final.
  const DEP_TAXI = `FST${RUN}`; const DEP_Q = `FSQ${RUN}`; const ARR_TWR = `FSA${RUN}`; const ARR_FIN = `FSF${RUN}`;
  // Walked through the real NLA chain, so each Strip is owned and filed where
  // the server would put it.
  await seed(ops, { callsign: DEP_TAXI, role: 'DEPARTURE', fdr: { departureRunway: '05' } });
  await nla(ops, DEP_TAXI, 4); // -> TAXI (GND)
  await seed(ops, { callsign: DEP_Q, role: 'DEPARTURE', fdr: { departureRunway: '05' } });
  await nla(ops, DEP_Q, 5); // -> RUNWAY_QUEUE (TWR)
  expect((await stripOf(ops, DEP_Q)).rackId, 'filed into 05\'s rack by its 8A (S-R2-1)').toBe('rwy-05');
  for (const cs of [ARR_TWR, ARR_FIN]) {
    await seed(ops, { callsign: cs, role: 'ARRIVAL', actingPositionId: 'APP', bayId: 'app-inbound', fdr: { departureAirport: 'LTAF', destinationAirport: 'LTAG' } });
    await stripOp(ops, cs, { kind: 'SetBlock', blockId: '8B', value: '05' }, 'APP');
  }
  await stripOp(ops, ARR_FIN, { kind: 'SetBlock', blockId: '3F', value: true }, 'APP');
  await expect.poll(async () => (await ops.evaluate((cs) => { const s = getAllEfspStrips().find((x) => getEfspFdr(x.fdrId).identity.callsign === cs); return getEfspFdr(s.fdrId).military.hookRequired; }, ARR_FIN))).toBe(true);
  await nla(ops, ARR_TWR, 1); // -> HANDED_TO_TOWER (TWR)
  await nla(ops, ARR_FIN, 1);
  await nla(twr, ARR_FIN, 1); // -> FINAL

  // 3. OPS asks; TWR (another person) accepts, which suspends the runway.
  await press(ops, 'RequestRunwayStatus', { positionId: 'OPS', action: 'WORKS' });
  await expect(ops.locator('#field-state-panel .field-state-request')).toHaveText(/^REQUEST WORKS from OPS \(goose\) \d{4}Z · waiting on TWR$/);
  await expect(offered(ops, 'BeginRunwayWorks'), 'OPS never begins works itself (H18)').toHaveCount(0);
  await expect(twr.locator('#field-state-panel .field-state-request')).toBeVisible();
  await press(twr, 'AcceptRunwayRequest', { positionId: 'TWR' });
  expect((await runway(twr)).status).toBe('SUSPENDED_WORKS');
  await expect(twr.locator('#field-state-panel .field-state-suspension'))
    .toHaveText(/^SUSPENDED WORKS by TWR \(maverick\) \d{4}Z · requested by OPS \(goose\)$/);
  await expect(twr.locator('#field-state-panel .field-state-badge')).toHaveText('WORKS');
  await shot(twr, '02-suspended-panel');

  // Every Strip that will use 05/23 says so; the queued departure and the
  // arrival handed to tower are held by the server, with the reason.
  await goBay(twr, 'TWR', 'twr-runway-queue');
  const queued = stripByCallsign(twr, DEP_Q);
  await expect(chip(queued)).toHaveText('RWY 05 SUSP');
  await expect(nlaBtn(queued)).toBeDisabled();
  await expect(nlaReason(queued)).toHaveText('runway 05/23 suspended — works in progress');
  await expect(queued.locator('.efsp-alert-reason:not(:empty)'), 'the Strip never says it twice').toHaveCount(0);
  await shot(twr, '03-strips-inhibited');
  await goBay(twr, 'TWR', 'twr-arrivals');
  const handed = stripByCallsign(twr, ARR_TWR);
  await expect(chip(handed)).toHaveText('RWY 05 SUSP');
  await expect(nlaBtn(handed)).toBeDisabled();
  await expect(nlaReason(handed)).toHaveText('runway 05/23 suspended — works in progress');
  await shot(twr, '03b-arrival-inhibited');
  await goBay(ops, 'GND', 'gnd-taxi-out');
  const taxiing = stripByCallsign(ops, DEP_TAXI);
  await expect(chip(taxiing), 'proactive: TAXI shows the chip before its NLA is the gated one').toHaveText('RWY 05 SUSP');
  // TAXI -> RUNWAY_QUEUE is itself held (rule 1), so the server's reason is the one line.
  await expect(nlaBtn(taxiing)).toBeDisabled();
  await expect(nlaReason(taxiing)).toHaveText('runway 05/23 suspended — works in progress');
  await expect(taxiing.locator('.efsp-alert-reason:not(:empty)')).toHaveCount(0);

  // 4. An aircraft already on final still lands: touchdown is an observation.
  await goBay(twr, 'TWR', 'twr-final');
  const final = stripByCallsign(twr, ARR_FIN);
  await expect(chip(final)).toHaveText('RWY 05 SUSP');
  await expect(final.locator('.efsp-alert-reason')).toHaveText(/Landing is an observation and is not held\.$/);
  await expect(nlaBtn(final)).toBeEnabled();
  await nlaBtn(final).click();
  await expect.poll(async () => (await stripOf(twr, ARR_FIN)).state).toBe('LANDED');
  await goBay(twr, 'TWR', 'twr-final');
  await shot(twr, '04-final-still-lands');

  // 5. OPS: works complete -> still suspended, now awaiting inspection.
  await press(ops, 'CompleteRunwayWorks', { positionId: 'OPS' });
  expect((await runway(ops)).status).toBe('SUSPENDED_INSPECTION');
  await goBay(twr, 'TWR', 'twr-runway-queue');
  await expect(chip(stripByCallsign(twr, DEP_Q))).toHaveText('RWY 05 INSP');
  await expect(nlaReason(stripByCallsign(twr, DEP_Q))).toHaveText('runway 05/23 suspended — awaiting inspection');
  // TWR is not the inspection authority: the button is not offered, and the
  // server refuses it anyway when sent by hand — named by the runway.
  await expect(offered(twr, 'CompleteInspection')).toHaveCount(0);
  await front(twr, 'efsp');
  await twr.evaluate(() => sendEfspFieldStateMutation('TWR', 'INCIRLIK', getEfspFieldState('INCIRLIK').rev, { kind: 'CompleteInspection', runwayId: '05/23' }));
  await expect(twr.locator('#efsp-mutation-error')).toHaveText(/^runway 05\/23 — /);
  expect(await expectRefusalIsVisible(twr, 'TWR signing off an inspection')).toMatch(/^runway 05\/23/);
  await shot(twr, '05-inspection-refused-to-twr');

  await press(ops, 'CompleteInspection', { positionId: 'OPS' });
  expect((await runway(ops)).status).toBe('OPEN');
  await expect(chip(stripByCallsign(twr, DEP_Q))).toHaveCount(0);
  await expect(nlaBtn(stripByCallsign(twr, DEP_Q))).toBeEnabled();
  await front(twr, 'fieldState');
  await expect(twr.locator('#field-state-panel .field-state-inspection')).toHaveText(/^INSPECTED by OPS \(goose\) \d{4}Z$/);
  await shot(twr, '06-reopened');

  await dropAll([ops, twr], [DEP_TAXI, DEP_Q, ARR_TWR, ARR_FIN]);
  expect(appErrors(), 'console errors').toEqual([]);
});

test('Phase 3 walk: a runway change needs OPS and APP (each a different person), then an inspection; a Strip left in 05\'s rack is told', async ({ browser }) => {
  const twr = await controller(browser, ['TWR'], 'maverick');
  const ops = await controller(browser, ['OPS', 'CD', 'GND'], 'goose');
  const app = await controller(browser, ['APP'], 'iceman');
  for (const p of [twr, ops, app]) { await openFieldPanel(p); await besideStrips(p); }

  // Start from 05 active (the harness has no mission wind), by the machinery itself.
  if ((await field(twr)).activeRunway !== '05') {
    await fieldOp(twr, 'TWR', { kind: 'ProposeRunwayChange', toRunwayId: '05' });
    await fieldOp(ops, 'OPS', { kind: 'AckRunwayChange' });
    await fieldOp(app, 'APP', { kind: 'AckRunwayChange' });
    await fieldOp(twr, 'TWR', { kind: 'BeginRunwayChange' });
    await fieldOp(twr, 'TWR', { kind: 'CompleteRunwayChange' });
    await fieldOp(ops, 'OPS', { kind: 'CompleteInspection', runwayId: '05/23' });
  }
  expect((await field(twr)).activeRunway).toBe('05');

  const DEP = `FSR${RUN}`;
  await seed(ops, { callsign: DEP, role: 'DEPARTURE', fdr: { departureRunway: '05' } });
  await nla(ops, DEP, 5);
  expect((await stripOf(ops, DEP)).rackId).toBe('rwy-05');

  // TWR proposes 05 -> 23 from the panel's end picker.
  await front(twr, 'fieldState');
  await twr.locator('#field-state-panel select.field-state-to-end').selectOption('23');
  await press(twr, 'ProposeRunwayChange', { positionId: 'TWR' });
  await expect(offered(twr, 'BeginRunwayChange'), 'not before both acknowledge').toHaveCount(0);
  await press(app, 'AckRunwayChange', { positionId: 'APP' });
  await expect(offered(twr, 'BeginRunwayChange'), 'APP alone is not enough').toHaveCount(0);
  await expect(twr.locator('#field-state-panel .field-state-ack-done')).toHaveText([/^APP ✓ \d{4}Z$/]);
  await expect(twr.locator('#field-state-panel .field-state-ack-waiting')).toHaveText(['OPS …']);
  await press(ops, 'AckRunwayChange', { positionId: 'OPS' });
  await expect(offered(twr, 'BeginRunwayChange')).toHaveCount(1);
  await press(twr, 'BeginRunwayChange', { positionId: 'TWR' });
  await press(twr, 'CompleteRunwayChange', { positionId: 'TWR' });
  const pending = await field(twr);
  expect(pending.activeRunway).toBe('23');
  expect(pending.runwayChange.state).toBe('PENDING_INSPECTION');
  await expect(twr.locator('#field-state-panel .field-state-change-pending')).toHaveText('PENDING INSPECTION: 05/23');
  await press(ops, 'CompleteInspection', { positionId: 'OPS' });
  expect((await field(twr)).runwayChange).toBeNull();
  await front(twr, 'fieldState');
  await expect(twr.locator('#field-state-panel .field-state-active')).toHaveText('▶ 23 ACTIVE');
  await shot(twr, '07-runway-change-done');

  // Q30: nothing moves a Strip on its own; the one queued for 05 is told.
  await goBay(twr, 'TWR', 'twr-runway-queue');
  const q = stripByCallsign(twr, DEP);
  await expect(chip(q)).toHaveText('RWY 05 INACT');
  await expect(q.locator('.efsp-alert-reason')).toHaveText(/^Queued for inactive runway 05; the active runway is 23\./);
  await shot(twr, '08-inactive-runway-advisory');

  // Pilot request "request runway 23": TWR moves the Strip to 23's rack and
  // the advisory follows the rack (the chip goes).
  await twr.evaluate((cs) => _moveStrip(getAllEfspStrips().find((s) => getEfspFdr(s.fdrId).identity.callsign === cs && s.state !== 'DROPPED'), 'twr-runway-queue', 'rwy-23', null, null), DEP);
  await expect.poll(async () => (await stripOf(twr, DEP)).rackId).toBe('rwy-23');
  await expect(chip(stripByCallsign(twr, DEP))).toHaveCount(0);

  // A change APP rejects: what TWR sees.
  await front(twr, 'fieldState');
  await twr.locator('#field-state-panel select.field-state-to-end').selectOption('05');
  await press(twr, 'ProposeRunwayChange', { positionId: 'TWR' });
  app.once('dialog', (d) => d.accept('wind is 240 at 15'));
  await press(app, 'RejectRunwayChange', { positionId: 'APP' });
  await front(twr, 'fieldState');
  await expect(twr.locator('#field-state-panel .field-state-change-rejected')).toHaveText(/^REJECTED by APP \(iceman\) \d{4}Z — wind is 240 at 15$/);
  expect((await field(twr)).activeRunway).toBe('23');
  await shot(twr, '09-rejected');

  await dropAll([twr, ops], [DEP]);
  expect(appErrors(), 'console errors').toEqual([]);
});

test('a reload mid-suspension still shows SUSPENDED (the snapshot carries it); then the field is put back', async ({ browser }) => {
  const twr = await controller(browser, ['TWR', 'OPS'], 'maverick');
  await openFieldPanel(twr);
  await besideStrips(twr);
  await press(twr, 'BeginRunwayWorks', { positionId: 'TWR' });
  await twr.reload();
  await twr.waitForFunction(() => typeof getEfspFieldState === 'function' && !!getEfspFieldState('INCIRLIK'));
  await openFieldPanel(twr);
  await besideStrips(twr);
  await front(twr, 'fieldState');
  await expect(twr.locator('#field-state-panel .field-state-badge')).toHaveText('WORKS');
  await expect(twr.locator('#field-state-panel .field-state-suspension')).toHaveText(/^SUSPENDED WORKS by TWR \(maverick\) \d{4}Z$/);
  await shot(twr, '11-reload-still-suspended');
  // The reload dropped the Positions (a new connection); take them back to clean up.
  await twr.evaluate(() => window.sendEfspSetPositions('INCIRLIK', ['TWR', 'OPS']));
  await twr.waitForFunction(() => getActingPositions('INCIRLIK').length === 2);
  await resetField(twr);
  expect((await runway(twr)).status).toBe('OPEN');
});

test('one controller holding TWR, OPS and APP changes the runway in one self-coordinated input (S-Q24)', async ({ browser }) => {
  const solo = await controller(browser, ['TWR', 'OPS', 'APP'], 'solo');
  await openFieldPanel(solo);
  await besideStrips(solo);
  await front(solo, 'fieldState');
  await expect(offered(solo, 'SelfCoordinateRunwayChange')).toHaveCount(1);
  const to = (await field(solo)).activeRunway === '23' ? '05' : '23';
  await solo.locator('#field-state-panel .field-state-actions').filter({ has: solo.locator('button[data-kind="SelfCoordinateRunwayChange"]') })
    .locator('select.field-state-to-end').last().selectOption(to);
  await press(solo, 'SelfCoordinateRunwayChange', { positionId: 'TWR' });
  const change = (await field(solo)).runwayChange;
  expect(change.state).toBe('ACKNOWLEDGED');
  expect(change.selfCoordinated).toBe(true);
  await expect(solo.locator('#field-state-panel .field-state-ack-done')).toHaveText([/^OPS ✓ self \d{4}Z$/, /^APP ✓ self \d{4}Z$/]);
  await shot(solo, '12-self-coordinated');
  await press(solo, 'BeginRunwayChange', { positionId: 'TWR' });
  await press(solo, 'CompleteRunwayChange', { positionId: 'TWR' });
  await press(solo, 'CompleteInspection', { positionId: 'OPS' });
  expect((await field(solo)).activeRunway).toBe(to);
  await resetField(solo);
  expect(appErrors(), 'console errors').toEqual([]);
});
