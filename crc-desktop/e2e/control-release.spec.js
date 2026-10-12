'use strict';

/* CR-C (crc-sync docs/adr/0101): the HANDOFF steps after ACCEPT, from both Facilities at once. ACCEPT moves radar ID and
 * the Strip; communications, ControlRelease and control are their own marks. CTR (CENTER) hands to AP (INCIRLIK) and to
 * CV_MARSHAL (CARRIER). Screenshots go to the test output directory (test-results/). Run on E2E_LANE=5. The Board lives for the whole run, so
 * every callsign is unique. */

const path = require('path');
const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, startAction, settle } = require('./helpers/app');

test.describe.configure({ timeout: 90000 });

const _contexts = [];
test.afterEach(async () => { while (_contexts.length) await _contexts.pop().close().catch(() => {}); });

async function controller(browser, opts) {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1500, height: 1000 } });
  _contexts.push(ctx);
  const page = await ctx.newPage();
  await openPanel(page, opts);
  return page;
}
const ctr = (b) => controller(b, { signedOn: ['CTR'], facilityId: 'CENTER', controller: 'ctr-controller' });
const ap = (b) => controller(b, { signedOn: ['AP'], facilityId: 'INCIRLIK', controller: 'ap-controller' });
const marshal = (b) => controller(b, { signedOn: ['CV_MARSHAL'], facilityId: 'CARRIER', controller: 'marshal-controller' });

const strip = (page, callsign) => page.locator('.efsp-strip', { has: page.getByText(callsign, { exact: true }) }).first();
const chip = (page, callsign, key) => strip(page, callsign).locator(`[data-chip="${key}"]`);
const goBay = async (page, positionId, bayId) => {
  await page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id="${positionId}"]`).click();
  await page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id="${bayId}"]`).click();
};
const shot = (page, name) => page.screenshot({ path: test.info().outputPath(name) });

async function proposeHandoff(page, callsign, toPositionId) {
  const s = await seedStrip(page, { callsign, actingPositionId: 'CTR', bayId: 'ctr-enroute', stripType: 'ARRIVAL', facilityId: 'CENTER' });
  await startAction(s, 'Coordinate…');
  const popover = page.locator('.efsp-coordinate-popover');
  await popover.locator('.efsp-coordinate-primitive-select').selectOption('HANDOFF');
  if (toPositionId) await popover.locator('.efsp-coordinate-target-select').selectOption(toPositionId);
  await popover.locator('.efsp-coordinate-send-btn').dispatchEvent('click');
  await popover.waitFor({ state: 'detached' });
}

/** The row's step button on a Strip. */
const step = (page, callsign, name) => strip(page, callsign).locator('.efsp-x-buttons').getByRole('button', { name });

async function acceptAt(page, positionId, bayId, callsign, workBay) {
  await goBay(page, positionId, bayId);
  await expect(strip(page, callsign).getByRole('button', { name: 'Accept Hand Off' })).toBeVisible();
  await strip(page, callsign).getByRole('button', { name: 'Accept Hand Off' }).click();
  if (workBay) await goBay(page, positionId, workBay);
}

const lastAck = (page) => page.evaluate(() => window.__lastUndoLabel || null);

test('CTR to AP: accept moves radar ID only; release, attestation, comms and control are separate steps', async ({ browser }) => {
  const a = await ctr(browser);
  const b = await ap(browser);
  const cs = `CRU${Date.now() % 10000}`;
  await proposeHandoff(a, cs);
  await acceptAt(b, 'AP', 'ap-coordination', cs, 'ap-inbound');

  // ACCEPT: AP holds the Strip, CTR still has communications and control, on both sides.
  await expect(chip(b, cs, 'comms')).toHaveText('COMMS: CTR');
  await expect(chip(b, cs, 'control')).toHaveText('CTRL: CTR');
  await expect(chip(a, cs, 'comms')).toHaveText('COMMS: CTR');
  await expect(chip(a, cs, 'control')).toHaveText('CTRL: CTR');
  await shot(b, '01-accepted-comms-and-control-stay.png');

  // AP asks for a release of turns; CTR sees the request and grants it.
  await step(b, cs, 'Request release…').click();
  const req = b.locator('.efsp-release-popover');
  await req.locator('input[data-scope="TURNS"]').check();
  await req.getByRole('button', { name: 'Request' }).click();
  await expect(chip(a, cs, 'request')).toContainText('RELEASE REQUESTED: Turns');
  await shot(a, '02-request-seen-by-transferring-side.png');
  await step(a, cs, 'Release…').click();
  const grant = a.locator('.efsp-release-popover');
  await grant.locator('input[data-scope="TURNS"]').check();
  await grant.locator('.efsp-release-condition').fill('after the DME');
  await grant.getByRole('button', { name: 'Release' }).click();
  await expect(chip(b, cs, 'release')).toContainText('RELEASE: Turns · after the DME');
  await expect(chip(a, cs, 'release')).toContainText('RELEASE: Turns');
  await shot(b, '03-release-granted.png');

  // A heading inside the release needs no prompt; an altitude is outside it and asks "coordinated with CTR?".
  const attest = b.locator('#efsp-control-attest');
  const send = (page, op) => page.evaluate(([c, o]) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && x.facilityId === 'INCIRLIK'
      && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
    crc.ws.sendEfspMutation('AP', s, o);
  }, [cs, op]);
  await send(b, { kind: 'SetBlock', blockId: '9A-VECTOR', value: '270' });
  await settle(b); // the vector's ack is in, and no prompt was raised for it
  await expect(attest).toBeHidden();
  await send(b, { kind: 'SetBlock', blockId: '7', value: '240' });
  await expect(attest).toBeVisible();
  await expect(attest).toContainText('CTR still has control');
  await shot(b, '04-attestation-prompt.png');
  await attest.getByRole('button', { name: 'Coordinated with CTR' }).click();
  await expect(attest).toBeHidden();
  await expect(b.locator('#efsp-mutation-error')).toHaveText('');

  // Comms, then control: each a one-click mark with its own Undo label, naming the receiving Position.
  await step(b, cs, 'Comms to AP').click();
  await expect(chip(a, cs, 'comms')).toHaveText('COMMS: AP');
  await expect(b.locator('#efsp-undo-slot button')).toContainText('Communications to AP');
  await step(a, cs, 'Control to AP').click();
  await expect(chip(b, cs, 'control')).toHaveText('CTRL: AP');
  await expect(chip(a, cs, 'control')).toHaveText('CTRL: AP');
  await expect(a.locator('#efsp-undo-slot button')).toContainText('Control to AP');
  await expect(chip(b, cs, 'release')).toHaveCount(0);
  await shot(b, '05-comms-and-control-moved.png');
});

