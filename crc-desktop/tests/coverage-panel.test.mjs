/* The coverage list, rendered by the real radar-panel.js.
 *
 * Coverage follows the Positions a controller holds (crc-sync's
 * docs/adr/0042), so the panel's job changed from "pick your radars" to
 * "state what your Positions can see, and why". The case worth pinning is the
 * empty one: a Ground or Clearance Delivery controller has no scope, and the
 * panel has to say so with its cause rather than showing an empty box that
 * looks like a fault.
 *
 * Same vm-plus-DOM-stub approach as efsp-ui-reachability.test.mjs, and for the
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
async function load({ radars = [], signedOnPositions = [], stored = null } = {}) {
  const list = makeElement('div');
  const header = makeElement('div');
  const nodes = { 'radar-active-list': list, 'radar-list-header': header };
  // The open/closed memory is read when the module loads, so set it first.
  globalThis.localStorage.clear();
  if (stored !== null) globalThis.localStorage.setItem('crc-desktop-radar-list-expanded', stored);
  globalThis.document.getElementById = (id) => nodes[id] || null;
  globalThis.document.createElement = makeElement;

  const g = freshGraph();
  const picture = await g.import('picture.js');
  const radarPanel = await g.import('panels/radar-panel.js');
  const losPanel = await g.import('panels/los-panel.js');
  // What picture.js holds once a `coverage` message has landed.
  picture._setCoverageRadars(radars);
  picture._setCoverageSignedOnPositions(signedOnPositions);
  return { sandbox: radarPanel, list, header, losPanel };
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
  // Sorted by label, so LTAG comes before LTAG AP.
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

// ── Collapsed by default (H171 FT-Q11) ─────────────────────────────────────

const MANY = Array.from({ length: 214 }, (_, i) => ({
  id: `apt:${i}`, type: 'airport', label: `AP${String(i).padStart(3, '0')}`, rangeM: 74080, grantedBy: ['CTR'],
}));
const CTR = [{ facilityId: 'ENROUTE', positionId: 'CTR', isPrimary: true }];

test('the radar list starts collapsed behind one summary line with its count', async () => {
  const { sandbox, list, header } = await load({ radars: MANY, signedOnPositions: CTR });
  sandbox.renderCoverageList();
  assert.equal(header.textContent, 'RADARS · 214 ▸');
  assert.equal(list.style.display, 'none', 'the rows are hidden');
  assert.equal(list.children.length, 214, 'but drawn, so opening is instant');
});

test('clicking the summary line opens the list, a second click closes it, and the choice is remembered', async () => {
  const { sandbox, list, header } = await load({ radars: MANY, signedOnPositions: CTR });
  sandbox.initRadarPanel();
  header._listeners.click[0]();
  assert.equal(header.textContent, 'RADARS · 214 ▾');
  assert.equal(list.style.display, '');
  assert.equal(globalThis.localStorage.getItem('crc-desktop-radar-list-expanded'), '1');
  header._listeners.click[0]();
  assert.equal(header.textContent, 'RADARS · 214 ▸');
  assert.equal(list.style.display, 'none');
  assert.equal(globalThis.localStorage.getItem('crc-desktop-radar-list-expanded'), '0');
});

test('a viewer who left the list open finds it open', async () => {
  const { sandbox, list, header } = await load({ radars: MANY, signedOnPositions: CTR, stored: '1' });
  assert.equal(sandbox.isRadarListExpanded(), true);
  sandbox.renderCoverageList();
  assert.equal(header.textContent, 'RADARS · 214 ▾');
  assert.equal(list.style.display, '');
});

test('without working storage the list starts collapsed and still opens', async () => {
  const real = globalThis.localStorage;
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, clear() {} };
  Object.defineProperty(globalThis, 'localStorage', { value: broken, configurable: true, writable: true });
  try {
    const { sandbox, list, header } = await load({ radars: MANY, signedOnPositions: CTR });
    assert.equal(sandbox.isRadarListExpanded(), false);
    sandbox.setRadarListExpanded(true);
    assert.equal(header.textContent, 'RADARS · 214 ▾');
    assert.equal(list.style.display, '');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true, writable: true });
  }
});

test('radars on the ground stay counted in the collapsed line', async () => {
  const radars = [
    { id: 'crc:11', type: 'awacs', label: 'MAGIC', rangeM: 400000, grantedBy: ['GCI'], onGround: true },
    { id: 'crc:12', type: 'awacs', label: 'DARKSTAR', rangeM: 400000, grantedBy: ['GCI'], onGround: true },
    { id: 'apt:X', type: 'airport', label: 'X', rangeM: 74080, grantedBy: ['GCI'] },
  ];
  const { sandbox, header } = await load({ radars, signedOnPositions: [{ facilityId: 'TACTICAL', positionId: 'GCI', isPrimary: true }] });
  sandbox.renderCoverageList();
  assert.equal(header.textContent, 'RADARS · 3 · 2 GND ▸');
});

test('no radars: the summary has no caret and the empty-state answer shows while collapsed', async () => {
  const { sandbox, list, header } = await load({ radars: [], signedOnPositions: [] });
  sandbox.initRadarPanel();
  assert.equal(header.textContent, 'RADARS · 0');
  assert.equal(list.style.display, '');
  assert.match(list.children[0].textContent, /No radar coverage/);
  header._listeners.click[0]();
  assert.equal(globalThis.localStorage.getItem('crc-desktop-radar-list-expanded'), null, 'nothing to open');
});

test('radarListSummary, the summary text alone', async () => {
  const { sandbox } = await load();
  assert.equal(sandbox.radarListSummary([{ onGround: false }], false), 'RADARS · 1 ▸');
  assert.equal(sandbox.radarListSummary([{ onGround: true }], true), 'RADARS · 1 · 1 GND ▾');
  assert.equal(sandbox.radarListSummary([], true), 'RADARS · 0');
});

test('ACTING AS comes before the radar list in the panel markup, so the list never pushes it down', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../app/public/index.html', import.meta.url), 'utf8');
  const panel = html.slice(html.indexOf('<div id="radars-panel"'), html.indexOf('<div id="los-profile-panel"'));
  assert.ok(panel.indexOf('id="efsp-position-controls"') < panel.indexOf('id="radar-list-header"'));
  assert.ok(panel.indexOf('id="radar-list-header"') < panel.indexOf('id="radar-active-list"'));
});
