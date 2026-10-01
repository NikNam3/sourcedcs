/* The ATO-first direction (crc-sync docs/adr/0071): OPS files a flight TAC_C2's
 * ATO import already made. The toolbar offers "file against ATO mission <msn>",
 * picked by default only when exactly one flight matches, and the create goes
 * out on the bind path (op.fdrId) — no new flight, no new code.
 * Mounts the real efsp-panel.js the way efsp-mission-line-panel.test.js does. */

import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/client-env.mjs';
import domStub from './helpers/dom-stub.js';
import { freshGraph } from './helpers/fresh-graph.mjs';

const { makeElement } = domStub;

// Unref'd timers: a panel timer never holds the test process open.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => { const t = realSetTimeout(fn, ms, ...args); if (t && typeof t.unref === 'function') t.unref(); return t; };
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms, ...args) => { const t = realSetInterval(fn, ms, ...args); if (t && typeof t.unref === 'function') t.unref(); return t; };

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

async function mount({ strips, fdrs }) {
  const sent = [];
  const els = {};
  for (const id of IDS) els[id] = makeElement(id.endsWith('-btn') ? 'button' : /role|stereo|bind/.test(id) ? 'select' : 'input');
  globalThis.document.getElementById = (id) => els[id] || null;
  globalThis.document.createElement = makeElement;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.startsWith('/api/stereo-routes')) return { ok: true, json: async () => ({ ok: true, routes: [] }) };
    return { ok: true, json: async () => ({ found: false }) }; // lookupFlightPlanClient
  };
  const g = freshGraph();
  const state = await g.import('panels/efsp/efsp-state.js');
  const ws = await g.import('panels/efsp/efsp-ws.js');
  const panel = await g.import('panels/efsp/efsp-panel.js');
  ws.setEfspSender('_sendEfsp', () => {});
  ws.sendEfspSetPositions('INCIRLIK', ['OPS']); // getActingPositions() = ['OPS']
  ws.setEfspSender('sendEfspCreateStrip', (actingPositionId, op, facilityId) => { sent.push({ actingPositionId, op, facilityId }); return 'mid'; });
  ws.setEfspSender('sendEfspMutation', () => 'mid');
  state.applyEfspSnapshot({ strips, fdrs, positions: [], bays: [], airspaces: [], correlations: [], marsa: [] });
  panel.initEfspPanel();
  const type = (v) => { els['efsp-new-strip-callsign'].value = v; for (const fn of els['efsp-new-strip-callsign']._listeners.input || []) fn({}); };
  const press = async () => { for (const fn of els['efsp-create-strip-btn']._listeners.click || []) await fn({ preventDefault() {} }); };
  return { els, sent, type, press };
}

test('OPS typing an ATO mission\'s callsign is offered "file against ATO mission", picked when it is the only one', async () => {
  const m = await mount({ fdrs: [fdr('f1', 'VIPER11', true)], strips: [strip('m1', 'f1', 'MISSION')] });
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

test('two matching ATO flights are both offered and neither is picked', async () => {
  const m = await mount({
    fdrs: [fdr('f1', 'VIPER11', true), fdr('f2', 'VIPER11', true)],
    strips: [strip('m1', 'f1', 'MISSION'), strip('m2', 'f2', 'MISSION')],
  });
  m.type('VIPER11');
  assert.equal(m.els['efsp-create-strip-bind'].children.length, 3);
  assert.equal(m.els['efsp-create-strip-bind'].value, '');
});

test('a flight that already has an ATC Strip, or no ATO, is not offered', async () => {
  const m = await mount({
    fdrs: [fdr('f1', 'VIPER11', true), fdr('f2', 'DUDE21', false)],
    strips: [strip('m1', 'f1', 'MISSION'), strip('d1', 'f1', 'DEPARTURE'), strip('m2', 'f2', 'MISSION')],
  });
  m.type('VIPER11');
  assert.equal(m.els['efsp-create-strip-bind'].hidden, true);
  m.type('DUDE21');
  assert.equal(m.els['efsp-create-strip-bind'].hidden, true);
});
