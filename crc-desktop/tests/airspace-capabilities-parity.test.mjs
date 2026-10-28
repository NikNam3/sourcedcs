/* The client's mirror of the airspace authority rows (docs/adr/0098 §11) agrees with crc-sync's, read from
   crc-sync/src/efsp/authority/ and the shipped Facility configs (ARCH-D7). */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as caps from '../app/public/js/panels/efsp/airspace-capabilities.js';
import * as serverConfig from "./helpers/server-config.mjs";

const require = createRequire(import.meta.url);
const SYNC = path.join(import.meta.dirname, '../../crc-sync');
const authority = require('../../crc-sync/src/efsp/authority');
const facilityConfig = serverConfig.facilityConfig;
const airspace = require('../../crc-sync/src/efsp/authority/airspace.js');

const shipped = fs.readdirSync(path.join(SYNC, 'config')).filter(f => /^efsp-facility-.*\.json$/.test(f))
  .map(f => JSON.parse(fs.readFileSync(path.join(SYNC, 'config', f), 'utf8')));

test('the Facility -> Position table is the shipped Facility configs\'', () => {
  const server = Object.fromEntries(shipped.map(c => [c.facility, c.positions]));
  assert.deepEqual(caps.FACILITY_POSITIONS, server);
});

test('every Position of every shipped Facility has the row the server gives it', () => {
  for (const c of shipped) {
    for (const p of c.positions) {
      assert.deepEqual(caps.airspaceRowOf(p), serverConfig.airspaceRowOf(p), `${c.facility}/${p}`);
    }
  }
});

test('a Position no Facility lists (a RANGES Position) gets the USING_AGENCY class row, as on the server', () => {
  const server = airspace.rowFor('RNG1', { familyRows: authority.AIRSPACE_ROWS, classOf: () => 'USING_AGENCY' });
  assert.deepEqual(caps.airspaceRowOf('RNG1'), server);
  assert.equal(caps.facilityOfPosition('RNG1'), 'RANGES');
});

test('the family rows and the class row tables are the server\'s', () => {
  assert.deepEqual(caps.AIRSPACE_ROWS, authority.AIRSPACE_ROWS);
  assert.deepEqual(caps.CLASS_ROWS, airspace.CLASS_ROWS);
});

test('the carrier-state editors are the server\'s editsCarrierState Positions', () => {
  const { CARRIER_CAPABILITIES } = require('../../crc-sync/src/efsp/authority/positions/carrier.js');
  assert.deepEqual([...caps.CARRIER_STATE_EDITORS].sort(), Object.keys(CARRIER_CAPABILITIES).filter(p => CARRIER_CAPABILITIES[p].editsCarrierState).sort());
});

test('a session signed on to nothing has no row', () => {
  assert.deepEqual(caps.airspaceRowOf(null), airspace.rowFor(null, { familyRows: authority.AIRSPACE_ROWS, classOf: () => null }));
});

