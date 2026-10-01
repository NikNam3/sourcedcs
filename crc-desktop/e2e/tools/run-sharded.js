#!/usr/bin/env node
'use strict';

/* Runs the Playwright suite in parallel shards, one E2E_LANE each.
 *
 *   node e2e/tools/run-sharded.js [--shards N] [--lanes 7,8,9,5,6] [--only a.spec.js,b.spec.js]
 *                                 [--rerun-failed] [--no-record] [--timings <file>] [--out <file.json>]
 *
 * Each shard is one `playwright test <its files>` process on its own E2E_LANE. playwright.config.js
 * already derives everything from the lane (crc-sync on 3010+lane, the app on 3110+lane, a private
 * mkdtemp state dir, test-results/lane<n>), and starts and stops its own servers, so shards share
 * nothing. Lanes are 0-9 (the config's range). Default lanes are 7,8,9,5,6: 1-4 belong to the client
 * refactor lanes; use --lanes to pass the ones the supervisor names. --shards defaults to the number of
 * lanes; more shards than lanes is an error, more lanes than shards uses the first N.
 *
 * Split: longest-processing-time first onto the least-loaded shard, by the measured seconds per spec in
 * e2e/tools/spec-timings.json (rewritten after every run for the files that ran); with no timing for
 * a spec it balances by that spec's test count (`playwright test --list`).
 *
 * Processes: every child is started in its own process group and stopped by PID (the group, so the
 * browser and the two servers Playwright started go with it), on exit, Ctrl-C, SIGTERM and a crashed
 * shard. Nothing is found by name and nothing on :3000 is touched.
 *
 * --rerun-failed: after the shards finish, each failed test is re-run ALONE, serially, on the first lane
 * (`e2e/<file> -g <title>`), and reported as consistent (fails again) or flaky/load-sensitive (passes alone).
 * The exit code is 1 only for a failure that is consistent, or for any failure when --rerun-failed is off.
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_LANES = [7, 8, 9, 5, 6];
const DEFAULT_TIMINGS = path.join(__dirname, 'spec-timings.json');

/* ---------- pure parts (tests/run-sharded.test.js) ---------- */

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* files: spec file names. timings: { file: seconds }. counts: { file: number of tests }. Returns an array of `n` shards:
 * [{ files: [...], weight }], each file list in name order (Playwright runs files in name order anyway). */
function splitShards(files, n, timings = {}, counts = {}) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`shards must be a positive integer, got ${n}`);
  const has = (f) => Number.isFinite(timings[f]) && timings[f] > 0;
  const known = files.filter(has);
  // A spec with no timing is weighted by its test count: at the median seconds-per-test of the specs
  // that have one, or at one unit per test when nothing has a timing (a split by test count; a split by
  // file count when counts are missing too: a spec counts as one test).
  const n_ = (f) => (Number.isFinite(counts[f]) && counts[f] > 0 ? counts[f] : 1);
  const perTest = known.length ? median(known.map((f) => timings[f] / n_(f))) : 1;
  const weightOf = (f) => (has(f) ? timings[f] : n_(f) * perTest);
  const shards = Array.from({ length: n }, () => ({ files: [], weight: 0 }));
  const order = [...files].sort((a, b) => weightOf(b) - weightOf(a) || (a < b ? -1 : 1));
  for (const f of order) {
    let best = shards[0];
    for (const s of shards) if (s.weight < best.weight) best = s;
    best.files.push(f);
    best.weight += weightOf(f);
  }
  for (const s of shards) s.files.sort();
  return shards.filter((s) => s.files.length);
}

/* Flatten a Playwright JSON report into one row per test:
 * { file, title, line, status: 'passed'|'failed'|'flaky'|'skipped', seconds, error }. */
function parseReport(report) {
  const rows = [];
  const walk = (suite, fileHint) => {
    const file = suite.file || fileHint;
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        const results = t.results || [];
        const seconds = results.reduce((a, r) => a + (r.duration || 0), 0) / 1000;
        const status = t.status === 'expected' ? 'passed' : t.status === 'unexpected' ? 'failed'
          : t.status === 'flaky' ? 'flaky' : 'skipped';
        const err = status === 'failed' || status === 'flaky'
          ? (results.map((r) => r.error && r.error.message).find(Boolean) || '').split('\n')[0] : '';
        rows.push({ file: path.basename(spec.file || file), title: spec.title, line: spec.line, status, seconds, error: err });
      }
    }
    for (const s of suite.suites || []) walk(s, file);
  };
  for (const s of (report && report.suites) || []) walk(s, s.file);
  return rows;
}

