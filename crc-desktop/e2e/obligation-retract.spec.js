'use strict';

/* Forwarding obligations are state, not events (docs/adr/0067).
 *
 * Against the real crc-sync: a void-expired departure raises
 * VOID_TIME_EXPIRED; CD giving it a fresh void time clears the badge with no
 * reload, and a reload shows only what is still due. The badge arrives
 * through ws-hub.js's post-Mutation hook, not the 15 s sweep, which is why
 * this fits inside the 20 s test timeout.
 *
 * Callsigns are unique per test: the Board lives for the whole run.
 */

const { test, expect } = require('./helpers/test');
const { openPanel, seedStrip, stripByCallsign } = require('./helpers/app');

const MINUTE = 60 * 1000;
const FDR = { departureAirport: 'LTAG', destinationAirport: 'LTAG', route: 'DCT', requestedAltitude: '250' };

const stripOf = (page, cs) => page.evaluate((c) => {
  const s = getAllEfspStrips().find((x) => getEfspFdr(x.fdrId).identity.callsign === c && x.state !== 'DROPPED');
  return s ? { stripId: s.stripId, rev: s.rev, state: s.state, bayId: s.bayId, ownerPositionId: s.ownerPositionId } : null;
}, cs);

/** One Mutation through the page's own sender, waiting for it to land (the next one needs the new rev). */
async function act(page, cs, positionId, op) {
  const before = await stripOf(page, cs);
  await page.evaluate(([c, p, o]) => {
    const s = getAllEfspStrips().find((x) => getEfspFdr(x.fdrId).identity.callsign === c && x.state !== 'DROPPED');
    sendEfspMutation(p, s, o);
  }, [cs, positionId, op]);
  await expect.poll(async () => (await stripOf(page, cs)).rev, { message: `${op.kind} landed` }).toBeGreaterThan(before.rev);
}

async function showStrip(page, cs) {
  const s = await stripOf(page, cs);
  await page.locator(`#efsp-position-tabs .efsp-position-tab[data-position-id="${s.ownerPositionId}"]`).click();
  await page.locator(`#efsp-bay-tabs .efsp-bay-tab[data-bay-id="${s.bayId}"]`).click();
  return stripByCallsign(page, cs);
}

const obligationOnPage = (page, cs) => page.evaluate((c) => {
  const s = getAllEfspStrips().find((x) => getEfspFdr(x.fdrId).identity.callsign === c && x.state !== 'DROPPED');
  const o = s && getEfspObligation(s.stripId);
  return o ? o.obligationType : null;
}, cs);

/** A departure CD holds on a void time that expired 31 minutes ago. */
async function voidExpired(page, cs) {
  await seedStrip(page, { callsign: cs, role: 'DEPARTURE', fdr: FDR });
  await act(page, cs, 'OPS', { kind: 'InvokeNla' }); // -> PENDING_CLEARANCE at CD
  await act(page, cs, 'CD', { kind: 'SetState', toState: 'CLEARED' });
  await act(page, cs, 'CD', { kind: 'SetBlock', blockId: '14A', value: 'CLEARANCE_VOID_TIME' });
  const voidTime = await page.evaluate((m) => Date.now() - 31 * m, MINUTE);
  await act(page, cs, 'CD', { kind: 'SetBlock', blockId: '14D', value: voidTime });
  await act(page, cs, 'CD', { kind: 'SetState', toState: 'HELD' });
}

async function drop(page, cs) {
  const s = await stripOf(page, cs);
  if (s) await act(page, cs, s.ownerPositionId, { kind: 'DropStrip', reason: 'e2e cleanup' }).catch(() => {});
}

test('a void-expired Strip re-cleared by CD loses its badge without a reload, and a reload does not bring it back', async ({ page }) => {
  await openPanel(page, { held: ['OPS', 'CD'] });
  try {
    await voidExpired(page, 'OBR1');
    await expect.poll(() => obligationOnPage(page, 'OBR1'), { timeout: 5000 }).toBe('VOID_TIME_EXPIRED');
    const strip = await showStrip(page, 'OBR1');
    await expect(strip.locator('.efsp-obligation-badge')).toHaveCount(1);

    const fresh = await page.evaluate((m) => Date.now() + 10 * m, MINUTE);
    await act(page, 'OBR1', 'CD', { kind: 'SetBlock', blockId: '14D', value: fresh });
    await expect(strip.locator('.efsp-obligation-badge')).toHaveCount(0, { timeout: 5000 });
    expect(await obligationOnPage(page, 'OBR1')).toBe(null);

    await page.reload();
    await openPanel(page, { held: ['OPS', 'CD'] });
    await expect.poll(() => stripOf(page, 'OBR1')).not.toBe(null);
    const again = await showStrip(page, 'OBR1');
    await expect(again).toHaveCount(1);
    await expect(again.locator('.efsp-obligation-badge')).toHaveCount(0);
  } finally {
    await drop(page, 'OBR1');
  }
});

test('a reload shows an obligation that is still due', async ({ page }) => {
  await openPanel(page, { held: ['OPS', 'CD'] });
  try {
    await voidExpired(page, 'OBR2');
    await expect.poll(() => obligationOnPage(page, 'OBR2'), { timeout: 5000 }).toBe('VOID_TIME_EXPIRED');

    await page.reload();
    await openPanel(page, { held: ['OPS', 'CD'] });
    await expect.poll(() => obligationOnPage(page, 'OBR2'), { timeout: 5000 }).toBe('VOID_TIME_EXPIRED');
    const strip = await showStrip(page, 'OBR2');
    await expect(strip.locator('.efsp-obligation-badge')).toHaveCount(1);
  } finally {
    await drop(page, 'OBR2');
  }
});
