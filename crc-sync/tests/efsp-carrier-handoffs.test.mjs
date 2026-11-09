import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRIGGER_TYPES, CARRIER_HANDOFFS, validateCarrierHandoff, laneFor, assignLanes,
} from '../src/efsp/carrier/handoffs.js';
import { deriveStack } from '../src/efsp/carrier/marshal-stack.js';
import nla from '../src/efsp/nla.js';

// docs/adr/0156: the carrier handoffs, one row each, every one a controller gesture.

test('the ADR 0156 handoffs: the table, the buttons\' labels, nothing else', () => {
  assert.deepEqual(Object.keys(CARRIER_HANDOFFS).sort(), ['ABORT_TO_STACK', 'CASE_I_TO_PRIFLY', 'COMMENCE', 'DEPARTURE_TO_MARSHAL',
    'LAUNCH_TO_DEPARTURE', 'LAUNCH_TO_MARSHAL', 'RETURN_TO_STACK', 'TO_APPROACH']);
  const labels = Object.fromEntries(Object.entries(CARRIER_HANDOFFS).map(([k, r]) => [k, r.label]));
  assert.deepEqual(labels, {
    LAUNCH_TO_DEPARTURE: 'LAUNCHED', LAUNCH_TO_MARSHAL: 'TO MARSHAL', DEPARTURE_TO_MARSHAL: 'TO MARSHAL', COMMENCE: 'COMMENCE',
    TO_APPROACH: 'TO APPR', CASE_I_TO_PRIFLY: 'SGNL C', RETURN_TO_STACK: 'BACK TO STACK', ABORT_TO_STACK: 'ABORT TO CASE II/III',
  });
  for (const r of Object.values(CARRIER_HANDOFFS)) {
    assert.ok(TRIGGER_TYPES.includes(r.trigger));
    assert.ok(Object.isFrozen(r));
    assert.ok(nla.STATES_BY_STRIP_TYPE[r.stripType], r.label);
    for (const st of r.states) assert.ok(nla.STATES_BY_STRIP_TYPE[r.stripType].includes(st), `${r.label}/${st}`);
    assert.ok(nla.STATES_BY_STRIP_TYPE[r.toStripType].includes(r.toState), r.label);
    assert.equal(Object.keys(r).some((k) => /freq/i.test(k)), false, 'no handoff carries a frequency');
  }
  // A launch handed to the Marshal becomes the recovery in place.
  for (const k of ['LAUNCH_TO_MARSHAL', 'DEPARTURE_TO_MARSHAL']) {
    assert.deepEqual([CARRIER_HANDOFFS[k].stripType, CARRIER_HANDOFFS[k].toStripType, CARRIER_HANDOFFS[k].toState, CARRIER_HANDOFFS[k].stackEffect],
      ['CV_LAUNCH', 'CV_RECOVERY', 'STACK', 'APPEND'], k);
  }
  // Back to stack is not offered once the flight is at BULLSEYE or in the pattern.
  assert.deepEqual([...CARRIER_HANDOFFS.RETURN_TO_STACK.states], ['COMMENCED', 'FINAL_APPROACH', 'DIRTY']);
});

