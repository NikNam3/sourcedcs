// The carrier management panel (crc-sync docs/adr/0113): drawn from the real store's hull view, so the client is tested against
// exactly what the server sends. Wiring tests against the DOM stub: the right op goes out for what was typed, the sources are
// shown, the reset gives the automatic value back, and a Position that only reads gets no inputs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import './helpers/client-env.mjs';
import domStub from './helpers/dom-stub.js';
import * as state from '../app/public/js/panels/efsp/carrier-state.js';
import { initCarrierManagementPanel, renderCarrierManagement } from '../app/public/js/panels/efsp/carrier-management-panel.js';
import { setEfspSender, sendEfspSetPositions } from '../app/public/js/panels/efsp/efsp-ws.js';

const require = createRequire(import.meta.url);
const { CarrierStore } = require('../../crc-sync/src/efsp/carrier-store.js');
const hullConfig = require('../../crc-sync/src/efsp/carrier/hull-config.js');
const { makeElement, descendants } = domStub;

const clock = { now: () => Date.UTC(2026, 5, 1, 9, 0), source: 'TEST' };

function storeWith(ops = [], { ship = true } = {}) {
  const store = new CarrierStore({ hulls: hullConfig.getHulls(), clock });
  if (ship) store.setShipState('CVN-72', { hullId: 'CVN-72', found: true, stale: false, headingRef: 'TRUE', headingDeg: 346, brcDeg: 346, finalBearingDeg: 337, speedKt: 15, magneticVariationDeg: 5, altimeterInHg: 29.92, altimeterSource: 'THEATER_WEATHER', atUtc: clock.now(), lat: 35, lon: 36 });
  for (const [field, value] of ops) store.apply({ clientMutationId: Math.random().toString(), op: { kind: 'SetCarrierState', field, value } }, 'CV_PRIFLY', 'p');
  return store;
}

const sent = [];
setEfspSender('sendEfspCarrierMutation', (acting, hullId, baseRev, op) => { sent.push({ acting, hullId, op }); });
const els = {};
globalThis.document.getElementById = (id) => els[id] || null;
els['carrier-mgmt-body'] = makeElement('div');
els['carrier-mgmt-empty'] = makeElement('div');

function show(store, signedOn) {
  sendEfspSetPositions('CARRIER', signedOn);
  state._resetEfspCarrierStateForTest();
  state.applyEfspCarrierSnapshot({ carriers: [JSON.parse(JSON.stringify(store.view()))] });
  els['carrier-mgmt-body'] = makeElement('div');
  initCarrierManagementPanel();
  sent.length = 0;
  return descendants(els['carrier-mgmt-body']);
}
const by = (nodes, attr, field) => nodes.find((n) => n.dataset && n.dataset[attr] === field);

test('before a snapshot the panel says there is no carrier and draws nothing', () => {
  sendEfspSetPositions('CARRIER', []);
  state._resetEfspCarrierStateForTest();
  els['carrier-mgmt-body'] = makeElement('div');
  initCarrierManagementPanel();
  assert.equal(els['carrier-mgmt-empty'].hidden, false);
  assert.equal(els['carrier-mgmt-body'].hidden, true);
});

test('every row shows the value in force and where it comes from: DCS, default, set, not known', () => {
  const nodes = show(storeWith([['firstFix', 24]]), ['CV_PRIFLY']);
  assert.equal(els['carrier-mgmt-empty'].hidden, true);
  assert.equal(by(nodes, 'carrierValue', 'brc').textContent, '341', 'the ship heads 346 true; 341 magnetic (variation 5 E)');
  assert.equal(by(nodes, 'carrierUnit', 'brc').textContent, '°M');
  assert.match(by(nodes, 'carrierSource', 'brc').textContent, /^DCS/);
  assert.equal(by(nodes, 'carrierValue', 'finalBearing').textContent, '332');
  assert.match(by(nodes, 'carrierSource', 'finalBearing').textContent, /^default · BRC − 9° \(angled deck\)/);
  assert.equal(by(nodes, 'carrierValue', 'radial').textContent, '152');
  assert.equal(by(nodes, 'carrierValue', 'firstFix').textContent, '24');
  assert.equal(by(nodes, 'carrierSource', 'firstFix').textContent, 'set · automatic 21');
  assert.equal(by(nodes, 'carrierValue', 'rampTime').textContent, '—');
  assert.equal(by(nodes, 'carrierSource', 'rampTime').textContent, 'not known');
  assert.equal(by(nodes, 'carrierValue', 'altimeter').textContent, '29.92');
  assert.equal(by(nodes, 'carrierValue', 'case').textContent, 'III');
  assert.equal(by(nodes, 'carrierValue', 'tankerAltitude').textContent, '6000');
});

