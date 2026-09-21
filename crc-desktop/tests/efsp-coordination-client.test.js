'use strict';

/* WP4A (docs/adr/0015) — server/client drift guard for the coordination-
   primitive op-kind list, same template efsp-nla-client.test.js already
   uses for STATE_OWNERS_BY_ROLE: require() both sides, assert.deepEqual
   directly. A silent drift here would be misleading (a Coordinate button
   that offers a primitive the server doesn't grant, or omits one it does),
   not merely cosmetic. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { COORDINATION_OP_KINDS, COORDINATION_ELIGIBLE_STATES, TOFI_OP_KINDS } = require('../app/public/js/panels/efsp/efsp-nla.js');
const server = require('../../crc-sync/src/efsp/permission.js');
const serverCoordination = require('../../crc-sync/src/efsp/coordination.js');

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

// WP4A gap-closure (docs/adr/0022) — the client's proactive Coordinate-
// button gate must stay in lockstep with the server's authoritative
// eligibility check (board-store.js's _applyCoordinationPropose), or the
// button will either offer something the server rejects, or hide something
// it would actually allow.
test('the client mirror of COORDINATION_ELIGIBLE_STATES stays in lockstep with coordination.js\'s server copy', () => {
  assert.deepEqual(COORDINATION_ELIGIBLE_STATES, serverCoordination.COORDINATION_ELIGIBLE_STATES);
});

// WP4A second slice — TOFI (guide §4.6.3), a 6th op kind but NOT a 6th
// coordination primitive (see coordination.js's own module comment for why
// it needs a structurally separate table). Same drift-guard template.

test('the client mirror of TOFI_OP_KINDS stays in lockstep with permission.js\'s server copy', () => {
  assert.deepEqual(TOFI_OP_KINDS, server.TOFI_OP_KINDS);
});

test('TOFI never collides with any of the 5 coordination primitives, or any ordinary op kind', () => {
  const nonTofi = server.OP_KINDS.filter(k => !server.TOFI_OP_KINDS.includes(k));
  for (const kind of TOFI_OP_KINDS) {
    assert.equal(COORDINATION_OP_KINDS.includes(kind), false, kind);
    assert.equal(nonTofi.includes(kind), false, kind);
  }
});

// WP4A second slice gap-closure — TOFI gained a (role, state) eligibility
// gate of its own; same drift-guard template as COORDINATION_ELIGIBLE_STATES
// above, since a client mirror that drifts either offers a TOFI button the
// server will reject or hides one it would allow.
const { TOFI_ELIGIBLE_STATES } = require('../app/public/js/panels/efsp/efsp-nla.js');

test('the client mirror of TOFI_ELIGIBLE_STATES stays in lockstep with coordination.js\'s server copy', () => {
  assert.deepEqual(TOFI_ELIGIBLE_STATES, serverCoordination.TOFI_ELIGIBLE_STATES);
});

test('TOFI eligibility covers every airborne ATC-side Role, and never MISSION — the Role it creates', () => {
  assert.deepEqual(Object.keys(TOFI_ELIGIBLE_STATES).sort(), ['ARRIVAL', 'DEPARTURE', 'OVERFLIGHT']);
  assert.equal(TOFI_ELIGIBLE_STATES.MISSION, undefined);
});

// The RANGE slice — bay-view.js decides whether to offer the "Airspace…"
// button from a hard-coded list of Positions, mirroring permission.js's
// grant. Same drift risk as every other mirror here: a list that falls out
// of step either offers a button the server refuses or hides one it allows.
test('the Positions the client offers airspace entry to are exactly the ones the server grants it to', () => {
  const source = require('fs').readFileSync(require.resolve('../app/public/js/panels/efsp/bay-view.js'), 'utf8');
  const match = source.match(/const AIRSPACE_ENTRY_POSITIONS = (\[[^\]]*\])/);
  assert.ok(match, 'AIRSPACE_ENTRY_POSITIONS not found in bay-view.js');
  const clientPositions = JSON.parse(match[1].replace(/'/g, '"'));

  const granted = Object.keys(server.PERMISSIONS)
    .filter(id => server.AIRSPACE_ENTRY_OP_KINDS.every(k => server.PERMISSIONS[id].has(k)));
  assert.deepEqual(clientPositions.sort(), granted.sort());
});

test('a range Position works no Strips — the class refusal is a rule, not an absent table entry', () => {
  assert.ok(server.NO_STRIP_OP_CLASSES.has('USING_AGENCY'));
});