test('validateCarrierHandoff: whose Case each row reads, and who sends it to whom', () => {
  const ok = (kind, a) => assert.equal(validateCarrierHandoff(kind, a).ok, true, `${kind} ${JSON.stringify(a)}`);
  const refuse = (kind, a, re) => {
    const r = validateCarrierHandoff(kind, a);
    assert.equal(r.ok, false, `${kind} ${JSON.stringify(a)}`);
    assert.equal(r.reason, 'VALIDATION_ERROR');
    if (re) assert.match(r.detail, re);
  };
  ok('LAUNCH_TO_DEPARTURE', { shipCase: 'III', fromPositionId: 'CV_PRIFLY', toPositionId: 'CV_DEP' });
  ok('LAUNCH_TO_DEPARTURE', { shipCase: 'II', fromPositionId: 'CV_PRIFLY', toPositionId: 'CV_DEP' });
  refuse('LAUNCH_TO_DEPARTURE', { shipCase: 'I', fromPositionId: 'CV_PRIFLY', toPositionId: 'CV_DEP' }, /ship is in Case I/);
  ok('LAUNCH_TO_MARSHAL', { shipCase: 'I', fromPositionId: 'CV_PRIFLY', toPositionId: 'CV_MARSHAL' });
  refuse('LAUNCH_TO_MARSHAL', { shipCase: 'III', fromPositionId: 'CV_PRIFLY', toPositionId: 'CV_MARSHAL' });
  for (const c of ['I', 'II', 'III']) ok('DEPARTURE_TO_MARSHAL', { shipCase: c, fromPositionId: 'CV_DEP', toPositionId: 'CV_MARSHAL' });
  // A recovery reads the flight's Case, not the ship's.
  ok('COMMENCE', { shipCase: 'I', flightCase: 'III', fromPositionId: 'CV_MARSHAL' });
  refuse('COMMENCE', { shipCase: 'III', flightCase: 'I', fromPositionId: 'CV_MARSHAL' }, /flight is flying Case I/);
  ok('TO_APPROACH', { flightCase: 'II', fromPositionId: 'CV_MARSHAL', toPositionId: 'CV_APP2' });
  refuse('TO_APPROACH', { flightCase: 'II', fromPositionId: 'CV_MARSHAL', toPositionId: 'CV_PRIFLY' }, /goes to CV_APP1 or CV_APP2/);
  refuse('TO_APPROACH', { flightCase: 'III', fromPositionId: 'CV_APP1', toPositionId: 'CV_APP2' }, /sent by CV_MARSHAL/);
  ok('CASE_I_TO_PRIFLY', { shipCase: 'III', flightCase: 'I', fromPositionId: 'CV_MARSHAL', toPositionId: 'CV_PRIFLY' });
  for (const p of ['CV_MARSHAL', 'CV_APP1', 'CV_APP2']) ok('RETURN_TO_STACK', { flightCase: 'III', fromPositionId: p, toPositionId: 'CV_MARSHAL' });
  refuse('RETURN_TO_STACK', { flightCase: 'III', fromPositionId: 'CV_PRIFLY', toPositionId: 'CV_MARSHAL' });
  // Abort: a Case I flight, while the ship is in II or III.
  ok('ABORT_TO_STACK', { shipCase: 'II', flightCase: 'I', fromPositionId: 'CV_MARSHAL', toPositionId: 'CV_MARSHAL' });
  refuse('ABORT_TO_STACK', { shipCase: 'I', flightCase: 'I', fromPositionId: 'CV_MARSHAL', toPositionId: 'CV_MARSHAL' }, /ship is in Case I/);
  refuse('ABORT_TO_STACK', { shipCase: 'III', flightCase: 'III', fromPositionId: 'CV_MARSHAL', toPositionId: 'CV_MARSHAL' }, /Case I flight/);
  refuse('HANDOFF', { shipCase: 'III', fromPositionId: 'CV_MARSHAL' }, /unknown/);
  refuse('toString', { shipCase: 'III', fromPositionId: 'CV_MARSHAL' }, /unknown/);
  assert.equal(validateCarrierHandoff(undefined).ok, false, 'never throws');
});

test('laneFor alternates, falls back to the staffed lane, and is null when neither is', () => {
  assert.equal(laneFor(0), 'CV_APP1');
  assert.equal(laneFor(1), 'CV_APP2');
  assert.equal(laneFor(2), 'CV_APP1');
  const onlyApp1 = { isStaffed: (p) => p === 'CV_APP1' };
  assert.equal(laneFor(1, onlyApp1), 'CV_APP1');
  assert.equal(laneFor(0, { isStaffed: (p) => p === 'CV_APP2' }), 'CV_APP2');
  assert.equal(laneFor(0, { isStaffed: () => false }), null);
  assert.equal(laneFor(0, { isStaffed: () => { throw new Error('x'); } }), null, 'never throws');
  assert.equal(laneFor(-1), null);
  assert.equal(laneFor(1.5), null);
});

test('assignLanes: every entry in push order, a commenced one keeping its lane; gaps do not count', () => {
  const stack = {
    stackId: 'MAIN', hullId: 'CVN-72',
    entries: [
      { flightDataId: 'a', stackIndex: 0, status: 'PUSHED' },
      { flightDataId: 'b', stackIndex: 1, status: 'HOLDING' },
      { flightDataId: 'c', stackIndex: 3, status: 'HOLDING' },
      { flightDataId: 'd', stackIndex: 4, status: 'HOLDING' },
    ],
  };
  const lanes = assignLanes(deriveStack(stack, { caseValue: 'III' }));
  assert.deepEqual(lanes, [
    { flightDataId: 'a', pushOrdinal: 0, lane: 'CV_APP1' },
    { flightDataId: 'b', pushOrdinal: 1, lane: 'CV_APP2' },
    { flightDataId: 'c', pushOrdinal: 2, lane: 'CV_APP1' },
    { flightDataId: 'd', pushOrdinal: 3, lane: 'CV_APP2' },
  ]);
  assert.deepEqual(assignLanes(null), []);
});
