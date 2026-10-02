import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// Guide §9.6 — alert and scramble (docs/adr/0070). The pure rules, and the
// proof that a scramble is a flag and never an inhibit or an ordering.

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const {
  SCRAMBLE_PRE_AIRBORNE, GROUND_STATES,
  activeScrambles, conflictingGroundStrips, accessRouteText, alertPadConstraint, validateAlertPadConfig,
} = require('../src/efsp/alert-scramble.js');
const nla = require('../src/efsp/nla.js');
const facilityConfig = require('../src/efsp/facility-config.js');

// ── fixtures ─────────────────────────────────────────────────────────────

const flightData = (flightDataId, callsign, alertStatus = 'NONE') => ({
  flightDataId, identity: { callsign }, filed: {}, assigned: { departureRelease: 'RELEASED' },
  military: { ordnanceState: 'CLEAN', hookRequired: false, alertStatus },
});
const strip = (stripId, flightDataId, stripType, state, facilityId = 'INCIRLIK') => ({ stripId, flightDataId, stripType, state, facilityId });

function board(extraFlightDataList = [], extraStrips = []) {
  const flightDataList = new Map([
    flightData('f-viper', 'VIPER11', 'SCRAMBLE'),
    flightData('f-alert', 'COLT21', 'ALERT'),
    flightData('f-taxi', 'HAWK31'),
    flightData('f-queue', 'EAGLE41'),
    flightData('f-in', 'TANKER51'),
    flightData('f-airborne', 'BONE61'),
    flightData('f-other', 'OTHER71'),
    ...extraFlightDataList,
  ].map(f => [f.flightDataId, f]));
  const strips = [
    strip('s-viper', 'f-viper', 'DEPARTURE', 'CLEARED'),
    strip('s-alert', 'f-alert', 'DEPARTURE', 'CLEARED'),
    strip('s-taxi', 'f-taxi', 'DEPARTURE', 'TAXI'),
    strip('s-queue', 'f-queue', 'DEPARTURE', 'RUNWAY_QUEUE'),
    strip('s-in', 'f-in', 'ARRIVAL', 'TAXI_IN'),
    strip('s-airborne', 'f-airborne', 'DEPARTURE', 'DEPARTED'),
    strip('s-other', 'f-other', 'DEPARTURE', 'TAXI', 'OTHERFIELD'),
    ...extraStrips,
  ];
  return { strips, flightDataOf: (id) => flightDataList.get(id) || null };
}

// ── the state sets ───────────────────────────────────────────────────────

test('SCRAMBLE_PRE_AIRBORNE is a subset of nla.js\'s DEPARTURE_STATES', () => {
  for (const s of SCRAMBLE_PRE_AIRBORNE.DEPARTURE) assert.ok(nla.DEPARTURE_STATES.includes(s), s);
  assert.ok(!SCRAMBLE_PRE_AIRBORNE.DEPARTURE.includes('DEPARTED'));
});

test('GROUND_STATES are states of their Role', () => {
  for (const [stripType, states] of Object.entries(GROUND_STATES)) {
    for (const s of states) assert.ok(nla.STATES_BY_STRIP_TYPE[stripType].includes(s), `${stripType}/${s}`);
  }
});

// ── activeScrambles ──────────────────────────────────────────────────────

test('activeScrambles names the scrambling departure, with its Facility and state', () => {
  const { strips, flightDataOf } = board();
  assert.deepEqual(activeScrambles(strips, flightDataOf), [
    { stripId: 's-viper', flightDataId: 'f-viper', facilityId: 'INCIRLIK', state: 'CLEARED', callsign: 'VIPER11' },
  ]);
  assert.equal(activeScrambles(strips, flightDataOf, 'INCIRLIK').length, 1);
  assert.equal(activeScrambles(strips, flightDataOf, 'OTHERFIELD').length, 0);
});

test('ALERT is not a scramble', () => {
  const { strips, flightDataOf } = board();
  assert.ok(!activeScrambles(strips, flightDataOf).some(s => s.stripId === 's-alert'));
});

