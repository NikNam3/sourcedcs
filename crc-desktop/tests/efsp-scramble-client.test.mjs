// §9.6 alert and scramble on the client (crc-sync's docs/adr/0070):
// scramble.js's pure half against crc-sync's alert-scramble.js (drift), the
// Strip chip, the constrained-route hook L1b's panel reads, and the Board-wide
// line. Indicators are the reachability harness's blind spot (T10), so they
// get their own tests here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import './helpers/client-env.mjs';
import domStub from './helpers/dom-stub.js';
import { freshGraph } from './helpers/fresh-graph.mjs';
import * as client from '../app/public/js/panels/efsp/scramble.js';
import * as state from '../app/public/js/panels/efsp/efsp-state.js';

const require = createRequire(import.meta.url);
const server = require('../../crc-sync/src/efsp/alert-scramble.js');

// ── fixtures ─────────────────────────────────────────────────────────────

const flightData = (flightDataId, callsign, alertStatus = 'NONE') => ({
  flightDataId, rev: 1, identity: { callsign }, filed: {}, assigned: {},
  military: { ordnanceState: 'CLEAN', hookRequired: false, alertStatus },
});
const strip = (stripId, flightDataId, stripType, state, facilityId = 'INCIRLIK', ownerPositionId = 'GC', bayId = 'gc-taxi-out') => ({
  stripId, flightDataId, stripType, state, facilityId, ownerPositionId, bayId, rackId: 'main', orderKey: 'V', rev: 1,
  annotations: {}, flags: {}, coordination: null, tofiCoordination: null, airspaceEntry: null, previousLeg: null,
});

const FLIGHT_DATA_LIST = [
  flightData('f-viper', 'VIPER11', 'SCRAMBLE'), flightData('f-alert', 'COLT21', 'ALERT'), flightData('f-taxi', 'HAWK31'),
  flightData('f-queue', 'EAGLE41'), flightData('f-in', 'TANKER51'), flightData('f-gone', 'BONE61', 'SCRAMBLE'), flightData('f-other', 'OTHER71'),
];
const STRIPS = [
  strip('s-viper', 'f-viper', 'DEPARTURE', 'CLEARED', 'INCIRLIK', 'CD', 'cd-cleared'),
  strip('s-alert', 'f-alert', 'DEPARTURE', 'CLEARED', 'INCIRLIK', 'CD', 'cd-cleared'),
  strip('s-taxi', 'f-taxi', 'DEPARTURE', 'TAXI'),
  strip('s-queue', 'f-queue', 'DEPARTURE', 'RUNWAY_QUEUE', 'INCIRLIK', 'LC', 'lc-runway-queue'),
  strip('s-in', 'f-in', 'ARRIVAL', 'TAXI_IN'),
  strip('s-gone', 'f-gone', 'DEPARTURE', 'DEPARTED', 'INCIRLIK', 'LC', 'twr-departed'),
  strip('s-other', 'f-other', 'DEPARTURE', 'TAXI', 'CENTER'),
];
const flightDataMap = new Map(FLIGHT_DATA_LIST.map(f => [f.flightDataId, f]));
const flightDataOf = (id) => flightDataMap.get(id) || null;

function load(strips = STRIPS, flightDataList = FLIGHT_DATA_LIST, runwayStatuses = []) {
  state._resetEfspStateForTest();
  state.applyEfspSnapshot({ strips, flightDataList, positions: [], bays: [], boardSeq: 1, runwayStatuses });
}

// ── drift ────────────────────────────────────────────────────────────────

