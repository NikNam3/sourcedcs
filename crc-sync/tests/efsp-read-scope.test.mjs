import { test } from 'node:test';
import assert from 'node:assert/strict';

// The pure module behind B6 (docs/adr/0080): every row of the table in the ADR.

const rs = (await import('../src/efsp/read-scope.js')).default || await import('../src/efsp/read-scope.js');
const { readScopeFor } = await import('../src/efsp/permission.js');

const jtac = rs.scopeOf([{ facilityId: 'TACTICAL', positionId: 'JTAC' }], readScopeFor);
const strip = (id, owner, fdr, facilityId = 'TACTICAL') => ({ stripId: id, ownerPositionId: owner, fdrId: fdr, facilityId });

test('a session holding nothing, or any Position that reads ALL, has scope ALL (H58)', () => {
  assert.equal(rs.scopeOf([], readScopeFor).kind, 'ALL');
  assert.equal(rs.scopeOf(null, readScopeFor).kind, 'ALL');
  assert.equal(rs.scopeOf([{ facilityId: 'TACTICAL', positionId: 'TAC_C2' }], readScopeFor).kind, 'ALL');
  assert.equal(rs.scopeOf([{ facilityId: 'TACTICAL', positionId: 'JTAC' }, { facilityId: 'TACTICAL', positionId: 'AIC' }], readScopeFor).kind, 'ALL', 'union: AIC reads ALL');
  assert.equal(rs.scopeOf([{ facilityId: 'TACTICAL', positionId: 'JTAC' }, { facilityId: 'INCIRLIK', positionId: 'OPS' }], readScopeFor).kind, 'ALL', 'a Position at another Facility counts');
  assert.equal(jtac.kind, 'OWNED');
});

test('the scope key changes exactly when the scope does', () => {
  const two = rs.scopeOf([{ facilityId: 'TACTICAL', positionId: 'JTAC' }, { facilityId: 'TACTICAL', positionId: 'JTAC' }], readScopeFor);
  assert.equal(rs.scopeKey(jtac), rs.scopeKey(two));
  assert.notEqual(rs.scopeKey(jtac), rs.scopeKey({ kind: 'ALL' }));
});

test('a Strip is visible when its owner is a Position the session holds AT THAT Facility', () => {
  assert.equal(rs.isStripVisible(jtac, strip('a', 'JTAC', 'f1')), true);
  assert.equal(rs.isStripVisible(jtac, strip('b', 'TAC_C2', 'f2')), false);
  assert.equal(rs.isStripVisible(jtac, strip('c', 'JTAC', 'f3', 'INCIRLIK')), false, 'same id, other Facility');
  assert.equal(rs.isStripVisible(jtac, null), false);
  assert.equal(rs.isStripVisible({ kind: 'ALL' }, null), true);
});

const snapshot = () => ({
  type: 'efsp-snapshot', boardSeq: 5, boardSeqByFacility: { TACTICAL: 5 }, boardEpochByFacility: { TACTICAL: 'e' },
  positions: [{ positionId: 'JTAC' }, { positionId: 'TAC_C2' }], bays: [{ bayId: 'jtac-mission' }, { bayId: 'x' }],
  facilities: ['TACTICAL'], airspaces: [{ airspaceId: 'MOA' }], fieldStates: [{ facilityId: 'INCIRLIK' }], positionLetters: { JTAC: 'M' },
  strips: [strip('a', 'JTAC', 'f1'), strip('b', 'TAC_C2', 'f2'), strip('c', 'OPS', 'f3', 'INCIRLIK')],
  fdrs: [{ fdrId: 'f1' }, { fdrId: 'f2' }, { fdrId: 'f3' }],
  correlations: [{ fdrId: 'f1' }, { fdrId: 'f2' }],
  marsa: [{ marsaId: 'm1', participants: ['f1', 'f2'] }, { marsaId: 'm2', participants: ['f2', 'f3'] }],
});

test('snapshot: strips, their FDRs, correlations and relations with a visible participant; everything else unchanged', () => {
  const msg = snapshot();
  const out = rs.filterSnapshot(msg, jtac);
  assert.deepEqual(out.strips.map(s => s.stripId), ['a']);
  assert.deepEqual(out.fdrs.map(f => f.fdrId), ['f1']);
  assert.deepEqual(out.correlations.map(c => c.fdrId), ['f1']);
  assert.deepEqual(out.marsa.map(r => r.marsaId), ['m1']);
  for (const k of ['positions', 'bays', 'facilities', 'boardSeqByFacility', 'boardEpochByFacility', 'airspaces', 'fieldStates', 'positionLetters', 'boardSeq', 'type']) {
    assert.deepEqual(out[k], msg[k], k);
  }
  assert.deepEqual(msg.strips.length, 3, 'the input is not mutated');
});

