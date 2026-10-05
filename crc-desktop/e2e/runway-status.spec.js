'use strict';

/* The WP6 Phase 3 walk (docs/efsp-wp6-plan.md "Verification" 4 and 5), in a
 * real browser: the RUNWAY STATUS panel, runway works and the inspection, the
 * Strip's RWY chip and NLA inhibit, the runway change with its
 * acknowledgements, and the pilot requests the client can show.
 *
 * crc-desktop docs/adr/0068 (the client) over crc-sync docs/adr/0061 (the
 * server). Screenshots go to the test output directory (test-results/) — each is listed with what it proves
 * in docs/wip/L1b.md.
 *
 * Several controllers, each in their own browser context, because the D21
 * checks are about WHO acts: a request from OPS is accepted by a different
 * person at LC, and an acknowledgement sent as one Position never counts as
 * another's. The e2e crc-sync has no DCS, so the active end starts unset
 * (docs/wip/L1b.md V14) — the walk sets it with a runway change first.
 *
 * The Board and the field are shared by every test in the file (and every
 * spec in a run), so each test drives the runway back to OPEN with no change
 * open before it ends (briefing T12).
 */

const path = require('path');
const { test, expect } = require('./helpers/test');
const { openPanel, stripByCallsign, expectRefusalIsVisible, lapseNlaGuard } = require('./helpers/app');
const { installAppModules } = require('./helpers/modules');

test.describe.configure({ mode: 'serial', timeout: 240000 });
// The walk builds on its own earlier tests, so the Board is reset once per file, not per test (helpers/test.js).
test.use({ resetScope: 'file' });

const shot = (page, name) => page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: false });

const FLIGHT_DATA = { route: 'DCT', requestedAltitude: 'FL250', departureAirport: 'LTAG', destinationAirport: 'LTAF' };
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

async function controller(browser, signedOn, name) {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1920, height: 1200 } });
  _contexts.push(ctx);
  const page = await ctx.newPage();
  const { consoleErrors } = await openPanel(page, { signedOn, controller: name });
  // The radio strip stays open: closing it makes srs-radio.js throw on every
  // poll (docs/wip/L1b.md, Findings), which would drown the console check.
  _errors.push({ name, consoleErrors });
  return page;
}

// ── the field ────────────────────────────────────────────────────────────

const field = (page) => page.evaluate(() => crc.state.getEfspRunwayStatus('INCIRLIK'));
const runway = async (page) => (await field(page)).runways[0];

/** Sends a runway-status op with the current rev, as `positionId`, and waits for the record to move. */
async function fieldOp(page, positionId, op) {
  const before = (await field(page)).rev;
  await page.evaluate(([p, o]) => crc.ws.sendEfspRunwayStatusMutation(p, 'INCIRLIK', crc.state.getEfspRunwayStatus('INCIRLIK').rev, o), [positionId, op]);
  await expect.poll(async () => (await field(page)).rev, { message: `${op.kind} as ${positionId}` }).toBeGreaterThan(before);
}

/** Opens RUNWAY STATUS the way a controller does: its row in the PANELS list. */
async function openFieldPanel(page) {
  if (!(await page.evaluate(() => crc.dock.isDockPanelOpen('runwayStatus')))) {
    if (!(await page.evaluate(() => crc.dock.isDockPanelOpen('radars')))) await page.locator('#btn-radars').click();
    await page.evaluate(() => crc.dock.dock.api.getPanel('radars').api.setActive());
    await page.locator('#panel-controls .panel-ctrl-label', { hasText: /^RUNWAY STATUS/ }).click();
  }
  await expect(page.locator('#runway-status-panel')).toBeVisible();
}

/**
 * Puts RUNWAY STATUS in its own column beside the Strip panel, so a controller
 * (and a screenshot) sees the field and the Strips at once. Also sidesteps
 * the Strip panel rendering while dockview has it detached behind another tab
 * of its group (docs/wip/L1b.md, Findings: the arrivals line duplicates).
 */
async function besideStrips(page) {
  await page.evaluate(() => {
    const p = crc.dock.dock.api.getPanel('runwayStatus');
    if (p) crc.dock.dock.api.removePanel(p);
    crc.dock.dock.addPanel({ id: 'runwayStatus', component: 'runwayStatus', title: crc.dock.PANEL_TITLES.runwayStatus, position: { referencePanel: 'efsp', direction: 'right' } });
    crc.dock.dock.api.getPanel('efsp').api.setActive();
  });
  await expect(page.locator('#runway-status-panel')).toBeVisible();
  await expect(page.locator('#efsp-panel')).toBeVisible();
}

