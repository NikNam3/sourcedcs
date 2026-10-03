import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, digest, hashOf, renumberIds, summarize, extKeys, PROJECTION } from './freeze-lib.mjs';

// The grain of the goldens (docs/wip/FREEZE-GRAIN.md): what must NOT move a golden, and what must.
const U = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const strip = (o = {}) => ({ stripId: U(5), stripType: 'DEPARTURE', state: 'PROPOSED', ownerPositionId: 'OPS', bayId: 'b', rackId: 'main', orderKey: 'V', rev: 1, flightDataId: U(4), flags: { highlight: null }, updatedAt: 1, ...o });
const fdr = (o = {}) => ({ flightDataId: U(4), rev: 1, identity: { callsign: 'X1', beaconAssigned: null }, filed: { route: '' }, createdAt: 1, ...o });

test('ids are numbered by first appearance, not by raw value', () => {
  assert.equal(renumberIds(`${U(90)} ${U(7)} ${U(90)}`), '#1 #2 #1');
  assert.equal(renumberIds(`${U(91)} ${U(8)} ${U(91)}`), '#1 #2 #1');
  assert.equal(hashOf(strip()), hashOf(strip({ stripId: U(500), flightDataId: U(499) })));
});

test('an ext field, an empty new field and a volatile key move no hash', () => {
  assert.equal(hashOf(strip()), hashOf(strip({ updatedAt: 99, cid: '007', brandNew: 'x' })));
  assert.equal(hashOf(strip()), hashOf(strip({ flags: { highlight: null, newFlag: false } })));
  assert.equal(hashOf(fdr()), hashOf(fdr({ createdAt: 9, ato: { x: 1 }, clearance: { speed: { entries: [] } } })));
  assert.deepEqual(canonical({ boardEpoch: 'a', boardSeq: 3, marsaEpoch: 'b', futureEpoch: 'c', undoable: {}, k: 1 }), { k: 1 });
  assert.deepEqual(summarize({ boardSeq: 3, k: 1 }), { k: 1 });
});

test('a core field, a non-empty behavioural group value and rev still move the hash', () => {
  const base = hashOf(strip());
  for (const o of [{ state: 'ACTIVE' }, { ownerPositionId: 'APP' }, { bayId: 'c' }, { orderKey: 'W' }, { rev: 2 }, { flags: { highlight: 'yellow' } }, { coordination: { peer: 'x' } }]) assert.notEqual(hashOf(strip(o)), base, JSON.stringify(o));
  assert.notEqual(hashOf(fdr({ identity: { callsign: 'X2', beaconAssigned: null } })), hashOf(fdr()));
  assert.notEqual(hashOf(fdr({ rev: 2 })), hashOf(fdr()));
});

test('every promoted field is real, and ext is what is left', () => {
  assert.deepEqual(extKeys(strip(), 'strip'), ['updatedAt']);
  assert.ok(PROJECTION.strip.core.includes('rev') && PROJECTION.flightData.sparse.includes('identity'));
  assert.equal(digest('x'), digest('x'));
});
