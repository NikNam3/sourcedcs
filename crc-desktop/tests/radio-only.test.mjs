// The radio-only page's parts (docs/adr/0161 §2), against the shared DOM stub and the stub engine: the /feed connection
// that never gates the radio, the frequency table as picks in + RADIO, the top line, and the panel's differences.
// Position and Facility ids are test fixtures.
import { permissive } from './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { freshGraph } from './helpers/fresh-graph.mjs';
import * as fakeEngine from './helpers/fake-radio-engine.mjs';

const require = createRequire(import.meta.url);
const { makeElement, descendants } = require('./helpers/dom-stub.js');

const hasClass = (n, c) => String(n.className).split(/\s+/).includes(c);

class FakeSocket {
  static OPEN = 1;
  static made = [];
  readyState = 1;
  constructor(url) { this.url = url; FakeSocket.made.push(this); }
  close() { this.onclose({ code: 1006 }); }
  send() {}
}

async function feedHarness({ urls = [], token = true } = {}) {
  FakeSocket.made = [];
  globalThis.WebSocket = FakeSocket;
  const g = freshGraph();
  const feed = await g.import('radio/radio-only-feed.js');
  const state = await g.import('panels/efsp/frequency-state.js');
  const registry = await g.import('panels/efsp/efsp-message-registry.js');
  const update = await g.import('update-required.js');
  const links = [];
  const timers = [];
  const sockets = [];
  const queue = [...urls];
  feed.startRadioOnlyFeed({
    onLink: (l) => links.push(l), getUrl: async () => (queue.length ? queue.shift() : null), hasToken: () => token,
    setSocket: (ws) => sockets.push(ws), setTimer: (fn, ms) => timers.push({ fn, ms }),
  });
  await new Promise(r => setImmediate(r));
  return { feed, state, registry, update, links, timers, sockets };
}

const frame = (ws, msg) => ws.onmessage({ data: JSON.stringify(msg) });
const ROW = { facilityId: 'FAC1', kind: 'POSITION', positionId: 'P1', label: 'TWR', mhz: 275.8, defaultMhz: 275.8, added: false };

test('no ticket and no login: says so, opens nothing, keeps retrying, draws no gate', async () => {
  const appended = [];
  const before = document.body.appendChild;
  document.body.appendChild = (n) => { appended.push(n); return n; };
  const h = await feedHarness({ token: false });
  document.body.appendChild = before;
  assert.deepEqual(h.links, [h.feed.LINK.NO_LOGIN]);
  assert.equal(FakeSocket.made.length, 0);
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, h.feed.RETRY_MS);
  assert.deepEqual(appended, [], 'nothing covers the radio');
});

test('a login but no ticket is a missing connection, not a missing login', async () => {
  const h = await feedHarness({ token: true });
  assert.deepEqual(h.links, [h.feed.LINK.NO_FEED]);
});

test('a ticket opens /feed, hands the socket to sync.js, and a close retries', async () => {
  const h = await feedHarness({ urls: ['wss://x/feed?ticket=t'] });
  const ws = FakeSocket.made[0];
  assert.equal(ws.url, 'wss://x/feed?ticket=t');
  assert.deepEqual(h.sockets, [ws]);
  ws.onopen();
  assert.deepEqual(h.links, [h.feed.LINK.OPEN]);
  ws.onclose({ code: 1006 });
  assert.deepEqual(h.sockets, [ws, null]);
  assert.equal(h.links.at(-1), h.feed.LINK.NO_FEED);
  assert.equal(h.timers.length, 1);
});