test('a scrambler that is DEPARTED raises nothing', () => {
  const { strips, flightDataOf } = board([flightData('f-gone', 'GONE81', 'SCRAMBLE')], [strip('s-gone', 'f-gone', 'DEPARTURE', 'DEPARTED')]);
  assert.ok(!activeScrambles(strips, flightDataOf).some(s => s.stripId === 's-gone'));
  const dropped = board([flightData('f-drop', 'DROP91', 'SCRAMBLE')], [strip('s-drop', 'f-drop', 'DEPARTURE', 'DROPPED')]);
  assert.ok(!activeScrambles(dropped.strips, dropped.flightDataOf).some(s => s.stripId === 's-drop'));
});

test('a scrambling FDR with no pre-airborne DEPARTURE Strip raises nothing, and an archived FDR is null, not a throw', () => {
  const { strips, flightDataOf } = board([flightData('f-arr', 'ARR1', 'SCRAMBLE')], [
    strip('s-arr', 'f-arr', 'ARRIVAL', 'TAXI_IN'),
    strip('s-archived', 'f-missing', 'DEPARTURE', 'TAXI'),
  ]);
  const ids = activeScrambles(strips, flightDataOf).map(s => s.stripId);
  assert.deepEqual(ids, ['s-viper']);
});

test('two scramblers at once: two entries, sorted by callsign', () => {
  const { strips, flightDataOf } = board([flightData('f-ace', 'ACE12', 'SCRAMBLE')], [strip('s-ace', 'f-ace', 'DEPARTURE', 'TAXI')]);
  assert.deepEqual(activeScrambles(strips, flightDataOf).map(s => s.callsign), ['ACE12', 'VIPER11']);
});

// ── conflictingGroundStrips ──────────────────────────────────────────────

test('conflictingGroundStrips flags every ground Strip at the scrambler\'s Facility', () => {
  const { strips, flightDataOf } = board();
  assert.deepEqual(conflictingGroundStrips(strips, flightDataOf, 'INCIRLIK').map(s => s.stripId), ['s-taxi', 's-queue', 's-in']);
  const [taxi] = conflictingGroundStrips(strips, flightDataOf, 'INCIRLIK');
  assert.deepEqual(taxi, { stripId: 's-taxi', flightDataId: 'f-taxi', facilityId: 'INCIRLIK', stripType: 'DEPARTURE', state: 'TAXI', callsign: 'HAWK31' });
});

test('a scrambler at INCIRLIK flags nothing at another Facility', () => {
  const { strips, flightDataOf } = board();
  assert.deepEqual(conflictingGroundStrips(strips, flightDataOf, 'OTHERFIELD'), []);
});

test('the scrambler never flags itself — nor another scrambler', () => {
  const { strips, flightDataOf } = board([flightData('f-ace', 'ACE12', 'SCRAMBLE')], [strip('s-ace', 'f-ace', 'DEPARTURE', 'TAXI')]);
  const ids = conflictingGroundStrips(strips, flightDataOf, 'INCIRLIK').map(s => s.stripId);
  assert.ok(!ids.includes('s-viper'));
  assert.ok(!ids.includes('s-ace'), 'a taxiing scrambler is a scrambler, not a conflict');
  assert.deepEqual(ids, ['s-taxi', 's-queue', 's-in']);
});

test('no scramble, no flags', () => {
  const { strips, flightDataOf } = board();
  const calm = strips.filter(s => s.stripId !== 's-viper');
  assert.deepEqual(conflictingGroundStrips(calm, flightDataOf, 'INCIRLIK'), []);
});

test('Strips off the movement area are not flagged: CLEARED, HELD, DEPARTED, and ARRIVAL before LANDED', () => {
  const { strips, flightDataOf } = board([flightData('f-held', 'HELD1'), flightData('f-final', 'FINAL1'), flightData('f-landed', 'LAND1')], [
    strip('s-held', 'f-held', 'DEPARTURE', 'HELD'),
    strip('s-final', 'f-final', 'ARRIVAL', 'FINAL'),
    strip('s-landed', 'f-landed', 'ARRIVAL', 'LANDED'),
  ]);
  const ids = conflictingGroundStrips(strips, flightDataOf, 'INCIRLIK').map(s => s.stripId);
  for (const quiet of ['s-alert', 's-airborne', 's-held', 's-final']) assert.ok(!ids.includes(quiet), quiet);
  assert.ok(ids.includes('s-landed'));
});

// ── alertPadConstraint ───────────────────────────────────────────────────

