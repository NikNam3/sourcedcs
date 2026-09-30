'use strict';

/* The ATO on the Strip (crc-sync docs/adr/0071): the AR join, the Mode 3
 * conflict and the read-only ▼ rows, rendered through the REAL strip-view.js /
 * bay-view.js against the shared DOM stub.
 *
 * The join is not MARSA (T2): its own class and label, tone 'on' (not a
 * warning, docs/adr/0058), and nothing on it dispatches anything.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeElement, descendants } = require('./helpers/dom-stub.js');

const CLIENT = path.join(__dirname, '../app/public/js/panels/efsp');

function strip(stripId, fdrId, over = {}) {
  return {
    stripId, cid: '001', fdrId, rev: 1, role: 'MISSION', state: 'TASKED', ownerPositionId: 'TAC_C2',
    facilityId: 'TACTICAL', bayId: 'tac-c2-tasked', rackId: 'main', orderKey: 'V',
    annotations: {}, flags: { offset: false, flipped: false, removeIndicator: false, highlight: null, attention: null },
    coordination: null, tofiCoordination: null, airspaceEntry: null, ...over,
  };
}

const W = (h, m) => Date.UTC(2016, 5, 21, h, m);
function fdr(fdrId, callsign, { beacon = '4521', ato = true, links = [], modeThree = beacon, asTanker = null } = {}) {
  return {
    fdrId, rev: 2, provenance: {},
    identity: { callsign, beaconAssigned: beacon, trackDegradationFlag: 'NONE', modeOne: ato ? '12' : null, modeTwo: ato ? '0011' : null },
    filed: {}, assigned: {}, tofi: { separationRegime: null }, airspace: {}, comms: {},
    mission: { missionNumber: ato ? '1101A' : null },
    military: {
      ordnanceState: 'CLEAN', hookRequired: false, alertStatus: 'NONE', mtr: {},
      scl: ato ? { primary: '402+', secondary: null } : null,
      arInfo: links.length ? { asReceiver: [], asTanker, links } : null,
    },
    ato: ato ? {
      lineId: `${callsign}#0`, missionNumber: '1101A', missionType: { primary: 'CAP', secondary: null },
      iff: { modeThree }, datalink: { l16Callsign: 'VP11', ju: '00011' }, onStationUtc: W(13, 0),
      control: { type: 'AWACS', callsign: 'MAGIC11', primary: { freqMhz: 251 }, reportInPoint: 'ALPHA' },
      missingAcceptanceFields: ['packageId'], atoRef: { msgId: { originator: 'SOURCEDCS AOC', serial: 'ATO C' } },
    } : undefined,
  };
}

const win = (arctUtc, offloadKlb) => [{ arctUtc, endArUtc: arctUtc + 15 * 60000, offloadKlb }];
const link = (role, peerFdrId, peerCallsign, windows) => ({ role, peerFdrId, peerCallsign, peerMissionNumber: null, arcp: 'ANCHOR BLUE', windows });

const FDRS = [
  fdr('f-shell', 'SHELL71', { beacon: '4571', asTanker: { tacan: '38Y' }, links: [link('TANKER', 'f-viper', 'VIPER11', win(W(13, 45), 12)), link('TANKER', 'f-dude', 'DUDE21', win(W(14, 20), 16))] }),
  fdr('f-viper', 'VIPER11', { links: [link('RECEIVER', 'f-shell', 'SHELL71', win(W(13, 45), 12))] }),
  fdr('f-dude', 'DUDE21', { beacon: '4531', links: [link('RECEIVER', 'f-shell', 'SHELL71', win(W(14, 20), 16))] }),
  fdr('f-snake', 'SNAKE41', { beacon: '4541' }),
  fdr('f-plain', 'PLAIN1', { beacon: '0101', ato: false }),
];
const STRIPS = [
  strip('s-shell', 'f-shell'), strip('s-viper', 'f-viper'), strip('s-dude', 'f-dude'), strip('s-snake', 'f-snake'),
  strip('s-viper-dep', 'f-viper', { role: 'DEPARTURE', state: 'HANDED_OFF', ownerPositionId: 'APP', facilityId: 'INCIRLIK', bayId: 'app-departures' }),
  strip('s-plain', 'f-plain', { role: 'DEPARTURE', state: 'PROPOSED', ownerPositionId: 'OPS', facilityId: 'INCIRLIK', bayId: 'ops-proposed' }),
];

function mount({ strips = STRIPS, fdrs = FDRS } = {}) {
  const sent = [];
  let selected = null;
  const sandbox = {
    console, module: { exports: {} }, setTimeout, clearTimeout, Date, JSON, Math, Number, Set, Map,
    Array, Object, String, Boolean, isNaN, parseInt, parseFloat, crypto: { randomUUID: () => 'id' },
    document: { getElementById: () => null, createElement: makeElement, body: makeElement('body'), addEventListener() {}, removeEventListener() {} },
    window: { innerWidth: 1600, innerHeight: 1000, addEventListener() {}, removeEventListener() {}, getLatestTrack: () => null, getAllTracks: () => [] },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(CLIENT, '../../track-label.js'), 'utf8'), sandbox);
  for (const file of ['efsp-nla.js', 'strip-template.js', 'efsp-state.js', 'efsp-arrivals.js', 'efsp-gestures.js',
    'annotation-editor.js', 'strip-drag.js', 'correlation-highlight.js', 'marsa-badge.js', 'strip-fields.js', 'bay-view.js', 'strip-view.js', 'ato-strip.js']) {
    vm.runInContext(fs.readFileSync(path.join(CLIENT, file), 'utf8'), sandbox, { filename: file });
  }
  sandbox.getActingPositions = () => ['TAC_C2', 'APP', 'OPS'];
  for (const name of ['sendEfspMutation', 'sendEfspAirspaceMutation', 'sendEfspCorrelationMutation', 'sendEfspMarsaMutation', '_sendEfsp', 'sendEfspCreateStrip']) {
    sandbox[name] = (...args) => { sent.push({ name, args }); return 'mid'; };
  }
  sandbox.convertStripToArrival = () => sent.push({ name: 'convert' });
  sandbox.getActiveEfspSearchQuery = () => null;
  sandbox.updateMap = () => {};
  sandbox.renderAllOpenEfspBays = () => {};
  sandbox.getCurrentEfspRefusal = () => null;
  sandbox.getSelectedEfspStripId = () => selected;
  sandbox.applyEfspSnapshot({ strips, fdrs, positions: [], bays: [], airspaces: [], correlations: [], marsa: [] });
  const build = (stripId) => sandbox._buildStripEl(sandbox.getEfspStrip(stripId));
  const select = (stripId) => { selected = stripId; sandbox.highlightArParticipants(stripId); };
  return { sandbox, sent, build, select };
}

const slot = (el, key) => descendants(el).find(c => c.dataset && c.dataset.slot === key);

test('WP7: A tanker\'s AR line and its receivers\' Strips render as a joined group.', () => {
  const m = mount();
  const shell = slot(m.build('s-shell'), 'ar');
  const viper = slot(m.build('s-viper'), 'ar');
  const dude = slot(m.build('s-dude'), 'ar');
  assert.equal(shell.textContent, 'AR ×2');
  assert.equal(viper.textContent, 'AR SHELL71');
  assert.equal(dude.textContent, 'AR SHELL71');
  for (const b of [shell, viper, dude]) {
    assert.match(b.className, /efsp-ind-on/, 'not a warning (docs/adr/0058)');
    assert.match(b.className, /efsp-ar-badge/);
    assert.doesNotMatch(`${b.className} ${b.textContent} ${b.title}`, /MARSA|marsa/, 'never the word MARSA (T2)');
  }
  assert.match(viper.title, /ARCT 1345Z–1400Z · 12 klb · ARCP ANCHOR BLUE · TACAN 38Y/);
  assert.equal(slot(m.build('s-snake'), 'ar'), undefined, 'no AR, no badge');

  // Selecting one highlights the other two; nothing is dispatched.
  m.select('s-viper');
  assert.ok(m.build('s-shell').classList._set.has('efsp-strip-ar-participant'));
  assert.ok(m.build('s-viper-dep').classList._set.has('efsp-strip-ar-participant') === false, 'own flight is not its own peer');
  assert.equal(m.build('s-dude').classList._set.has('efsp-strip-ar-participant'), false, 'a receiver\'s group is its tanker');
  m.select('s-shell');
  assert.ok(m.build('s-viper').classList._set.has('efsp-strip-ar-participant'));
  assert.ok(m.build('s-viper-dep').classList._set.has('efsp-strip-ar-participant'), 'every live Strip of a peer flight');
  assert.ok(m.build('s-dude').classList._set.has('efsp-strip-ar-participant'));
  assert.equal(m.build('s-dude').classList._set.has('efsp-strip-marsa-participant'), false);
  assert.equal(m.sent.length, 0, 'the join dispatches nothing');
});

test('the highlight survives a re-render and clears with the selection', () => {
  const m = mount();
  m.select('s-shell');
  m.build('s-viper'); m.build('s-viper');
  assert.equal(m.sandbox.refreshArHighlight(), false, 'unchanged');
  assert.ok(m.sandbox.isArHighlighted('s-viper'));
  m.select(null);
  assert.equal(m.sandbox.isArHighlighted('s-viper'), false);
});

test('a dropped peer leaves the group; a receiver whose tanker is gone has no badge', () => {
  const strips = STRIPS.map(s => (s.stripId === 's-shell' ? { ...s, state: 'DROPPED' } : s.stripId === 's-dude' ? { ...s } : s));
  const m = mount({ strips: strips.filter(s => s.state !== 'DROPPED') });
  assert.equal(slot(m.build('s-viper'), 'ar'), undefined);
  const m2 = mount({ strips: STRIPS.filter(s => s.stripId !== 's-dude') });
  assert.equal(slot(m2.build('s-shell'), 'ar').textContent, 'AR ×1');
});

test('the Mode 3 conflict shows only when the ATO\'s code and the assigned code differ', () => {
  const fdrs = FDRS.map(f => (f.fdrId === 'f-viper' ? { ...f, identity: { ...f.identity, beaconAssigned: '4533' } } : f));
  const m = mount({ fdrs });
  for (const id of ['s-viper', 's-viper-dep']) {
    const chip = slot(m.build(id), 'ato');
    assert.ok(chip, `${id}: every Strip of the flight`);
    assert.equal(chip.textContent, 'M3 ATO 4521');
    assert.match(chip.className, /efsp-ind-attn/);
    const reasons = descendants(m.build(id)).map(e => e.textContent).join('\n');
    assert.match(reasons, /ATO tasks Mode 3 4521; ATC assigned 4533\. The ATC code stands unless coordinated\./);
  }
  assert.equal(slot(m.build('s-shell'), 'ato'), undefined, 'agreeing codes say nothing');
  assert.equal(slot(m.build('s-plain'), 'ato'), undefined, 'no ATO, nothing');
});

test('the ▼ rows are on the DEPARTURE and MISSION Strips of a bound flight, read-only, and absent without an ATO', () => {
  const m = mount();
  for (const id of ['s-viper', 's-viper-dep']) {
    vm.runInContext(`_expandedStripId = ${JSON.stringify(id)}`, m.sandbox);
    const el = m.build(id);
    const rows = descendants(el).filter(e => (e.className || '').includes('efsp-ato-row'));
    const byLabel = Object.fromEntries(rows.map(r => [r.dataset.atoRow, r.children[1].textContent]));
    assert.equal(byLabel['Mode 1'], '12', id);
    assert.equal(byLabel['Mode 2'], '0011');
    assert.equal(byLabel['ATO Mode 3'], '4521');
    assert.equal(byLabel.SCL, '402+');
    assert.match(byLabel.Agency, /AWACS · MAGIC11 · 251\.000 · RIP ALPHA/);
    assert.equal(byLabel['On station'], '1300Z');
    assert.match(byLabel.AR, /Tanker SHELL71/);
    assert.equal(byLabel['ATO missing'], 'packageId');
    for (const r of rows) assert.equal(descendants(r).some(e => e.tagName === 'input' || e.tagName === 'select'), false, 'no editor');
  }
  vm.runInContext('_expandedStripId = "s-plain"', m.sandbox);
  assert.equal(descendants(m.build('s-plain')).some(e => (e.className || '').includes('efsp-ato-row')), false);
});

test('INDICATOR_ORDER carries the ATO alert after the wave-2 advisories and the AR badge after MARSA', () => {
  const m = mount();
  const order = vm.runInContext('INDICATOR_ORDER', m.sandbox);
  assert.equal(order.indexOf('ato'), order.indexOf('trk') - 1);
  assert.equal(order.indexOf('ar'), order.indexOf('marsa') + 1);
  assert.ok(vm.runInContext('ALERT_SLOT_KEYS.has("ato")', m.sandbox));
});
