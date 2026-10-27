/* The track-label menu (H164 FT-Q4 a, docs/adr/0140): heading, speed and altitude from a contact's data block, offered
   to the controller acting at the owning Position of its correlated Strip, in that Strip's Facility. The rule is about
   the one acting Position (ADR 0132), so it is held with generated Facilities as well as the shipped Block Maps. */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshGraph } from './helpers/fresh-graph.mjs';
import { descendants } from './helpers/dom-stub.js';

import { BLOCK_MAPS } from '../app/public/js/panels/efsp/strip-template.js';
import { assignmentCellsFor, labelAssignmentFor, labelAssignOps, LABEL_ASSIGN_FIELDS } from '../app/public/js/panels/efsp/label-assign-rules.js';

const strip = (stripId, facilityId, ownerPositionId, over = {}) => ({
  stripId, facilityId, ownerPositionId, stripType: 'ARRIVAL', state: 'INBOUND', bayId: 'b', rev: 1, flightDataId: 'fd1', ...over,
});
const actingFrom = (byFacility) => (f) => byFacility[f] || [];

test('the cells are the Strip\'s own clearance cells, read from the Block Map, in HDG / SPEED / ALT order', () => {
  assert.deepEqual(assignmentCellsFor('DEPARTURE', 'F1').map(c => [c.field, c.blockId]), [['heading', '20'], ['speed', '9A-SPEED'], ['altitude', '21']]);
  assert.deepEqual(assignmentCellsFor('ARRIVAL', 'F1').map(c => [c.field, c.blockId]), [['heading', '9A-VECTOR'], ['speed', '9A-SPEED'], ['altitude', '7']]);
  assert.deepEqual(assignmentCellsFor('OVERFLIGHT', 'F1').map(c => c.blockId), ['9A-VECTOR', '9A-SPEED', '7A']);
  assert.deepEqual(assignmentCellsFor('MISSION', 'F1'), [], 'a mission line has no clearance cells');
  assert.deepEqual(assignmentCellsFor('NO_SUCH_TYPE', 'F1'), []);
  // Every cell offered is a clearance cell of the field it names, with the Block's own label.
  for (const stripType of Object.keys(BLOCK_MAPS)) {
    for (const c of assignmentCellsFor(stripType, 'F1')) {
      const def = BLOCK_MAPS[stripType][c.blockId];
      assert.equal(def.target.kind, 'clearance', `${stripType} ${c.blockId}`);
      assert.equal(def.target.field, c.field);
      assert.equal(c.label, def.label);
      assert.ok(LABEL_ASSIGN_FIELDS.includes(c.field));
    }
  }
});

test('a carrier FINAL offers no HDG or ALT, as its Strip has nothing to type there', () => {
  const fields = assignmentCellsFor('FINAL', 'CARRIER').map(c => c.field);
  assert.equal(fields.includes('heading'), false);
  assert.equal(fields.includes('altitude'), false);
  assert.deepEqual(assignmentCellsFor('FINAL', 'INCIRLIK').map(c => c.field).filter(f => f !== 'speed'), ['heading', 'altitude']);
});

test('the owner is offered the menu; a controller at another Position, or none, is not', () => {
  const s = strip('s1', 'F1', 'APP_A');
  const owner = labelAssignmentFor([s], actingFrom({ F1: ['APP_A'] }));
  assert.equal(owner.strip, s);
  assert.equal(owner.actingPositionId, 'APP_A');
  assert.equal(owner.cells.length, 3);
  assert.equal(labelAssignmentFor([s], actingFrom({ F1: ['TWR_B'] })), null, 'same Facility, not the owner');
  assert.equal(labelAssignmentFor([s], actingFrom({})), null, 'signed on nowhere');
  assert.equal(labelAssignmentFor([], actingFrom({ F1: ['APP_A'] })), null, 'an uncorrelated contact has no Strip');
  assert.equal(labelAssignmentFor([{ ...s, state: 'DROPPED' }], actingFrom({ F1: ['APP_A'] })), null, 'a dropped Strip');
  assert.equal(labelAssignmentFor([{ ...s, stripType: 'MISSION' }], actingFrom({ F1: ['APP_A'] })), null, 'no cells: today\'s click');
});

