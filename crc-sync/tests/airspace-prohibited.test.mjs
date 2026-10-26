import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { makeRegistry, stateOp, MOA, SQUARE } from './helpers/airspace-registry.mjs';

// docs/adr/0144 (H171 SUA-Q5 a): a prohibited area is always in force. No schedule, no activation, no release; it alerts
// whenever an aircraft is inside without an approved entry, and its controlling Position stays only so the alert reaches
// someone (JO 7400.2R para 22-1-4 "continuous"; 14 CFR 73.83).

const require = createRequire(import.meta.url);
const schema = require('../src/efsp/airspace-schema.js');

const P = { airspaceId: 'P-1', name: 'Prohibited 1', type: 'PROHIBITED', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP', usingPositionId: 'RANGE_1_CONTROL', geometry: SQUARE };
const WINDOW = { fromUtc: Date.UTC(2026, 0, 1, 12, 0), toUtc: Date.UTC(2026, 0, 1, 14, 0) };

test('always in force: the schema rule, and the store answers every in-force query for it while RETURNED', () => {
  assert.deepEqual(schema.ALWAYS_IN_FORCE_TYPES, ['PROHIBITED']);
  assert.equal(schema.isAlwaysInForce(P), true);
  assert.equal(schema.isAlwaysInForce({ ...P, type: 'RESTRICTED' }), false);
  assert.equal(schema.isAlwaysInForce({ ...P, kind: 'ROUTE', type: 'IR' }), false);
  const { store } = makeRegistry({ defs: [P, { ...MOA, geometry: SQUARE }] });
  assert.equal(store.getAirspace('P-1').state, 'RETURNED', 'the record never leaves RETURNED');
  assert.equal(store.isActive('P-1'), true);
  assert.equal(store.isActive('MOA-1'), false, 'a MOA is in force only while ACTIVE');
  assert.deepEqual(store.activeAreasContaining({ lat: 36.5, lon: 35.5, altFt: 5000 }).map(a => [a.airspaceId, a.type, a.controllingPositionId]), [['P-1', 'PROHIBITED', 'AP']]);
});

test('every state op on a prohibited area is refused, before any write; definition edits stay open', () => {
  const { store } = makeRegistry({ defs: [P] });
  const rev = store.getAirspace('P-1').rev;
  for (const [kind, pos, extra] of [['ScheduleAirspace', 'AP', WINDOW], ['ScheduleAirspace', 'RANGE_1_CONTROL', WINDOW], ['RequestActivation', 'RANGE_1_CONTROL'],
    ['ApproveActivation', 'AP'], ['DenyActivation', 'AP'], ['ReleaseAirspace', 'RANGE_1_CONTROL'], ['ReturnAirspace', 'AP']]) {
    const r = stateOp(store, 'P-1', { kind, ...(extra || {}) }, pos);
    assert.equal(r.reason, 'VALIDATION_ERROR', kind);
    assert.match(r.detail, /always in force, never scheduled, activated or released/, kind);
  }
  assert.equal(store.getAirspace('P-1').rev, rev, 'nothing was written');
  assert.deepEqual(store.getAirspace('P-1').transitions, []);
  const t = stateOp(store, 'P-1', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP');
  assert.match(t.detail, /MOA, warning or restricted area only/, 'no transit (para 21-1-8 c)');
});

test('restore refuses a prohibited area carrying a lifecycle (no migration), naming it', () => {
  const { store } = makeRegistry({ defs: [P] });
  const snap = JSON.parse(JSON.stringify(store.snapshot()));
  const again = () => makeRegistry({ defs: [] }).store;
  again().restore(JSON.parse(JSON.stringify(snap)));
  const rec = snap.byTheater.Test.find(r => r.airspaceId === 'P-1');
  rec.state = 'ACTIVE';
  assert.throws(() => again().restore(snap), /prohibited airspace P-1 \(theater Test\) at ACTIVE/);
});
