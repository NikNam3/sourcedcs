import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// The authority registry (S3-2, AUTH): its composed tables and accessors.
const require = createRequire(import.meta.url);
const authority = require('../src/efsp/authority');
const nla = require('../src/efsp/nla.js');
const permission = require('../src/efsp/permission.js');

test('every Role family is a Role of nla.js and carries every field', () => {
  assert.deepEqual(authority.roleNames(), Object.keys(nla.STATES_BY_ROLE));
  for (const role of authority.roleNames()) {
    const f = authority.roleFamily(role);
    assert.equal(f.states, nla.STATES_BY_ROLE[role]);
    assert.ok(f.states.includes(f.initialState));
    assert.equal(typeof f.computeNla, 'function');
    assert.equal(permission.STATE_OWNERS_BY_ROLE[role], f.stateOwners);
  }
  assert.equal(authority.roleFamily('toString'), null);
});

test('accessors answer from the composed tables', () => {
  assert.deepEqual(authority.stateOwners('DEPARTURE', 'HELD'), ['CD', 'GND']);
  assert.deepEqual(authority.stateOwners('FINAL', 'ON_FINAL'), ['CV_APP1', 'CV_APP2', 'PAR']);
  assert.deepEqual(authority.stateOwners('NOPE', 'X'), []);
  assert.equal(authority.initialStateFor('MARSHAL'), 'IN_STACK');
  assert.equal(authority.replicaStateOnReceipt('OVERFLIGHT', 'IN_SECTOR'), 'INBOUND');
  assert.equal(authority.replicaStateOnReceipt('ARRIVAL', 'INBOUND'), 'INBOUND');
  assert.equal(authority.senderStateOnAccept('HANDOFF', 'OVERFLIGHT', 'IN_SECTOR'), 'HANDED_OFF');
  assert.equal(authority.senderStateOnAccept('HANDOFF', 'ARRIVAL', 'INBOUND'), undefined);
  assert.deepEqual(authority.creatorsOf('ARRIVAL'), ['APP', 'CTR']);
  assert.deepEqual(authority.creatorsOf('PATTERN'), ['RSU']);
  const app = authority.capabilitiesFor('APP');
  assert.equal(app.family, 'civil-atc');
  assert.equal(app.capabilities.rotatesSfa, true, 'incirlik-military extends APP');
  assert.equal(authority.capabilitiesFor('JTAC').capabilities.readScope, 'OWNED');
  assert.equal(authority.capabilitiesFor('NOBODY'), null);
});

test('the registry is sealed once loaded: a late family is a loud error', () => {
  assert.throws(() => authority.registerRoleFamily({ role: 'LATE' }), /sealed/);
  assert.throws(() => authority.registerPositionFamily({ family: 'late' }), /sealed/);
});
