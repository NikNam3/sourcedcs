/* Transit through active SUA on the client (crc-sync docs/adr/0128, H151): the grey marks, what a Strip offers, what a card
 * row offers, the entry-block fields, and the card row sending the transit ops. */

import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/client-env.mjs';
import { freshGraph } from './helpers/fresh-graph.mjs';
import * as rules from '../app/public/js/panels/efsp/transit-rules.js';
import { parseEntryBlock, entryBlockTexts } from '../app/public/js/panels/efsp/entry-block.js';

const def = (over) => ({ kind: 'AREA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', ...over });
const airspace = (airspaceId, over = {}, transits = []) => ({ airspaceId, state: 'ACTIVE', rev: 1, transits, definition: { airspaceId, name: airspaceId, ...def(over) } });
const T = (state, over = {}) => ({ flightDataId: 'fd1', callsign: 'VIPER11', state, requestedPositionId: 'AP', decidedPositionId: state === 'REQUESTED' ? null : 'CTR', reason: null, selfCoordinated: false, ...over });
const IFR = { clearance: { altitude: { entries: [{ status: 'ACTIVE', parsed: 19000 }] }, heading: { entries: [] } } };
const STRIP = { stripId: 's1', flightDataId: 'fd1', ownerPositionId: 'AP', state: 'HANDED_OFF' };

test('the grey mark: TRANSIT <name>, REQ while asked, DECLINED with the reason in the title', () => {
  const a = airspace('BRAVO');
  assert.deepEqual([rules.transitMark(a, T('APPROVED')).text, rules.transitMark(a, T('REQUESTED')).text, rules.transitMark(a, T('DECLINED')).text],
    ['TRANSIT BRAVO', 'TRANSIT BRAVO REQ', 'TRANSIT BRAVO DECLINED']);
  assert.match(rules.transitMark(a, T('DECLINED', { reason: 'users at all levels' })).title, /declined by CTR: users at all levels/);
  assert.match(rules.transitMark(a, T('REQUESTED')).title, /waiting for CTR/);
  assert.match(rules.transitMark(a, T('APPROVED', { selfCoordinated: true })).title, /self-coordinated/);
  assert.deepEqual(rules.transitsOfFlight('fd1', [a, airspace('X', {}, [T('REQUESTED')])]).map(x => x.airspace.airspaceId), ['X']);
});

test('the coordinate mark (crc-sync ADR 0136): COORD <name>, the state in the title; the id when the record is missing', () => {
  assert.deepEqual(rules.coordinateMark(airspace('BRAVO'), 'BRAVO'), { text: 'COORD BRAVO', title: 'Filed through BRAVO (ACTIVE): no transit or entry approval' });
  assert.equal(rules.coordinateMark(null, 'MOA-9').text, 'COORD MOA-9');
});

test('the Strip offers a request: held owner, IFR, ACTIVE transit type, no open transit; a held decider approves too', () => {
  const list = [
    airspace('MOA-ATC'),
    airspace('MOA-TAC', { usingFacilityId: 'TACTICAL' }),
    airspace('MOA-OPEN', {}, [T('REQUESTED')]),
    airspace('MOA-DECL', {}, [T('DECLINED')]),
    { ...airspace('MOA-COLD'), state: 'SCHEDULED' },
    airspace('P-1', { type: 'PROHIBITED' }),
    airspace('MTR', { kind: 'ROUTE', type: 'MTR' }),
  ];
  const got = rules.requestTransitChoices(STRIP, IFR, list, ['AP']);
  assert.deepEqual(got.map(c => [c.airspace.airspaceId, c.positionId, c.deciderPositionId]),
    [['MOA-ATC', 'AP', null], ['MOA-TAC', 'AP', null], ['MOA-DECL', 'AP', null]]);
  const both = rules.requestTransitChoices(STRIP, IFR, [airspace('MOA-TAC', { usingFacilityId: 'TACTICAL' })], ['AP', 'TAC_C2']);
  assert.equal(both[0].deciderPositionId, 'TAC_C2', 'one controller holds both sides');
  assert.deepEqual(rules.requestTransitChoices({ ...STRIP, stripType: 'VFR', state: 'TRACKED' }, IFR, list, ['AP']), [],
    'a VFR strip, even with an assigned altitude: nothing new (H151 MT-Q5 b; crc-sync docs/adr/0146)');
  assert.deepEqual(rules.requestTransitChoices(STRIP, IFR, list, ['LC']), [], 'not the holder');
  assert.deepEqual(rules.cancelableTransits(STRIP, list, ['AP']).map(c => c.airspace.airspaceId), ['MOA-OPEN']);
  assert.deepEqual(rules.cancelableTransits(STRIP, list, ['LC']), []);
  // crc-sync ADR 0136 (H156 MTB-Q2 b): the holder of the Strip's owner acknowledges a decline, whoever asked.
  assert.deepEqual(rules.acknowledgeableTransits(STRIP, list, ['AP']).map(c => [c.airspace.airspaceId, c.positionId]), [['MOA-DECL', 'AP']]);
  assert.deepEqual(rules.acknowledgeableTransits(STRIP, list, ['LC']), []);
  assert.deepEqual(rules.acknowledgeableTransits({ ...STRIP, state: 'DROPPED' }, list, ['AP']), []);
});

