import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Airspace sorties — the MOA and range work a squadron actually does.
// Its own file, and its own snapshot path, because airspace state is durable
// (ADR 0002): tests sharing a file share a board, so each one below either
// uses its own airspace or drives the shared one back itself.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-airspace-scn-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);

// One airspace per scenario that needs a clean starting state, plus the two
// shapes that matter: a block with no control of its own (owned by the Center
// that owns the airspace it sits in) and a range with its own tower.
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify([
  { airspaceId: 'MOA-EAST', name: 'East MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 134.25 },
  // A danger area with published vertical limits — the altitude-block case.
  { airspaceId: 'D-12', name: 'Danger 12', type: 'DANGER', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 135.5, altLowerFt: 5000, altUpperFt: 28000 },
  { airspaceId: 'MOA-SHARED', name: 'Shared MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 136.0 },
  { airspaceId: 'MOA-OCCUPIED', name: 'Occupied MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 136.5 },
  { airspaceId: 'MOA-COLD', name: 'Cold MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 137.0 },
  { airspaceId: 'MOA-LATER', name: 'Later MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 137.5 },
  { airspaceId: 'RANGE-SOUTH', name: 'South A/G Range', type: 'RANGE', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'APP', usingPositionId: 'SOUTH_RANGE', controlFrequencyMhz: 283.5 },
  { airspaceId: 'RANGE-DENY', name: 'Deny Range', type: 'RANGE', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'APP', usingPositionId: 'DENY_RANGE', controlFrequencyMhz: 284.0 },
]));

const { createEfsp } = await import('../src/efsp/index.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const {
  crew, act, mustAct, airspaceAct, mustAirspaceAct, jumpTo, advance,
  DEPARTURE_FDR, airborneDeparture, handedToCenter, activate, obligationAlerts,
} = await import('./helpers/efsp-scenario.mjs');

const ATC = { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER' };

function flight(efsp, c, callsign) {
  return airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign });
}

// ── 5. the bread-and-butter sortie ───────────────────────────────────────

test('SCENARIO before takeoff, out to a MOA, and home again', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  // Center books and activates its own block before anyone launches.
  activate(efsp, c, 'MOA-EAST');

  // The full pre-departure chain, pressed rather than jumped.
  let strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: DEPARTURE_FDR,
  });
  const fdrId = strip.fdrId;
  strip = await advance(efsp, c.OPS, 'OPS', strip);   // -> PENDING_CLEARANCE at CD
  strip = jumpTo(efsp, c.CD, 'CD', strip, 'CLEARED');
  strip = await advance(efsp, c.CD, 'CD', strip);     // -> PUSHBACK at GND
  strip = jumpTo(efsp, c.GND, 'GND', strip, 'TAXI');
  strip = await advance(efsp, c.GND, 'GND', strip);   // -> RUNWAY_QUEUE at TWR
  strip = jumpTo(efsp, c.TWR, 'TWR', strip, 'DEPARTED');
  strip = await advance(efsp, c.TWR, 'TWR', strip);   // -> HANDED_OFF at APP
  assert.equal(strip.ownerPositionId, 'APP');

  const ctrStrip = handedToCenter(efsp, c, strip);
  const working = mustAct(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-EAST' });
  assert.equal(working.airspaceEntry.frequencyMhz, 134.25);
  assert.equal(working.ownerPositionId, 'CTR', 'the controller keeps the Strip — only the radio moved');

  // Done in the block, back to Center's frequency, home the same way out.
  const clear = mustAct(efsp, c.CTR, 'CTR', working, { kind: 'ClearAirspaceEntry' });
  assert.equal(efsp.fdrStore.getFdr(fdrId).comms.workingFrequencyMhz, null);

  const returning = mustAct(efsp, c.CTR, 'CTR', clear, { kind: 'ConvertToArrival' });
  const handedBack = mustAct(efsp, c.CTR, 'CTR', returning, {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'APP',
  });
  let arrival = efsp.boardStore.getStrip(handedBack.coordination.peerStripId);
  arrival = mustAct(efsp, c.APP, 'APP', arrival, { kind: 'HANDOFF', action: 'ACCEPT' });
  arrival = await advance(efsp, c.APP, 'APP', arrival);  // -> HANDED_TO_TOWER at TWR
  arrival = jumpTo(efsp, c.TWR, 'TWR', arrival, 'LANDED');
  arrival = await advance(efsp, c.TWR, 'TWR', arrival);  // -> TAXI_IN at GND
  arrival = await advance(efsp, c.GND, 'GND', arrival);  // terminal Drop
  assert.equal(arrival.state, 'DROPPED');
  assert.equal(arrival.flags.removeIndicator, true);
});

// ── the altitude-block case ──────────────────────────────────────────────

test('SCENARIO a flight working a danger area is restricted to an altitude block while another crosses it', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  activate(efsp, c, 'D-12');

  // VIPER1 is working the block, unrestricted — it has it to itself.
  const viper = handedToCenter(efsp, c, flight(efsp, c, 'VIPER1'));
  let working = mustAct(efsp, c.CTR, 'CTR', viper, { kind: 'ApproveAirspaceEntry', airspaceId: 'D-12' });
  assert.equal(working.airspaceEntry.altitudeBlock, null,
    'no restriction is not the same as "restricted to the whole block" — they read differently to whoever deconflicts next');

  // HAWK1 needs to cross. VIPER1 gets squeezed into the bottom of the block
  // first — re-issuing the approval amends the restriction in place.
  working = mustAct(efsp, c.CTR, 'CTR', working, {
    kind: 'ApproveAirspaceEntry', airspaceId: 'D-12', altitudeBlock: { lowerFt: 5000, upperFt: 15000 },
  });
  assert.deepEqual(working.airspaceEntry.altitudeBlock, { lowerFt: 5000, upperFt: 15000 });
  assert.equal(working.airspaceEntry.airspaceId, 'D-12', 'still the same block, still the same frequency');

  // Now the crossing flight, in the top half, above the restricted one.
  const hawk = handedToCenter(efsp, c, flight(efsp, c, 'HAWK1'));
  const crossing = mustAct(efsp, c.CTR, 'CTR', hawk, {
    kind: 'ApproveAirspaceEntry', airspaceId: 'D-12', altitudeBlock: { lowerFt: 20000, upperFt: 28000 },
  });
  assert.deepEqual(crossing.airspaceEntry.altitudeBlock, { lowerFt: 20000, upperFt: 28000 });

  // Both are in the block at once, vertically split.
  const inside = efsp.boardStoreFor('CENTER').getAll().filter(s => s.airspaceEntry && s.airspaceEntry.airspaceId === 'D-12');
  assert.equal(inside.length, 2);
  assert.equal(efsp.airspaceStore.getAirspace('D-12').state, 'ACTIVE');

  // Crossing flight clears the area; the worker gets the whole block back.
  mustAct(efsp, c.CTR, 'CTR', crossing, { kind: 'ClearAirspaceEntry' });
  const released = mustAct(efsp, c.CTR, 'CTR', efsp.boardStoreFor('CENTER').getStrip(working.stripId), {
    kind: 'ApproveAirspaceEntry', airspaceId: 'D-12', altitudeBlock: null,
  });
  assert.equal(released.airspaceEntry.altitudeBlock, null, 'restriction lifted');
});

