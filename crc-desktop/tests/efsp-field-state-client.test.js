'use strict';

/* Field state on the client (guide §9.7, docs/adr/0068): the client state,
   the pure rules mirror and its drift tests against crc-sync, the dock
   panel, and the Strip's RWY / HOOK chips.

   The rules are a MIRROR of crc-sync's field-state.js and permission.js and
   proactive only. A mirror that drifts is worse than none, so the drift tests
   below require the real server modules and run both sides over one table —
   and replay every offered button against a real FieldStateStore. */

const test = require('node:test');
const assert = require('node:assert/strict');

const state = require('../app/public/js/panels/efsp/efsp-state.js');
const rules = require('../app/public/js/panels/efsp/field-state-rules.js');
const serverFieldState = require('../../crc-sync/src/efsp/field-state.js');
const serverPermission = require('../../crc-sync/src/efsp/permission.js');
const { FieldStateStore } = require('../../crc-sync/src/efsp/field-state-store.js');

// ── fixtures ────────────────────────────────────────────────────────────────

const INVENTORY = {
  airportIcao: 'LTAG',
  runways: [{
    runwayId: '05/23', ends: ['05', '23'], endHeadingsTrue: { '05': 56, '23': 236 },
    rackIds: { '05': 'rwy-05', '23': 'rwy-23' }, arrestingGear: [],
  }],
  runwayChangeAcknowledgers: ['OPS', 'APP'],
  inspectionAuthorityPositionId: 'OPS',
  pads: { hotCargo: { name: 'Hot cargo pad' }, alert: { name: 'Alert pad' } },
};

/** A wire record in crc-sync getFieldState()'s shape. */
function record({ status = 'OPEN', activeRunway = '05', suspension = null, closure = null, gear = [], pendingRequest = null, runwayChange = null, facilityId = 'INCIRLIK', rev = 4 } = {}) {
  return {
    facilityId, rev, activeRunway, activeRunwaySource: null,
    runways: [{
      runwayId: '05/23', ends: ['05', '23'], endHeadingsTrue: { '05': 56, '23': 236 },
      rackIds: { '05': 'rwy-05', '23': 'rwy-23' }, status, arrestingGear: gear,
      suspension, closure, lastInspection: null, pendingRequest,
    }],
    runwayChange, runwayChangeInProgress: false,
    hotCargoPad: { name: 'Hot cargo pad', occupied: false, occupantFdrId: null },
    alertPad: { name: 'Alert pad', occupied: false, occupantFdrId: null },
    transitions: [], updatedAt: null, updatedBy: null,
  };
}

const departure = (extra = {}) => ({ stripId: 's-dep', fdrId: 'f-dep', facilityId: 'INCIRLIK', role: 'DEPARTURE', state: 'TAXI', bayId: 'gnd-taxi-out', rackId: 'main', ...extra });
const arrival = (extra = {}) => ({ stripId: 's-arr', fdrId: 'f-arr', facilityId: 'INCIRLIK', role: 'ARRIVAL', state: 'HANDED_TO_TOWER', bayId: 'twr-arrivals', rackId: 'main', ...extra });
const fdrDep = (rwy) => ({ fdrId: 'f-dep', filed: { departureRunway: rwy }, assigned: {}, military: {} });
const fdrArr = (rwy, hook = false) => ({ fdrId: 'f-arr', filed: {}, assigned: { landingRunway: rwy }, military: { hookRequired: hook } });
const lookups = (rec, fdr) => ({ fieldStateFor: (id) => (rec && rec.facilityId === id ? rec : null), fdrFor: () => fdr });

// ── Step 1: client state ────────────────────────────────────────────────────

test('a snapshot fills the field states by Facility; a second snapshot replaces them', () => {
  state._resetEfspStateForTest();
  state.applyEfspSnapshot({ fieldStates: [record({ rev: 1 })] });
  assert.equal(state.getEfspFieldState('INCIRLIK').rev, 1);
  assert.equal(state.getAllEfspFieldStates().length, 1);
  state.applyEfspSnapshot({ fieldStates: [] });
  assert.equal(state.getEfspFieldState('INCIRLIK'), null);
  assert.deepEqual(state.getAllEfspFieldStates(), []);
});