test('a card row: the decider approves or declines, the holder requests or cancels, OPS only reads', () => {
  const row = (transit, positionId = 'AP') => ({ flightDataId: 'fd1', transit, strips: [{ facilityId: 'INCIRLIK', stripId: 's1', positionId }] });
  const a = airspace('W-1', { type: 'WARNING', usingFacilityId: 'INCIRLIK' });
  assert.deepEqual(rules.transitRowOffer(row(null), a, ['CTR'], ['CTR']), { text: null, approveAs: 'CTR', declineAs: null, requestAs: null, cancelAs: null, acknowledgeAs: null, completeAs: null });
  assert.deepEqual(rules.transitRowOffer(row(T('REQUESTED')), a, ['CTR'], ['CTR']), { text: 'transit requested by AP', approveAs: 'CTR', declineAs: 'CTR', requestAs: null, cancelAs: null, acknowledgeAs: null, completeAs: null });
  assert.deepEqual(rules.transitRowOffer(row(T('APPROVED')), a, ['CTR'], ['CTR']), { text: 'transit approved', approveAs: null, declineAs: 'CTR', requestAs: null, cancelAs: null, acknowledgeAs: null, completeAs: 'CTR' });
  assert.deepEqual(rules.transitRowOffer(row(null), a, ['AP'], ['CTR']), { text: null, approveAs: null, declineAs: null, requestAs: 'AP', cancelAs: null, acknowledgeAs: null, completeAs: null });
  assert.deepEqual(rules.transitRowOffer(row(T('REQUESTED')), a, ['AP'], ['CTR']).cancelAs, 'AP');
  assert.equal(rules.transitRowOffer(row(T('DECLINED', { reason: 'no' })), a, ['AP'], ['CTR']).requestAs, 'AP', 'asks again');
  assert.equal(rules.transitRowOffer(row(T('DECLINED', { reason: 'no' })), a, ['AP'], ['CTR']).text, 'transit declined: no');
  assert.equal(rules.transitRowOffer(row(T('DECLINED')), a, ['AP'], ['CTR']).acknowledgeAs, 'AP', 'the holder acknowledges (ADR 0136)');
  assert.equal(rules.transitRowOffer(row(T('DECLINED')), a, ['CTR'], ['CTR']).acknowledgeAs, null, 'the decider holds no Strip of it');
  assert.equal(rules.transitRowOffer(row(T('REQUESTED')), a, ['AP'], ['CTR']).acknowledgeAs, null);
  assert.deepEqual(rules.transitRowOffer(row(T('REQUESTED')), a, ['OPS'], ['CTR']), { text: 'transit requested by AP', approveAs: null, declineAs: null, requestAs: null, cancelAs: null, acknowledgeAs: null, completeAs: null });
  assert.equal(rules.transitRowOffer(row(null), a, ['CTR'], ['CTR'], true).approveAs, null, 'a VFR flight');
  assert.equal(rules.transitRowOffer(row(null), airspace('P-1', { type: 'PROHIBITED' }), ['CTR'], ['CTR']).approveAs, null);
  assert.equal(rules.transitRowOffer(row(null), { ...a, state: 'RELEASED' }, ['CTR'], ['CTR']).approveAs, null);
});

