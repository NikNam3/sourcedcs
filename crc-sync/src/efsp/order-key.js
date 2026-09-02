'use strict';

// Fractional-index ("LexoRank"-style) order keys for Strip ordering within a
// Rack (EFSPImplementationGuide.md §5.4) — hand-rolled rather than an npm
// dependency: crc-sync has exactly 6 dependencies today and no
// ordering/CRDT-adjacent library anywhere, and this is a small, auditable
// base62 midpoint routine consistent with the codebase's existing
// hand-rolled-Map-logic style (see tracks.js/collab-store.js).
//
// Keys are strings drawn from ALPHA, compared with plain JS string `<`. Two
// controllers inserting "at the same slot" concurrently each call
// keyBetween() against the same (a, b) bounds and (almost always) get back
// two *different* keys — random jitter on the chosen digit, see _jitter()
// — so both survive with no reindex broadcast (guide's WP1 acceptance:
// "two clients inserting at the same slot both survive with no reindex").
// A jitter collision (~1-in-62) just ties the sort order cosmetically;
// board-store.js breaks ties by stripId for a deterministic total order.
//
// Known limit — by design, not oversight: repeatedly inserting strictly
// *before* the current minimum key in the same Rack, many times in a row,
// eventually exhausts the headroom this scheme can represent (there is no
// string that sorts below a key made entirely of the minimum digit).
// keyBetween() throws an Error with `.code === 'ORDER_KEY_EXHAUSTED'` in
// that case rather than silently returning a key in the wrong position —
// callers MUST catch it, rebalance() the Rack, and retry. needsRebalance()
// below is a cheaper, proactive check (key length) meant to trigger a
// rebalance long before any realistic Rack (tens of Strips) gets close to
// the throwing case at all.

const ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = ALPHA.length; // 62
const MID = Math.floor(BASE / 2); // 31 — keyStart()'s seed value

function valAt(str, i) {
  return i < str.length ? ALPHA.indexOf(str[i]) : 0;
}

// Not cryptographic — just needs to not always return the same value so
// concurrent same-slot inserts diverge.
function _jitter() {
  return Math.floor(Math.random() * BASE);
}

// A digit value strictly between lo and hi (lo < hi), nudged by jitter.
// Returns null if there is no integer strictly between them (hi - lo < 2) —
// caller must recurse to the next digit position instead.
function _midDigit(lo, hi) {
  const span = hi - lo;
  if (span < 2) return null;
  const offset = 1 + (_jitter() % (span - 1));
  return lo + offset;
}

// Seed key for the first Strip ever placed in an empty Rack.
function keyStart() { return ALPHA[MID]; }

/**
 * Generates a key that sorts strictly between `a` and `b`.
 *   a === null  → "insert before everything currently in the Rack"
 *   b === null  → "insert after everything currently in the Rack"
 *   both null   → "first Strip in an empty Rack"
 * Throws (plain Error, non-ORDER_KEY_EXHAUSTED) if a >= b — a caller bug,
 * never true for two keys actually drawn from the same Rack.
 */
