import { test } from 'node:test';
import assert from 'node:assert/strict';

// L14 (docs/adr/0071) — fdrStore.applyAtoTasking(), the one writer of what an
// ATO says about a flight: Mode 1/2 (read-only to ATC, D24 by construction),
// SCL, AR info, `fdr.ato`, the adopted Mode 3 (H64) and the seed provenance
// guard a re-import relies on.

const { FdrStore, WRITABLE_PATHS, MILITARY_WRITABLE_FIELDS } = await import('../src/efsp/fdr-store.js');
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
  const store = new FdrStore(alloc, { clock });
  const { fdr } = store.createFdr(SEED, { by: 'c1' });
  return { store, alloc, fdr };
}

test('applyAtoTasking writes Mode 1/2, SCL, AR info and fdr.ato with provenance ATO, bumping rev once', () => {
  const { store, fdr } = fresh();
  const rev = fdr.rev;
  const r = store.applyAtoTasking(fdr.fdrId, tasking(), { by: 'c1' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.fdr.rev, rev + 1);
  assert.equal(r.fdr.identity.modeOne, '12');
  assert.equal(r.fdr.identity.modeTwo, '0011');
  assert.deepEqual(r.fdr.military.scl, { primary: '402+', secondary: null });
  assert.deepEqual(r.fdr.military.arInfo.links, []);
  assert.equal(r.fdr.ato.missionNumber, '1101A');
  for (const p of ['identity.modeOne', 'identity.modeTwo', 'military.scl', 'military.arInfo', 'ato', 'mission.missionNumber', 'mission.vulWindowStartUtc', 'identity.callsign']) {
    assert.equal(r.fdr.provenance[p], 'ATO', p);
  }
});

test('applyAtoTasking refuses unknown keys and bad values, and writes nothing when it refuses', () => {
  const { store, fdr } = fresh();
  const before = JSON.stringify(store.getFdr(fdr.fdrId));
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
    const r = store.applyAtoTasking(fdr.fdrId, bad, { by: 'c1' });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.reason, 'VALIDATION_ERROR');
  }
  assert.equal(JSON.stringify(store.getFdr(fdr.fdrId)), before);
  assert.equal(store.applyAtoTasking('nope', tasking()).reason, 'NOT_FOUND');
});

test('D24 by construction: Mode 1/2 are in no writable list, and setField / setMilitary refuse them', () => {
  assert.equal(WRITABLE_PATHS.has('identity.modeOne'), false);
  assert.equal(WRITABLE_PATHS.has('identity.modeTwo'), false);
  assert.equal(MILITARY_WRITABLE_FIELDS.has('scl'), false);
  assert.equal(MILITARY_WRITABLE_FIELDS.has('arInfo'), false);
  const { store, fdr } = fresh();
  store.applyAtoTasking(fdr.fdrId, tasking(), { by: 'c1' });
  assert.equal(store.setField(fdr.fdrId, 'identity.modeOne', '77', { by: 'c2' }).ok, false);
  assert.equal(store.setField(fdr.fdrId, 'identity.modeTwo', '7777', { by: 'c2' }).ok, false);
  assert.equal(store.setField(fdr.fdrId, 'ato.iff.modeThree', '1234', { by: 'c2' }).ok, false);
  assert.equal(store.setMilitary(fdr.fdrId, { scl: 'X' }, { by: 'c2' }).ok, false);
  assert.equal(store.setMilitary(fdr.fdrId, { arInfo: null }, { by: 'c2' }).ok, false);
  assert.equal(store.getFdr(fdr.fdrId).identity.modeOne, '12');
});

test('H64: on a new flight the ATO Mode 3 is adopted and the minted code goes back to the pool', () => {
  const { store, alloc, fdr } = fresh();
  const minted = fdr.identity.beaconAssigned;
  const poolBefore = alloc.snapshot().length;
  const r = store.applyAtoTasking(fdr.fdrId, tasking(), { by: 'c1' });
  assert.equal(r.fdr.identity.beaconAssigned, '4521');
  assert.equal(r.fdr.provenance['identity.beaconAssigned'], 'ATO');
  assert.deepEqual({ adopted: r.beacon.adopted, released: r.beacon.released }, { adopted: true, released: minted });
  assert.equal(alloc.isAllocated(minted), false, 'T5: the minted code is released');
  assert.equal(alloc.holderOf('4521'), fdr.fdrId);
  assert.equal(alloc.snapshot().length, poolBefore, 'one code held per flight, no leak');
});

