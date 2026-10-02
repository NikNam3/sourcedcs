/* Hung ordnance on the Strip (guide §9.5, crc-sync's docs/adr/0069).
 *
 *  1. Drift — the client's hungOrdnanceAdvisoryFor is a copy of crc-sync's
 *     (browser scripts cannot load crc-sync), so both run over one table and
 *     must agree on every row.
 *  2. ordnanceAlertsFor with and without client runway status (L1b's
 *     getEfspRunwayStatus may not be loaded; the chip shows regardless).
 *  3. The real strip-view.js rendering the chip and reason line on a Position
 *     whose grid does not carry Block 3G, and nothing on a CLEAN Strip
 *     (docs/adr/0058).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRequire } from 'node:module';
import './helpers/client-env.mjs';
import domStub from './helpers/dom-stub.js';
import { freshGraph } from './helpers/fresh-graph.mjs';
import * as client from '../app/public/js/panels/efsp/ordnance-advisory.js';
import * as efspState from '../app/public/js/panels/efsp/efsp-state.js';

const require = createRequire(import.meta.url);
const server = require('../../crc-sync/src/efsp/runway-status.js');
const { makeElement, descendants } = domStub;

// ── fixtures ─────────────────────────────────────────────────────────────

/** One Facility's record as crc-sync's runway-status-store.js getRunwayStatus puts it on the wire. */
function record({ pad = 'Hot cargo pad', activeRunway = '05', facilityId = 'INCIRLIK' } = {}) {
  return {
    facilityId, rev: 2, activeRunway, activeRunwaySource: 'WIND',
    runways: [{
      runwayId: '05/23', ends: ['05', '23'], endHeadingsTrue: { '05': 56, '23': 236 },
      rackIds: { '05': 'rwy-05', '23': 'rwy-23' }, status: 'OPEN', arrestingGear: [],
      suspension: null, closure: null, lastInspection: null, pendingRequest: null,
    }],
    runwayChange: null,
    hotCargoPad: pad === null ? { occupied: false, occupantFlightDataId: null } : { name: pad, occupied: false, occupantFlightDataId: null },
    alertPad: { name: 'Alert pad', occupied: false, occupantFlightDataId: null },
    runwayChangeInProgress: false,
  };
}

const flightDataWith = (ordnanceState, { dep = null, arr = null } = {}) => ({
  flightDataId: 'f1', rev: 1, provenance: {},
  identity: { callsign: 'VIPER1', beaconAssigned: '0001', trackDegradationFlag: 'NONE' },
  filed: { departureRunway: dep }, assigned: { landingRunway: arr }, tofi: { ifrActive: true }, airspace: {}, comms: {},
  military: { ordnanceState, hookRequired: false, alertStatus: 'NONE', mtr: {} },
});

const STATES_BY_STRIP_TYPE = {
  DEPARTURE: ['TAXI', 'RUNWAY_QUEUE', 'DROPPED'],
  ARRIVAL: ['INBOUND', 'HANDED_TO_TOWER', 'TAXI_IN', 'DROPPED'],
  OVERFLIGHT: ['ACTIVE', 'DROPPED'],
  MISSION: ['TASKED', 'ON_STATION', 'DROPPED'],
};

// ── 1. drift ─────────────────────────────────────────────────────────────

test('drift: the client copy and crc-sync\'s hungOrdnanceAdvisoryFor agree on every row', () => {
  const pick = (a) => (a === null ? null : { text: a.text, runway: a.runway, end: a.end, padName: a.padName, reason: a.reason, runwaySource: a.runwaySource, kind: a.kind });
  let rows = 0;
  let advised = 0;
  for (const ordnance of ['CLEAN', 'LOADED', 'HUNG', 'EXPENDED']) {
    for (const [stripType, states] of Object.entries(STATES_BY_STRIP_TYPE)) {
      for (const state of states) {
        for (const pad of ['Hot cargo pad', null, '  ']) {
          for (const rackId of ['main', 'rwy-05', 'rwy-23', 'nowhere']) {
            for (const runwayText of [null, '', '23', 'RWY 5', '05/23', '17', 'rw23']) {
              for (const activeRunway of ['05', '23', null]) {
                for (const fs of [record({ pad, activeRunway }), null]) {
                  const strip = { stripId: 's1', flightDataId: 'f1', facilityId: 'INCIRLIK', stripType, state, rackId };
                  const flightData = flightDataWith(ordnance, { dep: runwayText, arr: runwayText });
                  const s = server.hungOrdnanceAdvisoryFor(strip, flightData, fs);
                  const c = client.hungOrdnanceAdvisoryFor(strip, flightData, fs);
                  assert.deepEqual(pick(c), pick(s), JSON.stringify({ ordnance, stripType, state, pad, rackId, runwayText, activeRunway, fs: !!fs }));
                  rows++;
                  if (s) advised++;
                }
              }
            }
          }
        }
      }
    }
  }
  assert.ok(rows > 5000 && advised > 300, `the table exercised both branches (${rows} rows, ${advised} advised)`);
  // And the no-flight-data / no-military rows (an archived flight-data record, S-R2-13).
  for (const flightData of [null, undefined, { identity: {} }, { military: null }]) {
    const strip = { stripType: 'ARRIVAL', state: 'INBOUND', rackId: 'main' };
    assert.equal(client.hungOrdnanceAdvisoryFor(strip, flightData, record()), server.hungOrdnanceAdvisoryFor(strip, flightData, record()));
  }
});

