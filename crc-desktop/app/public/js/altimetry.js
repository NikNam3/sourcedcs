'use strict';

// Pressure altitude arithmetic for the Tools tab's DCS altitude calculator.
//
// A hand copy of crc-sync's src/altimetry.js (`pressureAtAlt` and the ISA constants), kept in step by
// tests/altimetry-parity.test.mjs, which reads both files (ARCH-D7: hand copies with a parity test, no shared package).
// crc-sync's altimetry.js is the owner; change a constant there first.

export const ISA_P0 = 101325;   // Pa
export const ISA_L = 0.0065;    // K/m
export const ISA_G = 9.80665;   // m/s²
export const ISA_R = 287.05287; // J/(kg·K)
export const ISA_EXP = ISA_G / (ISA_R * ISA_L);
export const ISA_INV = (ISA_R * ISA_L) / ISA_G;
export const H_TROP = 11000.0;     // m
export const T_REF_ALT = 288.97;   // K, empirical DCS altimeter reference
const FT_TO_M = 0.3048;

export function pressureAtAlt(zM, seaPa, T0) {
  if (zM <= H_TROP) return seaPa * Math.pow(1 - ISA_L * zM / T0, ISA_EXP);
  const tTrop = T0 - ISA_L * H_TROP;
  const pTrop = seaPa * Math.pow(1 - ISA_L * H_TROP / T0, ISA_EXP);
  return pTrop * Math.exp(-ISA_G * (zM - H_TROP) / (ISA_R * tTrop));
}

/**
 * The altitude an altimeter set to `seaPa` reads at true (API) altitude `apiFt`.
 * @param {number} apiFt  DCS altitude, feet MSL
 * @param {number} seaPa  sea-level pressure, Pa (the QNH setting)
 * @param {number} T0     sea-level temperature, K
 * @returns {number} feet
 */
export function apiToIndicated(apiFt, seaPa, T0) {
  const P = pressureAtAlt(apiFt * FT_TO_M, seaPa, T0);
  return ((T_REF_ALT / ISA_L) * (1 - Math.pow(P / seaPa, ISA_INV))) / FT_TO_M;
}