test('drift: scramble.js answers exactly as crc-sync\'s alert-scramble.js over one fixture table', () => {
  assert.deepEqual(client.SCRAMBLE_PRE_AIRBORNE, server.SCRAMBLE_PRE_AIRBORNE);
  assert.deepEqual(client.GROUND_STATES, server.GROUND_STATES);
  const extra = [strip('s-ace', 'f-ace', 'DEPARTURE', 'TAXI'), strip('s-missing', 'f-missing', 'DEPARTURE', 'LUAW')];
  const flightDataList = (id) => (id === 'f-ace' ? flightData('f-ace', 'ACE12', 'SCRAMBLE') : flightDataOf(id));
  for (const strips of [STRIPS, [...STRIPS, ...extra], [], STRIPS.filter(s => s.stripId !== 's-viper')]) {
    for (const facilityId of [undefined, 'INCIRLIK', 'CENTER']) {
      assert.deepEqual(client.activeScrambles(strips, flightDataList, facilityId), server.activeScrambles(strips, flightDataList, facilityId));
      if (facilityId) {
        assert.deepEqual(client.conflictingGroundStrips(strips, flightDataList, facilityId), server.conflictingGroundStrips(strips, flightDataList, facilityId));
      }
    }
  }
  const scrambles = server.activeScrambles(STRIPS, flightDataOf, 'INCIRLIK');
  for (const runwayStatus of [null, { alertPad: {} }, { alertPad: { accessRoute: 'ALERT ACCESS TAXIWAY' } }, { alertPad: { accessRoute: 7 } }]) {
    assert.deepEqual(client.alertPadConstraint(runwayStatus, scrambles), server.alertPadConstraint(runwayStatus, scrambles));
    assert.deepEqual(client.alertPadConstraint(runwayStatus, []), server.alertPadConstraint(runwayStatus, []));
    assert.equal(client.accessRouteText(runwayStatus), server.accessRouteText(runwayStatus));
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

test('scrambleAlertsFor names the configured route when runway status is loaded', () => {
  load(STRIPS, FLIGHT_DATA_LIST, [{ facilityId: 'INCIRLIK', alertPad: { name: 'Alert pad', accessRoute: 'ALERT ACCESS TAXIWAY' } }]);
  const [chip] = client.scrambleAlertsFor(state.getEfspStrip('s-taxi'));
  assert.match(chip.reason, /keep clear of ALERT ACCESS TAXIWAY\./);
});

// ── alertPadConstraintFor ────────────────────────────────────────────────

test('alertPadConstraintFor without getEfspRunwayStatus still marks the route (L1b not loaded)', () => {
  load();
  assert.equal(state.getEfspRunwayStatus('INCIRLIK'), null, 'no field state loaded');
  assert.equal(client.alertPadConstraintFor('INCIRLIK'), 'ALERT-PAD ACCESS ROUTE CONSTRAINED — scramble in progress (VIPER11)');
  assert.equal(client.alertPadConstraintFor('CENTER'), null);
});

test('alertPadConstraintFor with getEfspRunwayStatus names the configured route', () => {
  load(STRIPS, FLIGHT_DATA_LIST, [{ facilityId: 'INCIRLIK', alertPad: { name: 'Alert pad', accessRoute: 'ALERT ACCESS TAXIWAY' } }]);
  assert.equal(client.alertPadConstraintFor('INCIRLIK'), 'ACCESS ROUTE ALERT ACCESS TAXIWAY CONSTRAINED — scramble in progress (VIPER11)');
});

// ── the Board-wide line ──────────────────────────────────────────────────

/** efsp-state.js + scramble.js in their own sandbox, against the DOM stub. */
async function lineSandbox({ strips = STRIPS, flightDataList = FLIGHT_DATA_LIST, signedOn = [] } = {}) {
  const line = domStub.makeElement('div');
  line.id = 'efsp-scramble-line';
  const selected = [];
  globalThis.document.getElementById = (id) => (id === 'efsp-scramble-line' ? line : null);
  globalThis.document.createElement = (tag) => domStub.makeElement(tag);
  const g = freshGraph();
  const st = await g.import('panels/efsp/efsp-state.js');
  const ws = await g.import('panels/efsp/efsp-ws.js');
  const bay = await g.import('panels/efsp/bay-view.js');
  const scramble = await g.import('panels/efsp/scramble.js');
  ws.setEfspSender('_sendEfsp', () => {});
  ws.sendEfspSetPositions('INCIRLIK', signedOn);
  bay._setSelectEfspStripByIdForTest((id) => { selected.push(id); return true; });
  st.applyEfspSnapshot({ strips, flightDataList, positions: [], bays: [], boardSeq: 1 });
  const render = () => scramble.renderEfspScrambleLine();
  return { line, selected, render };
}

const click = (el) => { for (const fn of el._listeners.click || []) fn({ stopPropagation() {} }); };

test('the line is hidden with no scramble', async () => {
  const { line, render } = await lineSandbox({ strips: STRIPS.filter(s => s.stripId !== 's-viper') });
  render();
  assert.equal(line.hidden, true);
  assert.equal(line.children.length, 0);
});

test('one row per scramble: callsign button, Facility, state, the constrained route, the flagged count', async () => {
  const { line, render, selected } = await lineSandbox();
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

test('two scramblers: two rows, each ground Strip counted once', async () => {
  const strips = [...STRIPS, strip('s-ace', 'f-ace', 'DEPARTURE', 'TAXI')];
  const { line, render } = await lineSandbox({ strips, flightDataList: [...FLIGHT_DATA_LIST, flightData('f-ace', 'ACE12', 'SCRAMBLE')] });
  render();
  assert.deepEqual(line.children.map(r => r.children[1].textContent), ['ACE12', 'VIPER11']);
  for (const r of line.children) assert.match(r.children[2].textContent, /· 3 flagged$/);
});