test('H64: a reserved or 6xxx ATO Mode 3 is refused by nothing — the minted code simply stays', () => {
  for (const code of ['7700', '6001']) {
    const { store, fdr } = fresh();
    const minted = fdr.identity.beaconAssigned;
    const r = store.applyAtoTasking(fdr.fdrId, tasking({ modeThree: code }), { by: 'c1' });
    assert.equal(r.ok, true);
    assert.equal(r.fdr.identity.beaconAssigned, minted);
    assert.equal(r.beacon.adopted, false);
    assert.equal(r.beacon.atoCode, code);
  }
});

test('H64: a duplicate ATO Mode 3 is adopted with a warning, never refused (D23)', () => {
  const { store, fdr } = fresh();
  const other = store.createFdr({ ...SEED, callsign: 'OTHER1' }, { by: 'c1' }).fdr;
  store.setBeaconAssigned(other.fdrId, '4521', { by: 'c1' });
  const r = store.applyAtoTasking(fdr.fdrId, tasking(), { by: 'c1' });
  assert.equal(r.beacon.adopted, true);
  assert.equal(r.beacon.warning, 'DUPLICATE_IGNORED_WARNING');
});

test('on a bind or an update the assigned code is never touched', () => {
  for (const mode of ['BIND', 'UPDATE']) {
    const { store, fdr } = fresh();
    const code = fdr.identity.beaconAssigned;
    const r = store.applyAtoTasking(fdr.fdrId, tasking({ mode }), { by: 'c1' });
    assert.equal(r.fdr.identity.beaconAssigned, code, mode);
    assert.equal(r.beacon, null);
    assert.equal(r.fdr.ato.iff.modeThree, '4521');
  }
});

test('alert status: ALERT only on a new flight; never on a bind or an update', () => {
  const a = fresh();
  assert.equal(a.store.applyAtoTasking(a.fdr.fdrId, tasking({ military: { scl: null, arInfo: null, alertStatus: 'ALERT' } })).fdr.military.alertStatus, 'ALERT');
  const b = fresh();
  assert.equal(b.store.applyAtoTasking(b.fdr.fdrId, tasking({ mode: 'BIND', military: { scl: null, arInfo: null, alertStatus: 'ALERT' } })).fdr.military.alertStatus, 'NONE');
});

test('the seed provenance guard: an update replaces ATO-owned values and keeps what a controller typed', () => {
  const { store, fdr } = fresh();
  store.applyAtoTasking(fdr.fdrId, tasking(), { by: 'c1' });
  store.setField(fdr.fdrId, 'mission.vulWindowStartUtc', 99, { by: 'c2' });
  const t = tasking({ mode: 'UPDATE' });
  t.seed['mission.vulWindowStartUtc'] = 5;
  t.seed['mission.vulWindowEndUtc'] = 6;
  const r = store.applyAtoTasking(fdr.fdrId, t, { by: 'c1' });
  assert.equal(r.fdr.mission.vulWindowStartUtc, 99, 'the controller\'s value stands');
  assert.equal(r.fdr.mission.vulWindowEndUtc, 6, 'the ATO\'s own value is replaced');
  assert.deepEqual(r.kept, [{ path: 'mission.vulWindowStartUtc', value: 99, atoValue: 5, ownedBy: 'CONTROLLER' }]);
});

test('a bind fills only what the flight has nothing for', () => {
  const alloc = new CodeAllocator();
  const store = new FdrStore(alloc, { clock });
  const filed = store.createFdr({ callsign: 'VIPER11', aircraftType: 'F16', flightSize: 4 }, { by: 'ops' }).fdr;
  const r = store.applyAtoTasking(filed.fdrId, tasking({ mode: 'BIND' }), { by: 'c1' });
  assert.equal(r.fdr.mission.missionNumber, '1101A');
  assert.equal(r.fdr.provenance['mission.missionNumber'], 'ATO');
  assert.equal(r.fdr.identity.aircraftType, 'F16', 'the filed type stands');
  assert.equal(r.fdr.identity.flightSize, 4);
  assert.deepEqual(r.kept.map((k) => [k.path, k.ownedBy]), [['identity.flightSize', 'FLIGHT'], ['identity.aircraftType', 'FLIGHT']]);
});
