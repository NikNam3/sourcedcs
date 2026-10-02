import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// A strip type Bay (`holdsStripType`, docs/adr/0087: ap-overflight, ctr-overflight) takes its own strip type's
// Strips and nobody else's. Before this file, `Placement#bayForNewOwner`'s "first Bay implying no state"
// fallback and `bayForImpliedState`'s `bays[0]` fallback could both land a DEPARTURE or ARRIVAL there.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-strip-type-bay-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');

const { createEfsp } = await import('../src/efsp/index.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const { crew, hold, act, mustAct, jumpTo, DEPARTURE_FLIGHT_DATA } = await import('./helpers/efsp-scenario.mjs');

const ATC = { OPS: 'INCIRLIK', GC: 'INCIRLIK', LC: 'INCIRLIK', AP: 'INCIRLIK', CTR: 'CENTER' };
const stripTypeBayIds = (positionId, facilityId) => facilityConfig.getBaysFor(positionId, facilityId).filter(b => b.holdsStripType).map(b => b.bayId);

test('the shipped Role Bays are where the audit looked', () => {
  assert.deepEqual(stripTypeBayIds('AP', 'INCIRLIK'), ['ap-overflight']);
  assert.deepEqual(stripTypeBayIds('CTR', 'CENTER'), ['ctr-overflight']);
});

test('bayForImpliedState never falls back to a Role Bay', () => {
  for (const [pos, fac] of [['AP', 'INCIRLIK'], ['CTR', 'CENTER']]) {
    const bay = facilityConfig.bayForImpliedState(pos, 'NO_SUCH_STATE', fac);
    assert.ok(bay && !bay.holdsStripType, `${pos}: ${bay && bay.bayId}`);
  }
});

test('SCENARIO TWR vacated: a LUAW DEPARTURE reassigned to APP lands in ap-coordination, not ap-overflight; and goes back on retake', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  let s = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign: 'RBF1', departureRunway: '05' } });
  s = jumpTo(efsp, c.OPS, 'OPS', s, 'RUNWAY_QUEUE');
  s = mustAct(efsp, c.OPS, 'OPS', s, { kind: 'TransferStrip', toPositionId: 'LC', bayId: 'lc-runway-queue', rackId: 'rwy-05' });
  s = jumpTo(efsp, c.LC, 'LC', s, 'LUAW');

  hold(efsp, c.LC.session, 'INCIRLIK', []);
  let at = efsp.boardStoreFor('INCIRLIK').getStrip(s.stripId);
  assert.equal(at.ownerPositionId, 'AP');
  assert.equal(at.bayId, 'ap-coordination');

  hold(efsp, c.LC.session, 'INCIRLIK', ['LC']);
  at = efsp.boardStoreFor('INCIRLIK').getStrip(s.stripId);
  assert.equal(at.ownerPositionId, 'LC');
  assert.notEqual(at.bayId, 'ap-overflight');
});

test('a transfer routed to a covering APP, and a new owner at CTR with no matching Bay, never pick a Role Bay for another Role', () => {
  const efsp = createEfsp();
  for (const [facilityId, pos, state] of [['INCIRLIK', 'AP', 'LUAW'], ['INCIRLIK', 'AP', 'FINAL'], ['CENTER', 'CTR', 'LUAW'], ['CENTER', 'CTR', 'FINAL']]) {
    const store = efsp.boardStoreFor(facilityId);
    for (const stripType of ['DEPARTURE', 'ARRIVAL']) {
      const bay = store._placement.bayForNewOwner(pos, state, { stripType });
      assert.ok(bay, `${pos} ${stripType}/${state}`);
      assert.ok(!stripTypeBayIds(pos, facilityId).includes(bay.bayId), `${pos} ${stripType}/${state} -> ${bay.bayId}`);
    }
    const ovf = store._placement.bayForNewOwner(pos, 'IN_SECTOR', { stripType: 'OVERFLIGHT' });
    assert.ok(stripTypeBayIds(pos, facilityId).includes(ovf.bayId), `${pos} OVERFLIGHT -> ${ovf.bayId}`);
  }
});

test('a DEPARTURE cannot be dragged into a Role Bay; an OVERFLIGHT can still be moved within its own', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const dep = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign: 'RBF2' } });
  const bad = act(efsp, c.AP, 'AP', mustAct(efsp, c.OPS, 'OPS', dep, { kind: 'TransferStrip', toPositionId: 'AP', bayId: 'ap-coordination', rackId: 'main' }), { kind: 'MoveStrip', bayId: 'ap-overflight', rackId: 'main' });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'VALIDATION_ERROR');
  assert.match(bad.detail, /ap-overflight holds OVERFLIGHT Strips only/);

  const ovf = mustAct(efsp, c.CTR, 'CTR', null, { kind: 'CreateStrip', bayId: 'ctr-overflight', rackId: 'main', stripType: 'OVERFLIGHT', flightData: { callsign: 'RBF3', aircraftType: 'A320', wakeCategory: 'M', originAirport: 'LTBA', destinationAirport: 'OJAI' } });
  const ok = act(efsp, c.CTR, 'CTR', ovf, { kind: 'MoveStrip', bayId: 'ctr-overflight', rackId: 'main' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
});
