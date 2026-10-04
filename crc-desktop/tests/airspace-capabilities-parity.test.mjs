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

test('a session signed on to nothing has no row', () => {
  assert.deepEqual(caps.airspaceRowOf(null), airspace.rowFor(null, { familyRows: authority.AIRSPACE_ROWS, classOf: () => null }));
});

const POSITIONS = [...shipped.flatMap(c => c.positions), 'RNG1'];
const DEFS = [
  { controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP' },
  { controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP', usingPositionId: 'RNG1' },
  { controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'TACTICAL' },
  { controllingFacilityId: 'INCIRLIK', controllingPositionId: 'LC', usingFacilityId: 'TACTICAL' },
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

test('the walks of the briefing: TAC_C2 edits nothing, a signed-off session nothing, OPS its Facility\'s, a range its control frequency', () => {
  const app = { controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP', usingFacilityId: 'TACTICAL' };
  assert.equal(caps.authorityFor(['TAC_C2'], 'edit', app), null);
  assert.equal(caps.authorityFor([], 'edit', app), null);
  assert.deepEqual(caps.authorityFor(['AP'], 'edit', app), { positionId: 'AP', scope: 'ALL' });
  assert.deepEqual(caps.authorityFor(['OPS'], 'edit', app), { positionId: 'OPS', scope: 'ALL' });
  assert.deepEqual(caps.authorityFor(['LC', 'OPS'], 'delete', app), { positionId: 'OPS', scope: 'ALL' });
  const range = { controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP', usingPositionId: 'RNG1' };
  assert.deepEqual(caps.authorityFor(['RNG1'], 'edit', range), { positionId: 'RNG1', scope: 'FREQUENCY' });
  assert.equal(caps.authorityFor(['RNG1'], 'delete', range), null);
  assert.equal(caps.usingPositionFor(['TAC_C2'], app), 'TAC_C2');
  assert.equal(caps.usingPositionFor(['AP'], app), null);
});

test('who may create, and what they may name as controlling', () => {
  assert.deepEqual(caps.createPositionsFor(['TAC_C2', 'RNG1', 'GCI']), []);
  assert.deepEqual(caps.controllingChoicesFor(['AP']), [{ facilityId: 'INCIRLIK', positionId: 'AP' }]);
  assert.equal(caps.controllingChoicesFor(['OPS']).length, 8);
  assert.ok(caps.controllingChoicesFor(['OPS']).every(c => c.facilityId === 'INCIRLIK'));
});
