import { test } from 'node:test';
import assert from 'node:assert/strict';

const { keyBetween, keyStart, needsRebalance, rebalance, ALPHA } =
  await import('../src/efsp/order-key.js');

test('keyStart returns a single char from the alphabet', () => {
  const k = keyStart();
  assert.equal(k.length, 1);
  assert.ok(ALPHA.includes(k));
});

test('keyBetween(null, null) equals keyStart — first Strip in an empty Rack', () => {
  assert.equal(keyBetween(null, null), keyStart());
});

test('keyBetween(a, null) sorts strictly after a, for a variety of a', () => {
  for (const a of ['0', 'z', keyStart(), 'ABC', '9999999999']) {
    const k = keyBetween(a, null);
    assert.ok(k > a, `${JSON.stringify(k)} should sort after ${JSON.stringify(a)}`);
  }
});

test('keyBetween(null, b) sorts strictly before b, for a variety of b', () => {
  for (const b of ['1', 'z', keyStart(), 'ABC', 'A00', '05']) {
    const k = keyBetween(null, b);
    assert.ok(k < b, `${JSON.stringify(k)} should sort before ${JSON.stringify(b)}`);
  }
});

test('keyBetween(null, b) throws ORDER_KEY_EXHAUSTED when b is the minimum digit', () => {
  assert.throws(() => keyBetween(null, '0'), (err) => err.code === 'ORDER_KEY_EXHAUSTED');
  assert.throws(() => keyBetween(null, '00'), (err) => err.code === 'ORDER_KEY_EXHAUSTED');
  assert.throws(() => keyBetween(null, '000000'), (err) => err.code === 'ORDER_KEY_EXHAUSTED');
});

test('keyBetween(a, b) sorts strictly between a and b, for many adjacent and distant pairs', () => {
  const pairs = [
    ['A', 'B'],       // adjacent single chars
    ['A', 'C'],       // one apart
    ['0', 'z'],       // full range
    ['AA', 'AB'],     // adjacent two-char, second digit differs
    ['AZ', 'B0'],     // adjacent two-char, carries into first digit
    ['A', 'AA'],      // a is a strict prefix of b
    ['AA', 'B'],      // b's first digit beyond a's shared prefix
    [keyStart(), keyStart() + 'Z'], // realistic "insert after keyStart()" shape, deterministic
  ];
  for (const [a, b] of pairs) {
    const k = keyBetween(a, b);
    assert.ok(a < k, `${JSON.stringify(k)} should sort after ${JSON.stringify(a)}`);
    assert.ok(k < b, `${JSON.stringify(k)} should sort before ${JSON.stringify(b)}`);
  }
});

test('keyBetween throws a plain (non-exhaustion) error when a >= b', () => {
  assert.throws(() => keyBetween('B', 'A'), (err) => err.code !== 'ORDER_KEY_EXHAUSTED');
  assert.throws(() => keyBetween('A', 'A'), (err) => err.code !== 'ORDER_KEY_EXHAUSTED');
});

test('repeated insertion at the end builds a strictly increasing sequence', () => {
  let prev = keyStart();
  const seq = [prev];
  for (let i = 0; i < 200; i++) {
    const next = keyBetween(prev, null);
    assert.ok(next > prev);
    seq.push(next);
    prev = next;
  }
  const sorted = [...seq].sort();
  assert.deepEqual(seq, sorted);
});

test('repeated insertion at the start builds a strictly decreasing sequence, until rebalance is needed', () => {
  let next = keyStart();
  const seq = [next];
  // keyStart() = ALPHA[31]; halving the [0,31) span roughly 5-6 times before
  // hitting the unsolvable "digit 0" case is expected and correct per the
  // module's documented limit, not a test bug.
  let exhausted = false;
  for (let i = 0; i < 40 && !exhausted; i++) {
    try {
      const k = keyBetween(null, next);
      assert.ok(k < next);
      seq.push(k);
      next = k;
    } catch (err) {
      assert.equal(err.code, 'ORDER_KEY_EXHAUSTED');
      exhausted = true;
    }
  }
  assert.ok(exhausted, 'expected repeated insert-before to eventually exhaust headroom');
  const sorted = [...seq].sort().reverse();
  assert.deepEqual(seq, sorted);
});

