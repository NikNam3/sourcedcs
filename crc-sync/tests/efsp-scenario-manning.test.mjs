import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// Manning and failure sorties — what happens to flights already in the
// system when a controller walks away, a client drops, or the server
// restarts mid-sortie.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-manning-scn-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify([
  { airspaceId: 'MOA-RESTART', name: 'Restart MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 138.0 },
  { airspaceId: 'MOA-DROP', name: 'Drop MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 138.5 },
]));

const { createEfsp } = await import('../src/efsp/index.js');
const { crew, hold, act, mustAct, airspaceAct, mustAirspaceAct, jumpTo, DEPARTURE_FDR, airborneDeparture, handedToCenter, activate } = await import('./helpers/efsp-scenario.mjs');

const ATC = { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER' };

// ── 21. a controller walks away with strips in front of them ────────────

test('SCENARIO Ground walks away holding strips, and they route down the covering chain', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  const strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE',
    fdr: { ...DEPARTURE_FDR, callsign: 'VACA1' },
  });
  const onGround = mustAct(efsp, c.OPS, 'OPS', strip, {
    kind: 'TransferStrip', toPositionId: 'GND', bayId: 'gnd-coordination', rackId: 'main',
  });
  assert.equal(onGround.ownerPositionId, 'GND');

  // GND vacates. TWR covers it (the chain is CD→GND→TWR→APP), so the Strip
  // follows rather than being left with nobody.
  const ack = hold(efsp, c.GND.session, 'INCIRLIK', []).ack;
  assert.deepEqual(ack.warnings, [{ positionId: 'GND', count: 1, routedTo: 'TWR' }]);
  assert.equal(efsp.boardStore.getStrip(onGround.stripId).ownerPositionId, 'TWR');
});

// ── 22. nobody downstream to cover ──────────────────────────────────────

test('SCENARIO the last controller leaves and the strips are visibly stranded, not silently orphaned', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', APP: 'INCIRLIK' });

  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'STRAND1' });
  assert.equal(strip.ownerPositionId, 'APP');

  // APP has no covering Position at all (the chain ends there), so this is
  // defect D19's boundary: the warning has to be distinct from "routed", and
  // the Strip must not quietly disappear.
  const ack = hold(efsp, c.APP.session, 'INCIRLIK', []).ack;
  assert.deepEqual(ack.warnings, [{ positionId: 'APP', count: 1, routedTo: null }]);
  const stranded = efsp.boardStore.getStrip(strip.stripId);
  assert.equal(stranded.ownerPositionId, 'APP', 'still owned by an unoccupied Position — surfaced, not hidden');
  assert.equal(stranded.state, 'HANDED_OFF');
});

// ── an observer cannot quietly take over ────────────────────────────────

test('SCENARIO a second controller sits down at an occupied Position and watches until handed it', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', APP: 'INCIRLIK' });
  const relief = { controllerId: 'c-relief', who: 'Relief' };

  hold(efsp, relief, 'INCIRLIK', ['APP']);
  assert.equal(efsp.positionStore.primaryOf('APP'), 'c-APP', 'the second selector is an Observer (§4.8.2 rule 3)');

  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'RELIEF1' });
  assert.equal(act(efsp, { session: relief, facilityId: 'INCIRLIK' }, 'APP', strip, { kind: 'InvokeNla' }).reason,
    'NOT_HOLDING_POSITION', 'an Observer watches');

  // Primary released deliberately, never auto-promoted.
  assert.equal(efsp.positionStore.releasePrimaryTo('APP', 'c-relief').ok, true);
  assert.equal(efsp.positionStore.primaryOf('APP'), 'c-relief');
  assert.equal(act(efsp, { session: relief, facilityId: 'INCIRLIK' }, 'APP', strip, { kind: 'DropStrip', reason: 'now mine' }).ok, true);
});

// ── 24. a client drops mid-sortie ───────────────────────────────────────

