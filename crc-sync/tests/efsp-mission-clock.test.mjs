import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// docs/adr/0079 — EFSP tells time by the injected mission clock, never by
// Date.now(). Every test here runs a fake clock set to a mission day seven years
// before the wall clock, so a single stray Date.now() shows up as a timestamp
// in the wrong decade rather than as a few milliseconds of drift.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-mission-clock-test-'));
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH = path.join(tmpDir, 'facility.json');
process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH = path.join(tmpDir, 'board.json');
process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH = path.join(tmpDir, 'mutations.jsonl');

const { createEfsp } = await import('../src/efsp/index.js');
const { BoardStore } = await import('../src/efsp/board-store.js');
const { FdrStore } = await import('../src/efsp/fdr-store.js');
const { ConformanceMonitor } = await import('../src/efsp/conformance.js');

const MISSION_0240Z = Date.UTC(2016, 5, 21, 2, 40, 0);

function fakeClock(t = MISSION_0240Z) {
  return { now: () => t, source: 'MISSION', set(v) { t = v; } };
}

function createStripMsg() {
  return {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), actingPositionId: 'OPS',
    op: {
      kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main',
      fdr: { callsign: 'VIPER1', aircraftType: 'F16', wakeCategory: 'D', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' },
    },
  };
}

test('createEfsp stamps Strips, FDRs, Position occupancy and the Mutation log with mission time', () => {
  const clock = fakeClock();
  const efsp = createEfsp({ clock });
  assert.equal(efsp.clock, clock);
  const session = { controllerId: 'c1', who: 'Alice' };
  efsp.handleMessage(session, { type: 'efsp-set-positions', held: ['OPS'] });
  const result = efsp.handleMessage(session, createStripMsg());
  assert.equal(result.ack.ok, true);

  const [strip] = efsp.boardStore.getAll();
  assert.equal(strip.createdAt, MISSION_0240Z);
  assert.equal(strip.updatedAt, MISSION_0240Z);
  assert.equal(efsp.positionStore.getAll().find(p => p.positionId === 'OPS').primary.since, MISSION_0240Z);

  const entry = efsp.mutationLog.readAll().find(e => e.stripId === strip.stripId);
  assert.equal(entry.at, MISSION_0240Z);
  assert.equal(entry.atSource, 'MISSION');
  assert.ok(entry.wallAt > MISSION_0240Z, 'the real write time is kept alongside, not instead');
});

test('the NLA status every Strip carries is computed at mission time', () => {
  const clock = fakeClock();
  let seen = null;
  const board = new BoardStore(new FdrStore(undefined, { clock }), {
    computeNla: (_strip, _fdr, now) => { seen = now; return null; },
  }, { clock });
  board.nlaStatusFor({ stripId: 's1', fdrId: 'f1', state: 'HELD' });
  assert.equal(seen, MISSION_0240Z);
});

test('conformance measures the heading grace period from the clearance\'s mission-time stamp', () => {
  const clock = fakeClock();
  const cleared = MISSION_0240Z;
  const fdr = { fdrId: 'f1', clearance: { heading: { entries: [{ status: 'ACTIVE', parsed: 90, at: cleared }] }, altitude: { entries: [] } } };
  const monitor = new ConformanceMonitor({
    clock,
    trackStore: { get: () => ({ course: 180, groundSpeed: 200, verticalSpeed: 0, alt: 3000 }) },
    fdrStore: { getFdr: () => fdr },
    correlationStore: { getAll: () => [{ fdrId: 'f1', trackId: 't1', state: 'CORRELATED' }] },
    weather: () => ({}), transitionAltFt: () => 18000, indicatedAltFt: () => 10000,
    config: { minGroundSpeedKt: 50, headingToleranceDeg: 5, headingGraceSec: 30, headingPersistSec: 10, atAltitudeBandFt: 400, levelBustFt: 500, levelBustPersistSec: 3, wrongWayFpm: 500, wrongWayPersistSec: 5 },
  });
  // With a wall-clock `now` this would be seven years past the grace period.
  monitor.tick();
  assert.deepEqual(monitor.getAll(), [], 'inside the 30 s grace period');
  clock.set(cleared + 31000);
  monitor.tick();
  clock.set(cleared + 42000);
  monitor.tick();
  const [{ alerts: [alert] }] = monitor.getAll();
  assert.equal(alert.kind, 'HEADING');
  assert.equal(alert.since, cleared + 31000, '`since` is mission time too');
});
