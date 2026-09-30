import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRIGGER_TYPES, CARRIER_TRANSFERS, GUIDE_TRANSFER_KINDS, validateCarrierTransfer, laneFor, assignLanes,
} from '../src/efsp/carrier/transfers.js';
import { deriveStack } from '../src/efsp/carrier/marshal-stack.js';

// Guide §9.12: "Ownership transfers on the carrier are heterogeneous and MUST
// NOT be unified behind one button … Four different trigger types."
// docs/adr/0064.

test('the four §9.12 kinds have four distinct triggers and four distinct labels', () => {
  assert.equal(GUIDE_TRANSFER_KINDS.length, 4);
  const rows = GUIDE_TRANSFER_KINDS.map((k) => CARRIER_TRANSFERS[k]);
  assert.equal(new Set(rows.map((r) => r.trigger)).size, 4);
  assert.deepEqual(rows.map((r) => r.trigger).sort(), [...TRIGGER_TYPES].sort());
  assert.equal(new Set(rows.map((r) => r.label)).size, 4);
  for (const r of rows) assert.equal(r.source, '§9.12');
  assert.deepEqual(
    Object.fromEntries(GUIDE_TRANSFER_KINDS.map((k) => [k, CARRIER_TRANSFERS[k].trigger])),
    {
      MARSHAL_TO_APPROACH: 'CONTROLLER_INITIATED',
      APPROACH_TO_FINAL: 'RADAR_ACQUISITION',
      FINAL_TO_LSO: 'PILOT_BALL_CALL',
      MARSHAL_TO_PRIFLY: 'PILOT_SEE_YOU',
    },
  );
});

test('every row, including the [SOURCE-DEFINED] Case I row, has a distinct label and a known trigger', () => {
  const all = Object.values(CARRIER_TRANSFERS);
  assert.equal(new Set(all.map((r) => r.label)).size, all.length);
  for (const r of all) assert.ok(TRIGGER_TYPES.includes(r.trigger));
  assert.equal(CARRIER_TRANSFERS.MARSHAL_TO_PATTERN_CASE_I.source, '[SOURCE-DEFINED]');
  assert.ok(Object.isFrozen(CARRIER_TRANSFERS.MARSHAL_TO_APPROACH));
});

test('no transfer kind carries a frequency (SFA is L18)', () => {
  for (const r of Object.values(CARRIER_TRANSFERS)) {
    assert.equal(Object.keys(r).some((k) => /freq/i.test(k)), false);
  }
});

test('validateCarrierTransfer: the happy paths', () => {
  assert.equal(validateCarrierTransfer('MARSHAL_TO_APPROACH', { caseValue: 'III', fromPositionId: 'CV_MARSHAL', toPositionId: 'CV_APP2' }).ok, true);
  assert.equal(validateCarrierTransfer('APPROACH_TO_FINAL', { caseValue: 'II', fromPositionId: 'CV_APP1' }).ok, true);
  assert.equal(validateCarrierTransfer('APPROACH_TO_FINAL', { caseValue: 'II', fromPositionId: 'CV_APP1', toPositionId: 'CV_APP1' }).ok, true);
  assert.equal(validateCarrierTransfer('FINAL_TO_LSO', { caseValue: 'I', fromPositionId: 'CV_APP2' }).ok, true);
  assert.equal(validateCarrierTransfer('MARSHAL_TO_PRIFLY', { caseValue: 'II', fromPositionId: 'CV_MARSHAL', toPositionId: 'CV_PRIFLY' }).ok, true);
  assert.equal(validateCarrierTransfer('MARSHAL_TO_PATTERN_CASE_I', { caseValue: 'I', fromPositionId: 'CV_MARSHAL', toPositionId: 'CV_PRIFLY' }).ok, true);
});

