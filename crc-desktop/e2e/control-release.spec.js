'use strict';

/* U-RELEASE (crc-sync docs/adr/0122, H142): the HANDOFF after ACCEPT, from both Facilities at once. ACCEPT moves radar ID
 * and the Strip. The handing-off station presses only Hand off, with one switch, Released (default) or not; the receiver
 * marks "Checked in" when the pilot calls. Released: control moves at check-in. Not released: control moves once the
 * aircraft is also inside the receiver's airspace (the server's control tick on ADR 0125's areas: the last test drives a
 * fake DCS unit across the RAPCON boundary). The receiver may ask a not-released handoff to be released; the handing-off
 * station grants or refuses. Nobody takes control by hand. Screenshots go to test-results/. Run on E2E_LANE=7. The Board
 * lives for the whole run, so every callsign is unique. */

const path = require('path');
const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, startAction, settle, serverTicks } = require('./helpers/app');
const { startFakeDcs, fakeDcsPort } = require('./helpers/fake-dcs');

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

/** Hand off from the Coordinate popover; `released: false` unticks the one switch. */
async function handOff(page, s, { toPositionId, released = true } = {}) {
  await startAction(s, 'Coordinate…');
  const popover = page.locator('.efsp-coordinate-popover');
  await popover.locator('.efsp-coordinate-primitive-select').selectOption('HANDOFF');
  if (toPositionId) await popover.locator('.efsp-coordinate-target-select').selectOption(toPositionId);
  const box = popover.locator('.efsp-coordinate-released-box');
  await expect(box).toBeChecked(); // released is the default (H142)
  if (!released) await box.uncheck();
  await popover.locator('.efsp-coordinate-send-btn').dispatchEvent('click');
  await popover.waitFor({ state: 'detached' });
}

async function proposeHandoff(page, callsign, opts = {}) {
  const s = await seedStrip(page, { callsign, actingPositionId: 'CTR', bayId: 'ctr-enroute', stripType: 'ARRIVAL', facilityId: 'CENTER' });
  await handOff(page, s, opts);
}

/** The row's step button on a Strip. */
const step = (page, callsign, name) => strip(page, callsign).locator('.efsp-x-buttons').getByRole('button', { name });

async function acceptAt(page, positionId, bayId, callsign, workBay) {
  await goBay(page, positionId, bayId);
  await expect(strip(page, callsign).getByRole('button', { name: 'Accept Hand Off' })).toBeVisible();
  await strip(page, callsign).getByRole('button', { name: 'Accept Hand Off' }).click();
  if (workBay) await goBay(page, positionId, workBay);
}

/** Nothing in the HANDOFF row asks for attention (dark cockpit, H142 §7). */
const noAmber = async (page, callsign) => {
  await expect(strip(page, callsign).locator('.efsp-handoff-tone-attn, .efsp-handoff-tone-bad')).toHaveCount(0);
};

