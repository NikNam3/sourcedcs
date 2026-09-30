'use strict';

/* The client forgets archived flights (docs/adr/0082, crc-sync's archiver):
   an efsp-board-delta's fdrs.gone removes the FDRs, strips.gone the Strips.
   Without it a client keeps every archived FDR until it reconnects. */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyEfspSnapshot, applyEfspDelta, getEfspFdr, getEfspStrip, getEfspBoardSeq, _resetEfspStateForTest,
} = require('../app/public/js/panels/efsp/efsp-state.js');

test.beforeEach(() => _resetEfspStateForTest());

test('applyEfspDelta: fdrs.gone removes archived FDRs, and leaves the rest', () => {
  applyEfspSnapshot({
    boardSeq: 4, strips: [{ stripId: 's1', fdrId: 'f1', state: 'PROPOSED' }],
    fdrs: [{ fdrId: 'f1' }, { fdrId: 'f2' }], positions: [],
  });
  // The archiver's delta: the Strip was already DROPPED, so its gone is a no-op
  // here; the ring advanced, so the seq moves.
  applyEfspDelta({ boardSeq: 5, strips: { updated: [], gone: ['s-archived'] }, fdrs: { updated: [], gone: ['f2'] }, positions: { updated: [] } });
  assert.equal(getEfspFdr('f2'), null);
  assert.ok(getEfspFdr('f1'));
  assert.ok(getEfspStrip('s1'));
  assert.equal(getEfspBoardSeq(), 5);
});

test('applyEfspDelta: a delta with no fdrs.gone (every other sender) removes nothing', () => {
  applyEfspSnapshot({ boardSeq: 1, strips: [], fdrs: [{ fdrId: 'f1' }], positions: [] });
  applyEfspDelta({ boardSeq: 2, strips: { updated: [], gone: [] }, fdrs: { updated: [] }, positions: { updated: [] } });
  assert.ok(getEfspFdr('f1'));
});
