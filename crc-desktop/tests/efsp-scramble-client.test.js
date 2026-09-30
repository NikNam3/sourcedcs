'use strict';

// §9.6 alert and scramble on the client (crc-sync's docs/adr/0070):
// scramble.js's pure half against crc-sync's alert-scramble.js (drift), the
// Strip chip, the constrained-route hook L1b's panel reads, and the Board-wide
// line. Indicators are the reachability harness's blind spot (T10), so they
// get their own tests here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const domStub = require('./helpers/dom-stub.js');

const CLIENT = path.join(__dirname, '../app/public/js/panels/efsp');
const server = require('../../crc-sync/src/efsp/alert-scramble.js');
const client = require(path.join(CLIENT, 'scramble.js'));
const state = require(path.join(CLIENT, 'efsp-state.js'));

// scramble.js reaches for these as plain globals, as it does in the browser.
global.getAllEfspStrips = state.getAllEfspStrips;
global.getEfspFdr = state.getEfspFdr;
global.getEfspStrip = state.getEfspStrip;

// ── fixtures ─────────────────────────────────────────────────────────────

const fdr = (fdrId, callsign, alertStatus = 'NONE') => ({
  fdrId, rev: 1, identity: { callsign }, filed: {}, assigned: {},
  military: { ordnanceState: 'CLEAN', hookRequired: false, alertStatus },
});
const strip = (stripId, fdrId, role, state, facilityId = 'INCIRLIK', ownerPositionId = 'GND', bayId = 'gnd-taxi-out') => ({
  stripId, fdrId, role, state, facilityId, ownerPositionId, bayId, rackId: 'main', orderKey: 'V', rev: 1,
  annotations: {}, flags: {}, coordination: null, tofiCoordination: null, airspaceEntry: null, previousLeg: null,
});

const FDRS = [
  fdr('f-viper', 'VIPER11', 'SCRAMBLE'), fdr('f-alert', 'COLT21', 'ALERT'), fdr('f-taxi', 'HAWK31'),
  fdr('f-queue', 'EAGLE41'), fdr('f-in', 'TANKER51'), fdr('f-gone', 'BONE61', 'SCRAMBLE'), fdr('f-other', 'OTHER71'),
];
const STRIPS = [
  strip('s-viper', 'f-viper', 'DEPARTURE', 'CLEARED', 'INCIRLIK', 'CD', 'cd-cleared'),
  strip('s-alert', 'f-alert', 'DEPARTURE', 'CLEARED', 'INCIRLIK', 'CD', 'cd-cleared'),
  strip('s-taxi', 'f-taxi', 'DEPARTURE', 'TAXI'),
  strip('s-queue', 'f-queue', 'DEPARTURE', 'RUNWAY_QUEUE', 'INCIRLIK', 'TWR', 'twr-runway-queue'),
  strip('s-in', 'f-in', 'ARRIVAL', 'TAXI_IN'),
  strip('s-gone', 'f-gone', 'DEPARTURE', 'DEPARTED', 'INCIRLIK', 'TWR', 'twr-departed'),
  strip('s-other', 'f-other', 'DEPARTURE', 'TAXI', 'CENTER'),
];
const fdrMap = new Map(FDRS.map(f => [f.fdrId, f]));
const fdrOf = (id) => fdrMap.get(id) || null;

function load(strips = STRIPS, fdrs = FDRS) {
  state._resetEfspStateForTest();
  state.applyEfspSnapshot({ strips, fdrs, positions: [], bays: [], boardSeq: 1 });
}

// ── drift ────────────────────────────────────────────────────────────────