test('a delta replaces a record whole; an ack carrying a record applies it the same way', () => {
  state._resetEfspStateForTest();
  state.applyEfspSnapshot({ fieldStates: [record({ rev: 1 })] });
  state.applyEfspFieldStateDelta({ fieldStateSeq: 2, fieldStates: { updated: [record({ rev: 2, status: 'CLOSED' })] } });
  assert.equal(state.getEfspFieldState('INCIRLIK').rev, 2);
  assert.equal(state.getEfspFieldState('INCIRLIK').runways[0].status, 'CLOSED');
  // app.js's efsp-field-state-ack case wraps the ack's record into a delta.
  state.applyEfspFieldStateDelta({ fieldStates: { updated: [record({ rev: 3 })] } });
  assert.equal(state.getEfspFieldState('INCIRLIK').rev, 3);
  state.applyEfspFieldStateDelta({});
  assert.equal(state.getEfspFieldState('INCIRLIK').rev, 3);
});

test('a Facility with no field state is null, and the test reset clears everything', () => {
  state._resetEfspStateForTest();
  state.applyEfspSnapshot({ fieldStates: [record()] });
  assert.equal(state.getEfspFieldState('CENTER'), null);
  state._resetEfspStateForTest();
  assert.equal(state.getEfspFieldState('INCIRLIK'), null);
});

// ── Step 2: drift against crc-sync ──────────────────────────────────────────

const RESOLVER_CASES = [
  ['rack wins over the FDR', departure({ bayId: 'twr-runway-queue', rackId: 'rwy-23', state: 'RUNWAY_QUEUE' }), fdrDep('05'), {}],
  ['the drag target wins over the rack', departure({ bayId: 'twr-runway-queue', rackId: 'rwy-23' }), fdrDep('23'), { targetRackId: 'rwy-05' }],
  ['8A when there is no runway rack', departure(), fdrDep('RWY 5'), {}],
  ['8B for an arrival', arrival(), fdrArr('23'), {}],
  ['a whole-pavement designator in 8A', departure(), fdrDep('05/23'), {}],
  ['the active end when nothing else says', departure(), fdrDep(''), {}],
  ['garbage 8A falls back to the active end', departure(), fdrDep('banana'), {}],
  ['an 8A that names no configured runway falls back', departure(), fdrDep('17'), {}],
  ['OVERFLIGHT never resolves', departure({ role: 'OVERFLIGHT' }), fdrDep('05'), {}],
  ['MISSION never resolves', departure({ role: 'MISSION' }), fdrDep('05'), {}],
  ['no FDR, no rack: the active end', arrival(), null, {}],
];

test('drift: runwayForStrip resolves exactly as crc-sync resolveRunwayForStrip, source included', () => {
  for (const activeRunway of ['05', '23', null]) {
    const rec = record({ activeRunway });
    const view = serverFieldState.buildStatusView(rec, rec);
    for (const [name, strip, fdr, opts] of RESOLVER_CASES) {
      const server = serverFieldState.resolveRunwayForStrip(strip, fdr, view, opts);
      const client = rules.runwayForStrip(strip, fdr, rec, opts);
      const strip_ = client ? { runwayId: client.runwayId, end: client.end, source: client.source } : null;
      assert.deepEqual(strip_, server, `${name} (active ${activeRunway})`);
    }
  }
});

test('drift: normalizeRunwayEnd agrees with crc-sync on every spelling', () => {
  for (const text of ['5', '05', 'RWY 05', 'rw23', ' 23 ', '5L', '36', '37', '0', 'banana', '', null, 23, '05/23']) {
    assert.equal(rules.normalizeRunwayEnd(text), serverFieldState.normalizeRunwayEnd(text), String(text));
  }
});

