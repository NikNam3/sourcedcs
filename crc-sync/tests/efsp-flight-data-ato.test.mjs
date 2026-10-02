import { test } from 'node:test';
import assert from 'node:assert/strict';

// L14 (docs/adr/0071) — flightDataStore.applyAtoTasking(), the one writer of what an
// ATO says about a flight: Mode 1/2 (read-only to ATC, D24 by construction),
// SCL, AR info, `flightData.ato`, the adopted Mode 3 (H64) and the seed provenance
// guard a re-import relies on.

const { FlightDataStore, WRITABLE_PATHS, MILITARY_WRITABLE_FIELDS } = await import('../src/efsp/flight-data-store.js');
const { CodeAllocator } = await import('../src/efsp/code-allocator.js');

const clock = { now: () => Date.UTC(2016, 5, 21, 10, 0) };
const SEED = { callsign: 'VIPER11', flightSize: 2, aircraftType: 'F16C', missionNumber: '1101A', packageId: null, controllingAgency: 'MAGIC11', vulWindowStartUtc: 1, vulWindowEndUtc: 2 };

function tasking(over = {}) {
  return {
    mode: 'CREATE',
    identity: { modeOne: '12', modeTwo: '0011' },
    modeThree: '4521',
    military: { scl: { primary: '402+', secondary: null }, arInfo: { asReceiver: [], asTanker: null, links: [] }, alertStatus: 'NONE' },
    seed: {
      'mission.missionNumber': '1101A', 'mission.packageId': null, 'mission.controllingAgency': 'MAGIC11',
      'mission.vulWindowStartUtc': 1, 'mission.vulWindowEndUtc': 2, 'identity.flightSize': 2, 'identity.aircraftType': 'F16C',
    },
    ato: { lineId: '1101A#0', missionNumber: '1101A', iff: { modeThree: '4521' }, atoRef: { importId: 'i1' } },
    ...over,
  };
}

function fresh() {
  const alloc = new CodeAllocator();
  const store = new FlightDataStore(alloc, { clock });
  const { flightData } = store.createFlightData(SEED, { by: 'c1' });
  return { store, alloc, flightData };
}

test('applyAtoTasking writes Mode 1/2, SCL, AR info and flightData.ato with provenance ATO, bumping rev once', () => {
  const { store, flightData } = fresh();
  const rev = flightData.rev;
  const r = store.applyAtoTasking(flightData.flightDataId, tasking(), { by: 'c1' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.flightData.rev, rev + 1);
  assert.equal(r.flightData.identity.modeOne, '12');
  assert.equal(r.flightData.identity.modeTwo, '0011');
  assert.deepEqual(r.flightData.military.scl, { primary: '402+', secondary: null });
  assert.deepEqual(r.flightData.military.arInfo.links, []);
  assert.equal(r.flightData.ato.missionNumber, '1101A');
  for (const p of ['identity.modeOne', 'identity.modeTwo', 'military.scl', 'military.arInfo', 'ato', 'mission.missionNumber', 'mission.vulWindowStartUtc', 'identity.callsign']) {
    assert.equal(r.flightData.provenance[p], 'ATO', p);
  }
});

test('applyAtoTasking refuses unknown keys and bad values, and writes nothing when it refuses', () => {
  const { store, flightData } = fresh();
  const before = JSON.stringify(store.getFlightData(flightData.flightDataId));
  for (const bad of [
    { ...tasking(), extra: 1 },
    tasking({ mode: 'MERGE' }),
    tasking({ identity: { modeOne: '12', callsign: 'X' } }),
    tasking({ identity: { modeOne: '99' } }),
    tasking({ identity: { modeTwo: '12' } }),
    tasking({ modeThree: '8888' }),
    tasking({ military: { scl: null, fuelState: 3 } }),
    tasking({ military: { alertStatus: 'SCRAMBLE' } }),
    tasking({ seed: { 'filed.route': 'DCT' } }),
    tasking({ ato: null }),
  ]) {
    const r = store.applyAtoTasking(flightData.flightDataId, bad, { by: 'c1' });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.reason, 'VALIDATION_ERROR');
  }
  assert.equal(JSON.stringify(store.getFlightData(flightData.flightDataId)), before);
  assert.equal(store.applyAtoTasking('nope', tasking()).reason, 'NOT_FOUND');
});

test('D24 by construction: Mode 1/2 are in no writable list, and setField / setMilitary refuse them', () => {
  assert.equal(WRITABLE_PATHS.has('identity.modeOne'), false);
  assert.equal(WRITABLE_PATHS.has('identity.modeTwo'), false);
  assert.equal(MILITARY_WRITABLE_FIELDS.has('scl'), false);
  assert.equal(MILITARY_WRITABLE_FIELDS.has('arInfo'), false);
  const { store, flightData } = fresh();
  store.applyAtoTasking(flightData.flightDataId, tasking(), { by: 'c1' });
  assert.equal(store.setField(flightData.flightDataId, 'identity.modeOne', '77', { by: 'c2' }).ok, false);
  assert.equal(store.setField(flightData.flightDataId, 'identity.modeTwo', '7777', { by: 'c2' }).ok, false);
  assert.equal(store.setField(flightData.flightDataId, 'ato.iff.modeThree', '1234', { by: 'c2' }).ok, false);
  assert.equal(store.setMilitary(flightData.flightDataId, { scl: 'X' }, { by: 'c2' }).ok, false);
  assert.equal(store.setMilitary(flightData.flightDataId, { arInfo: null }, { by: 'c2' }).ok, false);
  assert.equal(store.getFlightData(flightData.flightDataId).identity.modeOne, '12');
});

