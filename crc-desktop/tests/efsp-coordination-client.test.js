'use strict';

/* WP4A (docs/adr/0015) — server/client drift guard for the coordination-
   primitive op-kind list, same template efsp-nla-client.test.js already
   uses for STATE_OWNERS_BY_ROLE: require() both sides, assert.deepEqual
   directly. A silent drift here would be misleading (a Coordinate button
   that offers a primitive the server doesn't grant, or omits one it does),
   not merely cosmetic. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { COORDINATION_OP_KINDS } = require('../app/public/js/panels/efsp/efsp-nla.js');
const server = require('../../crc-sync/src/efsp/permission.js');

test('the client mirror of the 5 coordination primitives stays in lockstep with permission.js\'s COORDINATION_OP_KINDS', () => {
  assert.deepEqual(COORDINATION_OP_KINDS, server.COORDINATION_OP_KINDS);
});

test('it is exactly the 5 primitives guide §4.6 names, nothing else', () => {
  assert.deepEqual([...COORDINATION_OP_KINDS].sort(), ['AIT', 'HANDOFF', 'OPERATIONAL_REQUEST', 'POINT_OUT', 'TRAFFIC'].sort());
});

test('none of the 5 collide with an ordinary op kind (OP_KINDS minus the coordination ones)', () => {
  const nonCoordination = server.OP_KINDS.filter(k => !server.COORDINATION_OP_KINDS.includes(k));
  for (const primitive of COORDINATION_OP_KINDS) {
    assert.equal(nonCoordination.includes(primitive), false, primitive);
  }
});
