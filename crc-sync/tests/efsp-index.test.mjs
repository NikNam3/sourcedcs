import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// Both facility-config.js and index.js read their paths once at module
// load — override before the first import (same pattern as every other
// path-overridable module in this package).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-index-test-'));
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH = path.join(tmpDir, 'facility.json');
process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH = path.join(tmpDir, 'board.json');
process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH = path.join(tmpDir, 'mutations.jsonl'); // createEfsp() builds a real MutationLog — keep it off the real repo config dir

const { createEfsp, BOARD_SNAPSHOT_PATH } = await import('../src/efsp/index.js');

function createStripMsg() {
  return {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), actingPositionId: 'OPS',
    op: {
      kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main',
      fdr: { callsign: 'VIPER1', aircraftType: 'F16', wakeCategory: 'D', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' },
    },
  };
}

test('createEfsp returns the full facade shape', () => {
  const efsp = createEfsp();
  assert.ok(efsp.boardStore);
  assert.ok(efsp.fdrStore);
  assert.ok(efsp.positionStore);
  assert.ok(efsp.mutationLog);
  assert.equal(typeof efsp.handleMessage, 'function');
  assert.equal(typeof efsp.onDisconnect, 'function');
  assert.equal(typeof efsp.snapshotFor, 'function');
  assert.equal(typeof efsp.controllerIdFor, 'function');
});

test('controllerIdFor uses the same fallback chain as ws-hub.js\'s session.who', () => {
  const efsp = createEfsp();
  assert.equal(efsp.controllerIdFor({ name: 'Alice' }), 'Alice');
  assert.equal(efsp.controllerIdFor({ preferred_username: 'alice.p' }), 'alice.p');
  assert.equal(efsp.controllerIdFor({ sub: 'sub-123' }), 'sub-123');
  assert.equal(efsp.controllerIdFor({}), 'unknown');
});

test('handleMessage end-to-end: a CreateStrip mutation is reflected in boardStore/fdrStore directly', () => {
  const efsp = createEfsp();
  const session = { controllerId: 'c1', who: 'Alice' };
  const result = efsp.handleMessage(session, createStripMsg());
  assert.equal(result.ack.ok, true);
  assert.equal(efsp.boardStore.getAll().length, 1);
  assert.equal(efsp.fdrStore.getAll().length, 1);
});

test('snapshotFor returns a well-formed efsp-snapshot message with all four collections', () => {
  const efsp = createEfsp();
  const snap = efsp.snapshotFor();
  assert.equal(snap.type, 'efsp-snapshot');
  assert.equal(snap.facility, 'INCIRLIK');
  assert.ok(Array.isArray(snap.strips));
  assert.ok(Array.isArray(snap.fdrs));
  assert.ok(Array.isArray(snap.positions));
  assert.ok(Array.isArray(snap.bays));
});

test('onDisconnect releases every Position the controller held', () => {
  const efsp = createEfsp();
  const session = { controllerId: 'c1', who: 'Alice' };
  efsp.handleMessage(session, { type: 'efsp-set-positions', held: ['GND', 'TWR'] });
  assert.equal(efsp.positionStore.isOccupied('GND'), true);

  efsp.onDisconnect(session);
  assert.equal(efsp.positionStore.isOccupied('GND'), false);
  assert.equal(efsp.positionStore.isOccupied('TWR'), false);
});

// ── Persistence — the actual "restart" scenario (ADR 0002) ─────────────────

test('a successful mutation persists to BOARD_SNAPSHOT_PATH, and a freshly constructed efsp instance restores it', () => {
  const efsp1 = createEfsp();
  const session = { controllerId: 'c1', who: 'Alice' };
  const result = efsp1.handleMessage(session, createStripMsg());
  const stripId = result.ack.strip.stripId;

  assert.ok(fs.existsSync(BOARD_SNAPSHOT_PATH));

  // A brand-new createEfsp() call is the closest in-process simulation of
  // an actual process restart: fresh stores, restore() reads from disk.
  const efsp2 = createEfsp();
  const restored = efsp2.boardStore.getStrip(stripId);
  assert.ok(restored);
  assert.equal(restored.ownerPositionId, 'OPS');
  assert.ok(efsp2.fdrStore.getFdr(restored.fdrId));
});