test('drift: the inhibit wording and the inactive-runway advisory are crc-sync\'s, verbatim', () => {
  const statuses = [
    ['OPEN', null], ['CLOSED', null], ['SUSPENDED_WORKS', { kind: 'WORKS' }],
    ['SUSPENDED_INSPECTION', { kind: 'WORKS' }], ['SUSPENDED_INSPECTION', { kind: 'RUNWAY_CHANGE' }],
  ];
  for (const [status, suspension] of statuses) {
    const rec = record({ status, suspension });
    const view = serverFieldState.buildStatusView(rec, rec);
    assert.equal(rules.runwayStatusReasonFor(rec.runways[0]), serverFieldState.runwayStatusReason(view.runways[0]), status);
    for (const [name, strip, fdr] of RESOLVER_CASES) {
      const resolved = rules.runwayForStrip(strip, fdr, rec);
      const client = resolved ? rules.runwayStatusReasonFor(resolved.runway) : null;
      assert.equal(client, serverFieldState.runwayInhibitFor(strip, fdr, view), `${name} ${status}`);
    }
  }
  for (const activeRunway of ['05', '23', null]) {
    const rec = record({ activeRunway });
    const view = serverFieldState.buildStatusView(rec, rec);
    for (const rackId of ['rwy-05', 'rwy-23', 'main', undefined]) {
      const strip = departure({ rackId, state: 'RUNWAY_QUEUE' });
      assert.equal(rules.runwayAdvisoryFor(strip, rec), serverFieldState.runwayAdvisoryFor(strip, view), `${rackId} active ${activeRunway}`);
    }
  }
});

test('drift: the client owners table is crc-sync FIELD_STATE_OP_OWNERS, verbatim', () => {
  assert.deepEqual(rules.FIELD_STATE_ACTION_OWNERS, serverPermission.FIELD_STATE_OP_OWNERS);
});

// Every Position any Facility has, plus one that holds nothing on the field.
const ALL_POSITIONS = ['OPS', 'CD', 'GND', 'TWR', 'APP', 'CTR', 'TAC_C2', 'RANGE_CTL'];

function facilityConfigFixture() {
  return {
    getFacilityIds: () => ['INCIRLIK'],
    getFacilityConfig: () => ({ positions: ['OPS', 'CD', 'GND', 'TWR', 'APP'], fieldState: INVENTORY }),
  };
}

/** A fresh real store, driven through `history` ([positionId, op]) by one controller who holds everything. */
function storeAfter(history) {
  let t = Date.UTC(2026, 8, 30, 14, 0);
  const store = new FieldStateStore(facilityConfigFixture(), {
    clock: { now: () => (t += 60000) },
    isOccupied: () => true,
    primaryOf: () => 'c1',
  });
  for (const [positionId, op] of history) {
    const r = store.apply({ facilityId: 'INCIRLIK', op }, positionId, positionId === 'TWR' ? 'c-twr' : `c-${positionId.toLowerCase()}`);
    assert.equal(r.ok, true, `history step ${op.kind} as ${positionId}: ${r.detail}`);
  }
  return store;
}

/** An action as the panel dispatches it. */
function opOf(action) {
  const op = { kind: action.kind };
  if (action.runwayId) op.runwayId = action.runwayId;
  if (action.action) op.action = action.action;
  if (action.toEnds) op.toRunwayId = action.toEnds[0];
  if (action.needs === 'reason') { op.reason = 'test'; op.note = 'test'; }
  return op;
}