test('an altitude block has to fit inside the airspace it is in, and be the right way up', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  activate(efsp, c, 'D-12');
  const strip = handedToCenter(efsp, c, flight(efsp, c, 'EAGLE9'));

  const below = act(efsp, c.CTR, 'CTR', strip, {
    kind: 'ApproveAirspaceEntry', airspaceId: 'D-12', altitudeBlock: { lowerFt: 1000, upperFt: 10000 },
  });
  assert.equal(below.ok, false);
  assert.match(below.detail, /starts at 5000 ft/);

  const above = act(efsp, c.CTR, 'CTR', strip, {
    kind: 'ApproveAirspaceEntry', airspaceId: 'D-12', altitudeBlock: { lowerFt: 20000, upperFt: 35000 },
  });
  assert.equal(above.ok, false);
  assert.match(above.detail, /tops at 28000 ft/);

  const upsideDown = act(efsp, c.CTR, 'CTR', strip, {
    kind: 'ApproveAirspaceEntry', airspaceId: 'D-12', altitudeBlock: { lowerFt: 20000, upperFt: 10000 },
  });
  assert.equal(upsideDown.ok, false);
  assert.match(upsideDown.detail, /upperFt must be above lowerFt/);

  // A block with no published limits takes any sane restriction.
  const unbounded = handedToCenter(efsp, c, flight(efsp, c, 'EAGLE8'));
  assert.equal(act(efsp, c.CTR, 'CTR', unbounded, {
    kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-EAST', altitudeBlock: { lowerFt: 1000, upperFt: 45000 },
  }).ok, true);
});

