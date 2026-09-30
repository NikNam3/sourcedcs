'use strict';

// The measurement hooks, wired into the real Strip panel (docs/adr/0072):
// efsp-panel.js's search and Bay tabs, bay-view.js's selection and gesture
// entry points, strip-view.js's Offset menu item. Mounted against the shared
// DOM stub the way efsp-mission-line-panel.test.js does, with and without
// efsp-metrics-client.js loaded — so the last test can prove a hook never
// changes what the Strip panel dispatches (T4).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { makeElement, descendants } = require('./helpers/dom-stub.js');

const CLIENT = path.join(__dirname, '../app/public/js/panels/efsp');
const IDS = [
  'efsp-panel', 'efsp-position-tabs', 'efsp-bay-tabs', 'efsp-bay-content',
  'efsp-new-strip-callsign', 'efsp-create-strip-btn', 'efsp-create-strip-msg',
  'efsp-create-strip-role', 'efsp-create-strip-stereo', 'efsp-create-strip-bind',
  'efsp-dot-command-input', 'efsp-dot-command-preview',
  'efsp-mutation-error', 'efsp-mutation-warning', 'efsp-connection-banner',
];

function unrefTimeout(fn, ms, ...args) {
  const t = setTimeout(fn, ms, ...args);
  if (t && typeof t.unref === 'function') t.unref();
  return t;
}

const BAYS = [
  { bayId: 'gnd-pending', positionId: 'GND', facilityId: 'INCIRLIK', rackIds: ['main'] },
  { bayId: 'gnd-taxi-out', positionId: 'GND', facilityId: 'INCIRLIK', rackIds: ['main'] },
];

function stripFor(stripId, fdrId, bayId) {
  return {
    stripId, cid: '001', fdrId, rev: 1, role: 'DEPARTURE', state: 'PROPOSED',
    ownerPositionId: 'GND', facilityId: 'INCIRLIK', bayId, rackId: 'main', orderKey: 'V',
    annotations: {}, flags: { offset: false, flipped: false, removeIndicator: false, highlight: null, attention: null },
    correlation: { state: 'UNCORRELATED' }, coordination: null, tofiCoordination: null, airspaceEntry: null,
  };
}
function fdrFor(fdrId, callsign) {
  return {
    fdrId, rev: 1, provenance: {},
    identity: { callsign, beaconAssigned: '0001', trackDegradationFlag: 'NONE' },
    filed: {}, assigned: {}, tofi: {}, airspace: {}, comms: {},
    military: { ordnanceState: 'CLEAN', hookRequired: false, alertStatus: 'NONE', mtr: {} },
  };
}

function mount({ metrics = true } = {}) {
  const mutations = [];
  const reports = [];
  const els = {};
  for (const id of IDS) {
    els[id] = makeElement(id.endsWith('-btn') ? 'button' : /role|stereo|bind/.test(id) ? 'select' : 'input');
  }
  let uuid = 0;
  const sandbox = {
    console: { ...console, log() {}, warn() {} },
    module: { exports: {} }, setTimeout: unrefTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    Date, JSON, Math, Number, Set, Map, Array, Object, String, Boolean, RegExp, Promise,
    isNaN, parseInt, parseFloat, crypto: { randomUUID: () => `id-${++uuid}` },
    document: {
      getElementById: (id) => els[id] || null, createElement: makeElement, body: makeElement('body'),
      addEventListener() {}, removeEventListener() {},
    },
    window: { innerWidth: 1600, innerHeight: 1000, addEventListener() {}, removeEventListener() {}, getSelection: () => ({ removeAllRanges() {} }) },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const files = ['efsp-nla.js', 'strip-template.js', 'efsp-state.js', 'efsp-arrivals.js', 'dot-command.js',
    'efsp-gestures.js', 'annotation-editor.js', 'strip-drag.js', 'correlation-highlight.js', 'marsa-badge.js',
    'strip-fields.js', 'bay-view.js', 'strip-view.js', 'efsp-stereo-routes.js', 'efsp-panel.js'];
  if (metrics) files.splice(files.indexOf('bay-view.js'), 0, 'efsp-metrics-client.js');
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(CLIENT, file), 'utf8'), sandbox, { filename: file });

  sandbox.getActingPositions = () => ['GND'];
  sandbox.sendEfspMutation = (actingPositionId, s, op) => { mutations.push({ actingPositionId, stripId: s.stripId, rev: s.rev, op }); return 'mid'; };
  sandbox.sendEfspCreateStrip = () => 'mid';
  sandbox.updateMap = () => {};
  sandbox.renderAllOpenEfspBays = () => {};
  // Rendering a Rack needs more DOM than the stub has; the Bay's content is not what is measured.
  sandbox.renderBay = () => {};
  sandbox.lookupFlightPlanClient = async () => ({ found: false });
  sandbox.listStereoRoutesClient = async () => [];
  sandbox.isSyncOpen = () => true;
  sandbox._sendEfsp = (msg) => reports.push(msg);

  sandbox.applyEfspSnapshot({
    strips: [stripFor('s1', 'f1', 'gnd-pending'), stripFor('s2', 'f2', 'gnd-taxi-out')],
    fdrs: [fdrFor('f1', 'VIPER11'), fdrFor('f2', 'VIPER12')],
    positions: [], bays: BAYS, airspaces: [], correlations: [], marsa: [],
  });
  sandbox.initEfspPanel();
  const flush = () => { if (metrics) sandbox.flushEfspMetricsNow(); return reports.flatMap(r => r.events.map(e => ({ positionId: r.positionId, facilityId: r.facilityId, ...e }))); };
  return { els, sandbox, mutations, reports, flush };
}