test('the entry block fields: both empty is the whole airspace; one empty, reversed, unreadable or outside the limits is refused', () => {
  const d = { name: 'Bravo', altLowerFt: 10000, altUpperFt: 24000 };
  assert.deepEqual(parseEntryBlock('', '', d), { ok: true, block: null });
  assert.deepEqual(parseEntryBlock('FL200', '24000', d), { ok: true, block: { lowerFt: 20000, upperFt: 24000 } });
  assert.match(parseEntryBlock('FL200', '', d).detail, /both/);
  assert.match(parseEntryBlock('FL240', 'FL200', d).detail, /above the lower/);
  assert.match(parseEntryBlock('abc', 'FL200', d).detail, /write an altitude/);
  assert.match(parseEntryBlock('5000', 'FL200', d).detail, /starts at 10000/);
  assert.match(parseEntryBlock('FL200', 'FL300', d).detail, /tops at FL240/);
  assert.deepEqual(entryBlockTexts({ lowerFt: 20000, upperFt: 24000 }), { lower: 'FL200', upper: 'FL240' });
  assert.deepEqual(entryBlockTexts(null), { lower: '', upper: '' });
});

const strip = (stripId, flightDataId, ownerPositionId, facilityId = 'INCIRLIK') => ({
  stripId, flightDataId, rev: 3, stripType: 'DEPARTURE', state: 'HANDED_OFF', facilityId,
  bayId: 'ap-departures', rackId: 'main', orderKey: 'V', ownerPositionId,
  annotations: {}, flags: {}, coordination: null, tofiCoordination: null, airspaceEntry: null, previousLeg: null,
});

async function mount({ facilityId, signedOn, traffic, airspaces }) {
  const sent = [];
  const g = freshGraph();
  const state = await g.import('panels/efsp/efsp-state.js');
  const ws = await g.import('panels/efsp/efsp-ws.js');
  const list = await g.import('panels/efsp/airspace-entry-list.js');
  ws.setEfspSender('_sendEfsp', () => {});
  ws.sendEfspSetPositions(facilityId, signedOn);
  ws.setEfspSender('sendEfspAirspaceMutation', (...args) => { sent.push(args); return 'mid'; });
  state.applyEfspSnapshot({ strips: [strip('s-ap', 'fd1', 'AP')], flightDataList: [], positions: [], bays: [], airspaces, correlations: [], marsa: [] });
  state.applyEfspAlerts({ airspaceTraffic: traffic });
  return { list, sent };
}
const press = (btn) => { for (const fn of btn._listeners.click) fn({ stopPropagation() {} }); };
const ROW = (transit) => ({ flightDataId: 'fd1', callsign: 'VIPER11', inside: false, filed: false, approved: false, alerting: false, transit, strips: [{ facilityId: 'INCIRLIK', stripId: 's-ap', positionId: 'AP' }] });

test('the card row: CTR approves a requested transit (no baseRev), and declines with a reason typed inline', async () => {
  const moa = airspace('MOA-1', { usingFacilityId: 'INCIRLIK' }, [T('REQUESTED')]);
  const { list, sent } = await mount({ facilityId: 'CENTER', signedOn: ['CTR'], airspaces: [moa], traffic: [{ airspaceId: 'MOA-1', transitDeciders: ['CTR'], flights: [ROW({ state: 'REQUESTED', requestedPositionId: 'AP' })] }] });
  let el = list.buildAirspaceEntryList(moa);
  const [r] = el.children;
  assert.ok(r.children.some(c => c.className === 'airspace-entry-transit' && c.textContent === 'transit requested by AP'));
  press(r.children.find(c => /airspace-transit-approve-btn/.test(c.className)));
  assert.deepEqual(sent.pop(), ['CTR', 'MOA-1', null, { kind: 'ApproveTransit', flightDataId: 'fd1' }]);
  press(r.children.find(c => /airspace-transit-decline-btn/.test(c.className)));
  el = list.buildAirspaceEntryList(moa);
  const form = el.children.find(c => c.className === 'airspace-entry-decline');
  assert.ok(form, 'the inline reason form is under the row');
  const input = form.children[0];
  input.value = ' users FL180-FL240 ';
  press(form.children.find(c => /airspace-entry-decline-send/.test(c.className)));
  assert.deepEqual(sent.pop(), ['CTR', 'MOA-1', null, { kind: 'DeclineTransit', flightDataId: 'fd1', reason: 'users FL180-FL240' }]);
});

