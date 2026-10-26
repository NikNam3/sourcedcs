/* AIRSP-2P-A: the panel around the editor. History and Delete models, the calendar chip, the removed/edit-log state, the
   ROUTE labels, the using-Facility actions, the Mine/All filter, the Facility grouping and the menu's reasons. */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { historyEntries, deleteBlockers } from '../app/public/js/panels/efsp/airspace-detail-views.js';
import { applyAirspaceCalendar, nextBooking, formatBooking, _resetAirspaceCalendarForTest } from '../app/public/js/panels/efsp/airspace-calendar.js';
import {
  applyEfspSnapshot, applyEfspAirspaceDelta, getAllEfspAirspaces, getEfspAirspaceEdits, _resetEfspStateForTest,
} from '../app/public/js/panels/efsp/efsp-state.js';
import { airspaceActionsFor, editReason, deleteReason, visibleAirspaces, groupByFacility } from '../app/public/js/panels/efsp/airspace-rules.js';

const def = (extra = {}) => ({
  airspaceId: 'R-TOROS', name: 'TOROS RANGE', kind: 'AREA', type: 'RESTRICTED', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP',
  usingPositionId: 'RNG1', usingFacilityId: null, workingFrequencyMhz: 138, controlFrequencyMhz: 251.5, altLowerFt: null, altUpperFt: 18000, geometry: null, ...extra,
});
const rec = (state = 'RETURNED', extra = {}, d = {}) => ({
  airspaceId: 'R-TOROS', theater: 'Syria', definition: def(d), defRev: 3, rev: 1, state, window: null, pendingRequest: null, transitions: [], updatedAt: 0, updatedBy: null, ...extra,
});
const zulu = (ms) => `${String(new Date(ms).getUTCHours()).padStart(2, '0')}${String(new Date(ms).getUTCMinutes()).padStart(2, '0')}Z`;
const T = (h, m) => Date.UTC(2026, 9, 2, h, m);

test('History: transitions and seen edits merge newest first, in mission Zulu, with who did it', () => {
  const record = rec('ACTIVE', {
    transitions: [
      { state: 'SCHEDULED', actingPositionId: 'RNG1', by: 'c-0377', at: T(13, 18), window: { fromUtc: T(13, 30), toUtc: T(15, 30) } },
      { state: 'ACTIVE', actingPositionId: 'AP', by: 'c-0412', at: T(13, 32), selfCoordinated: false },
    ],
  });
  const edits = [{ defRev: 3, at: T(13, 52), by: 'c-0412', changes: [{ field: 'workingFrequencyMhz', from: 138, to: 139.1 }] }];
  const rows = historyEntries(record, edits, { zulu });
  assert.deepEqual(rows.map(r => [r.kind, zulu(r.at)]), [['Edit', '1352Z'], ['State', '1332Z'], ['State', '1318Z']]);
  assert.equal(rows[1].headline, 'SCHEDULED → ACTIVE');
  assert.equal(rows[2].headline, 'RETURNED → SCHEDULED 1330Z–1530Z');
  assert.equal(rows[1].who, 'AP · c-0412');
  assert.deepEqual(rows[0].changes, [{ field: 'workingFrequencyMhz', from: 138, to: 139.1 }]);
});

test('History notes a self-coordination, flights still in a released block, and edits missed while away', () => {
  const rows = historyEntries(rec('RELEASED', { transitions: [
    { state: 'ACTIVE', actingPositionId: 'AP', by: 'c', at: 1, selfCoordinated: true },
    { state: 'RELEASED', actingPositionId: 'RNG1', by: 'c', at: 2, occupiedAtRelease: 2 },
  ] }), [{ defRev: 5, at: 3, by: null, changes: [], missed: 1 }], { zulu });
  assert.match(rows.find(r => r.headline === 'RETURNED → ACTIVE').note, /self-coordinated/);
  assert.match(rows.find(r => r.headline === 'ACTIVE → RELEASED').note, /2 flights still in it/);
  assert.match(rows[0].note, /1 earlier edit arrived while this window was away/);
});

test('Delete: the blockers and what clears each (mockup scene 6)', () => {
  const flights = [{ callsign: 'VIPER11' }, { callsign: 'VIPER12' }];
  const active = rec('ACTIVE', { window: { fromUtc: T(13, 30), toUtc: T(15, 30) } });
  assert.deepEqual(deleteBlockers(active, flights, { zulu }), [
    { blocking: 'State is ACTIVE (booked 1330Z–1530Z)', clears: 'RNG1 releases it, then AP takes it back' },
    { blocking: '2 flights approved into it: VIPER11, VIPER12', clears: 'Clear their airspace entry on each Strip' },
  ]);
  assert.deepEqual(deleteBlockers(rec(), [], { zulu }), []);
  assert.match(deleteBlockers(rec('SCHEDULED', { pendingRequest: { requestedPositionId: 'RNG1' } }), [], { zulu })[1].blocking, /request from RNG1 is outstanding/);
  assert.deepEqual(deleteBlockers(rec('RETURNED', {}, { kind: 'ROUTE' }), flights, { zulu }), [], 'a route is never blocked by flights');
});

