
/* The client forgets archived flights (docs/adr/0082, crc-sync's archiver):
   an efsp-board-delta's flightDataList.gone removes the flight-data records, strips.gone the Strips.
   Without it a client keeps every archived flight-data record until it reconnects. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyEfspSnapshot, applyEfspDelta, getEfspFlightData, getEfspStrip, getEfspBoardSeq, _resetEfspStateForTest,
} from '../app/public/js/panels/efsp/efsp-state.js';

test.beforeEach(() => _resetEfspStateForTest());

test('applyEfspDelta: flightDataList.gone removes archived FDRs, and leaves the rest', () => {
  applyEfspSnapshot({
    boardSeq: 4, strips: [{ stripId: 's1', flightDataId: 'f1', state: 'PROPOSED' }],
    flightDataList: [{ flightDataId: 'f1' }, { flightDataId: 'f2' }], positions: [],
  });
  // The archiver's delta: the Strip was already DROPPED, so its gone is a no-op
  // here; the ring advanced, so the seq moves.
  applyEfspDelta({ boardSeq: 5, strips: { updated: [], gone: ['s-archived'] }, flightDataList: { updated: [], gone: ['f2'] }, positions: { updated: [] } });
  assert.equal(getEfspFlightData('f2'), null);
  assert.ok(getEfspFlightData('f1'));
  assert.ok(getEfspStrip('s1'));
  assert.equal(getEfspBoardSeq(), 5);
});

test('applyEfspDelta: a delta with no flightDataList.gone (every other sender) removes nothing', () => {
  applyEfspSnapshot({ boardSeq: 1, strips: [], flightDataList: [{ flightDataId: 'f1' }], positions: [] });
  applyEfspDelta({ boardSeq: 2, strips: { updated: [], gone: [] }, flightDataList: { updated: [] }, positions: { updated: [] } });
  assert.ok(getEfspFlightData('f1'));
});