/** Brings a dock panel to the front of its tab group. */
async function front(page, id) {
  await page.evaluate((id) => crc.dock.dock.api.getPanel(id).api.setActive(), id);
}

/** A runway-status button in the panel, pressed. The panel must be in front. */
async function press(page, kind, { positionId, action } = {}) {
  await front(page, 'runwayStatus');
  let sel = `#runway-status-panel button[data-kind="${kind}"]`;
  if (positionId) sel += `[data-position-id="${positionId}"]`;
  if (action) sel += `[data-action="${action}"]`;
  const btn = page.locator(sel);
  await expect(btn, `${kind} is offered`).toHaveCount(1);
  const before = (await field(page)).rev;
  await btn.click({ timeout: 5000 });
  await expect.poll(async () => (await field(page)).rev, { message: `${kind} applied` }).toBeGreaterThan(before);
}

/** An action that asks for a reason (Close, Reject): the inline form, not a native dialog. */
async function pressWithReason(page, kind, { positionId, action } = {}, reason = '') {
  await front(page, 'runwayStatus');
  let sel = `#runway-status-panel button[data-kind="${kind}"]`;
  if (positionId) sel += `[data-position-id="${positionId}"]`;
  if (action) sel += `[data-action="${action}"]`;
  await expect(page.locator(sel), `${kind} is offered`).toHaveCount(1);
  const before = (await field(page)).rev;
  await page.locator(sel).click({ timeout: 5000 });
  const input = page.locator('#runway-status-panel .runway-status-reason-input');
  await expect(input, 'the reason is asked for inline').toBeVisible();
  await input.fill(reason);
  await page.locator('#runway-status-panel .runway-status-reason-send').click();
  await expect.poll(async () => (await field(page)).rev, { message: `${kind} applied` }).toBeGreaterThan(before);
}

const offered = (page, kind) => page.locator(`#runway-status-panel button[data-kind="${kind}"]`);

/** Back to OPEN with no change open, whatever the walk left (briefing T12). Needs LC and OPS held. */
async function resetField(page) {
  for (let i = 0; i < 8; i++) {
    const f = await field(page);
    const change = f.runwayChange;
    const r = f.runways[0];
    if (r.pendingRequest) await fieldOp(page, 'LC', { kind: 'RejectRunwayRequest', runwayId: r.runwayId, note: 'e2e cleanup' });
    else if (change && ['PROPOSED', 'ACKNOWLEDGED'].includes(change.state)) await fieldOp(page, 'LC', { kind: 'WithdrawRunwayChange' });
    else if (change && change.state === 'IN_PROGRESS') await fieldOp(page, 'LC', { kind: 'CompleteRunwayChange' });
    else if (r.status === 'CLOSED') await fieldOp(page, 'LC', { kind: 'OpenRunway', runwayId: r.runwayId });
    else if (r.status === 'SUSPENDED_WORKS') await fieldOp(page, 'OPS', { kind: 'CompleteRunwayWorks', runwayId: r.runwayId });
    else if (r.status === 'SUSPENDED_INSPECTION') await fieldOp(page, 'OPS', { kind: 'CompleteInspection', runwayId: r.runwayId });
    else return;
  }
  throw new Error('the field would not go back to OPEN');
}

// ── Strips ───────────────────────────────────────────────────────────────

const stripOf = (page, cs) => page.evaluate((cs) => crc.state.getAllEfspStrips().find((x) => {
  const f = crc.state.getEfspFlightData(x.flightDataId);
  return f && f.identity.callsign === cs && x.state !== 'DROPPED';
}) || null, cs);

/** A Strip op sent as `positionId`, else its owner when held here, else the first Position held here. */
async function stripOp(page, cs, op, positionId) {
  await page.evaluate(([cs, op, p]) => {
    const s = crc.state.getAllEfspStrips().find((x) => crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs && x.state !== 'DROPPED');
    const signedOn = crc.ws.getActingPositions('INCIRLIK');
    crc.ws.sendEfspMutation(p || (signedOn.includes(s.ownerPositionId) ? s.ownerPositionId : signedOn[0]), s, op);
  }, [cs, op, positionId || null]);
}

