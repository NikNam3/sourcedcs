'use strict';

/* The Position tab strip doubles as the drag drop-target surface, and used
   to render tabs ONLY for Positions the controller holds — so a controller
   holding one Position had nowhere to drag a handoff. Covers the pure
   tab-set computation; the DOM render around it stays untested, as the rest
   of this file's UI does. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { computePositionTabs } = require('../app/public/js/panels/efsp/efsp-panel.js');

const BAYS = [
  { bayId: 'ops-proposed', positionId: 'OPS', facilityId: 'INCIRLIK' },
  { bayId: 'cd-pending', positionId: 'CD', facilityId: 'INCIRLIK' },
  { bayId: 'gnd-taxi', positionId: 'GND', facilityId: 'INCIRLIK' },
  { bayId: 'ctr-enroute', positionId: 'CTR', facilityId: 'CENTER' },
  { bayId: 'tac-c2-tasked', positionId: 'TAC_C2', facilityId: 'TACTICAL' },
];

test('a single-Position controller still gets a drop target for every other Position at that Facility', () => {
  const tabs = computePositionTabs(BAYS, ['OPS']);
  assert.deepEqual(tabs.map(t => t.positionId), ['OPS', 'CD', 'GND']);
  assert.deepEqual(tabs.map(t => t.held), [true, false, false]);
});

test('held Positions come first, so the tabs a controller actually works in stay leftmost', () => {
  const tabs = computePositionTabs(BAYS, ['GND']);
  assert.equal(tabs[0].positionId, 'GND');
  assert.equal(tabs[0].held, true);
  assert.equal(tabs.slice(1).every(t => t.held === false), true);
});

test('Positions at a Facility the controller holds nothing at are never offered — TransferStrip is per-Facility, so that drop could only ever fail', () => {
  const tabs = computePositionTabs(BAYS, ['OPS']);
  assert.equal(tabs.some(t => t.facilityId !== 'INCIRLIK'), false);
});

test('holding Positions at two Facilities surfaces drop targets at both, and only those two', () => {
  const tabs = computePositionTabs(BAYS, ['OPS', 'CTR']);
  assert.deepEqual(tabs.filter(t => t.held).map(t => t.positionId).sort(), ['CTR', 'OPS']);
  assert.equal(tabs.some(t => t.facilityId === 'TACTICAL'), false);
  assert.deepEqual(tabs.filter(t => !t.held).map(t => t.positionId), ['CD', 'GND']);
});

test('only held Positions carry their Bays — a drop-only tab has nothing to page through', () => {
  const tabs = computePositionTabs(BAYS, ['OPS']);
  assert.equal(tabs.find(t => t.positionId === 'OPS').bays.length, 1);
  assert.deepEqual(tabs.find(t => t.positionId === 'CD').bays, []);
});

test('holding nothing renders no tabs at all, not every Position in the system', () => {
  assert.deepEqual(computePositionTabs(BAYS, []), []);
});

test('missing inputs are tolerated rather than thrown on — the snapshot may not have landed yet', () => {
  assert.deepEqual(computePositionTabs(undefined, undefined), []);
  assert.deepEqual(computePositionTabs(BAYS, undefined), []);
});
