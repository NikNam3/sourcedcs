// Divert, client rules (crc-sync docs/adr/0111): parity with the server's grant and states, the offers, the form, the chip.
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as D from '../app/public/js/panels/efsp/divert-rules.js';
import * as serverConfig from './helpers/server-config.mjs';

const require = createRequire(import.meta.url);
const permission = serverConfig.permission;
const divertOp = require('../../crc-sync/src/efsp/board/ops/divert.js');

test('DIVERT_POSITIONS are exactly the Positions the server grants Divert', () => {
  const holders = Object.keys(permission.PERMISSIONS).filter((id) => {
    const v = permission.PERMISSIONS[id];
    return (v.has ? v.has('Divert') : v.includes('Divert'));
  });
  assert.deepEqual([...D.DIVERT_POSITIONS].sort(), holders.sort());
  assert.equal(divertOp.kind, 'Divert');
});

test('the divertable states are the strip types the server lets divert', () => {
  const src = require('fs').readFileSync(require.resolve('../../crc-sync/src/efsp/board/ops/divert.js'), 'utf8');
  const m = /const DIVERTABLE = (\{[\s\S]*?\n\});/.exec(src);
  const server = new Function(`return ${m[1]};`)();
  assert.deepEqual(D.DIVERTABLE_STATES, server);
});

test('the form fields follow JO 7110.65 4-2-1 order: clearance limit first, then route, altitude, holding, special', () => {
  assert.deepEqual(D.DIVERT_FIELDS.map(f => f.key), ['destination', 'route', 'altitude', 'restrictions', 'holding', 'special']);
});

test('menu offers: a departure is greyed with its reason, an open proposal greys the item, a flight in hand is enabled', () => {
  const base = { ownerPositionId: 'CTR', stripType: 'OVERFLIGHT', state: 'IN_SECTOR', coordination: null, tofiCoordination: null };
  assert.deepEqual(D.divertOffer(base), { enabled: true, reason: '' });
  assert.equal(D.divertOffer({ ...base, stripType: 'DEPARTURE', state: 'HANDED_OFF' }).enabled, false);
  assert.match(D.divertOffer({ ...base, stripType: 'DEPARTURE', state: 'HANDED_OFF' }).reason, /departure does not divert/);
  assert.equal(D.divertOffer({ ...base, coordination: { state: 'INITIATED', primitive: 'HANDOFF' } }).enabled, false);
  assert.equal(D.divertOffer({ ...base, stripType: 'ARRIVAL', state: 'HANDED_TO_TOWER' }), null);
  assert.equal(D.divertOffer({ ...base, ownerPositionId: 'LC' }), null);
  assert.equal(D.divertOffer({ ...base, stripType: 'ARRIVAL', state: 'INBOUND', ownerPositionId: 'AP' }).enabled, true);
});

test('buildDivertOp needs a destination and leaves blank optional fields out', () => {
  assert.equal(D.buildDivertOp({ destination: ' ' }).ok, false);
  assert.deepEqual(D.buildDivertOp({ destination: 'ltag', route: '', altitude: '90 ' }), { ok: true, op: { kind: 'Divert', destination: 'ltag', altitude: '90' } });
});

test('the chip shows the replaced destination and the new one, with the clearance in its title', () => {
  const strip = { diverts: [{ at: 1, by: 'c', from: { destination: 'OSDI' }, to: { destination: 'LTAG', route: 'DCT', altitude: '9000', holding: 'HOLD', restrictions: '', special: '' } }] };
  const chip = D.divertChipFor(strip, () => '0100Z');
  assert.equal(chip.from, 'OSDI');
  assert.equal(chip.to, 'LTAG');
  assert.match(chip.title, /maintain: 9000/);
  assert.equal(D.divertChipFor({ diverts: [] }), null);
});