/** Creates a Strip over the real wire and waits for it in client state (not in whatever Bay is on screen). */
async function seed(page, { callsign, stripType, actingPositionId = 'OPS', bayId = 'ops-proposed', flightData = {} }) {
  await page.evaluate(([acting, op]) => crc.ws.sendEfspCreateStrip(acting, op, 'INCIRLIK'), [
    actingPositionId, { kind: 'CreateStrip', bayId, rackId: 'main', stripType, flightData: { callsign, aircraftType: 'F16', wakeCategory: 'D', ...FLIGHT_DATA, ...flightData } },
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
    await page.evaluate((cs) => crc.dispatch._invokeNla(crc.state.getAllEfspStrips().find((x) => crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs && x.state !== 'DROPPED')), cs);
    await expect.poll(async () => (await stripOf(page, cs)).state, { message: `${cs} NLA from ${before}` }).not.toBe(before);
    await lapseNlaGuard(page); // the client's double-tap window (T5)
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
      if (await page.evaluate((o) => crc.ws.getActingPositions('INCIRLIK').includes(o), s.ownerPositionId)) {
        await stripOp(page, cs, { kind: 'DropStrip', reason: 'e2e cleanup' });
        break;
      }
    }
  }
}

// ── the walk ─────────────────────────────────────────────────────────────

