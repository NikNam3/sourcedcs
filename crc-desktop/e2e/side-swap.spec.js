'use strict';

/* SIDE-SWAP (decisions.md H122, H117; crc-sync docs/adr/0114): on a carrier Strip the side number and the callsign swap places.
 * Once a side number is typed, the side number (C18) has the callsign's slot (first, two columns wide) and the callsign (C1) has
 * the side number's (one column). With no side number the callsign keeps the big slot. The callsign is still on the Strip, so
 * a Strip is still found by its callsign text. MARSHAL (typed) and FINAL (read). One controller signed on to the whole carrier.
 */

const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');

test.use({ viewport: { width: 1400, height: 1000 } });
test.setTimeout(60000);

let seq = 0;
const unique = () => String((Date.now() + seq++) % 10000);

const stripOf = (page, callsign) => page.evaluate((c) => {
  const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
  return s ? { stripType: s.stripType, state: s.state, ownerPositionId: s.ownerPositionId } : null;
}, callsign);
const waitStrip = (page, callsign, pred, what) => expect.poll(async () => { const s = await stripOf(page, callsign); return !!s && pred(s); }, { message: what, timeout: 10000 }).toBe(true);
// Found by the callsign's text anywhere on the Strip, as the other carrier specs find it.
const strip = (page, callsign) => page.locator('.efsp-strip', { has: page.getByText(callsign, { exact: true }) }).first();
const fields = (s) => s.locator('.efsp-strip-fields > .efsp-field');
const fieldOf = (s, blockId) => s.locator('.efsp-strip-fields > .efsp-field', { has: s.page().locator(`.efsp-block-${blockId}`) });

async function openBay(page, positionId, bayId) {
  await page.locator(`.efsp-position-tab[data-position-id="${positionId}"]`).click();
  await page.locator('.efsp-bay-tab', { hasText: bayId }).first().click();
}

async function cleanUp(page) {
  await page.evaluate(() => {
    const own = crc.ws.getActingPositions('CARRIER');
    for (const s of crc.state.getAllEfspStrips()) {
      if (s.state !== 'DROPPED' && s.facilityId === 'CARRIER' && own.includes(s.ownerPositionId)) {
        crc.ws.sendEfspMutation(s.ownerPositionId, s, { kind: 'DropStrip', reason: 'e2e cleanup' });
      }
    }
  });
  await expect.poll(() => page.evaluate(() => crc.state.getAllEfspStrips().filter(s => s.state !== 'DROPPED' && s.facilityId === 'CARRIER').length)).toBe(0);
}

async function bigSlotIs(s, blockId, other) {
  await expect(fields(s).first().locator(`.efsp-block-${blockId}`)).toHaveCount(1);
  await expect(fields(s).first()).toHaveClass(/efsp-field-w2/);
  await expect(fieldOf(s, other)).not.toHaveClass(/efsp-field-w2/);
}

test('01 a MARSHAL Strip: callsign big until a side number is typed, then the side number big and the callsign small; a FINAL Strip keeps it', async ({ page }) => {
  await openPanel(page, { signedOn: ['CV_MARSHAL', 'CV_APP1', 'CV_APP2', 'CV_PRIFLY'], facilityId: 'CARRIER', controller: 'e2e-side-swap' });
  await page.waitForFunction(() => typeof crc.carrier.getEfspCarrier === 'function' && !!crc.carrier.getEfspCarrier());
  const callsign = `SWP${unique()}`;
  const side = `4${unique()}`.slice(0, 4);
  await page.evaluate((c) => crc.ws.sendEfspCreateStrip('CV_MARSHAL', {
    kind: 'CreateStrip', bayId: 'cv-marshal-stack', rackId: 'main', stripType: 'MARSHAL', flightData: { callsign: c, aircraftType: 'F-18C' },
  }, 'CARRIER'), callsign);
  await waitStrip(page, callsign, s => s.state === 'IN_STACK', 'checked in');
  await openBay(page, 'CV_MARSHAL', 'cv-marshal-stack');
  const s = strip(page, callsign);
  await expect(s).toBeVisible();

  // No side number yet: the callsign keeps the big slot.
  await bigSlotIs(s, 'C1', 'C18');
  await expect(fields(s).first()).toContainText(callsign);

  // The Marshal types the side number into its field: it moves to the big slot, the callsign to the small one.
  await fieldOf(s, 'C18').locator('.efsp-block-C18').click();
  const input = s.locator('input.efsp-block-input');
  await input.fill(side);
  await input.press('Enter');
  await expect.poll(() => page.evaluate((c) => {
    const x = crc.state.getAllEfspStrips().find(y => y.state !== 'DROPPED' && (crc.state.getEfspFlightData(y.flightDataId) || { identity: {} }).identity.callsign === c);
    const f = crc.state.getEfspFlightData(x.flightDataId);
    return (f.military && f.military.carrier && f.military.carrier.sideNumber) || null;
  }, callsign)).toBe(side);
  await bigSlotIs(s, 'C18', 'C1');
  await expect(fields(s).first()).toContainText(side);
  await expect(fieldOf(s, 'C1')).toContainText(callsign); // still on the Strip, found by it
  const [big, small] = [await fields(s).first().boundingBox(), await fieldOf(s, 'C1').boundingBox()];
  expect(big.width).toBeGreaterThan(small.width);
  await s.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('01-marshal-side-big.png') });

  // Commence, then Radar contact: the same flight's FINAL Strip leads with the side number too.
  await s.locator('.efsp-nla-btn[data-carrier-handoff="MARSHAL_TO_APPROACH"]').click();
  await waitStrip(page, callsign, x => x.state === 'COMMENCED' && x.ownerPositionId === 'CV_APP1', 'Commence');
  await openBay(page, 'CV_APP1', 'cv-app1-lane');
  await strip(page, callsign).locator('.efsp-nla-btn[data-carrier-handoff="APPROACH_TO_FINAL"]').click();
  await waitStrip(page, callsign, x => x.stripType === 'FINAL' && x.state === 'ON_FINAL', 'Radar contact');
  await openBay(page, 'CV_APP1', 'cv-app1-final');
  const f = strip(page, callsign);
  await expect(f).toBeVisible();
  await bigSlotIs(f, 'C18', 'C1');
  await expect(fields(f).first()).toContainText(side);
  await f.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('01-final-side-big.png') });

  await cleanUp(page);
});

