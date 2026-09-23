import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// End-to-end sortie walks — creation through DROPPED, across Facility
// boundaries, for the two flights the system is actually meant to run:
// a civil IFR round trip (Incirlik -> CTR -> back) and a military one
// (Incirlik -> CTR -> tactical control -> back).
//
// Every other EFSP test exercises one mutation or one primitive in
// isolation. That left a whole class of defect invisible: the guards a Strip
// meets depend on which op RUNS them, and no test ever walked one Strip
// through the sequence a real flight takes. Four separate bugs lived in that
// gap (the terminal-Drop path skipping DropStrip's own rules entirely, the
// beacon code released out from under a live shared-FDR flight,
// ConvertToArrival discarding an open link, and an unbound actingPositionId).
//
// Driven through createEfsp() + handleMessage — the real composition root and
// the real wire path, not a hand-built rules object — so a rule that exists
// but was never wired in index.js fails here rather than silently passing.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-scenario-test-'));
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH = path.join(tmpDir, 'incirlik.json');
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER = path.join(tmpDir, 'center.json');
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL = path.join(tmpDir, 'tactical.json');
process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH = path.join(tmpDir, 'board.json');
process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH = path.join(tmpDir, 'mutations.jsonl');

// Two airspaces covering both shapes the squadron flies: a MOA owned by the
// Center that owns the airspace it sits in, with no control of its own, and
// an air-to-ground range with its own control tower and frequency. Written
// before the imports below, because facility-config derives the RANGES
// Facility's Position set from this at require time.
process.env.CRCSYNC_EFSP_AIRSPACES_PATH = path.join(tmpDir, 'airspaces.json');
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify([
  {
    airspaceId: 'MOA-EAST', name: 'East MOA', type: 'MOA',
    controllingFacilityId: 'CENTER', controllingPositionId: 'CTR',
    workingFrequencyMhz: 134.25,
  },
  {
    airspaceId: 'RANGE-SOUTH', name: 'South A/G Range', type: 'RANGE',
    controllingFacilityId: 'INCIRLIK', controllingPositionId: 'APP',
    usingPositionId: 'SOUTH_RANGE', controlFrequencyMhz: 283.5,
  },
  // Airspace STATE is durable (ADR 0002) and every test in this file shares
  // one snapshot path, so a test that needs a specific starting state gets
  // its own airspace rather than depending on what ran before it.
  {
    airspaceId: 'RANGE-WEST', name: 'West Range', type: 'RANGE',
    controllingFacilityId: 'INCIRLIK', controllingPositionId: 'APP',
    usingPositionId: 'WEST_RANGE', controlFrequencyMhz: 291.0,
  },
  {
    airspaceId: 'MOA-NORTH', name: 'North MOA', type: 'MOA',
    controllingFacilityId: 'CENTER', controllingPositionId: 'CTR',
    workingFrequencyMhz: 139.5,
  },
]));

const { createEfsp } = await import('../src/efsp/index.js');
const facilityConfig = await import('../src/efsp/facility-config.js');

// ── harness ───────────────────────────────────────────────────────────────

/** One controller per Position, each declaring what it holds the way a real client does. */
function crew(efsp, spec) {
  const sessions = {};
  for (const [positionId, facilityId] of Object.entries(spec)) {
    const session = { controllerId: `c-${positionId}`, who: positionId };
    efsp.handleMessage(session, { type: 'efsp-set-positions', facilityId, held: [positionId] });
    sessions[positionId] = { session, facilityId };
  }
  return sessions;
}

function act(efsp, crewMember, positionId, strip, op) {
  const result = efsp.handleMessage(crewMember.session, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: crewMember.facilityId, actingPositionId: positionId,
    stripId: strip ? strip.stripId : undefined, baseRev: strip ? strip.rev : undefined,
    op,
  });
  return result.ack;
}

function mustAct(efsp, crewMember, positionId, strip, op) {
  const ack = act(efsp, crewMember, positionId, strip, op);
  assert.equal(ack.ok, true, `${op.kind} as ${positionId}: ${JSON.stringify(ack)}`);
  return ack.strip;
}

/** SetState rather than InvokeNla where a test needs to jump — InvokeNla has a 400ms double-tap guard that back-to-back real-clock calls would trip. */
function jumpTo(efsp, crewMember, positionId, strip, toState) {
  return mustAct(efsp, crewMember, positionId, strip, { kind: 'SetState', toState });
}

