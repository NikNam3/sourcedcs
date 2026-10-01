// Preload (node --import) used by freeze-scenarios.test.mjs. Test-side only: it wraps
// createEfsp() from the outside, never edits production code.
//
// What it does to the process it is preloaded into:
//   * makes the run deterministic: crypto.randomUUID -> counter, Math.random -> seeded,
//     Date.now -> a fixed virtual instant that only moves when a (collapsed) timer "waits";
//   * records, per createEfsp() instance, every handleMessage() call as one step
//     { in, out, audit }, where audit is what mutationLog.record() was handed during the step;
//   * at exit writes { instances: [{ steps, finalState }] } to $FREEZE_OUT.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const Module = require('node:module');

import './freeze-determinism.mjs';

const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const instances = [];

function wrap(efsp) {
  const rec = { steps: [], orphanAudit: [], efsp };
  let current = null;
  const log = efsp.mutationLog;
  const realRecord = log.record.bind(log);
  log.record = (entry) => {
    (current ? current.audit : rec.orphanAudit).push(clone(entry));
    return realRecord(entry);
  };
  const realHandle = efsp.handleMessage;
  efsp.handleMessage = (session, msg) => {
    const step = { session: { controllerId: session && session.controllerId }, in: clone(msg), audit: [] };
    const prev = current; current = step;
    try {
      const out = realHandle(session, msg);
      step.out = clone(out);
      return out;
    } catch (e) {
      step.threw = String(e && e.message);
      throw e;
    } finally { current = prev; rec.steps.push(step); }
  };
  instances.push(rec);
  return efsp;
}

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const exp = realLoad.apply(this, arguments);
  if (exp && typeof exp.createEfsp === 'function' && exp.BOARD_SNAPSHOT_PATH && !exp.createEfsp.__freeze) {
    const orig = exp.createEfsp;
    exp.createEfsp = function (...a) { return wrap(orig.apply(this, a)); };
    exp.createEfsp.__freeze = true;
  }
  return exp;
};

function finalState(efsp) {
  const out = { boards: {}, fdr: null };
  try {
    for (const f of require('../../src/efsp/facility-config.js').getFacilityIds()) {
      const b = efsp.boardStoreFor(f);
      if (b) out.boards[f] = clone(b.snapshot());
    }
    out.fdr = clone(efsp.fdrStore.snapshot());
    out.airspaces = clone(efsp.airspaceStore.snapshot());
    out.correlations = clone(efsp.correlationStore.snapshot());
    out.marsa = clone(efsp.marsaStore.snapshot());
    out.fieldStates = clone(efsp.fieldStateStore.snapshot());
    out.carriers = clone(efsp.carrierStore.snapshot());
  } catch (e) { out.error = String(e && e.message); }
  return out;
}

process.on('exit', () => {
  const dest = process.env.FREEZE_OUT;
  if (!dest) return;
  const data = { instances: instances.map(r => ({ steps: r.steps, orphanAudit: r.orphanAudit, finalState: finalState(r.efsp) })) };
  fs.writeFileSync(dest, JSON.stringify(data));
});
