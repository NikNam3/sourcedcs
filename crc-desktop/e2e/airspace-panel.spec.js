'use strict';

/* AIRSP-2P-A: the AIRSPACE panel edits the registry (docs/adr/0098), in a real browser.
 *
 * crc-sync in this rig has no DCS mission, so it has no current theater and shows no airspaces: the records here are
 * injected the way the wire delivers them (an `efsp-airspace-delta`, through the client's own dispatcher), and the
 * panel's sends are captured through the sender setter, then answered with acks built from the ADR's wire shapes.
 * What is under test is the panel: grouping, the Mine/All filter, the ⋯ menu and its reasons, the editor and the R3-23
 * lock, dirty marks, the conflict table, History, Delete, the ROUTE labels and the calendar chip.
 */

const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');

const def = (extra = {}) => ({
  airspaceId: 'R-TOROS', name: 'TOROS RANGE', kind: 'AREA', type: 'RESTRICTED', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP',
  usingPositionId: null, usingFacilityId: null, workingFrequencyMhz: 138.0, controlFrequencyMhz: null, altLowerFt: null, altUpperFt: 18000,
  geometry: null, source: 'PANEL', ...extra,
});
const rec = (d, extra = {}) => ({
  airspaceId: d.airspaceId, theater: 'Syria', definition: d, defRev: 7, rev: 1, state: 'RETURNED', window: null, pendingRequest: null,
  transitions: [], updatedAt: Date.UTC(2026, 9, 2, 13, 0), updatedBy: 'c-0412', ...extra,
});
const SET = [
  rec(def()),
  rec(def({ airspaceId: 'MOA-ADS', name: 'MOA ADANA SOUTH', type: 'MOA', workingFrequencyMhz: 139.25, altLowerFt: 5000, altUpperFt: 23000 })),
  rec(def({ airspaceId: 'MOA-KYE', name: 'MOA KONYA EAST', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 134.6 }), { state: 'ACTIVE' }),
  rec(def({ airspaceId: 'MOA-TAC', name: 'MOA TAC USE', type: 'MOA', usingFacilityId: 'TACTICAL' })),
  rec(def({ airspaceId: 'IR-100', name: 'IR 100', kind: 'ROUTE', type: 'IR', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', altLowerFt: 500, altUpperFt: 3000,
    defaultWidthNm: 4, segments: [{ fix: { name: 'A', lat: 36, lon: 35 }, altLowerFt: 500, altUpperFt: 3000, widthNm: null }, { fix: { name: 'B', lat: 37, lon: 36 }, altLowerFt: null, altUpperFt: null, widthNm: null }] }),
    { state: 'SCHEDULED', pendingRequest: { requestedPositionId: 'TAC_C2', requestedAt: 1, note: null } }),
];

async function open(page, signedOn, facilityId = 'INCIRLIK') {
  const errors = (await openPanel(page, { signedOn, facilityId })).consoleErrors;
  await page.evaluate(() => { if (!crc.dock.isDockPanelOpen('airspace')) crc.dock.toggleDockPanel('airspace', true); });
  await expect(page.locator('#airspace-panel')).toBeVisible({ timeout: 10000 });
  // capture the panel's sends; the cmid is the ack's key
  await page.evaluate(() => {
    window.__sent = [];
    // Stub the wire, not the sender: the real sender builds the frame and keeps the form's ack continuation (sendEfsp).
    crc.ws.setEfspSender('_sendEfsp', (m) => {
      if (m.type !== 'efsp-airspace-mutation') return true;
      const { version, type, clientMutationId, airspaceId: id, baseRev, actingPositionId: pos, op, ...extra } = m;
      window.__sent.push({ pos, id, baseRev, op, extra, clientMutationId });
      return true;
    });
  });
  await inject(page, SET);
  return errors;
}
async function inject(page, records) {
  await page.evaluate((r) => {
    crc.msgRegistry.dispatchEfspMessage({ version: 1, type: 'efsp-airspace-delta', airspaceSeq: 1, airspaces: { updated: r } });
  }, records);
}
// a field row by its LABEL (a row's help text also says "name" and "frequencies")
const fld = (ed, label) => ed.locator('.airspace-field').filter({ has: ed.page().locator('.airspace-field-label', { hasText: label }) });
const card = (page, id) => page.locator(`.airspace-card[data-airspace-id="${id}"]`);
async function menu(page, id) {
  await card(page, id).locator('.airspace-more-btn').click();
  return card(page, id).locator('.airspace-menu');
}
const ack = (page, a) => page.evaluate((m) => crc.msgRegistry.dispatchEfspMessage({ version: 1, type: 'efsp-airspace-ack', ...m }), a);