test('Phase 3 walk: OPS asks for runway works, LC suspends, the Strips hold, FINAL still lands, OPS inspects and reopens', async ({ browser }) => {
  const ops = await controller(browser, ['OPS', 'CD', 'GC', 'AP'], 'goose');
  const lc = await controller(browser, ['LC'], 'maverick');
  await openFieldPanel(ops);
  await openFieldPanel(lc);

  // 1. The panel, opened from the PANELS list.
  await expect(lc.locator('#runway-status-panel .runway-status-runway-id')).toHaveText('05/23');
  await expect(lc.locator('#runway-status-panel .runway-status-badge')).toHaveText('OPEN');
  await expect(lc.locator('#runway-status-panel .runway-status-active')).toHaveText(/ACTIVE/);
  await shot(lc, '01-panel-open');
  await besideStrips(lc);
  await besideStrips(ops);

  // 2. The traffic: a departure taxiing for 05, one queued in 05's rack, an
  // arrival handed to tower for 05, and a hook-equipped arrival on final.
  const DEP_TAXI = `FST${RUN}`; const DEP_Q = `FSQ${RUN}`; const ARR_LC = `FSA${RUN}`; const ARR_FIN = `FSF${RUN}`;
  // Walked through the real NLA chain, so each Strip is owned and filed where
  // the server would put it.
  await seed(ops, { callsign: DEP_TAXI, stripType: 'DEPARTURE', flightData: { departureRunway: '05' } });
  await nla(ops, DEP_TAXI, 4); // -> TAXI (GC)
  await seed(ops, { callsign: DEP_Q, stripType: 'DEPARTURE', flightData: { departureRunway: '05' } });
  await nla(ops, DEP_Q, 5); // -> RUNWAY_QUEUE (LC)
  expect((await stripOf(ops, DEP_Q)).rackId, 'filed into 05\'s rack by its 8A (S-R2-1)').toBe('rwy-05');
  for (const cs of [ARR_LC, ARR_FIN]) {
    await seed(ops, { callsign: cs, stripType: 'ARRIVAL', actingPositionId: 'AP', bayId: 'ap-inbound', flightData: { departureAirport: 'LTAF', destinationAirport: 'LTAG' } });
    await stripOp(ops, cs, { kind: 'SetBlock', blockId: '8B', value: '05' }, 'AP');
  }
  await stripOp(ops, ARR_FIN, { kind: 'SetBlock', blockId: '3F', value: true }, 'AP');
  await expect.poll(async () => (await ops.evaluate((cs) => { const s = crc.state.getAllEfspStrips().find((x) => crc.state.getEfspFlightData(x.flightDataId).identity.callsign === cs); return crc.state.getEfspFlightData(s.flightDataId).military.hookRequired; }, ARR_FIN))).toBe(true);
  await nla(ops, ARR_LC, 1); // -> HANDED_TO_TOWER (LC)
  await nla(ops, ARR_FIN, 1);
  await nla(lc, ARR_FIN, 1); // -> FINAL

  // 3. OPS asks; LC (another person) accepts, which suspends the runway.
  await press(ops, 'RequestRunwayStatus', { positionId: 'OPS', action: 'WORKS' });
  await expect(ops.locator('#runway-status-panel .runway-status-request')).toHaveText(/^REQUEST WORKS from OPS \(goose\) \d{4}Z · waiting on LC$/);
  await expect(offered(ops, 'BeginRunwayWorks'), 'OPS never begins works itself (H18)').toHaveCount(0);
  await expect(lc.locator('#runway-status-panel .runway-status-request')).toBeVisible();
  await press(lc, 'AcceptRunwayRequest', { positionId: 'LC' });
  expect((await runway(lc)).status).toBe('SUSPENDED_WORKS');
  await expect(lc.locator('#runway-status-panel .runway-status-suspension'))
    .toHaveText(/^SUSPENDED WORKS by LC \(maverick\) \d{4}Z · requested by OPS \(goose\)$/);
  await expect(lc.locator('#runway-status-panel .runway-status-badge')).toHaveText('WORKS');
  await shot(lc, '02-suspended-panel');

  // Every Strip that will use 05/23 says so; the queued departure and the
  // arrival handed to tower are held by the server, with the reason.
  await goBay(lc, 'LC', 'lc-runway-queue');
  const queued = stripByCallsign(lc, DEP_Q);
  await expect(chip(queued)).toHaveText('RWY 05 SUSP');
  await expect(nlaBtn(queued)).toBeDisabled();
  await expect(nlaReason(queued)).toHaveText('runway 05/23 suspended — works in progress');
  await expect(queued.locator('.efsp-alert-reason:not(:empty)'), 'the Strip never says it twice').toHaveCount(0);
  await shot(lc, '03-strips-inhibited');
  await goBay(lc, 'LC', 'lc-arrivals');
  const handed = stripByCallsign(lc, ARR_LC);
  await expect(chip(handed)).toHaveText('RWY 05 SUSP');
  await expect(nlaBtn(handed)).toBeDisabled();
  await expect(nlaReason(handed)).toHaveText('runway 05/23 suspended — works in progress');
  await shot(lc, '03b-arrival-inhibited');
  await goBay(ops, 'GC', 'gc-taxi-out');
  const taxiing = stripByCallsign(ops, DEP_TAXI);
  await expect(chip(taxiing), 'proactive: TAXI shows the chip before its NLA is the gated one').toHaveText('RWY 05 SUSP');
  // TAXI -> RUNWAY_QUEUE is itself held (rule 1), so the server's reason is the one line.
  await expect(nlaBtn(taxiing)).toBeDisabled();
  await expect(nlaReason(taxiing)).toHaveText('runway 05/23 suspended — works in progress');
  await expect(taxiing.locator('.efsp-alert-reason:not(:empty)')).toHaveCount(0);

  // 4. An aircraft already on final still lands: touchdown is an observation.
  await goBay(lc, 'LC', 'lc-final');
  const final = stripByCallsign(lc, ARR_FIN);
  await expect(chip(final)).toHaveText('RWY 05 SUSP');
  await expect(final.locator('.efsp-alert-reason')).toHaveText(/Landing is an observation and is not held\.$/);
  await expect(nlaBtn(final)).toBeEnabled();
  await nlaBtn(final).click();
  await expect.poll(async () => (await stripOf(lc, ARR_FIN)).state).toBe('LANDED');
  await goBay(lc, 'LC', 'lc-final');
  await shot(lc, '04-final-still-lands');

  // 5. OPS: works complete -> still suspended, now awaiting inspection.
  await press(ops, 'CompleteRunwayWorks', { positionId: 'OPS' });
  expect((await runway(ops)).status).toBe('SUSPENDED_INSPECTION');
  await goBay(lc, 'LC', 'lc-runway-queue');
  await expect(chip(stripByCallsign(lc, DEP_Q))).toHaveText('RWY 05 INSP');
  await expect(nlaReason(stripByCallsign(lc, DEP_Q))).toHaveText('runway 05/23 suspended — awaiting inspection');
  // LC is not the inspection authority: the button is not offered, and the
  // server refuses it anyway when sent by hand — named by the runway.
  await expect(offered(lc, 'CompleteInspection')).toHaveCount(0);
  await front(lc, 'efsp');
  await lc.evaluate(() => crc.ws.sendEfspRunwayStatusMutation('LC', 'INCIRLIK', crc.state.getEfspRunwayStatus('INCIRLIK').rev, { kind: 'CompleteInspection', runwayId: '05/23' }));
  await expect(lc.locator('#efsp-mutation-error')).toHaveText(/^runway 05\/23 — /);
  expect(await expectRefusalIsVisible(lc, 'LC signing off an inspection')).toMatch(/^runway 05\/23/);
  await shot(lc, '05-inspection-refused-to-twr');

  await press(ops, 'CompleteInspection', { positionId: 'OPS' });
  expect((await runway(ops)).status).toBe('OPEN');
  await expect(chip(stripByCallsign(lc, DEP_Q))).toHaveCount(0);
  await expect(nlaBtn(stripByCallsign(lc, DEP_Q))).toBeEnabled();
  await front(lc, 'runwayStatus');
  await expect(lc.locator('#runway-status-panel .runway-status-inspection')).toHaveText(/^INSPECTED by OPS \(goose\) \d{4}Z$/);
  await shot(lc, '06-reopened');

  await dropAll([ops, lc], [DEP_TAXI, DEP_Q, ARR_LC, ARR_FIN]);
  expect(appErrors(), 'console errors').toEqual([]);
});

