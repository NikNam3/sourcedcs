import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import { ISA_INV, ISA_P0_INHG } from '../src/core/inputs/derive.ts';

/**
 * The pilot's pressure altitude (derive.ts) and crc-sync's DCS altimeter model share two ISA constants:
 * sea-level pressure and the exponent. Only those are pinned; the reference temperature differs on purpose (TOLD 5.3).
 */
const require = createRequire(import.meta.url);
const altimetry = require('../../crc-sync/src/altimetry.js') as { ISA_P0: number; ISA_INV: number };

const PA_PER_INHG = 3386.389;

test('ISA_P0_INHG equals crc-sync ISA_P0 in inHg', () => {
  assert.ok(Math.abs(altimetry.ISA_P0 / PA_PER_INHG - ISA_P0_INHG) <= 0.001);
});

test('ISA_INV equals crc-sync ISA_INV', () => {
  assert.ok(Math.abs(altimetry.ISA_INV - ISA_INV) <= 1e-6);
});
