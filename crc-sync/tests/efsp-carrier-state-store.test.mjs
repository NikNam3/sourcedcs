import test from 'node:test';
import assert from 'node:assert/strict';

// The carrier state as the store runs it (docs/adr/0113): overrides with sources, who may edit, what a ramp-time or Case change does
// to flights already in marshal, clearing an override, two editors, the wind from the tick, and the audit.

const { CarrierStore } = await import('../src/efsp/carrier-store.js');
const { CarrierTick } = await import('../src/efsp/carrier-tick.js');
const { createShipWind } = await import('../src/app/ship-wind.js');
const hullConfig = await import('../src/efsp/carrier/hull-config.js');

const T0 = Date.UTC(2026, 5, 1, 9, 0); // noon at the ship (36 E)
const NIGHT = Date.UTC(2026, 5, 1, 21, 0);
const SHIP = { id: 'u1', name: 'UNION', type: 'CVN_72', category: 4, coalition: 3, lat: 35, lon: 36, heading: 346, groundSpeed: 8 };

function rig({ windAt = null, mutationLog = null } = {}) {
  const t = { v: T0 };
  const clock = { now: () => t.v, source: 'TEST' };
  const store = new CarrierStore({ hulls: hullConfig.getHulls(), clock, mutationLog });
  const tracks = { list: [SHIP] };
  const sent = [];
  const tick = new CarrierTick({
    carrierStore: store, tracks: () => tracks.list, ownCoalition: () => 3, clock,
    convergenceAt: () => 0, variationAt: () => 5, weatherPa: () => 101325, windAt, onChange: (id) => sent.push(id),
  });
  tick.tick();
  let n = 0;
  const set = (field, value, pos = 'CV_PRIFLY', extra = {}) => store.apply({ clientMutationId: `m${n++}`, ...extra, op: { kind: 'SetCarrierState', field, value } }, pos, `u-${pos}`);
  const flights = (k) => { for (let i = 0; i < k; i++) store.apply({ clientMutationId: `a${n++}`, op: { kind: 'Append', flightDataId: `f${i}` } }, 'CV_MARSHAL', 'm'); };
  return { store, tick, tracks, sent, t, set, flights };
}

const eats = (store) => store.view().derived.MAIN.map((e) => e.pushTimeUtc);

test('every value arrives with its source; typing overrides it and "Use DCS" puts the game\'s value back', () => {
  const { store, set } = rig();
  assert.deepEqual([store.state().brc.value, store.state().brc.source], [346, 'dcs']);
  // typed MAGNETIC (the variation here is 5 E): 100 magnetic is 105 true
  assert.equal(set('brc', 100, 'CV_MARSHAL').ok, true);
  const brc = store.state().brc;
  assert.deepEqual([brc.value, brc.source, brc.override, brc.default, brc.display], [105, 'override', 105, 346, { value: 100, ref: 'M' }]);
  assert.equal(store.state().finalBearing.value, 96, 'final bearing follows the BRC in force');
  assert.equal(store.state().radial.value, 276);
  assert.equal(set('brc', null).ok, true);
  assert.deepEqual([store.state().brc.value, store.state().brc.source, store.state().brc.override], [346, 'dcs', null]);
  assert.equal(store.getRecord().overrides.brcDeg, null);
});

test('the DCS value keeps moving under an override: a turn changes the default, not what a controller typed', () => {
  const { store, set, tick, tracks } = rig();
  set('finalBearing', 330);
  tracks.list = [{ ...SHIP, heading: 20 }];
  assert.equal(tick.tick(), true);
  const st = store.state();
  assert.equal(st.brc.value, 20);
  assert.deepEqual([st.finalBearing.value, st.finalBearing.source, st.finalBearing.default], [335, 'override', 11]);
});