const SCENARIOS = {
  'OPEN, no change': [],
  'CLOSED': [['TWR', { kind: 'CloseRunway', runwayId: '05/23' }]],
  'SUSPENDED_WORKS': [['TWR', { kind: 'BeginRunwayWorks', runwayId: '05/23' }]],
  'SUSPENDED_INSPECTION': [['TWR', { kind: 'BeginRunwayWorks', runwayId: '05/23' }], ['OPS', { kind: 'CompleteRunwayWorks', runwayId: '05/23' }]],
  'a pending close request': [['OPS', { kind: 'RequestRunwayStatus', runwayId: '05/23', action: 'CLOSE' }]],
  'a pending open request': [['TWR', { kind: 'CloseRunway', runwayId: '05/23' }], ['GND', { kind: 'RequestRunwayStatus', runwayId: '05/23', action: 'OPEN' }]],
  'change PROPOSED': [['TWR', { kind: 'ProposeRunwayChange', toRunwayId: '23' }]],
  'change PROPOSED, OPS acked': [['TWR', { kind: 'ProposeRunwayChange', toRunwayId: '23' }], ['OPS', { kind: 'AckRunwayChange' }]],
  'change ACKNOWLEDGED': [['TWR', { kind: 'ProposeRunwayChange', toRunwayId: '23' }], ['OPS', { kind: 'AckRunwayChange' }], ['APP', { kind: 'AckRunwayChange' }]],
  'change IN_PROGRESS': [['TWR', { kind: 'ProposeRunwayChange', toRunwayId: '23' }], ['OPS', { kind: 'AckRunwayChange' }], ['APP', { kind: 'AckRunwayChange' }], ['TWR', { kind: 'BeginRunwayChange' }]],
  'change PENDING_INSPECTION': [['TWR', { kind: 'ProposeRunwayChange', toRunwayId: '23' }], ['OPS', { kind: 'AckRunwayChange' }], ['APP', { kind: 'AckRunwayChange' }], ['TWR', { kind: 'BeginRunwayChange' }], ['TWR', { kind: 'CompleteRunwayChange' }]],
  'change REJECTED': [['TWR', { kind: 'ProposeRunwayChange', toRunwayId: '23' }], ['APP', { kind: 'RejectRunwayChange' }]],
};

const HELD_SETS = [...ALL_POSITIONS.map(p => [p]), ['TWR', 'OPS', 'APP'], ['OPS', 'APP'], ['TWR', 'OPS']];

test('drift: every offered button names an owned kind, is offered only AS a Position that owns it, and the real store accepts it', () => {
  let offered = 0;
  for (const [name, history] of Object.entries(SCENARIOS)) {
    const rec = storeAfter(history).getFieldState('INCIRLIK');
    for (const held of HELD_SETS) {
      for (const action of rules.fieldStateActionsFor(rec, held)) {
        offered += 1;
        const where = `${name}, holding ${held.join('+')}: ${action.kind} as ${action.positionId}`;
        assert.ok(Object.prototype.hasOwnProperty.call(serverPermission.FIELD_STATE_OP_OWNERS, action.kind), where);
        assert.ok(held.includes(action.positionId), where);
        assert.equal(serverPermission.canActOnFieldState(action.positionId, action.kind), true, where);
        const store = storeAfter(history);
        const result = store.apply({ facilityId: 'INCIRLIK', baseRev: rec.rev, op: opOf(action) }, action.positionId, 'c1');
        assert.equal(result.ok, true, `${where} was refused: ${result.reason} ${result.detail}`);
      }
    }
  }
  assert.ok(offered > 40, `only ${offered} buttons were exercised`);
});

// ── Step 2: fieldStateActionsFor, case by case ──────────────────────────────

const kinds = (rec, held) => rules.fieldStateActionsFor(rec, held).map(a => a.action ? `${a.kind}:${a.action}` : a.kind);

test('holding nothing on the field is offered nothing', () => {
  assert.deepEqual(rules.fieldStateActionsFor(record(), []), []);
  assert.deepEqual(rules.fieldStateActionsFor(record(), ['CTR']), []);
  assert.deepEqual(rules.fieldStateActionsFor(null, ['TWR']), []);
});

test('OPS on an OPEN runway only ASKS tower — never Close or Begin works (H18, S-L1b)', () => {
  assert.deepEqual(kinds(record(), ['OPS']), ['RequestRunwayStatus:CLOSE', 'RequestRunwayStatus:WORKS']);
  assert.deepEqual(kinds(record({ status: 'CLOSED' }), ['GND']), ['RequestRunwayStatus:OPEN']);
  assert.deepEqual(kinds(record({ pendingRequest: { action: 'CLOSE', requestedPositionId: 'CD' } }), ['OPS']), [], 'one request per runway');
});