test('SCENARIO a client disconnects mid-sortie: its Positions are released, its flights are not lost', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'DROP1' });
  efsp.onDisconnect(c.APP.session);

  assert.equal(efsp.positionStore.isOccupied('APP'), false, 'an abrupt drop releases the Position');
  assert.equal(efsp.boardStore.getStrip(strip.stripId).ownerPositionId, 'APP',
    'but the flight is still there — a disconnect is not a reason to lose a Strip');

  // Coming back is just declaring Positions again: occupancy is deliberately
  // ephemeral (ADR 0002), so nothing about it survives, and nothing needs to.
  hold(efsp, c.APP.session, 'INCIRLIK', ['APP']);
  assert.equal(act(efsp, c.APP, 'APP', efsp.boardStore.getStrip(strip.stripId), { kind: 'InvokeNla' }).ok, true);
});

test('an airspace op issued while disconnected is simply lost, unlike a Strip mutation', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  // Known and deliberate (efsp-ws.js client): Strip mutations are registered
  // pending and replayed against a fresh baseline on reconnect (§5.6.3),
  // because losing one silently is defect D6. Airspace ops are not — they
  // are cheap to reissue by hand and the replay machinery is keyed on Strip
  // identity. This test exists so that stays a decision rather than drifting
  // into a surprise.
  activate(efsp, c, 'MOA-DROP');
  efsp.onDisconnect(c.CTR.session);

  const whileGone = airspaceAct(efsp, c.CTR, 'CTR', 'MOA-DROP', { kind: 'ReleaseAirspace' });
  assert.equal(whileGone.ok, false);
  assert.equal(whileGone.reason, 'NOT_HOLDING_POSITION');
  assert.equal(efsp.airspaceStore.getAirspace('MOA-DROP').state, 'ACTIVE', 'nothing happened, and nothing replays it');

  hold(efsp, c.CTR.session, 'CENTER', ['CTR']);
  assert.equal(airspaceAct(efsp, c.CTR, 'CTR', 'MOA-DROP', { kind: 'ReleaseAirspace' }).ok, true, 'reissued by hand');
});

// ── 25. the server restarts mid-sortie ──────────────────────────────────

test('SCENARIO crc-sync restarts with a flight airborne in a hot MOA, and everything comes back', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  activate(efsp, c, 'MOA-RESTART');

  const working = mustAct(efsp, c.CTR, 'CTR', handedToCenter(efsp, c, airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'RSTRT1' })), {
    kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-RESTART', altitudeBlock: { lowerFt: 10000, upperFt: 20000 },
  });
  const beacon = efsp.fdrStore.getFdr(working.fdrId).identity.beaconAssigned;

  // A fresh createEfsp() is the closest in-process thing to a real restart:
  // new stores, restore() reads what was persisted.
  const after = createEfsp();

  const strip = after.boardStoreFor('CENTER').getStrip(working.stripId);
  assert.ok(strip, 'the Strip survived');
  assert.equal(strip.airspaceEntry.airspaceId, 'MOA-RESTART');
  assert.deepEqual(strip.airspaceEntry.altitudeBlock, { lowerFt: 10000, upperFt: 20000 },
    'including the restriction it was working under');
  assert.equal(after.fdrStore.getFdr(working.fdrId).comms.workingFrequencyMhz, 138.0);
  assert.equal(after.fdrStore._codeAllocator.isAllocated(beacon), true, 'and its code is still held');

  const airspace = after.airspaceStore.getAirspace('MOA-RESTART');
  assert.equal(airspace.state, 'ACTIVE', 'the block is still hot');
  assert.deepEqual(airspace.transitions.map(t => t.state), ['SCHEDULED', 'ACTIVE'], 'with its history intact');

  // Position occupancy deliberately does NOT survive — it is presence, not
  // Board state (§4.8.2 rule 5), so a reconnecting client re-declares it.
  assert.equal(after.positionStoreFor('CENTER').isOccupied('CTR'), false);
  const back = { controllerId: 'c-CTR', who: 'CTR' };
  hold(after, back, 'CENTER', ['CTR']);
  assert.equal(act(after, { session: back, facilityId: 'CENTER' }, 'CTR', strip, { kind: 'ClearAirspaceEntry' }).ok, true);
});