const nextTask = () => new Promise(resolve => setImmediate(resolve));
const bayTab = (m, bayId) => m.els['efsp-bay-tabs'].children.find(c => c.dataset && c.dataset.bayId === bayId);
const fire = (el, type, ev = {}) => { for (const fn of el._listeners[type] || []) fn({ preventDefault() {}, stopPropagation() {}, target: { closest: () => null }, ...ev }); };
const clickEl = (el) => fire(el, 'click');
const strip = (m, id) => m.sandbox.getEfspStrip(id);

test('a search sends one SEARCH for the active Position and the Bay it was run from — never the text', async () => {
  const m = mount();
  await nextTask();
  m.sandbox._runEfspSearch('VIPER');
  m.sandbox._runEfspSearch('   '); // clearing is not a search
  const events = m.flush();
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'SEARCH');
  assert.equal(events[0].positionId, 'GND');
  assert.equal(events[0].facilityId, 'INCIRLIK');
  assert.equal(events[0].bayId, 'gnd-pending', 'the source Bay, not the search pseudo-Bay it switches to');
  assert.equal(JSON.stringify(m.reports).includes('VIPER'), false, 'no search text on the wire (T3)');
});

test('a Bay tab click, then a Strip click in it, yields one TIME_TO_FIND', async () => {
  const m = mount();
  await nextTask();
  clickEl(bayTab(m, 'gnd-taxi-out'));
  await nextTask(); // a controller's click is a later task
  m.sandbox._selectStrip('s2');
  m.sandbox._selectStrip('s2'); // toggle off
  m.sandbox._selectStrip('s2'); // and on again: still one entry, one sample
  const ttf = m.flush().filter(e => e.kind === 'TIME_TO_FIND');
  assert.equal(ttf.length, 1);
  assert.equal(ttf[0].bayId, 'gnd-taxi-out');
  assert.equal(ttf[0].positionId, 'GND');
  assert.ok(Number.isInteger(ttf[0].latencyMs));
});

test('a map click selecting a Strip in the Bay on screen stops the clock too', async () => {
  const m = mount();
  await nextTask();
  clickEl(bayTab(m, 'gnd-taxi-out'));
  await nextTask();
  m.sandbox.selectEfspStripById('s2');
  assert.equal(m.flush().filter(e => e.kind === 'TIME_TO_FIND').length, 1);
});

test('each gesture entry point yields one GESTURE with its declared cost', async () => {
  const m = mount();
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
  assert.deepEqual(gestures.sort(), ['ATTENTION=1@GND', 'FLIP=1@GND', 'HIGHLIGHT=2@GND', 'OFFSET=2@GND']);
  assert.equal(m.mutations.length, 4, 'and each dispatched exactly one Mutation');
});

test('a gesture that does not dispatch is not counted', async () => {
  const m = mount();
  await nextTask();
  m.sandbox.getActingPositions = () => []; // nothing held: _dispatchGesture declines
  const el = m.sandbox._buildStripEl(strip(m, 's1'));
  fire(el, 'dblclick');
  assert.equal(m.mutations.length, 0);
  m.sandbox.getActingPositions = () => ['GND'];
  assert.equal(m.flush().length, 0);
});

test('no hook changes what the Strip panel dispatches (T4)', async () => {
  const drive = async (m) => {
    await nextTask();
    m.sandbox._runEfspSearch('VIPER');
    m.sandbox._runEfspSearch('');
    clickEl(bayTab(m, 'gnd-taxi-out'));
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
  const withMetrics = mount({ metrics: true });
  const without = mount({ metrics: false });
  const a = await drive(withMetrics);
  const b = await drive(without);
  assert.ok(withMetrics.mutations.length >= 4);
  assert.equal(a, b, 'the dispatched Mutations are byte-identical');
  assert.ok(withMetrics.flush().length > 0, 'and the metrics client did measure');
});

test('a metrics client that throws cannot break a Strip click', async () => {
  const m = mount();
  await nextTask();
  m.sandbox.getEfspBays = () => { throw new Error('boom'); };
  const el = m.sandbox._buildStripEl(strip(m, 's1'));
  assert.doesNotThrow(() => fire(el, 'dblclick'));
  assert.equal(m.mutations.length, 1);
});
