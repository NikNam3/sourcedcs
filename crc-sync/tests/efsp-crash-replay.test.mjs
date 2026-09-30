import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// docs/adr/0081 (L27), L6's F5: a Mutation survives a crash exactly once.
//
// A "restart" here is a second createEfsp() over the same snapshot and log
// paths, which is exactly what a new process does at boot. A crash inside
// _persist is simulated the way tools/soak/host-env.js does it: the write of
// the snapshot's sibling file throws, and _persist's own catch swallows it,
// so the audit line exists and the snapshot does not.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-crash-replay-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
  CRCSYNC_EFSP_TRAFFIC_COUNT_PATH: 'traffic-count.jsonl',
  CRCSYNC_EFSP_INSTRUMENTATION_CONFIG_PATH: 'instrumentation.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');

const { createEfsp } = await import('../src/efsp/index.js');
const { BoardStore, REPLAY_PERSIST_WINDOW_MS } = await import('../src/efsp/board-store.js');
const { FdrStore } = await import('../src/efsp/fdr-store.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const { TrafficCount, reconcileTrafficCount } = await import('../src/efsp/traffic-count.js');
const { crew, DEPARTURE_FDR } = await import('./helpers/efsp-scenario.mjs');

const SNAPSHOT_TMP = `${process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH}.tmp`;

/** Runs fn with the snapshot write failing, the way a crash inside _persist leaves things. */
function crashingPersist(fn) {
  const orig = fs.writeFileSync;
  const origWarn = console.warn;
  fs.writeFileSync = function (file, ...rest) {
    if (file === SNAPSHOT_TMP) throw new Error('simulated crash before persist');
    return orig.call(fs, file, ...rest);
  };
  console.warn = () => {};
  try { return fn(); } finally { fs.writeFileSync = orig; console.warn = origWarn; }
}

/** A new process over the same files. */
function restart() {
  const origWarn = console.warn;
  console.warn = () => {};
  try { return createEfsp(); } finally { console.warn = origWarn; }
}

function linesFor(efsp, cmid) { return efsp.mutationLog.readAll().filter(e => e.clientMutationId === cmid); }
function effective(lines) { return lines.filter(e => e.op !== 'NotPersisted').length - lines.filter(e => e.op === 'NotPersisted').length; }

function createMsg(callsign, cmid = crypto.randomUUID()) {
  return {
    version: 1, type: 'efsp-mutation', clientMutationId: cmid, facilityId: 'INCIRLIK', actingPositionId: 'OPS',
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign } },
  };
}

function stripOp(strip, op, cmid = crypto.randomUUID()) {
  return {
    version: 1, type: 'efsp-mutation', clientMutationId: cmid, facilityId: 'INCIRLIK', actingPositionId: 'OPS',
    stripId: strip.stripId, baseRev: strip.rev, op,
  };
}

test('a CreateStrip whose ack died with the process is not created twice on retry', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK' });
  const msg = createMsg('CRASHA1');
  const first = efsp.handleMessage(c.OPS.session, msg);
  assert.equal(first.ack.ok, true);
  // The ack never reached the client; the process dies; a new one boots.

  const efsp2 = restart();
  const c2 = crew(efsp2, { OPS: 'INCIRLIK' });
  const retry = efsp2.handleMessage(c2.OPS.session, JSON.parse(JSON.stringify(msg)));
  assert.equal(retry.ack.ok, true, 'the retry is answered, as a success');
  assert.equal(retry.ack.strip.stripId, first.ack.strip.stripId, 'with the Strip it created the first time');
  assert.equal(retry.broadcast, undefined, 'a replay broadcasts nothing');
  const named = efsp2.boardStore.getAll().filter(s => efsp2.fdrStore.getFdr(s.fdrId).identity.callsign === 'CRASHA1');
  assert.equal(named.length, 1, 'one Strip, not two');
  assert.equal(linesFor(efsp2, msg.clientMutationId).length, 1, 'and one audit line');
});