test('the menu reasons: Owned by APP for TAC_C2 and for another Facility, sign-on for nothing, the first blocker for Delete', () => {
  const app = rec('RETURNED', {}, { usingPositionId: null, usingFacilityId: 'TACTICAL' });
  assert.equal(editReason(app, ['TAC_C2']), 'Owned by AP');
  assert.equal(editReason(app, ['CTR']), 'Owned by AP');
  assert.equal(editReason(app, []), 'Sign on to a Position to edit');
  assert.equal(editReason(app, ['AP']), null);
  assert.equal(editReason(app, ['OPS']), 'Owned by AP', 'OPS defines nothing (crc-sync docs/adr/0119)');
  assert.equal(deleteReason(app, ['AP'], []), null);
  assert.equal(deleteReason(rec('ACTIVE'), ['AP'], []), 'State is ACTIVE');
  assert.equal(deleteReason(app, ['TAC_C2'], []), 'Owned by AP');
  assert.equal(editReason(rec(), ['RNG1']), null, 'a range edits its control frequency');
  assert.equal(deleteReason(rec(), ['RNG1'], []), 'Owned by AP');
});

const kinds = (a, signedOn) => airspaceActionsFor(a, signedOn).map(x => `${x.kind}:${x.label}`);

test('ROUTE: Confirm instead of Approve (no request needed), Delay instead of Deny', () => {
  const route = (state, extra = {}) => rec(state, extra, { kind: 'ROUTE', type: 'IR', usingPositionId: null, controllingFacilityId: 'CENTER', controllingPositionId: 'CTR' });
  assert.deepEqual(kinds(route('SCHEDULED'), ['CTR']), ['ApproveActivation:Confirm', 'ReturnAirspace:Cancel']);
  const pending = route('SCHEDULED', { pendingRequest: { requestedPositionId: 'TAC_C2' } });
  assert.deepEqual(kinds(pending, ['CTR']), ['ApproveActivation:Confirm', 'DelayActivation:Delay', 'ReturnAirspace:Cancel']);
  assert.equal(kinds(pending, ['CTR']).some(k => k.startsWith('DenyActivation')), false);
});

test('a using Facility: TAC_C2 schedules, requests and releases; the controlling Position approves only on a request', () => {
  const d = { usingPositionId: null, usingFacilityId: 'TACTICAL' };
  assert.deepEqual(kinds(rec('RETURNED', {}, d), ['TAC_C2']), ['ScheduleAirspace:Schedule']);
  assert.deepEqual(kinds(rec('SCHEDULED', {}, d), ['TAC_C2']), ['RequestActivation:Request activation']);
  assert.deepEqual(kinds(rec('ACTIVE', {}, d), ['TAC_C2']), ['ReleaseAirspace:Release']);
  assert.deepEqual(kinds(rec('SCHEDULED', {}, d), ['AP']), ['ReturnAirspace:Cancel'], 'no request yet: nothing to approve');
  assert.deepEqual(kinds(rec('SCHEDULED', { pendingRequest: { requestedPositionId: 'TAC_C2' } }, d), ['AP']).sort(), ['ApproveActivation:Approve activation', 'DenyActivation:Deny', 'ReturnAirspace:Cancel']);
  assert.deepEqual(kinds(rec('RETURNED', {}, d), ['GCI']), [], 'only a Position with the use capability acts for the using Facility');
});

test('Mine shows what a signed-on Position controls or acts for; signed on to nothing shows everything', () => {
  const a = { ...rec('RETURNED', {}, { airspaceId: 'A', usingPositionId: null }), airspaceId: 'A' };
  const b = { ...rec(), airspaceId: 'B', definition: def({ airspaceId: 'B', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingPositionId: null }) };
  const c = { ...rec(), airspaceId: 'C', definition: def({ airspaceId: 'C', usingPositionId: null, usingFacilityId: 'TACTICAL' }) };
  const all = [a, b, c];
  assert.deepEqual(visibleAirspaces(all, ['AP'], 'mine').map(x => x.airspaceId), ['A', 'C']);
  assert.deepEqual(visibleAirspaces(all, ['TAC_C2'], 'mine').map(x => x.airspaceId), ['C']);
  assert.deepEqual(visibleAirspaces(all, ['AP'], 'all').length, 3);
  assert.deepEqual(visibleAirspaces(all, [], 'mine').length, 3);
});

