// The measurement hooks, wired into the real Strip panel (docs/adr/0072):
// efsp-panel.js's search and Bay tabs, bay-view.js's selection and gesture
// entry points, strip-view.js's Offset menu item. Mounted against the shared
// DOM stub the way efsp-mission-line-panel.test.mjs does, with and without
// efsp-metrics-client.js loaded — so the last test can prove a hook never
// changes what the Strip panel dispatches (T4).

import test from 'node:test';
import assert from 'node:assert/strict';

import './helpers/client-env.mjs';
import domStub from './helpers/dom-stub.js';
import { freshGraph } from './helpers/fresh-graph.mjs';

const { makeElement, descendants } = domStub;
const IDS = [
  'efsp-panel', 'efsp-position-tabs', 'efsp-bay-tabs', 'efsp-bay-content',
  'efsp-new-strip-callsign', 'efsp-create-strip-btn', 'efsp-create-strip-msg',
  'efsp-create-strip-type', 'efsp-create-strip-stereo', 'efsp-create-strip-bind',
  'efsp-dot-command-input', 'efsp-dot-command-preview',
  'efsp-mutation-error', 'efsp-mutation-warning', 'efsp-connection-banner',
];

// Unref'd timers, so the metrics client's flush timer never holds the test process open.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => { const t = realSetTimeout(fn, ms, ...args); if (t && typeof t.unref === 'function') t.unref(); return t; };
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms, ...args) => { const t = realSetInterval(fn, ms, ...args); if (t && typeof t.unref === 'function') t.unref(); return t; };

const BAYS = [
  { bayId: 'gc-pending', positionId: 'GC', facilityId: 'INCIRLIK', rackIds: ['main'] },
  { bayId: 'gc-taxi-out', positionId: 'GC', facilityId: 'INCIRLIK', rackIds: ['main'] },
];

function stripFor(stripId, flightDataId, bayId) {
  return {
    stripId, cid: '001', flightDataId, rev: 1, stripType: 'DEPARTURE', state: 'PROPOSED',
    ownerPositionId: 'GC', facilityId: 'INCIRLIK', bayId, rackId: 'main', orderKey: 'V',
    annotations: {}, flags: { offset: false, flipped: false, removeIndicator: false, highlight: null, attention: null },
    correlation: { state: 'UNCORRELATED' }, coordination: null, tofiCoordination: null, airspaceEntry: null,
  };
}
function flightDataFor(flightDataId, callsign) {
  return {
    flightDataId, rev: 1, provenance: {},
    identity: { callsign, beaconAssigned: '0001', trackDegradationFlag: 'NONE' },
    filed: {}, assigned: {}, tofi: {}, airspace: {}, comms: {},
    military: { ordnanceState: 'CLEAN', hookRequired: false, alertStatus: 'NONE', mtr: {} },
  };
}

/** What "efsp-metrics-client.js not loaded" leaves the hooks calling: nothing. */
const NO_METRICS = { noteSearch() {}, noteBayVisible() {}, noteStripSelected() {}, noteGesture() {}, flush() { return 0; } };