test('grouped by Facility, Mine by default, ALL adds the other Facility; the card shows the id, the limits and Using', async ({ page }) => {
  await open(page, ['AP']);
  await expect(page.locator('.airspace-group')).toHaveText(['INCIRLIK · 3']);
  await expect(card(page, 'MOA-KYE')).toHaveCount(0);
  await expect(card(page, 'MOA-TAC').locator('.airspace-using')).toHaveText('Using: TACTICAL');
  await expect(card(page, 'MOA-ADS').locator('.airspace-ids')).toHaveText('MOA-ADS · 5000–FL230');
  await page.locator('.airspace-seg-btn[data-filter="all"]').click();
  await expect(page.locator('.airspace-group')).toHaveText(['INCIRLIK · 3', 'CENTER · 2']);
});

test('Edit is disabled with the reason where the session does not own the airspace, and TAC_C2 edits nothing', async ({ page }) => {
  await open(page, ['AP']);
  await page.locator('.airspace-seg-btn[data-filter="all"]').click();
  const m = await menu(page, 'MOA-KYE');
  await expect(m.locator('[data-action="edit"]')).toBeDisabled();
  await expect(m.locator('.airspace-menu-why').first()).toHaveText('Owned by CTR');
  await expect(m.locator('[data-action="history"]')).toBeEnabled();
  await expect(m.locator('[data-action="delete"]')).toBeDisabled();
  const own = await menu(page, 'MOA-ADS');
  await expect(own.locator('[data-action="edit"]')).toBeEnabled();
});

test('TAC_C2 is offered the using side of a Facility-used airspace and an Edit greyed out "Owned by AP"', async ({ page }) => {
  await open(page, ['TAC_C2'], 'TACTICAL');
  await page.locator('.airspace-seg-btn[data-filter="all"]').click();
  await expect(card(page, 'MOA-TAC').locator('.airspace-action-btn')).toHaveText(['Schedule']);
  const m = await menu(page, 'MOA-TAC');
  await expect(m.locator('[data-action="edit"]')).toBeDisabled();
  await expect(m.locator('.airspace-menu-why').first()).toHaveText('Owned by AP');
});

test('editing: a changed field shows a dot and "was"; Save sends one EditAirspace against the opened defRev; the ack closes the form', async ({ page }) => {
  await open(page, ['AP']);
  await (await menu(page, 'R-TOROS')).locator('[data-action="edit"]').click();
  const ed = card(page, 'R-TOROS').locator('.airspace-editor');
  await expect(ed).toBeVisible();
  const save = ed.locator('.airspace-save-btn');
  await expect(save).toBeDisabled();
  await expect(ed.locator('.airspace-editor-status')).toHaveText('Nothing changed.');
  await fld(ed, 'WORK FREQ').locator('input').fill('139.100');
  await fld(ed, 'ALT UPPER').locator('input').fill('FL200');
  await expect(fld(ed, 'WORK FREQ').locator('.airspace-field-was')).toHaveText('was 138.000');
  await expect(fld(ed, 'ALT UPPER').locator('.airspace-field-was')).toHaveText('was 18000 · FL180');
  await expect(ed.locator('.airspace-dot:visible')).toHaveCount(2);
  await expect(ed.locator('.airspace-editor-status')).toContainText('2 fields changed.');
  await save.click();
  const sent = await page.evaluate(() => window.__sent);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ pos: 'AP', id: 'R-TOROS', op: { kind: 'EditAirspace', patch: { workingFrequencyMhz: 139.1, altUpperFt: 20000 } }, extra: { baseDefRev: 7 } });
  await ack(page, { clientMutationId: sent[0].clientMutationId, airspaceId: 'R-TOROS', ok: true, airspace: rec(def({ workingFrequencyMhz: 139.1, altUpperFt: 20000 }), { defRev: 8 }) });
  await expect(card(page, 'R-TOROS').locator('.airspace-editor')).toHaveCount(0);
});