test('frames go through the registry: the frequency deltas fill the table', async () => {
  const h = await feedHarness({ urls: ['u'] });
  const ws = FakeSocket.made[0];
  frame(ws, { type: 'efsp-frequency-delta', facilityId: 'FAC1', frequencies: [ROW] });
  assert.deepEqual(h.state.getFrequencyRows().map(r => r.mhz), [275.8]);
  frame(ws, { type: 'efsp-frequency-delta', facilityId: 'FAC1', frequencies: [{ ...ROW, mhz: 251 }] });
  assert.deepEqual(h.state.getFrequencyRows().map(r => r.mhz), [251]);
  assert.deepEqual(h.registry.registeredEfspTypes(), ['efsp-frequency-delta'], 'no Board frame has a handler here');
  frame(ws, { type: 'some-frame-nobody-registered' }); // ignored
  ws.onmessage({ data: 'not json' }); // ignored
});

test('importing the feed registers nothing: the full client owns those types there', async () => {
  const g = freshGraph();
  await g.import('radio/radio-only-feed.js');
  const registry = await g.import('panels/efsp/efsp-message-registry.js');
  assert.deepEqual(registry.registeredEfspTypes(), []);
});

test('update-required: the overlay shows, no reconnect until its Retry', async () => {
  const h = await feedHarness({ urls: ['u', 'v'] });
  const ws = FakeSocket.made[0];
  frame(ws, { type: 'update-required', serverProtocol: 99 });
  assert.equal(h.links.at(-1), h.feed.LINK.UPDATE_REQUIRED);
  assert.equal(h.update.isUpdateRequiredShown(), true);
  ws.onclose({ code: h.update.UPDATE_REQUIRED_CLOSE });
  assert.equal(h.timers.length, 0);
  h.update.hideUpdateRequired();
});

test('only the close code: the overlay still shows', async () => {
  const h = await feedHarness({ urls: ['u'] });
  FakeSocket.made[0].onclose({ code: h.update.UPDATE_REQUIRED_CLOSE });
  assert.equal(h.update.isUpdateRequiredShown(), true);
  assert.equal(h.timers.length, 0);
  h.update.hideUpdateRequired();
});

test('picks: rows on a band, one per frequency, none already tuned', async () => {
  const { frequencyPicks } = await freshGraph().import('radio/frequency-picks.js');
  const rows = [
    ROW,
    { ...ROW, positionId: 'P2', label: 'SAME' },                                     // 275.800 again
    { ...ROW, positionId: 'P3', label: 'P3', mhz: 122.1 },                            // the label is the Position's
    { ...ROW, positionId: 'P4', label: 'FM', mhz: 40.5 },                             // outside both bands
    { ...ROW, positionId: 'P5', label: 'GUARDED', mhz: 243 },                         // already a radio
    { facilityId: 'FAC1', kind: 'SFA', rackId: 'freq-2', use: 'ROTATION_X', mhz: 300.5 },
    { ...ROW, positionId: 'A-LONG-POSITION', label: 'LONG', mhz: 301 },
  ];
  assert.deepEqual(frequencyPicks(rows, [{ mhz: 243 }, { mhz: null }]), [
    { mhz: 275.8, label: 'P1 TWR', text: 'FAC1 P1 TWR 275.800' },
    { mhz: 122.1, label: 'P3', text: 'FAC1 P3 122.100' },
    { mhz: 300.5, label: 'freq-2 ROTAT', text: 'FAC1 freq-2 ROTATION X 300.500' },
    { mhz: 301, label: 'A-LONG-POSIT', text: 'FAC1 A-LONG-POSITION LONG 301.000' },
  ]);
});

test('the top line: grey only without the link', async () => {
  const g = freshGraph();
  const { linkLine } = await g.import('radio/radio-only-bar.js');
  const { LINK } = await g.import('radio/radio-only-feed.js');
  assert.equal(linkLine(LINK.OPEN), '');
  assert.equal(linkLine(LINK.UPDATE_REQUIRED), '');
  assert.equal(linkLine(LINK.NO_LOGIN), 'not logged in: no linking');
  assert.equal(linkLine(LINK.NO_FEED), 'no connection to crc-sync: no linking');
});

