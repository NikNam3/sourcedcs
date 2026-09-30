import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// L14 (docs/adr/0071) — the two ATO wire messages: session binding per
// Facility, TAC_C2 only, refusals that never throw, idempotent replays and the
// audit entry.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-ws-ato-'));
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
const { handleMessage } = await import('../src/efsp/efsp-ws.js');
const { crew } = await import('./helpers/efsp-scenario.mjs');

const IRON = fs.readFileSync(new URL('./fixtures/ato/iron-flag-26-3.txt', import.meta.url), 'utf8');
const efsp = createEfsp();
const c = crew(efsp, { TAC_C2: 'TACTICAL', GCI: 'TACTICAL', OPS: 'INCIRLIK' });

function preview(member, positionId, text = IRON) {
  return efsp.handleMessage(member.session, { version: 1, type: 'efsp-ato-preview', requestId: crypto.randomUUID(), actingPositionId: positionId, text }).ack;
}
function importAto(member, positionId, { text = IRON, textSha1, choices = [], clientMutationId = crypto.randomUUID() } = {}) {
  return efsp.handleMessage(member.session, {
    version: 1, type: 'efsp-ato-mutation', clientMutationId, facilityId: 'TACTICAL', actingPositionId: positionId,
    op: { kind: 'ImportAto', text, textSha1, choices },
  });
}
function logLines() {
  const f = process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH;
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}

test('not Primary at TACTICAL → NOT_HOLDING_POSITION, for the preview and the import', () => {
  const stranger = { session: { controllerId: 'nobody' }, facilityId: 'TACTICAL' };
  assert.equal(preview(stranger, 'TAC_C2').reason, 'NOT_HOLDING_POSITION');
  assert.equal(importAto(stranger, 'TAC_C2').ack.reason, 'NOT_HOLDING_POSITION');
  // OPS is Primary — but at INCIRLIK, and naming TAC_C2 does not make it TAC_C2's.
  assert.equal(preview(c.OPS, 'TAC_C2').reason, 'NOT_HOLDING_POSITION');
});

test('GCI is refused: only TAC_C2 imports an ATO', () => {
  const p = preview(c.GCI, 'GCI');
  assert.equal(p.ok, false);
  assert.equal(p.reason, 'PERMISSION_DENIED');
  assert.match(p.detail, /TAC_C2/);
  assert.equal(importAto(c.GCI, 'GCI').ack.reason, 'PERMISSION_DENIED');
});

test('a context with no stores refuses cleanly, never throws', () => {
  const session = { controllerId: 'x' };
  for (const ctx of [{}, { fdrStore: null, boardStoreFor: () => null, positionStoreFor: () => null }]) {
    const p = handleMessage(ctx, session, { type: 'efsp-ato-preview', actingPositionId: 'TAC_C2', text: IRON }, () => {});
    assert.equal(p.ack.ok, false);
    assert.equal(p.ack.reason, 'VALIDATION_ERROR');
    const m = handleMessage(ctx, session, { type: 'efsp-ato-mutation', clientMutationId: 'a', actingPositionId: 'TAC_C2', op: { kind: 'ImportAto', text: IRON } }, () => {});
    assert.equal(m.ack.ok, false);
  }
});

test('the preview is read-only and answers the sender only', () => {
  const before = efsp.boardStoreFor('TACTICAL').currentSeq;
  const res = efsp.handleMessage(c.TAC_C2.session, { version: 1, type: 'efsp-ato-preview', requestId: 'r1', actingPositionId: 'TAC_C2', text: IRON });
  assert.equal(res.ack.type, 'efsp-ato-preview-result');
  assert.equal(res.ack.requestId, 'r1');
  assert.equal(res.ack.ok, true);
  assert.equal(res.ack.preview.lines.length, 5);
  assert.equal(res.broadcast, undefined);
  assert.equal(efsp.boardStoreFor('TACTICAL').currentSeq, before);
  assert.ok(!logLines().some((l) => l.type === 'efsp-ato-preview'), 'never logged');
});