test('validation: errors on the field and summarised beside Save, which is disabled with the reason; a shared frequency is only a note', async ({ page }) => {
  await open(page, ['AP']);
  await (await menu(page, 'MOA-ADS')).locator('[data-action="edit"]').click();
  const ed = card(page, 'MOA-ADS').locator('.airspace-editor');
  await fld(ed, 'NAME').locator('input').fill('');
  await fld(ed, 'WORK FREQ').locator('input').fill('12');
  await expect(ed.locator('.airspace-field-error:visible')).toHaveText(['A name is required.', '30 to 400 MHz.']);
  await expect(ed.locator('.airspace-save-btn')).toBeDisabled();
  await expect(ed.locator('.airspace-editor-status')).toContainText('2 problems to fix before Save: NAME, WORK FREQ');
  await fld(ed, 'NAME').locator('input').fill('MOA ADANA SOUTH');
  await fld(ed, 'WORK FREQ').locator('input').fill('134.600');
  await expect(ed.locator('.airspace-save-btn')).toBeEnabled();
  await expect(ed.locator('.airspace-note')).toContainText('134.600 is also the working frequency of MOA KONYA EAST');
});

test('R3-23: an ACTIVE airspace offers only name and frequencies, with the reason', async ({ page }) => {
  await open(page, ['CTR'], 'CENTER');
  await page.locator('.airspace-seg-btn[data-filter="all"]').click();
  await (await menu(page, 'MOA-KYE')).locator('[data-action="edit"]').click();
  const ed = card(page, 'MOA-KYE').locator('.airspace-editor');
  for (const label of ['NAME', 'WORK FREQ', 'RANGE FREQ']) await expect(fld(ed, label).locator('input')).toBeEnabled();
  for (const label of ['ALT LOWER', 'ALT UPPER', 'USING POSITION']) await expect(fld(ed, label).locator('input')).toBeDisabled();
  await expect(fld(ed, 'ALT UPPER').locator('.airspace-field-why')).toHaveText('airspace is ACTIVE: only name and frequencies can change');
  await expect(fld(ed, 'USING POSITION')).toContainText('takes effect after the next crc-sync restart');
});

test('two windows race one field: the conflict table asks only about the clash, then re-sends against the new revision', async ({ page }) => {
  await open(page, ['AP']);
  await (await menu(page, 'R-TOROS')).locator('[data-action="edit"]').click();
  const ed = card(page, 'R-TOROS').locator('.airspace-editor');
  await fld(ed, 'RANGE FREQ').locator('input').fill('252.000');
  await fld(ed, 'WORK FREQ').locator('input').fill('139.100');
  await ed.locator('.airspace-save-btn').click();
  const [first] = await page.evaluate(() => window.__sent);
  await ack(page, {
    clientMutationId: first.clientMutationId, airspaceId: 'R-TOROS', ok: false, reason: 'STALE_REV',
    conflicts: [{ field: 'controlFrequencyMhz', base: null, theirs: 251.8 }],
    airspace: rec(def({ controlFrequencyMhz: 251.8 }), { defRev: 8, updatedBy: 'RNG1' }),
  });
  const table = card(page, 'R-TOROS').locator('.airspace-conflict-table');
  await expect(table).toBeVisible();
  await expect(table.locator('.airspace-conflict-row-bad')).toHaveCount(1);
  await expect(card(page, 'R-TOROS').locator('.airspace-conflict-title')).toHaveText('Not saved.');
  await expect(table).toContainText('Applies cleanly');
  const review = card(page, 'R-TOROS').locator('.airspace-save-btn', { hasText: 'Review and save' });
  await expect(review).toBeDisabled();
  await table.locator('[data-choice="mine"]').click();
  await review.click();
  const sent = await page.evaluate(() => window.__sent);
  expect(sent).toHaveLength(2);
  expect(sent[1]).toMatchObject({ extra: { baseDefRev: 8 }, op: { kind: 'EditAirspace', patch: { controlFrequencyMhz: 252, workingFrequencyMhz: 139.1 } } });
});

