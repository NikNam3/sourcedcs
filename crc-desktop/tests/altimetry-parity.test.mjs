/* js/altimetry.js is a hand copy of crc-sync's src/altimetry.js (ARCH-D7). This reads both and compares the constants,
 * then samples apiToIndicated against crc-sync's indicatedAltFt. */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as client from '../app/public/js/altimetry.js';

const require = createRequire(import.meta.url);
const SERVER_FILE = path.join(import.meta.dirname, '../../crc-sync/src/altimetry.js');
const server = require(SERVER_FILE);
const serverSrc = fs.readFileSync(SERVER_FILE, 'utf8');
const clientSrc = fs.readFileSync(path.join(import.meta.dirname, '../app/public/js/altimetry.js'), 'utf8');

const literal = (src, name) => {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*([^;]+);`));
  assert.ok(m, `${name} is declared`);
  return m[1].trim();
};

test('the client copy declares the same ISA constants as crc-sync, expression for expression', () => {
  for (const name of ['ISA_P0', 'ISA_L', 'ISA_G', 'ISA_R', 'ISA_EXP', 'ISA_INV', 'H_TROP', 'T_REF_ALT']) {
    assert.equal(literal(clientSrc, name), literal(serverSrc, name), name);
  }
});

test('apiToIndicated agrees with crc-sync indicatedAltFt below the transition altitude (QNH set)', () => {
  const samples = [
    { ft: 0, pa: 101325, k: 288.15 },
    { ft: 10000, pa: 100500, k: 295.15 },
    { ft: 30000, pa: 102000, k: 280 }, // above the tropopause: the exponential branch
  ];
  for (const { ft, pa, k } of samples) {
    const want = server.indicatedAltFt(ft * 0.3048, { pressurePa: pa, tempK: k }, Infinity);
    assert.ok(Math.abs(client.apiToIndicated(ft, pa, k) - want) < 1e-6, `${ft} ft`);
  }
});
