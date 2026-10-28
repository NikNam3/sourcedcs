'use strict';

// Angle helpers for the carrier model (docs/adr/0064). Pure maths, shared by
// ship-state.js and marshal-stack.js.
//
// Reference frames. Every bearing the carrier model STORES or COMPUTES is in
// degrees TRUE (decisions H15: "compute in true and convert at display with
// the variation"). The only conversion to magnetic happens at the display
// edge, in toMagnetic(), with the magnetic variation passed in by the caller
// (decisions S-W3: the per-theater variation table does not exist yet, so it
// is an injected input, never a constant here). The other conversion this
// file offers is gridToTrue(): DCS-gRPC's `orientation.heading` is a
// flat-world GRID heading (protos/dcs/common/v0/common.proto:418-424), and
// grid differs from true by the theater projection's grid convergence.
//
// Storage uses 0 for north; "360" instead of "000" is a rendering convention
// and belongs to whoever renders.

/** → [0, 360); non-finite (or non-number) → null. */
function normDeg(deg) {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) return null;
  const r = deg % 360;
  const n = r < 0 ? r + 360 : r;
  return n === 360 || Object.is(n, -0) ? 0 : n;
}

/** → normDeg(deg + 180); null in → null out. */
function reciprocal(deg) {
  const n = normDeg(deg);
  return n == null ? null : normDeg(n + 180);
}

/** Smallest absolute difference between two bearings, in [0, 180]; null if either is unknown. */
function angularDiff(a, b) {
  const x = normDeg(a);
  const y = normDeg(b);
  if (x == null || y == null) return null;
  const d = Math.abs(x - y) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Grid → true. `gridConvergenceDeg` is the angle from true north to grid north,
 * positive when grid north lies EAST of true north (so true = grid + γ).
 * Unknown convergence → null: the caller decides whether to fall back to the
 * grid value under a GRID label; this function never guesses.
 */
function gridToTrue(gridDeg, gridConvergenceDeg) {
  if (typeof gridConvergenceDeg !== 'number' || !Number.isFinite(gridConvergenceDeg)) return null;
  const g = normDeg(gridDeg);
  return g == null ? null : normDeg(g + gridConvergenceDeg);
}

/**
 * True → magnetic, for DISPLAY only (decisions H15). `variationDeg` is
 * positive EAST (magnetic = true − east variation). Unknown variation → null,
 * so a display can say "variation unknown" rather than print a true bearing
 * as if it were magnetic.
 */
function toMagnetic(trueDeg, variationDeg) {
  if (typeof variationDeg !== 'number' || !Number.isFinite(variationDeg)) return null;
  const t = normDeg(trueDeg);
  return t == null ? null : normDeg(t - variationDeg);
}

module.exports = { normDeg, reciprocal, angularDiff, gridToTrue, toMagnetic };
