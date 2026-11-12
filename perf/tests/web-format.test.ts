import assert from 'node:assert/strict';
import { test } from 'node:test';

import { outOfChart, ok } from '../src/core/result.ts';
import { DASH, figureLabel, formatDistance, formatPercent, formatSpeed, formatThousands } from '../src/web/format.ts';

const OUT = outOfChart('B2-3', 'gross_weight', 52, [20, 48]);

test('DASH is U+2014', () => {
  assert.equal(DASH, '—');
});

test('formatSpeed: exact with one decimal, conservative whole, out of chart a dash', () => {
  assert.equal(formatSpeed(ok(172.5), 'exact'), '172.5');
  assert.equal(formatSpeed(ok(172), 'exact'), '172.0');
  assert.equal(formatSpeed(ok(174), 'conservative'), '174');
  assert.equal(formatSpeed(OUT, 'exact'), DASH);
  assert.equal(formatSpeed(OUT, 'conservative'), DASH);
});

test('formatDistance: whole with thousands separators, out of chart a dash', () => {
  assert.equal(formatDistance(ok(5752), 'exact'), '5,752');
  assert.equal(formatDistance(ok(5960), 'conservative'), '5,960');
  assert.equal(formatDistance(ok(5751.6), 'exact'), '5,752');
  assert.equal(formatDistance(ok(0), 'exact'), '0');
  assert.equal(formatDistance(OUT, 'exact'), DASH);
});

test('formatPercent: one decimal', () => {
  assert.equal(formatPercent(97.5), '97.5');
  assert.equal(formatPercent(83), '83.0');
  assert.equal(formatPercent(84.249), '84.2');
  assert.equal(formatPercent(0), '0.0');
});

test('formatThousands: en-US grouping, U+2212 minus, up to two decimals unless given', () => {
  assert.equal(formatThousands(37300), '37,300');
  assert.equal(formatThousands(37.3 * 1000), '37,300');
  assert.equal(formatThousands(18.75), '18.75');
  assert.equal(formatThousands(2.1), '2.1');
  assert.equal(formatThousands(-20), '−20');
  assert.equal(formatThousands(-0.001), '0');
  assert.equal(formatThousands(1234.5, 1), '1,234.5');
  assert.equal(formatThousands(1234, 1), '1,234.0');
  assert.equal(formatThousands(1234.56, 0), '1,235');
  assert.equal(formatThousands(-1234.5, 1), '−1,234.5');
});

test('figureLabel: the sheet as "sh. n"', () => {
  assert.equal(figureLabel('B2-6.sh2'), 'B2-6 sh. 2');
  assert.equal(figureLabel('B7-2.sh1'), 'B7-2 sh. 1');
  assert.equal(figureLabel('B2-3'), 'B2-3');
});
