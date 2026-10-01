// UI-A: the minimal server hooks the client follow-up lane needs.
import test from 'node:test';
import assert from 'node:assert/strict';
import permission from '../src/efsp/permission.js';

test('U1 OPS records ORDNANCE (3G) on a departure whoever holds it, and nothing else of the kind', () => {
  const { mayActBesideOwner } = permission;
  const dep = { role: 'DEPARTURE', ownerPositionId: 'TWR', state: 'AIRBORNE' };
  assert.equal(mayActBesideOwner('OPS', dep, { kind: 'SetBlock', blockId: '3G' }), true);
  assert.equal(mayActBesideOwner('OPS', { ...dep, state: 'DROPPED' }, { kind: 'SetBlock', blockId: '3G' }), false);
  assert.equal(mayActBesideOwner('TWR', dep, { kind: 'SetBlock', blockId: '3G' }), false, 'ownership stays the rule for everyone else');
  assert.equal(mayActBesideOwner('OPS', dep, { kind: 'SetBlock', blockId: '3F' }), false);
});