// ── 2. ordnanceAlertsFor ─────────────────────────────────────────────────

function alertsSandbox({ flightData, runwayStatus }) {
  // The real state module holds the flight-data record and the runway-status record the advisory reads.
  efspState._resetEfspStateForTest();
  efspState.applyEfspSnapshot({
    strips: [], flightDataList: flightData ? [flightData] : [], positions: [], bays: [], boardSeq: 1,
    runwayStatuses: runwayStatus ? [runwayStatus] : [],
  });
  return client;
}

const arrivalStrip = (over = {}) => ({ stripId: 's1', flightDataId: 'f1', facilityId: 'INCIRLIK', stripType: 'ARRIVAL', state: 'HANDED_TO_TOWER', rackId: 'main', ...over });

test('ordnanceAlertsFor: one amber HUNG chip with the pad sentence when runway status is loaded', () => {
  const sb = alertsSandbox({ flightData: flightDataWith('HUNG', { arr: '05' }), runwayStatus: record() });
  const alerts = sb.ordnanceAlertsFor(arrivalStrip());
  assert.equal(alerts.length, 1);
  assert.deepEqual({ ...alerts[0] }, {
    key: 'ord', tone: 'attn', legacy: 'efsp-ord-indicator', text: 'HUNG',
    reason: 'Hung ordnance. SOURCE practice: after landing, taxi to Hot cargo pad; the runway is the controller\'s call. Runway 05/23 (05) assigned.',
  });
  assert.ok(alerts[0].text.length <= 8 && alerts[0].text === alerts[0].text.toUpperCase(), 'chip label: capitals, 8 characters at most');
});

test('ordnanceAlertsFor: the chip still shows with no client runway status at all (L1b not loaded)', () => {
  const sb = alertsSandbox({ flightData: flightDataWith('HUNG'), runwayStatus: undefined });
  assert.equal(efspState.getEfspRunwayStatus('INCIRLIK'), null, 'no client field state loaded');
  const alerts = sb.ordnanceAlertsFor(arrivalStrip());
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].text, 'HUNG');
  assert.equal(alerts[0].reason, 'Hung ordnance. The hot cargo pad is shown when runway status is available.');
});

test('ordnanceAlertsFor: a Facility with no record yet shows the generic sentence too', () => {
  const sb = alertsSandbox({ flightData: flightDataWith('HUNG'), runwayStatus: null });
  assert.equal(sb.ordnanceAlertsFor(arrivalStrip()).at(0).reason, client.ORDNANCE_NO_RUNWAY_STATUS_REASON);
});

test('ordnanceAlertsFor: nothing for CLEAN/LOADED/EXPENDED, a DROPPED Strip, an OVERFLIGHT, a MISSION line or a missing flight data', () => {
  for (const state of ['CLEAN', 'LOADED', 'EXPENDED']) {
    assert.equal(alertsSandbox({ flightData: flightDataWith(state), runwayStatus: record() }).ordnanceAlertsFor(arrivalStrip()).length, 0, state);
  }
  const hung = alertsSandbox({ flightData: flightDataWith('HUNG'), runwayStatus: record() });
  assert.equal(hung.ordnanceAlertsFor(arrivalStrip({ state: 'DROPPED' })).length, 0);
  assert.equal(hung.ordnanceAlertsFor(arrivalStrip({ stripType: 'OVERFLIGHT', state: 'ACTIVE' })).length, 0);
  assert.equal(hung.ordnanceAlertsFor(arrivalStrip({ stripType: 'MISSION', state: 'ON_STATION' })).length, 0);
  assert.equal(alertsSandbox({ flightData: null, runwayStatus: record() }).ordnanceAlertsFor(arrivalStrip()).length, 0);
});

// ── 3. the real Strip ────────────────────────────────────────────────────
//
// A loader of its own, copied from efsp-ui-reachability.test.mjs's renderStrip
// rather than shared (that harness is not this lane's to change).

