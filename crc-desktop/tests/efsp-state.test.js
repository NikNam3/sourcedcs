'use strict';

/* Unit tests for the pure client-side EFSP state mirror (efsp-state.js) —
   snapshot/delta/ack merge logic and the pending-mutation/rebase-on-reject
   bookkeeping, exercised directly without DOM/Electron/network, same
   pattern as los-math.test.js. */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyEfspSnapshot, applyEfspDelta, applyEfspMutationAck,
  registerPendingMutation, getPendingMutations, rebaseForResend,
  getEfspStrip, getEfspFdr, getEfspPosition, getAllEfspStrips, getAllEfspPositions,
  getEfspRack, searchEfspStrips, getEfspBoardSeq, getEfspFacility, getEfspBays,
  _resetEfspStateForTest,
} = require('../app/public/js/panels/efsp/efsp-state.js');

function strip(overrides = {}) {
  return { stripId: 's1', fdrId: 'f1', rev: 1, bayId: 'b1', rackId: 'r1', orderKey: 'A', state: 'PROPOSED', ...overrides };
}

test.beforeEach(() => _resetEfspStateForTest());

test('applyEfspSnapshot populates strips/fdrs/positions and boardSeq/facility/bays', () => {
  applyEfspSnapshot({
    boardSeq: 5, facility: 'INCIRLIK',
    strips: [strip()], fdrs: [{ fdrId: 'f1' }], positions: [{ positionId: 'OPS' }],
    bays: [{ bayId: 'b1' }],
  });
  assert.equal(getEfspBoardSeq(), 5);
  assert.equal(getEfspFacility(), 'INCIRLIK');
  assert.deepEqual(getEfspStrip('s1'), strip());
  assert.ok(getEfspFdr('f1'));
  assert.ok(getEfspPosition('OPS'));
  assert.deepEqual(getEfspBays(), [{ bayId: 'b1' }]);
});

test('applyEfspSnapshot replaces prior state wholesale, not merges', () => {
  applyEfspSnapshot({ boardSeq: 1, strips: [strip({ stripId: 'old' })], fdrs: [], positions: [] });
  applyEfspSnapshot({ boardSeq: 2, strips: [strip({ stripId: 'new' })], fdrs: [], positions: [] });
  assert.equal(getEfspStrip('old'), null);
  assert.ok(getEfspStrip('new'));
  assert.equal(getAllEfspStrips().length, 1);
});

test('applyEfspDelta updates changed strips and removes gone ones, leaving others untouched', () => {
  applyEfspSnapshot({ boardSeq: 1, strips: [strip({ stripId: 's1' }), strip({ stripId: 's2' })], fdrs: [], positions: [] });
  applyEfspDelta({ boardSeq: 2, strips: { updated: [strip({ stripId: 's1', rev: 2 })], gone: ['s2'] }, fdrs: { updated: [] }, positions: { updated: [] } });

  assert.equal(getEfspStrip('s1').rev, 2);
  assert.equal(getEfspStrip('s2'), null);
  assert.equal(getEfspBoardSeq(), 2);
});

test('applyEfspDelta updates FDRs and Positions too', () => {
  applyEfspDelta({ boardSeq: 1, strips: { updated: [], gone: [] }, fdrs: { updated: [{ fdrId: 'f1', rev: 3 }] }, positions: { updated: [{ positionId: 'GND', primary: null }] } });
  assert.equal(getEfspFdr('f1').rev, 3);
  assert.equal(getAllEfspPositions().length, 1);
});

test('applyEfspDelta with a non-finite boardSeq leaves the current one unchanged', () => {
  applyEfspSnapshot({ boardSeq: 7, strips: [], fdrs: [], positions: [] });
  applyEfspDelta({ strips: { updated: [], gone: [] }, fdrs: { updated: [] }, positions: { updated: [] } });
  assert.equal(getEfspBoardSeq(), 7);
});

// ── applyEfspMutationAck ─────────────────────────────────────────────────

test('a successful ack applies the returned strip/fdr and clears the pending entry', () => {
  registerPendingMutation({ clientMutationId: 'm1', stripId: 's1', baseRev: 1, op: { kind: 'SetFlag' } });
  const result = applyEfspMutationAck({ clientMutationId: 'm1', ok: true, boardSeq: 2, strip: strip({ rev: 2 }) });

  assert.equal(result.wasPending, true);
  assert.equal(result.ok, true);
  assert.equal(getEfspStrip('s1').rev, 2);
  assert.equal(getPendingMutations().length, 0);
});

test('a REJECTED ack still applies the server\'s current strip (snap-back), not just on success', () => {
  registerPendingMutation({ clientMutationId: 'm1', stripId: 's1', baseRev: 1, op: { kind: 'SetFlag' } });
  const result = applyEfspMutationAck({ clientMutationId: 'm1', ok: false, reason: 'STALE_REV', boardSeq: 3, strip: strip({ rev: 3, state: 'CLEARED' }) });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'STALE_REV');
  assert.equal(getEfspStrip('s1').rev, 3);
  assert.equal(getEfspStrip('s1').state, 'CLEARED'); // server truth, not whatever the optimistic local guess was
});

test('a rejection\'s human-readable detail is surfaced through the return value, not just the bare reason code', () => {
  const result = applyEfspMutationAck({
    clientMutationId: 'm1', ok: false, reason: 'VALIDATION_ERROR',
    detail: 'dropping here would set state to CLEARED, but the only valid next state from PROPOSED is PENDING_CLEARANCE',
    strip: strip(),
  });
  assert.equal(result.reason, 'VALIDATION_ERROR');
  assert.match(result.detail, /only valid next state/);
});

