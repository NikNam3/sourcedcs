'use strict';

// Bay descriptor views (crc-sync docs/adr/0093): the pattern board, the FINAL panel and the SFA rotation
// header mounted by `view`, from the real Bay descriptors the server sends. Wiring tests against the DOM
// stub: they prove the right op is dispatched and the right racks are hidden, never layout.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeElement, descendants } = require('./helpers/dom-stub');

const CLIENT = path.join(__dirname, '../app/public/js/panels/efsp');
const facilityConfig = require('../../crc-sync/src/efsp/facility-config.js');
const permission = require('../../crc-sync/src/efsp/permission.js');
const { SfaStore } = require('../../crc-sync/src/efsp/sfa-store.js');
Object.assign(globalThis, require(path.join(CLIENT, 'pattern-board.js')), require(path.join(CLIENT, 'final-panel.js')), require(path.join(CLIENT, 'sfa-state.js')));
const V = require(path.join(CLIENT, 'bay-views.js'));
Object.assign(globalThis, V);
const { renderBayDescriptorView, sfaExtraNlaButtons } = V;
// geo.js is a plain browser script with no exports: load it the way the page does, so haversineM is the real one.
require('vm').runInThisContext(require('fs').readFileSync(path.join(__dirname, '../app/public/js/geo.js'), 'utf8'));

const allBays = () => facilityConfig.getFacilityIds().flatMap(f => facilityConfig.getAllBays(f));
const bay = (id) => allBays().find(b => b.bayId === id);
const sent = [];
let held = {};
let racks = {};
let strips = {};
let fdrs = {};
let now = Date.UTC(2026, 5, 1, 9, 0);

function setGlobals() {
  sent.length = 0;
  globalThis.document = { createElement: makeElement, activeElement: null };
  globalThis.getEfspBays = () => allBays();
  globalThis.getEfspRack = (bayId, rackId) => (racks[`${bayId}/${rackId}`] || []);
  globalThis.getEfspStrip = (id) => strips[id] || null;
  globalThis.getEfspFdr = (id) => fdrs[id] || null;
  globalThis.getEfspFieldState = () => null;
  globalThis.getActingPositions = (facilityId) => held[facilityId] || [];
  globalThis.missionNow = () => now;
  globalThis.sendEfspMutation = (position, strip, op) => sent.push({ position, stripId: strip.stripId, op });
  globalThis.sendEfspSfaMutation = (position, baseRev, op) => sent.push({ position, sfa: true, op });
  globalThis.correlatedTrackIdForStrip = () => null;
  globalThis.getActiveRadars = () => [];
}

const addStrip = (s, fdr) => { strips[s.stripId] = s; fdrs[s.fdrId] = fdr; (racks[`${s.bayId}/${s.rackId}`] = racks[`${s.bayId}/${s.rackId}`] || []).push(s); return s; };
const rackEl = (b, rackId) => { const el = makeElement('div'); el.className = 'efsp-rack'; el.dataset.bayId = b.bayId; el.dataset.rackId = rackId; const h = makeElement('div'); h.className = 'efsp-rack-header'; h.textContent = rackId; el.appendChild(h); return el; };
const containerFor = (b) => { const c = makeElement('div'); for (const r of b.rackIds) c.appendChild(rackEl(b, r)); return c; };
const click = (el) => (el._listeners.click || []).forEach(fn => fn({ stopPropagation() {} }));

test.beforeEach(() => { held = {}; racks = {}; strips = {}; fdrs = {}; setGlobals(); });

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
  const s = { stripId: 's1', fdrId: 'f1', bayId: 'rsu-pattern', rackId: 'base', createdAt: 60000, updatedAt: 999000 };
  const list = V.patternStripsFor(b, (bayId, rackId) => (bayId === 'rsu-pattern' && rackId === 'base' ? [s] : []), () => ({ identity: { callsign: 'VIPER 11', aircraftType: 'F-16C' } }));
  assert.deepEqual(list, [{ stripId: 's1', callsign: 'VIPER 11', type: 'F-16C', legId: 'base', enteredPatternS: 60, order: 0 }]);
});

test('pattern mount: hides the racks (RSU replaces them), draws the board, and its three gestures send the right ops as the owner', () => {
  const b = bay('rsu-pattern');
  held = { INCIRLIK: ['RSU'] };
  addStrip({ stripId: 's1', fdrId: 'f1', bayId: 'rsu-pattern', rackId: 'initial', ownerPositionId: 'RSU', rev: 3, createdAt: now - 120000, state: 'IN_PATTERN' }, { identity: { callsign: 'VIPER 11' } });
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
  held = { INCIRLIK: ['TWR'] };
  addStrip({ stripId: 's1', fdrId: 'f1', bayId: 'rsu-pattern', rackId: 'initial', ownerPositionId: 'RSU', rev: 1, createdAt: now, state: 'IN_PATTERN' }, { identity: { callsign: 'X' } });
  const c = containerFor(b);
  renderBayDescriptorView(c, b);
  click(descendants(c).find(e => e.className === 'efsp-pattern-next'));
  assert.equal(sent.length, 0);
});