const setCase = async (page, value) => {
  if (await page.evaluate(() => crc.carrier.carrierCaseValue()) === value) return;
  await page.evaluate((v) => crc.ws.sendEfspCarrierMutation('CV_PRIFLY', undefined, undefined, { kind: 'SetCarrierState', field: 'case', value: v }), value);
  await expect.poll(() => page.evaluate(() => crc.carrier.carrierCaseValue()), { timeout: 10000 }).toBe(value);
};

test('02 a PATTERN Strip at PriFly: side number first once one is set, else the callsign and no SIDE field; the search finds the side number', async ({ page }) => {
  await openPanel(page, { signedOn: ['CV_MARSHAL', 'CV_APP1', 'CV_APP2', 'CV_PRIFLY'], facilityId: 'CARRIER', controller: 'e2e-side-swap2' });
  await page.waitForFunction(() => typeof crc.carrier.getEfspCarrier === 'function' && !!crc.carrier.getEfspCarrier());
  await setCase(page, 'II');
  const withSide = `SWP${unique()}`;
  const noSide = `SWQ${unique()}`;
  const side = `3${unique()}`.slice(0, 3);
  for (const c of [withSide, noSide]) {
    await page.evaluate((cs) => crc.ws.sendEfspCreateStrip('CV_MARSHAL', {
      kind: 'CreateStrip', bayId: 'cv-marshal-stack', rackId: 'main', stripType: 'MARSHAL', flightData: { callsign: cs, aircraftType: 'F-18C' },
    }, 'CARRIER'), c);
    await waitStrip(page, c, s => s.state === 'IN_STACK', `${c} checked in`);
  }
  await page.evaluate(([c, v]) => {
    const s = crc.state.getAllEfspStrips().find(x => x.state !== 'DROPPED' && (crc.state.getEfspFlightData(x.flightDataId) || { identity: {} }).identity.callsign === c);
    crc.ws.sendEfspMutation('CV_MARSHAL', s, { kind: 'SetBlock', blockId: 'C18', value: v });
  }, [withSide, side]);
  await expect.poll(() => page.evaluate((c) => {
    const x = crc.state.getAllEfspStrips().find(y => y.state !== 'DROPPED' && (crc.state.getEfspFlightData(y.flightDataId) || { identity: {} }).identity.callsign === c);
    const f = crc.state.getEfspFlightData(x.flightDataId);
    return (f.military && f.military.carrier && f.military.carrier.sideNumber) || null;
  }, withSide)).toBe(side);

  // See you: both go to PriFly as PATTERN Strips.
  await openBay(page, 'CV_MARSHAL', 'cv-marshal-stack');
  for (const c of [withSide, noSide]) {
    await strip(page, c).locator('.efsp-nla-btn[data-carrier-handoff="MARSHAL_TO_PRIFLY"]').click();
    await waitStrip(page, c, s => s.stripType === 'PATTERN' && s.ownerPositionId === 'CV_PRIFLY', `${c} See you`);
  }
  await openBay(page, 'CV_PRIFLY', 'cv-prifly-pattern');
  const led = strip(page, withSide);
  await expect(led).toBeVisible();
  await bigSlotIs(led, 'C18', 'C1');
  await expect(fields(led).first()).toContainText(side);
  await expect(fieldOf(led, 'C1')).toContainText(withSide);
  const plain = strip(page, noSide);
  await expect(fields(plain).first().locator('.efsp-block-C1')).toHaveCount(1);
  await expect(fields(plain).first()).toContainText(noSide);
  await expect(plain.locator('.efsp-strip-fields .efsp-block-C18')).toHaveCount(0); // no empty SIDE on the face
  await led.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('02-pattern-side-big.png') });

  // The Bay search finds the Strip by its side number.
  const found = await page.evaluate((v) => crc.state.searchEfspStrips(v).map(s => (crc.state.getEfspFlightData(s.flightDataId) || { identity: {} }).identity.callsign), side);
  expect(found).toContain(withSide);

  await cleanUp(page);
  await setCase(page, 'III');
});