test('the card row: AP, holding the Strip, requests; OPS (a scheduling using agency) sees the state with no button', async () => {
  const moa = airspace('MOA-1', { usingFacilityId: 'INCIRLIK' });
  let m = await mount({ facilityId: 'INCIRLIK', signedOn: ['AP'], airspaces: [moa], traffic: [{ airspaceId: 'MOA-1', transitDeciders: ['CTR'], flights: [ROW(null)] }] });
  press(m.list.buildAirspaceEntryList(moa).children[0].children.find(c => /airspace-transit-request-btn/.test(c.className)));
  assert.deepEqual(m.sent.pop(), ['AP', 'MOA-1', null, { kind: 'RequestTransit', flightDataId: 'fd1' }]);
  m = await mount({ facilityId: 'INCIRLIK', signedOn: ['OPS'], airspaces: [moa], traffic: [{ airspaceId: 'MOA-1', transitDeciders: ['CTR'], flights: [ROW({ state: 'APPROVED', decidedPositionId: 'CTR' })] }] });
  const [r] = m.list.buildAirspaceEntryList(moa).children;
  assert.equal(r.children.some(c => /airspace-transit-/.test(c.className)), false);
  assert.ok(r.children.some(c => c.textContent === 'transit approved'));
});

test('the card row: AP, holding the Strip, acknowledges a decline (crc-sync ADR 0136, H156 MTB-Q2 b)', async () => {
  const declined = { state: 'DECLINED', requestedPositionId: 'AP', decidedPositionId: 'CTR', reason: 'live fire' };
  const moa = airspace('MOA-1', { usingFacilityId: 'INCIRLIK' }, [T('DECLINED', { reason: 'live fire' })]);
  const m = await mount({ facilityId: 'INCIRLIK', signedOn: ['AP'], airspaces: [moa], traffic: [{ airspaceId: 'MOA-1', transitDeciders: ['CTR'], flights: [ROW(declined)] }] });
  const [r] = m.list.buildAirspaceEntryList(moa).children;
  assert.ok(r.children.some(c => c.textContent === 'transit declined: live fire'));
  press(r.children.find(c => /airspace-transit-ack-btn/.test(c.className)));
  assert.deepEqual(m.sent.pop(), ['AP', 'MOA-1', null, { kind: 'AcknowledgeTransit', flightDataId: 'fd1' }]);
});

// ── crc-sync docs/adr/0144 (H171 SUA-Q1 b, Q2 b): Transit complete, and the decider's acknowledgement ──

test('transit complete: no Strip mark once COMPLETED; the Strip offers it to the held owner, as a held decider first', () => {
  const a = airspace('BRAVO');
  assert.equal(rules.transitMark(a, T('COMPLETED')), null);
  const list = [airspace('MOA-A', {}, [T('APPROVED')]), airspace('MOA-R', {}, [T('REQUESTED')]), airspace('MOA-C', {}, [T('COMPLETED')]),
    airspace('MOA-T', { usingFacilityId: 'TACTICAL' }, [T('APPROVED', { decidedPositionId: 'TAC_C2' })])];
  assert.deepEqual(rules.completableTransits(STRIP, list, ['AP']).map(c => [c.airspace.airspaceId, c.positionId]), [['MOA-A', 'AP'], ['MOA-T', 'AP']]);
  assert.deepEqual(rules.completableTransits(STRIP, list, ['AP', 'TAC_C2']).map(c => [c.airspace.airspaceId, c.positionId]), [['MOA-A', 'AP'], ['MOA-T', 'TAC_C2']]);
  assert.deepEqual(rules.completableTransits(STRIP, list, ['LC']), []);
  assert.deepEqual(rules.completableTransits({ ...STRIP, state: 'DROPPED' }, list, ['AP']), []);
  assert.deepEqual(rules.requestTransitChoices(STRIP, IFR, [list[2]], ['AP']).map(c => c.airspace.airspaceId), ['MOA-C'], 'a re-entry asks again');
});