/* shardResults: [{ lane, files, exitCode, rows, seconds, crashed }]. */
function mergeSummary(shardResults) {
  const rows = shardResults.flatMap((s) => s.rows.map((r) => ({ ...r, lane: s.lane })));
  const perSpec = {};
  for (const r of rows) {
    const e = perSpec[r.file] || (perSpec[r.file] = { file: r.file, passed: 0, failed: 0, flaky: 0, skipped: 0, seconds: 0, lane: r.lane });
    e[r.status] += 1;
    e.seconds += r.seconds;
  }
  const ranFiles = new Set(rows.map((r) => r.file));
  const missing = [];
  for (const s of shardResults) for (const f of s.files) if (!ranFiles.has(f)) missing.push({ file: f, lane: s.lane });
  const count = (st) => rows.filter((r) => r.status === st).length;
  return {
    totals: { tests: rows.length, passed: count('passed'), failed: count('failed'), flaky: count('flaky'), skipped: count('skipped') },
    perSpec: Object.values(perSpec).sort((a, b) => (a.file < b.file ? -1 : 1)),
    failures: rows.filter((r) => r.status === 'failed'),
    flakies: rows.filter((r) => r.status === 'flaky'),
    // a file that produced no result rows: its shard crashed, or the file failed to load
    missing,
    crashedLanes: shardResults.filter((s) => s.crashed).map((s) => s.lane),
  };
}

/* New timing table: previous values overlaid with the fresh per-file durations (only files that ran). */
function updateTimings(previous, perSpec) {
  const out = { ...previous };
  for (const s of perSpec) if (s.seconds > 0) out[s.file] = Math.round(s.seconds * 10) / 10;
  return out;
}

// By title, not file:line: tests generated in a loop (the popover specs) share one line, and a line selects them all.
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rerunTargets = (row) => [`e2e/${row.file}`, '-g', escapeRe(row.title)];
const rerunCommand = (lane, row) => `E2E_LANE=${lane} npx playwright test e2e/${row.file} -g '${escapeRe(row.title)}'`;

module.exports = { rerunTargets, splitShards, parseReport, mergeSummary, updateTimings, rerunCommand, median, DEFAULT_LANES };

/* ---------- process handling ---------- */

let interrupted = false; // Ctrl-C or SIGTERM: no timings recorded, no re-runs
const live = new Set(); // child processes this script started

function killGroup(c, sig) {
  try { process.kill(-c.pid, sig); } catch (_) { try { c.kill(sig); } catch (__) { /* gone */ } }
}

/* Playwright starts its webServers (crc-sync's supervisor, app/server.js) in groups of their own, so
 * killing the shard's group misses them once Playwright dies first. So the descendants of every shard are
 * recorded while it runs (pid + start time, so a reused PID is never hit) and swept by PID afterwards.
 * Linux /proc only, like the rest of this machine's tooling. */
const descendants = new Map(); // shard child pid -> Map(descendant pid -> start time)
function procTable() {
  const t = new Map();
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const st = fs.readFileSync(`/proc/${d}/stat`, 'utf8');
      const f = st.slice(st.lastIndexOf(')') + 2).split(' '); // state ppid pgrp ... starttime is index 19 here
      t.set(Number(d), { ppid: Number(f[1]), start: f[19] });
    } catch (_) { /* exited */ }
  }
  return t;
}
// Descendants are tracked per shard: sweeping one shard's leftovers must never touch another shard's servers.
function recordDescendants(only) {
  const t = procTable();
  for (const c of only ? [only] : [...live]) {
    const set = descendants.get(c.pid) || new Map();
    descendants.set(c.pid, set);
    const roots = new Set([c.pid]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [pid, e] of t) if (!roots.has(pid) && roots.has(e.ppid)) { roots.add(pid); grew = true; }
    }
    for (const pid of roots) if (t.has(pid)) set.set(pid, t.get(pid).start);
  }
}
function sweepDescendants(sig, only) {
  const t = procTable();
  for (const [root, set] of [...descendants]) {
    if (only && root !== only.pid) continue;
    for (const [pid, start] of [...set]) {
      const e = t.get(pid);
      if (!e || e.start !== start) { set.delete(pid); continue; }
      try { process.kill(pid, sig); } catch (_) { /* gone */ }
    }
  }
}
function stopAll() {
  recordDescendants();
  for (const c of live) killGroup(c, 'SIGTERM');
  sweepDescendants('SIGTERM');
  // anything still alive after 5 s is killed by PID
  const t = setTimeout(() => { for (const c of live) killGroup(c, 'SIGKILL'); sweepDescendants('SIGKILL'); }, 5000);
  t.unref();
}