test('Facility grouping: shipped order, then by name', () => {
  const mk = (id, name, fac) => ({ airspaceId: id, definition: def({ airspaceId: id, name, controllingFacilityId: fac }) });
  const groups = groupByFacility([mk('1', 'ZED', 'CENTER'), mk('2', 'BETA', 'INCIRLIK'), mk('3', 'ALPHA', 'INCIRLIK'), mk('4', 'X', 'ODD')]);
  assert.deepEqual(groups.map(g => [g.facilityId, g.airspaces.map(a => a.definition.name)]), [['INCIRLIK', ['ALPHA', 'BETA']], ['CENTER', ['ZED']], ['ODD', ['X']]]);
});

test('state: a delta with airspaces.removed drops the record and its edits; a moved defRev logs the edit', () => {
  _resetEfspStateForTest();
  applyEfspSnapshot({ airspaces: [rec()], strips: [], flightDataList: [], positions: [], facilities: ['INCIRLIK'] });
  assert.equal(getAllEfspAirspaces().length, 1);
  const edited = rec('RETURNED', { defRev: 4, updatedAt: T(13, 52), updatedBy: 'c-1' }, { workingFrequencyMhz: 139.1 });
  applyEfspAirspaceDelta({ airspaces: { updated: [edited] } });
  assert.deepEqual(getEfspAirspaceEdits('R-TOROS').map(e => [e.defRev, e.by, e.changes]), [[4, 'c-1', [{ field: 'workingFrequencyMhz', from: 138, to: 139.1 }]]]);
  applyEfspAirspaceDelta({ airspaces: { updated: [{ ...edited, state: 'SCHEDULED' }] } });
  assert.equal(getEfspAirspaceEdits('R-TOROS').length, 1, 'a state change is not a definition edit');
  applyEfspAirspaceDelta({ airspaces: { updated: [], removed: ['R-TOROS'] } });
  assert.equal(getAllEfspAirspaces().length, 0);
  assert.deepEqual(getEfspAirspaceEdits('R-TOROS'), []);
});

test('state: a snapshot after a reconnect logs the edits made while away, itemised only when one revision moved', () => {
  _resetEfspStateForTest();
  applyEfspSnapshot({ airspaces: [rec()], strips: [], flightDataList: [], positions: [], facilities: ['INCIRLIK'] });
  applyEfspSnapshot({ airspaces: [rec('RETURNED', { defRev: 6 }, { name: 'RENAMED' })], strips: [], flightDataList: [], positions: [], facilities: ['INCIRLIK'] });
  const [e] = getEfspAirspaceEdits('R-TOROS');
  assert.equal(e.missed, 2);
  assert.deepEqual(e.changes.map(c => c.field), ['name']);
});

test('calendar: the next booking not yet ended, real UTC with its date, who and altitude', () => {
  _resetAirspaceCalendarForTest();
  const msg = { theater: 'Syria', bookingUrl: 'https://sourcedcs.page/bookings.html', byAirspace: {
    'R-TOROS': [
      { startUtc: '2026-10-04T14:00:00.000Z', endUtc: '2026-10-04T16:00:00.000Z', by: 'Viper', altitudeFt: 23000 },
      { startUtc: '2026-10-02T09:00:00.000Z', endUtc: '2026-10-02T10:00:00.000Z', by: 'Old', altitudeFt: null },
      { startUtc: 'junk', endUtc: 'junk' },
    ],
  } };
  const cal = applyAirspaceCalendar(msg);
  assert.equal(cal.byAirspace['R-TOROS'].length, 2, 'the junk row is dropped');
  const now = Date.parse('2026-10-02T12:00:00Z');
  const next = nextBooking('R-TOROS', 'Syria', now);
  assert.equal(next.by, 'Viper');
  assert.equal(formatBooking(next, (ft) => `FL${ft / 100}`), '2026-10-04 1400Z–1600Z · Viper · FL230');
  assert.equal(nextBooking('R-TOROS', 'Caucasus', now), null, 'another theater has no booking here');
  assert.equal(nextBooking('NOPE', 'Syria', now), null);
  assert.equal(formatBooking({ startUtc: '2026-10-04T23:00:00Z', endUtc: '2026-10-05T01:00:00Z', by: '', altitudeFt: null }), '2026-10-04 2300Z–2026-10-05 0100Z');
  assert.deepEqual(applyAirspaceCalendar({ byAirspace: 'bad' }).byAirspace, {}, 'a malformed frame leaves an empty calendar');
  _resetAirspaceCalendarForTest();
});

test('crc-sync ADR 0144: a prohibited area offers no Schedule, Activate or Release, and its card reads IN FORCE', async () => {
  const p = rec('RETURNED', {}, { type: 'PROHIBITED' });
  assert.deepEqual(airspaceActionsFor(p, ['AP', 'RNG1']), []);
  assert.ok(airspaceActionsFor(rec('RETURNED'), ['AP']).length > 0, 'a restricted area still schedules');
  const { displayState } = await import('../app/public/js/panels/efsp/airspace-validate.js');
  assert.equal(displayState(p), 'IN FORCE');
  assert.equal(displayState(rec('SCHEDULED')), 'SCHEDULED');
});