test('a card row: the holder or the decider completes an approved transit; the decider acknowledges a completed one', () => {
  const row = (transit, positionId = 'AP') => ({ flightDataId: 'fd1', transit, strips: [{ facilityId: 'INCIRLIK', stripId: 's1', positionId }] });
  const a = airspace('W-1', { type: 'WARNING', usingFacilityId: 'INCIRLIK' });
  assert.equal(rules.transitRowOffer(row(T('APPROVED')), a, ['AP'], ['CTR']).completeAs, 'AP');
  assert.equal(rules.transitRowOffer(row(T('APPROVED')), a, ['AP', 'CTR'], ['CTR']).completeAs, 'CTR', 'the decider first: nothing to acknowledge');
  assert.equal(rules.transitRowOffer(row(T('APPROVED')), a, ['OPS'], ['CTR']).completeAs, null);
  assert.deepEqual(rules.transitRowOffer(row(T('COMPLETED')), a, ['CTR'], ['CTR']),
    { text: 'transit complete', approveAs: null, declineAs: null, requestAs: null, cancelAs: null, acknowledgeAs: 'CTR', completeAs: null });
  assert.deepEqual(rules.transitRowOffer(row(T('COMPLETED')), a, ['AP'], ['CTR']),
    { text: 'transit complete', approveAs: null, declineAs: null, requestAs: 'AP', cancelAs: null, acknowledgeAs: null, completeAs: null });
});

test('the card row: AP marks the transit complete; CTR acknowledges the grey transit complete', async () => {
  const moa = airspace('MOA-1', { usingFacilityId: 'INCIRLIK' }, [T('APPROVED')]);
  let m = await mount({ facilityId: 'INCIRLIK', signedOn: ['AP'], airspaces: [moa], traffic: [{ airspaceId: 'MOA-1', transitDeciders: ['CTR'], flights: [ROW({ state: 'APPROVED', decidedPositionId: 'CTR' })] }] });
  press(m.list.buildAirspaceEntryList(moa).children[0].children.find(c => /airspace-transit-complete-btn/.test(c.className)));
  assert.deepEqual(m.sent.pop(), ['AP', 'MOA-1', null, { kind: 'EndTransit', flightDataId: 'fd1' }]);
  const done = airspace('MOA-1', { usingFacilityId: 'INCIRLIK' }, [T('COMPLETED', { completedPositionId: 'AP' })]);
  m = await mount({ facilityId: 'CENTER', signedOn: ['CTR'], airspaces: [done], traffic: [{ airspaceId: 'MOA-1', transitDeciders: ['CTR'], flights: [ROW({ state: 'COMPLETED', decidedPositionId: 'CTR', completedPositionId: 'AP' })] }] });
  const [r] = m.list.buildAirspaceEntryList(done).children;
  assert.ok(r.children.some(c => c.className === 'airspace-entry-transit' && c.textContent === 'transit complete'));
  const ack = r.children.find(c => /airspace-transit-ack-btn/.test(c.className));
  assert.match(ack.title, /transit of MOA-1 is complete \(AP\), as CTR/);
  assert.equal(r.children.some(c => /airspace-transit-(approve|decline|complete)-btn/.test(c.className)), false);
  press(ack);
  assert.deepEqual(m.sent.pop(), ['CTR', 'MOA-1', null, { kind: 'AcknowledgeTransit', flightDataId: 'fd1' }]);
});
