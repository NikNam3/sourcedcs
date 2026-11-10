// The RADIO 2 panel's wiring (app/public/js/radio/radio-panel.js) against the shared DOM stub and the stub engine: the
// rows follow the signed-on Positions and the frequency table, clicks reach the prefs, and PTT keys the group.
// Wiring only: nothing here is about layout. Position and Facility ids are test fixtures.
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { noteCoveragePositions, noteEfspPositionsAck } from '../app/public/js/panels/efsp/efsp-ws.js';
import { replaceFrequencyRows } from '../app/public/js/panels/efsp/frequency-state.js';
import { markEfspChanged } from '../app/public/js/panels/efsp/efsp-change-bus.js';
import { initRadioPanel } from '../app/public/js/radio/radio-panel.js';
import { getRadioPrefs } from '../app/public/js/radio/radio-prefs.js';
import { _stubInspect, _stubReceive } from '../app/public/js/radio/radio-engine-stub.js';
import { settings } from '../app/public/js/settings.js';

const require = createRequire(import.meta.url);
const { makeElement, descendants } = require('./helpers/dom-stub.js');

const root = makeElement('div');
const all = () => descendants(root);
const byClass = (c) => all().filter(n => String(n.className).split(/\s+/).includes(c));
const rowOf = (id) => byClass('radio-row').find(r => r.dataset.radioId === id);
const fire = (node, type, extra = {}) => { for (const fn of node._listeners[type] || []) fn({ preventDefault() {}, stopPropagation() {}, ...extra }); };
const within = (node, c) => descendants(node).find(n => String(n.className).split(/\s+/).includes(c));
const sectionNames = () => byClass('radio-group-name').map(n => n.textContent);

function setup() {
  document.getElementById = (id) => (id === 'radio-panel' ? root : null);
  // The shared stub has no querySelectorAll and a no-op classList.toggle; the panel uses both.
  const element = (tag) => {
    const e = makeElement(tag);
    e.querySelectorAll = (sel) => descendants(e).filter(n => String(n.className).split(/\s+/).includes(sel.slice(1)));
    e.classList.toggle = function (c, on) { if (on === undefined ? !this._set.has(c) : on) this._set.add(c); else this._set.delete(c); };
    return e;
  };
  document.createElement = element;
  document.createDocumentFragment = () => element('#fragment');
  root.querySelectorAll = (sel) => (sel === '.radio-row' ? byClass('radio-row') : []);
  globalThis.queueMicrotask = globalThis.queueMicrotask || ((fn) => Promise.resolve().then(fn));
  replaceFrequencyRows([
    { facilityId: 'FAC1', kind: 'POSITION', positionId: 'P1', label: 'TWR', mhz: 275.8, defaultMhz: 275.8, added: false },
    { facilityId: 'FAC1', kind: 'POSITION', positionId: 'P1', label: 'TWR VHF', mhz: 122.1, defaultMhz: 122.1, added: false },
  ]);
  initRadioPanel();
}

test('the panel: guards only, then a sign-on brings the Position radios into the automatic group', () => {
  setup();
  assert.deepEqual(byClass('radio-row').map(r => r.dataset.radioId), ['GUARD:UHF', 'GUARD:VHF']);
  assert.deepEqual(sectionNames(), ['POSITIONS', 'UNLINKED']);
  noteEfspPositionsAck({ facilityId: 'FAC1', signedOn: ['P1', 'P9'] });
  markEfspChanged('positions');
  assert.deepEqual(byClass('radio-row').map(r => r.dataset.radioId), ['POSITION:P1:UHF', 'POSITION:P1:VHF', 'GUARD:UHF', 'GUARD:VHF']);
  assert.deepEqual(_stubInspect().radios.map(r => r.id), ['POSITION:P1:UHF', 'POSITION:P1:VHF', 'GUARD:UHF', 'GUARD:VHF']);
  assert.ok(byClass('radio-panel-note').some(n => n.textContent === 'P9: no frequency (FREQUENCIES panel)'));
});

test('PTT keys the selected radio\'s whole group on the stub engine; the button lights', () => {
  const ptt = byClass('radio-ptt')[0];
  assert.equal(ptt.textContent, 'PTT P1 TWR');
  fire(ptt, 'mousedown');
  assert.deepEqual(_stubInspect().txRadioIds, ['POSITION:P1:UHF', 'POSITION:P1:VHF']);
  fire(ptt, 'mouseup');
  assert.deepEqual(_stubInspect().txRadioIds, []);
});

