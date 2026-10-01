import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { HERE, canonical, summarize, summarizeCollection, summarizeFinalState, checkGolden } from './freeze-lib.mjs';

// Golden master over the seed corpus: every tests/efsp-scenario*.test.mjs (and efsp-scenarios.test.mjs)
// is run as-is in a child process with freeze-recorder.mjs preloaded, which pins ids / randomness / wall
// time and records every wire message handed to createEfsp().handleMessage() with its result and the
// audit entries written during it. Each file is run twice; the two recordings must be byte-identical
// (determinism), and the first is compared with golden/scenario-<name>.json.

const TESTS = path.resolve(HERE, '..');
const files = fs.readdirSync(TESTS).filter(f => /^efsp-scenarios?(-.+)?\.test\.mjs$/.test(f)).sort();
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze-scn-'));

function run(file, tag) {
  const out = path.join(outDir, `${file}.${tag}.json`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', path.join(HERE, 'freeze-recorder.mjs'), path.join(TESTS, file)], {
      env: { ...process.env, FREEZE_OUT: out }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
    child.on('close', (code) => resolve({ code, log, out }));
  });
}

async function pool(items, n, fn) {
  const results = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; results[k] = await fn(items[k]); } }));
  return results;
}

function compact(raw) {
  return {
    instances: raw.instances.map(inst => ({
      steps: inst.steps.map((s, n) => ({
        n, who: s.session.controllerId,
        in: summarize(s.in), out: summarize(s.out === undefined ? null : s.out), audit: summarize(s.audit),
        ...(s.threw ? { threw: canonical(s.threw) } : {}),
      })),
      orphanAudit: summarize(inst.orphanAudit),
      final: summarizeFinalState(inst.finalState),
    })),
  };
}

const unitsOf = (doc) => doc.instances.flatMap((inst, k) => [
  ...inst.steps.map(s => [`instance ${k} step ${s.n} ${s.in && s.in.type} ${s.in && s.in.op ? s.in.op.kind : ''} by ${s.who}`, s]),
  [`instance ${k} orphan audit`, inst.orphanAudit],
  [`instance ${k} final state`, inst.final],
]);

test('freeze: scenario corpus is deterministic and matches its goldens', { timeout: 120000 }, async (t) => {
  const first = await pool(files, 8, f => run(f, 'a'));
  const second = await pool(files, 8, f => run(f, 'b'));
  for (const [i, file] of files.entries()) {
    await t.test(file, () => {
      assert.equal(first[i].code, 0, `${file} failed under the recorder:\n${first[i].log.slice(-2000)}`);
      assert.equal(second[i].code, 0, `${file} failed on its second recorded run`);
      const a = fs.readFileSync(first[i].out, 'utf8'), b = fs.readFileSync(second[i].out, 'utf8');
      assert.ok(a === b, `${file}: two runs of the same corpus produced different recordings (non-determinism leaked in)`);
      const raw = JSON.parse(a);
      if (process.env.FREEZE_DUMP) {
        fs.mkdirSync(process.env.FREEZE_DUMP, { recursive: true });
        fs.writeFileSync(path.join(process.env.FREEZE_DUMP, file.replace('.test.mjs', '.full.json')), JSON.stringify(canonical(raw), null, 1));
      }
      assert.ok(raw.instances.length > 0 && raw.instances.some(x => x.steps.length > 0), `${file}: recorder captured no wire traffic`);
      checkGolden(assert, '' + file.replace(/^efsp-/, '').replace('.test.mjs', ''), compact(raw), unitsOf);
    });
  }
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
});
