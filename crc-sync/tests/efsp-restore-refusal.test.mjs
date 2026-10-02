import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ARCH-D5 / H88: no restore migrations. A snapshot the build does not know is a startup error, not an empty Board.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-ovf-mig-'));
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
const { crew, mustAct } = await import('./helpers/efsp-scenario.mjs');

const file = process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH;

// The failed start throws out of createEfsp and writes nothing: the file is byte-identical afterwards, so the
// operator can still read what it held (an empty Board persisted over it would destroy it).
function assertRefusedUntouched(start, pattern) {
  const before = fs.readFileSync(file);
  assert.throws(start, pattern);
  assert.ok(before.equals(fs.readFileSync(file)), 'the snapshot file is unchanged after the refused start');
}

function savedBoard() {
  fs.rmSync(file, { force: true });
  const first = createEfsp();
  const c = crew(first, { CTR: 'CENTER' });
  const strip = mustAct(first, c.CTR, 'CTR', null, {
    kind: 'CreateStrip', bayId: 'ctr-overflight', rackId: 'main', role: 'OVERFLIGHT',
    fdr: { callsign: 'OLD1', aircraftType: 'A320', wakeCategory: 'M', originAirport: 'LTBA', destinationAirport: 'OJAI' },
  });
  return { strip, body: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

test('no snapshot file is a first run: an empty Board, no error', () => {
  fs.rmSync(file, { force: true });
  assert.equal(createEfsp().boardStoreFor('CENTER').getAll().length, 0);
});

test('a valid snapshot restores', () => {
  const { strip } = savedBoard();
  assert.equal(createEfsp().boardStoreFor('CENTER').getStrip(strip.stripId).state, 'INBOUND');
});

test('an OVERFLIGHT Strip saved as TRANSITING (before docs/adr/0087) stops start-up, naming the Strip and state', () => {
  const { strip, body } = savedBoard();
  body.boards.CENTER.strips.find(s => s.stripId === strip.stripId).state = 'TRANSITING';
  fs.writeFileSync(file, JSON.stringify(body));
  assertRefusedUntouched(() => createEfsp(), new RegExp(`${strip.stripId}.*TRANSITING`));
});

test('the pre-WP4A snapshot shape (a top-level board) stops start-up', () => {
  const { body } = savedBoard();
  const old = { fdr: body.fdr, board: body.boards.CENTER };
  fs.writeFileSync(file, JSON.stringify(old));
  assertRefusedUntouched(() => createEfsp(), /pre-WP4A shape/);
});

test('a Board for a Facility this server does not have stops start-up', () => {
  const { body } = savedBoard();
  body.boards.NOWHERE = { strips: [], cidSeq: 0 };
  fs.writeFileSync(file, JSON.stringify(body));
  assertRefusedUntouched(() => createEfsp(), /"NOWHERE".*not a configured Facility/);
});

test('a snapshot that is not JSON stops start-up', () => {
  fs.writeFileSync(file, '{"boards":');
  assertRefusedUntouched(() => createEfsp(), /not valid JSON/);
});

test('a Strip whose assigned altitude is still a Strip annotation (before docs/adr/0058) stops start-up', () => {
  const { strip, body } = savedBoard();
  const saved = body.boards.CENTER.strips.find(s => s.stripId === strip.stripId);
  saved.annotations = { '7A': { blockId: '7A', entries: [{ value: '350', status: 'ACTIVE', at: 1, by: 'cd' }] } };
  fs.writeFileSync(file, JSON.stringify(body));
  assertRefusedUntouched(() => createEfsp(), new RegExp(`${strip.stripId}.*annotations \\(Block 7A`));
});
