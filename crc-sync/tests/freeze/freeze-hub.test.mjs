import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { HERE, canonical, checkGolden, checkGoldenSet, renumberIds } from './freeze-lib.mjs';

// Golden master at the socket: each trace in freeze-traces.mjs runs in its own process against a real
// createEfsp() behind the real WsHub with fake sockets (tools/soak's host), deterministic clocks and ids.
// Every step records the input, every efsp-* frame every socket received in order, the Mutation-log lines
// appended, and the persisted Board file (hash; whole summarised state at checkpoints and after restarts).
// Each trace runs twice and the two recordings must be byte-identical.

const TRACE_NAMES = ['peer-marsa-order', 'resync-metrics', 'op-matrix', 'walk-civil', 'walk-manning', 'walk-tactical', 'crash-replay', 'monitors', 'order-keys', 'random-seed1', 'random-seed2', 'random-seed3'];
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze-hub-out-'));

function run(trace, tag) {
  const out = path.join(outDir, `${trace}.${tag}.json`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HERE, 'freeze-hub-runner.mjs'), trace], { env: { ...process.env, FREEZE_OUT: out }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
    child.on('close', (code) => resolve({ code, log, out }));
  });
}

/**
 * op-matrix is one long trace of every op kind; it is stored as one golden per op (golden/hub-op-matrix/<op>.json) so
 * a change to one op touches one file. A step goes to the group of its label's first segment ("HANDOFF/PROPOSE" ->
 * HANDOFF; connects and unlabelled sends -> setup). Step numbers, the virtual-time offset and the per-step Board-file
 * hash are cumulative (one more step shifts every later one), so they are not stored per step: the steps keep a
 * running number inside their group, and the whole-state checkpoints and the counters go to _checkpoints.json.
 */
export function splitByOp(doc) {
  const groups = {}; const checkpoints = [];
  for (const s of doc.steps) {
    const g = s.act === 'send' && s.label ? s.label.split('/')[0] : 'setup';
    const { i, t, snap, ...rest } = s;
    const list = (groups[g] = groups[g] || { steps: [] }).steps;
    list.push({ n: list.length, ...rest });
    if (snap && snap.state) checkpoints.push({ group: g, n: list.length - 1, snap });
  }
  groups._checkpoints = { seed: doc.seed, consoleCounters: doc.consoleCounters, checkpoints };
  return groups;
}
const unitsOfGroup = (doc) => doc.steps ? doc.steps.map(s => [`step ${s.n} ${s.act}${s.as ? ' by ' + s.as : ''}${s.label ? ' ' + s.label : ''}`, s]) : doc.checkpoints.map(c => [`checkpoint after ${c.group} step ${c.n}`, c]);

const unitsOf = (doc) => doc.steps.map(s => [`step ${s.i} t+${s.t}ms ${s.act}${s.as ? ' by ' + s.as : ''}${s.label ? ' ' + s.label : ''}`, s]);

test('freeze hub: traces are deterministic and match their goldens', { timeout: 180000 }, async (t) => {
  const [first, second] = await Promise.all([
    Promise.all(TRACE_NAMES.map(n => run(n, 'a'))),
    Promise.all(TRACE_NAMES.map(n => run(n, 'b'))),
  ]);
  for (const [i, name] of TRACE_NAMES.entries()) {
    await t.test(name, () => {
      assert.equal(first[i].code, 0, `trace ${name} failed:\n${first[i].log.slice(-2500)}`);
      assert.equal(second[i].code, 0, `trace ${name} failed on its second run`);
      const a = fs.readFileSync(first[i].out, 'utf8'), b = fs.readFileSync(second[i].out, 'utf8');
      assert.ok(a === b, `trace ${name}: two runs produced different recordings (non-determinism leaked in)`);
      const doc = JSON.parse(a);
      if (process.env.FREEZE_DUMP) {
        fs.mkdirSync(process.env.FREEZE_DUMP, { recursive: true });
        fs.writeFileSync(path.join(process.env.FREEZE_DUMP, `hub-${name}.full.json`), renumberIds(JSON.stringify(canonical(doc), null, 1)));
      }
      assert.ok(doc.steps.length > 5, `trace ${name} recorded almost nothing`);
      if (name === 'op-matrix') checkGoldenSet(assert, 'hub-op-matrix', splitByOp(doc), unitsOfGroup);
      else checkGolden(assert, `hub-${name}`, doc, unitsOf);
    });
  }
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
});