// ── 6. two flights, one block ────────────────────────────────────────────

test('SCENARIO a MOA stays hot when one of two flights leaves it', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  activate(efsp, c, 'MOA-SHARED');

  const first = mustAct(efsp, c.CTR, 'CTR', handedToCenter(efsp, c, flight(efsp, c, 'VIPER2')), {
    kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-SHARED',
  });
  const second = mustAct(efsp, c.CTR, 'CTR', handedToCenter(efsp, c, flight(efsp, c, 'VIPER3')), {
    kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-SHARED',
  });

  // The exact case docs/adr/0032 argued the whole design around: airspace
  // state is not per-flight, so one aircraft leaving says nothing about the
  // block. Never actually tested until now.
  mustAct(efsp, c.CTR, 'CTR', first, { kind: 'ClearAirspaceEntry' });
  assert.equal(efsp.airspaceStore.getAirspace('MOA-SHARED').state, 'ACTIVE');
  assert.equal(efsp.boardStoreFor('CENTER').getStrip(second.stripId).airspaceEntry.airspaceId, 'MOA-SHARED');

  mustAct(efsp, c.CTR, 'CTR', efsp.boardStoreFor('CENTER').getStrip(second.stripId), { kind: 'ClearAirspaceEntry' });
  assert.equal(efsp.airspaceStore.getAirspace('MOA-SHARED').state, 'ACTIVE',
    'and it is still hot with nobody in it — releasing is a decision, not a side effect');
});

// ── 7. released with somebody still inside ───────────────────────────────

test('SCENARIO an airspace released while a flight is still working it', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  activate(efsp, c, 'MOA-OCCUPIED');

  const inside = mustAct(efsp, c.CTR, 'CTR', handedToCenter(efsp, c, flight(efsp, c, 'VIPER4')), {
    kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-OCCUPIED',
  });

  const released = airspaceAct(efsp, c.CTR, 'CTR', 'MOA-OCCUPIED', { kind: 'ReleaseAirspace' });
  assert.equal(released.ok, true, 'releasing is allowed — the controller may know something the board does not');
  assert.equal(released.warning, 'AIRSPACE_STILL_OCCUPIED',
    'but it must say so: a flight is still in there on the block frequency');

  // And the flight left behind is exactly the §9.11 alert case, because the
  // airspace it is working is no longer active.
  const alerts = await obligationAlerts(efsp, facilityConfig);
  assert.equal(alerts.some(a => a.stripId === inside.stripId && a.obligationType === 'UNACTIVATED_AIRSPACE_ENTRY'), true);
});

// ── 8. denied, then granted ──────────────────────────────────────────────

test('SCENARIO a range asks, is refused with a reason, asks again and gets it', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { ...ATC, DENY_RANGE: 'RANGES' });
  const window = { fromUtc: Date.now(), toUtc: Date.now() + 3600000 };

  mustAirspaceAct(efsp, c.DENY_RANGE, 'DENY_RANGE', 'RANGE-DENY', { kind: 'ScheduleAirspace', ...window });
  mustAirspaceAct(efsp, c.DENY_RANGE, 'DENY_RANGE', 'RANGE-DENY', { kind: 'RequestActivation' });

  const denied = mustAirspaceAct(efsp, c.APP, 'APP', 'RANGE-DENY', { kind: 'DenyActivation', reason: 'inbound traffic' });
  assert.equal(denied.state, 'SCHEDULED', 'the booking survives a refusal');
  assert.equal(denied.pendingRequest, null);
  assert.equal(denied.lastDenial.reason, 'inbound traffic');

  mustAirspaceAct(efsp, c.DENY_RANGE, 'DENY_RANGE', 'RANGE-DENY', { kind: 'RequestActivation' });
  assert.equal(mustAirspaceAct(efsp, c.APP, 'APP', 'RANGE-DENY', { kind: 'ApproveActivation' }).state, 'ACTIVE');
});