test('TWR: Close / Begin works, Propose, and Accept/Reject on a pending request', () => {
  assert.deepEqual(kinds(record(), ['TWR']), ['CloseRunway', 'BeginRunwayWorks', 'ProposeRunwayChange']);
  assert.deepEqual(kinds(record({ status: 'CLOSED' }), ['TWR']), ['OpenRunway'], 'no change onto a closed runway (L1: refused)');
  const pending = record({ pendingRequest: { requestId: 'r', action: 'WORKS', requestedPositionId: 'OPS' } });
  assert.deepEqual(kinds(pending, ['TWR']), ['CloseRunway', 'BeginRunwayWorks', 'AcceptRunwayRequest', 'RejectRunwayRequest', 'ProposeRunwayChange']);
  const close = rules.fieldStateActionsFor(record(), ['TWR']).find(a => a.kind === 'CloseRunway');
  assert.equal(close.needs, 'reason');
  const reject = rules.fieldStateActionsFor(pending, ['TWR']).find(a => a.kind === 'RejectRunwayRequest');
  assert.equal(reject.needs, 'reason');
});

test('OPS completes works on SUSPENDED_WORKS; only the inspection authority signs off SUSPENDED_INSPECTION', () => {
  assert.deepEqual(kinds(record({ status: 'SUSPENDED_WORKS', suspension: { kind: 'WORKS' } }), ['OPS']), ['CompleteRunwayWorks']);
  assert.deepEqual(kinds(record({ status: 'SUSPENDED_INSPECTION', suspension: { kind: 'WORKS' } }), ['OPS']), ['CompleteInspection']);
  assert.deepEqual(kinds(record({ status: 'SUSPENDED_INSPECTION', suspension: { kind: 'WORKS' } }), ['TWR']), ['ProposeRunwayChange']);
});

test('APP acknowledges only while PROPOSED and not yet acked; Begin only once ACKNOWLEDGED', () => {
  const change = (st, acks) => record({ runwayChange: { changeId: 'c', state: st, fromRunwayId: '05', toRunwayId: '23', acknowledgers: ['OPS', 'APP'], acks } });
  const kinds = (rec, held) => rules.fieldStateActionsFor(rec, held).map(a => a.kind).filter(k => k !== 'RequestRunwayStatus');
  assert.deepEqual(kinds(change('PROPOSED', { OPS: null, APP: null }), ['APP']), ['AckRunwayChange', 'RejectRunwayChange']);
  assert.deepEqual(kinds(change('PROPOSED', { OPS: null, APP: { by: 'x' } }), ['APP']), ['RejectRunwayChange']);
  assert.deepEqual(kinds(change('PROPOSED', { OPS: null, APP: { skipped: true, reason: 'UNMANNED' } }), ['APP']), ['RejectRunwayChange']);
  assert.deepEqual(kinds(change('PROPOSED', { OPS: null, APP: null }), ['TWR']), ['CloseRunway', 'BeginRunwayWorks', 'WithdrawRunwayChange']);
  assert.deepEqual(kinds(change('ACKNOWLEDGED', { OPS: {}, APP: {} }), ['TWR']), ['CloseRunway', 'BeginRunwayWorks', 'WithdrawRunwayChange', 'BeginRunwayChange']);
  assert.deepEqual(kinds(change('IN_PROGRESS', { OPS: {}, APP: {} }), ['TWR']), ['CloseRunway', 'BeginRunwayWorks', 'CompleteRunwayChange']);
  assert.deepEqual(kinds(change('PENDING_INSPECTION', { OPS: {}, APP: {} }), ['TWR']), ['CloseRunway', 'BeginRunwayWorks']);
});

test('a controller holding TWR, OPS and APP is offered the one-input self-coordinated change (S-Q24)', () => {
  assert.ok(kinds(record(), ['TWR', 'OPS', 'APP']).includes('SelfCoordinateRunwayChange'));
  assert.ok(!kinds(record(), ['TWR', 'OPS']).includes('SelfCoordinateRunwayChange'));
  const self = rules.fieldStateActionsFor(record({ activeRunway: '05' }), ['TWR', 'OPS', 'APP']).find(a => a.kind === 'SelfCoordinateRunwayChange');
  assert.equal(self.positionId, 'TWR');
  assert.deepEqual(self.toEnds, ['23']);
  assert.deepEqual(rules.fieldStateActionsFor(record({ activeRunway: null }), ['TWR']).find(a => a.kind === 'ProposeRunwayChange').toEnds, ['05', '23']);
});