test('a group: create, move a radio in through its link menu, delete (it becomes unlinked)', () => {
  fire(within(byClass('radio-group-create')[0], 'radio-small-btn'), 'click');
  assert.deepEqual(getRadioPrefs().groups, [{ id: 'G1', name: 'A' }]);
  assert.equal(settings.radio.groups.length, 1); // persisted through settings.js's one radio object
  const link = within(rowOf('GUARD:VHF'), 'radio-link');
  link.value = 'G1';
  fire(link, 'change');
  assert.equal(_stubInspect().radios.find(r => r.id === 'GUARD:VHF').groupId, 'G1');
  assert.deepEqual(sectionNames(), ['POSITIONS', 'A', 'UNLINKED']);
  const del = byClass('radio-small-btn').find(b => b.textContent === 'DELETE');
  fire(del, 'click');
  assert.equal(_stubInspect().radios.find(r => r.id === 'GUARD:VHF').groupId, null);
  assert.equal(getRadioPrefs().membership['GUARD:VHF'], null);
});

test('a manual radio: a refused frequency is said, a good one is added, then removed', () => {
  fire(byClass('radio-small-btn').find(b => b.textContent === '+ RADIO'), 'click');
  const form = byClass('radio-manual-form')[0];
  const [label, freq] = descendants(form).filter(n => n.tagName === 'input');
  freq.value = '275.81';
  fire(byClass('radio-small-btn').find(b => b.textContent === 'ADD'), 'click');
  assert.ok(byClass('radio-conflict').some(n => /25 kHz grid/.test(n.textContent)));
  label.value = 'tac';
  const freq2 = descendants(byClass('radio-manual-form')[0]).filter(n => n.tagName === 'input')[1];
  freq2.value = '251.0';
  const label2 = descendants(byClass('radio-manual-form')[0]).filter(n => n.tagName === 'input')[0];
  label2.value = 'tac';
  fire(byClass('radio-small-btn').find(b => b.textContent === 'ADD'), 'click');
  assert.deepEqual(getRadioPrefs().manual, [{ id: 'm1', mhz: 251, modulation: 'AM', label: 'TAC' }]);
  assert.ok(rowOf('MANUAL:m1'));
  fire(within(rowOf('MANUAL:m1'), 'radio-remove'), 'click');
  assert.equal(rowOf('MANUAL:m1'), undefined);
});

test('volume and mute are kept per radio identity and reach the engine', () => {
  const row = rowOf('POSITION:P1:UHF');
  const vol = within(row, 'radio-vol');
  vol.value = '2.5';
  fire(vol, 'input');
  assert.equal(_stubInspect().audio['POSITION:P1:UHF'].volume, 2.5);
  fire(vol, 'change');
  assert.equal(getRadioPrefs().audio['POSITION:P1:UHF'].volume, 2.5);
  fire(within(rowOf('POSITION:P1:UHF'), 'radio-mute'), 'click');
  assert.equal(getRadioPrefs().audio['POSITION:P1:UHF'].muted, true);
  assert.equal(within(rowOf('POSITION:P1:UHF'), 'radio-mute').textContent, 'MUTED');
});

test('RX lights from the engine state; the engine line says the stub is not joined, as a problem', () => {
  _stubReceive(['GUARD:UHF']);
  assert.ok(byClass('radio-engine-line')[0].textContent.includes('stub'));
  assert.ok(byClass('radio-engine-line')[0].classList.contains('radio-problem'));
  assert.equal(rowOf('GUARD:UHF').classList.contains('radio-row-rx'), true);
  assert.equal(rowOf('GUARD:VHF').classList.contains('radio-row-rx'), false);
  _stubReceive([]);
  assert.equal(rowOf('GUARD:UHF').classList.contains('radio-row-rx'), false);
});

test('an Observer\'s Position radios are receive-only: unlinked, the link menu off, PTT never keys them', () => {
  noteCoveragePositions([{ facilityId: 'FAC1', positionId: 'P1', isPrimary: false }]);
  const r = _stubInspect().radios.find(x => x.id === 'POSITION:P1:UHF');
  assert.equal(r.receiveOnly, true);
  assert.equal(r.groupId, null);
  assert.equal(within(rowOf('POSITION:P1:UHF'), 'radio-link').disabled, true);
  assert.ok(descendants(rowOf('POSITION:P1:UHF')).some(n => n.textContent === 'RX ONLY (Observer)'));
  const ptt = byClass('radio-ptt')[0];
  assert.notEqual(ptt.textContent, 'PTT P1 TWR'); // the target fell back off the receive-only radio
  fire(ptt, 'mousedown');
  assert.ok(!_stubInspect().txRadioIds.includes('POSITION:P1:UHF'));
  fire(ptt, 'mouseup');
});
