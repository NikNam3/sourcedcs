#!/usr/bin/env node
// Proves the soak's detectors fire (briefing §6 step 9): a soak whose
// detectors are unproven is not evidence. Runs `--profile smoke --minutes 20
// --seed 7` five times — clean, and with each injected fault — and exits
// non-zero if any detector stays silent.
//
// NOT named *.test.* on purpose: crc-sync's `npm test` must not collect it (T1).
//
//   node tools/soak/selfcheck.mjs

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crc-soak-selfcheck-'));
const common = ['--profile', 'smoke', '--minutes', '20', '--seed', '7', '--quiet'];

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
  for (const k of ['lost', 'duplicateAck', 'auditMissing', 'auditDuplicate', 'auditForRefusal', 'auditOrphan', 'internalErrors', 'broadcastMissing']) if (m[k] > 0) bad.push(`${k}=${m[k]}`);
  if (m.replayNotIdempotent.count > 0) bad.push(`replayNotIdempotent=${m.replayNotIdempotent.count}`);
  if (m.resync.resyncDivergence > 0) bad.push(`resyncDivergence=${m.resync.resyncDivergence}`);
  if (m.restart.boardLostOnRestart > 0) bad.push(`boardLostOnRestart=${m.restart.boardLostOnRestart}`);
  if (m.silentStaleness.count > 0 && Object.keys(m.silentStaleness.byCause).some(c => c !== 'REBALANCE_SIDE_EFFECT')) bad.push(`silentStaleness=${JSON.stringify(m.silentStaleness.byCause)}`);
  return bad;
};

// Staleness the injected fault caused, as opposed to H1's rebalance side effect a clean run already shows.
const injectedStale = (rep) => Object.entries(rep.mutations.silentStaleness.byCause).filter(([c]) => c !== 'REBALANCE_SIDE_EFFECT').reduce((n, [, v]) => n + v, 0);

const cases = [
  { name: 'clean', extra: [], expect: (rep) => { const b = quiet(rep); return b.length ? `clean run not quiet: ${b.join(', ')}` : null; } },
  { name: 'drop-ack', extra: ['--inject', 'drop-ack'], expect: (rep) => (rep.mutations.lost >= 1 ? null : `lost=${rep.mutations.lost}, expected >= 1`) },
  { name: 'drop-broadcast', extra: ['--inject', 'drop-broadcast'], expect: (rep) => (injectedStale(rep) >= 1 ? null : `silentStaleness (not H1) = ${injectedStale(rep)}, expected >= 1`) },
  { name: 'leak', extra: ['--inject', 'leak'], expect: (rep) => (rep.memory.r2 > 0.9 && rep.verdict.failures.some(f => f.startsWith('memory.slope')) ? null : `heap slope ${rep.memory.slopeMBPerHour} MB/h R²=${rep.memory.r2}; expected a memory FAIL with R² > 0.9`) },
  { name: 'skip-shadow-client', extra: ['--inject', 'skip-shadow-client'], expect: (rep) => (rep.mutations.injectedShadowDrops >= 1 && injectedStale(rep) >= 1 ? null : `dropped ${rep.mutations.injectedShadowDrops}, silentStaleness (not H1) = ${injectedStale(rep)}, expected >= 1`) },
];

let failed = 0;
for (const c of cases) {
  const r = run(c.name, c.extra);
  const problem = r.error || c.expect(r.report);
  if (problem) failed++;
  process.stdout.write(`${problem ? 'FAIL' : 'ok  '} ${c.name.padEnd(20)} ${problem || describe(c.name, r.report)}\n`);
}
process.stdout.write(`${failed ? 'SELFCHECK FAIL' : 'SELFCHECK PASS'} — outputs in ${base}\n`);
process.exit(failed ? 1 : 0);

function describe(name, rep) {
  const m = rep.mutations;
  switch (name) {
    case 'clean': return `quiet (silentStaleness ${m.silentStaleness.count}, H4 ${m.resync.acrossRestartDivergence.count})`;
    case 'drop-ack': return `lost=${m.lost}`;
    case 'drop-broadcast': return `silentStaleness (not H1)=${injectedStale(rep)} broadcastMissing=${m.broadcastMissing}`;
    case 'leak': return `slope ${rep.memory.slopeMBPerHour} MB/h, R² ${rep.memory.r2}`;
    default: return `silentStaleness (not H1)=${injectedStale(rep)}`;
  }
}
