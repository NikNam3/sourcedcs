/* Client copies of crc-sync rules that had no parity test (ARCH-C §1.5, ARCH-W §1.3 row 19): the "WITH AIC/JTAC" owner list,
   the combination Positions, the HANDOFF step actions, TOFI MARK_ENTERED eligibility and the Rack order. Each runs the
   server's own code or table against the client's, so a deliberate server change fails here and names the copy to update. */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { LINES_WITH_OTHERS, getEfspRack, applyEfspSnapshot, _resetEfspStateForTest } from '../app/public/js/panels/efsp/efsp-state.js';
import { LOCAL_POSITION, NON_LOCAL_TOWER } from '../app/public/js/panels/efsp/combination-rules.js';
import { handoffSteps, buildStepOp } from '../app/public/js/panels/efsp/control-release-rules.js';
import { _canMarkTofiEntered } from '../app/public/js/panels/efsp/bay/popovers/tofi.js';

const require = createRequire(import.meta.url);
const tactical = require('../../crc-sync/src/efsp/authority/positions/tactical.js');
const combination = require('../../crc-sync/src/efsp/combination.js');
const handoffControl = require('../../crc-sync/src/efsp/board/handoff-control.js');
const { Tofi } = require('../../crc-sync/src/efsp/board/tofi.js');
const { BoardState } = require('../../crc-sync/src/efsp/board/board-state.js');

test('LINES_WITH_OTHERS: a Position lists exactly the owners whose line it answers for or takes hand-backs from (ADR 0080)', () => {
  const owners = Object.keys(tactical.TACTICAL_CAPABILITIES);
  const targets = new Set(owners.flatMap(o => [...(tactical.handBackTargetsFor(o) || []), tactical.tofiAnswererFor(o)].filter(Boolean)));
  assert.deepEqual(Object.keys(LINES_WITH_OTHERS).sort(), [...targets].sort());
  for (const p of targets) {
    const server = owners.filter(o => (tactical.handBackTargetsFor(o) || []).includes(p) || tactical.tofiAnswererFor(o) === p);
    assert.deepEqual([...LINES_WITH_OTHERS[p]].sort(), server.sort(), p);
  }
});

test('combination-rules: LC and the non-local tower Positions are combination.js\'s', () => {
  assert.equal(LOCAL_POSITION, combination.LOCAL);
  assert.deepEqual([...NON_LOCAL_TOWER], [...combination.NON_LOCAL_TOWER]);
});

test('handoffSteps: every step it can offer is an action the server accepts, and every server action is offered somewhere', () => {
  const sides = {
    TRANSFERRING: ['CTR', { stripType: 'ARRIVAL', ownerPositionId: 'CTR' }],
    RECEIVING: ['AP', { stripType: 'ARRIVAL', ownerPositionId: 'AP' }],
  };
  const offered = new Set();
  for (const [side, [acting, base]] of Object.entries(sides)) {
    const receiving = side === 'RECEIVING';
    const variants = [
      {},
      { comms: { transferred: true } },
      { releaseRequest: { answer: null } },
      { release: { at: 1, withdrawnAt: null } },
      { control: { holder: 'RECEIVING' } },
    ];
    for (const v of variants) {
      const strip = { ...base, state: 'INBOUND', coordination: {
        primitive: 'HANDOFF', state: 'ACTIVE', peerPositionId: receiving ? 'CTR' : 'AP', mintedForCoordination: receiving,
        comms: { transferred: false }, control: { holder: 'TRANSFERRING' }, release: null, releaseRequest: null, ...v } };
      for (const step of handoffSteps(strip, acting)) {
        const op = buildStepOp(step.key);
        offered.add(op.action);
        const list = op.kind === 'HANDOFF' ? handoffControl.MARKS : handoffControl.RELEASE_ACTIONS;
        assert.ok(list.includes(op.action), `${side} ${step.key} -> ${op.kind}/${op.action}`);
      }
    }
  }
  for (const a of [...handoffControl.MARKS, ...handoffControl.RELEASE_ACTIONS]) assert.ok(offered.has(a), `the server accepts ${a}, no client step sends it`);
});

test('_canMarkTofiEntered agrees with Tofi._applyTofiMarkEntered on every combination of its preconditions', () => {
  for (const stripType of ['MISSION', 'ARRIVAL']) {
    for (const link of [null, { direction: 'ENTRY', state: 'ACTIVE' }, { direction: 'EXIT', state: 'ACTIVE' }, { direction: 'ENTRY', state: 'CLOSED' }]) {
      for (const pending of [null, 'IFR']) {
        _resetEfspStateForTest();
        const strip = { stripId: 'S', flightDataId: 'F', stripType, state: 'ACTIVE', tofiCoordination: link, rev: 1 };
        const flightData = { flightDataId: 'F', tofi: { pendingSeparationRegime: pending } };
        applyEfspSnapshot({ strips: [strip], flightDataList: [flightData], positions: [], facilities: ['INCIRLIK'], bays: [] });
        const fake = {
          _flightDataStore: { getFlightData: () => flightData },
          _rules: { regimeLocation: () => null, facilityId: 'TACTICAL' },
          _state: { bump() {} },
          markEntered: () => ({ ok: true, flightData, regime: pending, airspaceId: null }),
        };
        const server = Tofi.prototype._applyTofiMarkEntered.call(fake, strip, 'tester').ok;
        assert.equal(_canMarkTofiEntered(strip), server, `${stripType} ${JSON.stringify(link)} pending=${pending}`);
      }
    }
  }
});

test('getEfspRack orders and filters exactly as BoardState.rack does', () => {
  const strips = [
    { stripId: 'c', bayId: 'b', rackId: 'r', orderKey: 'B', state: 'ACTIVE' },
    { stripId: 'b', bayId: 'b', rackId: 'r', orderKey: 'A', state: 'ACTIVE' },
    { stripId: 'a', bayId: 'b', rackId: 'r', orderKey: 'A', state: 'ACTIVE' },
    { stripId: 'x', bayId: 'b', rackId: 'r', orderKey: 'A0', state: 'DROPPED' },
    { stripId: 'y', bayId: 'b', rackId: 'other', orderKey: 'A', state: 'ACTIVE' },
    { stripId: 'z', bayId: 'b2', rackId: 'r', orderKey: 'A', state: 'ACTIVE' },
    { stripId: 'd', bayId: 'b', rackId: 'r', orderKey: 'a', state: 'ACTIVE' },
  ];
  _resetEfspStateForTest();
  applyEfspSnapshot({ strips, flightDataList: [], positions: [], facilities: ['INCIRLIK'], bays: [] });
  const server = BoardState.prototype.rack.call({ all: () => strips.map(s => ({ ...s })) }, 'b', 'r').map(s => s.stripId);
  assert.deepEqual(getEfspRack('b', 'r').map(s => s.stripId), server);
  assert.equal(server.length, 4, 'the fixture keeps four live Strips of b/r');
});
