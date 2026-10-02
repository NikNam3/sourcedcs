import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../app/public/js/panels/efsp/efsp-state.js';

const snap = () => ({
  facilities: ['INCIRLIK', 'CENTER'], boardSeqByFacility: { INCIRLIK: 5, CENTER: 2 },
  boardEpochByFacility: { INCIRLIK: 'e-I', CENTER: 'e-C' }, strips: [], flightDataList: [], positions: [],
});
const delta = (o) => ({ type: 'efsp-board-delta', strips: { updated: [], gone: [] }, flightDataList: { updated: [] }, positions: { updated: [] }, ...o });

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

const beat = (I, C) => ({ type: 'efsp-heartbeat', boards: { INCIRLIK: { seq: I, epoch: 'e-I' }, CENTER: { seq: C, epoch: 'e-C' } } });

test('the heartbeat gap needs two beats in a row per Facility, and a matching beat resets it', () => {
  S._resetEfspStateForTest();
  S.applyEfspSnapshot(snap());
  assert.deepEqual(S.efspHeartbeatGapOf(beat(7, 2)), []);
  assert.deepEqual(S.efspHeartbeatGapOf(beat(5, 2)), []);
  assert.deepEqual(S.efspHeartbeatGapOf(beat(7, 2)), []);
  assert.deepEqual(S.efspHeartbeatGapOf(beat(7, 2)), ['INCIRLIK']);
});

test('a non-selected Facility behind is named, alone, and the other keeps its own count', () => {
  S._resetEfspStateForTest();
  S.applyEfspSnapshot(snap());
  assert.deepEqual(S.efspHeartbeatGapOf(beat(5, 4)), []);
  assert.deepEqual(S.efspHeartbeatGapOf(beat(5, 4)), ['CENTER']);
  assert.deepEqual(S.efspHeartbeatGapOf(beat(5, 2)), [], 'a matching beat resets');
});

test('a heartbeat epoch that differs from ours names that Facility at once; a Facility we hold no Board for is ignored', () => {
  S._resetEfspStateForTest();
  S.applyEfspSnapshot(snap());
  const b = { type: 'efsp-heartbeat', boards: { INCIRLIK: { seq: 5, epoch: 'e-I' }, CENTER: { seq: 2, epoch: 'e-NEW' }, TACTICAL: { seq: 9, epoch: 'e-T' } } };
  assert.deepEqual(S.efspHeartbeatGapOf(b), ['CENTER']);
});