test('N Facilities: the rule is the acting Position at the Strip\'s own Facility, never a Position anywhere', () => {
  const N = 12;
  const strips = Array.from({ length: N }, (_, i) => strip(`s${i}`, `FAC${i}`, `POS${i}`, { flightDataId: 'fd-shared' }));
  for (let i = 0; i < N; i++) {
    const got = labelAssignmentFor(strips, actingFrom({ [`FAC${i}`]: [`POS${i}`] }));
    assert.equal(got.strip.stripId, `s${i}`, `owner at FAC${i}`);
    assert.equal(got.actingPositionId, `POS${i}`);
  }
  // Acting at POS3 in another Facility's table proves nothing about FAC3's Strip.
  assert.equal(labelAssignmentFor(strips, actingFrom({ FAC4: ['POS3'] })), null);
  // Owning two of the flight's Strips: the preferred one (its Bay is open), else the first.
  const both = actingFrom({ FAC2: ['POS2'], FAC9: ['POS9'] });
  assert.equal(labelAssignmentFor(strips, both).strip.stripId, 's2');
  assert.equal(labelAssignmentFor(strips, both, { prefer: s => s.stripId === 's9' }).strip.stripId, 's9');
});

test('Enter sends one SetBlock per changed cell, in menu order, and nothing for an unchanged one', () => {
  assert.deepEqual(labelAssignOps([
    { blockId: '9A-VECTOR', before: '270', typed: ' 250 ' },
    { blockId: '9A-SPEED', before: '', typed: '' },
    { blockId: '7', before: '060', typed: '040' },
  ]), [{ kind: 'SetBlock', blockId: '9A-VECTOR', value: '250' }, { kind: 'SetBlock', blockId: '7', value: '040' }]);
  assert.deepEqual(labelAssignOps([{ blockId: '7', before: '060', typed: '' }]), [{ kind: 'SetBlock', blockId: '7', value: '' }], 'emptying a cell clears it, as on the Strip');
  assert.deepEqual(labelAssignOps([{ blockId: '7', before: '060', typed: '060' }]), []);
});

// ── The menu itself, over the live client records ─────────────────────────

async function load() {
  const g = freshGraph();
  const ws = await g.import('panels/efsp/efsp-ws.js');
  const state = await g.import('panels/efsp/efsp-state.js');
  const menu = await g.import('panels/efsp/label-menu.js');
  const sent = [];
  ws.setEfspSender('_sendEfsp', (m) => { sent.push(m); return true; });
  document.body.replaceChildren();
  const flightData = {
    flightDataId: 'fd1', rev: 1, identity: { callsign: 'VIPER11' }, filed: {}, assigned: {},
    clearance: { heading: { entries: [{ status: 'ACTIVE', value: '270' }] } },
  };
  state.applyEfspSnapshot({
    facilities: ['FAC_A', 'FAC_B'], positions: [], flightDataList: [flightData],
    strips: [strip('sA', 'FAC_A', 'APP_X', { rev: 4 })],
  });
  state.applyEfspCorrelationDelta({ correlations: { updated: [{ flightDataId: 'fd1', rev: 1, state: 'CORRELATED', trackId: 't1' }] } });
  return { ws, state, menu, sent };
}
const key = (k) => ({ key: k, preventDefault() {}, stopPropagation() {} });
const menuEl = () => document.body.children.find(c => c.className === 'label-menu') || null;
const inputs = () => descendants(menuEl()).filter(c => c.className === 'label-menu-input');

test('the owner\'s click opens the menu on the Strip\'s current values; Enter sends the cell\'s own op', async () => {
  const { ws, state, menu, sent } = await load();
  ws.noteEfspPositionsAck({ facilityId: 'FAC_A', signedOn: ['APP_X'] });
  assert.equal(menu.openLabelMenu('t1', 100, 100), true);
  assert.deepEqual(menu.labelMenuState(), { stripId: 'sA', trackId: 't1' });
  const [hdg, spd, alt] = inputs();
  assert.deepEqual([hdg.dataset.field, spd.dataset.field, alt.dataset.field], ['heading', 'speed', 'altitude']);
  assert.equal(hdg.value, '270');
  assert.equal(document.activeElement, hdg, 'typing starts in HDG');
  hdg.value = '250';
  alt.value = '060';
  menuEl()._listeners.keydown[0](key('Enter'));
  assert.equal(menuEl(), null, 'Enter closes it');
  assert.equal(sent.length, 1, 'one Mutation at a time: the next needs the rev this one leaves');
  assert.equal(sent[0].type, 'efsp-mutation');
  assert.equal(sent[0].actingPositionId, 'APP_X');
  assert.equal(sent[0].facilityId, 'FAC_A');
  assert.equal(sent[0].baseRev, 4);
  assert.deepEqual(sent[0].op, { kind: 'SetBlock', blockId: '9A-VECTOR', value: '250' });
  // The ack moves the Strip's rev; the second cell goes out on it.
  state.applyEfspDelta({ strips: { updated: [strip('sA', 'FAC_A', 'APP_X', { rev: 5 })] } });
  assert.equal(ws.settleEfspAck({ clientMutationId: sent[0].clientMutationId, ok: true }, { ok: true }), false, 'the default surfaces stay');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].baseRev, 5);
  assert.deepEqual(sent[1].op, { kind: 'SetBlock', blockId: '7', value: '060' });
});