test('empty and oversized text are refused before parsing', () => {
  assert.equal(preview(c.TAC_C2, 'TAC_C2', '   ').reason, 'VALIDATION_ERROR');
  const big = preview(c.TAC_C2, 'TAC_C2', 'x'.repeat(1024 * 1024 + 1));
  assert.equal(big.reason, 'VALIDATION_ERROR');
  assert.match(big.detail, /1 MiB/);
});

test('a text that changed since the preview is STALE_REV, and is audited', () => {
  const r = importAto(c.TAC_C2, 'TAC_C2', { textSha1: 'f'.repeat(40), clientMutationId: 'stale-1' });
  assert.equal(r.ack.ok, false);
  assert.equal(r.ack.reason, 'STALE_REV');
  const entry = logLines().find((l) => l.clientMutationId === 'stale-1');
  assert.equal(entry.op, 'ImportAto');
  assert.equal(entry.ok, false);
  assert.equal(entry.reason, 'STALE_REV');
});

test('an import creates the lines, broadcasts one delta, audits once; a replay creates nothing twice', () => {
  const p = preview(c.TAC_C2, 'TAC_C2');
  const before = efsp.boardStoreFor('TACTICAL').getAll().filter((s) => s.role === 'MISSION').length;
  const cmid = crypto.randomUUID();
  const first = importAto(c.TAC_C2, 'TAC_C2', { textSha1: p.preview.textSha1, clientMutationId: cmid });
  assert.equal(first.ack.type, 'efsp-ato-ack');
  assert.equal(first.ack.ok, true);
  assert.equal(first.ack.results.length, 5);
  assert.ok(first.ack.results.every((r) => r.ok && r.action === 'CREATE' && r.stripId), JSON.stringify(first.ack.results));
  assert.equal(first.broadcast.type, 'efsp-board-delta');
  assert.equal(first.broadcast.facilityId, 'TACTICAL');
  assert.equal(first.broadcast.strips.updated.length, 5);
  assert.equal(first.broadcast.fdrs.updated.length, 5);
  assert.equal(first.peerBroadcast, undefined);
  assert.equal(first.marsaBroadcast, undefined);
  const after = efsp.boardStoreFor('TACTICAL').getAll().filter((s) => s.role === 'MISSION').length;
  assert.equal(after - before, 5);

  const replay = importAto(c.TAC_C2, 'TAC_C2', { textSha1: p.preview.textSha1, clientMutationId: cmid });
  assert.deepEqual(replay.ack, first.ack, 'the first ack, verbatim');
  assert.equal(replay.broadcast, undefined);
  assert.equal(efsp.boardStoreFor('TACTICAL').getAll().filter((s) => s.role === 'MISSION').length, after);

  const audits = logLines().filter((l) => l.clientMutationId === cmid);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].ok, true);
  assert.equal(audits[0].lines.length, 5);
  assert.equal(audits[0].textSha1, p.preview.textSha1);
  assert.equal(audits[0].text, undefined, 'never the full text');
  // Each line went through the ordinary CreateStrip path and is audited as one.
  assert.equal(logLines().filter((l) => typeof l.clientMutationId === 'string' && l.clientMutationId.startsWith(`${cmid}#`)).length, 5);
});

test('re-importing the same ATO previews UPDATE for every line and creates no Strip', () => {
  const p = preview(c.TAC_C2, 'TAC_C2');
  assert.deepEqual(p.preview.lines.map((l) => l.action), ['UPDATE', 'UPDATE', 'UPDATE', 'UPDATE', 'UPDATE']);
  const before = efsp.boardStoreFor('TACTICAL').currentSeq;
  const r = importAto(c.TAC_C2, 'TAC_C2', { textSha1: p.preview.textSha1 });
  assert.ok(r.ack.results.every((x) => x.ok && x.action === 'UPDATE'));
  assert.equal(r.broadcast.strips.updated.length, 0);
  assert.equal(r.broadcast.fdrs.updated.length, 5);
  assert.equal(efsp.boardStoreFor('TACTICAL').currentSeq, before);
});
