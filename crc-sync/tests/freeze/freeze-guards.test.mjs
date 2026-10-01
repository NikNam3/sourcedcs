import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HERE, checkGolden } from './freeze-lib.mjs';

// Three guards a refactor of board-store.js / index.js must not trip silently:
//  1. wiring completeness: every `this._rules.<name>` board-store reads is supplied for EVERY Facility;
//  2. the Board's external surface: which of its members are used from outside the file;
//  3. the wall-clock sites: where Date.now() / new Date() is read under src/efsp (ADR 0079, H11).
// 2 and 3 are frozen as data; the failure text says what to do.

const CRC_SYNC = path.resolve(HERE, '../..');
const SRC = path.join(CRC_SYNC, 'src');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze-guard-'));
Object.assign(process.env, {
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: path.join(tmp, 'incirlik.json'),
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: path.join(tmp, 'center.json'),
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: path.join(tmp, 'tactical.json'),
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: path.join(tmp, 'board.json'),
  CRCSYNC_EFSP_MUTATION_LOG_PATH: path.join(tmp, 'mutations.jsonl'),
  CRCSYNC_EFSP_AIRSPACES_PATH: path.join(tmp, 'airspaces.json'),
});
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');

const { createEfsp } = await import('../../src/efsp/index.js');
const facilityConfig = await import('../../src/efsp/facility-config.js');
const { BoardStore } = await import('../../src/efsp/board-store.js');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'out' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(c|m)?js$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(CRC_SYNC, p);
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

/** Board-store source: board-store.js plus any src/efsp/board/** file a refactor splits out of it. */
const boardSources = () => [path.join(SRC, 'efsp/board-store.js'), ...(fs.existsSync(path.join(SRC, 'efsp/board')) ? walk(path.join(SRC, 'efsp/board')) : [])];

test('freeze guard 1: every rule board-store reads is wired for every Facility', () => {
  const read = new Set();
  for (const f of boardSources()) for (const m of stripComments(fs.readFileSync(f, 'utf8')).matchAll(/this\._rules\.([A-Za-z_]\w*)/g)) read.add(m[1]);
  assert.ok(read.size >= 40, `expected to find the rule names board-store reads (found ${read.size})`);
  const efsp = createEfsp();
  const gaps = [];
  for (const facilityId of facilityConfig.getFacilityIds()) {
    const rules = efsp.boardStoreFor(facilityId)._rules;
    for (const name of read) if (!(name in rules)) gaps.push(`${facilityId}: ${name}`);
  }
  assert.deepEqual(gaps, [], 'a rule board-store reads is missing from createEfsp()\'s per-Facility `rules`: that check is silently OFF in production (index.js)');
});

test('freeze guard 2: the Board\'s external surface', () => {
  const own = fs.readFileSync(path.join(SRC, 'efsp/board-store.js'), 'utf8');
  const proto = Object.getOwnPropertyNames(BoardStore.prototype).filter(n => n !== 'constructor');
  const publicNames = proto.filter(n => !n.startsWith('_'));
  const outside = [...walk(SRC), path.join(CRC_SYNC, 'server.js'), ...walk(path.join(CRC_SYNC, 'tools'))]
    .filter(f => !boardSources().includes(f) && fs.existsSync(f));
  const outsideText = new Map(outside.map(f => [f, stripComments(fs.readFileSync(f, 'utf8'))]));
  const usedFromOutside = publicNames.filter(n => [...outsideText.values()].some(t => new RegExp(`\\.${n}\\b`).test(t))).sort();

  // Private members reached from outside the file (src, tools, tests): they are API in practice.
  const efsp = createEfsp();
  const instance = efsp.boardStoreFor('INCIRLIK');
  const members = new Set([...proto.filter(n => n.startsWith('_')), ...Object.getOwnPropertyNames(instance).filter(n => n.startsWith('_'))]);
  const testsDir = path.join(CRC_SYNC, 'tests');
  const seekers = [...outside, ...fs.readdirSync(testsDir).filter(f => /\.(test\.)?m?js$/.test(f)).map(f => path.join(testsDir, f))];
  const reached = new Map();
  for (const f of seekers) {
    const t = outsideText.get(f) || stripComments(fs.readFileSync(f, 'utf8'));
    for (const n of members) if (new RegExp(`\\.${n}\\b`).test(t)) { if (!reached.has(n)) reached.set(n, new Set()); reached.get(n).add(f.startsWith(testsDir) ? 'tests' : rel(f).split('/')[0]); }
  }
  const privateUsed = [...reached.entries()].map(([n, w]) => ({ id: n, usedBy: [...w].sort() })).sort((a, b) => a.id.localeCompare(b.id));
  for (const { id } of privateUsed) assert.ok(id in instance, `${id} is reached from outside board-store.js but no longer exists on a BoardStore: a refactor must keep this name, or update this list in the same commit and say why`);

  checkGolden(assert, 'guard-board-surface', {
    rows: [
      { id: 'public methods used from outside board-store.js (src, server.js, tools)', v: usedFromOutside },
      { id: 'all public methods', v: publicNames.sort() },
      { id: 'private members reached from outside the file, and by whom', v: privateUsed },
    ],
  }, (d) => d.rows.map(r => [r.id, r]));
  assert.ok(own.length > 0);
});

test('freeze guard 3: Date.now() / new Date() sites under src/efsp', () => {
  const sites = [];
  for (const f of walk(path.join(SRC, 'efsp')).sort()) {
    const text = stripComments(fs.readFileSync(f, 'utf8'));
    const nowCalls = (text.match(/Date\.now\b/g) || []).length;
    const bareDates = (text.match(/new Date\(\s*\)/g) || []).length;
    if (nowCalls || bareDates) sites.push({ id: rel(f), dateNow: nowCalls, newDateBare: bareDates });
  }
  checkGolden(assert, 'guard-wall-clock', { rows: sites }, (d) => d.rows.map(r => [r.id, r]));
});