function barRoot() {
  const root = makeElement('div');
  document.getElementById = (id) => (id === 'radio-only-bar' ? root : null);
  document.createElement = makeElement;
  return root;
}
const buttons = (root) => descendants(root).filter(n => n.tagName === 'button');
const named = (root, text) => buttons(root).find(b => b.textContent === text);

test('the bar: LOG IN and CONNECTION only without the link; FULL CRC writes the mode through the preload', async () => {
  const g = freshGraph();
  const { initRadioOnlyBar } = await g.import('radio/radio-only-bar.js');
  const { LINK } = await g.import('radio/radio-only-feed.js');
  const asked = [];
  window.crcLaunch = { switchTo: (m) => asked.push(m) };
  const root = barRoot();
  const bar = initRadioOnlyBar();
  bar.setLink(LINK.NO_LOGIN);
  assert.equal(named(root, 'LOG IN').hidden, false);
  assert.equal(named(root, 'CONNECTION').hidden, false);
  bar.setLink(LINK.OPEN);
  assert.equal(named(root, 'LOG IN').hidden, true);
  assert.equal(named(root, 'CONNECTION').hidden, true);
  for (const fn of named(root, 'FULL CRC')._listeners.click) fn();
  assert.deepEqual(asked, ['full']);
  delete window.crcLaunch;
});

test('outside Electron there is no FULL CRC', async () => {
  const { initRadioOnlyBar } = await freshGraph().import('radio/radio-only-bar.js');
  const root = barRoot();
  initRadioOnlyBar();
  assert.equal(named(root, 'FULL CRC'), undefined);
});

async function panelHarness(radioOnly) {
  const g = freshGraph();
  const root = makeElement('div');
  const all = () => descendants(root);
  const element = (tag) => {
    const e = makeElement(tag);
    e.querySelectorAll = () => [];
    e.setAttribute = e.setAttribute || function (k, v) { this[k] = v; };
    return e;
  };
  document.getElementById = (id) => (id === 'radio-panel' ? root : null);
  document.createElement = element;
  document.createDocumentFragment = () => element('#fragment');
  root.querySelectorAll = () => [];
  const state = await g.import('panels/efsp/frequency-state.js');
  state.replaceFrequencyRows([ROW]);
  const names = [];
  const ptts = [];
  const engine = { ...fakeEngine, setIdentity: (id) => names.push(id.name), setPtt: (...a) => ptts.push(a) };
  const panel = await g.import('radio/radio-panel.js');
  panel.initRadioPanel({ engine, radioOnly });
  return { all, names, root, ptts };
}
const sectionNames = (all) => all().filter(n => hasClass(n, 'radio-group-name')).map(n => n.textContent);

test('radio-only: no POSITIONS section, the guards and the default intercom stay, the name is CRC RADIO', async () => {
  const { all, names } = await panelHarness(true);
  assert.deepEqual(sectionNames(all), ['UNLINKED']);
  assert.deepEqual(all().filter(n => hasClass(n, 'radio-row')).map(r => r.dataset.radioId), ['GUARD:UHF', 'GUARD:VHF', 'INTERCOM']);
  assert.ok(names.length > 0);
  assert.ok(names.every(n => n === 'CRC RADIO'), names.join());
  const options = all().filter(n => n.tagName === 'option').map(o => o.textContent);
  assert.equal(options.includes('POSITIONS'), false, 'the link menu does not offer the group that is not drawn');
});

test('the full app keeps its POSITIONS section and its name', async () => {
  const { all, names } = await panelHarness(false);
  assert.deepEqual(sectionNames(all), ['POSITIONS', 'UNLINKED']);
  assert.ok(names.every(n => n === 'CRC'), names.join());
});

