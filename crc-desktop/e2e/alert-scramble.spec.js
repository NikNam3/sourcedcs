'use strict';

/* L13 — alert and scramble in a real browser (guide §9.6, crc-sync's
 * docs/adr/0070). Screenshots land in docs/wip/L13/; the walk is written up in
 * docs/wip/L13.md.
 *
 * The things §9.6 and its [GAP] promise are hard assertions: the Board-wide
 * line on every Position tab, the ground Strips flagged, and NOTHING
 * reordered. The Strips are moved through the page's own send function (the
 * wire protocol), and the 14E picker itself is driven by hand.
 */

const path = require('path');
const fs = require('fs');
const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, stripByCallsign, lapseNlaGuard } = require('./helpers/app');

test.describe.configure({ timeout: 120000 });

const SHOTS = path.join(__dirname, '..', '..', 'docs', 'wip', 'L13');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (target, name) => target.screenshot({ path: path.join(SHOTS, `${name}.png`) });
/** The whole Strip panel, clipped from a page screenshot: the panel re-renders on every delta, so an element screenshot can lose its node mid-capture. */
async function panelShot(page, name) {
  const box = await page.locator('#efsp-panel').boundingBox();
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), clip: box });
}

async function goBay(page, positionId, bayId) {
  await page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id="${positionId}"]`).click();
  await page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id="${bayId}"]`).click();
}

/** One op on the Strip showing `callsign`, through the page's real sender; waits for the ack to land. */
async function mutate(page, acting, callsign, op) {
  const before = await page.evaluate((cs) => {
    const s = [...crc.state.efspStrips.values()].find(x => crc.state.efspFlightDataList.get(x.flightDataId)?.identity?.callsign === cs && x.state !== 'DROPPED');
    return s ? s.rev : null;
  }, callsign);
  await page.evaluate(([a, cs, o]) => {
    const s = [...crc.state.efspStrips.values()].find(x => crc.state.efspFlightDataList.get(x.flightDataId)?.identity?.callsign === cs && x.state !== 'DROPPED');
    crc.ws.sendEfspMutation(a, s, o);
  }, [acting, callsign, op]);
  await expect.poll(() => page.evaluate((cs) => {
    const s = [...crc.state.efspStrips.values()].find(x => crc.state.efspFlightDataList.get(x.flightDataId)?.identity?.callsign === cs);
    return s ? s.rev : null;
  }, callsign)).toBeGreaterThan(before);
}

const stateOf = (page, cs) => page.evaluate((c) => [...crc.state.efspStrips.values()].find(x => crc.state.efspFlightDataList.get(x.flightDataId)?.identity?.callsign === c)?.state, cs);
const alertOf = (page, cs) => page.evaluate((c) => {
  const s = [...crc.state.efspStrips.values()].find(x => crc.state.efspFlightDataList.get(x.flightDataId)?.identity?.callsign === c);
  return s ? crc.state.efspFlightDataList.get(s.flightDataId).military.alertStatus : null;
}, cs);

async function nla(page, acting, cs) {
  await lapseNlaGuard(page); // the client's double-tap window
  await mutate(page, acting, cs, { kind: 'InvokeNla' });
}

/** Picks a value in the 14E picker on a Strip, the way a controller does. */
async function pickAlert(strip, value) {
  await strip.locator('.efsp-strip-fields .efsp-block-14E').click();
  const select = strip.locator('select.efsp-block-enum-select');
  await expect(select).toBeVisible();
  await select.selectOption(value);
}

const bayOrder = (page, bayId) => page.evaluate((b) => [...crc.state.efspStrips.values()]
  .filter(s => s.bayId === b && s.state !== 'DROPPED')
  .sort((x, y) => (x.rackId + x.orderKey < y.rackId + y.orderKey ? -1 : 1))
  .map(s => crc.state.efspFlightDataList.get(s.flightDataId).identity.callsign), bayId);
