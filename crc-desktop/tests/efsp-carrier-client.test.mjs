// The carrier's client (crc-sync's docs/adr/0074): what it formats, what it refuses to compute,
// and that its capability mirror agrees with permission.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as serverConfig from "./helpers/server-config.mjs";

import { createRequire } from 'node:module';
import './helpers/client-env.mjs';
import * as state from '../app/public/js/panels/efsp/carrier-state.js';
import * as panel from '../app/public/js/panels/efsp/carrier-panel.js';
import * as send from '../app/public/js/panels/efsp/carrier-send.js';
import { sendEfspSetPositions } from '../app/public/js/panels/efsp/efsp-ws.js';

const require = createRequire(import.meta.url);
const permission = serverConfig.permission;
const { CarrierStore } = require('../../crc-sync/src/efsp/carrier-store.js');
const hullConfig = require('../../crc-sync/src/efsp/carrier/hull-config.js');


const clock = { now: () => Date.UTC(2026, 5, 1, 9, 0), source: 'TEST' };

/** A real hull view from the real store, so the client is tested against exactly what the server sends. */
function viewWith(ops = []) {
  const store = new CarrierStore({ hulls: hullConfig.getHulls(), clock });
  store.setShipState('CVN-72', { hullId: 'CVN-72', found: true, stale: false, headingRef: 'TRUE', brcDeg: 12, finalBearingDeg: 3, speedKt: 15, magneticVariationDeg: 5, altimeterInHg: 29.92, altimeterSource: 'SET', atUtc: Date.UTC(2026, 5, 1, 9, 5), lat: 35, lon: 36 });
  store.apply({ clientMutationId: 'a', op: { kind: 'SetCarrierState', field: 'case', value: 'II' } }, 'CV_PRIFLY', 'p');
  for (const f of ['f1', 'f2']) store.apply({ clientMutationId: f, op: { kind: 'Append', flightDataId: f } }, 'CV_MARSHAL', 'm');
  for (const op of ops) store.apply({ clientMutationId: Math.random().toString(), op }, 'CV_MARSHAL', 'm');
  return store.view();
}

test('the capability mirror agrees with permission.js, Position by Position', () => {
  for (const [id, caps] of Object.entries(send.CARRIER_CAPABILITIES)) {
    assert.equal(caps.editsCarrierState, permission.canEditCarrierState(id), `${id} editsCarrierState`);
    assert.equal(caps.sequencesStack, permission.canSequenceMarshalStack(id), `${id} sequencesStack`);
    assert.deepEqual(Object.keys(caps).sort(), Object.keys(permission.CARRIER_CAPABILITIES[id]).sort(), `${id}: the same capabilities`);
  }
  assert.deepEqual(Object.keys(send.CARRIER_CAPABILITIES).sort(), Object.keys(permission.CARRIER_CAPABILITIES).sort());
  assert.equal(send.carrierActingFor('editsCarrierState', ['CV_APP1', 'CV_APP2']), null);
  assert.equal(send.carrierActingFor('editsCarrierState', ['CV_APP1', 'CV_PRIFLY']), 'CV_PRIFLY');
  assert.equal(send.carrierActingFor('editsCarrierState', ['CV_MARSHAL', 'CV_PRIFLY']), 'CV_MARSHAL', 'either edits; the first signed-on one acts');
});

test('the derived fields are formatted from what the server sent, never computed here', () => {
  state._resetEfspCarrierStateForTest();
  state.applyEfspCarrierSnapshot({ carriers: [viewWith()] });
  assert.equal(state.carrierCaseValue(), 'II');
  assert.equal(state.carrierDerivedText('angels', 'f1'), '6');
  assert.equal(state.carrierDerivedText('marshalDme', 'f2'), '22');
  assert.equal(state.carrierDerivedText('case', 'f1'), 'II');
  assert.match(state.carrierDerivedText('expectedFinalBearing', 'f1'), /^\d{3}M$/, 'a magnetic bearing, three digits');
  assert.equal(state.carrierDerivedText('eatPush', 'f1'), '', 'no Charlie time yet, so no push time');
});

