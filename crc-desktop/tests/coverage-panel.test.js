'use strict';

/* The coverage list, rendered by the real radar-panel.js.
 *
 * Coverage follows the Positions a controller holds (crc-sync's
 * docs/adr/0042), so the panel's job changed from "pick your radars" to
 * "state what your Positions can see, and why". The case worth pinning is the
 * empty one: a Ground or Clearance Delivery controller has no scope, and the
 * panel has to say so with its cause rather than showing an empty box that
 * looks like a fault.
 *
 * Same vm-plus-DOM-stub approach as efsp-ui-reachability.test.js, and for the
 * same reason: it proves the wiring, not the pixels.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PANEL = path.join(__dirname, '../app/public/js/panels/radar-panel.js');

function makeElement(tag) {
  return {
    tagName: tag, className: '', textContent: '', title: '',
    children: [], dataset: {}, style: {}, _listeners: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); }, toggle() {},
    },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener() {},
    closest() { return null; },
    getBoundingClientRect() { return { top: 0, bottom: 10, left: 0, right: 10 }; },
    setAttribute() {}, removeAttribute() {}, focus() {},
    set innerHTML(v) { if (v === '') this.children = []; },
    get innerHTML() { return ''; },
  };
}

/** Loads radar-panel.js against stubs, with the coverage state the app would hold. */
function load({ radars = [], heldPositions = [] } = {}) {
  const list = makeElement('div');
  const nodes = { 'radar-active-list': list };

  const sandbox = {
    console,
    document: {
      getElementById: (id) => nodes[id] || null,
      createElement: makeElement,
      addEventListener() {}, removeEventListener() {},
    },
    // What app.js exposes once a `coverage` message has landed.
    getActiveRadars: () => radars,
    coverageRadars: radars,
    coverageHeldPositions: heldPositions,
    coverageRadarPositions: radars.length ? ['APP'] : [],
    // Everything else radar-panel.js reaches for, stubbed to nothing.
    showLosProfile() {}, hideLosProfile() {},
    PANEL_TITLES: {}, settings: {},
    isPanelPinned: () => false, setPanelPinned() {}, toggleDockPanel() {},
    getAllEfspPositions: () => [], getEfspPosition: () => null,
    sendEfspSetPositions() {}, getActingPositions: () => ({}),
    updateTopbarUI() {}, updateMap() {}, updateZoomLimits() {}, saveSettings() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(PANEL, 'utf8'), sandbox, { filename: 'radar-panel.js' });
  return { sandbox, list };
}

function rowTexts(list) {
  return list.children.map(row => row.children.map(c => c.textContent).join('|') || row.textContent);
}

test('a controller holding nothing is told to select a Position, not shown an empty box', () => {
  const { sandbox, list } = load({ radars: [], heldPositions: [] });
  sandbox.renderCoverageList();
  assert.equal(list.children.length, 1);
  assert.match(list.children[0].textContent, /No radar coverage/);
  assert.match(list.children[0].textContent, /ACTING AS/i);
});

test('a controller holding only scopeless Positions is told which ones work no scope', () => {
  const { sandbox, list } = load({
    radars: [],
    heldPositions: [
      { facilityId: 'INCIRLIK', positionId: 'GND', isPrimary: true },
      { facilityId: 'INCIRLIK', positionId: 'CD', isPrimary: true },
    ],
  });
  sandbox.renderCoverageList();
  const text = list.children[0].textContent;
  assert.match(text, /No radar coverage/);
  assert.match(text, /GND, CD/);
  assert.match(text, /work no scope/, 'two Positions read as plural');
});

test('one scopeless Position reads as singular', () => {
  const { sandbox, list } = load({
    radars: [],
    heldPositions: [{ facilityId: 'INCIRLIK', positionId: 'GND', isPrimary: true }],
  });
  sandbox.renderCoverageList();
  assert.match(list.children[0].textContent, /GND works no scope/);
});

test('each radar is listed with its range and the Position that granted it', () => {
  const { sandbox, list } = load({
    radars: [
      { id: 'app:Incirlik', type: 'approach', label: 'LTAG APP', rangeM: 148160, grantedBy: ['APP'] },
      { id: 'apt:Incirlik', type: 'airport', label: 'LTAG', rangeM: 74080, grantedBy: ['APP', 'TWR'] },
    ],
    heldPositions: [{ facilityId: 'INCIRLIK', positionId: 'APP', isPrimary: true }],
  });
  sandbox.renderCoverageList();

  assert.equal(list.children.length, 2);
  const rows = rowTexts(list);
  // Sorted by label, so LTAG comes before LTAG APP.
  assert.deepEqual(rows, ['LTAG|APP/TWR|40nm', 'LTAG APP|APP|80nm']);
});

test('a radar whose aircraft is on the ground is marked, not hidden', () => {
  const { sandbox, list } = load({
    radars: [{ id: 'crc:11', type: 'awacs', label: 'MAGIC', rangeM: 400000, grantedBy: ['GCI'], onGround: true }],
    heldPositions: [{ facilityId: 'TACTICAL', positionId: 'GCI', isPrimary: true }],
  });
  sandbox.renderCoverageList();
  assert.match(list.children[0].children[0].textContent, /MAGIC GND/);
  assert.ok(list.children[0].className.includes('disabled'));
});

test('the list is replaced rather than appended to on a re-render', () => {
  const { sandbox, list } = load({
    radars: [{ id: 'apt:X', type: 'airport', label: 'X', rangeM: 74080, grantedBy: ['TWR'] }],
    heldPositions: [{ facilityId: 'INCIRLIK', positionId: 'TWR', isPrimary: true }],
  });
  sandbox.renderCoverageList();
  sandbox.renderCoverageList();
  assert.equal(list.children.length, 1);
});

test('hovering a radar row opens its line-of-sight profile', () => {
  let hovered = null;
  const { sandbox, list } = load({
    radars: [{ id: 'app:X', type: 'approach', label: 'X APP', rangeM: 148160, grantedBy: ['APP'] }],
    heldPositions: [{ facilityId: 'INCIRLIK', positionId: 'APP', isPrimary: true }],
  });
  sandbox.showLosProfile = (radar) => { hovered = radar.id; };
  sandbox.renderCoverageList();
  list.children[0]._listeners.mouseenter[0]();
  assert.equal(hovered, 'app:X');
});

test('refreshRadarPanelData renders the coverage list — the entry point app.js calls', () => {
  const { sandbox, list } = load({
    radars: [{ id: 'apt:X', type: 'airport', label: 'X', rangeM: 74080, grantedBy: ['TWR'] }],
    heldPositions: [{ facilityId: 'INCIRLIK', positionId: 'TWR', isPrimary: true }],
  });
  sandbox.refreshRadarPanelData();
  assert.equal(list.children.length, 1);
});

test('nothing in the panel can enable or disable a radar any more', () => {
  const { sandbox } = load();
  // The selector is gone, not hidden: a leftover setter would be a way for a
  // client to put itself back in charge of its own picture.
  assert.equal(sandbox.setRadarEnabled, undefined);
  assert.equal(sandbox.enabledRadarIds, undefined);
  assert.equal(sandbox.renderRadarSearchResults, undefined);
  assert.equal(sandbox.notifyRadarToggled, undefined);
});