test('Phase 3 walk: a runway change needs OPS and AP (each a different person), then an inspection; a Strip left in 05\'s rack is told', async ({ browser }) => {
  const lc = await controller(browser, ['LC'], 'maverick');
  const ops = await controller(browser, ['OPS', 'CD', 'GC'], 'goose');
  const app = await controller(browser, ['AP'], 'iceman');
  for (const p of [lc, ops, app]) { await openFieldPanel(p); await besideStrips(p); }

  // Start from 05 active (the harness has no mission wind), by the machinery itself.
  if ((await field(lc)).activeRunway !== '05') {
    await fieldOp(lc, 'LC', { kind: 'ProposeRunwayChange', toRunwayId: '05' });
    await fieldOp(ops, 'OPS', { kind: 'AckRunwayChange' });
    await fieldOp(app, 'AP', { kind: 'AckRunwayChange' });
    await fieldOp(lc, 'LC', { kind: 'BeginRunwayChange' });
    await fieldOp(lc, 'LC', { kind: 'CompleteRunwayChange' });
    await fieldOp(ops, 'OPS', { kind: 'CompleteInspection', runwayId: '05/23' });
  }
  expect((await field(lc)).activeRunway).toBe('05');

  const DEP = `FSR${RUN}`;
  await seed(ops, { callsign: DEP, stripType: 'DEPARTURE', flightData: { departureRunway: '05' } });
  await nla(ops, DEP, 5);
  expect((await stripOf(ops, DEP)).rackId).toBe('rwy-05');

  // LC proposes 05 -> 23 from the panel's end picker.
  await front(lc, 'runwayStatus');
  await lc.locator('#runway-status-panel select.runway-status-to-end').selectOption('23');
  await press(lc, 'ProposeRunwayChange', { positionId: 'LC' });
  await expect(offered(lc, 'BeginRunwayChange'), 'not before both acknowledge').toHaveCount(0);
  await press(app, 'AckRunwayChange', { positionId: 'AP' });
  await expect(offered(lc, 'BeginRunwayChange'), 'AP alone is not enough').toHaveCount(0);
  await expect(lc.locator('#runway-status-panel .runway-status-ack-done')).toHaveText([/^AP ✓ \d{4}Z$/]);
  await expect(lc.locator('#runway-status-panel .runway-status-ack-waiting')).toHaveText(['OPS …']);
  await press(ops, 'AckRunwayChange', { positionId: 'OPS' });
  await expect(offered(lc, 'BeginRunwayChange')).toHaveCount(1);
  await press(lc, 'BeginRunwayChange', { positionId: 'LC' });
  await press(lc, 'CompleteRunwayChange', { positionId: 'LC' });
  const pending = await field(lc);
  expect(pending.activeRunway).toBe('23');
  expect(pending.runwayChange.state).toBe('PENDING_INSPECTION');
  await expect(lc.locator('#runway-status-panel .runway-status-change-pending')).toHaveText('PENDING INSPECTION: 05/23');
  await press(ops, 'CompleteInspection', { positionId: 'OPS' });
  expect((await field(lc)).runwayChange).toBeNull();
  await front(lc, 'runwayStatus');
  await expect(lc.locator('#runway-status-panel .runway-status-active')).toHaveText('▶ 23 ACTIVE');
  await shot(lc, '07-runway-change-done');

  // Q30: nothing moves a Strip on its own; the one queued for 05 is told.
  await goBay(lc, 'LC', 'lc-runway-queue');
  const q = stripByCallsign(lc, DEP);
  await expect(chip(q)).toHaveText('RWY 05 INACT');
  await expect(q.locator('.efsp-alert-reason')).toHaveText(/^Queued for inactive runway 05; the active runway is 23\./);
  await shot(lc, '08-inactive-runway-advisory');

  // Pilot request "request runway 23": LC moves the Strip to 23's rack and
  // the advisory follows the rack (the chip goes).
  await lc.evaluate((cs) => crc.dispatch._moveStrip(crc.state.getAllEfspStrips().find((s) => crc.state.getEfspFlightData(s.flightDataId).identity.callsign === cs && s.state !== 'DROPPED'), 'lc-runway-queue', 'rwy-23', null, null), DEP);
  await expect.poll(async () => (await stripOf(lc, DEP)).rackId).toBe('rwy-23');
  await expect(chip(stripByCallsign(lc, DEP))).toHaveCount(0);

  // A change AP rejects: what LC sees.
  await front(lc, 'runwayStatus');
  await lc.locator('#runway-status-panel select.runway-status-to-end').selectOption('05');
  await press(lc, 'ProposeRunwayChange', { positionId: 'LC' });
  await pressWithReason(app, 'RejectRunwayChange', { positionId: 'AP' }, 'wind is 240 at 15');
  await front(lc, 'runwayStatus');
  await expect(lc.locator('#runway-status-panel .runway-status-change-rejected')).toHaveText(/^REJECTED by AP \(iceman\) \d{4}Z — wind is 240 at 15$/);
  expect((await field(lc)).activeRunway).toBe('23');
  await shot(lc, '09-rejected');

  await dropAll([lc, ops], [DEP]);
  expect(appErrors(), 'console errors').toEqual([]);
});