const POSITIONS = [...shipped.flatMap(c => c.positions), 'RNG1'];
const DEFS = [
  { controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP' },
  { controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP', usingPositionId: 'RNG1' },
  { controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'TACTICAL' },
  { controllingFacilityId: 'INCIRLIK', controllingPositionId: 'LC', usingFacilityId: 'TACTICAL' },
  { controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'INCIRLIK' }, // OPS the using agency (ADR 0119)
  // crc-sync ADR 0125: jurisdiction areas, a fixed one and a carrier circle
  { kind: 'JURISDICTION', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP', geometry: { source: 'CIRCLE', centre: { lat: 37, lon: 35 }, radiusNm: 50 } },
  { kind: 'JURISDICTION', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'LC', geometry: { source: 'POLYGON', points: [] } },
  { kind: 'JURISDICTION', controllingFacilityId: 'CARRIER', controllingPositionId: 'CV_PRIFLY', geometry: { source: 'CIRCLE', centre: { hullId: 'CVN-72' }, radiusNm: 50 } },
];

test('definitionAuthority agrees with the server for every Position, action and definition', () => {
  const facilityOf = caps.facilityOfPosition;
  const rowOf = serverConfig.airspaceRowOf;
  for (const def of DEFS) {
    for (const p of POSITIONS) {
      for (const action of ['create', 'edit', 'delete']) {
        const row = p === 'RNG1' ? airspace.rowFor('RNG1', { familyRows: authority.AIRSPACE_ROWS, classOf: () => 'USING_AGENCY' }) : rowOf(p);
        const server = airspace.definitionAuthority({ positionId: p }, action, def, { rowOf: () => row, facilityOf });
        assert.equal(caps.definitionAuthority(p, action, def), server, `${p} ${action} ${JSON.stringify(def)}`);
      }
    }
  }
});

test('isUsing and isControlling agree with the server', () => {
  const facilityOf = caps.facilityOfPosition;
  const rowOf = (p) => (p === 'RNG1' ? airspace.rowFor('RNG1', { familyRows: authority.AIRSPACE_ROWS, classOf: () => 'USING_AGENCY' }) : serverConfig.airspaceRowOf(p));
  for (const def of DEFS) {
    for (const p of POSITIONS) {
      assert.equal(caps.isUsing(def, p), airspace.isUsing(def, p, { rowOf, facilityOf }), `${p} ${JSON.stringify(def)}`);
      assert.equal(caps.isControlling(def, p), airspace.isControlling(def, p));
    }
  }
});

test('the walks of the briefing: TAC_C2 edits nothing, a signed-off session nothing, OPS nothing (crc-sync ADR 0119), a range its control frequency', () => {
  const app = { controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP', usingFacilityId: 'TACTICAL' };
  assert.equal(caps.authorityFor(['TAC_C2'], 'edit', app), null);
  assert.equal(caps.authorityFor([], 'edit', app), null);
  assert.deepEqual(caps.authorityFor(['AP'], 'edit', app), { positionId: 'AP', scope: 'ALL' });
  assert.equal(caps.authorityFor(['OPS'], 'edit', app), null);
  assert.equal(caps.authorityFor(['LC', 'OPS'], 'delete', app), null);
  const range = { controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP', usingPositionId: 'RNG1' };
  assert.deepEqual(caps.authorityFor(['RNG1'], 'edit', range), { positionId: 'RNG1', scope: 'FREQUENCY' });
  assert.equal(caps.authorityFor(['RNG1'], 'delete', range), null);
  assert.equal(caps.usingPositionFor(['TAC_C2'], app), 'TAC_C2');
  assert.equal(caps.usingPositionFor(['AP'], app), null);
});

test('who may create, and what they may name as controlling', () => {
  assert.deepEqual(caps.createPositionsFor(['TAC_C2', 'RNG1', 'GCI']), []);
  assert.deepEqual(caps.controllingChoicesFor(['AP']), [{ facilityId: 'INCIRLIK', positionId: 'AP' }]);
  assert.deepEqual(caps.createPositionsFor(['OPS']), [], 'OPS is a using agency and defines nothing (crc-sync ADR 0119)');
  assert.deepEqual(caps.controllingChoicesFor(['OPS']), []);
  assert.deepEqual(caps.controllingChoicesFor(['OPS', 'CTR']), [{ facilityId: 'CENTER', positionId: 'CTR' }]);
});

// ── T27 (LT-AIRSPACE-FIX): which held Position a create/edit/delete is sent as ──

const GAZIPASA = { airspaceId: 'MOA-GAZIPASA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR' };
const INC_RANGE = { airspaceId: 'R-1', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP' };

test('T27: OPS + CTR combined creates a CENTER MOA as CTR, whatever order the Positions were signed on in', () => {
  assert.equal(caps.createActingPositionFor(['OPS', 'CTR'], GAZIPASA), 'CTR');
  assert.equal(caps.createActingPositionFor(['CTR', 'OPS'], GAZIPASA), 'CTR');
  // and the server accepts CTR for it (the client's choice is one the rows allow)
  const deps = { rowOf: serverConfig.airspaceRowOf, facilityOf: caps.facilityOfPosition };
  assert.equal(airspace.definitionAuthority({ positionId: 'CTR' }, 'create', GAZIPASA, deps), 'ALL');
  assert.equal(airspace.definitionAuthority({ positionId: 'OPS' }, 'create', GAZIPASA, deps), null);
});

test('T27: the controlling Position first, else the first creator (the server decides); OPS creates nothing (ADR 0119)', () => {
  assert.equal(caps.createActingPositionFor(['OPS', 'AP'], INC_RANGE), 'AP', 'the controlling Position when held');
  assert.equal(caps.createActingPositionFor(['LC', 'OPS'], INC_RANGE), 'LC', 'else the first creator; the server refuses and names AP');
  assert.equal(caps.createActingPositionFor(['OPS'], GAZIPASA), null, 'OPS alone may create nothing');
  assert.equal(caps.createActingPositionFor(['TAC_C2'], GAZIPASA), null, 'no creator at all');
});

test('T27: edit and delete act as the controlling Position when held', () => {
  for (const action of ['edit', 'delete']) {
    assert.deepEqual(caps.authorityFor(['OPS', 'AP'], action, INC_RANGE), { positionId: 'AP', scope: 'ALL' }, action);
    assert.deepEqual(caps.authorityFor(['OPS', 'CTR'], action, GAZIPASA), { positionId: 'CTR', scope: 'ALL' }, action);
    assert.equal(caps.authorityFor(['LC', 'OPS'], action, INC_RANGE), null, action);
  }
});

test('crc-sync ADR 0119: OPS acts for the using side of a CENTER MOA Incirlik uses, and AP does not', () => {
  const moa = { controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'INCIRLIK' };
  assert.equal(caps.usingPositionFor(['AP', 'OPS'], moa), 'OPS');
  assert.equal(caps.usingPositionFor(['AP'], moa), null);
  assert.equal(caps.controllingPositionFor(['OPS', 'CTR'], moa), 'CTR');
});

// ── crc-sync docs/adr/0128: the transit decider (H151 MT-Q1 a) ──

test('the transit types and the MRU Positions are the server\'s', () => {
  assert.deepEqual(caps.TRANSIT_TYPES, airspace.TRANSIT_TYPES);
  const mru = shipped.flatMap(c => Object.entries(c.positionClasses || {}).filter(([, cls]) => cls === airspace.MRU_CLASS).map(([p]) => p));
  assert.deepEqual([...caps.MRU_POSITIONS].sort(), mru.sort());
});

test('transitDeciders agrees with the server for every definition', () => {
  const rowOf = serverConfig.airspaceRowOf;
  const deps = { rowOf, positionsOf: caps.positionsOf, classOf: serverConfig.classOf };
  for (const def of DEFS.filter(d => d.kind !== 'JURISDICTION')) {
    assert.deepEqual(caps.transitDeciders(def), airspace.transitDeciders(def, deps), JSON.stringify(def));
  }
  assert.deepEqual(caps.transitDeciders({ controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'TACTICAL' }), ['TAC_C2']);
  assert.deepEqual(caps.transitDeciders({ controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'INCIRLIK' }), ['CTR'], 'OPS reads only');
});