test('CTR to AP, released: the receiver presses only Checked in; control moves with it and nothing stays amber', async ({ browser }) => {
  const a = await ctr(browser);
  const b = await ap(browser);
  const cs = `CRU${Date.now() % 10000}`;
  await proposeHandoff(a, cs);
  await acceptAt(b, 'AP', 'ap-coordination', cs, 'ap-inbound');

  // ACCEPT: AP holds the Strip, CTR still has communications and control, on both sides. AP reads RELEASED, in grey.
  await expect(chip(b, cs, 'comms')).toHaveText('COMMS: CTR');
  await expect(chip(b, cs, 'control')).toHaveText('CTRL: CTR');
  await expect(chip(a, cs, 'control')).toHaveText('CTRL: CTR');
  await expect(chip(b, cs, 'released')).toHaveText('RELEASED');
  await expect(chip(a, cs, 'released')).toHaveCount(0);
  // The handing-off station has nothing to press; the receiver only Checked in (no Comms to …, no Control to me, no request).
  await expect(strip(a, cs).locator('.efsp-handoff-step')).toHaveCount(0);
  await expect(strip(b, cs).locator('.efsp-handoff-step')).toHaveText(['Checked in']);
  await noAmber(b, cs);
  await shot(b, '01-accepted-released.png');

  // Before control moves an altitude asks "coordinated with CTR?".
  const attest = b.locator('#efsp-control-attest');
  await b.evaluate(([c]) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && x.facilityId === 'INCIRLIK'
      && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
    crc.ws.sendEfspMutation('AP', s, { kind: 'SetBlock', blockId: '7', value: '240' });
  }, [cs]);
  await expect(attest).toBeVisible();
  await expect(attest).toContainText('CTR still has control');
  await attest.getByRole('button', { name: 'Coordinated with CTR' }).click();
  await expect(attest).toBeHidden();
  await expect(b.locator('#efsp-mutation-error')).toHaveText('');

  // The pilot calls AP: one click, its own Undo label; comms and control move together; the released word goes.
  await step(b, cs, 'Checked in').click();
  await expect(b.locator('#efsp-undo-slot button')).toContainText('Checked in with AP');
  await expect(chip(a, cs, 'comms')).toHaveText('COMMS: AP');
  await expect(chip(a, cs, 'control')).toHaveText('CTRL: AP');
  await expect(chip(b, cs, 'control')).toHaveText('CTRL: AP');
  await expect(chip(b, cs, 'released')).toHaveCount(0);
  await expect(strip(b, cs).locator('.efsp-handoff-step')).toHaveCount(0);
  await noAmber(a, cs);
  await noAmber(b, cs);
  await shot(b, '02-checked-in-control-moved.png');
});

test('CTR to AP, not released: Request release, Unable, Request again, Release; Request release is gone; control moves at check-in', async ({ browser }) => {
  const a = await ctr(browser);
  const b = await ap(browser);
  const cs = `CRN${Date.now() % 10000}`;
  await proposeHandoff(a, cs, { released: false });
  await acceptAt(b, 'AP', 'ap-coordination', cs, 'ap-inbound');
  await expect(chip(b, cs, 'released')).toHaveText('NOT RELEASED');
  await expect(strip(b, cs).locator('.efsp-handoff-step')).toHaveText(['Checked in', 'Request release…']);

  // AP asks; CTR sees it in amber with Release and Unable.
  await step(b, cs, 'Request release…').click();
  const req = b.locator('.efsp-release-popover');
  await expect(req.locator('input[type=checkbox]')).toHaveCount(0); // no scopes (H142)
  await req.locator('.efsp-release-note').fill('shortcut to the IAF');
  await req.getByRole('button', { name: 'Request' }).click();
  await expect(chip(a, cs, 'request')).toHaveText('RELEASE REQUESTED');
  await expect(chip(a, cs, 'request')).toHaveClass(/efsp-handoff-tone-attn/);
  await expect(step(b, cs, 'Request release…')).toBeDisabled();
  await expect(strip(a, cs).locator('.efsp-handoff-step')).toHaveText(['Release', 'Unable']);
  await shot(a, '03-request-seen-by-handing-off-station.png');

  // Unable: the receiver reads it in amber, the handoff stays not released.
  await step(a, cs, 'Unable').click();
  await a.locator('.efsp-release-reason').fill('traffic below');
  await a.locator('.efsp-release-popover').getByRole('button', { name: 'Unable' }).click();
  await expect(chip(b, cs, 'request')).toHaveText('RELEASE REFUSED: traffic below');
  await expect(chip(b, cs, 'request')).toHaveClass(/efsp-handoff-tone-attn/);
  await expect(chip(b, cs, 'released')).toHaveText('NOT RELEASED');
  await expect(strip(a, cs).locator('.efsp-handoff-step')).toHaveCount(0);
  await shot(b, '04-request-refused.png');

  // Asked again, granted: the handoff is released, Request release is gone (U8), nothing amber.
  await step(b, cs, 'Request release…').click();
  await b.locator('.efsp-release-popover').getByRole('button', { name: 'Request' }).click();
  await expect(step(a, cs, 'Release')).toBeVisible();
  await step(a, cs, 'Release').click();
  await expect(chip(b, cs, 'released')).toHaveText('RELEASED');
  await expect(strip(b, cs).locator('.efsp-handoff-step')).toHaveText(['Checked in']);
  await expect(chip(b, cs, 'control')).toHaveText('CTRL: CTR');
  await noAmber(a, cs);
  await noAmber(b, cs);
  await step(b, cs, 'Checked in').click();
  await expect(chip(a, cs, 'control')).toHaveText('CTRL: AP');
  await expect(chip(b, cs, 'control')).toHaveText('CTRL: AP');
  await expect(strip(b, cs).locator('.efsp-handoff-step')).toHaveCount(0);
  await noAmber(b, cs);
  await shot(b, '05-granted-then-checked-in.png');
});

