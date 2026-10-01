'use strict';

// "No dropped Mutations" (briefing §5.5). Every message the driver sends with a
// clientMutationId is recorded here; its ack is matched in the same command's
// output (M1), and at the end — and every 30 virtual minutes — the Mutation log
// is STREAMED (readline, never MutationLog.readAll, T12) and reconciled
// against what the acks said (M2-M5).

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const EXAMPLE_CAP = 20;

// Refusals the traffic model walks into on purpose, or that a disconnect
// explains (briefing §5.5 "Refusals are data").
const EXPECTED_REASONS = new Set(['STALE_REV', 'NLA_INHIBITED', 'NOT_HOLDING_POSITION']);

/**
 * A refusal raised at the wire boundary, before any store was consulted. With
 * the metrics tap installed (host-core.js) the tap writes its audit line,
 * `source: 'wire'` (docs/adr/0083).
 */
function wireLevel(ack) {
  if (ack.ok) return false;
  if (ack.reason === 'NOT_HOLDING_POSITION') return true;
  if (ack.reason === 'PERMISSION_DENIED' && /works no flights/.test(ack.detail || '')) return true;
  if (ack.reason === 'VALIDATION_ERROR' && /^no (airspace|correlation|MARSA) store|unknown facilityId/.test(ack.detail || '')) return true;
  return false;
}

class Ledger {
  constructor() {
    this.entries = new Map(); // cmid -> entry
    this.byOp = {};           // opKind -> { ok, refused: { reason: n } }
    this.unexpected = [];     // first EXAMPLE_CAP unexpected refusals, full ack
    this.unexpectedCount = 0;
    this.expectedCount = 0;
    this.lost = 0;
    this.lostExamples = [];
    this.duplicateAck = 0;
    this.internalErrors = 0;
    this.broadcastMissing = 0;
    this.broadcastMissingExamples = [];
    this.replays = [];        // { cmid, kind, originalOk, originalReason, replayOk, replayReason, revBefore, revAfter, lifetime }
    this.replayNotIdempotent = { count: 0, byKind: {}, examples: [] };
    this.replayStaleAck = { count: 0, examples: [] };
    this.r2 = new Set();      // cmids used by the ambiguous-disconnect probe; judged separately
    this.messagesSent = 0;
    this.sentByType = {};
  }

  onSent(msg, clientId, now, lifetime) {
    this.messagesSent++;
    this.sentByType[msg.type] = (this.sentByType[msg.type] || 0) + 1;
    if (!msg.clientMutationId) return;
    if (this.entries.has(msg.clientMutationId)) return; // a replay; the original entry stands
    this.entries.set(msg.clientMutationId, {
      type: msg.type, opKind: msg.op && msg.op.kind, clientId, sentAt: now, lifetime,
      ok: null, reason: null, storeReached: null, stripRev: null, acks: 0,
    });
  }

  /** Called with the acks found for one command's sends; enforces M1. */
  settle(expected, acksByCmid, context) {
    for (const cmid of expected) {
      const acks = acksByCmid.get(cmid) || [];
      if (acks.length === 0) {
        this.lost++;
        if (this.lostExamples.length < EXAMPLE_CAP) this.lostExamples.push({ cmid, ...context });
      } else if (acks.length > 1) {
        this.duplicateAck++;
      }
    }
  }

  onAck(ack, { isReplay = false } = {}) {
    const e = this.entries.get(ack.clientMutationId);
    if (!e) return null;
    if (ack.detail === 'internal error processing mutation' || /internal error processing/.test(ack.detail || '')) this.internalErrors++;
    if (isReplay) return e;
    e.acks++;
    e.ok = !!ack.ok;
    e.reason = ack.reason || null;
    e.detail = ack.detail || null;
    e.storeReached = !wireLevel(ack);
    if (ack.strip) e.stripRev = ack.strip.rev;
    const op = e.opKind || e.type;
    const row = this.byOp[op] || (this.byOp[op] = { ok: 0, refused: {} });
    if (ack.ok) row.ok++;
    else {
      row.refused[ack.reason] = (row.refused[ack.reason] || 0) + 1;
      if (EXPECTED_REASONS.has(ack.reason)) this.expectedCount++;
      else {
        this.unexpectedCount++;
        if (this.unexpected.length < EXAMPLE_CAP) this.unexpected.push({ op, reason: ack.reason, detail: ack.detail, ack: trimAck(ack) });
      }
    }
    return e;
  }

  recordReplay(r) {
    this.replays.push(r);
    const revKnown = r.kind === 'efsp-mutation' && r.revBefore !== null && r.revAfter !== null;
    // A replay of a REFUSED Mutation answers from the idempotency cache with the
    // Strip as it was at the original refusal — older than the Board now. The
    // server did not change, so this is not a lack of idempotency; but the
    // shipped client applies an ack's Strip on refusal too, and goes backwards.
    if (revKnown && r.revAfter < r.revBefore) {
      this.replayStaleAck.count++;
      if (this.replayStaleAck.examples.length < EXAMPLE_CAP) this.replayStaleAck.examples.push(r);
    }
    const bad = r.replayOk !== r.originalOk || (r.replayReason || null) !== (r.originalReason || null) ||
      (revKnown && r.revAfter > r.revBefore);
    if (bad) {
      this.replayNotIdempotent.byKind[r.kind] = (this.replayNotIdempotent.byKind[r.kind] || 0) + 1;
      if (r.kind === 'efsp-mutation') this.replayNotIdempotent.count++;
      if (this.replayNotIdempotent.examples.length < EXAMPLE_CAP) this.replayNotIdempotent.examples.push(r);
    }
  }

