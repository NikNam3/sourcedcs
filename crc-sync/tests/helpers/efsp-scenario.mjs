import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';

// Shared harness for the end-to-end sortie walks. Deliberately takes the
// `efsp` facade as a parameter rather than importing it: every scenario file
// has to set its own config/snapshot env paths BEFORE importing index.js, so
// this module must not pull it in itself.
//
// Each scenario file also gets its own snapshot path for a reason found the
// hard way — airspace and Board state are durable (ADR 0002), so tests in one
// file share a snapshot and a test that needs a specific starting state must
// either create its own airspace or drive the shared one back itself.

export const NLA_DOUBLE_TAP_MS = 400; // board/ops/invoke-nla.js's double-tap guard

/**
 * A wall clock a test steps by hand (docs/adr/0096): start at the real time so wall stamps stay comparable with
 * the archiver's, then move only on `step(ms)`. Pass it to createEfsp({ wallClock }) so the double-tap guard
 * needs no real sleep.
 */
export function steppedWallClock(start = Date.now()) {
  let t = start;
  return { now: () => t, step: (ms) => { t += ms; }, source: 'TEST' };
}

/** Let the double-tap guard lapse: a step on a stepped wall clock, a real sleep otherwise. */
export async function lapseNlaGuard(wallClock) {
  if (wallClock && wallClock.step) wallClock.step(NLA_DOUBLE_TAP_MS + 10);
  else await new Promise(resolve => setTimeout(resolve, NLA_DOUBLE_TAP_MS + 10));
}

/**
 * A fresh EFSP over an emptied Board snapshot, with one controller per Position of `staffed` (Position -> Facility).
 * `createEfsp` is a parameter for the reason this file imports no src: each scenario sets its env paths first.
 * The snapshot path comes from CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, like the scenario's own.
 */
export function freshEfsp(createEfsp, staffed, opts) {
  fs.rmSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, { force: true });
  const efsp = createEfsp(opts);
  return { efsp, c: crew(efsp, staffed) };
}

/** A Strip re-read at its current rev (every op bumps it), from the Board of its Facility (default INCIRLIK). */
export const freshStrip = (efsp, strip, facilityId = strip.facilityId || 'INCIRLIK') => efsp.boardStoreFor(facilityId).getStrip(strip.stripId);

/** One controller per Position, each declaring what it holds the way a real client does. */
export function crew(efsp, spec) {
  const sessions = {};
  for (const [positionId, facilityId] of Object.entries(spec)) {
    const session = { controllerId: `c-${positionId}`, who: positionId };
    efsp.handleMessage(session, { type: 'efsp-set-positions', facilityId, signedOn: [positionId] });
    sessions[positionId] = { session, facilityId };
  }
  return sessions;
}

/** Declare a controller's FULL held set — for the combined-Position and vacate cases. */
export function hold(efsp, session, facilityId, signedOn) {
  return efsp.handleMessage(session, { type: 'efsp-set-positions', facilityId, signedOn });
}

export function act(efsp, crewMember, positionId, strip, op) {
  const result = efsp.handleMessage(crewMember.session, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: crewMember.facilityId, actingPositionId: positionId,
    stripId: strip ? strip.stripId : undefined, baseRev: strip ? strip.rev : undefined,
    op,
  });
  return result.ack;
}

export function mustAct(efsp, crewMember, positionId, strip, op) {
  const ack = act(efsp, crewMember, positionId, strip, op);
  assert.equal(ack.ok, true, `${op.kind} as ${positionId}: ${JSON.stringify(ack)}`);
  return ack.strip;
}

/** An airspace op — its own message type, since it targets no Strip. */
export function airspaceAct(efsp, crewMember, positionId, airspaceId, op) {
  const current = efsp.airspaceStore.getAirspace(airspaceId);
  const result = efsp.handleMessage(crewMember.session, {
    version: 1, type: 'efsp-airspace-mutation', clientMutationId: crypto.randomUUID(),
    airspaceId, baseRev: current ? current.rev : 0, actingPositionId: positionId, op,
  });
  return result.ack;
}

export function mustAirspaceAct(efsp, crewMember, positionId, airspaceId, op) {
  const ack = airspaceAct(efsp, crewMember, positionId, airspaceId, op);
  assert.equal(ack.ok, true, `${op.kind} on ${airspaceId} as ${positionId}: ${JSON.stringify(ack)}`);
  return ack.airspace;
}

/**
 * A MARSA op (§9.2) — its own message type, since it targets a relation
 * between flights rather than any one Strip.
 *
 * `marsaId` is optional: DeclareMarsa mints the relation, so there is nothing
 * to name or to base a rev on yet (the same shape CreateStrip has in act()).
 */
export function marsaAct(efsp, crewMember, positionId, marsaId, op) {
  const current = marsaId ? efsp.marsaStore.getRelation(marsaId) : null;
  const result = efsp.handleMessage(crewMember.session, {
    version: 1, type: 'efsp-marsa-mutation', clientMutationId: crypto.randomUUID(),
    marsaId, baseRev: current ? current.rev : undefined, actingPositionId: positionId, op,
  });
  return result.ack;
}

export function mustMarsaAct(efsp, crewMember, positionId, marsaId, op) {
  const ack = marsaAct(efsp, crewMember, positionId, marsaId, op);
  assert.equal(ack.ok, true, `${op.kind} on ${marsaId || '(new)'} as ${positionId}: ${JSON.stringify(ack)}`);
  return ack.marsa;
}