test('H64: on a new flight the ATO Mode 3 is adopted and the minted code goes back to the pool', () => {
  const { store, alloc, flightData } = fresh();
  const minted = flightData.identity.beaconAssigned;
  const poolBefore = alloc.snapshot().length;
  const r = store.applyAtoTasking(flightData.flightDataId, tasking(), { by: 'c1' });
  assert.equal(r.flightData.identity.beaconAssigned, '4521');
  assert.equal(r.flightData.provenance['identity.beaconAssigned'], 'ATO');
  assert.deepEqual({ adopted: r.beacon.adopted, released: r.beacon.released }, { adopted: true, released: minted });
  assert.equal(alloc.isAllocated(minted), false, 'T5: the minted code is released');
  assert.equal(alloc.holderOf('4521'), flightData.flightDataId);
  assert.equal(alloc.snapshot().length, poolBefore, 'one code held per flight, no leak');
});

test('H64: a reserved or 6xxx ATO Mode 3 is refused by nothing — the minted code simply stays', () => {
  for (const code of ['7700', '6001']) {
    const { store, flightData } = fresh();
    const minted = flightData.identity.beaconAssigned;
    const r = store.applyAtoTasking(flightData.flightDataId, tasking({ modeThree: code }), { by: 'c1' });
    assert.equal(r.ok, true);
    assert.equal(r.flightData.identity.beaconAssigned, minted);
    assert.equal(r.beacon.adopted, false);
    assert.equal(r.beacon.atoCode, code);
  }
});

test('H64: a duplicate ATO Mode 3 is adopted with a warning, never refused (D23)', () => {
  const { store, flightData } = fresh();
  const other = store.createFlightData({ ...SEED, callsign: 'OTHER1' }, { by: 'c1' }).flightData;
  store.setBeaconAssigned(other.flightDataId, '4521', { by: 'c1' });
  const r = store.applyAtoTasking(flightData.flightDataId, tasking(), { by: 'c1' });
  assert.equal(r.beacon.adopted, true);
  assert.equal(r.beacon.warning, 'DUPLICATE_IGNORED_WARNING');
});

test('on a bind or an update the assigned code is never touched', () => {
  for (const mode of ['BIND', 'UPDATE']) {
    const { store, flightData } = fresh();
    const code = flightData.identity.beaconAssigned;
    const r = store.applyAtoTasking(flightData.flightDataId, tasking({ mode }), { by: 'c1' });
    assert.equal(r.flightData.identity.beaconAssigned, code, mode);
    assert.equal(r.beacon, null);
    assert.equal(r.flightData.ato.iff.modeThree, '4521');
  }
});

test('alert status: ALERT only on a new flight; never on a bind or an update', () => {
  const a = fresh();
  assert.equal(a.store.applyAtoTasking(a.flightData.flightDataId, tasking({ military: { scl: null, arInfo: null, alertStatus: 'ALERT' } })).flightData.military.alertStatus, 'ALERT');
  const b = fresh();
  assert.equal(b.store.applyAtoTasking(b.flightData.flightDataId, tasking({ mode: 'BIND', military: { scl: null, arInfo: null, alertStatus: 'ALERT' } })).flightData.military.alertStatus, 'NONE');
});

test('the seed provenance guard: an update replaces ATO-owned values and keeps what a controller typed', () => {
  const { store, flightData } = fresh();
  store.applyAtoTasking(flightData.flightDataId, tasking(), { by: 'c1' });
  // (a typed start must still lie before the end, S-L16 / UI-A: end is 2 here, so 1.5)
  store.setField(flightData.flightDataId, 'mission.vulWindowStartUtc', 1.5, { by: 'c2' });
  const t = tasking({ mode: 'UPDATE' });
  t.seed['mission.vulWindowStartUtc'] = 5;
  t.seed['mission.vulWindowEndUtc'] = 6;
  const r = store.applyAtoTasking(flightData.flightDataId, t, { by: 'c1' });
  assert.equal(r.flightData.mission.vulWindowStartUtc, 1.5, 'the controller\'s value stands');
  assert.equal(r.flightData.mission.vulWindowEndUtc, 6, 'the ATO\'s own value is replaced');
  assert.deepEqual(r.kept, [{ path: 'mission.vulWindowStartUtc', value: 1.5, atoValue: 5, ownedBy: 'CONTROLLER' }]);
});

test('a bind fills only what the flight has nothing for', () => {
  const alloc = new CodeAllocator();
  const store = new FlightDataStore(alloc, { clock });
  const filed = store.createFlightData({ callsign: 'VIPER11', aircraftType: 'F16', flightSize: 4 }, { by: 'ops' }).flightData;
  const r = store.applyAtoTasking(filed.flightDataId, tasking({ mode: 'BIND' }), { by: 'c1' });
  assert.equal(r.flightData.mission.missionNumber, '1101A');
  assert.equal(r.flightData.provenance['mission.missionNumber'], 'ATO');
  assert.equal(r.flightData.identity.aircraftType, 'F16', 'the filed type stands');
  assert.equal(r.flightData.identity.flightSize, 4);
  assert.deepEqual(r.kept.map((k) => [k.path, k.ownedBy]), [['identity.flightSize', 'FLIGHT'], ['identity.aircraftType', 'FLIGHT']]);
});