const NLA_DOUBLE_TAP_MS = 400; // board-store.js's _applyInvokeNla guard

/**
 * Press the NLA button, honouring the double-tap guard. A real controller is
 * never pressing it twice inside 400ms; a test walking a whole chain is, and
 * the second press would be silently swallowed as an idempotent no-op. Used
 * for the transfer-shaped steps (the Position boundaries, which are the point
 * of these walks); same-Position intermediate advances use jumpTo instead, to
 * keep the wall-clock cost of the wait down.
 */
async function advance(efsp, crewMember, positionId, strip) {
  await new Promise(resolve => setTimeout(resolve, NLA_DOUBLE_TAP_MS + 10));
  return mustAct(efsp, crewMember, positionId, strip, { kind: 'InvokeNla' });
}

const DEPARTURE_FDR = {
  callsign: 'VIPER1', aircraftType: 'F16', wakeCategory: 'D',
  departureAirport: 'LTAG', destinationAirport: 'LTAG', route: 'DCT MOA DCT', requestedAltitude: '250',
};

// ── Scenario 1: civil round trip ─────────────────────────────────────────

test('SCENARIO civil round trip: Incirlik IFR departure -> CTR -> airspace handed to the using agency and back -> return leg -> landed and dropped', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER' });

  // OPS originates, then the Strip walks the intrafacility chain.
  let strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: DEPARTURE_FDR,
  });
  const fdrId = strip.fdrId;
  const beacon = efsp.fdrStore.getFdr(fdrId).identity.beaconAssigned;
  assert.ok(beacon, 'a beacon code is minted at creation');

  strip = await advance(efsp, c.OPS, 'OPS', strip);  // PROPOSED -> PENDING_CLEARANCE, transfers to CD
  assert.equal(strip.ownerPositionId, 'CD');
  strip = jumpTo(efsp, c.CD, 'CD', strip, 'CLEARED');
  strip = await advance(efsp, c.CD, 'CD', strip);    // -> PUSHBACK, transfers to GND
  assert.equal(strip.ownerPositionId, 'GND');
  strip = jumpTo(efsp, c.GND, 'GND', strip, 'TAXI');
  strip = await advance(efsp, c.GND, 'GND', strip);  // -> RUNWAY_QUEUE, transfers to TWR
  assert.equal(strip.ownerPositionId, 'TWR');
  strip = jumpTo(efsp, c.TWR, 'TWR', strip, 'DEPARTED');
  strip = await advance(efsp, c.TWR, 'TWR', strip);  // -> HANDED_OFF, transfers to APP
  assert.equal(strip.ownerPositionId, 'APP');
  assert.equal(strip.state, 'HANDED_OFF');

  // APP hands the flight across the Facility boundary to CTR. The D13
  // mechanism mints a SECOND Strip at CENTER sharing this one's FDR.
  const appStrip = mustAct(efsp, c.APP, 'APP', strip, {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
  });
  const ctrStripId = appStrip.coordination.peerStripId;
  let ctrStrip = efsp.boardStoreFor('CENTER').getStrip(ctrStripId);
  assert.equal(ctrStrip.fdrId, fdrId, 'one logical FDR, two per-Facility Strips');
  ctrStrip = mustAct(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'HANDOFF', action: 'ACCEPT' });
  assert.equal(ctrStrip.coordination.state, 'ACTIVE');

  // The MOA leg. There is no RANGE Facility or airspace board in this slice
  // (see docs/adr/0027) — the only artifact is the FDR's airspace direction,
  // which must survive a full there-and-back round trip AND keep the record
  // of both transitions, not just the most recent one.
  mustAct(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'SetBlock', blockId: '24A', value: 'USING_AGENCY' });
  ctrStrip = efsp.boardStoreFor('CENTER').getStrip(ctrStripId);
  assert.equal(efsp.fdrStore.getFdr(fdrId).airspace.owner, 'USING_AGENCY');
  mustAct(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'SetBlock', blockId: '24A', value: 'CONTROLLING_AGENCY' });
  ctrStrip = efsp.boardStoreFor('CENTER').getStrip(ctrStripId);

  const airspace = efsp.fdrStore.getFdr(fdrId).airspace;
  assert.equal(airspace.owner, 'CONTROLLING_AGENCY', 'the airspace came back');
  assert.deepEqual(airspace.transitions.map(t => t.owner), ['USING_AGENCY', 'CONTROLLING_AGENCY'],
    'both transitions are on the record — a flat overwrite would show only the second');

  // Return leg: the same Strip/FDR converts in place at CTR (docs/adr/0023),
  // then is handed back to APP as an ARRIVAL.
  ctrStrip = mustAct(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'ConvertToArrival' });
  assert.equal(ctrStrip.role, 'ARRIVAL');
  assert.equal(ctrStrip.state, 'INBOUND');
  assert.equal(ctrStrip.fdrId, fdrId, 'same FDR, same beacon, all the way out and back');

  const handedBack = mustAct(efsp, c.CTR, 'CTR', ctrStrip, {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'APP',
  });
  let arrival = efsp.boardStore.getStrip(handedBack.coordination.peerStripId);
  arrival = mustAct(efsp, c.APP, 'APP', arrival, { kind: 'HANDOFF', action: 'ACCEPT' });

  // Down the arrival chain and off the board.
  arrival = await advance(efsp, c.APP, 'APP', arrival); // -> HANDED_TO_TOWER, transfers to TWR
  assert.equal(arrival.ownerPositionId, 'TWR');
  arrival = jumpTo(efsp, c.TWR, 'TWR', arrival, 'LANDED');
  arrival = await advance(efsp, c.TWR, 'TWR', arrival); // -> TAXI_IN, transfers to GND
  assert.equal(arrival.ownerPositionId, 'GND');
  arrival = await advance(efsp, c.GND, 'GND', arrival); // TAXI_IN's terminal NLA: Drop
  assert.equal(arrival.state, 'DROPPED');
  assert.equal(arrival.flags.removeIndicator, true,
    'the Drop BUTTON must set the remove indicator, exactly as the .drop command does');
});

