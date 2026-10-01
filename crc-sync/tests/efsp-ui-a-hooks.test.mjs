// UI-A: the minimal server hooks the client follow-up lane needs.
import test from 'node:test';
import assert from 'node:assert/strict';
import permission from '../src/efsp/permission.js';

test('U1 OPS records ORDNANCE (3G) on a departure whoever holds it, and nothing else of the kind', () => {
  const { mayActBesideOwner } = permission;
  const dep = { role: 'DEPARTURE', ownerPositionId: 'TWR', state: 'AIRBORNE' };
  assert.equal(mayActBesideOwner('OPS', dep, { kind: 'SetBlock', blockId: '3G' }), true);
  assert.equal(mayActBesideOwner('OPS', { ...dep, state: 'DROPPED' }, { kind: 'SetBlock', blockId: '3G' }), false);
  assert.equal(mayActBesideOwner('TWR', dep, { kind: 'SetBlock', blockId: '3G' }), false, 'ownership stays the rule for everyone else');
  assert.equal(mayActBesideOwner('OPS', dep, { kind: 'SetBlock', blockId: '3F' }), false);
});

test('S-L16: a vul window cannot be left ending before it starts', async () => {
  const { FdrStore } = await import('../src/efsp/fdr-store.js');
  const store = new FdrStore();
  const created = store.createFdr({
    callsign: 'WEASEL1', flightSize: 2, aircraftType: 'F16', wakeCategory: 'D', equipmentCodes: ['G'],
    route: 'DCT', requestedAltitude: '250', departureAirport: 'LTAG', destinationAirport: 'LTAG',
    vulWindowStartUtc: Date.UTC(2026, 3, 14, 6, 0), vulWindowEndUtc: Date.UTC(2026, 3, 14, 8, 0),
  }, { by: 'TAC_C2', role: 'MISSION' });
  assert.equal(created.ok, true, JSON.stringify(created));
  const id = created.fdr.fdrId;
  const late = store.setField(id, 'mission.vulWindowStartUtc', Date.UTC(2026, 3, 14, 9, 0), { by: 'TAC_C2' });
  assert.equal(late.ok, false);
  assert.match(late.detail, /move the end first/);
  const early = store.setField(id, 'mission.vulWindowEndUtc', Date.UTC(2026, 3, 14, 5, 0), { by: 'TAC_C2' });
  assert.equal(early.ok, false);
  assert.match(early.detail, /must be after its start/);
  // the way out: end first, then start
  assert.equal(store.setField(id, 'mission.vulWindowEndUtc', Date.UTC(2026, 3, 14, 11, 0), { by: 'TAC_C2' }).ok, true);
  assert.equal(store.setField(id, 'mission.vulWindowStartUtc', Date.UTC(2026, 3, 14, 9, 0), { by: 'TAC_C2' }).ok, true);
  // clearing is always allowed
  assert.equal(store.setField(id, 'mission.vulWindowEndUtc', '', { by: 'TAC_C2' }).ok, true);
});
