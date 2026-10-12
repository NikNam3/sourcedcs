import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// The authority registry (S3-2, AUTH): its composed tables and accessors.
const require = createRequire(import.meta.url);
const authority = require('../src/efsp/authority');
const nla = require('../src/efsp/nla.js');
const permission = require('../src/efsp/permission.js');

test('every strip type family is a strip type of nla.js and carries every field', () => {
  assert.deepEqual(authority.stripTypeNames(), Object.keys(nla.STATES_BY_STRIP_TYPE));
  for (const stripType of authority.stripTypeNames()) {
    const f = authority.stripTypeFamily(stripType);
    assert.equal(f.states, nla.STATES_BY_STRIP_TYPE[stripType]);
    assert.ok(f.states.includes(f.initialState));
    assert.equal(typeof f.computeNla, 'function');
    assert.equal(permission.STATE_OWNERS_BY_STRIP_TYPE[stripType], f.stateOwners);
  }
  assert.equal(authority.stripTypeFamily('toString'), null);
});

test('accessors answer from the composed tables', () => {
  assert.deepEqual(authority.stateOwners('DEPARTURE', 'HELD'), ['CD', 'GC']);
  assert.deepEqual(authority.stateOwners('FINAL', 'ON_FINAL'), ['CV_APP1', 'CV_APP2', 'PAR']);
  assert.deepEqual(authority.stateOwners('NOPE', 'X'), []);
  assert.equal(authority.initialStateFor('MARSHAL'), 'IN_STACK');
  assert.equal(authority.replicaStateOnReceipt('OVERFLIGHT', 'IN_SECTOR'), 'INBOUND');
  assert.equal(authority.replicaStateOnReceipt('ARRIVAL', 'INBOUND'), 'INBOUND');
  assert.equal(authority.senderStateOnAccept('HANDOFF', 'OVERFLIGHT', 'IN_SECTOR'), 'HANDED_OFF');
  assert.equal(authority.senderStateOnAccept('HANDOFF', 'ARRIVAL', 'INBOUND'), undefined);
  assert.deepEqual(authority.creatorsOf('ARRIVAL'), ['AP', 'CTR']);
  assert.deepEqual(authority.creatorsOf('PATTERN'), ['RSU']);
  const ap = authority.capabilitiesFor('AP');
  assert.equal(ap.family, 'civil-atc');
  assert.equal(ap.capabilities.handsOffToFinal, true, 'incirlik-military extends AP');
  assert.equal(authority.capabilitiesFor('PAR').capabilities.receivesFinal, true);
  assert.equal(authority.capabilitiesFor('JTAC').capabilities.readScope, 'OWNED');
  assert.equal(authority.capabilitiesFor('NOBODY'), null);
});

test('the registry is sealed once loaded: a late family is a loud error', () => {
  assert.throws(() => authority.registerStripTypeFamily({ stripType: 'LATE' }), /sealed/);
  assert.throws(() => authority.registerPositionFamily({ family: 'late' }), /sealed/);
});
