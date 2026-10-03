'use strict';

/* SYNC-B-C (crc-sync docs/adr/0106): a store outside the Board heals from its own slice, with no reconnect and no
 * full snapshot. The rig has no mission, so a real store change cannot be made; instead each store's client position
 * is moved to another lifetime (what a server restart looks like from here) with a stale slice in it, and the next
 * heartbeats must bring one efsp-resync naming that store, answered by its slice. */

const { test, expect } = require('./helpers/test');
const { openPanel } = require('./helpers/app');

test.describe.configure({ timeout: 60000 });

const KEYS = ['airspaces', 'correlations', 'marsa', 'runwayStatuses', 'carriers', 'sfaRotation'];

test('every store heals from one slice when its lifetime changes, without a reconnect or a snapshot', async ({ page }) => {
  const sent = [];
  let snapshots = 0;
  const replies = [];
  page.on('websocket', (ws) => {
    ws.on('framesent', (f) => { try { const m = JSON.parse(f.payload); if (m.type === 'efsp-resync') sent.push(m); } catch (_) { /* not JSON */ } });
    ws.on('framereceived', (f) => { try { const m = JSON.parse(f.payload); if (m.type === 'efsp-snapshot') snapshots++; if (m.type === 'efsp-resync-reply') replies.push(m); } catch (_) { /* not JSON */ } });
  });
  await openPanel(page, { signedOn: ['OPS'], controller: 'e2e-store-resync' });
  await expect.poll(() => page.evaluate((keys) => keys.every(k => crc.state.getEfspStoreSync(k)), KEYS)).toBe(true);
  const real = await page.evaluate((keys) => Object.fromEntries(keys.map(k => [k, crc.state.getEfspStoreSync(k).epoch])), KEYS);
  const snapshotsBefore = snapshots;

  // every store: another lifetime, and a stale slice in it
  await page.evaluate((keys) => crc.state.applyEfspStoreSlices(Object.fromEntries(keys.map(k => [k, {
    seq: 0, epoch: 'stale-lifetime', slice: k === 'sfaRotation' ? { stale: true } : [],
  }]))), KEYS);

  await expect.poll(() => page.evaluate((keys) => keys.every(k => crc.state.getEfspStoreSync(k).epoch !== 'stale-lifetime'), KEYS), { timeout: 15000 }).toBe(true);
  expect(await page.evaluate((keys) => Object.fromEntries(keys.map(k => [k, crc.state.getEfspStoreSync(k).epoch])), KEYS)).toEqual(real);

  // one resync per store, each naming only that store, and the stale sfa slice is gone
  expect(sent.map(m => Object.keys(m.stores).join()).sort()).toEqual([...KEYS].sort());
  expect(await page.evaluate(() => (crc.sfa ? crc.sfa.getEfspSfa() : null) && crc.sfa.getEfspSfa().stale)).toBeFalsy();
  expect(snapshots).toBe(snapshotsBefore);
  expect(replies.every(r => r.answer === 'stores')).toBe(true);
});
