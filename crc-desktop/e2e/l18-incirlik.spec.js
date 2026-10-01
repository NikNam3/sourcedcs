'use strict';

/* L18 server half (crc-sync docs/adr/0075, 0093) on screen: RSU's pattern board, SFA's frequency racks with the
 * rotation header and "Rotate to PAR", and PAR's FINAL panel with nothing to type. One controller holds RSU, APP,
 * SFA and PAR. Run on E2E_LANE=9. The Board lives for the whole run, so every test drops what it made. */

const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');

test.use({ viewport: { width: 1400, height: 1000 } });
test.setTimeout(60000);

let seq = 0;
const cs = (prefix) => `${prefix}${(Date.now() + seq++) % 10000}`;

const stripOf = (page, callsign) => page.evaluate((c) => {
  const s = getAllEfspStrips().find(x => x.state !== 'DROPPED' && (getEfspFdr(x.fdrId) || { identity: {} }).identity.callsign === c);
  return s ? { stripId: s.stripId, role: s.role, state: s.state, ownerPositionId: s.ownerPositionId, bayId: s.bayId, rackId: s.rackId, mhz: (getEfspFdr(s.fdrId).comms || {}).workingFrequencyMhz } : null;
}, callsign);
const waitStrip = (page, callsign, pred, what) => expect.poll(async () => { const s = await stripOf(page, callsign); return !!s && pred(s); }, { message: what, timeout: 10000 }).toBe(true);

async function openBay(page, positionId, bayId) {
  await page.locator(`.efsp-position-tab[data-position-id="${positionId}"]`).click();
  await page.locator('.efsp-bay-tab', { hasText: bayId }).first().click();
}

async function cleanUp(page) {
  await page.evaluate(() => {
    for (const s of getAllEfspStrips()) {
      if (s.state !== 'DROPPED' && s.facilityId === 'INCIRLIK') sendEfspMutation(s.ownerPositionId, s, { kind: 'DropStrip', reason: 'e2e cleanup' });
    }
  });
  await expect.poll(() => page.evaluate(() => getAllEfspStrips().filter(s => s.state !== 'DROPPED' && s.facilityId === 'INCIRLIK').length)).toBe(0);
}

async function controller(page) {
  await openPanel(page, { held: ['RSU', 'APP', 'SFA', 'PAR'], controller: 'e2e-l18' });
  await page.waitForFunction(() => typeof getEfspSfa === 'function' && !!getEfspSfa());
}

test.afterEach(async ({ page }) => { await cleanUp(page).catch(() => {}); });

test('01 SFA: filed on a frequency Rack, rotated to PAR with the frequency unchanged, talk-down has nothing to type, Landing assured', async ({ page }) => {
  await controller(page);
  const call = cs('SFA');
  await page.evaluate((c) => sendEfspCreateStrip('APP', { kind: 'CreateStrip', bayId: 'app-inbound', rackId: 'main', role: 'ARRIVAL', fdr: { callsign: c, aircraftType: 'F-16C', originAirport: 'LTAG' } }), call);
  await waitStrip(page, call, s => s.ownerPositionId === 'APP', 'created at APP');
  await page.evaluate((c) => {
    const s = getAllEfspStrips().find(x => (getEfspFdr(x.fdrId) || { identity: {} }).identity.callsign === c);
    sendEfspMutation('APP', s, { kind: 'TransferStrip', toPositionId: 'SFA', bayId: 'sfa-frequencies', rackId: 'freq-2' });
  }, call);
  await waitStrip(page, call, s => s.ownerPositionId === 'SFA' && s.rackId === 'freq-2' && s.mhz === 233.1, 'on SFA freq-2, frequency set from the Rack');

  await openBay(page, 'SFA', 'sfa-frequencies');
  const header = page.locator('.efsp-sfa-header');
  await expect(header).toBeVisible();
  await expect(header.locator('.efsp-sfa-row')).toHaveCount(5);
  await expect(page.locator('.efsp-rack-header', { hasText: 'freq-2 · 233.100' })).toBeVisible();
  // APP is held too, so the rotation is editable here: put PAR on freq-4
  await header.locator('select[data-rack-id="freq-4"]').selectOption('PAR');
  await expect.poll(() => page.evaluate(() => getEfspSfa().rotation['freq-4'])).toBe('PAR');

  await page.locator('.efsp-sfa-rotate').first().click();
  await waitStrip(page, call, s => s.ownerPositionId === 'PAR' && s.role === 'FINAL' && s.state === 'ON_FINAL' && s.bayId === 'par-final', 'rotated');
  expect((await stripOf(page, call)).mhz).toBe(233.1);

  await openBay(page, 'PAR', 'par-final');
  const final = page.locator('.efsp-final');
  await expect(final).toBeVisible();
  await expect(final.locator('input, select, textarea')).toHaveCount(0); // 7.10: nothing to type
  await expect(page.locator('.efsp-strip:visible')).toHaveCount(0);       // PAR's racks are replaced by the panel
  await final.locator('.efsp-final-terminal').first().click();            // Landing assured
  await waitStrip(page, call, s => s.state === 'BALL', 'BALL');
});