async function renderStrip({ strip, flightData, signedOn, runwayStatus }) {
  globalThis.document.getElementById = () => null;
  globalThis.document.createElement = makeElement;
  globalThis.getLatestTrack = () => null; // window.getLatestTrack / getAllTracks, set by app.js's startApp()
  globalThis.getAllTracks = () => [];
  const g = freshGraph();
  const state = await g.import('panels/efsp/efsp-state.js');
  const ws = await g.import('panels/efsp/efsp-ws.js');
  const bay = await g.import('panels/efsp/bay-view.js');
  const template = await g.import('panels/efsp/strip-fields.js');
  await g.import('panels/efsp/strip-view.js');
  ws.setEfspSender('_sendEfsp', () => {});
  ws.sendEfspSetPositions('INCIRLIK', signedOn);
  ws.setEfspSender('sendEfspMutation', () => 'mid');
  bay._setRenderAllOpenEfspBaysForTest(() => {});
  state.applyEfspSnapshot({ strips: [strip], flightDataList: [flightData], positions: [], bays: [], airspaces: [], correlations: [], marsa: [],
    runwayStatuses: runwayStatus ? [runwayStatus] : [] });
  return { el: bay._buildStripEl(strip), sandbox: template };
}

const appArrival = () => ({
  stripId: 's1', cid: '001', flightDataId: 'f1', rev: 1, facilityId: 'INCIRLIK', stripType: 'ARRIVAL', state: 'INBOUND',
  ownerPositionId: 'AP', bayId: 'ap-inbound', rackId: 'main', orderKey: 'V',
  annotations: {}, flags: { offset: false, flipped: false, removeIndicator: false, highlight: null, attention: null },
  correlation: { state: 'UNCORRELATED' }, coordination: null, tofiCoordination: null, airspaceEntry: null,
});

const byClass = (el, cls) => descendants(el).filter(c => (c.className || '').split(/\s+/).includes(cls));

test('a HUNG arrival shows the HUNG chip and its reason line on every Position\'s Strip, whether or not 3G is on its grid', async () => {
  for (const positionId of ['AP', 'GC', 'LC', 'CTR']) {
    const strip = { ...appArrival(), ownerPositionId: positionId };
    const { el, sandbox } = await renderStrip({ strip, flightData: flightDataWith('HUNG', { arr: '23' }), signedOn: [positionId], runwayStatus: record() });
    const chip = descendants(el).find(c => c.dataset && c.dataset.slot === 'ord');
    assert.ok(chip, `${positionId}: no ord chip`);
    assert.equal(chip.textContent, 'HUNG');
    assert.match(chip.className, /efsp-ind-attn/);
    assert.match(chip.className, /efsp-ord-indicator/);
    const reasons = byClass(el, 'efsp-strip-reason').map(r => r.textContent);
    assert.ok(reasons.includes('Hung ordnance. SOURCE practice: after landing, taxi to Hot cargo pad; the runway is the controller\'s call. Runway 05/23 (23) assigned.'),
      `${positionId}: ${JSON.stringify(reasons)}`);
    // GC has no 3G on its grid (H55: only the Positions a pilot reports to), and still sees it.
    if (positionId === 'GC') assert.equal(sandbox.compactBlocksFor('ARRIVAL', 'GC').includes('3G'), false);
    // Chips in their slot order: ord after the conformance warnings, before trk.
    const slots = descendants(el).filter(c => c.dataset && c.dataset.slot).map(c => c.dataset.slot);
    assert.ok(slots.indexOf('ord') < (slots.indexOf('trk') === -1 ? Infinity : slots.indexOf('trk')));
  }
});

test('the chip shows with no client runway status loaded, with the generic sentence', async () => {
  const { el } = await renderStrip({ strip: appArrival(), flightData: flightDataWith('HUNG'), signedOn: ['AP'], runwayStatus: undefined });
  assert.ok(descendants(el).find(c => c.dataset && c.dataset.slot === 'ord'));
  assert.ok(byClass(el, 'efsp-strip-reason').some(r => r.textContent === client.ORDNANCE_NO_RUNWAY_STATUS_REASON));
});

test('the advisory never disables the NLA button', async () => {
  const strip = { ...appArrival(), ownerPositionId: 'LC', state: 'HANDED_TO_TOWER', bayId: 'lc-arrivals' };
  const clean = await renderStrip({ strip, flightData: flightDataWith('CLEAN', { arr: '05' }), signedOn: ['LC'], runwayStatus: record() });
  const hung = await renderStrip({ strip, flightData: flightDataWith('HUNG', { arr: '05' }), signedOn: ['LC'], runwayStatus: record() });
  const buttons = (el) => descendants(el).filter(c => c.tagName === 'button').map(b => [b.textContent, b.disabled]);
  assert.deepEqual(buttons(hung.el), buttons(clean.el));
  assert.ok(buttons(hung.el).some(([label, disabled]) => /Cleared to Land|Final|Land/i.test(label) && !disabled), JSON.stringify(buttons(hung.el)));
  assert.equal(byClass(hung.el, 'efsp-nla-inhibit-reason').length, 0);
});

test('a CLEAN arrival shows no indicator row at all (docs/adr/0058)', async () => {
  const { el } = await renderStrip({ strip: appArrival(), flightData: flightDataWith('CLEAN'), signedOn: ['AP'], runwayStatus: record() });
  assert.equal(byClass(el, 'efsp-strip-slots').length, 0);
  assert.equal(byClass(el, 'efsp-strip-reason').length, 0);
});