// ── 9. a manned range tower ──────────────────────────────────────────────

test('SCENARIO an A/G range with its own tower: the flight goes to range control, and the range sees it', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { ...ATC, SOUTH_RANGE: 'RANGES' });
  activate(efsp, c, 'RANGE-SOUTH');

  const onRange = mustAct(efsp, c.APP, 'APP', flight(efsp, c, 'HOG1'), {
    kind: 'ApproveAirspaceEntry', airspaceId: 'RANGE-SOUTH',
  });
  assert.equal(onRange.airspaceEntry.frequencyMhz, 283.5, "the tower's own frequency, not a working frequency");
  assert.equal(onRange.ownerPositionId, 'APP', 'the range controls the range; Approach still has the Strip');

  // What the range controller sees of it: the Strip is on INCIRLIK's Board,
  // which every client receives, and it is findable by the airspace. The
  // range position owns nothing and can do nothing to it.
  const inBlock = efsp.boardStore.getAll().filter(s => s.airspaceEntry && s.airspaceEntry.airspaceId === 'RANGE-SOUTH');
  assert.equal(inBlock.length, 1);
  for (const op of [{ kind: 'InvokeNla' }, { kind: 'ClearAirspaceEntry' }, { kind: 'DropStrip', reason: 'x' }]) {
    assert.equal(act(efsp, c.SOUTH_RANGE, 'SOUTH_RANGE', onRange, op).ok, false, op.kind);
  }

  mustAct(efsp, c.APP, 'APP', onRange, { kind: 'ClearAirspaceEntry' });
  mustAirspaceAct(efsp, c.SOUTH_RANGE, 'SOUTH_RANGE', 'RANGE-SOUTH', { kind: 'ReleaseAirspace' });
  assert.equal(mustAirspaceAct(efsp, c.APP, 'APP', 'RANGE-SOUTH', { kind: 'ReturnAirspace' }).state, 'RETURNED');
});

// ── 10. booked ahead ─────────────────────────────────────────────────────

test('SCENARIO a block booked for later this afternoon, activated when the time comes', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  const later = { fromUtc: Date.now() + 4 * 3600000, toUtc: Date.now() + 6 * 3600000 };

  const booked = mustAirspaceAct(efsp, c.CTR, 'CTR', 'MOA-LATER', { kind: 'ScheduleAirspace', ...later });
  assert.equal(booked.state, 'SCHEDULED');
  assert.deepEqual(booked.window, later);
  assert.equal(efsp.airspaceStore.isActive('MOA-LATER'), false, 'booked is not active');

  // Nothing enforces the window — a booking is a statement of intent the
  // controller works to, not a lock the system applies. Activating early is
  // a normal thing to do when the players show up early.
  assert.equal(mustAirspaceAct(efsp, c.CTR, 'CTR', 'MOA-LATER', { kind: 'ApproveActivation' }).state, 'ACTIVE');
});

// ── 11. into a cold block ────────────────────────────────────────────────

test('SCENARIO a flight approved into a block nobody activated: allowed, flagged, alerted', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  assert.equal(efsp.airspaceStore.getAirspace('MOA-COLD').state, 'RETURNED');

  const ack = act(efsp, c.CTR, 'CTR', handedToCenter(efsp, c, flight(efsp, c, 'VIPER5')), {
    kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-COLD',
  });
  assert.equal(ack.ok, true, '§9.11 says alert, not refuse');
  assert.equal(ack.warning, 'AIRSPACE_NOT_ACTIVE');

  const alerts = await obligationAlerts(efsp, facilityConfig);
  assert.equal(alerts.some(a => a.obligationType === 'UNACTIVATED_AIRSPACE_ENTRY'), true);
});