test('a Mutation audited but never persisted gets a NotPersisted marker at boot, and its retry is audited once', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK' });
  const strip = efsp.handleMessage(c.OPS.session, createMsg('CRASHB1')).ack.strip;
  const msg = stripOp(strip, { kind: 'SetFlag', flag: 'attention', value: true });
  const r = crashingPersist(() => efsp.handleMessage(c.OPS.session, msg));
  assert.equal(r.ack.ok, true);
  assert.equal(linesFor(efsp, msg.clientMutationId).length, 1, 'the audit line was written before the crash');

  const efsp2 = restart();
  const restored = efsp2.boardStore.getStrip(strip.stripId);
  assert.equal(restored.rev, strip.rev, 'the change never reached the snapshot');
  const afterBoot = linesFor(efsp2, msg.clientMutationId);
  assert.deepEqual(afterBoot.map(e => e.op), ['SetFlag', 'NotPersisted']);
  const marker = afterBoot[1];
  assert.equal(marker.voids, 'SetFlag');
  assert.equal(marker.reason, 'CRASH_BEFORE_PERSIST');
  assert.equal(marker.stripId, strip.stripId);
  assert.equal(marker.actorId, 'system');
  assert.equal(effective(afterBoot), 0);

  const c2 = crew(efsp2, { OPS: 'INCIRLIK' });
  const retry = efsp2.handleMessage(c2.OPS.session, JSON.parse(JSON.stringify(msg)));
  assert.equal(retry.ack.ok, true);
  assert.equal(retry.ack.strip.rev, strip.rev + 1);
  assert.equal(effective(linesFor(efsp2, msg.clientMutationId)), 1, 'one effective audit line for one change');

  // A second boot marks nothing again: the retry is persisted, the first line already voided.
  const efsp3 = restart();
  assert.equal(linesFor(efsp3, msg.clientMutationId).filter(e => e.op === 'NotPersisted').length, 1);
});

test('a dropped Strip whose drop was never persisted is voided in the traffic count', () => {
  const efsp = createEfsp();
  const facilityIds = facilityConfig.getFacilityIds();
  const counter = new TrafficCount({ mutationLog: efsp.mutationLog, fdrStore: efsp.fdrStore, boardStoreFor: efsp.boardStoreFor, facilityIds });
  const c = crew(efsp, { OPS: 'INCIRLIK' });
  const strip = efsp.handleMessage(c.OPS.session, createMsg('CRASHC1')).ack.strip;
  const drop = stripOp(strip, { kind: 'DropStrip' });
  const r = crashingPersist(() => efsp.handleMessage(c.OPS.session, drop));
  assert.equal(r.ack.ok, true, JSON.stringify(r.ack));
  assert.equal(counter.records().filter(x => x.stripId === strip.stripId).length, 1, 'the live listener counted the drop');
  counter.close();

  const efsp2 = restart();
  assert.notEqual(efsp2.boardStore.getStrip(strip.stripId).state, 'DROPPED', 'the Strip came back live');
  const counter2 = new TrafficCount({ mutationLog: efsp2.mutationLog, fdrStore: efsp2.fdrStore, boardStoreFor: efsp2.boardStoreFor, facilityIds });
  assert.equal(counter2.records().filter(x => x.stripId === strip.stripId).length, 0, 'the drop that never took effect is voided');
  assert.equal(counter2.lastReconciliation().ok, true, JSON.stringify(counter2.lastReconciliation()));

  // The client's retry applies the drop, and it is counted once.
  const c2 = crew(efsp2, { OPS: 'INCIRLIK' });
  const retry = efsp2.handleMessage(c2.OPS.session, JSON.parse(JSON.stringify(drop)));
  assert.equal(retry.ack.ok, true);
  assert.equal(counter2.records().filter(x => x.stripId === strip.stripId).length, 1);
  const recon = reconcileTrafficCount(efsp2.mutationLog.readAll(), counter2.entries());
  assert.equal(recon.ok, true, JSON.stringify(recon));
  counter2.close();

  // And a later boot does not void the retried drop a second time.
  const efsp3 = restart();
  const counter3 = new TrafficCount({ mutationLog: efsp3.mutationLog, fdrStore: efsp3.fdrStore, boardStoreFor: efsp3.boardStoreFor, facilityIds });
  assert.equal(counter3.records().filter(x => x.stripId === strip.stripId).length, 1);
  counter3.close();
});