test('two concurrent inserts at the same slot both produce valid, distinct-or-tied-but-ordered keys', () => {
  // Deterministic a/b with a wide gap (not a+'0') so this test exercises
  // the ordinary concurrent-insert path, not the documented exhaustion
  // edge case — that case has its own dedicated tests above.
  const a = 'V2', b = 'V5';
  const k1 = keyBetween(a, b);
  const k2 = keyBetween(a, b);
  assert.ok(k1 > a && k1 < b);
  assert.ok(k2 > a && k2 < b);
  // They need not differ (jitter can coincide ~1/62), but when they do,
  // both must still individually satisfy the ordering constraint above —
  // already asserted. Run many trials to exercise the jitter path.
});

test('keyBetween(a, a+minDigit) — an extension using only the minimum digit — is a genuine exhaustion, not a silent wrong-order key', () => {
  // e.g. a="V2", b="V20": provably nothing can sort strictly between them
  // in this scheme (see order-key.js's module comment) — must throw, never
  // silently return a key that actually sorts after b.
  assert.throws(() => keyBetween('V2', 'V20'), (err) => err.code === 'ORDER_KEY_EXHAUSTED');
  assert.throws(() => keyBetween('A', 'A0'), (err) => err.code === 'ORDER_KEY_EXHAUSTED');
  assert.throws(() => keyBetween('AB', 'AB00'), (err) => err.code === 'ORDER_KEY_EXHAUSTED');
});

test('many random concurrent same-slot inserts all individually satisfy a < k < b', () => {
  const a = 'A', b = 'B';
  for (let i = 0; i < 500; i++) {
    const k = keyBetween(a, b);
    assert.ok(k > a && k < b, `trial ${i}: ${JSON.stringify(k)} not between A and B`);
  }
});

test('needsRebalance is false for short keys and true once a key exceeds the threshold', () => {
  assert.equal(needsRebalance(['A', 'BC', keyStart()]), false);
  assert.equal(needsRebalance(['A'.repeat(41)]), true);
  assert.equal(needsRebalance(['A'.repeat(40)]), false);
});

test('rebalance produces a strictly increasing sequence of fresh keys for the given order', () => {
  const ids = ['strip-1', 'strip-2', 'strip-3', 'strip-4'];
  const result = rebalance(ids);
  assert.equal(result.size, 4);
  const keys = ids.map(id => result.get(id));
  const sorted = [...keys].sort();
  assert.deepEqual(keys, sorted);
  // Strictly increasing, no duplicates.
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i] > keys[i - 1]);
});

test('rebalance on an empty list returns an empty map', () => {
  assert.equal(rebalance([]).size, 0);
});

test('fuzz: 300 random-position insertions into a growing Rack always keep the sequence sorted', () => {
  // Simulates real drag-and-drop usage: inserts land at random positions
  // within the current Rack, not just at the very start or end.
  let seq = [keyStart()];
  for (let i = 0; i < 300; i++) {
    const pos = Math.floor(Math.random() * (seq.length + 1));
    const a = pos === 0 ? null : seq[pos - 1];
    const b = pos === seq.length ? null : seq[pos];
    let k;
    try {
      k = keyBetween(a, b);
    } catch (err) {
      if (err.code === 'ORDER_KEY_EXHAUSTED') {
        // Rebalance the whole Rack (as board-store.js's real retry path
        // would) and retry the same insert against the fresh keys.
        seq = [...rebalance(seq).values()];
        const a2 = pos === 0 ? null : seq[pos - 1];
        const b2 = pos === seq.length ? null : seq[pos];
        k = keyBetween(a2, b2);
      } else {
        throw err;
      }
    }
    seq.splice(pos, 0, k);
    const sorted = [...seq].sort();
    assert.deepEqual(seq, sorted, `sequence not sorted after inserting at position ${pos} on iteration ${i}`);
  }
  assert.equal(seq.length, 301);
});