test('the terminal Drop button releases the beacon code, not just the state — the FDR goes back in the pool', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', APP: 'INCIRLIK' });

  const strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: DEPARTURE_FDR,
  });
  const code = efsp.fdrStore.getFdr(strip.fdrId).identity.beaconAssigned;
  assert.equal(efsp.fdrStore._codeAllocator.isAllocated(code), true);

  // app-departures implies HANDED_OFF, so the Strip has to already be there
  // before it can land in that Bay (_validateBayImpliedTransition).
  const airborne = jumpTo(efsp, c.OPS, 'OPS', strip, 'HANDED_OFF');
  const relocated = mustAct(efsp, c.OPS, 'OPS', airborne, {
    kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-departures', rackId: 'main',
  });
  const dropped = mustAct(efsp, c.APP, 'APP', relocated, { kind: 'InvokeNla' }); // HANDED_OFF's terminal NLA
  assert.equal(dropped.state, 'DROPPED');
  assert.equal(efsp.fdrStore._codeAllocator.isAllocated(code), false,
    'the code is back in the pool — the NLA Drop path used to skip releaseFdr entirely');
});

test('Undo of a terminal Drop puts back the remove indicator and re-claims the beacon code', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', APP: 'INCIRLIK' });

  const strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: DEPARTURE_FDR,
  });
  const code = efsp.fdrStore.getFdr(strip.fdrId).identity.beaconAssigned;
  // app-departures implies HANDED_OFF, so the Strip has to already be there
  // before it can land in that Bay (_validateBayImpliedTransition).
  const airborne = jumpTo(efsp, c.OPS, 'OPS', strip, 'HANDED_OFF');
  const relocated = mustAct(efsp, c.OPS, 'OPS', airborne, {
    kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-departures', rackId: 'main',
  });
  const dropped = mustAct(efsp, c.APP, 'APP', relocated, { kind: 'InvokeNla' });
  assert.equal(efsp.fdrStore._codeAllocator.isAllocated(code), false);

  const undone = mustAct(efsp, c.APP, 'APP', dropped, { kind: 'Undo' });
  assert.equal(undone.state, 'HANDED_OFF');
  assert.equal(undone.flags.removeIndicator, false);
  assert.equal(efsp.fdrStore._codeAllocator.isAllocated(code), true, 'the code is re-claimed, not orphaned');
});

// ── Scenario 2: military round trip ──────────────────────────────────────

