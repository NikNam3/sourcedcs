'use strict';

/* The ATO-first direction (crc-sync docs/adr/0071): OPS files a flight TAC_C2's
 * ATO import already made. The toolbar offers "file against ATO mission <msn>",
 * picked by default only when exactly one flight matches, and the create goes
 * out on the bind path (op.fdrId) — no new flight, no new code.
 * Mounts the real efsp-panel.js the way efsp-mission-line-panel.test.js does. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeElement } = require('./helpers/dom-stub.js');

const CLIENT = path.join(__dirname, '../app/public/js/panels/efsp');
const IDS = [
  'efsp-panel', 'efsp-position-tabs', 'efsp-bay-tabs', 'efsp-bay-content',
  'efsp-new-strip-callsign', 'efsp-create-strip-btn', 'efsp-create-strip-msg',
  'efsp-create-strip-role', 'efsp-create-strip-stereo', 'efsp-create-strip-bind',
  'efsp-dot-command-input', 'efsp-dot-command-preview',
  'efsp-mutation-error', 'efsp-mutation-warning', 'efsp-connection-banner',
];

function fdr(fdrId, callsign, ato) {
  return {
    fdrId, rev: 1, provenance: {}, identity: { callsign, beaconAssigned: ato ? '4521' : '0101', trackDegradationFlag: 'NONE' },
    filed: {}, assigned: {}, tofi: {}, airspace: {}, comms: {}, mission: { missionNumber: ato ? '1101A' : null },
    military: { ordnanceState: 'CLEAN', hookRequired: false, alertStatus: 'NONE', mtr: {} },
    ...(ato ? { ato: { missionNumber: '1101A', lineId: '1101A#0' } } : {}),
  };
}
function strip(stripId, fdrId, role, over = {}) {
  return {
    stripId, cid: '001', fdrId, rev: 1, role, state: role === 'MISSION' ? 'TASKED' : 'PROPOSED',
    ownerPositionId: role === 'MISSION' ? 'TAC_C2' : 'OPS', facilityId: role === 'MISSION' ? 'TACTICAL' : 'INCIRLIK',
    bayId: role === 'MISSION' ? 'tac-c2-tasked' : 'ops-proposed', rackId: 'main', orderKey: 'V',
    annotations: {}, flags: {}, coordination: null, tofiCoordination: null, airspaceEntry: null, ...over,
  };
}

function mount({ strips, fdrs }) {
  const sent = [];
  const els = {};
  for (const id of IDS) els[id] = makeElement(id.endsWith('-btn') ? 'button' : /role|stereo|bind/.test(id) ? 'select' : 'input');
  const unref = (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; };
  const sandbox = {
    console, module: { exports: {} }, setTimeout: unref, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    Date, JSON, Math, Number, Set, Map, Array, Object, String, Boolean, RegExp, isNaN, parseInt, parseFloat, Promise,
    document: { getElementById: (id) => els[id] || null, createElement: makeElement, addEventListener() {}, removeEventListener() {} },
    window: {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of ['efsp-nla.js', 'strip-template.js', 'efsp-state.js', 'efsp-arrivals.js', 'dot-command.js',
    'efsp-gestures.js', 'annotation-editor.js', 'strip-drag.js', 'correlation-highlight.js',
    'marsa-badge.js', 'strip-fields.js', 'bay-view.js', 'strip-view.js', 'efsp-stereo-routes.js', 'efsp-panel.js']) {
    vm.runInContext(fs.readFileSync(path.join(CLIENT, file), 'utf8'), sandbox, { filename: file });
  }
  sandbox.getActingPositions = () => ['OPS'];
  sandbox.liveStripsForCallsign = () => [];
  sandbox.sendEfspCreateStrip = (actingPositionId, op, facilityId) => { sent.push({ actingPositionId, op, facilityId }); return 'mid'; };
  sandbox.sendEfspMutation = () => 'mid';
  sandbox.updateMap = () => {};
  sandbox.lookupFlightPlanClient = async () => ({ found: false });
  sandbox.listStereoRoutesClient = async () => [];
  sandbox.applyEfspSnapshot({ strips, fdrs, positions: [], bays: [], airspaces: [], correlations: [], marsa: [] });
  sandbox.initEfspPanel();
  const type = (v) => { els['efsp-new-strip-callsign'].value = v; for (const fn of els['efsp-new-strip-callsign']._listeners.input || []) fn({}); };
  const press = async () => { for (const fn of els['efsp-create-strip-btn']._listeners.click || []) await fn({ preventDefault() {} }); };
  return { els, sent, type, press };
}

test('OPS typing an ATO mission\'s callsign is offered "file against ATO mission", picked when it is the only one', async () => {
  const m = mount({ fdrs: [fdr('f1', 'VIPER11', true)], strips: [strip('m1', 'f1', 'MISSION')] });
  const bind = m.els['efsp-create-strip-bind'];
  m.type('VIPER1');
  assert.equal(bind.hidden, true);
  m.type('viper11');
  assert.equal(bind.hidden, false);
  assert.equal(bind.value, 'f1');
  assert.match(bind.children[1].textContent, /file against ATO mission 1101A · VIPER11 · 4521/);
  await m.press();
  assert.equal(m.sent.length, 1);
  assert.equal(m.sent[0].actingPositionId, 'OPS');
  assert.equal(m.sent[0].op.fdrId, 'f1', 'the bind path: the same flight, no new code');
  assert.equal(m.sent[0].op.fdr, undefined);
});

test('two matching ATO flights are both offered and neither is picked', () => {
  const m = mount({
    fdrs: [fdr('f1', 'VIPER11', true), fdr('f2', 'VIPER11', true)],
    strips: [strip('m1', 'f1', 'MISSION'), strip('m2', 'f2', 'MISSION')],
  });
  m.type('VIPER11');
  assert.equal(m.els['efsp-create-strip-bind'].children.length, 3);
  assert.equal(m.els['efsp-create-strip-bind'].value, '');
});

test('a flight that already has an ATC Strip, or no ATO, is not offered', () => {
  const m = mount({
    fdrs: [fdr('f1', 'VIPER11', true), fdr('f2', 'DUDE21', false)],
    strips: [strip('m1', 'f1', 'MISSION'), strip('d1', 'f1', 'DEPARTURE'), strip('m2', 'f2', 'MISSION')],
  });
  m.type('VIPER11');
  assert.equal(m.els['efsp-create-strip-bind'].hidden, true);
  m.type('DUDE21');
  assert.equal(m.els['efsp-create-strip-bind'].hidden, true);
});