test('a refused request reads on the receiving side; Withdraw takes a release back', async ({ browser }) => {
  const a = await ctr(browser);
  const b = await ap(browser);
  const cs = `CRW${Date.now() % 10000}`;
  await proposeHandoff(a, cs);
  await acceptAt(b, 'AP', 'ap-coordination', cs, 'ap-inbound');
  await step(b, cs, 'Request release…').click();
  const req = b.locator('.efsp-release-popover');
  await req.locator('input[data-scope="DESCENT"]').check();
  await req.getByRole('button', { name: 'Request' }).click();
  await expect(chip(a, cs, 'request')).toBeVisible();
  await step(a, cs, 'Unable').click();
  await a.locator('.efsp-release-reason').fill('traffic below');
  await a.locator('.efsp-release-popover').getByRole('button', { name: 'Unable' }).click();
  await expect(chip(b, cs, 'request')).toHaveText('RELEASE REFUSED: traffic below');
  await step(a, cs, 'Release…').click();
  await a.locator('.efsp-release-popover input[data-scope="FULL"]').check();
  await a.locator('.efsp-release-popover').getByRole('button', { name: 'Release' }).click();
  await expect(chip(b, cs, 'release')).toContainText('RELEASE: Full');
  await step(a, cs, 'Withdraw release').click();
  await expect(chip(b, cs, 'release')).toHaveText('RELEASE WITHDRAWN');
});

test('CTR to CV_MARSHAL: the Marshal accepts, the flight joins the stack, comms and control are the Marshal\'s steps', async ({ browser }) => {
  const a = await ctr(browser);
  const m = await marshal(browser);
  const cs = `CRM${Date.now() % 10000}`;
  await proposeHandoff(a, cs, 'CV_MARSHAL');
  await expect(chip(a, cs, 'comms')).toHaveCount(0); // not accepted yet
  await m.waitForFunction((c) => crc.state.getAllEfspStrips().some(x => x.facilityId === 'CARRIER' && x.state !== 'DROPPED'
    && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c), cs);
  await goBay(m, 'CV_MARSHAL', 'cv-marshal-coordination');
  await shot(m, '06-marshal-incoming-handoff.png');
  await strip(m, cs).getByRole('button', { name: 'Accept Hand Off' }).click();
  await expect.poll(() => m.evaluate((c) => {
    const s = crc.state.getAllEfspStrips().find(x => x.facilityId === 'CARRIER' && x.state !== 'DROPPED'
      && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
    return s && `${s.stripType}/${s.state}`;
  }, cs)).toBe('MARSHAL/IN_STACK');
  await expect(chip(a, cs, 'control')).toHaveText('CTRL: CTR');
  await goBay(m, 'CV_MARSHAL', 'cv-marshal-stack');
  await shot(m, '07-marshal-stack-after-accept.png');
  await step(m, cs, 'Comms to CV_MARSHAL').click();
  await expect(chip(a, cs, 'comms')).toHaveText('COMMS: CV_MARSHAL');
  await step(m, cs, 'Control to CV_MARSHAL').click();
  await expect(chip(a, cs, 'control')).toHaveText('CTRL: CV_MARSHAL');
  await shot(a, '08-ctr-sees-marshal-holds-control.png');
});
