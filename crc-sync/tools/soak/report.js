'use strict';

// report.json (the single source of truth; keep key names stable, the
// integrator diffs runs) and summary.txt (<= 60 lines), briefing §9. The
// verdict names each failing check with its numbers (§7).

const fs = require('fs');
const path = require('path');
const { ols, r2, r3 } = require('./metrics');

// Thresholds (briefing §7 / §10 Q5), overridable by flag. Rationale beside each.
const THRESHOLDS = {
  heapSlopeMBPerHour: 1.0,  // WP8 "no memory growth": a fixed-size Board should not grow a MB an hour
  netGrowthPct: 25,         // ... nor end more than 25% above its post-warm-up baseline: H72 — the 2 h archive
                            // retention (H36) fills for 2 h before it plateaus, about +18% by itself
  maxKeyLen: 40,            // order-key.js REBALANCE_KEY_LENGTH: the length the module itself calls "needs rebalance"
  codePoolPct: 50,          // CodeAllocator's 4096-code pool must stay under half used
  p99WarnMs: 50,            // guide §7.9's remote-change budget is 200 ms; warn at a quarter of it
  p99FailMs: 200,
  logRingMax: 2000,         // board-store _pruneLog
  appliedMax: 5000,         // board-store APPLIED_MUTATIONS_CAP
};