test('an ack for a clientMutationId that was never registered as pending still applies cleanly (wasPending:false)', () => {
  const result = applyEfspMutationAck({ clientMutationId: 'unknown', ok: true, strip: strip() });
  assert.equal(result.wasPending, false);
  assert.equal(result.ok, true);
  assert.ok(getEfspStrip('s1'));
});

test('a warning on the ack is surfaced through the return value', () => {
  const result = applyEfspMutationAck({ clientMutationId: 'm1', ok: true, warning: 'DUPLICATE_IGNORED_WARNING', strip: strip() });
  assert.equal(result.warning, 'DUPLICATE_IGNORED_WARNING');
});

// ── Pending mutations / rebase-on-reject (§5.6.3) ───────────────────────────

test('registerPendingMutation tracks a sent-but-unacked mutation until its ack clears it', () => {
  registerPendingMutation({ clientMutationId: 'm1', stripId: 's1', baseRev: 1, op: {} });
  registerPendingMutation({ clientMutationId: 'm2', stripId: 's2', baseRev: 1, op: {} });
  assert.equal(getPendingMutations().length, 2);
});

test('rebaseForResend rebuilds baseRev against the current local Strip', () => {
  applyEfspSnapshot({ boardSeq: 1, strips: [strip({ rev: 5 })], fdrs: [], positions: [] });
  registerPendingMutation({ clientMutationId: 'm1', stripId: 's1', baseRev: 1, op: { kind: 'SetFlag', flag: 'offset', value: true } });

  const rebased = rebaseForResend('m1');
  assert.equal(rebased.baseRev, 5);
  assert.equal(rebased.stripId, 's1');
  assert.deepEqual(rebased.op, { kind: 'SetFlag', flag: 'offset', value: true });
});

test('rebaseForResend returns null when the target Strip no longer exists locally', () => {
  registerPendingMutation({ clientMutationId: 'm1', stripId: 'does-not-exist', baseRev: 1, op: {} });
  assert.equal(rebaseForResend('m1'), null);
});

test('rebaseForResend returns null for a CreateStrip mutation (no stripId to rebase against)', () => {
  registerPendingMutation({ clientMutationId: 'm1', op: { kind: 'CreateStrip' } });
  assert.equal(rebaseForResend('m1'), null);
});

test('rebaseForResend returns null for an unknown clientMutationId', () => {
  assert.equal(rebaseForResend('never-registered'), null);
});

// ── getEfspRack ──────────────────────────────────────────────────────────

test('getEfspRack filters by bay/rack, excludes DROPPED, and sorts by orderKey', () => {
  applyEfspSnapshot({
    boardSeq: 1,
    strips: [
      strip({ stripId: 's1', bayId: 'b1', rackId: 'r1', orderKey: 'B' }),
      strip({ stripId: 's2', bayId: 'b1', rackId: 'r1', orderKey: 'A' }),
      strip({ stripId: 's3', bayId: 'b1', rackId: 'r1', orderKey: 'C', state: 'DROPPED' }),
      strip({ stripId: 's4', bayId: 'b2', rackId: 'r1', orderKey: 'A' }), // different bay
    ],
    fdrs: [], positions: [],
  });
  const rack = getEfspRack('b1', 'r1');
  assert.deepEqual(rack.map(s => s.stripId), ['s2', 's1']);
});

// ── searchEfspStrips (guide §4.3 rule 2, defect D2) ─────────────────────

function fdr(overrides = {}) {
  return { fdrId: 'f1', identity: { callsign: 'VIPER1', beaconAssigned: '1234', ...overrides.identity } };
}

test('searchEfspStrips matches callsign, case-insensitively', () => {
  applyEfspSnapshot({ boardSeq: 1, strips: [strip({ fdrId: 'f1' })], fdrs: [fdr()], positions: [] });
  assert.deepEqual(searchEfspStrips('viper').map(s => s.stripId), ['s1']);
  assert.deepEqual(searchEfspStrips('VIPER1').map(s => s.stripId), ['s1']);
});

test('searchEfspStrips matches beacon code as a substring', () => {
  applyEfspSnapshot({ boardSeq: 1, strips: [strip({ fdrId: 'f1' })], fdrs: [fdr()], positions: [] });
  assert.deepEqual(searchEfspStrips('234').map(s => s.stripId), ['s1']);
});

test('searchEfspStrips with an empty or whitespace-only query returns no results, not everything', () => {
  applyEfspSnapshot({ boardSeq: 1, strips: [strip({ fdrId: 'f1' })], fdrs: [fdr()], positions: [] });
  assert.deepEqual(searchEfspStrips(''), []);
  assert.deepEqual(searchEfspStrips('   '), []);
  assert.deepEqual(searchEfspStrips(undefined), []);
});

test('searchEfspStrips excludes DROPPED Strips, same as getEfspRack', () => {
  applyEfspSnapshot({ boardSeq: 1, strips: [strip({ fdrId: 'f1', state: 'DROPPED' })], fdrs: [fdr()], positions: [] });
  assert.deepEqual(searchEfspStrips('viper'), []);
});

test('searchEfspStrips finds a Strip regardless of which Bay/Rack it currently sits in — it\'s a second view onto the same live data, not a re-parent', () => {
  applyEfspSnapshot({
    boardSeq: 1,
    strips: [strip({ stripId: 's1', fdrId: 'f1', bayId: 'cd-held', rackId: 'main' })],
    fdrs: [fdr()], positions: [],
  });
  const [result] = searchEfspStrips('viper');
  assert.equal(result.bayId, 'cd-held'); // unchanged — search doesn't move anything
});