test('SCENARIO military round trip: Incirlik IFR departure -> CTR -> tactical control under TAC_C2 -> goes VFR -> TOFI exit -> return', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, {
    OPS: 'INCIRLIK', APP: 'INCIRLIK', TWR: 'INCIRLIK', GND: 'INCIRLIK', CTR: 'CENTER', TAC_C2: 'TACTICAL',
  });

  // Out of Incirlik and across to CTR (the civil leg, compressed — scenario
  // 1 above is what covers the chain itself step by step).
  let strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: DEPARTURE_FDR,
  });
  const fdrId = strip.fdrId;
  const beacon = efsp.fdrStore.getFdr(fdrId).identity.beaconAssigned;

  strip = jumpTo(efsp, c.OPS, 'OPS', strip, 'HANDED_OFF');
  strip = mustAct(efsp, c.OPS, 'OPS', strip, {
    kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-departures', rackId: 'main',
  });
  const appStrip = mustAct(efsp, c.APP, 'APP', strip, {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
  });
  let ctrStrip = efsp.boardStoreFor('CENTER').getStrip(appStrip.coordination.peerStripId);
  ctrStrip = mustAct(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'HANDOFF', action: 'ACCEPT' });

  // TOFI ENTRY. A MISSION Strip is minted on TACTICAL's Board, sharing this
  // flight's FDR (guide §9.8) — the first primitive to bind two different
  // Roles to one FDR.
  ctrStrip = mustAct(efsp, c.CTR, 'CTR', ctrStrip, {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2',
  });
  const missionStripId = ctrStrip.tofiCoordination.peerStripId;
  let mission = efsp.boardStoreFor('TACTICAL').getStrip(missionStripId);
  assert.equal(mission.role, 'MISSION');
  assert.equal(mission.fdrId, fdrId, 'the MISSION Strip shares the ATC-side FDR');

  mission = mustAct(efsp, c.TAC_C2, 'TAC_C2', mission, { kind: 'TOFI', action: 'ACCEPT', separationRegime: 'MARSA' });
  assert.equal(mission.tofiCoordination.state, 'ACTIVE');
  ctrStrip = efsp.boardStoreFor('CENTER').getStrip(ctrStrip.stripId);
  assert.equal(ctrStrip.tofiCoordination.state, 'ACTIVE', 'both sides see the exchange as live');
  assert.equal(ctrStrip.state, 'HANDED_OFF', 'jurisdiction never transfers — the ATC-side Strip is untouched');

  // Neither side may drop a Strip out from under live tactical control, and
  // that has to hold for the Drop BUTTON (InvokeNla), not only the .drop
  // command — this is the guard the scenario trace found was bypassable.
  // MISSION's terminal Drop sits at the end of its own lifecycle (RTB), and
  // that lifecycle deliberately runs independently of the exchange state
  // (docs/adr/0026) — so walk it to the end, which is where the bypass was.
  const atRtb = jumpTo(efsp, c.TAC_C2, 'TAC_C2', mission, 'RTB');
  const mruDrop = act(efsp, c.TAC_C2, 'TAC_C2', atRtb, { kind: 'InvokeNla' });
  assert.equal(mruDrop.ok, false, 'MISSION-side Drop button is refused during an ACTIVE exchange');
  assert.match(mruDrop.detail, /active tactical control/);
  mission = jumpTo(efsp, c.TAC_C2, 'TAC_C2', atRtb, 'ON_STATION'); // back to the mission
  const atcDrop = act(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'InvokeNla' });
  assert.equal(atcDrop.ok, false, 'ATC-side Drop button is refused too');

  // Nor may the ATC side convert the flight for its return leg mid-exchange
  // — that would null the link with no notification to the MRU controller.
  const earlyConvert = act(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'ConvertToArrival' });
  assert.equal(earlyConvert.ok, false, JSON.stringify(earlyConvert));
  assert.match(earlyConvert.detail, /active tactical control/);

  // The flight goes VFR mid-mission. ifr_active is part of the §4.6.3
  // separation model and is settable on the ATC-side Strip only.
  mustAct(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'SetBlock', blockId: 'IFR', value: false });
  ctrStrip = efsp.boardStoreFor('CENTER').getStrip(ctrStrip.stripId);
  assert.equal(efsp.fdrStore.getFdr(fdrId).tofi.ifrActive, false);

  mission = mustAct(efsp, c.TAC_C2, 'TAC_C2', mission, { kind: 'TOFI', action: 'TRANSFER_COMMS' });
  assert.equal(mission.tofiCoordination.commsTransferred, true);

  // EXIT. Rule 3 makes this the safety-critical direction: ACCEPT is refused
  // until the ATC controller has explicitly re-established ATC separation.
  ctrStrip = mustAct(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' });
  assert.equal(ctrStrip.tofiCoordination.peerStripId, missionStripId, 'EXIT re-enters the same link, minting nothing');
  mission = efsp.boardStoreFor('TACTICAL').getStrip(missionStripId);

  const tooEarly = act(efsp, c.TAC_C2, 'TAC_C2', mission, { kind: 'TOFI', action: 'ACCEPT' });
  assert.equal(tooEarly.ok, false, JSON.stringify(tooEarly));
  assert.match(tooEarly.detail, /separation_regime must be set back to ATC/);

  mustAct(efsp, c.CTR, 'CTR', efsp.boardStoreFor('CENTER').getStrip(ctrStrip.stripId), {
    kind: 'SetBlock', blockId: 'SREG', value: 'ATC',
  });
  mission = mustAct(efsp, c.TAC_C2, 'TAC_C2', mission, { kind: 'TOFI', action: 'ACCEPT' });
  assert.equal(mission.tofiCoordination.state, 'COMPLETE');

  // The MRU retires its MISSION Strip while the flight is still airborne and
  // still squawking the shared code. The code must NOT go back in the pool.
  const retired = mustAct(efsp, c.TAC_C2, 'TAC_C2', mission, { kind: 'DropStrip', reason: 'mission complete' });
  assert.equal(retired.state, 'DROPPED');
  assert.equal(efsp.fdrStore._codeAllocator.isAllocated(beacon), true,
    'the ATC-side Strip is still live on this FDR — releasing here would hand a squawking aircraft\'s code to the next departure');

  // Return leg, now that the exchange is resolved.
  ctrStrip = mustAct(efsp, c.CTR, 'CTR', efsp.boardStoreFor('CENTER').getStrip(ctrStrip.stripId), { kind: 'ConvertToArrival' });
  assert.equal(ctrStrip.role, 'ARRIVAL');

  const handedBack = mustAct(efsp, c.CTR, 'CTR', ctrStrip, {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'APP',
  });
  let arrival = efsp.boardStore.getStrip(handedBack.coordination.peerStripId);
  arrival = mustAct(efsp, c.APP, 'APP', arrival, { kind: 'HANDOFF', action: 'ACCEPT' });
  arrival = await advance(efsp, c.APP, 'APP', arrival);
  arrival = jumpTo(efsp, c.TWR, 'TWR', arrival, 'LANDED');
  arrival = await advance(efsp, c.TWR, 'TWR', arrival);
  arrival = await advance(efsp, c.GND, 'GND', arrival);
  assert.equal(arrival.state, 'DROPPED');

  // Still held. One sortie leaves several Strips on one FDR — each Facility
  // keeps its own and retires it on its own schedule (guide §4.6) — and the
  // code belongs to the flight, not to any one of them. Here both the
  // sender-side departure Strip APP kept at handoff and CTR's own Strip are
  // still live. Nothing forces their resolution, which is why the client
  // grew a shared-FDR indicator for exactly this.
  assert.equal(efsp.fdrStore._codeAllocator.isAllocated(beacon), true);

  const staleDeparture = efsp.boardStore.getStrip(appStrip.stripId);
  assert.equal(staleDeparture.state, 'HANDED_OFF', 'the sender-side Strip is still sitting there');
  mustAct(efsp, c.APP, 'APP', staleDeparture, { kind: 'DropStrip', reason: 'stale after handoff' });
  assert.equal(efsp.fdrStore._codeAllocator.isAllocated(beacon), true, 'CTR still has one');

  mustAct(efsp, c.CTR, 'CTR', efsp.boardStoreFor('CENTER').getStrip(ctrStrip.stripId), { kind: 'DropStrip', reason: 'handed back' });

  // Only now, with the last Strip on this FDR gone, does the code come back.
  assert.equal(efsp.fdrStore._codeAllocator.isAllocated(beacon), false);
});