const domOrder = (page) => page.locator('#efsp-bay-content .efsp-strip .efsp-block-1').allTextContents();

// The Board lives for the whole run. A walk that fails while VIPER11 is SCRAMBLE would leave the
// scramble line and a "keep clear of ..." reason on every ground Strip of every later spec file
// (runway-status's "the Strip never says it twice" then failed for it). Retire this walk's Strips.
test.afterEach(async ({ page }) => {
  await page.evaluate((cs) => {
    for (const s of crc.state.getAllEfspStrips()) {
      const flightData = crc.state.getEfspFlightData(s.flightDataId);
      if (!flightData || !cs.includes(flightData.identity.callsign) || s.state === 'DROPPED') continue;
      crc.ws.sendEfspMutation(s.ownerPositionId, s, { kind: 'DropStrip', reason: 'e2e cleanup' });
    }
  }, ['VIPER11', 'HAWK31', 'HAWK32', 'EAGLE41', 'EAGLE42']).catch(() => {});
  await page.waitForTimeout(400);
});

test('alert and scramble: ALERT is quiet, SCRAMBLE lights the Board and flags ground traffic, nothing reorders, airborne clears', async ({ page }) => {
  const { consoleErrors } = await openPanel(page, { signedOn: ['OPS', 'CD', 'GC', 'LC'] });
  await page.setViewportSize({ width: 1600, height: 1100 });
  const CS = 'VIPER11';

  // ── 1. OPS puts VIPER11 on alert (decisions.md H56: OPS sets it). ─────────
  await goBay(page, 'OPS', 'ops-proposed');
  const viper = await seedStrip(page, { callsign: CS, stripType: 'DEPARTURE', flightData: { departureAirport: 'LTAG', destinationAirport: 'LTAG', route: 'DCT', requestedAltitude: '250' } });
  await pickAlert(viper, 'ALERT');
  await expect.poll(() => alertOf(page, CS)).toBe('ALERT');
  await expect(viper.locator('.efsp-strip-fields .efsp-block-14E')).toHaveText('ALERT');
  // ADR 0058: nothing lit for ALERT beyond the field itself.
  await expect(viper.locator('[data-slot="scram"]')).toHaveCount(0);
  await expect(page.locator('#efsp-scramble-line')).toBeHidden();
  await shot(viper, '01-alert-set');

  // Walked to CLEARED: it now sits with CD.
  await nla(page, 'OPS', CS);
  await nla(page, 'CD', CS);
  expect(await stateOf(page, CS)).toBe('CLEARED');

  // ── ground traffic: two departures at TAXI and RUNWAY_QUEUE, plus one more in each so order is visible.
  for (const [cs, state, to, bay, rack] of [
    ['HAWK31', 'TAXI', 'GC', 'gc-taxi-out', 'main'], ['HAWK32', 'TAXI', 'GC', 'gc-taxi-out', 'main'],
    ['EAGLE41', 'RUNWAY_QUEUE', 'LC', 'lc-runway-queue', 'rwy-05'], ['EAGLE42', 'RUNWAY_QUEUE', 'LC', 'lc-runway-queue', 'rwy-05'],
  ]) {
    await goBay(page, 'OPS', 'ops-proposed');
    await seedStrip(page, { callsign: cs, stripType: 'DEPARTURE', flightData: { departureAirport: 'LTAG', destinationAirport: 'LTAG', route: 'DCT', requestedAltitude: '250' } });
    await mutate(page, 'OPS', cs, { kind: 'SetState', toState: state });
    await mutate(page, 'OPS', cs, { kind: 'TransferStrip', toPositionId: to, bayId: bay, rackId: rack });
  }
  await expect(page.locator('#efsp-scramble-line')).toBeHidden();

  const beforeData = { taxi: await bayOrder(page, 'gc-taxi-out'), queue: await bayOrder(page, 'lc-runway-queue') };
  await goBay(page, 'GC', 'gc-taxi-out');
  const beforeGndDom = await domOrder(page);
  await goBay(page, 'LC', 'lc-runway-queue');
  const beforeTwrDom = await domOrder(page);

  // ── 2. SCRAMBLE, set by CD in the 14E picker (CD owns the Strip now). ─────
  await goBay(page, 'CD', 'cd-cleared');
  await pickAlert(stripByCallsign(page, CS), 'SCRAMBLE');
  await expect.poll(() => alertOf(page, CS)).toBe('SCRAMBLE');

  const line = page.locator('#efsp-scramble-line');
  await expect(line).toBeVisible();
  await expect(line.locator('.efsp-scramble-row')).toHaveCount(1);
  await expect(line.locator('.efsp-scramble-cs')).toHaveText(CS);
  await expect(line.locator('.efsp-scramble-detail')).toHaveText('INCIRLIK · CLEARED · ALERT ACCESS TAXIWAY constrained · 4 flagged');
  await expect(stripByCallsign(page, CS).locator('[data-slot="scram"]')).toHaveText('SCRAMBLE');
  await panelShot(page, '02-scramble-line-cd');
  // Board-wide: the same line on another Position's tab.
  await goBay(page, 'LC', 'lc-runway-queue');
  await expect(line).toBeVisible();
  await expect(line.locator('.efsp-scramble-cs')).toHaveText(CS);
  await panelShot(page, '02-scramble-line-twr');

  // ── 3. the ground flags. ───────────────────────────────────────────────
  await goBay(page, 'GC', 'gc-taxi-out');
  const hawk = stripByCallsign(page, 'HAWK31');
  await expect(hawk.locator('[data-slot="scram"]')).toHaveText('SCRAMBLE');
  await expect(hawk.locator('.efsp-alert-reason')).toContainText('VIPER11 is scrambling from INCIRLIK. SOURCE practice: keep clear of ALERT ACCESS TAXIWAY.');
  await shot(hawk, '03-ground-flags');

  // ── 4. nothing reordered, moved or held. ─────────────────────────────────
  expect(await bayOrder(page, 'gc-taxi-out')).toEqual(beforeData.taxi);
  expect(await bayOrder(page, 'lc-runway-queue')).toEqual(beforeData.queue);
  expect(await domOrder(page)).toEqual(beforeGndDom);
  await panelShot(page, '04-nothing-reordered');
  await goBay(page, 'LC', 'lc-runway-queue');
  expect(await domOrder(page)).toEqual(beforeTwrDom);

  // Clicking the callsign on the line selects VIPER11 on its own Position's tab.
  await line.locator('.efsp-scramble-cs').click();
  await expect(page.locator('#efsp-position-tabs .efsp-position-tab.active')).toHaveAttribute('data-position-id', 'CD');
  await expect(stripByCallsign(page, CS)).toBeVisible();

  // ── 5. VIPER11 gets airborne: the line and every flag go by themselves. ──
  for (let i = 0; i < 8 && (await stateOf(page, CS)) !== 'DEPARTED'; i++) {
    const owner = await page.evaluate((c) => [...crc.state.efspStrips.values()].find(x => crc.state.efspFlightDataList.get(x.flightDataId)?.identity?.callsign === c).ownerPositionId, CS);
    await nla(page, owner, CS);
  }
  expect(await stateOf(page, CS)).toBe('DEPARTED');
  await expect(line).toBeHidden();
  await goBay(page, 'GC', 'gc-taxi-out');
  await expect(page.locator('#efsp-bay-content [data-slot="scram"]')).toHaveCount(0);
  expect(await alertOf(page, CS)).toBe('SCRAMBLE'); // nothing resets the field (T5)
  await panelShot(page, '05-airborne-clears');

  // The map's tile/terrain fetches 503 with no DCS behind the e2e server; any
  // script error from the panel would be a finding.
  expect(consoleErrors.filter(e => !/Failed to load resource/.test(e))).toEqual([]);
});