test('Case I has no DME, no push time and no radial: placeholders, and an unassigned altitude says so', () => {
  const store = new CarrierStore({ hulls: hullConfig.getHulls(), clock });
  store.apply({ clientMutationId: 'a', op: { kind: 'SetCarrierState', field: 'case', value: 'I' } }, 'CV_PRIFLY', 'p');
  store.apply({ clientMutationId: 'b', op: { kind: 'Append', flightDataId: 'f1' } }, 'CV_MARSHAL', 'm');
  state._resetEfspCarrierStateForTest();
  state.applyEfspCarrierDelta({ carriers: { updated: [store.view()] } });
  assert.equal(state.carrierDerivedText('angels', 'f1'), 'assign');
  assert.equal(state.carrierDerivedText('marshalDme', 'f1'), '≤5 NM');
  assert.equal(state.carrierDerivedText('marshalRadial', 'f1'), 'overhead');
  assert.equal(state.carrierDerivedText('eatPush', 'f1'), '');
});

test('the banner says what is wrong rather than showing a stale number as live', () => {
  const v = viewWith();
  assert.equal(state.carrierBannerParts(v).problem, null);
  assert.match(state.carrierBannerParts(v).text, /BRC 007M/);
  assert.match(state.carrierBannerParts(v).text, /FINAL 358M/);
  assert.match(state.carrierBannerParts(v).text, /0905Z/);
  const stale = { ...v, shipState: { ...v.shipState, stale: true } };
  assert.match(state.carrierBannerParts(stale).problem, /track lost/);
  const noDeck = { ...v, shipState: { ...v.shipState, finalBearingUnavailable: 'angled deck not configured for CV_59' } };
  assert.match(state.carrierBannerParts(noDeck).problem, /angled deck not configured/);
  assert.equal(state.carrierBannerParts({ hullId: 'CVN-72', shipState: { found: false, hullProblem: 'hull ambiguous — configure unitName' } }).text, 'hull ambiguous — configure unitName');
  assert.equal(state.carrierBannerParts(null).text, 'hull not found');
  // an unknown variation labels the bearing T, never magnetic
  const noVar = { ...v, state: { ...v.state, brc: { ...v.state.brc, display: { value: 12, ref: 'T' } } } };
  assert.match(state.carrierBannerParts(noVar).text, /BRC 012T/);
});

test('the final-bearing line: from the ship along the reciprocal of the final bearing, only for a tracked ship on a TRUE bearing', () => {
  state._resetEfspCarrierStateForTest();
  sendEfspSetPositions('CARRIER', ['CV_APP1']);
  const v = viewWith();
  state.applyEfspCarrierSnapshot({ carriers: [v] });
  const line = panel.buildCarrierFinalLine();
  assert.equal(line.features[0].properties.kind, 'carrier-final');
  assert.deepEqual(line.features[0].geometry.coordinates[0], [36, 35], 'starts at the ship');
  const [lon, lat] = line.features[0].geometry.coordinates[1];
  assert.ok(lat < 35 && Math.abs(lon - 36) < 0.1, 'final bearing 003 true: the line runs south of the ship (reciprocal 183)');
  assert.equal(line.features.filter(f => f.properties.kind === 'carrier-final-tick').length, 2);
  for (const bad of [{ stale: true }, { found: false }]) {
    state.applyEfspCarrierSnapshot({ carriers: [{ ...v, shipState: { ...v.shipState, ...bad } }] });
    assert.equal(panel.buildCarrierFinalLine().features.length, 0, JSON.stringify(bad));
  }
  for (const bad of [{ ref: 'GRID' }, { value: null }]) {
    state.applyEfspCarrierSnapshot({ carriers: [{ ...v, state: { ...v.state, finalBearing: { ...v.state.finalBearing, ...bad } } }] });
    assert.equal(panel.buildCarrierFinalLine().features.length, 0, JSON.stringify(bad));
  }
  sendEfspSetPositions('CARRIER', []);
  state.applyEfspCarrierSnapshot({ carriers: [v] });
  assert.equal(panel.buildCarrierFinalLine().features.length, 0, 'a controller with no carrier Position gets no line');
});
