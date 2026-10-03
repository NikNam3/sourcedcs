// Preloaded by every crc-sync test process (`--import` in package.json: test, freeze, freeze:update, freeze:selfcheck,
// soak:selfcheck). Three jobs:
//  1. an empty state/ directory unless the test sets CRCSYNC_STATE_DIR itself (a test that builds the EFSP without
//     overriding every path would otherwise read and write the checkout's real crc-sync/state/);
//  2. a per-process TMPDIR root, removed on exit: os.tmpdir() reads TMPDIR at call time, so every test's mkdtemp
//     lands inside it and nothing is left in /tmp (child processes inherit it);
//  3. a guard: if the checkout's real crc-sync/state/ changed during the run, exit non-zero and say which files.
//     Opt out with CRCSYNC_ALLOW_STATE_WRITES=1 (e.g. a live dev server runs from the same checkout).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const realState = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../state');

function snapshot(dir, out = new Map()) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { snapshot(p, out); continue; }
    try { const s = fs.statSync(p); out.set(p, `${s.mtimeMs}:${s.size}`); } catch {}
  }
  return out;
}

const root = process.env.CRCSYNC_TMP_ROOT_OWNER ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'crcsync-test-'));
if (root) {
  process.env.TMPDIR = root;
  process.env.CRCSYNC_TMP_ROOT_OWNER = String(process.pid);
}
if (!process.env.CRCSYNC_STATE_DIR) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'crcsync-test-state-'));
  process.env.CRCSYNC_STATE_DIR = dir;
}

const guard = !process.env.CRCSYNC_ALLOW_STATE_WRITES;
const before = guard ? snapshot(realState) : null;

process.on('exit', () => {
  if (before) {
    const after = snapshot(realState);
    const changed = [];
    for (const [p, v] of after) if (before.get(p) !== v) changed.push(p);
    for (const p of before.keys()) if (!after.has(p)) changed.push(`${p} (deleted)`);
    if (changed.length) {
      process.stderr.write(`\nisolate-state: a test touched the real crc-sync/state/ :\n  ${changed.join('\n  ')}\n`);
      process.exitCode = 1;
    }
  }
  if (root) { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} }
});
