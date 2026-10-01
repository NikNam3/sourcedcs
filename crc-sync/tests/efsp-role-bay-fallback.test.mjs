import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// A Role Bay (`holdsRole`, docs/adr/0087: app-overflight, ctr-overflight) takes its own Role's
// Strips and nobody else's. Before this file, `_bayForNewOwner`'s "first Bay implying no state"
// fallback and `bayForImpliedState`'s `bays[0]` fallback could both land a DEPARTURE or ARRIVAL there.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-role-bay-'));
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
const { crew, hold, act, mustAct, jumpTo, DEPARTURE_FDR } = await import('./helpers/efsp-scenario.mjs');

const ATC = { OPS: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER' };
const roleBayIds = (positionId, facilityId) => facilityConfig.getBaysFor(positionId, facilityId).filter(b => b.holdsRole).map(b => b.bayId);

test('the shipped Role Bays are where the audit looked', () => {
  assert.deepEqual(roleBayIds('APP', 'INCIRLIK'), ['app-overflight']);
  assert.deepEqual(roleBayIds('CTR', 'CENTER'), ['ctr-overflight']);
});

test('bayForImpliedState never falls back to a Role Bay', () => {
  for (const [pos, fac] of [['APP', 'INCIRLIK'], ['CTR', 'CENTER']]) {
    const bay = facilityConfig.bayForImpliedState(pos, 'NO_SUCH_STATE', fac);
    assert.ok(bay && !bay.holdsRole, `${pos}: ${bay && bay.bayId}`);
  }
});

test('SCENARIO TWR vacated: a LUAW DEPARTURE reassigned to APP lands in app-coordination, not app-overflight; and goes back on retake', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  let s = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign: 'RBF1', departureRunway: '05' } });
  s = jumpTo(efsp, c.OPS, 'OPS', s, 'RUNWAY_QUEUE');
  s = mustAct(efsp, c.OPS, 'OPS', s, { kind: 'TransferStrip', toPositionId: 'TWR', bayId: 'twr-runway-queue', rackId: 'rwy-05' });
  s = jumpTo(efsp, c.TWR, 'TWR', s, 'LUAW');

  hold(efsp, c.TWR.session, 'INCIRLIK', []);
  let at = efsp.boardStoreFor('INCIRLIK').getStrip(s.stripId);
  assert.equal(at.ownerPositionId, 'APP');
  assert.equal(at.bayId, 'app-coordination');

  hold(efsp, c.TWR.session, 'INCIRLIK', ['TWR']);
  at = efsp.boardStoreFor('INCIRLIK').getStrip(s.stripId);
  assert.equal(at.ownerPositionId, 'TWR');
  assert.notEqual(at.bayId, 'app-overflight');
});

test('a transfer routed to a covering APP, and a new owner at CTR with no matching Bay, never pick a Role Bay for another Role', () => {
  const efsp = createEfsp();
  for (const [facilityId, pos, state] of [['INCIRLIK', 'APP', 'LUAW'], ['INCIRLIK', 'APP', 'FINAL'], ['CENTER', 'CTR', 'LUAW'], ['CENTER', 'CTR', 'FINAL']]) {
    const store = efsp.boardStoreFor(facilityId);
    for (const role of ['DEPARTURE', 'ARRIVAL']) {
      const bay = store._bayForNewOwner(pos, state, { role });
      assert.ok(bay, `${pos} ${role}/${state}`);
      assert.ok(!roleBayIds(pos, facilityId).includes(bay.bayId), `${pos} ${role}/${state} -> ${bay.bayId}`);
    }
    const ovf = store._bayForNewOwner(pos, 'IN_SECTOR', { role: 'OVERFLIGHT' });
    assert.ok(roleBayIds(pos, facilityId).includes(ovf.bayId), `${pos} OVERFLIGHT -> ${ovf.bayId}`);
  }
});

test('a DEPARTURE cannot be dragged into a Role Bay; an OVERFLIGHT can still be moved within its own', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const dep = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign: 'RBF2' } });
  const bad = act(efsp, c.APP, 'APP', mustAct(efsp, c.OPS, 'OPS', dep, { kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-coordination', rackId: 'main' }), { kind: 'MoveStrip', bayId: 'app-overflight', rackId: 'main' });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'VALIDATION_ERROR');
  assert.match(bad.detail, /app-overflight holds OVERFLIGHT Strips only/);

  const ovf = mustAct(efsp, c.CTR, 'CTR', null, { kind: 'CreateStrip', bayId: 'ctr-overflight', rackId: 'main', role: 'OVERFLIGHT', fdr: { callsign: 'RBF3', aircraftType: 'A320', wakeCategory: 'M', originAirport: 'LTBA', destinationAirport: 'OJAI' } });
  const ok = act(efsp, c.CTR, 'CTR', ovf, { kind: 'MoveStrip', bayId: 'ctr-overflight', rackId: 'main' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
});
