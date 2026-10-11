// Bay descriptor views (crc-sync docs/adr/0093): the pattern board, the FINAL panel and the SFA rotation
// header mounted by `view`, from the real Bay descriptors the server sends. Wiring tests against the DOM
// stub: they prove the right op is dispatched and the right racks are hidden, never layout.

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeElement, descendants } from './helpers/dom-stub.js';
import * as serverConfig from "./helpers/server-config.mjs";

import * as V from '../app/public/js/panels/efsp/bay-views.js';
import { applyEfspSnapshot } from '../app/public/js/panels/efsp/efsp-state.js';
import { getEfspSfa, applyEfspSfaSnapshot, _resetEfspSfaStateForTest } from '../app/public/js/panels/efsp/sfa-state.js';
import { setEfspSender, sendEfspSetPositions } from '../app/public/js/panels/efsp/efsp-ws.js';

const require = createRequire(import.meta.url);
const facilityConfig = serverConfig.facilityConfig;
const permission = serverConfig.permission;
const { SfaStore } = require('../../crc-sync/src/efsp/sfa-store.js');
const { renderBayDescriptorView, sfaExtraNlaButtons } = V;

const allBays = () => facilityConfig.getFacilityIds().flatMap(f => facilityConfig.getAllBays(f));
const bay = (id) => allBays().find(b => b.bayId === id);
const sent = [];
let signedOn = {};
let strips = {};
let flightDataList = {};
let now = Date.UTC(2026, 5, 1, 9, 0);

// The views read the real Board state, the real acting-Position set and the real senders (ESM-1): the test
// feeds them through applyEfspSnapshot, sendEfspSetPositions and setEfspSender instead of stubbing globals.
const syncBoard = () => applyEfspSnapshot({
  strips: Object.values(strips), flightDataList: Object.entries(flightDataList).map(([flightDataId, f]) => ({ flightDataId, ...f })),
  positions: [], bays: allBays(), boardSeq: 1, sfaRotation: getEfspSfa(),
});
const setHeld = (h) => {
  signedOn = h;
  for (const f of ['INCIRLIK', 'CENTER', 'TACTICAL', 'CARRIER', 'RANGES']) sendEfspSetPositions(f, signedOn[f] || []);
};
const putStrip = (st) => { strips[st.stripId] = st; syncBoard(); };
const putFlightData = (id, f) => { flightDataList[id] = f; syncBoard(); };
const clearBoard = () => { strips = {}; flightDataList = {}; syncBoard(); };

function setGlobals() {
  sent.length = 0;
  globalThis.document.activeElement = null;
  Date.now = () => now;
  setEfspSender('_sendEfsp', () => {});
  setEfspSender('sendEfspMutation', (position, strip, op) => sent.push({ position, stripId: strip.stripId, op }));
  setEfspSender('sendEfspSfaMutation', (position, baseRev, op) => sent.push({ position, sfa: true, op }));
}

const addStrip = (s, flightData) => { flightDataList[s.flightDataId] = flightData; putStrip(s); return s; };
const rackEl = (b, rackId) => { const el = makeElement('div'); el.className = 'efsp-rack'; el.dataset.bayId = b.bayId; el.dataset.rackId = rackId; const h = makeElement('div'); h.className = 'efsp-rack-header'; h.textContent = rackId; el.appendChild(h); return el; };
const containerFor = (b) => { const c = makeElement('div'); for (const r of b.rackIds) c.appendChild(rackEl(b, r)); return c; };
const click = (el) => (el._listeners.click || []).forEach(fn => fn({ stopPropagation() {} }));

test.beforeEach(() => { setGlobals(); setHeld({}); clearBoard(); });

test('the descriptor flags reach a client exactly as the server sends them (the mount reads nothing else)', () => {
  assert.equal(bay('rsu-pattern').view, 'pattern');
  assert.equal(bay('par-final').view, 'final');
  assert.equal(bay('sfa-frequencies').view, 'sfa-freqs');
  for (const b of allBays()) if (b.view) assert.ok(facilityConfig.BAY_VIEWS.includes(b.view), b.bayId);
  assert.equal(V.bayDescriptorFor('par-final').capacity, 1);
  assert.equal(V.bayDescriptorFor('nope'), null);
});