test('PriFly and the Marshal edit; the lanes and every other Position read', () => {
  const { store, set } = rig();
  for (const pos of ['CV_PRIFLY', 'CV_MARSHAL']) assert.equal(set('ceiling', 800, pos).ok, true, pos);
  for (const pos of ['CV_APP1', 'CV_APP2', 'LC', 'TAC_C2']) {
    const r = set('ceiling', 500, pos);
    assert.deepEqual([r.ok, r.reason], [false, 'PERMISSION_DENIED'], pos);
  }
  assert.equal(store.state().weather.ceiling.value, 800);
});

test('a ramp time changed while flights are in marshal moves every EAT together and re-sequences nobody (walk)', () => {
  const { store, set, flights } = rig();
  flights(3);
  assert.deepEqual(eats(store), [null, null, null], 'no ramp time, no EAT: nothing invented');
  set('rampTime', '2040');
  const ramp = store.state().rampTime.value;
  const fix = store.view().tuning.fixToRampMs;
  assert.deepEqual(eats(store), [ramp - fix, ramp + 60_000 - fix, ramp + 120_000 - fix]);
  const before = store.getRecord().stacks.MAIN.entries;
  set('rampTime', '2050', 'CV_MARSHAL');
  assert.deepEqual(eats(store), [ramp + 600_000 - fix, ramp + 660_000 - fix, ramp + 720_000 - fix]);
  assert.deepEqual(store.getRecord().stacks.MAIN.entries, before, 'the stack holds no time, so nothing in it moved');
  // a flight that has pushed keeps its place and status; its derived EAT follows the ramp time (the push time is not stored yet, MARSHAL-BOARD's pushedAt)
  store.applyEffect('MARK_PUSHED', 'f0');
  set('rampTime', '2100');
  assert.equal(store.view().derived.MAIN[0].status, 'PUSHED');
  assert.equal(store.state().rampTime.source, 'override');
  set('rampTime', null);
  assert.deepEqual([store.state().rampTime.value, store.state().rampTime.source], [null, 'none']);
});

test('a Case change mid-recovery keeps the stack, the ramp time and every override; Case I drops the timed fields and III brings them back (walk)', () => {
  const { store, set, flights } = rig();
  flights(2);
  set('rampTime', '2040');
  set('radial', 150);
  set('firstFix', 25);
  const timed = JSON.stringify(store.view().derived.MAIN);
  assert.equal(set('case', 'I').ok, true);
  const caseI = store.view();
  assert.deepEqual(caseI.derived.MAIN.map((e) => [e.marshalDme, e.pushTimeUtc, e.marshalRadialDeg]), [[null, null, null], [null, null, null]]);
  assert.equal(caseI.state.rampTime.source, 'override', 'the ramp time is the ship\'s, not the stack\'s');
  assert.equal(caseI.state.firstFix.value, 25);
  assert.equal(caseI.state.radial.value, 155);
  assert.equal(set('case', 'II', 'CV_MARSHAL').ok, true);
  assert.equal(JSON.stringify(store.view().derived.MAIN), timed.replace(/"caseValue":"III"/g, '"caseValue":"II"'), 'Case II reads like III outside 10 nm');
  assert.equal(set('case', null).ok, true);
  assert.equal(JSON.stringify(store.view().derived.MAIN), timed, 'back at the default Case, the same EATs, DMEs and radial as before');
  assert.equal(store.state().case.source, 'default');
  const hist = store.getRecord().recoveryCase.history;
  assert.deepEqual(hist.map((h) => [h.from, h.to]), [['III', 'I'], ['I', 'II'], ['II', 'III']]);
});