function keyBetween(a, b) {
  if (a === null && b === null) return keyStart();
  if (a !== null && b !== null && a >= b) {
    throw new Error(`order-key: keyBetween requires a < b (got ${JSON.stringify(a)}, ${JSON.stringify(b)})`);
  }

  // Insert after everything: a strict prefix always sorts before the
  // longer string it's a prefix of, so appending anything to `a` is
  // guaranteed to sort after it — robust no matter what `a` ends in, and
  // never needs headroom (asymmetric with the "insert before" case below).
  if (b === null) return a + ALPHA[_jitter()];

  // Insert before everything: digit-by-digit headroom below `b`'s digits,
  // recursing deeper only when a digit position has no room below it
  // (digit 0, the global minimum, blocks that position outright).
  if (a === null) {
    let prefix = '';
    for (let i = 0; ; i++) {
      const hiDigit = valAt(b, i);
      const mid = _midDigit(0, hiDigit);
      if (mid !== null) return prefix + ALPHA[mid];
      if (hiDigit > 0) return prefix + ALPHA[hiDigit - 1];
      // hiDigit === 0 at this position: no room here at all — match b's
      // digit exactly and look for room one position deeper.
      prefix += ALPHA[0];
      if (i + 1 >= b.length) {
        const err = new Error(
          `order-key: exhausted headroom inserting before ${JSON.stringify(b)} — rebalance the Rack and retry`
        );
        err.code = 'ORDER_KEY_EXHAUSTED';
        throw err;
      }
    }
  }

  // General case: both bounds real. Walk digit positions; once a chosen
  // digit is strictly below b's digit at that position, the candidate is
  // already guaranteed < b for any continuation, so b's bound is dropped
  // (bBound=false) and only `a` constrains subsequent positions — mirrors
  // the unbounded-above "insert after" case from that point on.
  let prefix = '';
  let bBound = true;
  for (let i = 0; ; i++) {
    const loDigit = valAt(a, i);
    if (bBound && i >= b.length) {
      // Tied with b digit-for-digit all the way to its last character —
      // b's implicit continuation from here is all zeros (the global
      // minimum), so there is provably no key between a and b at this
      // depth (e.g. a="X", b="X0": anything starting "X0..." sorts after
      // "X0" itself by the prefix rule, and nothing else fits between "X"
      // and "X0"). Symmetric to the a===null exhaustion case above.
      const err = new Error(
        `order-key: exhausted headroom inserting between ${JSON.stringify(a)} and ${JSON.stringify(b)} — rebalance the Rack and retry`
      );
      err.code = 'ORDER_KEY_EXHAUSTED';
      throw err;
    }
    // While still bounded by b: a real digit, since the check above just
    // ruled out b being exhausted here. Once escaped (bBound=false), the
    // upper bound is unconstrained (BASE).
    const effectiveHi = bBound ? valAt(b, i) : BASE;
    if (effectiveHi - loDigit >= 2) {
      const mid = _midDigit(loDigit, effectiveHi);
      return prefix + ALPHA[mid];
    }
    if (effectiveHi - loDigit === 1) {
      prefix += ALPHA[loDigit];
      bBound = false;
      continue;
    }
    // effectiveHi === loDigit: shared digit under both bounds, go deeper.
    prefix += ALPHA[loDigit];
  }
}

// True once a key has grown long enough that rebalancing the Rack is
// worthwhile. Threshold is a placeholder (not researched — see the
// implementation plan), tuned once real drag volume is observed.
const REBALANCE_KEY_LENGTH = 40;
function needsRebalance(keys) {
  return keys.some(k => k.length > REBALANCE_KEY_LENGTH);
}

function _encodeFixedLength(value, length) {
  let s = '';
  let v = value;
  for (let i = 0; i < length; i++) {
    s = ALPHA[v % BASE] + s;
    v = Math.floor(v / BASE);
  }
  return s;
}

/**
 * Produces evenly-spaced fresh keys for an ordered array of stripIds, as one
 * atomic Map. Callers MUST apply this as a single Board event and MUST NOT
 * call it mid-drag (guide §5.4).
 *
 * Deliberately NOT implemented as a chain of keyBetween(prev, null) calls:
 * that biases toward ever-longer keys (each one extends the last), and can
 * reproduce the exact "b = a + minDigit" adjacency that triggers
 * ORDER_KEY_EXHAUSTED — defeating the point of rebalancing. Instead this
 * generates fixed-length, evenly-spaced integer keys directly: same length
 * for every key means no generated key is ever an extension of another, and
 * deliberately generous spacing (>=4 apart, headroom below the first and
 * above the last) leaves normal single-digit room for the inserts that
 * follow, immediately after a rebalance.
 */
function rebalance(orderedStripIds) {
  const out = new Map();
  const n = orderedStripIds.length;
  if (n === 0) return out;

  const span = n + 2; // +1 slot of headroom reserved at each end
  let length = 1;
  while (Math.pow(BASE, length) < span * 4) length++;
  const total = Math.pow(BASE, length);
  const step = Math.floor(total / span);

  for (let i = 0; i < n; i++) {
    const value = step * (i + 1); // start at 1*step, leaving [0, step) free before the first key
    out.set(orderedStripIds[i], _encodeFixedLength(value, length));
  }
  return out;
}

module.exports = { keyBetween, keyStart, needsRebalance, rebalance, ALPHA };
