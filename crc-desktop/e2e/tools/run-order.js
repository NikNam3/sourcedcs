#!/usr/bin/env node
'use strict';

/* Runs the Playwright specs in a chosen order against ONE crc-sync + app server pair, or each alone.
 *
 *   node e2e/tools/run-order.js --alone                  each spec file in its own run, own servers
 *   node e2e/tools/run-order.js --shuffle [--seed N]     every file once, shuffled, shared servers
 *   node e2e/tools/run-order.js --order a.spec.js,b.spec.js
 *   --out <file.json>   write the per-file result table (default test-results/run-order-<mode>.json)
 *
 * Playwright always runs files in name order within one invocation, so "shuffled" is one invocation
 * per file, in the given order, against servers this script starts (and stops, by PID) itself, with
 * E2E_REUSE_SERVERS=1. Every file still begins with the reset hook (helpers/test.js), so the shared
 * server is the realistic case: whatever a file leaves behind is what the next file would see
 * if the reset did not exist; with it, the order must not matter.
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

const allFiles = fs.readdirSync(path.join(ROOT, 'e2e')).filter((f) => f.endsWith('.spec.js')).sort();
const only = val('--only', null);
const pool = only ? only.split(',') : allFiles;

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffled(list, seed) { const r = mulberry32(seed); const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const mode = flag('--alone') ? 'alone' : (flag('--order') ? 'order' : 'shuffle');
const seed = Number(val('--seed', 1));
const order = mode === 'order' ? val('--order', '').split(',') : (mode === 'shuffle' ? shuffled(pool, seed) : pool);
const out = val('--out', path.join(ROOT, 'test-results', `run-order-${mode}${mode === 'shuffle' ? '-' + seed : ''}.json`));
fs.mkdirSync(path.dirname(out), { recursive: true });

const children = [];
function stopAll() { for (const c of children) { try { c.kill('SIGTERM'); } catch (_) { /* gone */ } } }
process.on('SIGINT', () => { stopAll(); process.exit(130); });

function waitPort(port, ms) {
  const end = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); resolve(); });
      s.once('error', () => { s.destroy(); if (Date.now() > end) reject(new Error('port ' + port)); else setTimeout(tryOnce, 200); });
    };
    tryOnce();
  });
}

async function startServers() {
  const cfg = require(path.join(ROOT, 'playwright.config.js'));
  for (const w of cfg.webServer) {
    const [cmd, ...a] = w.command.split(' ');
    const c = spawn(cmd, a, { cwd: w.cwd, env: { ...process.env, ...w.env }, stdio: 'ignore' });
    children.push(c);
    await waitPort(w.port, w.timeout);
  }
}

function runFile(file, reuse) {
  const jsonOut = path.join(ROOT, 'test-results', `.run-order-${path.basename(file)}.json`);
  const t0 = Date.now();
  const r = spawnSync('npx', ['playwright', 'test', `e2e/${file}`, '--reporter=json'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, E2E_REUSE_SERVERS: reuse ? '1' : '0' },
  });
  const secs = (Date.now() - t0) / 1000;
  let stats = null;
  try { stats = JSON.parse(r.stdout).stats; } catch (_) { /* crashed before reporting */ }
  const row = { file, status: r.status === 0 ? 'pass' : 'FAIL', seconds: Math.round(secs), expected: stats ? stats.expected : null, unexpected: stats ? stats.unexpected : null, skipped: stats ? stats.skipped : null };
  if (r.status !== 0) fs.writeFileSync(jsonOut, r.stdout || r.stderr || '');
  return row;
}

(async () => {
  const rows = [];
  try {
    if (mode !== 'alone') await startServers();
    for (const f of order) {
      const row = runFile(f, mode !== 'alone');
      rows.push(row);
      console.log(`${String(rows.length).padStart(2)}. ${row.status.padEnd(4)} ${String(row.seconds).padStart(4)}s  ${f}  (${row.expected} ok, ${row.unexpected} failed, ${row.skipped} skipped)`);
      fs.writeFileSync(out, JSON.stringify({ mode, seed, order, rows }, null, 2));
    }
  } finally { stopAll(); }
  const failed = rows.filter((r) => r.status !== 'pass');
  console.log(`\n${rows.length - failed.length}/${rows.length} files green (${mode}${mode === 'shuffle' ? ', seed ' + seed : ''}); total ${rows.reduce((a, r) => a + r.seconds, 0)}s`);
  process.exit(failed.length ? 1 : 0);
})();