test('fieldStateSubjectFor names the runway, else the change, else the Facility', () => {
  assert.equal(rules.fieldStateSubjectFor({ runwayId: '05/23', facilityId: 'INCIRLIK' }), 'runway 05/23');
  assert.equal(rules.fieldStateSubjectFor({ op: { kind: 'ProposeRunwayChange', toRunwayId: '23' } }), 'runway change to 23');
  assert.equal(rules.fieldStateSubjectFor({ facilityId: 'INCIRLIK' }), 'INCIRLIK field state');
});

// ── Step 2: rule 4 ──────────────────────────────────────────────────────────

const gear = (state, end = '05', type = 'BAK_12') => ({ end, position: 'APPROACH_END', distanceFt: 1500, type, state });
const rwyWith = (g) => record({ gear: g }).runways[0];

test('gearMismatchFor: no hook -> null; no runway -> null; no inventory -> null (H57: fires only when gear is configured)', () => {
  assert.equal(rules.gearMismatchFor(fdrArr('05', false), rwyWith([gear('DOWN')])), null);
  assert.equal(rules.gearMismatchFor(fdrArr('05', true), null), null);
  assert.equal(rules.gearMismatchFor(fdrArr('05', true), rwyWith([])), null);
  assert.equal(rules.gearMismatchFor(null, rwyWith([gear('DOWN')])), null);
});

test('gearMismatchFor: all gear DOWN -> HOOK, naming the runway and every gear; one UP anywhere on the pavement -> null', () => {
  const m = rules.gearMismatchFor(fdrArr('05', true), rwyWith([gear('DOWN'), gear('OUT_OF_SERVICE', '23', 'E_5')]));
  assert.equal(m.text, 'HOOK');
  assert.equal(m.reason, 'Hook required: no arresting gear is rigged on runway 05/23 (SOURCE practice). BAK-12 05 end DOWN, E-5 23 end OUT OF SERVICE.');
  assert.equal(rules.gearMismatchFor(fdrArr('05', true), rwyWith([gear('DOWN'), gear('UP', '23')])), null);
});

test('gearMismatchFor: OUT_OF_SERVICE is not usable', () => {
  assert.ok(rules.gearMismatchFor(fdrArr('05', true), rwyWith([gear('OUT_OF_SERVICE')])));
});

// ── Step 2: fieldStateAlertsFor ─────────────────────────────────────────────

const alerts = (strip, rec, fdr) => rules.fieldStateAlertsFor(strip, lookups(rec, fdr));

test('a quiet Strip on an OPEN active runway gets nothing (ADR 0058: nothing for normal)', () => {
  assert.deepEqual(alerts(departure(), record(), fdrDep('05')), []);
  assert.deepEqual(alerts(arrival(), record(), fdrArr('05')), []);
});

test('RWY SUSP / INSP / CLSD on every runway-using state (Q5 (a)), naming the resolved end and what clears it', () => {
  const works = record({ status: 'SUSPENDED_WORKS', suspension: { kind: 'WORKS' } });
  for (const st of ['CLEARED', 'HELD', 'PUSHBACK', 'TAXI', 'RUNWAY_QUEUE', 'LUAW']) {
    const [a] = alerts(departure({ state: st }), works, fdrDep('05'));
    assert.deepEqual({ key: a.key, tone: a.tone, text: a.text }, { key: 'rwy', tone: 'bad', text: 'RWY 05 SUSP' }, st);
    assert.equal(a.reason, 'Runway 05/23 is suspended for works; it reopens when OPS completes the works and signs off the inspection.');
  }
  const [insp] = alerts(departure(), record({ status: 'SUSPENDED_INSPECTION', suspension: { kind: 'WORKS' } }), fdrDep('23'));
  assert.equal(insp.text, 'RWY 23 INSP');
  const [clsd] = alerts(arrival({ state: 'INBOUND' }), record({ status: 'CLOSED' }), fdrArr('05'));
  assert.equal(clsd.text, 'RWY 05 CLSD');
  assert.equal(clsd.reason, 'Runway 05/23 is closed; it reopens when TWR opens it.');
  const [fin] = alerts(arrival({ state: 'FINAL' }), record({ status: 'CLOSED' }), fdrArr('05'));
  assert.match(fin.reason, /Landing is an observation and is not held\.$/);
});