test('an ALL scope returns the very same object', () => {
  const msg = snapshot();
  assert.equal(rs.filterSnapshot(msg, { kind: 'ALL' }), msg);
  assert.equal(rs.filterBoardDelta(msg, { kind: 'ALL' }, new Set()), msg);
  assert.equal(rs.filterCorrelationDelta(msg, { kind: 'ALL' }, new Set()), msg);
  assert.equal(rs.filterMarsaDelta(msg, { kind: 'ALL' }, new Set()), msg);
  assert.equal(rs.filterAlerts(msg, { kind: 'ALL' }, new Set(), () => false), msg);
});

test('board delta: visible Strips stay, every other updated Strip goes to gone, the seq is untouched and an empty delta is still sent', () => {
  const delta = {
    type: 'efsp-board-delta', boardSeq: 9, boardEpoch: 'e', facilityId: 'TACTICAL',
    strips: { updated: [strip('a', 'JTAC', 'f1'), strip('b', 'TAC_C2', 'f2')], gone: ['z'] },
    fdrs: { updated: [{ fdrId: 'f1' }, { fdrId: 'f2' }], gone: ['old'] },
    positions: { updated: [{ positionId: 'JTAC' }] },
  };
  const out = rs.filterBoardDelta(delta, jtac, new Set(['f1']));
  assert.deepEqual(out.strips.updated.map(s => s.stripId), ['a']);
  assert.deepEqual(out.strips.gone, ['z', 'b']);
  assert.deepEqual(out.fdrs.updated.map(f => f.fdrId), ['f1']);
  assert.deepEqual(out.fdrs.gone, ['old']);
  assert.equal(out.boardSeq, 9);
  assert.deepEqual(out.positions, delta.positions);

  const none = rs.filterBoardDelta({ ...delta, strips: { updated: [strip('b', 'TAC_C2', 'f2')], gone: [] }, fdrs: { updated: [{ fdrId: 'f2' }] } }, jtac, new Set(['f1']));
  assert.deepEqual(none.strips.updated, []);
  assert.deepEqual(none.strips.gone, ['b']);
  assert.equal(none.boardSeq, 9, 'sent even when empty, so the seq stays continuous');
});

test('correlation and MARSA deltas carry the visible flights only and are skipped when nothing is left', () => {
  const fdrIds = new Set(['f1']);
  const corr = { type: 'efsp-correlation-delta', correlations: { updated: [{ fdrId: 'f1' }, { fdrId: 'f2' }] }, stats: { n: 2 } };
  assert.deepEqual(rs.filterCorrelationDelta(corr, jtac, fdrIds).correlations.updated, [{ fdrId: 'f1' }]);
  assert.equal(rs.filterCorrelationDelta(corr, jtac, fdrIds).stats.n, 2);
  assert.equal(rs.filterCorrelationDelta({ ...corr, correlations: { updated: [{ fdrId: 'f2' }] } }, jtac, fdrIds), null);
  const marsa = { type: 'efsp-marsa-delta', marsa: { updated: [{ marsaId: 'm1', participants: ['f1', 'f2'] }, { marsaId: 'm2', participants: ['f2'] }] } };
  assert.deepEqual(rs.filterMarsaDelta(marsa, jtac, fdrIds).marsa.updated.map(r => r.marsaId), ['m1']);
  assert.equal(rs.filterMarsaDelta({ ...marsa, marsa: { updated: [{ marsaId: 'm2', participants: ['f2'] }] } }, jtac, fdrIds), null);
});

test('alerts: conformance by flight and obligations by Strip, for visible ones only; stca is left as given', () => {
  const alerts = {
    type: 'efsp-alerts', stca: [{ a: '1', b: '2' }],
    conformance: [{ fdrId: 'f1', alerts: [] }, { fdrId: 'f2', alerts: [] }],
    obligations: [{ facilityId: 'TACTICAL', stripId: 'a' }, { facilityId: 'TACTICAL', stripId: 'b' }],
  };
  const out = rs.filterAlerts(alerts, jtac, new Set(['f1']), (f, id) => id === 'a');
  assert.deepEqual(out.conformance.map(c => c.fdrId), ['f1']);
  assert.deepEqual(out.obligations.map(o => o.stripId), ['a']);
  assert.deepEqual(out.stca, alerts.stca);
});

test('board delta: the FDR of every visible updated Strip rides along (a handed line must not draw blank), once', () => {
  const delta = {
    type: 'efsp-board-delta', boardSeq: 9, facilityId: 'TACTICAL',
    strips: { updated: [strip('a', 'JTAC', 'f1'), strip('a2', 'JTAC', 'f1')], gone: [] }, fdrs: { updated: [] }, positions: { updated: [] },
  };
  const out = rs.filterBoardDelta(delta, jtac, new Set(['f1']), (id) => ({ fdrId: id, callsign: 'X' }));
  assert.deepEqual(out.fdrs.updated, [{ fdrId: 'f1', callsign: 'X' }]);
  const already = rs.filterBoardDelta({ ...delta, fdrs: { updated: [{ fdrId: 'f1', callsign: 'MINE' }] } }, jtac, new Set(['f1']), () => ({ fdrId: 'f1', callsign: 'X' }));
  assert.deepEqual(already.fdrs.updated, [{ fdrId: 'f1', callsign: 'MINE' }], 'the delta\'s own copy wins');
});