async function mount({ metrics = true } = {}) {
  const mutations = [];
  const reports = [];
  const els = {};
  for (const id of IDS) {
    els[id] = makeElement(id.endsWith('-btn') ? 'button' : /role|type|stereo|bind/.test(id) ? 'select' : 'input');
  }
  const d = globalThis.document;
  d.getElementById = (id) => els[id] || null;
  d.createElement = makeElement;
  d.body = makeElement('body'); // a fresh body per mount: the menus and swatches land here
  globalThis.getSelection = () => ({ removeAllRanges() {} });

  const g = freshGraph();
  const state = await g.import('panels/efsp/efsp-state.js');
  const ws = await g.import('panels/efsp/efsp-ws.js');
  const sync = await g.import('sync.js');
  const geojson = await g.import('geojson.js');
  const bay = await g.import('panels/efsp/bay-view.js');
  const stripEl = await g.import('panels/efsp/bay/strip-element.js');
  await g.import('panels/efsp/strip-view.js');
  const metricsClient = await g.import('panels/efsp/efsp-metrics-client.js');
  const panel = await g.import('panels/efsp/efsp-panel.js');
  if (!metrics) metricsClient._setEfspMetricsClientForTest(NO_METRICS);

  ws.setEfspSender('_sendEfsp', () => {});
  ws.sendEfspSetPositions('INCIRLIK', ['GC']); // getActingPositions() = ['GC']
  ws.setEfspSender('sendEfspMutation', (actingPositionId, s, op) => { mutations.push({ actingPositionId, stripId: s.stripId, rev: s.rev, op }); return 'mid'; });
  ws.setEfspSender('sendEfspCreateStrip', () => 'mid');
  geojson._setUpdateMapForTest(() => {});
  // Rendering a Rack needs more DOM than the stub has; the Bay's content is not what is measured.
  bay._setRenderBayForTest(() => {});
  bay._setRenderAllOpenEfspBaysForTest(() => {});
  sync.setIsSyncOpen(() => true);
  // The metrics reports; positions frames from the test's own sendEfspSetPositions are not reports.
  ws.setEfspSender('_sendEfsp', (msg) => { if (msg && msg.events) reports.push(msg); });

  state.applyEfspSnapshot({
    strips: [stripFor('s1', 'f1', 'gc-pending'), stripFor('s2', 'f2', 'gc-taxi-out')],
    flightDataList: [flightDataFor('f1', 'VIPER11'), flightDataFor('f2', 'VIPER12')],
    positions: [], bays: BAYS, airspaces: [], correlations: [], marsa: [],
  });
  panel.initEfspPanel();
  const flush = () => { if (metrics) metricsClient.flushEfspMetricsNow(); return reports.flatMap(r => r.events.map(e => ({ positionId: r.positionId, facilityId: r.facilityId, ...e }))); };
  return { els, sandbox: { ...panel, ...bay, ...stripEl, getEfspStrip: state.getEfspStrip, document: d }, ws, metricsClient, mutations, reports, flush };
}

const nextTask = () => new Promise(resolve => setImmediate(resolve));
const bayTab = (m, bayId) => m.els['efsp-bay-tabs'].children.find(c => c.dataset && c.dataset.bayId === bayId);
const fire = (el, type, ev = {}) => { for (const fn of el._listeners[type] || []) fn({ preventDefault() {}, stopPropagation() {}, target: { closest: () => null }, ...ev }); };
const clickEl = (el) => fire(el, 'click');
const strip = (m, id) => m.sandbox.getEfspStrip(id);

test('a search sends one SEARCH for the active Position and the Bay it was run from — never the text', async () => {
  const m = await mount();
  await nextTask();
  m.sandbox._runEfspSearch('VIPER');
  m.sandbox._runEfspSearch('   '); // clearing is not a search
  const events = m.flush();
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'SEARCH');
  assert.equal(events[0].positionId, 'GC');
  assert.equal(events[0].facilityId, 'INCIRLIK');
  assert.equal(events[0].bayId, 'gc-pending', 'the source Bay, not the search pseudo-Bay it switches to');
  assert.equal(JSON.stringify(m.reports).includes('VIPER'), false, 'no search text on the wire (T3)');
});

test('a Bay tab click, then a Strip click in it, yields one TIME_TO_FIND', async () => {
  const m = await mount();
  await nextTask();
  clickEl(bayTab(m, 'gc-taxi-out'));
  await nextTask(); // a controller's click is a later task
  m.sandbox._selectStrip('s2');
  m.sandbox._selectStrip('s2'); // toggle off
  m.sandbox._selectStrip('s2'); // and on again: still one entry, one sample
  const ttf = m.flush().filter(e => e.kind === 'TIME_TO_FIND');
  assert.equal(ttf.length, 1);
  assert.equal(ttf[0].bayId, 'gc-taxi-out');
  assert.equal(ttf[0].positionId, 'GC');
  assert.ok(Number.isInteger(ttf[0].latencyMs));
});