test('PriFly and the Marshal get inputs, the others only read; the reset button appears only on an override', () => {
  const store = storeWith([['firstFix', 24]]);
  let nodes = show(store, ['CV_PRIFLY']);
  assert.equal(by(nodes, 'carrierField', 'brc').hidden, false);
  assert.equal(by(nodes, 'carrierReset', 'firstFix').hidden, false);
  assert.equal(by(nodes, 'carrierReset', 'brc').hidden, true, 'nothing overridden, nothing to give back');
  assert.equal(by(nodes, 'carrierReset', 'firstFix').textContent, 'Use default');
  assert.equal(by(nodes, 'carrierReset', 'brc').textContent, 'Use DCS');
  nodes = show(store, ['CV_MARSHAL']);
  assert.equal(by(nodes, 'carrierField', 'brc').hidden, false);
  nodes = show(store, ['CV_APP1']);
  for (const f of ['brc', 'case', 'rampTime', 'tankerGive']) {
    assert.equal(by(nodes, 'carrierField', f).hidden, true, `${f}: no input for the lanes`);
    assert.equal(by(nodes, 'carrierValue', f).hidden, false);
  }
  assert.equal(by(nodes, 'carrierReset', 'firstFix').hidden, true);
  nodes = show(store, []);
  assert.equal(by(nodes, 'carrierField', 'brc').hidden, true, 'no Position signed on: read only');
});

test('Enter sends what was typed as the signed-on editor; a select sends its value; reset and an empty field send null', () => {
  const nodes = show(storeWith([['firstFix', 24]]), ['CV_APP1', 'CV_MARSHAL']);
  const press = (input, key = 'Enter') => (input._listeners.keydown || []).forEach((fn) => fn({ key, preventDefault() {} }));
  const brc = by(nodes, 'carrierField', 'brc');
  brc.value = '100';
  press(brc);
  assert.deepEqual(sent.pop(), { acting: 'CV_MARSHAL', hullId: 'CVN-72', op: { kind: 'SetCarrierState', field: 'brc', value: '100' } });
  const ramp = by(nodes, 'carrierField', 'rampTime');
  ramp.value = '2040';
  press(ramp);
  assert.deepEqual(sent.pop().op, { kind: 'SetCarrierState', field: 'rampTime', value: '2040' });
  ramp.value = '  ';
  press(ramp);
  assert.deepEqual(sent.pop().op, { kind: 'SetCarrierState', field: 'rampTime', value: null }, 'an empty field is the reset');
  const cs = by(nodes, 'carrierField', 'case');
  cs.value = 'II';
  (cs._listeners.change || []).forEach((fn) => fn());
  assert.deepEqual(sent.pop().op, { kind: 'SetCarrierState', field: 'case', value: 'II' });
  const onStation = by(nodes, 'carrierField', 'tankerOnStation');
  onStation.value = 'true';
  (onStation._listeners.change || []).forEach((fn) => fn());
  assert.deepEqual(sent.pop().op, { kind: 'SetCarrierState', field: 'tankerOnStation', value: true }, 'a boolean, not the word');
  (by(nodes, 'carrierReset', 'firstFix')._listeners.click || []).forEach((fn) => fn());
  assert.deepEqual(sent.pop().op, { kind: 'SetCarrierState', field: 'firstFix', value: null });
  press(brc, 'a');
  assert.equal(sent.length, 0, 'another key sends nothing');
});

test('a ship that cannot be found is the one thing shown in amber; nothing else is a problem', () => {
  let nodes = show(storeWith([], { ship: false }), ['CV_PRIFLY']);
  const status = by(nodes, 'carrierMgmt', 'status');
  assert.equal(status.dataset.problem, '1');
  assert.match(status.textContent, /hull not found/);
  assert.equal(by(nodes, 'carrierValue', 'brc').textContent, '—', 'no DCS heading: nothing invented');
  assert.equal(by(nodes, 'carrierSource', 'brc').textContent, 'not known');
  nodes = show(storeWith([['brc', 100]], { ship: false }), ['CV_PRIFLY']);
  assert.equal(by(nodes, 'carrierValue', 'brc').textContent, '—', 'a typed magnetic bearing needs the variation, which needs a ship: the server refused it');
  nodes = show(storeWith(), ['CV_PRIFLY']);
  assert.equal(by(nodes, 'carrierMgmt', 'status').dataset.problem, '');
});

test('a delta redraws in place and leaves a field being typed in alone', () => {
  const store = storeWith();
  const nodes = show(store, ['CV_PRIFLY']);
  const ceiling = by(nodes, 'carrierField', 'ceiling');
  ceiling.value = '12';
  ceiling.dataset.dirty = '1'; // the controller has typed into it
  store.apply({ clientMutationId: 'x', op: { kind: 'SetCarrierState', field: 'ceiling', value: 800 } }, 'CV_MARSHAL', 'm');
  state.applyEfspCarrierDelta({ carriers: { updated: [JSON.parse(JSON.stringify(store.view()))] } });
  renderCarrierManagement();
  assert.equal(ceiling.value, '12', 'the typing is not torn out');
  assert.equal(by(nodes, 'carrierValue', 'ceiling').textContent, '800', 'the value in force still updates');
  ceiling.dataset.dirty = '';
  renderCarrierManagement();
  assert.equal(ceiling.value, '800');
});
