/* The ATO on the Strip (crc-sync docs/adr/0071): the AR join, the Mode 3
 * conflict and the read-only ▼ rows, rendered through the REAL strip-view.js /
 * bay-view.js against the shared DOM stub.
 *
 * The join is not MARSA (T2): its own class and label, tone 'on' (not a
 * warning, docs/adr/0058), and nothing on it dispatches anything.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/client-env.mjs';
import domStub from './helpers/dom-stub.js';
import { freshGraph } from './helpers/fresh-graph.mjs';

const { makeElement, descendants } = domStub;

function strip(stripId, flightDataId, over = {}) {
  return {
    stripId, cid: '001', flightDataId, rev: 1, stripType: 'MISSION', state: 'TASKED', ownerPositionId: 'TAC_C2',
    facilityId: 'TACTICAL', bayId: 'tac-c2-tasked', rackId: 'main', orderKey: 'V',
    annotations: {}, flags: { offset: false, flipped: false, removeIndicator: false, highlight: null, attention: null },
    coordination: null, tofiCoordination: null, airspaceEntry: null, ...over,
  };
}

const W = (h, m) => Date.UTC(2016, 5, 21, h, m);
function flightData(flightDataId, callsign, { beacon = '4521', ato = true, links = [], modeThree = beacon, asTanker = null } = {}) {
  return {
    flightDataId, rev: 2, provenance: {},
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
const link = (stripType, peerFlightDataId, peerCallsign, windows) => ({ stripType, peerFlightDataId, peerCallsign, peerMissionNumber: null, arcp: 'ANCHOR BLUE', windows });

const FLIGHT_DATA_LIST = [
  flightData('f-shell', 'SHELL71', { beacon: '4571', asTanker: { tacan: '38Y' }, links: [link('TANKER', 'f-viper', 'VIPER11', win(W(13, 45), 12)), link('TANKER', 'f-dude', 'DUDE21', win(W(14, 20), 16))] }),
  flightData('f-viper', 'VIPER11', { links: [link('RECEIVER', 'f-shell', 'SHELL71', win(W(13, 45), 12))] }),
  flightData('f-dude', 'DUDE21', { beacon: '4531', links: [link('RECEIVER', 'f-shell', 'SHELL71', win(W(14, 20), 16))] }),
  flightData('f-snake', 'SNAKE41', { beacon: '4541' }),
  flightData('f-plain', 'PLAIN1', { beacon: '0101', ato: false }),
];
const STRIPS = [
  strip('s-shell', 'f-shell'), strip('s-viper', 'f-viper'), strip('s-dude', 'f-dude'), strip('s-snake', 'f-snake'),
  strip('s-viper-dep', 'f-viper', { stripType: 'DEPARTURE', state: 'HANDED_OFF', ownerPositionId: 'AP', facilityId: 'INCIRLIK', bayId: 'ap-departures' }),
  strip('s-plain', 'f-plain', { stripType: 'DEPARTURE', state: 'PROPOSED', ownerPositionId: 'OPS', facilityId: 'INCIRLIK', bayId: 'ops-proposed' }),
];

async function mount({ strips = STRIPS, flightDataList = FLIGHT_DATA_LIST } = {}) {
  const sent = [];
  globalThis.document.getElementById = () => null;
  const g = freshGraph();
  const state = await g.import('panels/efsp/efsp-state.js');
  const ws = await g.import('panels/efsp/efsp-ws.js');
  const bay = await g.import('panels/efsp/bay-view.js');
  const stripEl = await g.import('panels/efsp/bay/strip-element.js');
  const stripView = await g.import('panels/efsp/strip-view.js');
  const ato = await g.import('panels/efsp/ato-strip.js');
  ws.setEfspSender('_sendEfsp', () => {});
  ws.sendEfspSetPositions('TACTICAL', ['TAC_C2']);
  ws.sendEfspSetPositions('INCIRLIK', ['AP', 'OPS']); // getActingPositions() = ['TAC_C2', 'AP', 'OPS'] in union
  for (const name of ['sendEfspMutation', 'sendEfspAirspaceMutation', 'sendEfspCorrelationMutation', 'sendEfspMarsaMutation', '_sendEfsp', 'sendEfspCreateStrip']) {
    ws.setEfspSender(name, (...args) => { sent.push({ name, args }); return 'mid'; });
  }
  bay._setRenderAllOpenEfspBaysForTest(() => {});
  state.applyEfspSnapshot({ strips, flightDataList, positions: [], bays: [], airspaces: [], correlations: [], marsa: [] });
  const build = (stripId) => stripEl._buildStripEl(state.getEfspStrip(stripId));
  const select = (stripId) => {
    const cur = bay.getSelectedEfspStripId();
    if (stripId === null) { if (cur) bay._selectStrip(cur); } else if (cur !== stripId) bay._selectStrip(stripId);
    ato.highlightArParticipants(stripId);
  };
  return { sandbox: { ...ato, ...stripView }, bay, stripEl, sent, build, select };
}

const slot = (el, key) => descendants(el).find(c => c.dataset && c.dataset.slot === key);

test('WP7: A tanker\'s AR line and its receivers\' Strips render as a joined group.', async () => {
  const m = await mount();
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

test('the highlight survives a re-render and clears with the selection', async () => {
  const m = await mount();
  m.select('s-shell');
  m.build('s-viper'); m.build('s-viper');
  assert.equal(m.sandbox.refreshArHighlight(), false, 'unchanged');
  assert.ok(m.sandbox.isArHighlighted('s-viper'));
  m.select(null);
  assert.equal(m.sandbox.isArHighlighted('s-viper'), false);
});

test('a dropped peer leaves the group; a receiver whose tanker is gone has no badge', async () => {
  const strips = STRIPS.map(s => (s.stripId === 's-shell' ? { ...s, state: 'DROPPED' } : s.stripId === 's-dude' ? { ...s } : s));
  const m = await mount({ strips: strips.filter(s => s.state !== 'DROPPED') });
  assert.equal(slot(m.build('s-viper'), 'ar'), undefined);
  const m2 = await mount({ strips: STRIPS.filter(s => s.stripId !== 's-dude') });
  assert.equal(slot(m2.build('s-shell'), 'ar').textContent, 'AR ×1');
});

test('the Mode 3 conflict shows only when the ATO\'s code and the assigned code differ', async () => {
  const flightDataList = FLIGHT_DATA_LIST.map(f => (f.flightDataId === 'f-viper' ? { ...f, identity: { ...f.identity, beaconAssigned: '4533' } } : f));
  const m = await mount({ flightDataList });
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

test('the ▼ rows are on the DEPARTURE and MISSION Strips of a bound flight, read-only, and absent without an ATO', async () => {
  const m = await mount();
  for (const id of ['s-viper', 's-viper-dep']) {
    m.stripEl._setExpandedStripId(id);
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
  m.stripEl._setExpandedStripId('s-plain');
  assert.equal(descendants(m.build('s-plain')).some(e => (e.className || '').includes('efsp-ato-row')), false);
});

test('INDICATOR_ORDER carries the ATO alert after the wave-2 advisories and the AR badge after MARSA', async () => {
  const m = await mount();
  const order = m.sandbox.INDICATOR_ORDER;
  assert.equal(order.indexOf('ato'), order.indexOf('trk') - 1);
  assert.equal(order.indexOf('ar'), order.indexOf('marsa') + 1);
  assert.ok(m.sandbox.ALERT_SLOT_KEYS.has('ato'));
});
