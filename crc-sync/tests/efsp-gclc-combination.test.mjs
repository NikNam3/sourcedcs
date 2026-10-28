import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

// ADR 0105 (H104): a tower controller takes ground by combining; LC combined with GC/CD warns, never blocks; every Position
// carries its frequencies as data.

const require = createRequire(import.meta.url);
const schema = require('../src/efsp/facility-schema.js');
const { PositionStore } = require('../src/efsp/position-store.js');
const combination = require('../src/efsp/combination.js');
const CONFIG = path.join(import.meta.dirname, '../config');
const shipped = () => JSON.parse(fs.readFileSync(path.join(CONFIG, 'efsp-facility-incirlik.json'), 'utf8'));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-gclc-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');
const { createEfsp } = await import('../src/efsp/index.js');
const { crew, hold, act, mustAct, jumpTo, DEPARTURE_FLIGHT_DATA } = await import('./helpers/efsp-scenario.mjs');

const reject = (c, fragment) => {
  const r = schema.validateFacilityConfig(c);
  assert.equal(r.ok, false);
  assert.match(r.detail, new RegExp(fragment));
};

test('the shipped Incirlik config carries GC and LC frequencies (the offer lists are asserted in efsp-facility-config.test.mjs)', () => {
  const c = shipped();
  assert.deepEqual(Object.keys(c.positionFrequencies).sort(), ['GC', 'LC']);
  assert.deepEqual(schema.validateFacilityConfig(c, 'INCIRLIK'), { ok: true });
});

test('positionFrequencies is checked: known Position, array of { label, mhz }, isValidFrequency, unique labels, no extra keys', () => {
  const bad = (mutate, fragment) => { const c = shipped(); mutate(c.positionFrequencies); reject(c, fragment); };
  bad(f => { f.NOPE = []; }, 'unknown Position NOPE');
  bad(f => { f.GC = {}; }, 'must be an array');
  bad(f => { f.GC = [{ label: 'GND', mhz: 12 }]; }, 'mhz must be a number between 30 and 400');
  bad(f => { f.GC = [{ label: 'GND', mhz: '275.8' }]; }, 'mhz must be a number');
  bad(f => { f.GC = [{ label: '', mhz: 275.8 }]; }, 'label');
  bad(f => { f.GC = [{ label: 'A', mhz: 275.8 }, { label: 'A', mhz: 275.9 }]; }, 'repeats label A');
  bad(f => { f.GC = [{ label: 'A', mhz: 275.8, extra: 1 }]; }, 'unknown key extra');
  const ok = shipped(); delete ok.positionFrequencies;
  assert.deepEqual(schema.validateFacilityConfig(ok), { ok: true }, 'optional');
});

test('PositionStore carries frequencies and is combined-Position aware', () => {
  const store = new PositionStore(['GC', 'LC', 'AP'], { consolidation: { LC: ['AP'] } }, { frequencies: { GC: [{ label: 'GND', mhz: 275.8 }], LC: [{ label: 'TWR', mhz: 251 }] } });
  store.setSignedOnPositions('a', 'Alice', ['LC', 'GC']);
  assert.deepEqual(store.frequenciesHeldBy('a'), [{ positionId: 'LC', label: 'TWR', mhz: 251 }, { positionId: 'GC', label: 'GND', mhz: 275.8 }]
    .sort((x, y) => store.primaryPositionsOf('a').indexOf(x.positionId) - store.primaryPositionsOf('a').indexOf(y.positionId)));
  const all = Object.fromEntries(store.getAll().map(p => [p.positionId, p]));
  assert.deepEqual(all.LC.combinedWith, ['GC']);
  assert.deepEqual(all.GC.combinedWith, ['LC']);
  assert.deepEqual(all.AP.combinedWith, []);
  assert.deepEqual(all.GC.frequencies, [{ label: 'GND', mhz: 275.8 }]);
  assert.deepEqual(all.AP.frequencies, []);
  // An Observer has not taken the Position on.
  store.setSignedOnPositions('b', 'Bob', ['GC']);
  assert.deepEqual(store.frequenciesHeldBy('b'), []);
});

test('the positions ack names the combination and the frequencies to monitor; GC alone or LC alone is no combination', () => {
  const efsp = createEfsp({ currentTheater: () => 'Test' });
  const c = crew(efsp, { LC: 'INCIRLIK' });
  const lone = hold(efsp, c.LC.session, 'INCIRLIK', ['LC']).ack;
  assert.equal(lone.combination, null);
  assert.deepEqual(lone.monitoring.map(f => f.positionId), ['LC']);
  const both = hold(efsp, c.LC.session, 'INCIRLIK', ['LC', 'GC']).ack;
  assert.deepEqual(both.combination.positions, ['LC', 'GC']);
  assert.equal(both.combination.luaw, false);
  assert.deepEqual(both.monitoring.map(f => f.positionId).sort(), ['GC', 'LC']);
  assert.deepEqual(both.combination.frequencies.map(f => f.positionId).sort(), ['GC', 'LC']);
  const withCd = hold(efsp, c.LC.session, 'INCIRLIK', ['LC', 'CD']).ack;
  assert.deepEqual(withCd.combination.with, ['CD']);
  const gcCd = hold(efsp, c.LC.session, 'INCIRLIK', ['GC', 'CD']).ack;
  assert.equal(gcCd.combination, null, 'only LC with a non-local tower Position is the FAA rule');
});

