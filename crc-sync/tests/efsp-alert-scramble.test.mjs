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

const fdr = (fdrId, callsign, alertStatus = 'NONE') => ({
  fdrId, identity: { callsign }, filed: {}, assigned: { releaseState: 'RELEASED' },
  military: { ordnanceState: 'CLEAN', hookRequired: false, alertStatus },
});
const strip = (stripId, fdrId, role, state, facilityId = 'INCIRLIK') => ({ stripId, fdrId, role, state, facilityId });

function board(extraFdrs = [], extraStrips = []) {
  const fdrs = new Map([
    fdr('f-viper', 'VIPER11', 'SCRAMBLE'),
    fdr('f-alert', 'COLT21', 'ALERT'),
    fdr('f-taxi', 'HAWK31'),
    fdr('f-queue', 'EAGLE41'),
    fdr('f-in', 'TANKER51'),
    fdr('f-airborne', 'BONE61'),
    fdr('f-other', 'OTHER71'),
    ...extraFdrs,
  ].map(f => [f.fdrId, f]));
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
  return { strips, fdrOf: (id) => fdrs.get(id) || null };
}

// ── the state sets ───────────────────────────────────────────────────────

test('SCRAMBLE_PRE_AIRBORNE is a subset of nla.js\'s DEPARTURE_STATES', () => {
  for (const s of SCRAMBLE_PRE_AIRBORNE.DEPARTURE) assert.ok(nla.DEPARTURE_STATES.includes(s), s);
  assert.ok(!SCRAMBLE_PRE_AIRBORNE.DEPARTURE.includes('DEPARTED'));
});

test('GROUND_STATES are states of their Role', () => {
  for (const [role, states] of Object.entries(GROUND_STATES)) {
    for (const s of states) assert.ok(nla.STATES_BY_ROLE[role].includes(s), `${role}/${s}`);
  }
});

// ── activeScrambles ──────────────────────────────────────────────────────

test('activeScrambles names the scrambling departure, with its Facility and state', () => {
  const { strips, fdrOf } = board();
  assert.deepEqual(activeScrambles(strips, fdrOf), [
    { stripId: 's-viper', fdrId: 'f-viper', facilityId: 'INCIRLIK', state: 'CLEARED', callsign: 'VIPER11' },
  ]);
  assert.equal(activeScrambles(strips, fdrOf, 'INCIRLIK').length, 1);
  assert.equal(activeScrambles(strips, fdrOf, 'OTHERFIELD').length, 0);
});

test('ALERT is not a scramble', () => {
  const { strips, fdrOf } = board();
  assert.ok(!activeScrambles(strips, fdrOf).some(s => s.stripId === 's-alert'));
});

test('a scrambler that is DEPARTED raises nothing', () => {
  const { strips, fdrOf } = board([fdr('f-gone', 'GONE81', 'SCRAMBLE')], [strip('s-gone', 'f-gone', 'DEPARTURE', 'DEPARTED')]);
  assert.ok(!activeScrambles(strips, fdrOf).some(s => s.stripId === 's-gone'));
  const dropped = board([fdr('f-drop', 'DROP91', 'SCRAMBLE')], [strip('s-drop', 'f-drop', 'DEPARTURE', 'DROPPED')]);
  assert.ok(!activeScrambles(dropped.strips, dropped.fdrOf).some(s => s.stripId === 's-drop'));
});

test('a scrambling FDR with no pre-airborne DEPARTURE Strip raises nothing, and an archived FDR is null, not a throw', () => {
  const { strips, fdrOf } = board([fdr('f-arr', 'ARR1', 'SCRAMBLE')], [
    strip('s-arr', 'f-arr', 'ARRIVAL', 'TAXI_IN'),
    strip('s-archived', 'f-missing', 'DEPARTURE', 'TAXI'),
  ]);
  const ids = activeScrambles(strips, fdrOf).map(s => s.stripId);
  assert.deepEqual(ids, ['s-viper']);
});

test('two scramblers at once: two entries, sorted by callsign', () => {
  const { strips, fdrOf } = board([fdr('f-ace', 'ACE12', 'SCRAMBLE')], [strip('s-ace', 'f-ace', 'DEPARTURE', 'TAXI')]);
  assert.deepEqual(activeScrambles(strips, fdrOf).map(s => s.callsign), ['ACE12', 'VIPER11']);
});

// ── conflictingGroundStrips ──────────────────────────────────────────────

test('conflictingGroundStrips flags every ground Strip at the scrambler\'s Facility', () => {
  const { strips, fdrOf } = board();
  assert.deepEqual(conflictingGroundStrips(strips, fdrOf, 'INCIRLIK').map(s => s.stripId), ['s-taxi', 's-queue', 's-in']);
  const [taxi] = conflictingGroundStrips(strips, fdrOf, 'INCIRLIK');
  assert.deepEqual(taxi, { stripId: 's-taxi', fdrId: 'f-taxi', facilityId: 'INCIRLIK', role: 'DEPARTURE', state: 'TAXI', callsign: 'HAWK31' });
});