/** SetState rather than InvokeNla where a test needs to jump — see advance(). */
export function jumpTo(efsp, crewMember, positionId, strip, toState) {
  return mustAct(efsp, crewMember, positionId, strip, { kind: 'SetState', toState });
}

/**
 * Press the NLA button, honouring the 400ms double-tap guard. A real
 * controller never presses it twice that fast; a test walking a whole chain
 * does, and the second press would be silently swallowed as a no-op.
 */
export async function advance(efsp, crewMember, positionId, strip) {
  await lapseNlaGuard(efsp.wallClock);
  return mustAct(efsp, crewMember, positionId, strip, { kind: 'InvokeNla' });
}

export const DEPARTURE_FLIGHT_DATA = {
  callsign: 'VIPER1', aircraftType: 'F16', wakeCategory: 'D',
  departureAirport: 'LTAG', destinationAirport: 'LTAG', route: 'DCT', requestedAltitude: '250',
};

/** A DEPARTURE Strip parked at AP's terminus, which is where most airborne scenarios start. */
export function airborneDeparture(efsp, c, flightData = DEPARTURE_FLIGHT_DATA) {
  let strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData,
  });
  // ap-departures implies HANDED_OFF, so the Strip has to be there already
  // before it can land in that Bay (board/placement.js's `validateBayImpliedTransition`).
  strip = jumpTo(efsp, c.OPS, 'OPS', strip, 'HANDED_OFF');
  return mustAct(efsp, c.OPS, 'OPS', strip, {
    kind: 'TransferStrip', toPositionId: 'AP', bayId: 'ap-departures', rackId: 'main',
  });
}

/** The same flight, handed across the boundary and accepted by CTR. */
export function handedToCenter(efsp, c, strip) {
  const appStrip = mustAct(efsp, c.AP, 'AP', strip, {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
  });
  const replica = efsp.boardStoreFor('CENTER').getStrip(appStrip.coordination.peerStripId);
  return mustAct(efsp, c.CTR, 'CTR', replica, { kind: 'HANDOFF', action: 'ACCEPT' });
}

/**
 * Drives an airspace to ACTIVE, taking whichever route its configuration
 * implies. Idempotent: airspace state is durable and shared across the tests
 * in one file, so a block another test already left hot is simply left alone.
 */
export function activate(efsp, c, airspaceId, window) {
  const current = efsp.airspaceStore.getAirspace(airspaceId);
  if (current.state === 'ACTIVE') return current;
  const definition = current.definition;
  const using = definition.usingPositionId || definition.controllingPositionId;
  const booking = window || { fromUtc: Date.now(), toUtc: Date.now() + 2 * 60 * 60 * 1000 };
  mustAirspaceAct(efsp, c[using], using, airspaceId, { kind: 'ScheduleAirspace', ...booking });
  if (definition.usingPositionId) {
    mustAirspaceAct(efsp, c[using], using, airspaceId, { kind: 'RequestActivation' });
  }
  return mustAirspaceAct(efsp, c[definition.controllingPositionId], definition.controllingPositionId, airspaceId, { kind: 'ApproveActivation' });
}

/** Ticks a fresh obligation monitor once and returns what is due (docs/adr/0067). */
export async function obligationAlerts(efsp, facilityConfig) {
  const { ForwardingObligationMonitor } = await import('../../src/efsp/forwarding-obligations.js');
  const monitor = new ForwardingObligationMonitor({
    boardStoreFor: efsp.boardStoreFor,
    flightDataStore: efsp.flightDataStore,
    facilityConfig,
    airspaceStore: efsp.airspaceStore,
  });
  monitor.tick();
  return monitor.getAll();
}

/**
 * A carrier op (docs/adr/0074) — the Case, a Marshal stack op or the altimeter:
 * its own message type, since it targets the ship's record and no Strip.
 * Returns the whole handleMessage result (ack and carrierBroadcast).
 */
export function carrierAct(efsp, crewMember, positionId, op, { hullId, baseRev } = {}) {
  return efsp.handleMessage(crewMember.session, {
    version: 1, type: 'efsp-carrier-mutation', clientMutationId: crypto.randomUUID(),
    hullId, baseRev, actingPositionId: positionId, op,
  });
}

export function mustCarrierAct(efsp, crewMember, positionId, op, opts) {
  const result = carrierAct(efsp, crewMember, positionId, op, opts);
  assert.equal(result.ack.ok, true, `${op.kind} as ${positionId}: ${JSON.stringify(result.ack)}`);
  return result;
}

/**
 * An SFA rotation-record op (docs/adr/0075, 0093) — its own message type, since
 * it targets the approach's rotation and no Strip. Returns the whole
 * handleMessage result (ack and sfaBroadcast).
 */
export function sfaAct(efsp, crewMember, positionId, op, { baseRev } = {}) {
  return efsp.handleMessage(crewMember.session, {
    version: 1, type: 'efsp-sfa-mutation', clientMutationId: crypto.randomUUID(),
    baseRev, actingPositionId: positionId, op,
  });
}

export function mustSfaAct(efsp, crewMember, positionId, op, opts) {
  const result = sfaAct(efsp, crewMember, positionId, op, opts);
  assert.equal(result.ack.ok, true, `${op.kind} as ${positionId}: ${JSON.stringify(result.ack)}`);
  return result;
}