test('drift: scramble.js answers exactly as crc-sync\'s alert-scramble.js over one fixture table', () => {
  assert.deepEqual(client.SCRAMBLE_PRE_AIRBORNE, server.SCRAMBLE_PRE_AIRBORNE);
  assert.deepEqual(client.GROUND_STATES, server.GROUND_STATES);
  const extra = [strip('s-ace', 'f-ace', 'DEPARTURE', 'TAXI'), strip('s-missing', 'f-missing', 'DEPARTURE', 'LUAW')];
  const fdrs = (id) => (id === 'f-ace' ? fdr('f-ace', 'ACE12', 'SCRAMBLE') : fdrOf(id));
  for (const strips of [STRIPS, [...STRIPS, ...extra], [], STRIPS.filter(s => s.stripId !== 's-viper')]) {
    for (const facilityId of [undefined, 'INCIRLIK', 'CENTER']) {
      assert.deepEqual(client.activeScrambles(strips, fdrs, facilityId), server.activeScrambles(strips, fdrs, facilityId));
      if (facilityId) {
        assert.deepEqual(client.conflictingGroundStrips(strips, fdrs, facilityId), server.conflictingGroundStrips(strips, fdrs, facilityId));
      }
    }
  }
  const scrambles = server.activeScrambles(STRIPS, fdrOf, 'INCIRLIK');
  for (const fieldState of [null, { alertPad: {} }, { alertPad: { accessRoute: 'ALERT ACCESS TAXIWAY' } }, { alertPad: { accessRoute: 7 } }]) {
    assert.deepEqual(client.alertPadConstraint(fieldState, scrambles), server.alertPadConstraint(fieldState, scrambles));
    assert.deepEqual(client.alertPadConstraint(fieldState, []), server.alertPadConstraint(fieldState, []));
    assert.equal(client.accessRouteText(fieldState), server.accessRouteText(fieldState));
  }
});

// ── scrambleAlertsFor ────────────────────────────────────────────────────