test('a scrambler at INCIRLIK flags nothing at another Facility', () => {
  const { strips, fdrOf } = board();
  assert.deepEqual(conflictingGroundStrips(strips, fdrOf, 'OTHERFIELD'), []);
});

test('the scrambler never flags itself — nor another scrambler', () => {
  const { strips, fdrOf } = board([fdr('f-ace', 'ACE12', 'SCRAMBLE')], [strip('s-ace', 'f-ace', 'DEPARTURE', 'TAXI')]);
  const ids = conflictingGroundStrips(strips, fdrOf, 'INCIRLIK').map(s => s.stripId);
  assert.ok(!ids.includes('s-viper'));
  assert.ok(!ids.includes('s-ace'), 'a taxiing scrambler is a scrambler, not a conflict');
  assert.deepEqual(ids, ['s-taxi', 's-queue', 's-in']);
});

test('no scramble, no flags', () => {
  const { strips, fdrOf } = board();
  const calm = strips.filter(s => s.stripId !== 's-viper');
  assert.deepEqual(conflictingGroundStrips(calm, fdrOf, 'INCIRLIK'), []);
});

test('Strips off the movement area are not flagged: CLEARED, HELD, DEPARTED, and ARRIVAL before LANDED', () => {
  const { strips, fdrOf } = board([fdr('f-held', 'HELD1'), fdr('f-final', 'FINAL1'), fdr('f-landed', 'LAND1')], [
    strip('s-held', 'f-held', 'DEPARTURE', 'HELD'),
    strip('s-final', 'f-final', 'ARRIVAL', 'FINAL'),
    strip('s-landed', 'f-landed', 'ARRIVAL', 'LANDED'),
  ]);
  const ids = conflictingGroundStrips(strips, fdrOf, 'INCIRLIK').map(s => s.stripId);
  for (const quiet of ['s-alert', 's-airborne', 's-held', 's-final']) assert.ok(!ids.includes(quiet), quiet);
  assert.ok(ids.includes('s-landed'));
});

// ── alertPadConstraint ───────────────────────────────────────────────────

const SCRAMBLE = [{ stripId: 's-viper', fdrId: 'f-viper', facilityId: 'INCIRLIK', state: 'CLEARED', callsign: 'VIPER11' }];

test('alertPadConstraint names the configured route while a scramble is active', () => {
  const fieldState = { facilityId: 'INCIRLIK', alertPad: { name: 'Alert pad', accessRoute: 'ALERT ACCESS TAXIWAY', occupied: false, occupantFdrId: null } };
  assert.deepEqual(alertPadConstraint(fieldState, SCRAMBLE), {
    route: 'ALERT ACCESS TAXIWAY',
    text: 'ACCESS ROUTE ALERT ACCESS TAXIWAY CONSTRAINED — scramble in progress (VIPER11)',
  });
  assert.equal(alertPadConstraint(fieldState, []), null);
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
  assert.equal(facilityConfig.validateConfig(facilityConfig.DEFAULT_CONFIG).ok, true);
  assert.equal(facilityConfig.DEFAULT_CONFIG.fieldState.pads.alert.accessRoute, 'ALERT ACCESS TAXIWAY');
  const bad = structuredClone(facilityConfig.DEFAULT_CONFIG);
  bad.fieldState.pads.alert.accessRoute = 42;
  const result = facilityConfig.validateConfig(bad);
  assert.equal(result.ok, false);
  assert.match(result.detail, /accessRoute/);
  assert.equal(validateAlertPadConfig(null), null);
  assert.equal(validateAlertPadConfig({ name: 'Alert pad' }), null);
});

// ── the [GAP]: a scramble changes no NLA ─────────────────────────────────

test('a scramble changes no NLA', () => {
  // nla.js is handed the Strip, its own FDR and a Board-derived ctx; the
  // proof that no other flight's scramble can reach it is that nothing in
  // the module reads alertStatus at all. The Strip's OWN alert status is
  // toggled through every value and must change nothing either.
  const source = fs.readFileSync(path.join(here, '../src/efsp/nla.js'), 'utf8');
  assert.ok(!/alertStatus/.test(source), 'nla.js reads alertStatus');
  const ctx = { isOccupied: () => true, coveringPositionFor: () => null, facilityId: 'INCIRLIK' };
  const now = Date.UTC(2026, 8, 30, 12);
  for (const [role, states] of [['DEPARTURE', nla.DEPARTURE_STATES], ['ARRIVAL', nla.ARRIVAL_STATES]]) {
    for (const state of states) {
      const s = { ...strip('s1', 'f1', role, state), ownerPositionId: 'TWR' };
      const base = nla.computeNla(s, fdr('f1', 'X1', 'NONE'), now, ctx);
      for (const alertStatus of ['ALERT', 'SCRAMBLE']) {
        assert.deepEqual(nla.computeNla(s, fdr('f1', 'X1', alertStatus), now, ctx), base, `${role}/${state} with ${alertStatus}`);
      }
    }
  }
});