test('the carrier keeps its racks: the pattern board sits above them (no replacesRacks)', () => {
  const b = bay('cv-prifly-pattern');
  held = { CARRIER: ['CV_PRIFLY'] };
  const c = containerFor(b);
  renderBayDescriptorView(c, b);
  assert.ok([...c.children].filter(x => x.className === 'efsp-rack').every(r => r.style.display === ''), 'racks stay');
  assert.ok(descendants(c).some(e => e.className === 'efsp-pattern'), 'the board is mounted');
});

test('a Bay with no view is left alone, and a stale view is removed when a Bay stops having one', () => {
  const b = bay('app-inbound');
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

test('final: the sample is distance to the radar site and a glidepath against a nominal 3 degrees, every missing input leaving its field undefined', () => {
  const strip = { stripId: 's1' };
  const ref = { lat: 37.0, lon: 35.4, elevM: 76 };
  // 3 NM out on a 3 degree path: height above the field = 3 * 6076 * tan(3 deg) = 955 ft
  const lat3nm = ref.lat + 3 / 60;
  const onPath = V.finalSampleFor({ kind: 'PAR', strip, callsign: 'V11', runway: '05', nowS: 10, ref, track: { lat: lat3nm, lon: ref.lon, altitude: { ft: 76 * 3.28084 + 955 } } });
  assert.ok(Math.abs(onPath.distanceNm - 3) < 0.02, `distance ${onPath.distanceNm}`);
  assert.ok(Math.abs(onPath.glidepathDevDeg) < 0.1, `on path, deviation ${onPath.glidepathDevDeg}`);
  assert.ok(Math.abs(onPath.decisionAltFt - (76 * 3.28084 + V.FINAL_DECISION_HEIGHT_FT)) < 0.01);
  const high = V.finalSampleFor({ kind: 'PAR', strip, ref, nowS: 1, track: { lat: lat3nm, lon: ref.lon, altitude: { ft: 76 * 3.28084 + 1900 } } });
  assert.ok(high.glidepathDevDeg > 1, 'well above the path');
  const noAlt = V.finalSampleFor({ kind: 'PAR', strip, ref, nowS: 1, track: { lat: lat3nm, lon: ref.lon } });
  assert.equal(noAlt.altitudeFt, undefined); assert.equal(noAlt.glidepathDevDeg, undefined);
  const noTrack = V.finalSampleFor({ kind: 'PAR', strip, ref, nowS: 1, track: null });
  assert.equal(noTrack.distanceNm, undefined);
  const noRef = V.finalSampleFor({ kind: 'CARRIER', strip, ref: null, nowS: 1, track: { lat: 1, lon: 1 } });
  assert.equal(noRef.distanceNm, undefined);
  assert.equal(noRef.decisionAltFt, undefined, 'no decision height on a deck');
});

test('final: PAR\'s terminals are FINAL\'s own states; the carrier\'s Ball keeps its recorded hand-over', () => {
  assert.deepEqual(V.finalTerminalOp('PAR', { id: 'ASSURED', toState: 'BALL' }), { kind: 'SetState', toState: 'BALL' });
  assert.deepEqual(V.finalTerminalOp('PAR', { id: 'MISSED', toState: 'BOLTER_WAVEOFF' }), { kind: 'SetState', toState: 'BOLTER_WAVEOFF' });
  assert.deepEqual(V.finalTerminalOp('CARRIER', { id: 'BALL', toState: 'BALL' }), { kind: 'CarrierTransfer', transfer: 'FINAL_TO_LSO' });
  assert.deepEqual(V.finalTerminalOp('CARRIER', { id: 'WAVEOFF', toState: 'BOLTER_WAVEOFF' }), { kind: 'SetState', toState: 'BOLTER_WAVEOFF' });
  assert.equal(V.finalTerminalOp('PAR', null), null);
});

test('final mount: PAR\'s Strip becomes the panel with no input in it, racks hidden, and a terminal button sends the owner\'s op', () => {
  const b = bay('par-final');
  held = { INCIRLIK: ['PAR'] };
  addStrip({ stripId: 'p1', fdrId: 'f1', bayId: 'par-final', rackId: 'main', ownerPositionId: 'PAR', rev: 2, state: 'ON_FINAL', role: 'FINAL' }, { identity: { callsign: 'VIPER 11' } });
  const c = containerFor(b);
  renderBayDescriptorView(c, b);
  assert.equal([...c.children].filter(x => x.className === 'efsp-rack').every(r => r.style.display === 'none'), true);
  const all = descendants(c);
  assert.equal(all.some(e => /^(input|select|textarea)$/.test(e.tagName)), false, 'nothing to type on final (§7.10)');
  const buttons = all.filter(e => e.tagName === 'button');
  assert.equal(buttons.length, 2);
  click(buttons[1]);
  assert.deepEqual(sent.pop(), { position: 'PAR', stripId: 'p1', op: { kind: 'SetState', toState: 'BOLTER_WAVEOFF' } });
  click(buttons[0]);
  assert.deepEqual(sent.pop().op, { kind: 'SetState', toState: 'BALL' });
  // not the owner: a tap does nothing
  held = { INCIRLIK: ['TWR'] };
  const c2 = containerFor(b);
  renderBayDescriptorView(c2, b);
  descendants(c2).filter(e => e.tagName === 'button').forEach(click);
  assert.equal(sent.length, 0);
  // an empty Bay says so, rather than drawing nothing
  racks = {}; strips = {};
  const c3 = containerFor(b);
  renderBayDescriptorView(c3, b);
  assert.ok(descendants(c3).some(e => e.className === 'efsp-final-none'));
});

test('sfa header: every pool frequency is a row; the rack headers say the frequency and the controller; only APP gets selects', () => {
  const b = bay('sfa-frequencies');
  const store = new SfaStore({ config: facilityConfig.getSingleFrequencyApproach(), positions: facilityConfig.getPositionSet(), clock: { now: () => now, source: 'T' } });
  applyEfspSfaSnapshot({ sfaRotation: store.view() });
  held = { INCIRLIK: ['SFA'] };
  const c = containerFor(b);
  renderBayDescriptorView(c, b);
  let all = descendants(c);
  assert.equal(all.filter(e => e.className === 'efsp-sfa-row').length, 5);
  assert.equal(all.some(e => e.tagName === 'select'), false, 'SFA only reads the rotation');
  const heads = all.filter(e => e.className === 'efsp-rack-header').map(e => e.textContent);
  assert.equal(heads[0], 'freq-1 · 232.100 · APP');
  assert.equal(heads[3], 'freq-4 · 235.100');
  assert.ok([...c.children].filter(x => x.className === 'efsp-rack').every(r => r.style.display === ''), 'the SFA racks ARE the frequencies and stay');

  held = { INCIRLIK: ['APP'] };
  const c2 = containerFor(b);
  renderBayDescriptorView(c2, b);
  all = descendants(c2);
  const selects = all.filter(e => e.tagName === 'select');
  assert.equal(selects.length, 5);
  assert.deepEqual(descendants(selects[0]).filter(e => e.tagName === 'option').map(o => o.value), ['', 'APP', 'SFA', 'PAR'], 'spare, then the controllers the server names');
  selects[3].value = 'PAR';
  (selects[3]._listeners.change || []).forEach(fn => fn({}));
  assert.deepEqual(sent.pop(), { position: 'APP', sfa: true, op: { kind: 'SetSfaRotation', rackId: 'freq-4', positionId: 'PAR' } });
  selects[0].value = '';
  (selects[0]._listeners.change || []).forEach(fn => fn({}));
  assert.deepEqual(sent.pop().op, { kind: 'SetSfaRotation', rackId: 'freq-1', positionId: null });
  _resetEfspSfaStateForTest();
});

test('the Rotate to PAR button sends the transfer as the Strip\'s owner and goes dead on the press', () => {
  const store = new SfaStore({ config: facilityConfig.getSingleFrequencyApproach(), positions: facilityConfig.getPositionSet(), clock: { now: () => now, source: 'T' } });
  applyEfspSfaSnapshot({ sfaRotation: store.view() });
  held = { INCIRLIK: ['SFA'] };
  const strip = { stripId: 'a1', fdrId: 'f1', rev: 4, role: 'ARRIVAL', state: 'INBOUND', ownerPositionId: 'SFA', facilityId: 'INCIRLIK' };
  strips.a1 = strip; fdrs.f1 = { comms: { workingFrequencyMhz: 234.1 } };
  const buttons = sfaExtraNlaButtons(strip);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].textContent, 'Rotate to PAR');
  click(buttons[0]);
  assert.deepEqual(sent.pop(), { position: 'SFA', stripId: 'a1', op: { kind: 'SfaRotation' } });
  assert.equal(buttons[0].disabled, true);
  fdrs.f1 = { comms: { workingFrequencyMhz: 121.5 } };
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
  const fs = require('fs');
  const root = path.join(__dirname, '../app/public');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const files = [...html.matchAll(/<script src="\.\/(js\/[^"]+)"/g)].map(m => m[1]);
  const declared = new Map(); // name -> [files]
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of src.matchAll(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (!declared.has(m[1])) declared.set(m[1], new Set());
      declared.get(m[1]).add(f);
    }
  }
  const mine = ['pattern-board.js', 'final-panel.js', 'bay-views.js', 'sfa-state.js'];
  for (const f of files.filter(x => mine.some(n => x.endsWith(n)))) {
    for (const [name, where] of declared) {
      if (where.has(f) && where.size > 1) assert.fail(`${name} is declared in ${[...where].join(' and ')}`);
    }
  }
  assert.ok(files.some(f => f.endsWith('bay-views.js')) && files.some(f => f.endsWith('sfa-state.js')), 'both are loaded by index.html');
});