test('the Positions the snapshot sends carry frequencies and combinedWith', () => {
  const efsp = createEfsp({ currentTheater: () => 'Test' });
  const c = crew(efsp, { LC: 'INCIRLIK' });
  const res = hold(efsp, c.LC.session, 'INCIRLIK', ['LC', 'GC']);
  const positions = res.broadcasts.flatMap(b => (b.positions && b.positions.updated) || []);
  const gc = positions.find(p => p.positionId === 'GC');
  assert.deepEqual(gc.combinedWith, ['LC']);
  assert.equal(gc.frequencies[0].label, 'GND');
});

test('LUAW while combined: the sign-on ack says luaw, and putting a Strip into LUAW warns and still succeeds', () => {
  const efsp = createEfsp({ currentTheater: () => 'Test' });
  const c = crew(efsp, { OPS: 'INCIRLIK', LC: 'INCIRLIK' });
  let s = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign: 'GCL1', departureRunway: '05' } });
  s = jumpTo(efsp, c.OPS, 'OPS', s, 'RUNWAY_QUEUE');
  s = mustAct(efsp, c.OPS, 'OPS', s, { kind: 'TransferStrip', toPositionId: 'LC', bayId: 'lc-runway-queue', rackId: 'rwy-05' });
  // Not combined: no warning.
  const plain = act(efsp, c.LC, 'LC', s, { kind: 'SetState', toState: 'LUAW' });
  assert.equal(plain.ok, true);
  assert.ok(!(plain.warnings || []).some(w => w.code === 'LUAW_WHILE_COMBINED'));
  // Combined: signing on warns more strongly (a Strip is at LUAW).
  assert.equal(hold(efsp, c.LC.session, 'INCIRLIK', ['LC', 'GC']).ack.combination.luaw, true);
  // And a second departure entering LUAW while combined carries the mutation warning.
  let t = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign: 'GCL2', departureRunway: '05' } });
  t = jumpTo(efsp, c.OPS, 'OPS', t, 'RUNWAY_QUEUE');
  t = mustAct(efsp, c.OPS, 'OPS', t, { kind: 'TransferStrip', toPositionId: 'LC', bayId: 'lc-runway-queue', rackId: 'rwy-05' });
  const warned = act(efsp, c.LC, 'LC', t, { kind: 'SetState', toState: 'LUAW' });
  assert.equal(warned.ok, true, 'never blocks');
  // B4: the op's own warning (no LC Bay for LUAW) and the combination one both arrive; the second no longer overwrites the first.
  assert.deepEqual(warned.warnings.map(w => w.code), ['NO_BAY_FOR_STATE', 'LUAW_WHILE_COMBINED']);
});

test('no offer when LC left GC itself, when GC has no Strips, or when nobody holds LC', () => {
  const efsp = createEfsp({ currentTheater: () => 'Test' });
  const c = crew(efsp, { OPS: 'INCIRLIK', GC: 'INCIRLIK' });
  const s = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign: 'GCL3' } });
  mustAct(efsp, c.OPS, 'OPS', s, { kind: 'TransferStrip', toPositionId: 'GC', bayId: 'gc-coordination', rackId: 'main' });
  assert.equal(hold(efsp, c.GC.session, 'INCIRLIK', []).directed, undefined, 'nobody at LC');
  hold(efsp, c.GC.session, 'INCIRLIK', ['GC']);
  hold(efsp, { controllerId: 'lc', who: 'LC' }, 'INCIRLIK', ['LC']);
  assert.equal(hold(efsp, { controllerId: 'lc', who: 'LC' }, 'INCIRLIK', ['LC', 'GC']).directed, undefined, 'taking GC as Observer sends no offer');
  assert.ok(combination.LUAW_STATES.includes('LUAW'));
});

test('an empty GC with LC staffed is offered to LC; CD is offered to the first staffed of GC, LC, AP (docs/adr/0110: GC is back on an offer list)', () => {
  const efsp = createEfsp({ currentTheater: () => 'Test' });
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK' });
  const positions = efsp.positionStoreFor('INCIRLIK');
  assert.equal(positions.consolidatedAt('GC'), null, 'nobody on LC or AP');
  crew(efsp, { LC: 'INCIRLIK' });
  assert.equal(positions.consolidatedAt('GC'), 'LC');
  assert.equal(positions.consolidatedAt('LC'), null, 'LC is staffed: AP is empty');
  assert.ok(c.CD);
});
