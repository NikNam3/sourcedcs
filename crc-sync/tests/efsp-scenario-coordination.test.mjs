import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Cross-facility coordination sorties — the five ATC↔ATC primitives, walked
// as flights rather than as single mutations.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-coord-scn-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');

const { createEfsp } = await import('../src/efsp/index.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const { crew, hold, act, mustAct, jumpTo, advance, DEPARTURE_FDR, airborneDeparture } = await import('./helpers/efsp-scenario.mjs');

const ATC = { OPS: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER' };

function flight(efsp, c, callsign) {
  return airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign });
}

function centerStrip(efsp, id) { return efsp.boardStoreFor('CENTER').getStrip(id); }

// ── 12. point out ────────────────────────────────────────────────────────

test('SCENARIO a flight pointed out to Center: the data stays with Approach, the separation moves', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  const strip = flight(efsp, c, 'PONT1');
  const pointed = mustAct(efsp, c.APP, 'APP', strip, {
    kind: 'POINT_OUT', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
  });
  const replica = centerStrip(efsp, pointed.coordination.peerStripId);
  const accepted = mustAct(efsp, c.CTR, 'CTR', replica, { kind: 'POINT_OUT', action: 'ACCEPT' });

  // The split that makes POINT_OUT different from a HANDOFF, and the reason
  // the Strip renders two chips rather than one owner.
  assert.equal(accepted.coordination.dataOwnerPositionRef.positionId, 'APP', 'the data stays where it was');
  assert.equal(accepted.coordination.separationResponsibilityRef.positionId, 'CTR', 'the separation moved');
  assert.equal(accepted.coordination.commsTransferred, false, 'the flight stays on Approach frequency');

  // Compare a HANDOFF on another flight, where everything moves together.
  const handed = mustAct(efsp, c.APP, 'APP', flight(efsp, c, 'PONT2'), {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
  });
  const handedOver = mustAct(efsp, c.CTR, 'CTR', centerStrip(efsp, handed.coordination.peerStripId), {
    kind: 'HANDOFF', action: 'ACCEPT',
  });
  assert.equal(handedOver.coordination.dataOwnerPositionRef.positionId, 'CTR');
  assert.equal(handedOver.coordination.separationResponsibilityRef.positionId, 'CTR');
  assert.equal(handedOver.coordination.commsTransferred, true);
});

// ── 13. operational request with a stand by ──────────────────────────────

test('SCENARIO an operational request that gets a stand by before an answer', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  const asked = mustAct(efsp, c.APP, 'APP', flight(efsp, c, 'REQ1'), {
    kind: 'OPERATIONAL_REQUEST', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
    note: 'request direct',
  });
  const replica = centerStrip(efsp, asked.coordination.peerStripId);

  const standBy = mustAct(efsp, c.CTR, 'CTR', replica, { kind: 'OPERATIONAL_REQUEST', action: 'STAND_BY' });
  assert.equal(standBy.coordination.state, 'PROPOSED', 'stand by resolves nothing — the request is still open');
  assert.ok(standBy.coordination.lastStandByAt);
  // And the asking side sees it, which is the whole point of saying it.
  assert.ok(efsp.boardStore.getStrip(asked.stripId).coordination.lastStandByAt);

  const answered = mustAct(efsp, c.CTR, 'CTR', centerStrip(efsp, replica.stripId), {
    kind: 'OPERATIONAL_REQUEST', action: 'ACCEPT',
  });
  assert.equal(answered.coordination.state, 'ACTIVE');
});

// ── 14. AIT without a written directive ──────────────────────────────────

