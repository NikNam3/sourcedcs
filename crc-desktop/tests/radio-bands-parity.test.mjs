// The two hand copies of the radio bands (docs/adr/0158 §3) must agree: crc-desktop's app/public/js/radio/bands.js and
// crc-sync's src/radio/bands.js. Same pattern as wire-protocol-parity.test.mjs: read crc-sync's file across the package
// boundary (test-only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as client from '../app/public/js/radio/bands.js';

const require = createRequire(import.meta.url);
const server = require('../../crc-sync/src/radio/bands.js');

test('the band edges are the same on both sides', () => {
  assert.deepEqual(client.BANDS, server.BANDS);
  assert.deepEqual(Object.keys(client.BANDS), ['VHF', 'UHF']);
});

test('the band edges are the ADR\'s: VHF 118.000-136.975, UHF 225.000-399.975', () => {
  assert.deepEqual(client.BANDS.VHF, { minKhz: 118000, maxKhz: 136975 });
  assert.deepEqual(client.BANDS.UHF, { minKhz: 225000, maxKhz: 399975 });
});

test('bandOf answers the same on both sides, edges and floats included', () => {
  const cases = [
    [117.975, null], [118, 'VHF'], [121.5, 'VHF'], [122.1, 'VHF'], [136.975, 'VHF'], [136.98, null], [137, null],
    [224.975, null], [225, 'UHF'], [243, 'UHF'], [275.8, 'UHF'], [399.975, 'UHF'], [400, null],
    [30, null], [0.1 + 118.2, 'VHF'], [NaN, null], [Infinity, null], ['243', null], [null, null], [undefined, null],
  ];
  for (const [mhz, want] of cases) {
    assert.equal(client.bandOf(mhz), want, `client ${mhz}`);
    assert.equal(server.bandOf(mhz), want, `server ${mhz}`);
  }
});

test('the two bandOf bodies are the same code', () => {
  assert.equal(client.bandOf.toString(), server.bandOf.toString());
});