function build(d, meta) {
  const L = d.ledger;
  const lr = d.logRecon;
  const s = d.stats;
  const runMin = meta.minutes;
  const warmupMin = Math.max(runMin * 0.1, Math.min(20, runMin * 0.25));

  // ── memory ──────────────────────────────────────────────────────────
  // A restart is a new process with a new heap, so a fit across it is
  // meaningless. The series is the post-warm-up part of the host lifetime that
  // has the most samples (in a one-restart run, usually the one after it).
  const lifeOf = new Map();
  for (const x of d.samples) if (x.tMin >= warmupMin) lifeOf.set(x.lifetime, (lifeOf.get(x.lifetime) || 0) + 1);
  const life = [...lifeOf.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  const lifetime = life ? life[0] : 1;
  const inLife = d.samples.filter(x => x.tMin >= warmupMin && x.lifetime === lifetime);
  const heavy = inLife.filter(x => x.heavy);
  const light = inLife.filter(x => !x.heavy);
  const memSeries = heavy.length >= 4 ? heavy : light; // fall back to light samples in a very short run
  const xs = memSeries.map(x => x.tMin / 60);
  const heapMB = memSeries.map(x => x.mem.heapUsed / 1048576);
  const fit = ols(xs, heapMB);
  const dropped = memSeries.map(x => x.counts['strips.dropped']);
  const onDropped = ols(dropped, heapMB);
  const droppedFit = ols(xs, dropped);
  const perDroppedKB = onDropped.slope * 1024;
  const residual = fit.slope - (onDropped.slope * droppedFit.slope);
  const baseline = heapMB.length ? heapMB[0] : null;
  const end = heapMB.length ? heapMB[heapMB.length - 1] : null;
  const netGrowthPct = baseline ? ((end - baseline) / baseline) * 100 : null;
  const structures = {};
  const allCounts = d.samples.filter(x => x.tMin >= warmupMin);
  if (allCounts.length) {
    for (const k of Object.keys(allCounts[0].counts)) {
      const ys = allCounts.map(x => x.counts[k]);
      const f = ols(allCounts.map(x => x.tMin / 60), ys);
      structures[k] = { start: ys[0], end: ys[ys.length - 1], max: Math.max(...ys), slopePerHour: r2(f.slope) };
    }
  }
  const snaps = d.samples.filter(x => x.heavy && x.snapshotBytes);
  const first = (k) => (snaps.length ? snaps[0][k] : null);
  const last = (k) => (snaps.length ? snaps[snaps.length - 1][k] : null);

  // ── order keys ──────────────────────────────────────────────────────
  let maxLen = 0; let worst = null; let p99 = 0; let hist = {}; let rebalances = 0; let exhausted = 0; let rebalancedStrips = 0;
  const overAt = [];
  for (const x of d.samples) {
    const o = x.orderKeys;
    if (o.maxLen > maxLen) { maxLen = o.maxLen; worst = o.worstRack; }
    p99 = Math.max(p99, o.p99Len);
    rebalances = o.rebalances; exhausted = o.exhaustedThrows; rebalancedStrips = o.rebalancedStrips;
    hist = o.histogram;
    if (o.maxLen > (meta.thresholds.maxKeyLen)) overAt.push(x.tMin);
  }
  // Rebalance counters are per host lifetime; sum across restarts.
  const byLife = new Map();
  for (const x of d.samples) byLife.set(x.lifetime, x.orderKeys);
  rebalances = 0; exhausted = 0; rebalancedStrips = 0;
  for (const o of byLife.values()) { rebalances += o.rebalances; exhausted += o.exhaustedThrows; rebalancedStrips += o.rebalancedStrips; }

  // ── latency ─────────────────────────────────────────────────────────
  const windows = d.latency.summary();
  const worstP99 = Math.max(0, ...windows.map(w => w.p99 || 0));
  const worstPersistP99 = Math.max(0, ...windows.map(w => w.persistP99 || 0));

  const internalErrors = L.internalErrors + (d.hostInternalErrors || 0);
  const maxCodes = Math.max(0, ...d.samples.map(x => x.counts['codes.allocated']));
  const maxLog = Math.max(0, ...d.samples.map(x => x.counts['log.max']));
  const maxApplied = Math.max(0, ...d.samples.map(x => x.counts['appliedMutations.max']));
  const maxCid = Math.max(0, ...d.samples.map(x => x.counts['cidSeq.max']));
  const nlaHistEnd = d.samples.length ? d.samples[d.samples.length - 1].counts : {};

  const report = {
    harness: {
      version: 1, commit: meta.commit, node: process.version, argv: meta.argv,
      mode: meta.inproc ? 'inproc' : 'fork', transport: 'wshub', clock: meta.realtime ? 'realtime' : 'virtual',
      diagnostics: meta.pruneRetired ? ['prune-retired (DIAGNOSTIC ONLY: DROPPED Strips and orphan FDRs deleted every 10 min — never a fix)'] : [],
      inject: meta.inject || null,
      notes: [
        'Server Math.random replaced by a seeded PRNG and Date.now by the virtual clock (briefing D2/D5) — not production behaviour.',
        ...(meta.inproc ? ['--inproc: heap numbers include the driver (T7).'] : []),
      ],
      stateDir: meta.keepState ? meta.stateDir : null,
      thresholds: meta.thresholds,
    },
    run: {
      seed: meta.seed, profile: meta.profile, crew: d.crewName, simulatedMinutes: meta.minutes, wallSeconds: r2(d.wallSeconds),
      trafficDigest: d.trafficDigest, restarts: s.restarts, reconnects: s.reconnects, disconnects: s.disconnects,
      missionReloads: s.missionReloads, manningChurn: s.manningChurn, conflictsInjected: s.conflictsInjected,
    },
    traffic: {
      flightsStarted: s.flightsStarted, flightsCompleted: s.flightsCompleted, flightsAborted: s.flightsAborted, byScript: s.byScript,
      messagesSent: L.messagesSent, sentByType: L.sentByType, byOp: L.byOp,
      refusals: { expected: L.expectedCount, unexpected: L.unexpectedCount, unexpectedExamples: L.unexpected },
      doubleTapNoop: s.doubleTapNoop, doubleTapNotGuarded: s.doubleTapNotGuarded, undo: s.undo,
      storms: s.storms, stormMoves: s.stormMoves, janitorDrops: s.janitorDrops,
      coveringStranded: s.coveringStranded || 0, coveringHandedBack: s.coveringHandedBack || 0,
      orphans: [...s.orphans.values()].filter(o => !o.resolved).length, orphansEver: s.orphans.size,
      orphanExamples: [...s.orphans.entries()].slice(0, 10).map(([id, o]) => ({ stripId: id, ...o })),
      liveStrips: { min: s.liveStrips.min === Infinity ? 0 : s.liveStrips.min, max: s.liveStrips.max, end: s.liveStrips.end, slopePerHour: r2(ols(s.liveStrips.series.filter(p => p[0] / 60 >= warmupMin).map(p => p[0] / 3600), s.liveStrips.series.filter(p => p[0] / 60 >= warmupMin).map(p => p[1])).slope) },
      sky: d.sky.stats,
    },
    mutations: {
      lost: L.lost, lostExamples: L.lostExamples, duplicateAck: L.duplicateAck,
      auditMissing: lr.auditMissing, auditDuplicate: lr.auditDuplicate, auditForRefusal: lr.auditForRefusal, auditOrphan: lr.auditOrphan,
      auditExamples: lr.examples, systemAuditLines: lr.systemAuditLines, nullCmidLines: lr.nullCmidLines, nullCmidByOp: lr.nullCmidByOp,
      airspaceAudit: lr.airspace, logLines: lr.logLines, replayAuditLines: lr.replayAuditLines,
      internalErrors, storeInternalErrors: d.hostStoreInternalErrors || 0,
      replays: L.replays.length, replayNotIdempotent: L.replayNotIdempotent, replayStaleAck: L.replayStaleAck,
      broadcastMissing: L.broadcastMissing, broadcastMissingExamples: L.broadcastMissingExamples,
      silentStaleness: { count: s.silentStaleness.count, byCause: s.silentStaleness.byCause, maxPersistSec: r2(s.silentStaleness.maxPersistMs / 1000), examples: s.silentStaleness.examples },
      shadowRegressions: [...d.clients.values()].reduce((n, c) => n + c.shadow.regressions, 0),
      uncarriedSideEffects: s.uncarried,
      resync: s.resync,
      restart: s.restart,
      injectedShadowDrops: s.injectedShadowDrops,
    },
    orderKeys: { maxLen, p99Len: p99, threshold: meta.thresholds.maxKeyLen, rebalances, rebalancedStrips, exhaustedThrows: exhausted, histogram: hist, worstRack: worst, firstOverThresholdMin: overAt.length ? overAt[0] : null, series: 'timeline.ndjson#orderKeys' },
    memory: {
      warmupMinutes: r2(warmupMin), lifetime, fromMin: inLife.length ? inLife[0].tMin : null, toMin: inLife.length ? inLife[inLife.length - 1].tMin : null, series: memSeries === heavy ? 'post-GC heavy samples' : 'light samples (too few heavy samples)', points: memSeries.length,
      baselineHeapMB: r2(baseline), endHeapMB: r2(end), slopeMBPerHour: r2(fit.slope), r2: r3(fit.r2), netGrowthPct: r2(netGrowthPct),
      perDroppedStripKB: r2(perDroppedKB), residualSlopeMBPerHour: r2(residual),
      structures,
      snapshotBytes: { start: first('snapshotBytes'), end: last('snapshotBytes') },
      boardFileBytes: { start: first('boardFileBytes'), end: last('boardFileBytes') },
      mutationLogBytes: { start: first('mutationLogBytes'), end: last('mutationLogBytes') },
      persistBytesWritten: d.samples.length ? d.samples[d.samples.length - 1].persistBytes : 0,
      maxAllocatedCodes: maxCodes, maxLogRing: maxLog, maxAppliedMutations: maxApplied, maxCidSeq: maxCid,
      nlaHistoryEnd: nlaHistEnd['nlaHistory'], nlaHistoryDroppedEnd: nlaHistEnd['nlaHistory.dropped'],
    },
    latency: { windows: windows.map(w => ({ fromMin: w.fromMin, n: w.n, p50: w.p50, p95: w.p95, p99: w.p99, max: w.max, persistP50: w.persistP50, persistP99: w.persistP99, persistMax: w.persistMax })), worstP99, worstPersistP99, byTypeLastWindow: windows.length ? windows[windows.length - 1].byType : {} },
    correlation: {
      rateMin: r3(s.correlation.rateMin), rateMean: s.correlation.rateN ? r3(s.correlation.rateSum / s.correlation.rateN) : null,
      rebinds: s.correlation.rebinds, last: s.correlation.last, misbinding: s.misbinding.count, misbindingByCause: s.misbinding.byCause, misbindingExamples: s.misbinding.examples,
    },
    alerts: { ...s.alerts, alertsMsgs: s.alertsMsgs, obligationAlerts: s.obligationAlerts },
    hostConsole: d.consoleStats,
  };

  // ── hypotheses H1-H8 (briefing §5.9) ─────────────────────────────────
  const ss = report.mutations.silentStaleness;
  const R2 = s.restart.ambiguousReplay;
  const dropStart = structures['strips.dropped'];
  report.hypotheses = {
    H1: rebalances === 0 ? 'not-exercised' : ((ss.byCause.REBALANCE_SIDE_EFFECT || 0) > 0 || (s.uncarried.byCause.REBALANCE_SIDE_EFFECT || 0) > 0 ? 'confirmed' : 'refuted'),
    H2: maxLen > meta.thresholds.maxKeyLen ? 'confirmed' : (maxLen > 20 ? 'partially (keys grow, threshold not reached)' : 'refuted'),
    H3: dropStart && dropStart.end > dropStart.start && report.memory.snapshotBytes.end > report.memory.snapshotBytes.start ? 'confirmed' : 'not-exercised',
    H4: s.resync.acrossRestartDivergence.count > 0 ? 'confirmed' : (s.resync.acrossRestartDivergence.probes > 0 ? 'refuted' : 'not-exercised'),
    H5: R2.some(x => x.op === 'CreateStrip' && x.outcome === 'appliedTwice') ? 'confirmed' : (R2.some(x => x.op === 'CreateStrip') ? 'refuted' : 'not-exercised'),
    H6: nlaHistEnd['nlaHistory.dropped'] > 0 ? 'confirmed' : (s.flightsCompleted > 0 ? 'refuted' : 'not-exercised'),
    H7: maxCid > 999 ? 'confirmed' : `not reached (max _cidSeq ${maxCid})`,
    H8: s.misbinding.count > 0 ? ((s.misbinding.byCause.LINGERING_TRACK || 0) > 0 ? 'confirmed' : 'misbindings seen, none via a lingering track') : (s.flightsCompleted > 0 ? 'refuted' : 'not-exercised'),
  };

  // ── verdict (§7) ─────────────────────────────────────────────────────
  const T = meta.thresholds;
  const failures = []; const warnings = [];
  const gate = (cond, text) => { if (cond) failures.push(text); };
  gate(L.lost > 0, `mutations.lost ${L.lost} > 0`);
  gate(L.duplicateAck > 0, `mutations.duplicateAck ${L.duplicateAck} > 0`);
  gate(lr.auditMissing > 0, `mutations.auditMissing ${lr.auditMissing} > 0`);
  gate(lr.auditDuplicate > 0, `mutations.auditDuplicate ${lr.auditDuplicate} > 0`);
  gate(lr.auditForRefusal > 0, `mutations.auditForRefusal ${lr.auditForRefusal} > 0`);
  gate(lr.auditOrphan > 0, `mutations.auditOrphan ${lr.auditOrphan} > 0`);
  gate(internalErrors > 0, `mutations.internalErrors ${internalErrors} > 0 (order-key exhaustion or another store catch-all)`);
  gate(L.replayNotIdempotent.count > 0, `mutations.replayNotIdempotent ${L.replayNotIdempotent.count} > 0`);
  gate(L.broadcastMissing > 0, `mutations.broadcastMissing ${L.broadcastMissing} > 0`);
  gate(ss.count > 0, `mutations.silentStaleness ${ss.count} > 0 (${Object.entries(ss.byCause).map(([k, v]) => `${k}:${v}`).join(', ')})`);
  gate(s.resync.resyncDivergence > 0, `mutations.resync.resyncDivergence ${s.resync.resyncDivergence} > 0`);
  gate(s.resync.acrossRestartDivergence.count > 0, `mutations.resync.acrossRestartDivergence ${s.resync.acrossRestartDivergence.count} > 0 (H4)`);
  gate(s.restart.boardLostOnRestart > 0, `mutations.restart.boardLostOnRestart ${s.restart.boardLostOnRestart} > 0`);
  gate(maxLen > T.maxKeyLen, `orderKeys.maxLen ${maxLen} > ${T.maxKeyLen} (worst ${worst})`);
  if (memSeries.length >= 3) {
    gate(fit.slope > T.heapSlopeMBPerHour, `memory.slope ${r2(fit.slope)} MB/h > ${T.heapSlopeMBPerHour} (R² ${r3(fit.r2)}; per-DROPPED-Strip ${r2(perDroppedKB)} KB, residual ${r2(residual)} MB/h)`);
    gate(netGrowthPct > T.netGrowthPct, `memory.netGrowth ${r2(netGrowthPct)}% > ${T.netGrowthPct}%`);
  } else warnings.push(`memory: only ${memSeries.length} post-warm-up samples — heap growth not judged`);
  gate(maxLog > T.logRingMax, `structure log ring ${maxLog} > ${T.logRingMax}`);
  gate(maxApplied > T.appliedMax, `structure appliedMutations ${maxApplied} > ${T.appliedMax}`);
  gate(maxCodes > 4096 * T.codePoolPct / 100, `codes.allocated ${maxCodes} > ${T.codePoolPct}% of the pool`);
  gate(worstP99 > T.p99FailMs, `latency p99 ${worstP99} ms > ${T.p99FailMs} ms`);
  if (worstP99 > T.p99WarnMs && worstP99 <= T.p99FailMs) warnings.push(`latency p99 ${worstP99} ms > ${T.p99WarnMs} ms`);
  if (report.traffic.orphans > 0) warnings.push(`orphans ${report.traffic.orphans} (live Strips the janitor could not drop)`);
  if (meta.profile !== 'smoke' && (s.resync.delta === 0 || s.resync.snapshot === 0)) warnings.push(`resync paths: delta ${s.resync.delta}, snapshot ${s.resync.snapshot} — both should be > 0`);
  if (L.replayNotIdempotent.examples.some(x => x.kind !== 'efsp-mutation')) warnings.push(`non-Board replays not idempotent: ${JSON.stringify(L.replayNotIdempotent.byKind)}`);
  if (lr.replayAuditLines && Object.keys(lr.replayAuditLines).length) warnings.push(`replays wrote extra audit lines: ${JSON.stringify(lr.replayAuditLines)}`);
  if (L.replayStaleAck.count > 0) warnings.push(`replayStaleAck ${L.replayStaleAck.count}: a replayed refusal answered with an older Strip than the Board holds`);
  if (s.doubleTapNotGuarded > 0) failures.push(`doubleTapNotGuarded ${s.doubleTapNotGuarded} > 0`);
  report.verdict = { pass: failures.length === 0, failures, warnings, informational: { ambiguousReplay: R2 } };
  return report;
}

function summary(rep, outDir) {
  const v = rep.verdict;
  const m = rep.mutations; const k = rep.orderKeys; const mem = rep.memory; const t = rep.traffic;
  const L = [];
  L.push(`SOAK ${v.pass ? 'PASS' : 'FAIL'} ${rep.run.profile} ${rep.run.simulatedMinutes}m seed=${rep.run.seed} in ${rep.run.wallSeconds}s`);
  L.push(`crew=${rep.run.crew} mode=${rep.harness.mode} clock=${rep.harness.clock}${rep.harness.inject ? ` inject=${rep.harness.inject}` : ''}${rep.harness.diagnostics.length ? ' DIAGNOSTIC:prune-retired' : ''} digest=${rep.run.trafficDigest.slice(0, 16)}`);
  L.push('');
  L.push('check                         actual                     threshold');
  const row = (a, b, c) => L.push(`${a.padEnd(30)}${String(b).padEnd(27)}${c}`);
  row('lost / duplicateAck', `${m.lost} / ${m.duplicateAck}`, '0');
  row('audit missing/dup/refusal/orph', `${m.auditMissing}/${m.auditDuplicate}/${m.auditForRefusal}/${m.auditOrphan}`, '0');
  row('internalErrors', m.internalErrors, '0');
  row('replays / notIdempotent', `${m.replays} / ${m.replayNotIdempotent.count}`, '0');
  row('broadcastMissing', m.broadcastMissing, '0');
  row('silentStaleness', `${m.silentStaleness.count} ${JSON.stringify(m.silentStaleness.byCause)}`, '0');
  row('resync delta/snapshot/diverge', `${m.resync.delta}/${m.resync.snapshot}/${m.resync.resyncDivergence}`, 'div 0');
  row('acrossRestartDivergence (H4)', `${m.resync.acrossRestartDivergence.count} (probes ${m.resync.acrossRestartDivergence.probes})`, '0');
  row('boardLostOnRestart', m.restart.boardLostOnRestart, '0');
  row('R2 ambiguous replay', m.restart.ambiguousReplay.map(x => `${x.op}:${x.outcome}`).join(' ') || '-', 'reported');
  row('orderKeys max / p99', `${k.maxLen} / ${k.p99Len} (${k.worstRack})`, `<= ${k.threshold}`);
  row('rebalances / exhausted throws', `${k.rebalances} / ${k.exhaustedThrows}`, 'info');
  row('heap slope (post-GC)', `${mem.slopeMBPerHour} MB/h R²=${mem.r2}`, `<= ${rep.harness.thresholds.heapSlopeMBPerHour}`);
  row('heap net growth', `${mem.netGrowthPct}% (${mem.baselineHeapMB}->${mem.endHeapMB} MB)`, `<= ${rep.harness.thresholds.netGrowthPct}%`);
  row('per-DROPPED-Strip / residual', `${mem.perDroppedStripKB} KB / ${mem.residualSlopeMBPerHour} MB/h`, 'attribution');
  row('snapshot bytes start->end', `${mem.snapshotBytes.start}->${mem.snapshotBytes.end}`, 'info');
  row('codes allocated (max)', mem.maxAllocatedCodes, '<= 2048');
  row('latency worst p99 / persist', `${rep.latency.worstP99} / ${rep.latency.worstPersistP99} ms`, '<= 200 (warn 50)');
  row('flights started/done/aborted', `${t.flightsStarted}/${t.flightsCompleted}/${t.flightsAborted}`, 'info');
  row('live Strips min/max/end', `${t.liveStrips.min}/${t.liveStrips.max}/${t.liveStrips.end}`, 'stationary');
  row('orphans', t.orphans, 'warn > 0');
  row('messages sent', t.messagesSent, 'info');
  row('correlation rate min/mean', `${rep.correlation.rateMin}/${rep.correlation.rateMean}`, 'info');
  row('misbinding (H8)', `${rep.correlation.misbinding} ${JSON.stringify(rep.correlation.misbindingByCause)}`, 'info');
  L.push('');
  L.push(`hypotheses: ${Object.entries(rep.hypotheses).map(([h, s]) => `${h}=${s}`).join('; ')}`);
  L.push('');
  if (v.failures.length) { L.push('FAILURES:'); for (const f of v.failures.slice(0, 12)) L.push(`  - ${f}`); }
  if (v.warnings.length) { L.push('WARNINGS:'); for (const w of v.warnings.slice(0, 6)) L.push(`  - ${w}`); }
  L.push('');
  L.push(`output: ${outDir}`);
  return L.slice(0, 60).join('\n') + '\n';
}

function write(outDir, rep) {
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(rep, null, 2));
  const text = summary(rep, outDir);
  fs.writeFileSync(path.join(outDir, 'summary.txt'), text);
  return text;
}

module.exports = { build, write, summary, THRESHOLDS };
