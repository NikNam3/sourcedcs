'use strict';

// The VHF and UHF airbands a radio is on (docs/adr/0158 §3). A band is derived from the frequency, never stored: a
// frequency row outside both bands is valid in the table (ADR 0131/0138) but gets no Position radio. crc-desktop keeps
// a hand copy in app/public/js/radio/bands.js; crc-desktop/tests/radio-bands-parity.test.mjs fails if the two differ.

/** The band edges in kHz, both ends inclusive: VHF 118.000 to 136.975 MHz, UHF 225.000 to 399.975 MHz. */
const BANDS = Object.freeze({
  VHF: Object.freeze({ minKhz: 118000, maxKhz: 136975 }),
  UHF: Object.freeze({ minKhz: 225000, maxKhz: 399975 }),
});

/** `'VHF'`, `'UHF'`, or null when `mhz` is outside both bands (or not a number). */
function bandOf(mhz) {
  if (typeof mhz !== 'number' || !Number.isFinite(mhz)) return null;
  const khz = Math.round(mhz * 1000);
  for (const [band, { minKhz, maxKhz }] of Object.entries(BANDS)) {
    if (khz >= minKhz && khz <= maxKhz) return band;
  }
  return null;
}

module.exports = { BANDS, bandOf };
