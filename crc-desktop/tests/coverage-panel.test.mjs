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

import test from 'node:test';
import assert from 'node:assert/strict';

import './helpers/client-env.mjs';
import { freshGraph } from './helpers/fresh-graph.mjs';

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
async function load({ radars = [], signedOnPositions = [] } = {}) {
  const list = makeElement('div');
  const nodes = { 'radar-active-list': list };
  globalThis.document.getElementById = (id) => nodes[id] || null;
  globalThis.document.createElement = makeElement;

  const g = freshGraph();
  const app = await g.import('app.js');
  const radarPanel = await g.import('panels/radar-panel.js');
  const losPanel = await g.import('panels/los-panel.js');
  // What app.js holds once a `coverage` message has landed.
  app._setCoverageRadars(radars);
  app._setCoverageHeldPositions(signedOnPositions);
  return { sandbox: radarPanel, list, losPanel };
}

function rowTexts(list) {
  return list.children.map(row => row.children.map(c => c.textContent).join('|') || row.textContent);
}

test('a controller holding nothing is told to select a Position, not shown an empty box', async () => {
  const { sandbox, list } = await load({ radars: [], signedOnPositions: [] });
  sandbox.renderCoverageList();
  assert.equal(list.children.length, 1);
  assert.match(list.children[0].textContent, /No radar coverage/);
  assert.match(list.children[0].textContent, /ACTING AS/i);
});

test('a controller holding only scopeless Positions is told which ones work no scope', async () => {
  const { sandbox, list } = await load({
    radars: [],
    signedOnPositions: [
      { facilityId: 'INCIRLIK', positionId: 'GC', isPrimary: true },
      { facilityId: 'INCIRLIK', positionId: 'CD', isPrimary: true },
    ],
  });
  sandbox.renderCoverageList();
  const text = list.children[0].textContent;
  assert.match(text, /No radar coverage/);
  assert.match(text, /GC, CD/);
  assert.match(text, /work no scope/, 'two Positions read as plural');
});

test('one scopeless Position reads as singular', async () => {
  const { sandbox, list } = await load({
    radars: [],
    signedOnPositions: [{ facilityId: 'INCIRLIK', positionId: 'GC', isPrimary: true }],
  });
  sandbox.renderCoverageList();
  assert.match(list.children[0].textContent, /GC works no scope/);
});

test('each radar is listed with its range and the Position that granted it', async () => {
  const { sandbox, list } = await load({
    radars: [
      { id: 'app:Incirlik', type: 'approach', label: 'LTAG APP', rangeM: 148160, grantedBy: ['AP'] },
      { id: 'apt:Incirlik', type: 'airport', label: 'LTAG', rangeM: 74080, grantedBy: ['AP', 'LC'] },
    ],
    signedOnPositions: [{ facilityId: 'INCIRLIK', positionId: 'AP', isPrimary: true }],
  });
  sandbox.renderCoverageList();

  assert.equal(list.children.length, 2);
  const rows = rowTexts(list);
  // Sorted by label, so LTAG comes before LTAG APP.
  assert.deepEqual(rows, ['LTAG|AP/LC|40nm', 'LTAG APP|AP|80nm']);
});

test('a radar whose aircraft is on the ground is marked, not hidden', async () => {
  const { sandbox, list } = await load({
    radars: [{ id: 'crc:11', type: 'awacs', label: 'MAGIC', rangeM: 400000, grantedBy: ['GCI'], onGround: true }],
    signedOnPositions: [{ facilityId: 'TACTICAL', positionId: 'GCI', isPrimary: true }],
  });
  sandbox.renderCoverageList();
  assert.match(list.children[0].children[0].textContent, /MAGIC GND/);
  assert.ok(list.children[0].className.includes('disabled'));
});

test('the list is replaced rather than appended to on a re-render', async () => {
  const { sandbox, list } = await load({
    radars: [{ id: 'apt:X', type: 'airport', label: 'X', rangeM: 74080, grantedBy: ['LC'] }],
    signedOnPositions: [{ facilityId: 'INCIRLIK', positionId: 'LC', isPrimary: true }],
  });
  sandbox.renderCoverageList();
  sandbox.renderCoverageList();
  assert.equal(list.children.length, 1);
});

test('hovering a radar row opens its line-of-sight profile', async () => {
  let hovered = null;
  const { sandbox, list, losPanel } = await load({
    radars: [{ id: 'app:X', type: 'approach', label: 'X APP', rangeM: 148160, grantedBy: ['AP'] }],
    signedOnPositions: [{ facilityId: 'INCIRLIK', positionId: 'AP', isPrimary: true }],
  });
  losPanel._setShowLosProfileForTest((radar) => { hovered = radar.id; });
  sandbox.renderCoverageList();
  list.children[0]._listeners.mouseenter[0]();
  assert.equal(hovered, 'app:X');
});

test('refreshRadarPanelData renders the coverage list — the entry point app.js calls', async () => {
  const { sandbox, list } = await load({
    radars: [{ id: 'apt:X', type: 'airport', label: 'X', rangeM: 74080, grantedBy: ['LC'] }],
    signedOnPositions: [{ facilityId: 'INCIRLIK', positionId: 'LC', isPrimary: true }],
  });
  sandbox.refreshRadarPanelData();
  assert.equal(list.children.length, 1);
});

test('nothing in the panel can enable or disable a radar any more', async () => {
  const { sandbox } = await load();
  // The selector is gone, not hidden: a leftover setter would be a way for a
  // client to put itself back in charge of its own picture.
  assert.equal(sandbox.setRadarEnabled, undefined);
  assert.equal(sandbox.enabledRadarIds, undefined);
  assert.equal(sandbox.renderRadarSearchResults, undefined);
  assert.equal(sandbox.notifyRadarToggled, undefined);
});