test('a TOFI EXIT that completes while the airspace is still booked to the using agency warns, but is not blocked', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER', TAC_C2: 'TACTICAL' });

  let strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: DEPARTURE_FDR,
  });
  strip = jumpTo(efsp, c.OPS, 'OPS', strip, 'HANDED_OFF');
  strip = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-departures', rackId: 'main' });
  const appStrip = mustAct(efsp, c.APP, 'APP', strip, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
  let ctrStrip = mustAct(efsp, c.CTR, 'CTR', efsp.boardStoreFor('CENTER').getStrip(appStrip.coordination.peerStripId), { kind: 'HANDOFF', action: 'ACCEPT' });

  ctrStrip = mustAct(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'SetBlock', blockId: '24A', value: 'USING_AGENCY' });
  ctrStrip = mustAct(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2' });
  let mission = efsp.boardStoreFor('TACTICAL').getStrip(ctrStrip.tofiCoordination.peerStripId);
  mission = mustAct(efsp, c.TAC_C2, 'TAC_C2', mission, { kind: 'TOFI', action: 'ACCEPT', separationRegime: 'MARSA' });

  ctrStrip = mustAct(efsp, c.CTR, 'CTR', efsp.boardStoreFor('CENTER').getStrip(ctrStrip.stripId), { kind: 'SetBlock', blockId: 'SREG', value: 'ATC' });
  ctrStrip = mustAct(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' });

  const ack = act(efsp, c.TAC_C2, 'TAC_C2', efsp.boardStoreFor('TACTICAL').getStrip(mission.stripId), { kind: 'TOFI', action: 'ACCEPT' });
  assert.equal(ack.ok, true, 'a soft interlock — airspace release and control handback are separable');
  assert.equal(ack.warning, 'AIRSPACE_STILL_WITH_USING_AGENCY');
});