test('a refusal from the server shows beside Save (the name is taken), not as a banner', async ({ page }) => {
  await open(page, ['AP']);
  await (await menu(page, 'R-TOROS')).locator('[data-action="edit"]').click();
  const ed = card(page, 'R-TOROS').locator('.airspace-editor');
  await fld(ed, 'WORK FREQ').locator('input').fill('140.000');
  await ed.locator('.airspace-save-btn').click();
  const [s] = await page.evaluate(() => window.__sent);
  await ack(page, { clientMutationId: s.clientMutationId, airspaceId: 'R-TOROS', ok: false, reason: 'VALIDATION_ERROR', detail: 'the name "X" is already used in Syria' });
  await expect(ed.locator('.airspace-editor-status')).toHaveText('the name "X" is already used in Syria');
});

test('create: + New airspace only for a Position that may create; an AREA with the editor, sent as CreateAirspace', async ({ page }) => {
  await open(page, ['AP']);
  await page.locator('.airspace-new-btn').click();
  const ed = page.locator('.airspace-card-new .airspace-editor');
  await expect(ed).toBeVisible();
  await expect(ed.locator('.airspace-save-btn')).toBeDisabled();
  await fld(ed, 'ID').first().locator('input').fill('MOA-NEW');
  await fld(ed, 'NAME').locator('input').fill('MOA NEW');
  await expect(ed.locator('.airspace-save-btn')).toBeEnabled();
  await ed.locator('.airspace-save-btn').click();
  const [s] = await page.evaluate(() => window.__sent);
  expect(s).toMatchObject({ pos: 'AP', id: 'MOA-NEW', op: { kind: 'CreateAirspace', definition: { airspaceId: 'MOA-NEW', name: 'MOA NEW', kind: 'AREA', type: 'MOA', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP' } } });
  await ack(page, { clientMutationId: s.clientMutationId, airspaceId: 'MOA-NEW', ok: true, created: undefined, airspace: rec(def({ airspaceId: 'MOA-NEW', name: 'MOA NEW', type: 'MOA' }), { defRev: 1 }) });
  await expect(page.locator('.airspace-card-new')).toHaveCount(0);
});

test('a session that may not create has no + New airspace', async ({ page }) => {
  await open(page, ['TAC_C2'], 'TACTICAL');
  await expect(page.locator('.airspace-new-btn')).toHaveCount(0);
});

test('History lists state changes and the edits seen, newest first, in mission Zulu', async ({ page }) => {
  await open(page, ['AP']);
  const edited = rec(def({ workingFrequencyMhz: 139.1 }), {
    defRev: 8, updatedAt: Date.UTC(2026, 9, 2, 13, 52), updatedBy: 'c-0412',
    transitions: [{ state: 'SCHEDULED', actingPositionId: 'AP', by: 'c-0412', at: Date.UTC(2026, 9, 2, 13, 18), window: { fromUtc: Date.UTC(2026, 9, 2, 13, 30), toUtc: Date.UTC(2026, 9, 2, 15, 30) } }],
  });
  await inject(page, [edited]);
  await (await menu(page, 'R-TOROS')).locator('[data-action="history"]').click();
  const rows = card(page, 'R-TOROS').locator('.airspace-history-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('1352Z');
  await expect(rows.nth(0)).toContainText('WORK FREQ MHz: 138.000 → 139.100');
  await expect(rows.nth(1)).toContainText('RETURNED → SCHEDULED 1330Z–1530Z');
});

test('Delete: blockers and what clears them while ACTIVE; the confirm step when nothing blocks', async ({ page }) => {
  await open(page, ['CTR'], 'CENTER');
  await page.locator('.airspace-seg-btn[data-filter="all"]').click();
  const m = await menu(page, 'MOA-KYE');
  await expect(m.locator('[data-action="delete"]')).toBeDisabled();
  await expect(m.locator('.airspace-menu-why').first()).toHaveText('State is ACTIVE');
  await page.evaluate(() => crc.state.efspAirspaces.clear());
  await inject(page, [rec(def({ airspaceId: 'MOA-OLD', name: 'MOA OLD', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR' }))]);
  await (await menu(page, 'MOA-OLD')).locator('[data-action="delete"]').click();
  const del = card(page, 'MOA-OLD').locator('.airspace-delete');
  await expect(del.locator('.airspace-conflict-title')).toHaveText('Delete MOA OLD?');
  await del.locator('.airspace-save-btn').click();
  const [s] = await page.evaluate(() => window.__sent);
  expect(s).toMatchObject({ pos: 'CTR', id: 'MOA-OLD', op: { kind: 'DeleteAirspace' }, extra: { baseDefRev: 7 } });
  await ack(page, { clientMutationId: s.clientMutationId, airspaceId: 'MOA-OLD', ok: true, removed: 'MOA-OLD', airspace: null });
  await page.evaluate(() => crc.msgRegistry.dispatchEfspMessage({ version: 1, type: 'efsp-airspace-delta', airspaceSeq: 2, airspaces: { updated: [], removed: ['MOA-OLD'] } }));
  await expect(card(page, 'MOA-OLD')).toHaveCount(0);
});

test('ROUTE: Confirm and Delay, never Approve or Deny; Delay takes a note', async ({ page }) => {
  await open(page, ['CTR'], 'CENTER');
  const route = card(page, 'IR-100');
  await expect(route.locator('.airspace-action-btn')).toHaveText(['Confirm', 'Delay', 'Cancel']);
  await expect(route.locator('.airspace-route-count')).toHaveText('0 flights filed on this route');
  await route.locator('.airspace-action-btn', { hasText: 'Delay' }).click();
  await route.locator('.airspace-delay input').fill('after 1500Z');
  await route.locator('.airspace-delay .airspace-save-btn').click();
  const [s] = await page.evaluate(() => window.__sent);
  expect(s).toMatchObject({ pos: 'CTR', id: 'IR-100', op: { kind: 'DelayActivation', note: 'after 1500Z' } });
});

test('the calendar chip: the next booking in real UTC with the booking link', async ({ page }) => {
  await open(page, ['AP']);
  await page.evaluate(() => crc.msgRegistry.dispatchEfspMessage({
    version: 1, type: 'efsp-airspace-calendar', theater: 'Syria', bookingUrl: 'https://sourcedcs.page/bookings.html',
    byAirspace: { 'R-TOROS': [{ startUtc: '2099-10-04T14:00:00.000Z', endUtc: '2099-10-04T16:00:00.000Z', by: 'Viper', altitudeFt: 23000 }] },
  }));
  const chip = card(page, 'R-TOROS').locator('.airspace-booking');
  await expect(chip).toContainText('NEXT BOOKING 2099-10-04 1400Z–1600Z · Viper · FL230');
  await expect(chip.locator('a')).toHaveAttribute('href', 'https://sourcedcs.page/bookings.html');
  await expect(card(page, 'MOA-ADS').locator('.airspace-booking')).toContainText('NO BOOKING');
});
