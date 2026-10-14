/* The airspace card's flight list (crc-sync docs/adr/0124 §1, H140 LT-AQ1 b): OPS, the using agency, sees the flights
 * inside or filed through the airspace and approves one it holds no Strip for; approved rows are grey, an alerting one
 * amber; a session the server sent no list gets no block (dark cockpit). */

import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/client-env.mjs';
import { freshGraph } from './helpers/fresh-graph.mjs';

const MOA = {
  airspaceId: 'MOA-1', state: 'ACTIVE', pendingRequest: null, window: null, rev: 1,
  definition: { airspaceId: 'MOA-1', name: 'Bravo MOA', type: 'MOA', kind: 'AREA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'INCIRLIK' },
};
const strip = (stripId, flightDataId, ownerPositionId, facilityId = 'INCIRLIK') => ({
  stripId, flightDataId, rev: 3, stripType: 'DEPARTURE', state: 'HANDED_OFF', facilityId,
  bayId: 'ap-departures', rackId: 'main', orderKey: 'V', ownerPositionId,
  annotations: {}, flags: {}, coordination: null, tofiCoordination: null, airspaceEntry: null, previousLeg: null,
});
const row = (over) => ({ flightDataId: 'fd1', callsign: 'VIPER11', inside: true, filed: false, approved: false, alerting: true, strips: [{ facilityId: 'INCIRLIK', stripId: 's-ap', positionId: 'AP' }], ...over });

async function mount({ signedOn = ['OPS'], traffic }) {
  const sent = [];
  const g = freshGraph();
  const state = await g.import('panels/efsp/efsp-state.js');
  const ws = await g.import('panels/efsp/efsp-ws.js');
  const list = await g.import('panels/efsp/airspace-entry-list.js');
  ws.setEfspSender('_sendEfsp', () => {});
  ws.sendEfspSetPositions('INCIRLIK', signedOn);
  ws.setEfspSender('sendEfspMutation', (...args) => { sent.push(args); return 'mid'; });
  state.applyEfspSnapshot({ strips: [strip('s-ap', 'fd1', 'AP'), strip('s-ctr', 'fd2', 'CTR', 'CENTER')], flightDataList: [], positions: [], bays: [], airspaces: [], correlations: [], marsa: [] });
  state.applyEfspAlerts({ airspaceTraffic: traffic });
  return { list, sent };
}

test('OPS sees AP\'s flight inside unapproved, amber, and Approve sends ApproveAirspaceEntry on AP\'s Strip as OPS', async () => {
  const { list, sent } = await mount({ traffic: [{ airspaceId: 'MOA-1', flights: [row()] }] });
  const el = list.buildAirspaceEntryList(MOA);
  assert.ok(el, 'the block is there');
  const [r] = el.children;
  assert.match(r.className, /airspace-entry-alerting/);
  const btn = r.children.find(c => /airspace-entry-approve-btn/.test(c.className));
  assert.ok(btn, 'Approve is offered');
  for (const fn of btn._listeners.click) fn({ stopPropagation() {} });
  assert.equal(sent.length, 1);
  const [positionId, s, op] = sent[0];
  assert.deepEqual([positionId, s.stripId, s.rev, op], ['OPS', 's-ap', 3, { kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-1' }]);
});

test('an approved flight is grey with no button; a VFR one inside is neither amber nor approved', async () => {
  const { list } = await mount({ traffic: [{ airspaceId: 'MOA-1', flights: [
    row({ approved: true, alerting: false }),
    row({ flightDataId: 'fd3', callsign: 'CESSNA1', alerting: false }),
  ] }] });
  const [approved, vfr] = list.buildAirspaceEntryList(MOA).children;
  assert.match(approved.className, /airspace-entry-approved/);
  assert.equal(approved.children.some(c => /approve-btn/.test(c.className)), false);
  assert.doesNotMatch(vfr.className, /alerting|approved/);
});

test('no list from the server, or an empty one: no block (dark cockpit)', async () => {
  let m = await mount({ traffic: [] });
  assert.equal(m.list.buildAirspaceEntryList(MOA), null);
  m = await mount({ traffic: [{ airspaceId: 'MOA-1', flights: [] }] });
  assert.equal(m.list.buildAirspaceEntryList(MOA), null);
});

test('a flight whose Strips this controller cannot act on is listed without Approve', async () => {
  const { list } = await mount({ signedOn: ['OPS'], traffic: [{ airspaceId: 'MOA-1', flights: [
    row({ flightDataId: 'fd2', callsign: 'HAWG21', inside: false, filed: true, alerting: false, strips: [{ facilityId: 'CENTER', stripId: 's-ctr', positionId: 'CTR' }] }),
  ] }] });
  const [r] = list.buildAirspaceEntryList(MOA).children;
  assert.equal(r.children.some(c => /approve-btn/.test(c.className)), false, 'OPS holds nothing at CENTER');
  assert.equal(list.entryRowWhy({ inside: false, filed: true }), 'filed');
});

test('the Strip\'s owner approves as itself', async () => {
  const { list } = await mount({ signedOn: ['AP'], traffic: [{ airspaceId: 'MOA-1', flights: [row()] }] });
  const path = list.approvePathFor(row(), MOA.definition);
  assert.deepEqual([path.positionId, path.strip.stripId], ['AP', 's-ap']);
});
