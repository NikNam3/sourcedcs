// Bay descriptor views (crc-sync docs/adr/0093, 0117): the pattern board, the FINAL line and AP's SFA frequency
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
import { setEfspSender, sendEfspSetPositions } from '../app/public/js/panels/efsp/efsp-ws.js';

const require = createRequire(import.meta.url);
const facilityConfig = serverConfig.facilityConfig;
const permission = serverConfig.permission;
const { renderBayDescriptorView, finalHandoffButtons } = V;

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
  positions: [], bays: allBays(), boardSeq: 1,
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
}

const addStrip = (s, flightData) => { flightDataList[s.flightDataId] = flightData; putStrip(s); return s; };
const rackEl = (b, rackId) => { const el = makeElement('div'); el.className = 'efsp-rack'; el.dataset.bayId = b.bayId; el.dataset.rackId = rackId; const h = makeElement('div'); h.className = 'efsp-rack-header'; h.textContent = rackId; el.appendChild(h); return el; };
const containerFor = (b) => { const c = makeElement('div'); for (const r of b.rackIds) c.appendChild(rackEl(b, r)); return c; };
const click = (el) => (el._listeners.click || []).forEach(fn => fn({ stopPropagation() {} }));

test.beforeEach(() => { setGlobals(); setHeld({}); clearBoard(); });

test('the descriptor flags reach a client exactly as the server sends them (the mount reads nothing else)', () => {
  assert.equal(bay('rsu-pattern').view, 'pattern');
  assert.equal(bay('par-final').view, 'final');
  assert.equal(bay('ap-sfa').view, 'sfa-freqs');
  assert.equal(bay('ap-sfa').sfaPool.length, 5, 'the SFA Bay carries its pool (crc-sync docs/adr/0117)');
  for (const b of allBays()) if (b.view) assert.ok(facilityConfig.BAY_VIEWS.includes(b.view), b.bayId);
  assert.equal(V.bayDescriptorFor('par-final').capacity, 1);
  assert.equal(V.bayDescriptorFor('nope'), null);
});

