'use strict';

/* The METRICS panel against a real crc-sync (docs/adr/0072; the server half is
 * docs/adr/0065). A controller searches, finds a Strip in a Bay and flips one;
 * the client measures all three and reports them, and the panel — which needs
 * no Position — shows them beside the metrics nobody has instrumented yet.
 *
 * Run with E2E_LANE=6.
 */

const path = require('path');
const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, stripByCallsign } = require('./helpers/app');

test.describe.configure({ timeout: 60000 });

const SHOTS = path.join(__dirname, '..', '..', 'docs', 'wip', 'L15');
const FDR = { route: 'DCT', requestedAltitude: 'FL250', departureAirport: 'LTAG', destinationAirport: 'LTAF' };

const metricRow = (page, id) => page.locator(`#metrics-panel .metrics-row[data-metric="${id}"]`);
const missionCell = (page, id) => metricRow(page, id).locator('.metrics-cell').first();

async function openMetrics(page) {
  await page.evaluate(() => window.toggleDockPanel('metrics', true));
  await expect(page.locator('#metrics-panel')).toBeVisible({ timeout: 10000 });
}

test('what a controller does is measured and shown on METRICS', async ({ page }) => {
  await openPanel(page, { held: ['OPS', 'GND'] });
  await seedStrip(page, { callsign: 'MET101', role: 'DEPARTURE', fdr: FDR });
  await seedStrip(page, { callsign: 'MET102', role: 'DEPARTURE', fdr: FDR });

  // Two searches, the way a controller runs one: `.find` in the command line.
  const cmd = page.locator('#efsp-dot-command-input');
  for (const cs of ['MET101', 'MET102']) {
    await cmd.fill(`.find ${cs}`);
    await cmd.press('Enter');
  }

  // Enter a Bay, then find a Strip in it.
  await page.locator('#efsp-position-tabs .efsp-position-tab[data-position-id="OPS"]').click();
  await page.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="ops-coordination"]').click();
  await page.locator('#efsp-bay-tabs .efsp-bay-tab[data-bay-id="ops-proposed"]').click();
  await page.waitForTimeout(400);
  const s = stripByCallsign(page, 'MET101');
  await s.click({ position: { x: 3, y: 3 } });
  await expect(s).toHaveClass(/efsp-strip-selected/);

  // One paper gesture.
  const flipsBefore = await page.evaluate(() => getAllEfspStrips().filter(x => x.flags && x.flags.flipped).length);
  await stripByCallsign(page, 'MET102').dblclick({ position: { x: 3, y: 3 } });
  await expect.poll(() => page.evaluate(() => getAllEfspStrips().filter(x => x.flags && x.flags.flipped).length)).toBe(flipsBefore + 1);

  // Sent now rather than at the next 10 s flush; the ack says crc-sync took all four.
  const stats = await page.evaluate(() => { flushEfspMetricsNow(); return efspMetricsClientStats(); });
  expect(stats.sent, JSON.stringify(stats)).toBe(4);
  await expect.poll(() => page.evaluate(() => efspMetricsClientStats().acked)).toBeGreaterThan(0);
  expect(await page.evaluate(() => efspMetricsClientStats().rejected)).toBe(0);

  await openMetrics(page);
  await page.evaluate(() => requestEfspMetrics());

  // Every metric in §11.5 is collected and visible (WP8 bullet 1): seven rows,
  // each with a value, a target and a verdict.
  await expect(page.locator('#metrics-panel .metrics-row[data-metric]')).toHaveCount(7);
  for (const row of await page.locator('#metrics-panel .metrics-row[data-metric]').all()) {
    await expect(row.locator('.metrics-target')).toHaveText(/^target \S/);
    for (const cell of await row.locator('.metrics-cell').all()) {
      await expect(cell.locator('.metrics-value')).not.toBeEmpty();
      await expect(cell.locator('.metrics-verdict')).not.toBeEmpty();
    }
  }

  await expect(missionCell(page, 'searchInvocations').locator('.metrics-value')).toContainText('2 searches');
  await expect(missionCell(page, 'timeToFind').locator('.metrics-value')).toContainText('n=1');
  await expect(missionCell(page, 'timeToFind').locator('.metrics-verdict')).toHaveText('MET');
  await expect(missionCell(page, 'gestureInputs').locator('.metrics-value')).toContainText('FLIP 1.0 (1)');
  await expect(missionCell(page, 'gestureInputs').locator('.metrics-verdict')).toHaveText('MET');
  // L19 instruments staleness, so the cell no longer says 'not instrumented (L19)'; a run with no
  // contradicting Strip reads 'nothing in this window'.
  await expect(missionCell(page, 'staleness').locator('.metrics-value')).toHaveText('nothing in this window');
  await expect(missionCell(page, 'staleness').locator('.metrics-verdict')).not.toHaveText('NOT INSTRUMENTED');
  await expect(page.locator('#metrics-panel .metrics-reconciliation')).toContainText('reconciles with the Mutation log ✓');
  // The traffic count is the Board's for the whole run, and earlier spec files fly real departures
  // (alert-scramble takes VIPER11 airborne), so "= 0 flights" is not this spec's to assert. What it
  // owns is that the partition reconciles: local + transient + unknown = flights, drawn as such.
  const partition = page.locator('#metrics-panel .metrics-partition');
  await expect(partition).toContainText(/^local \d+ \+ transient \d+ \+ unknown \d+ = \d+ flights/);
  const [, l, t, u, total] = (await partition.textContent()).match(/^local (\d+) \+ transient (\d+) \+ unknown (\d+) = (\d+) flights/).map(Number);
  expect(l + t + u, 'the partition sums to the flight count').toBe(total);
  await expect(partition).not.toHaveClass(/metrics-tone-bad/);

  // Only NOT MET is coloured: a met verdict is the plain text colour.
  const [plain, met] = await page.evaluate(() => {
    const cell = document.querySelector('#metrics-panel .metrics-row[data-metric="gestureInputs"] .metrics-cell .metrics-verdict');
    const value = document.querySelector('#metrics-panel .metrics-row[data-metric="gestureInputs"] .metrics-cell .metrics-value');
    return [getComputedStyle(value).color, getComputedStyle(cell).color];
  });
  expect(met).toBe(plain);

  // Per Position: folded, then shown.
  await expect(page.locator('#metrics-panel .metrics-per-position')).toHaveCount(0);
  await page.locator('#metrics-panel .metrics-toggle').click();
  await expect(page.locator('#metrics-panel .metrics-per-position')).toContainText('OPS');

  await page.screenshot({ path: path.join(SHOTS, 'metrics-1600.png'), fullPage: false });
  await page.setViewportSize({ width: 480, height: 1000 });
  await page.waitForTimeout(300);
  await page.locator('#metrics-panel').screenshot({ path: path.join(SHOTS, 'metrics-480.png') });
});

test('the panel needs no Position and polls only while it is on screen', async ({ page }) => {
  await openPanel(page, { held: [] });
  await openMetrics(page);
  await expect(page.locator('#metrics-panel .metrics-row[data-metric]')).toHaveCount(7);

  // Hidden behind the Strip panel's tab: the next poll tick sends nothing.
  await page.evaluate(() => {
    window.__metricsRequests = 0;
    const orig = window.sendToSync;
    window.sendToSync = (m) => { if (m && m.type === 'efsp-metrics-request') window.__metricsRequests += 1; return orig(m); };
  });
  await page.evaluate(() => window.toggleDockPanel('efsp', true));
  await page.evaluate(() => dock.api.getPanel('efsp').api.setActive());
  await expect(page.locator('#metrics-panel')).toBeHidden();
  await page.evaluate(() => _metricsPollTick());
  expect(await page.evaluate(() => window.__metricsRequests)).toBe(0);
  // Shown again: it asks at once.
  await page.evaluate(() => dock.api.getPanel('metrics').api.setActive());
  await expect(page.locator('#metrics-panel')).toBeVisible();
  await page.evaluate(() => _metricsPollTick());
  await expect.poll(() => page.evaluate(() => window.__metricsRequests)).toBeGreaterThan(0);
});