// ── Cross-cutting guards the scenarios depend on ─────────────────────────

test('a controller cannot act as a Position it is not Primary at, however the mutation names itself', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', APP: 'INCIRLIK' });

  const strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: DEPARTURE_FDR,
  });
  // app-departures implies HANDED_OFF, so the Strip has to already be there
  // before it can land in that Bay (_validateBayImpliedTransition).
  const airborne = jumpTo(efsp, c.OPS, 'OPS', strip, 'HANDED_OFF');
  const relocated = mustAct(efsp, c.OPS, 'OPS', airborne, {
    kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-departures', rackId: 'main',
  });

  // The OPS controller names APP — the Position that genuinely owns the
  // Strip — but has not selected it. Ownership alone used to be enough.
  const ack = act(efsp, c.OPS, 'APP', relocated, { kind: 'InvokeNla' });
  assert.equal(ack.ok, false);
  assert.equal(ack.reason, 'NOT_HOLDING_POSITION');

  // The controller who actually holds APP can.
  assert.equal(act(efsp, c.APP, 'APP', relocated, { kind: 'InvokeNla' }).ok, true);
});

test('an Observer at a Position may not mutate its Strips — Primary is what acts', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK' });
  const observer = { controllerId: 'c-observer', who: 'Observer' };
  efsp.handleMessage(observer, { type: 'efsp-set-positions', facilityId: 'INCIRLIK', held: ['OPS'] });
  assert.equal(efsp.positionStore.primaryOf('OPS'), 'c-OPS', 'the second selector is an Observer, not a second Primary');

  const ack = act(efsp, { session: observer, facilityId: 'INCIRLIK' }, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: DEPARTURE_FDR,
  });
  assert.equal(ack.ok, false);
  assert.equal(ack.reason, 'NOT_HOLDING_POSITION');
});

test('TOFI cannot be opened on a Strip that is not yet airborne, nor on a MISSION Strip', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', CTR: 'CENTER', TAC_C2: 'TACTICAL' });

  // A CTR-originated ARRIVAL sitting at INBOUND is eligible; drive one to a
  // state that is not, and the exchange must be refused.
  let ctrStrip = mustAct(efsp, c.CTR, 'CTR', null, {
    kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', role: 'ARRIVAL',
    fdr: { callsign: 'EAGLE1', aircraftType: 'F15', wakeCategory: 'D', originAirport: 'LTAC' },
  });
  assert.equal(act(efsp, c.CTR, 'CTR', ctrStrip, {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2',
  }).ok, true, 'INBOUND is the eligible ARRIVAL state');

  const other = mustAct(efsp, c.CTR, 'CTR', null, {
    kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', role: 'ARRIVAL',
    fdr: { callsign: 'EAGLE2', aircraftType: 'F15', wakeCategory: 'D', originAirport: 'LTAC' },
  });
  const advanced = jumpTo(efsp, c.CTR, 'CTR', other, 'HANDED_TO_TOWER');
  const ack = act(efsp, c.CTR, 'CTR', advanced, {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2',
  });
  assert.equal(ack.ok, false);
  assert.match(ack.detail, /must be at INBOUND to enter tactical control/);
});

