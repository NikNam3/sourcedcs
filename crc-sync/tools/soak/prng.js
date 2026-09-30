'use strict';

// Seeded randomness for the soak. mulberry32: 32-bit state, fast, and good
// enough for traffic generation — the soak needs reproducibility, not crypto.
// No dependency on purpose (crc-sync keeps its dependency list short; see
// src/efsp/order-key.js's header).

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive an independent stream from a seed and a label, so adding a draw in one subsystem does not shift every other subsystem's sequence. */
function deriveSeed(seed, label) {
  let h = (seed >>> 0) ^ 0x9E3779B9;
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 0x85EBCA6B);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

class Rng {
  constructor(seed, label = '') {
    this._next = mulberry32(label ? deriveSeed(seed, label) : seed);
  }
  float() { return this._next(); }
  /** Uniform in [a, b). */
  uniform(a, b) { return a + (b - a) * this._next(); }
  /** Integer in [a, b] inclusive. */
  int(a, b) { return a + Math.floor(this._next() * (b - a + 1)); }
  chance(p) { return this._next() < p; }
  pick(arr) { return arr.length ? arr[Math.floor(this._next() * arr.length)] : undefined; }
  /** Weighted pick from [[value, weight], ...]. */
  weighted(pairs) {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let r = this._next() * total;
    for (const [v, w] of pairs) { r -= w; if (r < 0) return v; }
    return pairs[pairs.length - 1][0];
  }
  /** Exponentially distributed with the given mean. */
  exp(mean) { return -mean * Math.log(1 - this._next()); }
  /** Exponential with the given mean, clamped into [lo, hi] — the profiles' "think time" shape. */
  expBetween(lo, hi) {
    const mean = (lo + hi) / 3;
    return Math.min(hi, lo + this.exp(mean));
  }
}

module.exports = { Rng, mulberry32, deriveSeed };
