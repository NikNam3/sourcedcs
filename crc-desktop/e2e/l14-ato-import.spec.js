'use strict';

/* L14 — the ATO import, in a real browser (crc-sync docs/adr/0071).
 *
 * TAC_C2 pastes the research fixture into the Import ATO dialog, previews,
 * imports; five mission lines land in tac-c2-tasked; selecting SHELL 71 puts
 * the AR highlight on VIPER 11 and DUDE 21; the ▼ view of VIPER 11 reads its
 * Mode 1 and Mode 2. OPS has pre-filed VIPER 11, so the preview offers the bind.
 *
 * M6/M7 (the vul window) still render as epoch numbers until L16's time
 * rendering merges (contract C2), so the vul window is asserted through page
 * state rather than the cell text.
 *
 * One crc-sync per run and the fixture's callsigns are fixed, so this file
 * imports once and walks everything off that import.
 */

const fs = require('fs');
const path = require('path');
const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');

const FIXTURE = fs.readFileSync(path.join(__dirname, '../../crc-sync/tests/fixtures/ato/iron-flag-26-3.txt'), 'utf8');
const SHOTS = path.join(__dirname, '../../docs/wip/L14');

test.use({ viewport: { width: 1600, height: 1400 } });

const stripIdOf = (page, callsign, role = 'MISSION') => page.evaluate(([cs, r]) => {
  const s = getAllEfspStrips().find(x => x.role === r && x.state !== 'DROPPED' && getEfspFdr(x.fdrId).identity.callsign === cs);
  return s ? s.stripId : null;
}, [callsign, role]);
const stripEl = (page, stripId) => page.locator(`.efsp-strip[data-strip-id="${stripId}"]`);