test('pattern: legs are the Bay\'s racks, a Strip\'s leg is its rack, and time in the pattern runs from joining, not from the last Move', () => {
  const b = bay('rsu-pattern');
  assert.deepEqual(V.patternLegsFor(b).map(l => l.id), ['closed', 'initial', 'base', 'final']);
  const s = { stripId: 's1', flightDataId: 'f1', bayId: 'rsu-pattern', rackId: 'base', createdAt: 60000, updatedAt: 999000 };
  const list = V.patternStripsFor(b, (bayId, rackId) => (bayId === 'rsu-pattern' && rackId === 'base' ? [s] : []), () => ({ identity: { callsign: 'VIPER 11', aircraftType: 'F-16C' } }));
  assert.deepEqual(list, [{ stripId: 's1', callsign: 'VIPER 11', type: 'F-16C', legId: 'base', enteredPatternS: 60, order: 0 }]);
});

test('pattern mount: hides the racks (RSU replaces them), draws the board, and its three gestures send the right ops as the owner', () => {
  const b = bay('rsu-pattern');
  setHeld({ INCIRLIK: ['RSU'] });
  addStrip({ stripId: 's1', flightDataId: 'f1', bayId: 'rsu-pattern', rackId: 'initial', ownerPositionId: 'RSU', rev: 3, createdAt: now - 120000, state: 'IN_PATTERN' }, { identity: { callsign: 'VIPER 11' } });
  const c = containerFor(b);
  renderBayDescriptorView(c, b);
  const racks_ = [...c.children].filter(x => x.className === 'efsp-rack');
  assert.ok(racks_.length === 4 && racks_.every(r => r.style.display === 'none'), 'RSU replaces its racks');
  const all = descendants(c);
  const chip = all.find(e => e.dataset && e.dataset.stripId === 's1');
  assert.ok(chip, 'the Strip is a chip on the board');
  click(all.find(e => e.className === 'efsp-pattern-next'));
  assert.deepEqual(sent.pop(), { position: 'RSU', stripId: 's1', op: { kind: 'MoveStrip', rackId: 'base', bayId: 'rsu-pattern' } });
  click(all.find(e => e.dataset && e.dataset.action === 'LANDED'));
  assert.deepEqual(sent.pop().op, { kind: 'SetState', toState: 'RECOVERED' });
  click(all.find(e => e.dataset && e.dataset.action === 'DROP'));
  assert.deepEqual(sent.pop().op, { kind: 'DropStrip' });
});

test('pattern mount is read-only for a controller who does not hold the Position', () => {
  const b = bay('rsu-pattern');
  setHeld({ INCIRLIK: ['LC'] });
  addStrip({ stripId: 's1', flightDataId: 'f1', bayId: 'rsu-pattern', rackId: 'initial', ownerPositionId: 'RSU', rev: 1, createdAt: now, state: 'IN_PATTERN' }, { identity: { callsign: 'X' } });
  const c = containerFor(b);
  renderBayDescriptorView(c, b);
  click(descendants(c).find(e => e.className === 'efsp-pattern-next'));
  assert.equal(sent.length, 0);
});

test('the carrier keeps its racks: the pattern board sits above them (no replacesRacks)', () => {
  const b = bay('cv-prifly-pattern');
  setHeld({ CARRIER: ['CV_PRIFLY'] });
  const c = containerFor(b);
  renderBayDescriptorView(c, b);
  assert.ok([...c.children].filter(x => x.className === 'efsp-rack').every(r => r.style.display === ''), 'racks stay');
  assert.ok(descendants(c).some(e => e.className === 'efsp-pattern'), 'the board is mounted');
});

test('a Bay with no view is left alone, and a stale view is removed when a Bay stops having one', () => {
  const b = bay('ap-inbound');
  const c = containerFor(b);
  renderBayDescriptorView(c, b);
  assert.equal([...c.children].some(x => x.className === 'efsp-bay-view'), false);
  const pb = bay('rsu-pattern');
  const c2 = containerFor(pb);
  renderBayDescriptorView(c2, pb);
  assert.ok([...c2.children].some(x => x.className === 'efsp-bay-view'));
  renderBayDescriptorView(c2, { ...pb, view: undefined });
  assert.equal([...c2.children].some(x => x.className === 'efsp-bay-view'), false);
});

test('final: one line per flight, named by its callsign at a runway and its side number on a carrier lane (H122), its range from the PAR sample', () => {
  const strip = { stripId: 's1', flightDataId: 'f1' };
  putFlightData('f1', { identity: { callsign: 'VIPER 11' }, military: { carrier: { sideNumber: '201' } } });
  putStrip({ ...strip, bayId: 'par-final', rackId: 'main', ownerPositionId: 'PAR', state: 'ON_FINAL', stripType: 'FINAL' });
  const par = { stripId: 's1', approach: { id: 'LTAG-05', kind: 'RUNWAY' }, plot: { rangeNm: 3.04 } };
  assert.deepEqual(V.finalRowModel(strip, 'RUNWAY', par), { stripId: 's1', name: 'VIPER 11', range: '3.0 NM' });
  assert.equal(V.finalRowModel(strip, 'CARRIER', par).name, '201');
  assert.equal(V.finalRowModel(strip, 'RUNWAY', { ...par, plot: null }).range, '', 'no plot, no range');
  assert.equal(V.finalRowModel(strip, 'RUNWAY', null).range, '', 'not this controller\'s final');
  assert.equal(V.finalKindOf(bay('par-final')), 'RUNWAY');
  assert.equal(V.finalKindOf(bay('cv-app1-final')), 'CARRIER');
});