test('a reload mid-suspension still shows SUSPENDED (the snapshot carries it); then the field is put back', async ({ browser }) => {
  const lc = await controller(browser, ['LC', 'OPS'], 'maverick');
  await openFieldPanel(lc);
  await besideStrips(lc);
  await press(lc, 'BeginRunwayWorks', { positionId: 'LC' });
  await lc.reload();
  await installAppModules(lc);
  await lc.waitForFunction(() => typeof crc.state.getEfspRunwayStatus === 'function' && !!crc.state.getEfspRunwayStatus('INCIRLIK'));
  await openFieldPanel(lc);
  await besideStrips(lc);
  await front(lc, 'runwayStatus');
  await expect(lc.locator('#runway-status-panel .runway-status-badge')).toHaveText('WORKS');
  await expect(lc.locator('#runway-status-panel .runway-status-suspension')).toHaveText(/^SUSPENDED WORKS by LC \(maverick\) \d{4}Z$/);
  await shot(lc, '11-reload-still-suspended');
  // The reload dropped the Positions (a new connection); take them back to clean up.
  await lc.evaluate(() => crc.ws.sendEfspSetPositions('INCIRLIK', ['LC', 'OPS']));
  await lc.waitForFunction(() => crc.ws.getActingPositions('INCIRLIK').length === 2);
  await resetField(lc);
  expect((await runway(lc)).status).toBe('OPEN');
});

test('one controller holding LC, OPS and AP changes the runway in one self-coordinated input (S-Q24)', async ({ browser }) => {
  const solo = await controller(browser, ['LC', 'OPS', 'AP'], 'solo');
  await openFieldPanel(solo);
  await besideStrips(solo);
  await front(solo, 'runwayStatus');
  await expect(offered(solo, 'SelfCoordinateRunwayChange')).toHaveCount(1);
  const to = (await field(solo)).activeRunway === '23' ? '05' : '23';
  await solo.locator('#runway-status-panel .runway-status-actions').filter({ has: solo.locator('button[data-kind="SelfCoordinateRunwayChange"]') })
    .locator('select.runway-status-to-end').last().selectOption(to);
  await press(solo, 'SelfCoordinateRunwayChange', { positionId: 'LC' });
  const change = (await field(solo)).runwayChange;
  expect(change.state).toBe('ACKNOWLEDGED');
  expect(change.selfCoordinated).toBe(true);
  await expect(solo.locator('#runway-status-panel .runway-status-ack-done')).toHaveText([/^OPS ✓ self \d{4}Z$/, /^AP ✓ self \d{4}Z$/]);
  await shot(solo, '12-self-coordinated');
  await press(solo, 'BeginRunwayChange', { positionId: 'LC' });
  await press(solo, 'CompleteRunwayChange', { positionId: 'LC' });
  await press(solo, 'CompleteInspection', { positionId: 'OPS' });
  expect((await field(solo)).activeRunway).toBe(to);
  await resetField(solo);
  expect(appErrors(), 'console errors').toEqual([]);
});