test('TAC_C2 imports an ATO; the AR group highlights together; Mode 1/2 read in the expanded view', async ({ page }) => {
  test.setTimeout(60000);
  const { consoleErrors } = await openPanel(page, { held: ['TAC_C2'], facilityId: 'TACTICAL' });
  // OPS pre-files VIPER 11 at Incirlik, so the preview has a flight to offer.
  await page.evaluate(() => window.sendEfspSetPositions('INCIRLIK', ['OPS']));
  await page.waitForFunction(() => getActingPositions().includes('OPS'));
  // Sent directly: the visible Bay is TAC_C2's, so the helper's on-screen count would not move.
  await page.evaluate(() => window.sendEfspCreateStrip('OPS', {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main',
    fdr: { callsign: 'VIPER11', aircraftType: 'F16', wakeCategory: 'D' },
  }, 'INCIRLIK'));
  await page.waitForFunction(() => getAllEfspStrips().some(s => s.role === 'DEPARTURE' && getEfspFdr(s.fdrId).identity.callsign === 'VIPER11'));

  const button = page.locator('.efsp-ato-import-btn');
  await expect(button).toBeVisible();
  await button.click();
  const dialog = page.locator('.efsp-ato-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('.efsp-ato-text').fill(FIXTURE);
  await dialog.locator('.efsp-ato-preview-btn').click();
  await expect(dialog.locator('.efsp-ato-line')).toHaveCount(5);
  await expect(dialog.locator('.efsp-ato-line[data-line-id="1101A#0"] .efsp-ato-action')).toHaveValue(/^BIND:/);
  await expect(dialog).toContainText('SHELL71 → VIPER11');
  await page.screenshot({ path: path.join(SHOTS, 'preview-1600.png'), fullPage: false });

  await dialog.locator('.efsp-ato-import-go').click();
  await expect(page.locator('.efsp-ato-dialog')).toHaveCount(0);

  // Only the ATO's own callsigns: the Board is shared by the whole run, and an earlier spec file
  // (l1-popovers' random L#### Strips) leaves MISSION Strips of its own that this import did not make.
  const ATO_CALLSIGNS = ['DUDE21', 'MAGIC11', 'SHELL71', 'SNAKE41', 'VIPER11'];
  const lines = await page.evaluate((own) => getAllEfspStrips()
    .filter(s => s.role === 'MISSION' && s.state !== 'DROPPED' && own.includes(getEfspFdr(s.fdrId).identity.callsign))
    .map(s => { const f = getEfspFdr(s.fdrId); return { cs: f.identity.callsign, bay: s.bayId, m1: f.identity.modeOne, m2: f.identity.modeTwo, vul: [f.mission.vulWindowStartUtc, f.mission.vulWindowEndUtc], msn: f.mission.missionNumber }; }), ATO_CALLSIGNS);
  expect(lines.map(l => l.cs).sort()).toEqual(['DUDE21', 'MAGIC11', 'SHELL71', 'SNAKE41', 'VIPER11']);
  expect(lines.every(l => l.bay === 'tac-c2-tasked')).toBe(true);
  const viper = lines.find(l => l.cs === 'VIPER11');
  expect(viper.msn).toBe('1101A');
  expect(new Date(viper.vul[0]).toISOString().slice(11, 16)).toBe('13:00');
  expect(new Date(viper.vul[1]).toISOString().slice(11, 16)).toBe('15:00');
  // The bound flight: VIPER 11's DEPARTURE and its mission line are one flight.
  const shared = await page.evaluate(() => {
    const all = getAllEfspStrips().filter(s => s.state !== 'DROPPED' && getEfspFdr(s.fdrId).identity.callsign === 'VIPER11');
    return new Set(all.map(s => s.fdrId)).size;
  });
  expect(shared).toBe(1);

  const shellId = await stripIdOf(page, 'SHELL71');
  const viperId = await stripIdOf(page, 'VIPER11');
  const dudeId = await stripIdOf(page, 'DUDE21');
  const snakeId = await stripIdOf(page, 'SNAKE41');
  await expect(stripEl(page, shellId)).toBeVisible();
  await expect(stripEl(page, shellId).locator('.efsp-ar-badge')).toHaveText('AR ×2');
  await expect(stripEl(page, viperId).locator('.efsp-ar-badge')).toHaveText('AR SHELL71');

  // Select SHELL 71 the way a controller does: a click on the Strip body.
  await stripEl(page, shellId).click({ position: { x: 6, y: 6 } });
  await page.waitForFunction((id) => getSelectedEfspStripId() === id, shellId);
  await expect(stripEl(page, viperId)).toHaveClass(/efsp-strip-ar-participant/);
  await expect(stripEl(page, dudeId)).toHaveClass(/efsp-strip-ar-participant/);
  await expect(stripEl(page, snakeId)).not.toHaveClass(/efsp-strip-ar-participant/);
  await expect(stripEl(page, dudeId)).not.toHaveClass(/efsp-strip-marsa-participant/);
  await page.screenshot({ path: path.join(SHOTS, 'ar-join-1600.png') });

  await stripEl(page, viperId).locator('.efsp-expand-btn').click();
  const rows = stripEl(page, viperId).locator('.efsp-ato-row');
  await expect(rows.filter({ hasText: 'Mode 1' })).toContainText('12');
  await expect(rows.filter({ hasText: 'Mode 2' })).toContainText('0011');
  await expect(rows.first().locator('input, select')).toHaveCount(0);
  await stripEl(page, viperId).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, 'expanded-1600.png') });

  await page.setViewportSize({ width: 480, height: 1400 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, 'board-480.png') });
  await button.click();
  await expect(page.locator('.efsp-ato-dialog')).toBeVisible();
  await page.locator('.efsp-ato-dialog .efsp-ato-text').fill(FIXTURE);
  await page.locator('.efsp-ato-dialog .efsp-ato-preview-btn').click();
  await expect(page.locator('.efsp-ato-dialog .efsp-ato-line')).toHaveCount(5);
  await page.screenshot({ path: path.join(SHOTS, 'reimport-preview-480.png') });
  // A re-import of the same ATO is an UPDATE of every line, never a second Strip.
  await expect(page.locator('.efsp-ato-dialog .efsp-ato-line[data-line-id="1901T#0"] .efsp-ato-action')).toHaveValue('UPDATE');
  await page.keyboard.press('Escape');

  // Map tiles and weather answer 503 with no DCS behind the run; those are not this panel's.
  expect(consoleErrors.filter(e => !/Failed to load resource/.test(e))).toEqual([]);
});
