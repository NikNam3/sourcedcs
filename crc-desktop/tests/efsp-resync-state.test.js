'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../app/public/js/panels/efsp/efsp-state.js');

const snap = () => ({
  facility: 'INCIRLIK', boardSeq: 5, boardSeqByFacility: { INCIRLIK: 5, CENTER: 2 },
  boardEpochByFacility: { INCIRLIK: 'e-I', CENTER: 'e-C' }, strips: [], fdrs: [], positions: [],
});
const delta = (o) => ({ type: 'efsp-board-delta', strips: { updated: [], gone: [] }, fdrs: { updated: [] }, positions: { updated: [] }, ...o });

test('seq and epoch are tracked per Facility: a CENTER delta does not move INCIRLIK', () => {
  S._resetEfspStateForTest();
  S.applyEfspSnapshot(snap());
  S.applyEfspDelta(delta({ facilityId: 'CENTER', boardSeq: 9, boardEpoch: 'e-C' }));
  assert.equal(S.efspResyncPositionFor('CENTER').lastBoardSeq, 9);
  assert.equal(S.efspResyncPositionFor('INCIRLIK').lastBoardSeq, 5);
  assert.equal(S.getEfspBoardSeq(), 5);
});

test('a delta from another epoch is flagged and its seq is not adopted', () => {
  S._resetEfspStateForTest();
  S.applyEfspSnapshot(snap());
  const d = delta({ facilityId: 'INCIRLIK', boardSeq: 1, boardEpoch: 'e-NEW' });
  assert.equal(S.efspEpochChangeOf(d), 'INCIRLIK');
  S.applyEfspDelta(d);
  assert.deepEqual(S.efspResyncPositionFor('INCIRLIK'), { facilityId: 'INCIRLIK', lastBoardSeq: 5, boardEpoch: 'e-I' });
  assert.equal(S.efspEpochChangeOf(delta({ facilityId: 'INCIRLIK', boardSeq: 6, boardEpoch: 'e-I' })), null);
  assert.equal(S.efspEpochChangeOf(delta({ facilityId: 'INCIRLIK', boardSeq: 6 })), null, 'a delta with no epoch (ATO import) is not a change');
});

test('an ack does not move the seq (its delta does); no Board held means no resync position', () => {
  S._resetEfspStateForTest();
  assert.equal(S.efspResyncPositionFor('INCIRLIK'), null);
  S.applyEfspSnapshot(snap());
  S.applyEfspMutationAck({ clientMutationId: 'a', ok: true, boardSeq: 8, boardEpoch: 'e-I', facilityId: 'INCIRLIK' });
  assert.equal(S.getEfspBoardSeq(), 5);
});

test('the heartbeat gap needs two beats in a row, and a matching beat resets it', () => {
  S._resetEfspStateForTest();
  S.applyEfspSnapshot(snap());
  assert.equal(S.efspHeartbeatGapOf({ boardSeq: 7 }), null);
  assert.equal(S.efspHeartbeatGapOf({ boardSeq: 5 }), null);
  assert.equal(S.efspHeartbeatGapOf({ boardSeq: 7 }), null);
  assert.equal(S.efspHeartbeatGapOf({ boardSeq: 7 }), 'INCIRLIK');
});