test('CTR to CV_MARSHAL: the Marshal accepts, the flight joins the stack, Checked in moves control to the Marshal', async ({ browser }) => {
  const a = await ctr(browser);
  const m = await marshal(browser);
  const cs = `CRM${Date.now() % 10000}`;
  await proposeHandoff(a, cs, { toPositionId: 'CV_MARSHAL' });
  await expect(chip(a, cs, 'comms')).toHaveCount(0); // not accepted yet
  await m.waitForFunction((c) => crc.state.getAllEfspStrips().some(x => x.facilityId === 'CARRIER' && x.state !== 'DROPPED'
    && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c), cs);
  await goBay(m, 'CV_MARSHAL', 'cv-marshal-coordination');
  await strip(m, cs).getByRole('button', { name: 'Accept Hand Off' }).click();
  await expect.poll(() => m.evaluate((c) => {
    const s = crc.state.getAllEfspStrips().find(x => x.facilityId === 'CARRIER' && x.state !== 'DROPPED'
      && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
    return s && `${s.stripType}/${s.state}`;
  }, cs)).toBe('MARSHAL/IN_STACK');
  await expect(chip(a, cs, 'control')).toHaveText('CTRL: CTR');
  await goBay(m, 'CV_MARSHAL', 'cv-marshal-stack');
  await step(m, cs, 'Checked in').click();
  await expect(chip(a, cs, 'comms')).toHaveText('COMMS: CV_MARSHAL');
  await expect(chip(a, cs, 'control')).toHaveText('CTRL: CV_MARSHAL');
  await shot(a, '06-ctr-sees-marshal-holds-control.png');
});

// ── the control tick: a not-released handoff waits for the receiver's airspace (needs a DCS unit) ────────────────────

test.describe('the boundary', () => {
  const LANE = Number(process.env.E2E_LANE || 0);
  let fake;
  test.beforeAll(async () => { fake = await startFakeDcs(fakeDcsPort(3010 + LANE), { units: true }); });
  test.afterAll(async () => { if (fake) await fake.stop(); });

  test('AP to CTR, not released: CTR checks in inside RAPCON, control waits, then moves when the aircraft crosses into CENTER\'s airspace', async ({ browser }) => {
    const b = await controller(browser, { signedOn: ['OPS', 'AP'], facilityId: 'INCIRLIK', controller: 'ap-controller' });
    const a = await ctr(browser);
    await expect.poll(() => b.evaluate(() => crc.airspaceLayer.currentTheater()), { timeout: 30000 }).toBe('Syria');
    const n = Date.now() % 10000;
    const cs = `CRB${n}`;
    const unitId = 70000 + n;
    // 24 nm north of the field at 10,000 ft: inside RAPCON (ADR 0125's LTAG-RAPCON, SFC-FL280, 50 nm).
    fake.setUnit({ id: unitId, name: `ZZ${n}`, callsign: 'Enfield 11', lat: 37.4, lon: 35.43, altM: 3048 }); // a name no Strip matches: bound by hand

    // A departure at AP's terminus, as airborneDeparture builds it.
    const s0 = await seedStrip(b, { callsign: cs, stripType: 'DEPARTURE' });
    const idOf = () => b.evaluate((c) => {
      const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && x.facilityId === 'INCIRLIK'
        && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
      return s ? { stripId: s.stripId, flightDataId: s.flightDataId, state: s.state, owner: s.ownerPositionId } : null;
    }, cs);
    let s = await idOf();
    await b.evaluate((id) => crc.ws.sendEfspMutation('OPS', crc.state.getEfspStrip(id), { kind: 'SetState', toState: 'HANDED_OFF' }), s.stripId);
    await expect.poll(async () => (await idOf()).state).toBe('HANDED_OFF');
    await b.evaluate((id) => crc.ws.sendEfspMutation('OPS', crc.state.getEfspStrip(id), { kind: 'TransferStrip', toPositionId: 'AP', bayId: 'ap-departures', rackId: 'main' }), s.stripId);
    await expect.poll(async () => (await idOf()).owner).toBe('AP');
    void s0;
    await goBay(b, 'AP', 'ap-departures');
    await handOff(b, strip(b, cs), { released: false });

    // CTR accepts; the flight is correlated with the unit.
    await goBay(a, 'CTR', 'ctr-ap-coordination');
    await expect(strip(a, cs).getByRole('button', { name: 'Accept Hand Off' })).toBeVisible({ timeout: 10000 });
    await strip(a, cs).getByRole('button', { name: 'Accept Hand Off' }).click();
    s = await idOf();
    await b.evaluate(([fd, t]) => { const r = crc.state.getEfspCorrelation(fd); crc.ws.sendEfspCorrelationMutation('AP', fd, r ? r.rev : 0, { kind: 'BindTrack', trackId: String(t) }); }, [s.flightDataId, unitId]);
    await expect.poll(() => b.evaluate((fd) => { const r = crc.state.getEfspCorrelation(fd); return r ? `${r.state}/${r.trackId}` : null; }, s.flightDataId), { timeout: 15000 }).toBe(`CORRELATED/${unitId}`);

    // CTR finds the Strip (its working Bay after accept) and marks the aircraft checked in: control stays with AP (RAPCON).
    const ctrStrip = () => strip(a, cs);
    await a.waitForFunction((c) => crc.state.getAllEfspStrips().some(x => x.facilityId === 'CENTER' && x.state !== 'DROPPED'
      && x.coordination && x.coordination.state === 'ACTIVE' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c), cs);
    const bayOf = await a.evaluate((c) => crc.state.getAllEfspStrips().find(x => x.facilityId === 'CENTER' && x.state !== 'DROPPED'
      && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c).bayId, cs);
    await goBay(a, 'CTR', bayOf);
    await expect(chip(a, cs, 'released')).toHaveText('NOT RELEASED');
    await step(a, cs, 'Checked in').click();
    await expect(chip(b, cs, 'comms')).toHaveText('COMMS: CTR');
    await serverTicks(a, 2); // two heartbeats: several 1 s control ticks have run
    await expect(chip(b, cs, 'control')).toHaveText('CTRL: AP');
    await expect(chip(a, cs, 'control')).toHaveText('CTRL: AP');
    await shot(a, '07-checked-in-inside-rapcon-control-waits.png');

    // The aircraft climbs out of RAPCON (above FL280): CENTER's airspace, and the tick moves control.
    fake.setUnit({ id: unitId, name: `ZZ${n}`, callsign: 'Enfield 11', lat: 37.4, lon: 35.43, altM: 9150 });
    await expect(chip(a, cs, 'control')).toHaveText('CTRL: CTR', { timeout: 15000 });
    await expect(chip(b, cs, 'control')).toHaveText('CTRL: CTR');
    await expect(chip(a, cs, 'released')).toHaveCount(0);
    await noAmber(a, cs);
    await shot(a, '08-crossed-into-center-control-moved.png');
    void ctrStrip;
  });
});
