/* B9: text typed into the airspace Delay note survives an airspace update that rebuilds every card. */
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import domStub from './helpers/dom-stub.js';
import { freshGraph } from './helpers/fresh-graph.mjs';

const { makeElement, descendants } = domStub;
const route = {
  airspaceId: 'IR-1', theater: 'Syria', defRev: 1, rev: 1, state: 'SCHEDULED', window: null, transitions: [], updatedAt: 0, updatedBy: null,
  pendingRequest: { requestedPositionId: 'TAC_C2' },
  definition: { airspaceId: 'IR-1', name: 'IR ONE', kind: 'ROUTE', type: 'IR', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingPositionId: null, workingFrequencyMhz: 134, altLowerFt: null, altUpperFt: null, geometry: null },
};

test('a typed Delay note and its focus survive an airspace update', async () => {
  const listEl = makeElement('div'); listEl.parentNode = makeElement('div'); listEl.parentNode.insertBefore = () => {};
  globalThis.document.getElementById = (id) => (id === 'airspace-list' ? listEl : null);
  const g = freshGraph();
  const state = await g.import('panels/efsp/efsp-state.js');
  const ws = await g.import('panels/efsp/efsp-ws.js');
  const panel = await g.import('panels/efsp/airspace-panel.js');
  ws.setEfspSender('_sendEfsp', () => {});
  ws.sendEfspSetPositions('CENTER', ['CTR']);
  state.applyEfspAirspaceDelta({ airspaces: { updated: [route] } });
  panel.initAirspacePanel();

  const find = (cls) => descendants(listEl).find(e => (e.className || '').split(/\s+/).includes(cls) && e.textContent === 'Delay');
  const delayBtn = descendants(listEl).find(e => e.tagName === 'button' && e.textContent === 'Delay');
  assert.ok(delayBtn, 'the Delay action is offered'); void find;
  delayBtn._listeners.click[0]();
  const inputOf = () => descendants(listEl).find(e => e.tagName === 'input' && e.placeholder && /Delay note/.test(e.placeholder));
  const first = inputOf();
  assert.ok(first);
  first.value = 'after 1500Z';
  for (const f of first._listeners.input || []) f();
  first.focus();
  first.selectionStart = first.selectionEnd = 5;

  // Any airspace update (a calendar frame, another airspace's delta) rebuilds the cards.
  state.applyEfspAirspaceDelta({ airspaces: { updated: [{ ...route, rev: 2 }] } });
  panel.renderAirspacePanel();
  const second = inputOf();
  assert.notEqual(second, first, 'the card was rebuilt');
  assert.equal(second.value, 'after 1500Z');
  assert.equal(globalThis.document.activeElement, second, 'focus followed the rebuild');
  globalThis.document.activeElement = null;
  globalThis.document.getElementById = () => null;
});