test('pattern: legs are the Bay\'s racks, a Strip\'s leg is its rack, and time in the pattern runs from joining, not from the last Move', () => {
  const b = bay('rsu-pattern');
  assert.deepEqual(V.patternLegsFor(b).map(l => l.id), ['closed', 'initial', 'base', 'final']);
  const s = { stripId: 's1', flightDataId: 'f1', bayId: 'rsu-pattern', rackId: 'base', createdAt: 60000, updatedAt: 999000 };
  const list = V.patternStripsFor(b, (bayId, rackId) => (bayId === 'rsu-pattern' && rackId === 'base' ? [s] : []), () => ({ identity: { callsign: 'VIPER 11', aircraftType: 'F-16C' } }));
  assert.deepEqual(list, [{ stripId: 's1', name: 'VIPER 11', aka: '', type: 'F-16C', legId: 'base', enteredPatternS: 60, order: 0 }]);
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

test('final: the carrier line leads with the side number (H124), no range (H126); Ball and Waveoff are its terminals', () => {
  const cv = { stripId: 'c1', flightDataId: 'fc', stripType: 'FINAL', ownerPositionId: 'CV_APP1' };
  putFlightData('fc', { identity: { callsign: 'NAVY 1' }, military: { carrier: { sideNumber: '201' } } });
  assert.deepEqual(V.carrierFinalRowModel(cv), { stripId: 'c1', name: '201' });
  putFlightData('fc', { identity: { callsign: 'NAVY 1' }, military: { carrier: { sideNumber: '' } } });
  assert.equal(V.carrierFinalRowModel(cv).name, 'NAVY 1', 'no side number yet: the callsign');
  assert.equal(V.finalKindOf(bay('par-final')), 'RUNWAY');
  assert.equal(V.finalKindOf(bay('cv-app1-final')), 'CARRIER');
  assert.deepEqual(V.carrierFinalTerminals().map(t => t.label), ['Ball', 'Waveoff']);
  const [ball, waveoff] = V.carrierFinalTerminals();
  assert.deepEqual(V.carrierFinalTerminalOp(ball), { kind: 'CarrierHandoff', transfer: 'FINAL_TO_LSO' });
  assert.deepEqual(V.carrierFinalTerminalOp(waveoff), { kind: 'SetState', toState: 'BOLTER_WAVEOFF' });
  assert.equal(V.carrierFinalTerminalOp(null), null);
});

test('an airfield PAR final is an ordinary Bay (H138 U10): no line list, the racks stay, the Strips are the interface', () => {
  const b = bay('par-final');
  assert.equal(b.view, 'final', 'the descriptor still names the final: crc-sync samples its Strips for the PAR');
  assert.equal(V.bayHasComponentView(b), false);
  assert.equal(V.bayHasComponentView(bay('cv-app1-final')), true);
  assert.equal(V.bayHasComponentView(bay('rsu-pattern')), true);
  setHeld({ INCIRLIK: ['PAR'] });
  addStrip({ stripId: 'p1', flightDataId: 'f1', bayId: 'par-final', rackId: 'main', ownerPositionId: 'PAR', rev: 2, state: 'ON_FINAL', stripType: 'FINAL', facilityId: 'INCIRLIK', flags: {} }, { identity: { callsign: 'VIPER 11' } });
  const c = containerFor(b);
  renderBayDescriptorView(c, b);
  assert.ok([...c.children].filter(x => x.className === 'efsp-rack').every(r => r.style.display === ''), 'the racks are shown');
  assert.equal([...c.children].some(x => x.className === 'efsp-bay-view'), false, 'no component mounted');
  assert.equal(descendants(c).some(e => e.className === 'efsp-final-row'), false);
  // a container that once showed the old list loses it
  const stale = makeElement('div'); stale.className = 'efsp-bay-view'; c.appendChild(stale);
  for (const r of [...c.children].filter(x => x.className === 'efsp-rack')) r.style.display = 'none';
  renderBayDescriptorView(c, b);
  assert.equal([...c.children].some(x => x.className === 'efsp-bay-view'), false);
  assert.ok([...c.children].filter(x => x.className === 'efsp-rack').every(r => r.style.display === ''));
});

test('the airfield final controller\'s next call rides beside the NLA: Begin descent, then Cleared to land, then none (Landed is the NLA)', () => {
  setHeld({ INCIRLIK: ['PAR'] });
  const strip = { stripId: 'p1', flightDataId: 'f1', bayId: 'par-final', rackId: 'main', ownerPositionId: 'PAR', rev: 2, state: 'ON_FINAL', stripType: 'FINAL', facilityId: 'INCIRLIK' };
  addStrip(strip, { identity: { callsign: 'VIPER 11' } });
  assert.equal(V.isParFinalStrip(strip), true);
  assert.equal(V.nextParCall(strip).id, 'BEGIN_DESCENT');
  let buttons = V.parCallButtons(strip);
  assert.deepEqual(buttons.map(b => b.textContent), ['Begin descent']);
  click(buttons[0]);
  assert.deepEqual(sent.pop(), { position: 'PAR', stripId: 'p1', op: { kind: 'FinalCall', call: 'BEGIN_DESCENT' } });
  assert.equal(buttons[0].disabled, true, 'dead on the press');
  const descended = { ...strip, finalCalls: { BEGIN_DESCENT: { at: now, by: 'u' } } };
  buttons = V.parCallButtons(descended);
  assert.deepEqual(buttons.map(b => b.textContent), ['Cleared to land']);
  click(buttons[0]);
  assert.deepEqual(sent.pop().op, { kind: 'FinalCall', call: 'CLEARED_TO_LAND' });
  assert.deepEqual(V.parCallButtons({ ...strip, finalCalls: { BEGIN_DESCENT: {}, CLEARED_TO_LAND: {} } }), [], 'both recorded: only the NLA (Landed) is left');
  setHeld({ INCIRLIK: ['LC'] });
  assert.deepEqual(V.parCallButtons(strip), [], 'not the holder: no button');
  setHeld({ CARRIER: ['CV_APP1'] });
  const cv = { ...strip, stripId: 'c1', facilityId: 'CARRIER', ownerPositionId: 'CV_APP1' };
  assert.equal(V.isParFinalStrip(cv), false, 'the carrier final has Ball and Waveoff, not these calls');
  assert.deepEqual(V.parCallButtons(cv), []);
  assert.equal(V.isParFinalStrip({ ...strip, state: 'BOLTER_WAVEOFF' }), false);
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
  // not the holder: a tap does nothing; an empty lane says so
  setHeld({ CARRIER: ['CV_APP2'] });
  const c2 = containerFor(b);
  renderBayDescriptorView(c2, b);
  descendants(c2).filter(e => e.className === 'efsp-final-terminal').forEach(click);
  assert.equal(sent.length, 0);
  clearBoard();
  const c3 = containerFor(b);
  renderBayDescriptorView(c3, b);
  assert.deepEqual(descendants(c3).filter(e => e.className === 'efsp-final-none').map(e => e.textContent), ['No aircraft on final.']);
});

test('sfa header: every pool frequency is a row, grey; a rotating one shows who has it (PAR while it holds the flight), the others what they are for', () => {
  const b = bay('ap-sfa');
  setHeld({ INCIRLIK: ['AP'] });
  addStrip({ stripId: 'p1', flightDataId: 'f1', bayId: 'par-final', rackId: 'main', ownerPositionId: 'PAR', rev: 1, state: 'ON_FINAL', stripType: 'FINAL' }, { comms: { workingFrequencyMhz: 234.1 } });
  const c = containerFor(b);
  renderBayDescriptorView(c, b);
  const all = descendants(c);
  assert.equal(all.filter(e => e.className === 'efsp-sfa-row').length, 5);
  assert.equal(all.some(e => e.tagName === 'select'), false, 'nothing to set: the rotation follows the handoffs');
  const heads = all.filter(e => e.className === 'efsp-rack-header').map(e => e.textContent);
  assert.deepEqual(heads, ['232.100 · INIT', '233.100 · AP', '234.100 · PAR', '235.100 · AP', '236.100 · SPARE']);
  assert.ok([...c.children].filter(x => x.className === 'efsp-rack').every(r => r.style.display === ''), 'the SFA racks ARE the frequencies and stay');
});

test('Hand off to PAR sends the ordinary transfer as the Strip\'s owner and goes dead on the press; off a rotating frequency there is no button', () => {
  setHeld({ INCIRLIK: ['AP'] });
  const strip = { stripId: 'a1', flightDataId: 'f1', rev: 4, stripType: 'ARRIVAL', state: 'INBOUND', ownerPositionId: 'AP', facilityId: 'INCIRLIK' };
  putFlightData('f1', { comms: { workingFrequencyMhz: 234.1 } }); putStrip(strip);
  const buttons = finalHandoffButtons(strip);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].textContent, 'Hand off to PAR');
  click(buttons[0]);
  assert.deepEqual(sent.pop(), { position: 'AP', stripId: 'a1', op: { kind: 'TransferStrip', toPositionId: 'PAR', bayId: 'par-final', rackId: 'main' } });
  assert.equal(buttons[0].disabled, true);
  putFlightData('f1', { comms: { workingFrequencyMhz: 232.1 } });
  assert.equal(finalHandoffButtons(strip).length, 0, 'AP\'s initial-contact frequency: no button (a drag still hands it off)');
  putFlightData('f1', { comms: { workingFrequencyMhz: 121.5 } });
  assert.equal(finalHandoffButtons(strip).length, 0, 'off the SFA pool: no button');
});

test('RSU and PAR can only do through the client what the server grants them (the ops the views send are held)', () => {
  for (const [position, op] of [['RSU', 'MoveStrip'], ['RSU', 'SetState'], ['RSU', 'DropStrip'], ['PAR', 'SetState'], ['PAR', 'SetBlock'], ['AP', 'TransferStrip']]) {
    assert.equal(permission.canMutate(position, op), true, `${position} ${op}`);
  }
  assert.equal(permission.canHandOffToFinal('AP'), true);
  assert.equal(permission.canRecordFinalCall('PAR'), true);
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
