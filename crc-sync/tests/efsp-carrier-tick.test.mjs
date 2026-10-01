import test from 'node:test';
import assert from 'node:assert/strict';

/* The ship-state tick, the sun, and the hull config (docs/adr/0074). */

const { CarrierStore } = await import('../src/efsp/carrier-store.js');
const { CarrierTick } = await import('../src/efsp/carrier-tick.js');
const { isNight, solarElevationDeg } = await import('../src/efsp/carrier/sun.js');
const hullConfig = await import('../src/efsp/carrier/hull-config.js');

const clock = (t) => ({ now: () => t.v, source: 'TEST' });

test('the shipped hull is CVN-72 UNION, one hull', () => {
  const hulls = hullConfig.getHulls();
  assert.equal(hulls.length, 1);
  assert.deepEqual(hulls[0].match, { unitName: 'UNION', type: 'CVN_72', coalition: 'own' });
  assert.equal(hullConfig.radarIsHull('CVN-72', { unitName: 'UNION' }), true);
  assert.equal(hullConfig.radarIsHull('CVN-72', { unitName: 'TARAWA' }), false);
});

test('the sun: noon over Syria in June is day, local midnight is night, and an unknown position is unknown', () => {
  const noon = Date.UTC(2026, 5, 1, 9, 0); // ~12:00 local at 36E
  const midnight = Date.UTC(2026, 5, 1, 21, 0);
  assert.ok(solarElevationDeg(35, 36, noon) > 60);
  assert.equal(isNight(35, 36, noon), false);
  assert.equal(isNight(35, 36, midnight), true);
  assert.equal(isNight(null, 36, noon), null);
});

function rig(track) {
  const t = { v: Date.UTC(2026, 5, 1, 9, 0) };
  const store = new CarrierStore({ hulls: hullConfig.getHulls(), clock: clock(t) });
  const sent = [];
  const tracks = { list: track ? [track] : [] };
  const tick = new CarrierTick({
    carrierStore: store, tracks: () => tracks.list, ownCoalition: () => 3, clock: clock(t),
    convergenceAt: () => 1.5, variationAt: () => 4.5, weatherPa: () => 101325, onChange: (id) => sent.push(id),
  });
  return { store, tick, tracks, sent, t };
}
const SHIP = { id: 'u1', name: 'UNION', type: 'CVN_72', category: 4, coalition: 3, lat: 35, lon: 36, heading: 10, groundSpeed: 7.7 };

test('the tick builds the banner from the ship: final bearing is heading minus the deck angle, computed and never typed', () => {
  const r = rig(SHIP);
  assert.equal(r.tick.tick(), true);
  const s = r.store.getShipState();
  assert.equal(s.found, true);
  assert.equal(s.headingRef, 'TRUE', 'grid convergence was supplied');
  assert.equal(s.brcDeg, 12); // 10 grid + 1.5 convergence, rounded
  assert.equal(s.finalBearingDeg, 3); // 12 - 9
  assert.equal(s.magneticVariationDeg, 4.5);
  assert.equal(s.altimeterSource, 'THEATER_WEATHER');
  assert.equal(r.store.view().shipState.finalBearingDeg, 3);
  assert.equal(r.tick.tick(), false, 'a quiet tick sends nothing');
  assert.equal(r.sent.length, 1);
});

test('a one-degree turn republishes, a track that vanishes goes stale, and a missing hull says why', () => {
  const r = rig(SHIP);
  r.tick.tick();
  r.tracks.list = [{ ...SHIP, heading: 40 }];
  assert.equal(r.tick.tick(), true);
  r.tracks.list = [];
  assert.equal(r.tick.tick(), true);
  assert.equal(r.store.getShipState().stale, true);
  const none = rig(null);
  none.tick.tick();
  assert.equal(none.store.getShipState().found, false);
  assert.equal(none.store.getShipState().hullProblem, 'hull not found');
  // an ambiguous hull is never guessed
  const two = rig(SHIP);
  two.tracks.list = [SHIP, { ...SHIP, id: 'u2', name: 'OTHER' }];
  two.tick.tick();
  assert.equal(two.store.getShipState().found, true, 'unit name wins');
});

test('the Case advisory speaks only when the Case is less restrictive than the weather floor (night), and never blocks', () => {
  const r = rig(SHIP);
  r.tick.tick();
  r.store.apply({ clientMutationId: 'x', op: { kind: 'SetCase', to: 'I' } }, 'CV_PRIFLY', 'c');
  assert.equal(r.store.view().advisory, null, 'day: nothing to say');
  r.t.v = Date.UTC(2026, 5, 1, 21, 0);
  const v = r.store.view();
  assert.equal(v.advisory.floor, 'III');
  assert.equal(v.recoveryCase.value, 'I', 'the weather advised, it did not change the Case');
});
