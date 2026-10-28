// npm run freeze:selfcheck : proves the freeze suite catches deliberate faults. NOT part of `npm test`
// (it runs the whole suite once per mutation, ~20 s each). Mirrors tools/soak/selfcheck.mjs.
//
// Each mutation is applied to a TEMPORARY COPY of crc-sync (node_modules and the sibling dirs the tests read are
// symlinked), the freeze suite is run there, and the mutation counts as caught when the run fails and at least one
// of the detector files named for it is among the failures. Nothing in the real tree is touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CRC_SYNC = path.resolve(HERE, '../..');
const REPO = path.resolve(CRC_SYNC, '..');

/** One file per mutation under tests/freeze/selfcheck/: export default {id, what, file, find, replace, detect, also?}. */
async function loadMutations() {
  const dir = path.join(HERE, 'selfcheck');
  const names = fs.readdirSync(dir).filter(f => /^M\d+[a-z]?\.mjs$/.test(f));
  const num = (id) => { const m = /^M(\d+)([a-z]?)$/.exec(id); return [Number(m[1]), m[2]]; };
  const loaded = [];
  for (const f of names) loaded.push((await import(pathToFileURL(path.join(dir, f)).href)).default);
  for (const m of loaded) for (const k of ['id', 'what', 'file', 'find', 'replace', 'detect']) if (m[k] === undefined) throw new Error(`selfcheck mutation ${m.id || '?'} lacks ${k}`);
  return loaded.sort((x, y) => { const [a, as] = num(x.id), [b, bs] = num(y.id); return a - b || as.localeCompare(bs); });
}
const MUTATIONS = await loadMutations();

function buildCopy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze-selfcheck-'));
  const dest = path.join(root, 'crc-sync');
  fs.cpSync(CRC_SYNC, dest, { recursive: true, filter: (p) => !/(^|\/)(node_modules|out|\.git)(\/|$)/.test(path.relative(CRC_SYNC, p)) });
  fs.symlinkSync(path.join(CRC_SYNC, 'node_modules'), path.join(dest, 'node_modules'));
  for (const sib of ['atobrief', 'docs', 'crc-desktop']) if (fs.existsSync(path.join(REPO, sib))) fs.symlinkSync(path.join(REPO, sib), path.join(root, sib));
  return { root, dest };
}

/** Every freeze test file in its own process, in parallel; a file fails when its process exits non-zero. */
async function runSuite(dest) {
  const t0 = Date.now();
  // The freeze suite, plus the two structure policies that sit beside it in tests/ (clock-policy, board-seam).
  const files = [
    ...fs.readdirSync(path.join(dest, 'tests/freeze')).filter(f => /^freeze-.*\.test\.mjs$/.test(f)).map(f => path.join('tests/freeze', f)),
    ...['clock-policy.test.mjs', 'board-seam.test.mjs'].filter(f => fs.existsSync(path.join(dest, 'tests', f))).map(f => path.join('tests', f)),
  ];
  const results = await Promise.all(files.map(rel => new Promise((resolve) => {
    const f = path.basename(rel);
    const child = spawn(process.execPath, ['--test', rel], { cwd: dest, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 240000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ name: f.replace('.test.mjs', ''), code, out }); });
  })));
  const failedFiles = results.filter(r => r.code !== 0).map(r => r.name);
  return { status: failedFiles.length ? 1 : 0, failedFiles, ms: Date.now() - t0, out: results.filter(r => r.code !== 0).map(r => r.out.slice(-1500)).join('\n') };
}

const only = process.argv.slice(2);
const { root, dest } = buildCopy();
const rows = [];
try {
  const base = await runSuite(dest);
  if (base.status !== 0) { console.error('baseline copy does not pass; selfcheck cannot run\n' + base.out.slice(-3000)); process.exit(2); }
  console.log(`baseline: pass (${(base.ms / 1000).toFixed(1)} s)`);
  for (const m of MUTATIONS) {
    if (only.length && !only.includes(m.id)) continue;
    const file = path.join(dest, m.file);
    const original = fs.readFileSync(file, 'utf8');
    const edits = [m, ...(m.also ? [m.also] : [])];
    let mutated = original;
    let applied = true;
    for (const e of edits) {
      const n = mutated.split(e.find).length - 1;
      if (n !== 1) { applied = false; rows.push({ id: m.id, what: m.what, result: `MUTATION DID NOT APPLY (${n} matches)`, bad: true }); break; }
      mutated = mutated.replace(e.find, () => e.replace);
    }
    if (!applied) continue;
    fs.writeFileSync(file, mutated);
    const r = await runSuite(dest);
    fs.writeFileSync(file, original);
    const caught = r.status !== 0 && m.detect.some(d => r.failedFiles.includes(d));
    rows.push({ id: m.id, what: m.what, result: caught ? 'CAUGHT' : (r.status !== 0 ? 'failed, but not in the expected detector' : 'NOT CAUGHT'), by: r.failedFiles.join(', ') || '-', bad: !caught, ms: r.ms });
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('\n id   result    detectors that failed                         mutation');
for (const r of rows) console.log(` ${r.id.padEnd(4)} ${(r.bad ? 'FAIL' : 'ok').padEnd(9)} ${String(r.by || '').padEnd(45).slice(0, 45)} ${r.what}  [${r.result}]`);
const bad = rows.filter(r => r.bad);
console.log(`\n${rows.length - bad.length}/${rows.length} mutations caught`);
process.exit(bad.length ? 1 : 0);