test('final mount: PAR\'s Strip becomes a flight line with no input in it, racks hidden, and a terminal button sends the owner\'s op', () => {
  const b = bay('par-final');
  setHeld({ INCIRLIK: ['PAR'] });
  addStrip({ stripId: 'p1', flightDataId: 'f1', bayId: 'par-final', rackId: 'main', ownerPositionId: 'PAR', rev: 2, state: 'ON_FINAL', stripType: 'FINAL' }, { identity: { callsign: 'VIPER 11' } });
  const c = containerFor(b);
  renderBayDescriptorView(c, b);
  assert.equal([...c.children].filter(x => x.className === 'efsp-rack').every(r => r.style.display === 'none'), true);
  const all = descendants(c);
  assert.equal(all.some(e => /^(input|select|textarea)$/.test(e.tagName)), false, 'nothing to type on final (§7.10)');
  const terms = all.filter(e => e.className === 'efsp-final-terminal');
  assert.deepEqual(terms.map(t => t.textContent), ['Landing assured', 'Missed approach']);
  assert.ok(all.some(e => e.className === 'efsp-final-name' && e.textContent === 'VIPER 11'));
  click(terms[1]);
  assert.deepEqual(sent.pop(), { position: 'PAR', stripId: 'p1', op: { kind: 'SetState', toState: 'BOLTER_WAVEOFF' } });
  click(terms[0]);
  assert.deepEqual(sent.pop().op, { kind: 'SetState', toState: 'BALL' });
  // not the owner: a tap does nothing
  setHeld({ INCIRLIK: ['LC'] });
  const c2 = containerFor(b);
  renderBayDescriptorView(c2, b);
  descendants(c2).filter(e => e.className === 'efsp-final-terminal').forEach(click);
  assert.equal(sent.length, 0);
  // an empty Bay says so, rather than drawing nothing
  clearBoard();
  const c3 = containerFor(b);
  renderBayDescriptorView(c3, b);
  assert.ok(descendants(c3).some(e => e.className === 'efsp-final-none'));
});

test('final mount on a carrier lane: Ball is the recorded FINAL_TO_LSO handoff, Waveoff the state change; the racks stay', () => {
  const b = bay('cv-app1-final');
  setHeld({ CARRIER: ['CV_APP1'] });
  addStrip({ stripId: 'c1', flightDataId: 'f2', bayId: 'cv-app1-final', rackId: 'main', ownerPositionId: 'CV_APP1', rev: 1, state: 'ON_FINAL', stripType: 'FINAL' }, { identity: { callsign: 'NAVY 1' }, military: { carrier: { sideNumber: '203' } } });
  const c = containerFor(b);
  renderBayDescriptorView(c, b);
  assert.equal([...c.children].filter(x => x.className === 'efsp-rack').every(r => r.style.display !== 'none'), true);
  const all = descendants(c);
  assert.ok(all.some(e => e.className === 'efsp-final-name' && e.textContent === '203'));
  const terms = all.filter(e => e.className === 'efsp-final-terminal');
  assert.deepEqual(terms.map(t => t.textContent), ['Ball', 'Waveoff']);
  click(terms[0]);
  assert.deepEqual(sent.pop().op, { kind: 'CarrierHandoff', transfer: 'FINAL_TO_LSO' });
  click(terms[1]);
  assert.deepEqual(sent.pop().op, { kind: 'SetState', toState: 'BOLTER_WAVEOFF' });
});