test('an override cleared back to the default: each of the three sources returns, and clearing what was never set changes nothing', () => {
  const { store, set } = rig();
  const rev = store.getRecord().rev;
  const r = set('firstFix', null);
  assert.deepEqual([r.ok, r.unchanged], [true, true], 'nothing to clear');
  assert.equal(store.getRecord().rev, rev, 'and no revision burned');
  set('firstFix', 24);
  assert.deepEqual([store.state().firstFix.value, store.state().firstFix.source], [24, 'override']);
  set('firstFix', null);
  assert.deepEqual([store.state().firstFix.value, store.state().firstFix.source], [21, 'default']);
  set('altimeter', 30.1);
  set('altimeter', null);
  assert.deepEqual([store.state().weather.altimeter.value, store.state().weather.altimeter.source], [29.92, 'dcs']);
  set('tankerPatternSide', 'stbd');
  assert.equal(store.state().tanker.patternSide.source, 'override');
  set('tankerPatternSide', null);
  assert.deepEqual([store.state().tanker.patternSide.value, store.state().tanker.patternSide.source], ['port', 'default']);
});

test('two editors at once: different fields both land; the same field is last-writer-wins; a stale base revision is refused', () => {
  const { store, set } = rig();
  const base = store.getRecord().rev;
  // PriFly and the Marshal both read revision `base` and send at once
  assert.equal(set('brc', 100, 'CV_PRIFLY', { baseRev: base }).ok, true);
  const second = set('rampTime', '2040', 'CV_MARSHAL', { baseRev: base });
  assert.deepEqual([second.ok, second.reason], [false, 'STALE_REV'], 'the Marshal\'s base is one behind');
  // the client sends no base revision for these, so both land
  assert.equal(set('rampTime', '2040', 'CV_MARSHAL').ok, true);
  assert.deepEqual([store.state().brc.source, store.state().rampTime.source], ['override', 'override']);
  // the same field twice: the later write wins, both audited in the record's transitions
  set('ceiling', 1500, 'CV_PRIFLY');
  set('ceiling', 900, 'CV_MARSHAL');
  assert.equal(store.state().weather.ceiling.value, 900);
  const lines = store.getRecord().transitions.map((x) => x.detail);
  assert.ok(lines.includes('ceiling 1500') && lines.includes('ceiling 900'));
});

test('weather: the ceiling and visibility are what a controller typed; the Case advisory reads them with the sun', () => {
  const { store, set, t } = rig();
  assert.deepEqual([store.state().weather.ceiling.source, store.state().weather.visibility.source], ['none', 'none']);
  set('case', 'I');
  assert.equal(store.view().advisory, null, 'day, nothing typed');
  set('ceiling', 800);
  set('visibility', 3);
  const adv = store.view().advisory;
  assert.equal(adv.floor, 'III');
  assert.equal(store.caseValue(), 'I', 'it advises, it does not change the Case');
  set('ceiling', 5000);
  set('visibility', 10);
  assert.equal(store.view().advisory, null, 'high and clear in daylight');
  t.v = NIGHT;
  assert.equal(store.view().advisory.floor, 'III', 'and at night whatever the weather');
});

test('the wind at the ship comes through the tick and the ship\'s speed is added to it', () => {
  const { store, set } = rig({ windAt: () => ({ windFromDeg: 346, windKt: 10 }) });
  assert.deepEqual([store.state().weather.windOverDeck.value, store.state().weather.windOverDeck.source], [26, 'dcs']);
  set('windOverDeck', 31);
  assert.deepEqual([store.state().weather.windOverDeck.value, store.state().weather.windOverDeck.source], [31, 'override']);
  const none = rig();
  assert.deepEqual([none.store.state().weather.windOverDeck.value, none.store.state().weather.windOverDeck.source], [null, 'none'], 'no wind known, none claimed');
});

test('a change of wind republishes the hull; an unchanged one does not', () => {
  let wind = { windFromDeg: 90, windKt: 5 };
  const { tick, sent } = rig({ windAt: () => wind });
  const first = sent.length;
  assert.equal(tick.tick(), false);
  assert.equal(sent.length, first);
  wind = { windFromDeg: 90, windKt: 8 };
  assert.equal(tick.tick(), true);
  assert.equal(sent.length, first + 1);
});

