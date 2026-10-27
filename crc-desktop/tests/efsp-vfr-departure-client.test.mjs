// crc-sync docs/adr/0143 (H166): the VFR departure at CD (one action: flight data, discrete code, a DEPARTURE Strip in
// the cleared Bay), its direction of flight (Block 9K) on the Strip face, and "Radar service terminated" on it at AP.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as serverConfig from './helpers/server-config.mjs';
import './helpers/client-env.mjs';
import { createRequire } from 'node:module';
import { applyEfspSnapshot } from '../app/public/js/panels/efsp/efsp-state.js';
import { sendEfspSetPositions } from '../app/public/js/panels/efsp/efsp-ws.js';
import { VFR_DEPARTURE_POSITIONS } from '../app/public/js/panels/efsp/bay/authority-mirror.js';
import {
  DIRECTIONS_OF_FLIGHT, buildVfrDepartureOp, createdText, sendVfrDeparture, vfrDepartureProblem, vfrDeparturePosition,
} from '../app/public/js/panels/efsp/vfr-departure.js';
import { canTerminateRadarService } from '../app/public/js/panels/efsp/flight-following.js';
import { compactBlocksFor } from '../app/public/js/panels/efsp/strip-fields.js';
import { BLOCK_MAPS, enumSelectOptionsFor } from '../app/public/js/panels/efsp/strip-template.js';

const require = createRequire(import.meta.url);
const server = serverConfig.permission;
const fds = require('../../crc-sync/src/efsp/flight-data-store.js');
const serverPermission = require('../../crc-sync/src/efsp/permission.js');

test('the client offers the VFR departure to exactly the Positions the server lets make one', () => {
  const granted = Object.keys(server.PERMISSIONS).filter(id => server.PERMISSIONS[id].has('CreateVfrDeparture')
    && serverPermission.canCreateStripType(id, 'DEPARTURE') && serverPermission.canActOnState(id, 'DEPARTURE', 'CLEARED'));
  assert.deepEqual([...VFR_DEPARTURE_POSITIONS].sort(), granted.sort());
});

test('the directions are the server\'s, and Block 9K picks from them', () => {
  assert.deepEqual(DIRECTIONS_OF_FLIGHT, [...fds.DIRECTIONS_OF_FLIGHT]);
  assert.deepEqual(BLOCK_MAPS.DEPARTURE['9K'].target, { kind: 'flightData', path: 'filed.directionOfFlight' });
  assert.equal(BLOCK_MAPS.ARRIVAL['9K'], undefined);
  const opts = enumSelectOptionsFor('9K', {});
  assert.ok(opts, 'an enum picker');
});

test('the fields: what is wrong before sending, and the op (no lookup fields, an empty runway is the active one)', () => {
  const ok = { callsign: 'viper11', aircraftData: '2/f16', direction: 'nw', runway: '' };
  assert.equal(vfrDepartureProblem(ok), null);
  assert.match(vfrDepartureProblem({ ...ok, callsign: '' }), /callsign/);
  assert.match(vfrDepartureProblem({ ...ok, aircraftData: ' ' }), /aircraft type/);
  assert.match(vfrDepartureProblem({ ...ok, direction: 'NNW' }), /direction of flight/);
  assert.match(vfrDepartureProblem({ ...ok, runway: 'grass' }), /runway/);
  assert.equal(vfrDepartureProblem({ ...ok, runway: 'RWY 23' }), null);
  assert.deepEqual(buildVfrDepartureOp(ok), { kind: 'CreateVfrDeparture', flightData: { callsign: 'VIPER11', aircraftData: '2/F16', directionOfFlight: 'NW' } });
  assert.equal(buildVfrDepartureOp({ ...ok, runway: '23' }).flightData.departureRunway, '23');
  assert.equal(createdText({ ok: true, flightData: { identity: { callsign: 'VIPER11', beaconAssigned: '4321' } } }), 'VIPER11 4321');
});

test('only at a Position that makes VFR departures', () => {
  sendEfspSetPositions('INCIRLIK', ['GC']);
  assert.equal(vfrDeparturePosition(), null);
  assert.match(sendVfrDeparture({ callsign: 'V1', aircraftData: 'F16', direction: 'N' }), /sign on/);
  sendEfspSetPositions('INCIRLIK', ['CD']);
  assert.equal(vfrDeparturePosition(), 'CD');
  assert.match(sendVfrDeparture({ callsign: 'V1', aircraftData: 'F16', direction: '' }), /direction/);
  sendEfspSetPositions('INCIRLIK', []);
});

const fd = (id, { alt = false, dir = null } = {}) => ({
  flightDataId: id, identity: { callsign: id.toUpperCase() }, filed: { directionOfFlight: dir },
  clearance: { altitude: { entries: alt ? [{ status: 'ACTIVE', parsed: 50 }] : [] }, heading: { entries: [] } },
});
const dep = (id, flightDataId, extra = {}) => ({
  stripId: id, flightDataId, stripType: 'DEPARTURE', state: 'HANDED_OFF', ownerPositionId: 'AP', facilityId: 'INCIRLIK', rev: 1, ...extra,
});

test('Radar service terminated is offered on a VFR departure AP holds, not on an IFR one', () => {
  applyEfspSnapshot({ strips: [dep('d1', 'f1'), dep('d2', 'f2')], flightDataList: [fd('f1', { dir: 'NW' }), fd('f2', { alt: true })], correlations: [] });
  sendEfspSetPositions('INCIRLIK', ['AP']);
  assert.equal(canTerminateRadarService(dep('d1', 'f1')), true);
  assert.equal(canTerminateRadarService(dep('d2', 'f2')), false, 'an assigned altitude: IFR');
  assert.equal(canTerminateRadarService(dep('d1', 'f1', { ownerPositionId: 'LC', state: 'DEPARTED' })), false, 'still LC\'s');
  sendEfspSetPositions('INCIRLIK', []);
});

test('DIR (9K) is on CD\'s, GC\'s, LC\'s and AP\'s departure face only once it is set', () => {
  for (const p of ['CD', 'GC', 'LC', 'AP']) {
    assert.ok(compactBlocksFor('DEPARTURE', p, fd('x', { dir: 'NW' })).includes('9K'), p);
    assert.ok(!compactBlocksFor('DEPARTURE', p, fd('x')).includes('9K'), `${p}: an IFR departure has none`);
  }
  assert.ok(!compactBlocksFor('DEPARTURE', 'OPS', fd('x', { dir: 'NW' })).includes('9K'));
});
