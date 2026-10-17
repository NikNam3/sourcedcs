#!/usr/bin/env node
// Proves the soak's detectors fire (briefing §6 step 9): a soak whose
// detectors are unproven is not evidence. Runs `--profile smoke --minutes 20
// --seed 7` (or `--seed <n>`) clean, with each injected fault (drop-ack, drop-broadcast, leak, skip-shadow-client,
// drop-store-delta), and once more as the leak case's clean twin, and exits non-zero if any detector stays silent.
//
// NOT named *.test.* on purpose: crc-sync's `npm test` must not collect it (T1).
//
//   node tools/soak/selfcheck.mjs [--seed n]

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crc-soak-selfcheck-'));
const seedAt = process.argv.indexOf('--seed');
const seed = seedAt > 0 ? process.argv[seedAt + 1] : '7';
if (!/^\d+$/.test(seed)) { process.stderr.write(`selfcheck: --seed needs a number, got ${seed}\n`); process.exit(2); }
const common = ['--profile', 'smoke', '--minutes', '20', '--seed', seed, '--quiet'];

function run(name, extra) {
  const out = path.join(base, name);
  const r = spawnSync(process.execPath, [path.join(here, 'run.js'), ...common, '--out', out, ...extra], { encoding: 'utf8', cwd: path.join(here, '../..') });
  if (r.status === 2 || !fs.existsSync(path.join(out, 'report.json'))) {
    return { name, error: `harness error (exit ${r.status}): ${r.stderr.slice(-2000)}` };
  }
  return { name, exit: r.status, report: JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')), out };
}

// Detectors that are NOT tied to a hypothesis H1-H8: these must be quiet on a clean run.
const quiet = (rep) => {
  const m = rep.mutations;
  const bad = [];
  for (const k of ['lost', 'duplicateAck', 'auditMissing', 'auditDuplicate', 'auditWrongSource', 'auditOrphan', 'internalErrors', 'broadcastMissing']) if (m[k] > 0) bad.push(`${k}=${m[k]}`);
  if (m.replayNotIdempotent.count > 0) bad.push(`replayNotIdempotent=${m.replayNotIdempotent.count}`);
  if (m.resync.resyncDivergence > 0) bad.push(`resyncDivergence=${m.resync.resyncDivergence}`);
  if (m.storeSync.stale > 0) bad.push(`storeSync.stale=${m.storeSync.stale}`);
  if (m.restart.boardLostOnRestart > 0) bad.push(`boardLostOnRestart=${m.restart.boardLostOnRestart}`);
  if (m.silentStaleness.count > 0 && Object.keys(m.silentStaleness.byCause).some(c => c !== 'REBALANCE_SIDE_EFFECT')) bad.push(`silentStaleness=${JSON.stringify(m.silentStaleness.byCause)}`);
  return bad;
};

// Staleness the injected fault caused, as opposed to H1's rebalance side effect a clean run already shows.
const injectedStale = (rep) => Object.entries(rep.mutations.silentStaleness.byCause).filter(([c]) => c !== 'REBALANCE_SIDE_EFFECT').reduce((n, [, v]) => n + v, 0);

// The injected leak: 32768 doubles (256 KB) per virtual minute (host-core.js tickLeak), 15 MB/h.
const LEAK_MB_PER_HOUR = 256 * 60 / 1024;
// Seeds 1-30 read 14.76-15.14 MB/h added (docs/wip/U-SMALL2.md); 20% leaves room without letting a silent detector by.
const LEAK_TOLERANCE = 0.2;
const leakAdded = (rep, twin) => Math.round((rep.memory.slopeMBPerHour - twin.memory.slopeMBPerHour) * 100) / 100;

const cases = [
  { name: 'clean', extra: [], expect: (rep) => { const b = quiet(rep); return b.length ? `clean run not quiet: ${b.join(', ')}` : null; } },
  { name: 'drop-ack', extra: ['--inject', 'drop-ack'], expect: (rep) => (rep.mutations.lost >= 1 ? null : `lost=${rep.mutations.lost}, expected >= 1`) },
  { name: 'drop-broadcast', extra: ['--inject', 'drop-broadcast'], expect: (rep) => (injectedStale(rep) >= 1 ? null : `silentStaleness (not H1) = ${injectedStale(rep)}, expected >= 1`) },
  // The leak case is judged against a clean twin: the same seed and flags without the leak. At 20 minutes the
  // heap is still filling to the Strip retention, so the clean twin fails memory.slope on its own on most seeds
  // (29 of seeds 1-30), and R² reads the traffic's fill, not the leak (0.82-0.996 across seeds). What proves the
  // detector is that the leak moves the judged slope by the injected rate. No restart in either run: a restart
  // starts a new heap and the fit keeps only the part after it (docs/wip/U-SMALL.md item 2, docs/wip/U-SMALL2.md).
  { name: 'leak', extra: ['--inject', 'leak', '--judge-memory', '--restarts', '0'], twin: ['--judge-memory', '--restarts', '0'], expect: (rep, twin) => {
    const added = leakAdded(rep, twin);
    if (!rep.verdict.failures.some(f => f.startsWith('memory.slope'))) return `no memory.slope failure (slope ${rep.memory.slopeMBPerHour} MB/h)`;
    if (!(Math.abs(added - LEAK_MB_PER_HOUR) <= LEAK_TOLERANCE * LEAK_MB_PER_HOUR)) return `leak added ${added} MB/h over its clean twin (${rep.memory.slopeMBPerHour} - ${twin.memory.slopeMBPerHour}), expected ${LEAK_MB_PER_HOUR} ± ${LEAK_TOLERANCE * 100}%`;
    return null;
  } },
  { name: 'skip-shadow-client', extra: ['--inject', 'skip-shadow-client'], expect: (rep) => (rep.mutations.injectedShadowDrops >= 1 && injectedStale(rep) >= 1 ? null : `dropped ${rep.mutations.injectedShadowDrops}, silentStaleness (not H1) = ${injectedStale(rep)}, expected >= 1`) },
  { name: 'drop-store-delta', extra: ['--inject', 'drop-store-delta'], expect: (rep) => (rep.mutations.storeSync.injectedDrops >= 1 && rep.mutations.storeSync.stale >= 1 && rep.verdict.failures.some(f => f.startsWith('mutations.storeSync.stale')) ? null : `dropped ${rep.mutations.storeSync.injectedDrops}, store-stale ${rep.mutations.storeSync.stale}, expected both >= 1 and a verdict failure`) },
];

let failed = 0;
for (const c of cases) {
  const r = run(c.name, c.extra);
  const t = c.twin && !r.error ? run(`${c.name}-twin`, c.twin) : null;
  const problem = r.error || (t && t.error) || c.expect(r.report, t && t.report);
  if (problem) failed++;
  process.stdout.write(`${problem ? 'FAIL' : 'ok  '} ${c.name.padEnd(20)} ${problem || describe(c.name, r.report, t && t.report)}\n`);
}
process.stdout.write(`${failed ? 'SELFCHECK FAIL' : 'SELFCHECK PASS'} seed ${seed} — outputs in ${base}\n`);
process.exit(failed ? 1 : 0);

function describe(name, rep, twin) {
  const m = rep.mutations;
  switch (name) {
    case 'clean': return `quiet (silentStaleness ${m.silentStaleness.count}, H4 ${m.resync.acrossRestartDivergence.count})`;
    case 'drop-ack': return `lost=${m.lost}`;
    case 'drop-broadcast': return `silentStaleness (not H1)=${injectedStale(rep)} broadcastMissing=${m.broadcastMissing}`;
    case 'leak': return `slope ${rep.memory.slopeMBPerHour} MB/h (R² ${rep.memory.r2}), clean twin ${twin.memory.slopeMBPerHour} MB/h, leak added ${leakAdded(rep, twin)} MB/h`;
    case 'drop-store-delta': return `store-stale=${m.storeSync.stale} ${JSON.stringify(m.storeSync.staleByKey)}`;
    default: return `silentStaleness (not H1)=${injectedStale(rep)}`;
  }
}