test('sfa header: every pool frequency is a row; the rack headers say the frequency and the controller; only AP gets selects', () => {
  const b = bay('sfa-frequencies');
  const store = new SfaStore({ config: facilityConfig.getSingleFrequencyApproach(), positions: facilityConfig.getPositionSet(), clock: { now: () => now, source: 'T' } });
  applyEfspSfaSnapshot({ sfaRotation: store.view() });
  setHeld({ INCIRLIK: ['SFA'] });
  const c = containerFor(b);
  renderBayDescriptorView(c, b);
  let all = descendants(c);
  assert.equal(all.filter(e => e.className === 'efsp-sfa-row').length, 5);
  assert.equal(all.some(e => e.tagName === 'select'), false, 'SFA only reads the rotation');
  const heads = all.filter(e => e.className === 'efsp-rack-header').map(e => e.textContent);
  assert.equal(heads[0], 'freq-1 · 232.100 · AP');
  assert.equal(heads[3], 'freq-4 · 235.100');
  assert.ok([...c.children].filter(x => x.className === 'efsp-rack').every(r => r.style.display === ''), 'the SFA racks ARE the frequencies and stay');

  setHeld({ INCIRLIK: ['AP'] });
  const c2 = containerFor(b);
  renderBayDescriptorView(c2, b);
  all = descendants(c2);
  const selects = all.filter(e => e.tagName === 'select');
  assert.equal(selects.length, 5);
  assert.deepEqual(descendants(selects[0]).filter(e => e.tagName === 'option').map(o => o.value), ['', 'AP', 'SFA', 'PAR'], 'spare, then the controllers the server names');
  selects[3].value = 'PAR';
  (selects[3]._listeners.change || []).forEach(fn => fn({}));
  assert.deepEqual(sent.pop(), { position: 'AP', sfa: true, op: { kind: 'SetSfaRotation', rackId: 'freq-4', positionId: 'PAR' } });
  selects[0].value = '';
  (selects[0]._listeners.change || []).forEach(fn => fn({}));
  assert.deepEqual(sent.pop().op, { kind: 'SetSfaRotation', rackId: 'freq-1', positionId: null });
  _resetEfspSfaStateForTest();
});

test('the Rotate to PAR button sends the transfer as the Strip\'s owner and goes dead on the press', () => {
  const store = new SfaStore({ config: facilityConfig.getSingleFrequencyApproach(), positions: facilityConfig.getPositionSet(), clock: { now: () => now, source: 'T' } });
  applyEfspSfaSnapshot({ sfaRotation: store.view() });
  setHeld({ INCIRLIK: ['SFA'] });
  const strip = { stripId: 'a1', flightDataId: 'f1', rev: 4, stripType: 'ARRIVAL', state: 'INBOUND', ownerPositionId: 'SFA', facilityId: 'INCIRLIK' };
  putFlightData('f1', { comms: { workingFrequencyMhz: 234.1 } }); putStrip(strip);
  const buttons = sfaExtraNlaButtons(strip);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].textContent, 'Rotate to PAR');
  click(buttons[0]);
  assert.deepEqual(sent.pop(), { position: 'SFA', stripId: 'a1', op: { kind: 'SfaRotation' } });
  assert.equal(buttons[0].disabled, true);
  putFlightData('f1', { comms: { workingFrequencyMhz: 121.5 } });
  assert.equal(sfaExtraNlaButtons(strip).length, 0, 'off the SFA pool: no button');
  _resetEfspSfaStateForTest();
});

test('every Position of the three can only do through the client what the server grants it (the ops the views send are held)', () => {
  for (const [position, op] of [['RSU', 'MoveStrip'], ['RSU', 'SetState'], ['RSU', 'DropStrip'], ['PAR', 'SetState']]) {
    assert.equal(permission.canMutate(position, op), true, `${position} ${op}`);
  }
  assert.equal(permission.canSendSfaRotationTransfer('SFA'), true);
});

test('no top-level name of the Bay-view scripts is declared by any other script the page loads (a clash is a SyntaxError or a silent override only a browser shows)', () => {
  const root = path.join(import.meta.dirname, '../app/public');
  // The page is one module graph now (index.html loads js/main.js): "the scripts the page loads" is that graph.
  const files = [];
  const walk = (f) => {
    if (files.includes(f)) return;
    files.push(f);
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s+['"](\.[^'"]+)['"]/g)) walk(path.posix.relative('.', path.posix.join(path.posix.dirname(f), m[1])));
  };
  walk('js/main.js');
  const declared = new Map(); // name -> [files]
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of src.matchAll(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (!declared.has(m[1])) declared.set(m[1], new Set());
      declared.get(m[1]).add(f);
    }
  }
  const mine = ['pattern-board.js', 'par-model.js', 'bay-views.js', 'sfa-state.js'];
  for (const f of files.filter(x => mine.some(n => x.endsWith(n)))) {
    for (const [name, where] of declared) {
      if (where.has(f) && where.size > 1) assert.fail(`${name} is declared in ${[...where].join(' and ')}`);
    }
  }
  assert.ok(files.some(f => f.endsWith('bay-views.js')) && files.some(f => f.endsWith('sfa-state.js')), 'both are loaded by index.html');
});