test('+ RADIO offers the table in radio-only and fills the form', async () => {
  const { all } = await panelHarness(true);
  const open = all().find(n => n.tagName === 'button' && n.textContent === '+ RADIO');
  for (const fn of open._listeners.click) fn();
  const sel = all().find(n => hasClass(n, 'radio-frequency-picks'));
  assert.deepEqual(sel.children.map(o => o.textContent), ['TABLE', 'FAC1 P1 TWR 275.800']);
  sel.value = '0';
  all().filter(n => n.tagName === 'input').forEach(i => { i.focus = () => {}; });
  for (const fn of sel._listeners.change) fn();
  const inputs = all().filter(n => n.tagName === 'input' && (hasClass(n, 'radio-manual-label') || hasClass(n, 'radio-freq-input')));
  assert.deepEqual(inputs.map(i => i.value), ['P1 TWR', '275.800']);
});

test('+ RADIO in the full app has no picks', async () => {
  const { all } = await panelHarness(false);
  const open = all().find(n => n.tagName === 'button' && n.textContent === '+ RADIO');
  for (const fn of open._listeners.click) fn();
  assert.equal(all().find(n => hasClass(n, 'radio-frequency-picks')), undefined);
});

async function gateHarness() {
  const g = freshGraph();
  const sync = await g.import('sync.js');
  const appended = [];
  const button = makeElement('button');
  document.getElementById = (id) => (id === 'crc-login-gate' ? null : button);
  document.createElement = makeElement;
  const before = document.body.appendChild;
  document.body.appendChild = (n) => { appended.push(n); return n; };
  localStorage.removeItem('crc-desktop-sync-token');
  assert.equal(await sync.getSyncFeedUrl(), null);
  document.body.appendChild = before;
  return appended[0];
}

test('the full app\'s login gate offers RADIO ONLY, which writes the mode through the preload', async () => {
  const asked = [];
  window.crcLaunch = { switchTo: (m) => asked.push(m) };
  const gate = await gateHarness();
  const b = gate.children.find(n => n.id === 'crc-login-radio-only-btn');
  assert.equal(b.textContent, 'RADIO ONLY');
  for (const fn of b._listeners.click) fn();
  assert.deepEqual(asked, ['radio']);
  delete window.crcLaunch;
});

test('outside Electron the login gate has no RADIO ONLY', async () => {
  const gate = await gateHarness();
  assert.equal(gate.children.find(n => n.id === 'crc-login-radio-only-btn'), undefined);
});

test('the feed URL says role=radio; the full app\'s does not', async () => {
  const sync = await freshGraph().import('sync.js');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ticket: 'T' }) });
  localStorage.setItem('crc-desktop-sync-token', 'tok');
  try {
    assert.match(await sync.getSyncFeedUrlNoGate({ role: 'radio' }), /[?&]role=radio(&|$)/);
    assert.doesNotMatch(await sync.getSyncFeedUrlNoGate(), /role=/);
  } finally {
    localStorage.removeItem('crc-desktop-sync-token');
    delete globalThis.fetch;
  }
});

test('with no chosen radio PTT keys nothing, and the button says so', async () => {
  const { all, ptts } = await panelHarness(true);
  const ptt = all().find(n => hasClass(n, 'radio-ptt'));
  assert.equal(ptt.textContent, 'NO PTT RADIO');
  assert.equal(ptt.disabled, true);
  for (const fn of ptt._listeners.mousedown) fn({ preventDefault() {} });
  assert.deepEqual(ptts, [], 'a press keys nothing, least of all 243.000');
});

test('Settings offers RADIO ONLY in Electron, and hides it elsewhere', async () => {
  const tools = await freshGraph().import('panels/tools-panel.js');
  const btn = makeElement('button');
  btn.hidden = true;
  document.getElementById = (id) => (id === 'set-radio-only' ? btn : permissive());
  tools.initToolsTab();
  assert.equal(btn.hidden, true);
  const asked = [];
  window.crcLaunch = { switchTo: (m) => asked.push(m) };
  tools.initToolsTab();
  assert.equal(btn.hidden, false);
  for (const fn of btn._listeners.click) fn();
  assert.deepEqual(asked, ['radio']);
  delete window.crcLaunch;
});