test('a map click selecting a Strip in the Bay on screen stops the clock too', async () => {
  const m = await mount();
  await nextTask();
  clickEl(bayTab(m, 'gc-taxi-out'));
  await nextTask();
  m.sandbox.selectEfspStripById('s2');
  assert.equal(m.flush().filter(e => e.kind === 'TIME_TO_FIND').length, 1);
});

test('each gesture entry point yields one GESTURE with its declared cost', async () => {
  const m = await mount();
  await nextTask();
  const el = m.sandbox._buildStripEl(strip(m, 's1'));
  fire(el, 'dblclick');
  fire(el, 'click', { shiftKey: true });
  fire(el, 'contextmenu', { target: el });
  const swatch = descendants(m.sandbox.document.body).find(c => (c.className || '').includes('efsp-highlight-swatch'));
  clickEl(swatch);
  clickEl(descendants(el).find(c => (c.className || '').includes('efsp-strip-menu-btn')));
  const offset = descendants(m.sandbox.document.body).find(c => (c.className || '').includes('efsp-strip-menu-item') && /Offset/.test(c.textContent));
  assert.ok(offset, 'the ⋯ menu offers Offset');
  clickEl(offset);
  const gestures = m.flush().filter(e => e.kind === 'GESTURE').map(e => `${e.gesture}=${e.inputs}@${e.positionId}`);
  assert.deepEqual(gestures.sort(), ['ATTENTION=1@GC', 'FLIP=1@GC', 'HIGHLIGHT=2@GC', 'OFFSET=2@GC']);
  assert.equal(m.mutations.length, 4, 'and each dispatched exactly one Mutation');
});

test('a gesture that does not dispatch is not counted', async () => {
  const m = await mount();
  await nextTask();
  m.ws.sendEfspSetPositions('INCIRLIK', []); // nothing signedOn: _dispatchGesture declines
  const el = m.sandbox._buildStripEl(strip(m, 's1'));
  fire(el, 'dblclick');
  assert.equal(m.mutations.length, 0);
  m.ws.sendEfspSetPositions('INCIRLIK', ['GC']);
  assert.equal(m.flush().length, 0);
});

test('no hook changes what the Strip panel dispatches (T4)', async () => {
  const drive = async (m) => {
    await nextTask();
    m.sandbox._runEfspSearch('VIPER');
    m.sandbox._runEfspSearch('');
    clickEl(bayTab(m, 'gc-taxi-out'));
    await nextTask();
    m.sandbox._selectStrip('s2');
    m.sandbox.selectEfspStripById('s1');
    const el = m.sandbox._buildStripEl(strip(m, 's1'));
    fire(el, 'dblclick');
    fire(el, 'click', { shiftKey: true });
    fire(el, 'contextmenu', { target: el });
    clickEl(descendants(m.sandbox.document.body).find(c => (c.className || '').includes('efsp-highlight-swatch')));
    clickEl(descendants(el).find(c => (c.className || '').includes('efsp-strip-menu-btn')));
    clickEl(descendants(m.sandbox.document.body).find(c => (c.className || '').includes('efsp-strip-menu-item') && /Offset/.test(c.textContent)));
    return JSON.stringify(m.mutations);
  };
  const withMetrics = await mount({ metrics: true });
  const without = await mount({ metrics: false });
  const a = await drive(withMetrics);
  const b = await drive(without);
  assert.ok(withMetrics.mutations.length >= 4);
  assert.equal(a, b, 'the dispatched Mutations are byte-identical');
  assert.ok(withMetrics.flush().length > 0, 'and the metrics client did measure');
});

test('a metrics client that throws cannot break a Strip click', async () => {
  const m = await mount();
  await nextTask();
  m.metricsClient._setEfspMetricsClientForTest({ ...NO_METRICS, noteGesture() { throw new Error('boom'); } });
  const el = m.sandbox._buildStripEl(strip(m, 's1'));
  assert.doesNotThrow(() => fire(el, 'dblclick'));
  assert.equal(m.mutations.length, 1);
});