test('scrambleAlertsFor: the scrambler gets a red SCRAMBLE chip that leaves sequencing to the controller', () => {
  load();
  const [chip] = client.scrambleAlertsFor(state.getEfspStrip('s-viper'));
  assert.deepEqual({ key: chip.key, tone: chip.tone, text: chip.text }, { key: 'scram', tone: 'bad', text: 'SCRAMBLE' });
  assert.match(chip.reason, /SOURCE practice/);
  assert.match(chip.reason, /controller's call/);
  assert.doesNotMatch(chip.reason, /FAA|USAF|7110/);
});

test('scrambleAlertsFor: a conflicting ground Strip gets an amber chip naming the scrambler and what clears it', () => {
  load();
  for (const id of ['s-taxi', 's-queue', 's-in']) {
    const [chip] = client.scrambleAlertsFor(state.getEfspStrip(id));
    assert.equal(chip.tone, 'attn', id);
    assert.equal(chip.text, 'SCRAMBLE');
    assert.equal(chip.reason,
      'VIPER11 is scrambling from INCIRLIK. SOURCE practice: keep clear of the alert-pad access route. '
      + 'Clears when VIPER11 is airborne or the scramble is cancelled.');
  }
});

test('scrambleAlertsFor: a quiet Strip, an ALERT Strip, another Facility and a DEPARTED scrambler get nothing', () => {
  load();
  for (const id of ['s-alert', 's-other', 's-gone']) assert.deepEqual(client.scrambleAlertsFor(state.getEfspStrip(id)), [], id);
  load(STRIPS.filter(s => s.stripId !== 's-viper'));
  for (const id of ['s-taxi', 's-queue', 's-in']) assert.deepEqual(client.scrambleAlertsFor(state.getEfspStrip(id)), [], `${id} with no scramble`);
});

test('scrambleAlertsFor names the configured route when field state is loaded', () => {
  load();
  global.getEfspFieldState = (id) => (id === 'INCIRLIK' ? { facilityId: id, alertPad: { name: 'Alert pad', accessRoute: 'ALERT ACCESS TAXIWAY' } } : null);
  try {
    const [chip] = client.scrambleAlertsFor(state.getEfspStrip('s-taxi'));
    assert.match(chip.reason, /keep clear of ALERT ACCESS TAXIWAY\./);
  } finally {
    delete global.getEfspFieldState;
  }
});

// ── alertPadConstraintFor ────────────────────────────────────────────────

test('alertPadConstraintFor without getEfspFieldState still marks the route (L1b not loaded)', () => {
  load();
  assert.equal(typeof global.getEfspFieldState, 'undefined');
  assert.equal(client.alertPadConstraintFor('INCIRLIK'), 'ALERT-PAD ACCESS ROUTE CONSTRAINED — scramble in progress (VIPER11)');
  assert.equal(client.alertPadConstraintFor('CENTER'), null);
});

test('alertPadConstraintFor with getEfspFieldState names the configured route', () => {
  load();
  global.getEfspFieldState = () => ({ alertPad: { name: 'Alert pad', accessRoute: 'ALERT ACCESS TAXIWAY' } });
  try {
    assert.equal(client.alertPadConstraintFor('INCIRLIK'), 'ACCESS ROUTE ALERT ACCESS TAXIWAY CONSTRAINED — scramble in progress (VIPER11)');
  } finally {
    delete global.getEfspFieldState;
  }
});

// ── the Board-wide line ──────────────────────────────────────────────────

/** efsp-state.js + scramble.js in their own sandbox, against the DOM stub. */
function lineSandbox({ strips = STRIPS, fdrs = FDRS, held = [] } = {}) {
  const line = domStub.makeElement('div');
  line.id = 'efsp-scramble-line';
  const selected = [];
  const sandbox = {
    module: { exports: {} }, console,
    document: {
      getElementById: (id) => (id === 'efsp-scramble-line' ? line : null),
      createElement: (tag) => domStub.makeElement(tag),
    },
    getActingPositions: () => held,
    selectEfspStripById: (id) => { selected.push(id); return true; },
  };
  vm.createContext(sandbox);
  for (const file of ['efsp-state.js', 'scramble.js']) {
    vm.runInContext(fs.readFileSync(path.join(CLIENT, file), 'utf8'), sandbox, { filename: file });
  }
  vm.runInContext('applyEfspSnapshot', sandbox)({ strips, fdrs, positions: [], bays: [], boardSeq: 1 });
  const render = () => vm.runInContext('renderEfspScrambleLine', sandbox)();
  return { line, selected, render, sandbox };
}

const click = (el) => { for (const fn of el._listeners.click || []) fn({ stopPropagation() {} }); };

test('the line is hidden with no scramble', () => {
  const { line, render } = lineSandbox({ strips: STRIPS.filter(s => s.stripId !== 's-viper') });
  render();
  assert.equal(line.hidden, true);
  assert.equal(line.children.length, 0);
});

test('one row per scramble: callsign button, Facility, state, the constrained route, the flagged count', () => {
  const { line, render, selected } = lineSandbox();
  render();
  assert.equal(line.hidden, false);
  assert.equal(line.children.length, 1);
  const row = line.children[0];
  const [tag, cs, detail] = row.children;
  assert.equal(tag.textContent, 'SCRAMBLE');
  assert.equal(cs.tagName, 'button');
  assert.equal(cs.textContent, 'VIPER11');
  assert.equal(detail.textContent, 'INCIRLIK · CLEARED · the alert-pad access route constrained · 3 flagged');
  assert.match(row.className, /efsp-scramble-row-new/, 'a new scramble flashes once');
  click(cs);
  assert.deepEqual(selected, ['s-viper']);

  render();
  assert.doesNotMatch(line.children[0].className, /efsp-scramble-row-new/, 'and only once');
});

test('two scramblers: two rows, each ground Strip counted once', () => {
  const strips = [...STRIPS, strip('s-ace', 'f-ace', 'DEPARTURE', 'TAXI')];
  const { line, render } = lineSandbox({ strips, fdrs: [...FDRS, fdr('f-ace', 'ACE12', 'SCRAMBLE')] });
  render();
  assert.deepEqual(line.children.map(r => r.children[1].textContent), ['ACE12', 'VIPER11']);
  for (const r of line.children) assert.match(r.children[2].textContent, /· 3 flagged$/);
});