/* Runs one playwright invocation on `lane`; resolves { exitCode, report, seconds, crashed }. */
function runPlaywright(lane, targets, tag, logDir) {
  return new Promise((resolve) => {
    const jsonFile = path.join(logDir, `${tag}.json`);
    const logFile = path.join(logDir, `${tag}.log`);
    try { fs.rmSync(jsonFile); } catch (_) { /* none */ }
    const log = fs.openSync(logFile, 'w');
    const t0 = Date.now();
    const c = spawn('npx', ['playwright', 'test', ...targets, '--reporter=list,json'], {
      cwd: ROOT, detached: true, stdio: ['ignore', log, log],
      env: { ...process.env, E2E_LANE: String(lane), E2E_REUSE_SERVERS: '0', PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile },
    });
    live.add(c);
    const tick = setInterval(() => recordDescendants(c), 2000);
    let spawnErr = null;
    c.on('error', (e) => { spawnErr = e; });
    c.on('close', (code, signal) => {
      clearInterval(tick);
      fs.closeSync(log);
      killGroup(c, 'SIGTERM'); // stragglers of this group
      sweepDescendants('SIGTERM', c); // this shard's servers Playwright did not stop (crash, Ctrl-C)
      descendants.delete(c.pid);
      live.delete(c);
      let report = null;
      try { report = JSON.parse(fs.readFileSync(jsonFile, 'utf8')); } catch (_) { /* crashed before reporting */ }
      resolve({ exitCode: code === null ? 1 : code, report, seconds: (Date.now() - t0) / 1000, crashed: !report || !!spawnErr || !!signal, logFile });
    });
  });
}