  /**
   * Streams the Mutation log (every file matching its basename, in case L5
   * adds rotation — T11) and checks M2-M5.
   */
  async reconcileLog(logPath) {
    const dir = path.dirname(logPath);
    const base = path.basename(logPath);
    const files = fs.readdirSync(dir).filter(f => f.startsWith(base.replace(/\.jsonl$/, ''))).map(f => path.join(dir, f)).sort();
    const lines = new Map(); // cmid -> count
    const sources = new Map(); // cmid -> [source, ...] of the counted lines
    const notPersisted = new Map(); // cmid -> NotPersisted markers
    let total = 0; let nullCmid = 0; let systemLines = 0; let airspaceLines = 0; let parseErrors = 0;
    const nullByOp = {};
    for (const file of files) {
      const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line) continue;
        total++;
        let e;
        try { e = JSON.parse(line); } catch { parseErrors++; continue; }
        if (e.actorId === 'system') systemLines++;
        const cmid = e.clientMutationId;
        if (cmid === null || cmid === undefined) {
          if (e.airspaceId !== undefined && e.stripId === undefined) airspaceLines++;
          nullCmid++;
          nullByOp[e.op] = (nullByOp[e.op] || 0) + 1;
          continue;
        }
        // A boot NotPersisted marker (docs/adr/0081) says one earlier line for
        // this cmid never took effect: it and the line it voids count as none.
        if (e.op === 'NotPersisted') { notPersisted.set(cmid, (notPersisted.get(cmid) || 0) + 1); continue; }
        lines.set(cmid, (lines.get(cmid) || 0) + 1);
        (sources.get(cmid) || sources.set(cmid, []).get(cmid)).push(e.source || null);
      }
    }
    for (const [cmid, k] of notPersisted) {
      const n = (lines.get(cmid) || 0) - k;
      if (n > 0) lines.set(cmid, n); else lines.delete(cmid);
    }

    const res = {
      logLines: total, parseErrors, systemAuditLines: systemLines, nullCmidLines: nullCmid, nullCmidByOp: nullByOp,
      auditMissing: 0, auditDuplicate: 0, auditWrongSource: 0, auditOrphan: 0,
      examples: { auditMissing: [], auditDuplicate: [], auditWrongSource: [], auditOrphan: [] },
      airspace: { logLinesWithoutCmid: airspaceLines }, // must stay 0 now (L6's F12)
      replayAuditLines: {},
    };
    const ex = (k, v) => { if (res.examples[k].length < EXAMPLE_CAP) res.examples[k].push(v); };
    const replayed = new Map();
    for (const r of this.replays) replayed.set(r.cmid, (replayed.get(r.cmid) || 0) + 1);

    for (const [cmid, e] of this.entries) {
      if (this.r2.has(cmid)) continue;
      if (e.ok === null) continue; // never acked — already counted as lost (M1)
      const n = lines.get(cmid) || 0;
      // Airspace reconciles per message like the rest: efsp-ws.js hands the store
      // the clientMutationId and the store audits every answer (docs/adr/0083).
      const extraFromReplay = e.type !== 'efsp-mutation' ? (replayed.get(cmid) || 0) : 0;
      // Production (docs/adr/0083): every answered Mutation leaves exactly one
      // line. A success: its store. A refusal: the store that refused it, or,
      // when none was reached (and for every efsp-mutation refusal, which the
      // board store never logs), the metrics tap, `source: 'wire'`. Anything
      // else — a missing line, two lines, a line from the wrong writer — is a
      // finding; nothing is excused because it is a refusal.
      const expectLines = 1;
      const expectWire = !e.ok && (e.type === 'efsp-mutation' || !e.storeReached);
      if (extraFromReplay && n > expectLines) {
        res.replayAuditLines[e.type] = (res.replayAuditLines[e.type] || 0) + (n - expectLines);
        continue;
      }
      if (n < expectLines) { res.auditMissing++; ex('auditMissing', { cmid, type: e.type, op: e.opKind, ok: e.ok, reason: e.reason, lines: n }); }
      else if (n > expectLines) { res.auditDuplicate++; ex('auditDuplicate', { cmid, type: e.type, op: e.opKind, ok: e.ok, reason: e.reason, lines: n }); }
      else {
        const src = (sources.get(cmid) || [])[0];
        if ((src === 'wire') !== expectWire) { res.auditWrongSource++; ex('auditWrongSource', { cmid, type: e.type, op: e.opKind, ok: e.ok, reason: e.reason, source: src, expectedWire: expectWire }); }
      }
    }
    for (const cmid of lines.keys()) {
      if (!this.entries.has(cmid)) { res.auditOrphan++; ex('auditOrphan', { cmid }); }
    }
    return res;
  }
}

function trimAck(ack) {
  const a = { ...ack };
  if (a.strip) a.strip = { stripId: a.strip.stripId, rev: a.strip.rev, state: a.strip.state, ownerPositionId: a.strip.ownerPositionId, bayId: a.strip.bayId, role: a.strip.role };
  if (a.fdr) a.fdr = { fdrId: a.fdr.fdrId };
  delete a.correlation; delete a.airspace; delete a.marsa;
  return a;
}

module.exports = { Ledger, wireLevel, EXPECTED_REASONS };
