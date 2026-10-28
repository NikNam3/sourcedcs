import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ok, outOfChart } from '../src/core/result.ts';

test('ok wraps a value', () => {
  assert.deepEqual(ok(3), { ok: true, value: 3 });
});

test('ok keeps a zero value', () => {
  assert.deepEqual(ok(0), { ok: true, value: 0 });
});

test('outOfChart names the figure, the input, the value and the drawn range', () => {
  assert.deepEqual(outOfChart('B2-3', 'gross_weight', 52, [20, 48]), {
    ok: false,
    error: { kind: 'outOfChart', figure: 'B2-3', input: 'gross_weight', value: 52, drawnRange: [20, 48] },
  });
});

test('outOfChart takes a null range when the chart has none, e.g. a table key not found', () => {
  assert.deepEqual(outOfChart('B1-1.sh1', 'store', 7, null), {
    ok: false,
    error: { kind: 'outOfChart', figure: 'B1-1.sh1', input: 'store', value: 7, drawnRange: null },
  });
});