/* Tests per spec file, from `playwright test --list` (no servers start; ~4 s). {} if it fails. */
function listCounts() {
  const r = spawnSync('npx', ['playwright', 'test', '--list', '--reporter=json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const counts = {};
  try { for (const row of parseReport(JSON.parse(r.stdout))) counts[row.file] = (counts[row.file] || 0) + 1; } catch (_) { /* by file count */ }
  return counts;
}

const flag = (a, n) => a.includes(n);
const val = (a, n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
const fmt = (s) => `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;

async function main() {
  const args = process.argv.slice(2);
  const lanes = (val(args, '--lanes', null) ? val(args, '--lanes').split(',') : DEFAULT_LANES).map(Number);
  for (const l of lanes) if (!Number.isInteger(l) || l < 0 || l > 9) throw new Error(`lanes must be integers 0-9, got ${l}`);
  if (new Set(lanes).size !== lanes.length) throw new Error('duplicate lane');
  const nShards = Number(val(args, '--shards', lanes.length));
  if (nShards > lanes.length) throw new Error(`--shards ${nShards} needs ${nShards} lanes, got ${lanes.length}`);
  const timingsFile = val(args, '--timings', DEFAULT_TIMINGS);
  const outFile = val(args, '--out', path.join(ROOT, 'test-results', 'run-sharded.json'));
  const logDir = path.join(ROOT, 'test-results', 'sharded');
  fs.mkdirSync(logDir, { recursive: true });

  const all = fs.readdirSync(path.join(ROOT, 'e2e')).filter((f) => f.endsWith('.spec.js')).sort();
  const only = val(args, '--only', null);
  const files = only ? only.split(',') : all;
  for (const f of files) if (!all.includes(f)) throw new Error(`no such spec: ${f}`);
  let timings = {};
  try { timings = JSON.parse(fs.readFileSync(timingsFile, 'utf8')); } catch (_) { /* by file count */ }

  const counts = listCounts();
  const shards = splitShards(files, Math.min(nShards, files.length), timings, counts);
  const haveTimings = files.some((f) => timings[f] > 0);
  console.log(`${files.length} specs, ${shards.length} shards on lanes ${lanes.slice(0, shards.length).join(',')} (${haveTimings ? 'balanced by measured time' : 'balanced by test count'})`);
  shards.forEach((s, i) => console.log(`  lane ${lanes[i]}: ${s.files.length} specs, ${s.files.reduce((a, f) => a + (counts[f] || 1), 0)} tests${haveTimings ? `, ~${fmt(s.weight)}` : ''}`));

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { interrupted = true; console.error(`\n${sig}: stopping shards`); stopAll(); setTimeout(() => process.exit(130), 1500); });
  }
  process.on('exit', () => { for (const c of live) killGroup(c, 'SIGKILL'); sweepDescendants('SIGKILL'); });

  const t0 = Date.now();
  const results = await Promise.all(shards.map(async (s, i) => {
    const lane = lanes[i];
    const r = await runPlaywright(lane, s.files.map((f) => `e2e/${f}`), `lane${lane}`, logDir);
    const rows = r.report ? parseReport(r.report) : [];
    const failed = rows.filter((x) => x.status === 'failed').length;
    console.log(`lane ${lane} done in ${fmt(r.seconds)}: ${rows.length} tests, ${failed} failed${r.crashed ? ', CRASHED (no report)' : ''}  [${path.relative(ROOT, r.logFile)}]`);
    return { lane, files: s.files, exitCode: r.exitCode, rows, seconds: r.seconds, crashed: r.crashed };
  }));
  const wall = (Date.now() - t0) / 1000;
  const summary = mergeSummary(results);
  if (interrupted) { console.log('interrupted: no timings recorded, no re-runs'); process.exit(130); }

  // timings: only from a run where the file passed completely, so a crashed or aborted file never records a short time
  const clean = summary.perSpec.filter((s) => !s.failed);
  if (!flag(args, '--no-record')) fs.writeFileSync(timingsFile, JSON.stringify(updateTimings(timings, clean), null, 2) + '\n');

  // re-run each failure alone, serially, on the first lane
  const reruns = [];
  if (flag(args, '--rerun-failed')) {
    const seen = new Set();
    for (const row of summary.failures) {
      if (seen.has(row.file + '\0' + row.title)) continue;
      seen.add(row.file + '\0' + row.title);
      console.log(`re-running alone: ${row.file} (${row.title})`);
      const r = await runPlaywright(lanes[0], rerunTargets(row), `rerun-${reruns.length}`, logDir);
      const again = r.report ? parseReport(r.report) : [];
      const consistent = !r.report || again.some((x) => x.status === 'failed');
      reruns.push({ ...row, rerunLane: lanes[0], consistent });
    }
  }

  printSummary(summary, results, wall, reruns, flag(args, '--rerun-failed'), lanes);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ wallSeconds: Math.round(wall), lanes, summary, reruns }, null, 2));

  const blocking = flag(args, '--rerun-failed') ? reruns.filter((r) => r.consistent) : summary.failures;
  process.exit(blocking.length || summary.missing.length || summary.crashedLanes.length ? 1 : 0);
}

function printSummary(sum, results, wall, reruns, rerunOn, lanes) {
  console.log('\n=== per spec ===');
  for (const s of sum.perSpec) {
    const st = s.failed ? 'FAIL' : s.flaky ? 'FLAKY' : 'pass';
    console.log(`${st.padEnd(5)} ${s.file.padEnd(36)} ${String(s.passed)} ok ${s.failed} failed ${s.flaky} flaky ${s.skipped} skipped  ${s.seconds.toFixed(0).padStart(4)}s  lane ${s.lane}`);
  }
  for (const m of sum.missing) console.log(`NONE  ${m.file.padEnd(36)} no results (lane ${m.lane} crashed or the file did not load)`);
  const t = sum.totals;
  console.log(`\n${t.passed}/${t.tests} passed, ${t.failed} failed, ${t.flaky} flaky, ${t.skipped} skipped; wall ${fmt(wall)}; slowest shard ${fmt(Math.max(...results.map((r) => r.seconds)))}`);
  if (sum.failures.length) {
    console.log('\n=== failures ===');
    for (const f of sum.failures) {
      const rr = reruns.find((r) => r.file === f.file && r.title === f.title);
      const verdict = rr ? (rr.consistent ? '  -> consistent (fails alone too)' : '  -> PASSED ALONE (load-sensitive, does not count)') : '';
      console.log(`${f.file}:${f.line} ${f.title}${verdict}\n    ${f.error}\n    re-run: ${rerunCommand(lanes[0], f)}`);
    }
    if (!rerunOn) console.log('\n(a failure is re-run alone before it counts: add --rerun-failed)');
  }
  if (sum.flakies.length) {
    console.log('\n=== flaky (passed on retry) ===');
    for (const f of sum.flakies) console.log(`${f.file}:${f.line} ${f.title}`);
  }
}

if (require.main === module) main().catch((e) => { console.error(e); stopAll(); process.exit(2); });