const SCRAMBLE = [{ stripId: 's-viper', flightDataId: 'f-viper', facilityId: 'INCIRLIK', state: 'CLEARED', callsign: 'VIPER11' }];

test('alertPadConstraint names the configured route while a scramble is active', () => {
  const runwayStatus = { facilityId: 'INCIRLIK', alertPad: { name: 'Alert pad', accessRoute: 'ALERT ACCESS TAXIWAY', occupied: false, occupantFlightDataId: null } };
  assert.deepEqual(alertPadConstraint(runwayStatus, SCRAMBLE), {
    route: 'ALERT ACCESS TAXIWAY',
    text: 'ACCESS ROUTE ALERT ACCESS TAXIWAY CONSTRAINED — scramble in progress (VIPER11)',
  });
  assert.equal(alertPadConstraint(runwayStatus, []), null);
});

test('alertPadConstraint still marks the route when none is configured, or field state is unknown (Q9, T6)', () => {
  assert.deepEqual(alertPadConstraint({ facilityId: 'CENTER', alertPad: { occupied: false } }, SCRAMBLE), {
    route: null, text: 'ALERT-PAD ACCESS ROUTE (not configured) CONSTRAINED — scramble in progress (VIPER11)',
  });
  assert.deepEqual(alertPadConstraint(null, SCRAMBLE), {
    route: null, text: 'ALERT-PAD ACCESS ROUTE CONSTRAINED — scramble in progress (VIPER11)',
  });
  assert.equal(accessRouteText(null), 'the alert-pad access route');
  assert.equal(accessRouteText({ alertPad: {} }), 'the alert-pad access route (not configured)');
  assert.equal(accessRouteText({ alertPad: { accessRoute: 'TWY A' } }), 'TWY A');
});

// ── config ───────────────────────────────────────────────────────────────

test('validateConfig rejects a non-string accessRoute and accepts the shipped config', () => {
  assert.equal(facilityConfig.validateConfig(facilityConfig.getShippedConfig('INCIRLIK')).ok, true);
  assert.equal(facilityConfig.getShippedConfig('INCIRLIK').runwayStatus.pads.alert.accessRoute, 'ALERT ACCESS TAXIWAY');
  const bad = structuredClone(facilityConfig.getShippedConfig('INCIRLIK'));
  bad.runwayStatus.pads.alert.accessRoute = 42;
  const result = facilityConfig.validateConfig(bad);
  assert.equal(result.ok, false);
  assert.match(result.detail, /accessRoute/);
  assert.equal(validateAlertPadConfig(null), null);
  assert.equal(validateAlertPadConfig({ name: 'Alert pad' }), null);
});

// ── the [GAP]: a scramble changes no NLA ─────────────────────────────────

test('a scramble changes no NLA', () => {
  // nla.js is handed the Strip, its own flight data and a Board-derived ctx; the
  // proof that no other flight's scramble can reach it is that nothing in
  // the module reads alertStatus at all. The Strip's OWN alert status is
  // toggled through every value and must change nothing either.
  // AUTH: the per-strip-type NLA tables live in the authority registry's strip type families.
  const roleDir = path.join(here, '../src/efsp/authority/strip-types');
  for (const f of ['../src/efsp/nla.js', ...fs.readdirSync(roleDir).map(n => path.join('../src/efsp/authority/strip-types', n))]) {
    const source = fs.readFileSync(path.join(here, f), 'utf8');
    assert.ok(!/alertStatus/.test(source), `${f} reads alertStatus`);
  }
  const ctx = { isStaffed: () => true, consolidatedAt: () => null, facilityId: 'INCIRLIK' };
  const now = Date.UTC(2026, 8, 30, 12);
  for (const [stripType, states] of [['DEPARTURE', nla.DEPARTURE_STATES], ['ARRIVAL', nla.ARRIVAL_STATES]]) {
    for (const state of states) {
      const s = { ...strip('s1', 'f1', stripType, state), ownerPositionId: 'LC' };
      const base = nla.computeNla(s, flightData('f1', 'X1', 'NONE'), now, ctx);
      for (const alertStatus of ['ALERT', 'SCRAMBLE']) {
        assert.deepEqual(nla.computeNla(s, flightData('f1', 'X1', alertStatus), now, ctx), base, `${stripType}/${state} with ${alertStatus}`);
      }
    }
  }
});