test('SCENARIO automated information transfer is refused without a directive on file', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  // Guide §4.6 rule 7: AIT is "configuration, not a default" — neither
  // shipped Facility has a directive, so it must refuse.
  assert.equal(facilityConfig.getFacilityConfig('INCIRLIK').aitAuthorized, false);
  const refused = act(efsp, c.APP, 'APP', flight(efsp, c, 'AIT1'), {
    kind: 'AIT', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
  });
  assert.equal(refused.ok, false);
  assert.match(refused.detail, /directive/i);

  // The same primitive between the same two Positions, once a directive is
  // on file, goes through — the refusal is about configuration, not about
  // AIT being unbuilt.
  const incirlik = facilityConfig.getFacilityConfig('INCIRLIK');
  facilityConfig.setFacilityConfig({ ...incirlik, aitAuthorized: true }, 'INCIRLIK');
  try {
    const authorized = createEfsp();
    const c2 = crew(authorized, ATC);
    const proposed = mustAct(authorized, c2.APP, 'APP', flight(authorized, c2, 'AIT2'), {
      kind: 'AIT', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
    });
    assert.equal(proposed.coordination.primitive, 'AIT');
  } finally {
    facilityConfig.setFacilityConfig(incirlik, 'INCIRLIK');
  }
});

// ── 15. an overflight ────────────────────────────────────────────────────

test('SCENARIO a flight transiting Center that never touches Incirlik', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  // CTR originates it directly — there is no departure to convert, because
  // the flight was never on the ground here (docs/adr/0023).
  const strip = mustAct(efsp, c.CTR, 'CTR', null, {
    kind: 'CreateStrip', bayId: 'ctr-overflight', rackId: 'main', role: 'OVERFLIGHT',
    fdr: { callsign: 'TRANS1', aircraftType: 'A320', wakeCategory: 'M', originAirport: 'LTBA', destinationAirport: 'OJAI' },
  });
  assert.equal(strip.role, 'OVERFLIGHT');
  assert.equal(strip.state, 'INBOUND');

  const beacon = efsp.fdrStore.getFdr(strip.fdrId).identity.beaconAssigned;
  assert.equal(efsp.fdrStore._codeAllocator.isAllocated(beacon), true);

  // The guide's four states (docs/adr/0087): Radar Contact, Hand Off, then the
  // terminal Drop — the path that used to skip DropStrip's rules entirely
  // before docs/adr/0027.
  const inSector = await advance(efsp, c.CTR, 'CTR', strip);
  assert.equal(inSector.state, 'IN_SECTOR');
  const handedOff = await advance(efsp, c.CTR, 'CTR', inSector);
  assert.equal(handedOff.state, 'HANDED_OFF');
  const dropped = await advance(efsp, c.CTR, 'CTR', handedOff);
  assert.equal(dropped.state, 'DROPPED');
  assert.equal(dropped.flags.removeIndicator, true);
  assert.equal(efsp.fdrStore._codeAllocator.isAllocated(beacon), false, 'and the code goes back');
});

// ── 16. pop-up arrival versus a real handoff ─────────────────────────────

test('SCENARIO an unannounced inbound, against the same flight arriving properly', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  // Pop-up: nobody handed it over, so APP originates the Strip itself.
  const popUp = mustAct(efsp, c.APP, 'APP', null, {
    kind: 'CreateStrip', bayId: 'app-inbound', rackId: 'main', role: 'ARRIVAL',
    fdr: { callsign: 'POPUP1', aircraftType: 'C130', wakeCategory: 'M', originAirport: 'LTAC' },
  });
  assert.equal(popUp.coordination, null, 'self-originated — there is no exchange behind it');
  assert.equal(popUp.state, 'INBOUND');

  // Properly: CTR has it and hands it across, which mints the Strip at APP.
  const enroute = mustAct(efsp, c.CTR, 'CTR', null, {
    kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', role: 'ARRIVAL',
    fdr: { callsign: 'PROPER1', aircraftType: 'C130', wakeCategory: 'M', originAirport: 'LTAC' },
  });
  const handed = mustAct(efsp, c.CTR, 'CTR', enroute, {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'APP',
  });
  const arrival = mustAct(efsp, c.APP, 'APP', efsp.boardStore.getStrip(handed.coordination.peerStripId), {
    kind: 'HANDOFF', action: 'ACCEPT',
  });
  assert.equal(arrival.coordination.state, 'ACTIVE', 'this one knows where it came from');
  assert.equal(arrival.fdrId, enroute.fdrId, 'one flight, one FDR, two Facility replicas');

  // Both land the same way from here.
  const down = await advance(efsp, c.APP, 'APP', arrival);
  assert.equal(down.ownerPositionId, 'TWR');
});