test('a refusal stops the rest and leaves the banner to the default surface', async () => {
  const { ws, menu, sent } = await load();
  ws.noteEfspPositionsAck({ facilityId: 'FAC_A', signedOn: ['APP_X'] });
  menu.openLabelMenu('t1', 0, 0);
  const [hdg, , alt] = inputs();
  hdg.value = '999';
  alt.value = '060';
  menuEl()._listeners.keydown[0](key('Enter'));
  assert.equal(ws.settleEfspAck({ clientMutationId: sent[0].clientMutationId, ok: false, reason: 'VALIDATION_ERROR' }, { ok: false }), false);
  assert.equal(sent.length, 1);
});

test('Esc closes the menu and sends nothing', async () => {
  const { ws, menu, sent } = await load();
  ws.noteEfspPositionsAck({ facilityId: 'FAC_A', signedOn: ['APP_X'] });
  menu.openLabelMenu('t1', 0, 0);
  inputs()[0].value = '180';
  menuEl()._listeners.keydown[0](key('Escape'));
  assert.equal(menuEl(), null);
  assert.equal(menu.labelMenuState(), null);
  assert.equal(sent.length, 0);
});

test('not the owner, the owner\'s id in another Facility, or an uncorrelated contact: no menu (the caller opens the track panel)', async () => {
  const { ws, menu } = await load();
  ws.noteEfspPositionsAck({ facilityId: 'FAC_A', signedOn: ['TWR_Y'] });
  assert.equal(menu.openLabelMenu('t1', 0, 0), false);
  ws.noteEfspPositionsAck({ facilityId: 'FAC_A', signedOn: [] });
  ws.noteEfspPositionsAck({ facilityId: 'FAC_B', signedOn: ['APP_X'] });
  assert.equal(menu.openLabelMenu('t1', 0, 0), false);
  ws.noteEfspPositionsAck({ facilityId: 'FAC_A', signedOn: ['APP_X'] });
  assert.equal(menu.openLabelMenu('no-such-contact', 0, 0), false);
  assert.equal(menuEl(), null);
});

test('the TRACK item is today\'s click: it closes the menu and opens the track panel', async () => {
  const { ws, menu } = await load();
  ws.noteEfspPositionsAck({ facilityId: 'FAC_A', signedOn: ['APP_X'] });
  let opened = 0;
  menu.openLabelMenu('t1', 0, 0, { onTrackInfo: () => { opened++; } });
  const track = descendants(menuEl()).find(c => c.className === 'label-menu-track');
  assert.equal(track.textContent, 'TRACK');
  track._listeners.click[0]();
  assert.equal(opened, 1);
  assert.equal(menuEl(), null);
});

// crc-sync docs/adr/0147 (H176): SUPPRESS is on the owner's menu only. A conflict alert never opens the menu by itself
// (S-ARCH-112's non-owner menu is gone): the controller working the other aircraft clicks this one and gets the track panel.
test('a conflict alert: SUPPRESS on the owner\'s menu, one frame; no menu for a controller who does not hold the Strip', async () => {
  const { ws, state, menu, sent } = await load();
  const alert = (shownAt) => state.applyEfspAlerts({ conformance: [], obligations: [], airspaceEntry: [], conflictAlert: [{
    id: 't1|t2', kind: 'CA', a: 't1', b: 't2', aCallsign: 'VIPER11', bCallsign: 'COLT21', timeToCpaSec: 40, minNm: 1, vertFt: 200, shownAt,
  }] });
  ws.noteEfspPositionsAck({ facilityId: 'FAC_A', signedOn: ['TWR_Y'] });
  alert(['TWR_Y']); // TWR_Y works t2, so it is shown the alert
  assert.equal(menu.openLabelMenu('t1', 0, 0), false, 'not the owner of t1: no menu, the alert alone does not open one');

  ws.noteEfspPositionsAck({ facilityId: 'FAC_A', signedOn: ['APP_X', 'TWR_Y'] });
  alert(['APP_X', 'TWR_Y']);
  assert.equal(menu.openLabelMenu('t1', 0, 0), true);
  const items = descendants(menuEl()).filter(c => c.className === 'label-menu-suppress');
  assert.deepEqual(items.map(b => b.textContent), ['SUPPRESS CA COLT21']);
  items[0]._listeners.click[0]();
  const frames = sent.filter(m => m.type === 'efsp-conflict-suppress');
  assert.equal(frames.length, 1, 'one frame: the server applies it at every Position of this controller it is shown at');
  assert.deepEqual([frames[0].conflictId, frames[0].suppress], ['t1|t2', true]);
});
