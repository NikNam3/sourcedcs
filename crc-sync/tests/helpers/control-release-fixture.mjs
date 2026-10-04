import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The two-Board fixture the ControlRelease tests share (docs/adr/0101): a C-130 ARRIVAL handed CENTER -> INCIRLIK,
// CTR transferring, AP receiving. A test file imports this BEFORE ../src/efsp/index.js: the env paths are its prologue.

export function prologue(prefix) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [k, v] of Object.entries({
    CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
    CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
    CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
    CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CARRIER: 'carrier.json',
    CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
    CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
    CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
  })) process.env[k] = path.join(tmpDir, v);
  fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}'); // keyed by theater (docs/adr/0098)
  process.env.CRCSYNC_CONTROL_INVARIANT = 'throw'; // a violation of the control invariant throws under test (ADR 0101)
  return tmpDir;
}

export const STAFFED = { OPS: 'INCIRLIK', AP: 'INCIRLIK', LC: 'INCIRLIK', CTR: 'CENTER', CV_MARSHAL: 'CARRIER' };

/** A mission clock a test moves by hand. */
export function fakeClock(start = Date.now()) {
  const clock = { t: start, source: 'test', now: () => clock.t, advance: (ms) => { clock.t += ms; } };
  return clock;
}

/** The undo window's wall clock (docs/adr/0100), moved by hand: `wallClock.advance(10_000)` closes the window. */
export function fakeWallClock(start = 1_000_000) {
  const wall = { t: start, now: () => wall.t, advance: (ms) => { wall.t += ms; } };
  return wall;
}

export function makeWorld(createEfsp, helpers, { clock, wallClock, staffed = STAFFED, pendingSignOffs = null } = {}) {
  fs.rmSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, { force: true });
  const efsp = createEfsp({ ...(clock ? { clock } : {}), ...(wallClock ? { wallClock } : {}), ...(pendingSignOffs ? { isAbsent: (id) => pendingSignOffs.has(id) } : {}) });
  const c = helpers.crew(efsp, staffed);
  return { efsp, c, clock };
}

/**
 * A flight CTR proposes to AP (ARRIVAL, INBOUND); accepted unless `accept: false`. `T()` and `R()` are the transferring
 * and receiving Strips as they are now. `alt` is an assigned altitude written before the exchange (no control check yet).
 */
export function exchange(world, helpers, callsign, { accept = true, alt = null } = {}) {
  const { efsp, c } = world;
  let enroute = helpers.mustAct(efsp, c.CTR, 'CTR', null, {
    kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', stripType: 'ARRIVAL',
    flightData: { callsign, aircraftType: 'C130', wakeCategory: 'M', originAirport: 'LTAC' },
  });
  if (alt) enroute = helpers.mustAct(efsp, c.CTR, 'CTR', enroute, { kind: 'SetBlock', blockId: '7', value: alt });
  const proposed = helpers.mustAct(efsp, c.CTR, 'CTR', enroute, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP' });
  const ex = {
    T: () => efsp.boardStoreFor('CENTER').getStrip(enroute.stripId),
    R: () => efsp.boardStoreFor('INCIRLIK').getStrip(proposed.coordination.peerStripId),
  };
  if (accept) helpers.mustAct(efsp, c.AP, 'AP', ex.R(), { kind: 'HANDOFF', action: 'ACCEPT' });
  return ex;
}

/** What each side's record says: both Strips must agree on comms, control and the ref. */
export function holders(ex) {
  const t = ex.T().coordination;
  const r = ex.R() && ex.R().coordination;
  if (r && ex.R().state !== 'DROPPED' && ex.T().state !== 'DROPPED') {
    assert.equal(t.comms.transferred, r.comms.transferred, 'both Strips agree on comms');
    assert.equal(t.control.holder, r.control.holder, 'both Strips agree on control');
    assert.deepEqual(t.separationResponsibilityRef, r.separationResponsibilityRef, 'both Strips agree on the control Position');
  }
  return { comms: t.comms.transferred ? 'RECEIVING' : 'TRANSFERRING', control: t.control.holder, ref: t.separationResponsibilityRef };
}