test('validateCarrierTransfer refusals: unknown kind, wrong Case, wrong from/to, see-you outside Case II', () => {
  const refuse = (kind, ctx, re) => {
    const r = validateCarrierTransfer(kind, ctx);
    assert.equal(r.ok, false, `${kind} ${JSON.stringify(ctx)}`);
    assert.equal(r.reason, 'VALIDATION_ERROR');
    if (re) assert.match(r.detail, re);
  };
  refuse('HANDOFF', { caseValue: 'III', fromPositionId: 'CV_MARSHAL' }, /unknown/);
  refuse('toString', { caseValue: 'III', fromPositionId: 'CV_MARSHAL' }, /unknown/);
  refuse('MARSHAL_TO_APPROACH', { caseValue: 'I', fromPositionId: 'CV_MARSHAL', toPositionId: 'CV_APP1' }, /Case II\/III/);
  refuse('MARSHAL_TO_APPROACH', { caseValue: 'III', fromPositionId: 'CV_APP1', toPositionId: 'CV_APP2' }, /sent by CV_MARSHAL/);
  refuse('MARSHAL_TO_APPROACH', { caseValue: 'III', fromPositionId: 'CV_MARSHAL', toPositionId: 'CV_PRIFLY' }, /goes to CV_APP1 or CV_APP2/);
  refuse('APPROACH_TO_FINAL', { caseValue: 'III', fromPositionId: 'CV_APP1', toPositionId: 'CV_APP2' }, /stays with CV_APP1/);
  refuse('FINAL_TO_LSO', { caseValue: 'III', fromPositionId: 'CV_APP1', toPositionId: 'CV_PRIFLY' }, /LSO/);
  refuse('MARSHAL_TO_PRIFLY', { caseValue: 'III', fromPositionId: 'CV_MARSHAL', toPositionId: 'CV_PRIFLY' }, /Case II/);
  refuse('MARSHAL_TO_PRIFLY', { caseValue: 'I', fromPositionId: 'CV_MARSHAL', toPositionId: 'CV_PRIFLY' }, /Case II/);
  refuse('MARSHAL_TO_PATTERN_CASE_I', { caseValue: 'III', fromPositionId: 'CV_MARSHAL', toPositionId: 'CV_PRIFLY' });
  assert.equal(validateCarrierTransfer(undefined).ok, false, 'never throws');
});

test('laneFor alternates, falls back to the manned lane, and is null when neither is', () => {
  assert.equal(laneFor(0), 'CV_APP1');
  assert.equal(laneFor(1), 'CV_APP2');
  assert.equal(laneFor(2), 'CV_APP1');
  const onlyApp1 = { isOccupied: (p) => p === 'CV_APP1' };
  assert.equal(laneFor(1, onlyApp1), 'CV_APP1');
  assert.equal(laneFor(0, { isOccupied: (p) => p === 'CV_APP2' }), 'CV_APP2');
  assert.equal(laneFor(0, { isOccupied: () => false }), null);
  assert.equal(laneFor(0, { isOccupied: () => { throw new Error('x'); } }), null, 'never throws');
  assert.equal(laneFor(-1), null);
  assert.equal(laneFor(1.5), null);
});

test('assignLanes: HOLDING entries in push order; PUSHED entries count but are skipped; gaps do not count', () => {
  const stack = {
    stackId: 'MAIN', hullId: 'CVN-72', charlieTimeUtc: 0, marshalRadialDeg: null,
    entries: [
      { fdrId: 'a', stackIndex: 0, status: 'PUSHED', caseIAngels: null },
      { fdrId: 'b', stackIndex: 1, status: 'HOLDING', caseIAngels: null },
      { fdrId: 'c', stackIndex: 3, status: 'HOLDING', caseIAngels: null },
      { fdrId: 'd', stackIndex: 4, status: 'HOLDING', caseIAngels: null },
    ],
  };
  const lanes = assignLanes(deriveStack(stack, { caseValue: 'III' }));
  assert.deepEqual(lanes, [
    { fdrId: 'b', pushOrdinal: 1, lane: 'CV_APP2' },
    { fdrId: 'c', pushOrdinal: 2, lane: 'CV_APP1' },
    { fdrId: 'd', pushOrdinal: 3, lane: 'CV_APP2' },
  ]);
  assert.deepEqual(assignLanes(null), []);
});