test('no RWY chip for states that no longer use the runway, OVERFLIGHT/MISSION, DROPPED, or a Facility with no record', () => {
  const closed = record({ status: 'CLOSED' });
  for (const st of ['PROPOSED', 'PENDING_CLEARANCE', 'DEPARTED', 'HANDED_OFF']) assert.deepEqual(alerts(departure({ state: st }), closed, fdrDep('05')), [], st);
  for (const st of ['LANDED', 'TAXI_IN']) assert.deepEqual(alerts(arrival({ state: st }), closed, fdrArr('05')), [], st);
  assert.deepEqual(alerts(departure({ state: 'DROPPED' }), closed, fdrDep('05')), []);
  assert.deepEqual(alerts(departure({ role: 'OVERFLIGHT' }), closed, fdrDep('05')), []);
  assert.deepEqual(alerts(departure({ facilityId: 'CENTER' }), closed, fdrDep('05')), []);
  assert.deepEqual(alerts(departure(), record({ status: 'CLOSED', activeRunway: null }), fdrDep('banana')), [], 'unresolvable fails open');
});

test('the RWY reason line is suppressed (the chip is not) when the server\'s NLA inhibit already names the runway', () => {
  const works = record({ status: 'SUSPENDED_WORKS', suspension: { kind: 'WORKS' } });
  const strip = departure({ state: 'RUNWAY_QUEUE', bayId: 'twr-runway-queue', rackId: 'rwy-05', nla: { inhibited: 'runway 05/23 suspended — works in progress' } });
  const [a] = alerts(strip, works, fdrDep('05'));
  assert.equal(a.text, 'RWY 05 SUSP');
  assert.equal(a.reason, null);
});

test('the inactive-runway advisory (Q30): attn chip on an OPEN runway when queued for the other end', () => {
  const strip = departure({ state: 'RUNWAY_QUEUE', bayId: 'twr-runway-queue', rackId: 'rwy-05' });
  const [a] = alerts(strip, record({ activeRunway: '23' }), fdrDep('05'));
  assert.deepEqual({ key: a.key, tone: a.tone, text: a.text }, { key: 'rwy', tone: 'attn', text: 'RWY 05 INACT' });
  assert.match(a.reason, /^Queued for inactive runway 05; the active runway is 23\./);
  assert.deepEqual(alerts(strip, record({ activeRunway: '05' }), fdrDep('05')), []);
  assert.deepEqual(alerts(strip, record({ activeRunway: null }), fdrDep('05')), []);
});

test('HOOK on a hook-required ARRIVAL inbound, handed to tower or on final when the runway\'s gear is all down', () => {
  const rec = record({ gear: [gear('DOWN')] });
  for (const st of ['INBOUND', 'HANDED_TO_TOWER', 'FINAL']) {
    const out = alerts(arrival({ state: st }), rec, fdrArr('05', true));
    assert.deepEqual(out.map(a => [a.key, a.text, a.tone]), [['gear', 'HOOK', 'bad']], st);
  }
  assert.deepEqual(alerts(arrival({ state: 'LANDED' }), rec, fdrArr('05', true)), []);
  assert.deepEqual(alerts(departure(), rec, { ...fdrDep('05'), military: { hookRequired: true } }), [], 'rule 4 is about arrivals');
  assert.deepEqual(alerts(arrival(), record(), fdrArr('05', true)), [], 'the shipped empty inventory never fires (H57)');
});