test('02 PAR holds one aircraft: a second rotation is refused with the reason, and a missed approach frees the Bay', async ({ page }) => {
  await controller(page);
  const a = cs('PA'); const b = cs('PB');
  for (const [c, rack] of [[a, 'freq-1'], [b, 'freq-3']]) {
    await page.evaluate(([cc, r]) => sendEfspCreateStrip('APP', { kind: 'CreateStrip', bayId: 'app-inbound', rackId: 'main', role: 'ARRIVAL', fdr: { callsign: cc, aircraftType: 'F-16C' } }), [c, rack]);
    await waitStrip(page, c, s => s.ownerPositionId === 'APP', `${c} created`);
    await page.evaluate(([cc, r]) => {
      const s = getAllEfspStrips().find(x => (getEfspFdr(x.fdrId) || { identity: {} }).identity.callsign === cc);
      sendEfspMutation('APP', s, { kind: 'TransferStrip', toPositionId: 'SFA', bayId: 'sfa-frequencies', rackId: r });
    }, [c, rack]);
    await waitStrip(page, c, s => s.ownerPositionId === 'SFA', `${c} with SFA`);
  }
  const rotate = (c) => page.evaluate((cc) => {
    const s = getAllEfspStrips().find(x => (getEfspFdr(x.fdrId) || { identity: {} }).identity.callsign === cc);
    sendEfspMutation('SFA', s, { kind: 'SfaRotation' });
  }, c);
  await rotate(a);
  await waitStrip(page, a, s => s.ownerPositionId === 'PAR', 'A on final');
  await rotate(b);
  await expect.poll(async () => (await stripOf(page, b)).ownerPositionId, { timeout: 5000 }).toBe('SFA');
  await openBay(page, 'PAR', 'par-final');
  await page.locator('.efsp-final-terminal').nth(1).click(); // Missed approach
  await waitStrip(page, a, s => s.state === 'BOLTER_WAVEOFF' && s.bayId === 'par-missed', 'A went around');
  await rotate(b);
  await waitStrip(page, b, s => s.ownerPositionId === 'PAR' && s.bayId === 'par-final', 'B in once the Bay is free');
});

test('03 RSU: the pattern board replaces the racks; Next leg, Landed and Drop work from the chips', async ({ page }) => {
  await controller(page);
  const call = cs('PAT');
  await page.evaluate((c) => sendEfspCreateStrip('RSU', { kind: 'CreateStrip', bayId: 'rsu-pattern', rackId: 'initial', role: 'PATTERN', fdr: { callsign: c, aircraftType: 'F-16C' } }), call);
  await waitStrip(page, call, s => s.ownerPositionId === 'RSU' && s.rackId === 'initial', 'in the pattern');
  await openBay(page, 'RSU', 'rsu-pattern');
  const chip = page.locator('.efsp-pattern-chip', { hasText: call });
  await expect(chip).toBeVisible();
  await expect(page.locator('.efsp-pattern-leg')).toHaveCount(4);
  await chip.locator('.efsp-pattern-next').click();
  await waitStrip(page, call, s => s.rackId === 'base', 'base leg');
  await page.locator('.efsp-pattern-chip', { hasText: call }).locator('[data-action="LANDED"]').click();
  await waitStrip(page, call, s => s.state === 'RECOVERED', 'landed');
  await page.locator('.efsp-pattern-chip', { hasText: call }).locator('[data-action="DROP"]').click();
  await expect.poll(() => stripOf(page, call)).toBeNull();
});