test('the ship wind helper answers with the last fetch and refreshes in the background, once a minute at most', async () => {
  let now = 0;
  const calls = [];
  const grpcClient = { getAptWeather: async (lat, lon, alt) => { calls.push([lat, lon, alt]); return { windFrom: 270, windKt: 12 }; } };
  const sw = createShipWind({ grpcClient, wallNow: () => now });
  assert.equal(sw.get(35, 36), null, 'nothing yet');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sw.get(35, 36), { windFromDeg: 270, windKt: 12 });
  assert.equal(calls.length, 1);
  now = 30_000;
  sw.get(35, 36);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1, 'inside the minute');
  now = 61_000;
  sw.get(35, 36);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 2);
  const failing = createShipWind({ grpcClient: { getAptWeather: async () => { throw new Error('down'); } }, wallNow: () => now });
  failing.get(1, 2);
  await new Promise((r) => setImmediate(r));
  assert.equal(failing.get(1, 2), null, 'a failed fetch is a warning, not a wind');
  sw.reset();
  assert.equal(sw.get(35, 36), null);
});

test('tanker values: side number and give have no default; the pattern defaults come from the tuning file', () => {
  const { store, set } = rig();
  const t = store.state().tanker;
  assert.deepEqual([t.sideNumber.value, t.give.value, t.altitude.value, t.patternSide.value, t.onStation.value], [null, null, 6000, 'port', false]);
  set('tankerSide', '701');
  set('tankerAltitude', 8000);
  set('tankerGive', 4);
  set('tankerOnStation', true);
  const u = store.state().tanker;
  assert.deepEqual([u.sideNumber.value, u.altitude.value, u.give.value, u.onStation.value], ['701', 8000, 4, true]);
  assert.equal(set('tankerGive', 'lots').ok, false);
});

test('the mission reset clears every override and the Case, and keeps the stack empty (ADR 0108)', () => {
  const { store, set } = rig();
  set('rampTime', '2040');
  set('case', 'II');
  assert.deepEqual(store.resetForMission(), ['CVN-72']);
  assert.deepEqual([store.state().rampTime.source, store.state().case.source], ['none', 'default']);
  assert.deepEqual(store.resetForMission(), [], 'already clear');
});

test('snapshot and restore keep the overrides and the Case and drop what no longer checks', () => {
  const { store, set } = rig();
  set('rampTime', '2040');
  set('tankerSide', '701');
  set('case', 'II');
  const snap = JSON.parse(JSON.stringify(store.snapshot()));
  snap[0].overrides.firstFixDme = 3; // out of range: dropped, not refused (a restart must come up)
  const again = new CarrierStore({ hulls: hullConfig.getHulls(), clock: { now: () => T0 } });
  again.restore(snap);
  assert.equal(again.state().rampTime.source, 'override');
  assert.equal(again.state().tanker.sideNumber.value, '701');
  assert.equal(again.state().firstFix.source, 'default');
  assert.equal(again.caseValue(), 'II');
});

test('the audit has a line per change, refusals included, naming the field, with the old and the new record', () => {
  const lines = [];
  const { set } = rig({ mutationLog: { record: (l) => lines.push(l) } });
  set('ceiling', 800);
  set('ceiling', -5);
  set('ceiling', 100, 'CV_APP1');
  set('ceiling', null);
  assert.deepEqual(lines.map((l) => [l.op, l.field, l.ok, l.reason, l.actingPositionId]), [
    ['SetCarrierState', 'ceiling', true, undefined, 'CV_PRIFLY'],
    ['SetCarrierState', 'ceiling', false, 'VALIDATION_ERROR', 'CV_PRIFLY'],
    ['SetCarrierState', 'ceiling', false, 'PERMISSION_DENIED', 'CV_APP1'],
    ['SetCarrierState', 'ceiling', true, undefined, 'CV_PRIFLY'],
  ]);
  assert.equal(lines[0].before.overrides.ceilingFt, null);
  assert.equal(lines[0].after.overrides.ceilingFt, 800);
  assert.equal(lines[0].carrierHullId, 'CVN-72');
  assert.equal(lines[3].after.overrides.ceilingFt, null);
});
