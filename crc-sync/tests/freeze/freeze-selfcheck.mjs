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
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CRC_SYNC = path.resolve(HERE, '../..');
const REPO = path.resolve(CRC_SYNC, '..');

const MUTATIONS = [
  { id: 'M1', what: 'an ack reason: NOT_OWNER -> NOT_YOURS', file: 'src/efsp/board-store.js',
    find: "reason: 'NOT_OWNER', detail: `${strip.ownerPositionId} holds this Strip`", replace: "reason: 'NOT_YOURS', detail: `${strip.ownerPositionId} holds this Strip`",
    detect: ['freeze-table', 'freeze-scenarios', 'freeze-hub'] },
  { id: 'M2', what: 'a state transition: ConvertToArrival lands in HANDED_TO_TOWER, not INBOUND', file: 'src/efsp/board-store.js',
    find: "    strip.state = 'INBOUND';", replace: "    strip.state = 'HANDED_TO_TOWER';",
    detect: ['freeze-table', 'freeze-scenarios', 'freeze-hub'] },
  { id: 'M3', what: 'an audit field: actorId dropped from the Mutation-log entry', file: 'src/efsp/board-store.js',
    find: "      actorId: by || null,\n      at: this._clock.now(),\n      before,", replace: "      actorId: null,\n      at: this._clock.now(),\n      before,",
    detect: ['freeze-table', 'freeze-scenarios', 'freeze-hub'] },
  { id: 'M4', what: 'a missing _touch in SetFlag (the Strip is not in the next delta)', file: 'src/efsp/board-store.js',
    find: "    strip.flags[op.flag] = op.value;\n    strip.rev += 1;\n    strip.updatedAt = this._clock.now();\n    strip.updatedBy = by || null;\n    this._touch(strip.stripId);\n", replace: "    strip.flags[op.flag] = op.value;\n    strip.rev += 1;\n    strip.updatedAt = this._clock.now();\n    strip.updatedBy = by || null;\n",
    detect: ['freeze-table', 'freeze-scenarios', 'freeze-hub'] },
  { id: 'M5', what: 'frame order: ws-hub sends the peer delta before the primary delta', file: 'src/ws-hub.js',
    find: "        if (result.broadcast) this._broadcastEfsp(result.broadcast);", replace: "        if (result.peerBroadcast) this._broadcastEfsp(result.peerBroadcast);",
    detect: ['freeze-hub'], also: { find: "        if (result.peerBroadcast) this._broadcastEfsp(result.peerBroadcast);\n        // WP6 (docs/adr/0051)", replace: "        if (result.broadcast) this._broadcastEfsp(result.broadcast);\n        // WP6 (docs/adr/0051)" } },
  { id: 'M5b', what: 'frame order: ws-hub sends the MARSA delta before the primary delta', file: 'src/ws-hub.js',
    find: "        if (result.broadcast) this._broadcastEfsp(result.broadcast);", replace: "        if (result.marsaBroadcast) this._broadcastEfsp(result.marsaBroadcast);",
    detect: ['freeze-hub'], also: { find: "        if (result.marsaBroadcast) this._broadcastEfsp(result.marsaBroadcast);\n        // docs/adr/0074", replace: "        if (result.broadcast) this._broadcastEfsp(result.broadcast);\n        // docs/adr/0074" } },
  { id: 'M6', what: 'a refusal detail string', file: 'src/efsp/board-store.js',
    find: "detail: `no such Bay here: ${bayId}`", replace: "detail: `no such bay: ${bayId}`",
    detect: ['freeze-table', 'freeze-scenarios', 'freeze-hub'] },
  { id: 'M7', what: 'causedBy dropped from a peer-write audit entry', file: 'src/efsp/board-store.js',
    find: "clientMutationId: null, causedBy: causedBy || null, op,", replace: "clientMutationId: null, op,",
    detect: ['freeze-scenarios', 'freeze-hub'] },
  { id: 'M8', what: 'the persisted replay window set to 0', file: 'src/efsp/board-store.js',
    find: "const REPLAY_PERSIST_WINDOW_MS = 10 * 60 * 1000;", replace: "const REPLAY_PERSIST_WINDOW_MS = 0;",
    detect: ['freeze-hub', 'freeze-scenarios'] },
  { id: 'M9', what: 'the persisted body\'s key order: fdr before boards', file: 'src/efsp/index.js',
    find: "      boards,\n      fdr: fdrStore.snapshot(),", replace: "      fdr: fdrStore.snapshot(),\n      boards,",
    detect: ['freeze-hub'] },
  { id: 'M10', what: 'a rule dropped from createEfsp()\'s per-Facility wiring (liveStripsForFdr)', file: 'src/efsp/index.js',
    find: "      liveStripsForFdr: (fdrId, excludeStripId) => {", replace: "      _notWired_liveStripsForFdr: (fdrId, excludeStripId) => {",
    detect: ['freeze-guards'] },
  { id: 'M11', what: 'the order-key rebalance threshold 40 -> 400', file: 'src/efsp/order-key.js',
    find: "const REBALANCE_KEY_LENGTH = 40;", replace: "const REBALANCE_KEY_LENGTH = 400;",
    detect: ['freeze-hub'] },
  { id: 'M12', what: 'a permission table row: HELD is also CTR\'s to act on', file: 'src/efsp/permission.js',
    find: "  HELD:              ['CD', 'GND'],", replace: "  HELD:              ['CD', 'GND', 'CTR'],",
    detect: ['freeze-tables', 'freeze-table'] },
  { id: 'M13', what: 'the wire dispatch loses efsp-resync', file: 'src/efsp/efsp-ws.js',
    find: "    case 'efsp-resync':        return _handleResync(ctx, session, msg);\n", replace: "",
    detect: ['freeze-tables', 'freeze-hub'] },
  { id: 'M14', what: 'a new Date.now() site in nla.js', file: 'src/efsp/nla.js',
    find: "module.exports = {", replace: "const _freezeProbe = () => Date.now();\nmodule.exports = {",
    detect: ['freeze-guards'] },
  { id: 'M15', what: 'a Board method outside code uses is renamed (getDeltaSince)', file: 'src/efsp/board-store.js',
    find: "  getDeltaSince(", replace: "  getDeltaSinceRenamed(",
    detect: ['freeze-guards', 'freeze-hub', 'freeze-scenarios'] },
  { id: 'M16', what: 'the allocator hands out a different first beacon code', file: 'src/efsp/fdr-store.js',
    find: "const fdrId = crypto.randomUUID();", replace: "const fdrId = crypto.randomUUID(); crypto.randomUUID();",
    detect: ['freeze-hub', 'freeze-table', 'freeze-scenarios'] },
];

function buildCopy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze-selfcheck-'));
  const dest = path.join(root, 'crc-sync');
  fs.cpSync(CRC_SYNC, dest, { recursive: true, filter: (p) => !/(^|\/)(node_modules|out|\.git)(\/|$)/.test(path.relative(CRC_SYNC, p)) });
  fs.symlinkSync(path.join(CRC_SYNC, 'node_modules'), path.join(dest, 'node_modules'));
  for (const sib of ['atobrief', 'docs']) if (fs.existsSync(path.join(REPO, sib))) fs.symlinkSync(path.join(REPO, sib), path.join(root, sib));
  return { root, dest };
}

/** Every freeze test file in its own process, in parallel; a file fails when its process exits non-zero. */
async function runSuite(dest) {
  const t0 = Date.now();
  const names = fs.readdirSync(path.join(dest, 'tests/freeze')).filter(f => /^freeze-.*\.test\.mjs$/.test(f));
  const results = await Promise.all(names.map(f => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', path.join('tests/freeze', f)], { cwd: dest, stdio: ['ignore', 'pipe', 'pipe'] });
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