test('a Block a Facility hides cannot be written', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { CTR: 'CENTER' });

  const ctrStrip = mustAct(efsp, c.CTR, 'CTR', null, {
    kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', role: 'ARRIVAL',
    fdr: { callsign: 'EAGLE3', aircraftType: 'F15', wakeCategory: 'D', originAirport: 'LTAC' },
  });

  const before = facilityConfig.getFacilityConfig('CENTER');
  // Hiding is expressed as an exclusion, so it survives a Block being added
  // later rather than silently swallowing it (docs/adr/0041).
  facilityConfig.setFacilityConfig({ ...before, hiddenBlocks: { ARRIVAL: ['24A'] } }, 'CENTER');
  try {
    const ack = act(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'SetBlock', blockId: '24A', value: 'USING_AGENCY' });
    assert.equal(ack.ok, false);
    assert.match(ack.detail, /not visible/);
    // Everything it did not hide still works.
    assert.equal(act(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'SetBlock', blockId: 'SREG', value: 'ATC' }).ok, true);
  } finally {
    facilityConfig.setFacilityConfig(before, 'CENTER');
  }
});



// ── Scenario 3: the airspace board ───────────────────────────────────────

function airspaceAct(efsp, crewMember, positionId, airspaceId, op) {
  const current = efsp.airspaceStore.getAirspace(airspaceId);
  const result = efsp.handleMessage(crewMember.session, {
    version: 1, type: 'efsp-airspace-mutation', clientMutationId: crypto.randomUUID(),
    airspaceId, baseRev: current ? current.rev : 0, actingPositionId: positionId, op,
  });
  return result.ack;
}

test('SCENARIO a MOA sortie: Center books and activates its own MOA, a flight works it on the working frequency, then it all comes back', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER' });

  // Ankara Center owns the airspace the MOA sits in, so CTR both books and
  // activates it — there is no range control to ask, which is the ordinary
  // case for a MOA.
  const window = { fromUtc: Date.now(), toUtc: Date.now() + 2 * 60 * 60 * 1000 };
  assert.equal(airspaceAct(efsp, c.CTR, 'CTR', 'MOA-EAST', { kind: 'ScheduleAirspace', ...window }).ok, true);
  const activated = airspaceAct(efsp, c.CTR, 'CTR', 'MOA-EAST', { kind: 'ApproveActivation' });
  assert.equal(activated.ok, true, JSON.stringify(activated));
  assert.equal(activated.airspace.state, 'ACTIVE');

  // A flight gets out to Center and is approved into the MOA.
  let strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: DEPARTURE_FDR,
  });
  strip = jumpTo(efsp, c.OPS, 'OPS', strip, 'HANDED_OFF');
  strip = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-departures', rackId: 'main' });
  const appStrip = mustAct(efsp, c.APP, 'APP', strip, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
  let ctrStrip = mustAct(efsp, c.CTR, 'CTR', efsp.boardStoreFor('CENTER').getStrip(appStrip.coordination.peerStripId), { kind: 'HANDOFF', action: 'ACCEPT' });

  const ack = act(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-EAST' });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.equal(ack.warning, undefined, 'the airspace is active, so no alert');
  assert.equal(ack.strip.airspaceEntry.airspaceId, 'MOA-EAST');
  assert.equal(ack.strip.airspaceEntry.frequencyMhz, 134.25, 'defaulted from the airspace, not typed in');
  assert.equal(ack.fdr.comms.workingFrequencyMhz, 134.25);

  // Jurisdiction did NOT move — §4.7 / defect D17. The controller keeps the
  // Strip; only the flight's radio went anywhere.
  assert.equal(ack.strip.ownerPositionId, 'CTR');
  ctrStrip = ack.strip;

  // Out of the MOA, and the airspace goes back.
  const cleared = act(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'ClearAirspaceEntry' });
  assert.equal(cleared.ok, true, JSON.stringify(cleared));
  assert.equal(cleared.strip.airspaceEntry, null);
  assert.equal(cleared.fdr.comms.workingFrequencyMhz, null);
  // Append-only: the sortie can still show it was on 134.25 (§3.7's reasoning).
  assert.deepEqual(cleared.fdr.comms.transitions.map(t => t.workingFrequencyMhz), [134.25, null]);

  assert.equal(airspaceAct(efsp, c.CTR, 'CTR', 'MOA-EAST', { kind: 'ReleaseAirspace' }).ok, true);
  assert.equal(airspaceAct(efsp, c.CTR, 'CTR', 'MOA-EAST', { kind: 'ReturnAirspace' }).ok, true);
  assert.equal(efsp.airspaceStore.getAirspace('MOA-EAST').state, 'RETURNED');
});