// ── 23. one controller holding both ends ─────────────────────────────────

test('SCENARIO a single controller working both Approach and Center hands a flight to themselves', () => {
  const efsp = createEfsp();
  const solo = { controllerId: 'c-solo', who: 'Solo' };
  const c = crew(efsp, { OPS: 'INCIRLIK' });
  hold(efsp, solo, 'INCIRLIK', ['APP']);
  hold(efsp, solo, 'CENTER', ['CTR']);
  const both = { session: solo, facilityId: 'INCIRLIK' };
  const atCenter = { session: solo, facilityId: 'CENTER' };

  const strip = flight(efsp, c, 'SOLO1');
  const proposed = mustAct(efsp, both, 'APP', strip, {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
  });
  const accepted = mustAct(efsp, atCenter, 'CTR', centerStrip(efsp, proposed.coordination.peerStripId), {
    kind: 'HANDOFF', action: 'ACCEPT',
  });

  // §4.8.3: the state change is mandatory and unconditional; only the
  // two-party dialogue collapses. Both replicas exist, jurisdiction moved.
  assert.equal(accepted.coordination.state, 'ACTIVE');
  assert.equal(accepted.coordination.dataOwnerPositionRef.positionId, 'CTR');
  assert.equal(efsp.boardStore.getStrip(proposed.stripId).coordination.state, 'ACTIVE');
});


test('a Strip cannot be created, moved or transferred into a Bay that does not exist', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  // Found by a typo in this very file: `ctr-overflights` for `ctr-overflight`
  // was accepted, and produced a Strip holding a beacon code that appeared in
  // no Rack on any Board — every read path goes through a Bay, so it was
  // invisible and unrecoverable.
  const ghost = act(efsp, c.CTR, 'CTR', null, {
    kind: 'CreateStrip', bayId: 'ctr-overflights', rackId: 'main', role: 'OVERFLIGHT',
    fdr: { callsign: 'GHOST1', originAirport: 'LTAC' },
  });
  assert.equal(ghost.ok, false);
  assert.match(ghost.detail, /no such Bay here/);

  const real = mustAct(efsp, c.CTR, 'CTR', null, {
    kind: 'CreateStrip', bayId: 'ctr-overflight', rackId: 'main', role: 'OVERFLIGHT',
    fdr: { callsign: 'GHOST2', originAirport: 'LTAC' },
  });
  assert.equal(act(efsp, c.CTR, 'CTR', real, { kind: 'MoveStrip', bayId: 'nowhere', rackId: 'main' }).ok, false);
  assert.equal(act(efsp, c.CTR, 'CTR', real, {
    kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-nowhere', rackId: 'main',
  }).ok, false);
});

test('converting a flight for its return leg archives the departure annotations rather than erasing them', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  let strip = flight(efsp, c, 'ARCH1');
  strip = mustAct(efsp, c.APP, 'APP', strip, { kind: 'SetBlock', blockId: '24', value: 'MIT 10 BEHIND VIPER2' });
  strip = mustAct(efsp, c.APP, 'APP', strip, { kind: 'SetBlock', blockId: '19', value: 'PILOT REQUESTS FL280' });
  assert.ok(Object.keys(strip.annotations).length >= 2);

  const returning = mustAct(efsp, c.APP, 'APP', strip, { kind: 'ConvertToArrival' });

  // The live set is cleared — a DEPARTURE Block means something else on an
  // ARRIVAL, so carrying the values across would mislabel them.
  assert.deepEqual(returning.annotations, {});
  // But it is kept, because erasing a controller-entered item on one click
  // with no undo is exactly what the append-only model exists to prevent.
  assert.equal(returning.previousLeg.role, 'DEPARTURE');
  assert.ok(returning.previousLeg.convertedAt);
  const archived = JSON.stringify(returning.previousLeg.annotations);
  assert.match(archived, /MIT 10 BEHIND VIPER2/);
  assert.match(archived, /PILOT REQUESTS FL280/);
});