test('a Strip mid-DEPARTED-to-APP-transfer (docs/adr/0007) round-trips correctly across a simulated restart — exactly one owner, no strand', () => {
  const efsp1 = createEfsp();
  const ops = { controllerId: 'ops', who: 'Ops1' };
  const twr = { controllerId: 'twr', who: 'Twr1' };
  const app = { controllerId: 'app', who: 'App1' };
  efsp1.handleMessage(twr, { type: 'efsp-set-positions', held: ['TWR'] });
  efsp1.handleMessage(app, { type: 'efsp-set-positions', held: ['APP'] }); // APP must be occupied for the real, occupancy-gated Hand Off

  const created = efsp1.handleMessage(ops, createStripMsg());
  let strip = created.ack.strip;

  // Jump straight to DEPARTED via SetState (a direct path, independent of
  // InvokeNla per guide §3.5 rule 4 — see board-store.test.mjs's own
  // "SetState is a direct path" test) — this test is about the transfer-
  // shaped NLA step itself, not re-walking every intermediate state
  // (already covered by efsp-nla.test.mjs), and avoids InvokeNla's 400ms
  // double-tap guard across back-to-back real-clock calls.
  const jumped = efsp1.handleMessage(ops, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    actingPositionId: 'OPS', stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'SetState', toState: 'DEPARTED' },
  });
  assert.equal(jumped.ack.ok, true, JSON.stringify(jumped.ack));
  strip = jumped.ack.strip;

  // DEPARTED is TWR's to advance (permission.js's canActOnState), not
  // OPS's — relocate ownership to TWR first. This TransferStrip targets a
  // Bay whose implied state MATCHES the Strip's current state (twr-
  // airborne implies DEPARTED), so it's a same-state hand-off, not an
  // advance, and isn't itself gated by canActOnState (nothing is being
  // advanced here, just handed to the Position whose job the CURRENT
  // state already is).
  const relocated = efsp1.handleMessage(ops, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    actingPositionId: 'OPS', stripId: strip.stripId, baseRev: strip.rev,
    op: { kind: 'TransferStrip', toPositionId: 'TWR', bayId: 'twr-airborne', rackId: 'main' },
  });
  assert.equal(relocated.ack.ok, true, JSON.stringify(relocated.ack));
  strip = relocated.ack.strip;
  assert.equal(strip.ownerPositionId, 'TWR');

  const transferred = efsp1.handleMessage(twr, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    actingPositionId: 'TWR', stripId: strip.stripId, baseRev: strip.rev, op: { kind: 'InvokeNla' },
  });
  assert.equal(transferred.ack.ok, true, JSON.stringify(transferred.ack));
  assert.equal(transferred.ack.strip.ownerPositionId, 'APP');
  assert.equal(transferred.ack.strip.state, 'HANDED_OFF');

  // Simulated restart — fresh stores, restore() reads from disk.
  const efsp2 = createEfsp();
  const restored = efsp2.boardStore.getStrip(strip.stripId);
  assert.ok(restored);
  assert.equal(restored.ownerPositionId, 'APP'); // exactly one owner, unchanged by the restart (D7)
  assert.equal(restored.state, 'HANDED_OFF');
  assert.equal(restored.bayId, 'app-departures');
});

// ── WP4A: cross-Facility HANDOFF survives a restart (docs/adr/0013-0015) ──
// The direct analogue of WP4's own "test with an actual restart"
// acceptance criterion, now for the D13 replication mechanism: a HANDOFF
// interrupted mid-PROPOSE (before ACCEPT) must resolve to a determinate
// state on BOTH replicas after restart — the sender's Strip still shows
// coordination PROPOSED, and the receiver's replica still exists,
// independently, in the receiving Facility's own Board.

function createCtrStripMsg() {
  return {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: 'CENTER', actingPositionId: 'CTR',
    op: {
      kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', role: 'ARRIVAL',
      fdr: { callsign: 'EAGLE1', aircraftType: 'F15', wakeCategory: 'D', originAirport: 'LTAC' },
    },
  };
}

test('a HANDOFF interrupted mid-PROPOSE (before ACCEPT) round-trips both replicas correctly across a simulated restart — each still exists, independently, on its own Facility\'s Board', () => {
  const efsp1 = createEfsp();
  const ctr = { controllerId: 'ctr', who: 'Ctr1' };

  const created = efsp1.handleMessage(ctr, createCtrStripMsg());
  assert.equal(created.ack.ok, true, JSON.stringify(created.ack));
  const senderStrip = created.ack.strip;

  const proposed = efsp1.handleMessage(ctr, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: 'CENTER', actingPositionId: 'CTR', stripId: senderStrip.stripId, baseRev: senderStrip.rev,
    op: { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'APP' },
  });
  assert.equal(proposed.ack.ok, true, JSON.stringify(proposed.ack));
  const receiverStripId = proposed.ack.strip.coordination.peerStripId;

  // Simulated restart — fresh stores, restore() reads from disk. No ACCEPT
  // has happened yet: both replicas should still show PROPOSED.
  const efsp2 = createEfsp();

  const restoredSender = efsp2.boardStoreFor('CENTER').getStrip(senderStrip.stripId);
  assert.ok(restoredSender);
  assert.equal(restoredSender.coordination.state, 'PROPOSED');
  assert.equal(restoredSender.coordination.peerStripId, receiverStripId);

  const restoredReceiver = efsp2.boardStoreFor('INCIRLIK').getStrip(receiverStripId);
  assert.ok(restoredReceiver);
  assert.equal(restoredReceiver.ownerPositionId, 'APP');
  assert.equal(restoredReceiver.bayId, 'app-coordination');
  assert.equal(restoredReceiver.coordination.state, 'PROPOSED');
  assert.equal(restoredReceiver.coordination.peerStripId, senderStrip.stripId);

  // The exchange can still be completed after the restart, exactly as if
  // nothing had happened — no strand, no duplicate, no crash.
  const app = { controllerId: 'app', who: 'App1' };
  const accepted = efsp2.handleMessage(app, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: 'INCIRLIK', actingPositionId: 'APP', stripId: receiverStripId, baseRev: restoredReceiver.rev,
    op: { kind: 'HANDOFF', action: 'ACCEPT' },
  });
  assert.equal(accepted.ack.ok, true, JSON.stringify(accepted.ack));
  assert.equal(accepted.ack.strip.bayId, 'app-inbound');
});

test('a failed mutation does not write a new snapshot', () => {
  const efsp = createEfsp();
  const before = fs.existsSync(BOARD_SNAPSHOT_PATH) ? fs.readFileSync(BOARD_SNAPSHOT_PATH, 'utf8') : null;

  const session = { controllerId: 'c1', who: 'Alice' };
  const badMsg = { ...createStripMsg(), actingPositionId: 'GND' }; // GND may not CreateStrip
  const result = efsp.handleMessage(session, badMsg);
  assert.equal(result.ack.ok, false);

  const after = fs.existsSync(BOARD_SNAPSHOT_PATH) ? fs.readFileSync(BOARD_SNAPSHOT_PATH, 'utf8') : null;
  assert.equal(after, before);
});