test('SCENARIO a range with its own control: the range books it, Approach approves, and a flight goes to the range control frequency', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', APP: 'INCIRLIK', SOUTH_RANGE: 'RANGES' });

  const window = { fromUtc: Date.now(), toUtc: Date.now() + 2 * 60 * 60 * 1000 };
  assert.equal(airspaceAct(efsp, c.SOUTH_RANGE, 'SOUTH_RANGE', 'RANGE-SOUTH', { kind: 'ScheduleAirspace', ...window }).ok, true);
  assert.equal(airspaceAct(efsp, c.SOUTH_RANGE, 'SOUTH_RANGE', 'RANGE-SOUTH', { kind: 'RequestActivation' }).ok, true);

  // The range cannot activate its own airspace — §9.11's whole point.
  const selfApproved = airspaceAct(efsp, c.SOUTH_RANGE, 'SOUTH_RANGE', 'RANGE-SOUTH', { kind: 'ApproveActivation' });
  assert.equal(selfApproved.ok, false);
  assert.equal(selfApproved.reason, 'PERMISSION_DENIED');

  assert.equal(airspaceAct(efsp, c.APP, 'APP', 'RANGE-SOUTH', { kind: 'ApproveActivation' }).ok, true);

  let strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: DEPARTURE_FDR,
  });
  strip = jumpTo(efsp, c.OPS, 'OPS', strip, 'HANDED_OFF');
  strip = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-departures', rackId: 'main' });

  const ack = act(efsp, c.APP, 'APP', strip, { kind: 'ApproveAirspaceEntry', airspaceId: 'RANGE-SOUTH' });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.equal(ack.strip.airspaceEntry.frequencyMhz, 283.5, 'the range control tower\'s own frequency, not a working frequency');
});

test('a range Position works no Strips — it can run its airspace and nothing else', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', WEST_RANGE: 'RANGES' });

  const strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: DEPARTURE_FDR,
  });
  // Guide §4.1: "no strip primitives — owns airspace state", Strip Roles "none".
  for (const op of [{ kind: 'InvokeNla' }, { kind: 'SetState', toState: 'HANDED_OFF' }, { kind: 'DropStrip', reason: 'x' }]) {
    const ack = act(efsp, c.WEST_RANGE, 'WEST_RANGE', strip, op);
    assert.equal(ack.ok, false, op.kind);
  }
  // But it is a real Position that really runs its own airspace.
  const window = { fromUtc: Date.now(), toUtc: Date.now() + 60 * 60 * 1000 };
  const scheduled = airspaceAct(efsp, c.WEST_RANGE, 'WEST_RANGE', 'RANGE-WEST', { kind: 'ScheduleAirspace', ...window });
  assert.equal(scheduled.ok, true, JSON.stringify(scheduled));
});

test('approving a flight into airspace nobody has activated is allowed, but warns and raises an alert', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', APP: 'INCIRLIK' });

  let strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: DEPARTURE_FDR,
  });
  strip = jumpTo(efsp, c.OPS, 'OPS', strip, 'HANDED_OFF');
  strip = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-departures', rackId: 'main' });

  // §9.11 says alert, not refuse: the block may well be hot in reality with
  // the board simply not caught up, and refusing would be wrong more often
  // than it would be right.
  const ack = act(efsp, c.APP, 'APP', strip, { kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-NORTH' });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.equal(ack.warning, 'AIRSPACE_NOT_ACTIVE');

  const { ForwardingObligationMonitor } = await import('../src/efsp/forwarding-obligations.js');
  const alerts = [];
  const monitor = new ForwardingObligationMonitor({
    boardStoreFor: efsp.boardStoreFor,
    fdrStore: efsp.fdrStore,
    facilityConfig,
    airspaceStore: efsp.airspaceStore,
    onAlert: (a) => alerts.push(a),
  });
  monitor.tick();
  assert.equal(alerts.some(a => a.obligationType === 'UNACTIVATED_AIRSPACE_ENTRY'), true);
});

test('a controller cannot run an airspace from a Position it has not selected', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { APP: 'INCIRLIK' });
  // The same session binding every Strip mutation carries (docs/adr/0029) —
  // a new dispatch path is exactly where that gets forgotten.
  const ack = airspaceAct(efsp, c.APP, 'WEST_RANGE', 'RANGE-WEST', { kind: 'ScheduleAirspace', fromUtc: Date.now(), toUtc: Date.now() + 1000 });
  assert.equal(ack.ok, false);
  assert.equal(ack.reason, 'NOT_HOLDING_POSITION');
});
