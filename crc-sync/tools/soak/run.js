#!/usr/bin/env node
'use strict';

// WP8 soak harness — CLI entry. See docs/wip/L6.md for usage.
//
//   node tools/soak/run.js [--minutes 10] [--seed 1] [--profile realistic|stress|smoke]
//        [--realtime] [--restarts n] [--restart-at m,m] [--crew three|full|solo]
//        [--sample-every s] [--out dir] [--keep-state] [--inproc] [--prune-retired]
//        [--inject drop-ack|drop-broadcast|leak|skip-shadow-client] [--quiet]
//        [--threshold-<name> <value>]
//
// Exit: 0 PASS, 1 FAIL (verdict), 2 harness error.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { ForkedHost, InprocHost, writeFixtures } = require('./host-client');
const { Driver } = require('./driver');
const { PROFILES, CREWS } = require('./traffic');
const report = require('./report');

function parseArgs(argv) {
  const o = { minutes: 10, seed: 1, profile: 'realistic', realtime: false, restarts: null, restartAt: null, crew: null, sampleEvery: null, out: null, keepState: false, inproc: false, pruneRetired: false, inject: null, quiet: false, thresholds: { ...report.THRESHOLDS } };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const v = () => argv[++i];
    switch (a) {
      case '--minutes': o.minutes = Number(v()); break;
      case '--seed': o.seed = Number(v()); break;
      case '--profile': o.profile = v(); break;
      case '--realtime': o.realtime = true; break;
      case '--restarts': o.restarts = Number(v()); break;
      case '--restart-at': o.restartAt = v().split(',').map(Number); break;
      case '--crew': o.crew = v(); break;
      case '--sample-every': o.sampleEvery = Number(v()); break;
      case '--out': o.out = v(); break;
      case '--keep-state': o.keepState = true; break;
      case '--inproc': o.inproc = true; break;
      case '--direct': throw new Error('--direct is not implemented in v1 (WsHub fake sockets are the only transport); see docs/wip/L6.md');
      case '--prune-retired': o.pruneRetired = true; break;
      case '--inject': o.inject = v(); break;
      case '--quiet': o.quiet = true; break;
      default:
        if (a.startsWith('--threshold-')) { o.thresholds[a.slice(12)] = Number(v()); break; }
        throw new Error(`unknown option ${a}`);
    }
  }
  if (!PROFILES[o.profile]) throw new Error(`unknown profile ${o.profile}`);
  if (o.crew && !CREWS[o.crew]) throw new Error(`unknown crew ${o.crew}`);
  if (!(o.minutes > 0)) throw new Error('--minutes must be > 0');
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z');
  const outDir = o.out || path.join(__dirname, 'out', `${stamp}-seed${o.seed}-${o.profile}-${o.minutes}m${o.inject ? `-${o.inject}` : ''}`);
  fs.mkdirSync(outDir, { recursive: true });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crc-soak-'));
  writeFixtures(stateDir);
  const free = fs.statfsSync ? fs.statfsSync(stateDir) : null;
  if (free && free.bavail * free.bsize < 1024 * 1024 * 1024) process.stderr.write(`[soak] warning: less than 1 GB free in ${stateDir}\n`);

  // Samples: light every 60 virtual s by default, heavy 5x that — but short
  // runs are sampled denser so the regression has points (Defaults taken, L6.md).
  const runS = o.minutes * 60;
  const lightS = o.sampleEvery || Math.max(10, Math.min(60, Math.round(runS / 40)));
  const heavyS = Math.max(lightS, Math.min(5 * lightS, Math.round(runS * 0.75 / 10)));
  let commit = null;
  try { commit = execSync('git rev-parse HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a checkout */ }

  const startNow = Date.now();
  const hostOpts = { stateDir, seed: o.seed, startNow, logPath: path.join(outDir, 'host.log') };
  const host = o.inproc ? new InprocHost(hostOpts) : new ForkedHost(hostOpts);
  const driver = new Driver({ ...o, host, startNow, outDir, stateDir, lightMs: lightS * 1000, heavyMs: heavyS * 1000 });
  await driver.run();

  const rep = report.build(driver, { ...o, commit, argv: process.argv.slice(2), stateDir });
  const text = report.write(outDir, rep);
  if (o.quiet) process.stdout.write(text.split('\n')[0] + '\n');
  else process.stdout.write(text);
  if (o.keepState) process.stdout.write(`state kept: ${stateDir}\n`);
  else fs.rmSync(stateDir, { recursive: true, force: true });
  return rep.verdict.pass ? 0 : 1;
}

main().then((code) => process.exit(code), (err) => {
  process.stderr.write(`[soak] harness error: ${err && err.stack || err}\n`);
  process.exit(2);
});
