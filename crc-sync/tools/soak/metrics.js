'use strict';

// Statistics for the verdict (briefing §5.7, §7): ordinary least squares,
// percentiles, latency windows.

/** OLS fit y = a + b·x. Returns { slope, intercept, r2, n }. */
function ols(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { slope: 0, intercept: n ? ys[0] : 0, r2: 0, n };
  let sx = 0; let sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n; const my = sy / n;
  let sxx = 0; let sxy = 0; let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx; const dy = ys[i] - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  if (sxx === 0) return { slope: 0, intercept: my, r2: 0, n };
  const slope = sxy / sxx;
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept: my - slope * mx, r2, n };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

/** Latency samples bucketed into fixed virtual-time windows, per message type. Stores numbers only. */
class Latency {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.windows = new Map(); // index -> { byType: Map(type -> number[]), persist: number[] }
  }
  _w(t0, now) {
    const i = Math.floor((now - t0) / this.windowMs);
    let w = this.windows.get(i);
    if (!w) { w = { byType: new Map(), persist: [] }; this.windows.set(i, w); }
    return w;
  }
  add(t0, now, type, ms) {
    const w = this._w(t0, now);
    let a = w.byType.get(type);
    if (!a) { a = []; w.byType.set(type, a); }
    a.push(ms);
  }
  addPersist(t0, now, list) { const w = this._w(t0, now); for (const ms of list) w.persist.push(ms); }
  summary() {
    const out = [];
    for (const [i, w] of [...this.windows.entries()].sort((a, b) => a[0] - b[0])) {
      const all = [];
      const byType = {};
      for (const [type, arr] of w.byType) {
        const s = arr.slice().sort((a, b) => a - b);
        all.push(...arr);
        byType[type] = { n: s.length, p50: r3(percentile(s, 0.5)), p95: r3(percentile(s, 0.95)), p99: r3(percentile(s, 0.99)), max: r3(s[s.length - 1]) };
      }
      all.sort((a, b) => a - b);
      const ps = w.persist.slice().sort((a, b) => a - b);
      out.push({
        fromMin: (i * this.windowMs) / 60000,
        n: all.length,
        p50: r3(percentile(all, 0.5)), p95: r3(percentile(all, 0.95)), p99: r3(percentile(all, 0.99)), max: r3(all[all.length - 1]),
        persistN: ps.length, persistP50: r3(percentile(ps, 0.5)), persistP99: r3(percentile(ps, 0.99)), persistMax: r3(ps[ps.length - 1]),
        byType,
      });
    }
    return out;
  }
}

function r3(x) { return x === null || x === undefined ? null : Math.round(x * 1000) / 1000; }
function r2(x) { return x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 100) / 100; }

module.exports = { ols, percentile, Latency, r2, r3 };