test('the replay window forgets entries older than 10 minutes', () => {
  const realNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  try {
    const board = new BoardStore(new FdrStore(), {});
    const create = (callsign) => board.applyMutation({
      clientMutationId: `cm-${callsign}`,
      op: { kind: 'CreateStrip', bayId: 'proposed', rackId: 'main', fdr: { ...DEPARTURE_FDR, callsign } },
    }, 'OPS', 'OPS');
    assert.equal(create('OLD1').ok, true);
    now += REPLAY_PERSIST_WINDOW_MS + 1000;
    assert.equal(create('NEW1').ok, true);
    const snap = board.snapshot();
    assert.deepEqual(snap.replay.map(([cmid]) => cmid), ['cm-NEW1']);
    assert.equal(REPLAY_PERSIST_WINDOW_MS, 10 * 60 * 1000);

    const restored = new BoardStore(new FdrStore(), {});
    restored.restore(JSON.parse(JSON.stringify(snap)));
    assert.equal(restored.hasApplied('cm-NEW1'), true);
    assert.equal(restored.hasApplied('cm-OLD1'), false);
  } finally { Date.now = realNow; }
});

test('a covering-chain reassignment persists the Board', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK' });
  const strip = efsp.handleMessage(c.OPS.session, createMsg('VACATE1')).ack.strip;
  // Hand it to CD without walking the lifecycle: this test is about what a
  // vacated Position's reassignment leaves on disk, not about the transfer.
  efsp.boardStore.getStrip(strip.stripId).ownerPositionId = 'CD';
  efsp.persist();
  const beforeText = fs.readFileSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, 'utf8');
  // CD walks away: its Strips go down the covering chain.
  const out = efsp.handleMessage(c.CD.session, { type: 'efsp-set-positions', facilityId: 'INCIRLIK', held: [] });
  const moved = out.ack.warnings.find(w => w.positionId === 'CD');
  assert.ok(moved && moved.routedTo, JSON.stringify(out.ack));
  assert.notEqual(fs.readFileSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, 'utf8'), beforeText, 'the snapshot was rewritten');
  const efsp2 = restart();
  assert.equal(efsp2.boardStore.getStrip(strip.stripId).ownerPositionId, moved.routedTo, 'the reassignment survives a restart');
});

test('the snapshot is written compact, and not rewritten when nothing changed', () => {
  const realNow = Date.now;
  try {
    const efsp = createEfsp();
    const c = crew(efsp, { OPS: 'INCIRLIK' });
    assert.equal(efsp.handleMessage(c.OPS.session, createMsg('CMPCT1')).ack.ok, true);
    const text = fs.readFileSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, 'utf8');
    assert.ok(!text.includes('\n'), 'no pretty-printing');
    const data = JSON.parse(text);
    assert.ok(Number.isFinite(data.persistedWallAt));
    assert.ok(data.boards.INCIRLIK.replay.length >= 1);
    // Nothing changed: the file, persistedWallAt included, stays as it is.
    let later = realNow() + 5000;
    Date.now = () => later;
    efsp.persist();
    assert.equal(fs.readFileSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, 'utf8'), text);
    // A change is written.
    assert.equal(efsp.handleMessage(c.OPS.session, createMsg('CMPCT2')).ack.ok, true);
    const after = JSON.parse(fs.readFileSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, 'utf8'));
    assert.equal(after.persistedWallAt, later);
    later += 1;
  } finally { Date.now = realNow; }
});
