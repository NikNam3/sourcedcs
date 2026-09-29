'use strict';

// True MSL altitude → the altitude a controller reads, in feet: QNH below the
// transition altitude, standard pressure (a flight level) at and above it.
//
// The same arithmetic as crc-desktop's app.js indicatedAltFt(), which is what
// the track panel and data blocks show. Conformance compares an assigned
// altitude against this, so it has to be the number the controller sees, not
// raw DCS metres (docs/adr/0058).

const ISA_P0 = 101325;   // Pa
const ISA_L = 0.0065;    // K/m
const ISA_G = 9.80665;   // m/s²
const ISA_R = 287.05287; // J/(kg·K)
const ISA_EXP = ISA_G / (ISA_R * ISA_L);
const ISA_INV = (ISA_R * ISA_L) / ISA_G;
const H_TROP = 11000.0;     // m
const T_REF_ALT = 288.97;   // K, empirical DCS altimeter reference (matches the client)

function pressureAtAlt(zM, seaPa, T0) {
  if (zM <= H_TROP) return seaPa * Math.pow(1 - ISA_L * zM / T0, ISA_EXP);
  const tTrop = T0 - ISA_L * H_TROP;
  const pTrop = seaPa * Math.pow(1 - ISA_L * H_TROP / T0, ISA_EXP);
  return pTrop * Math.exp(-ISA_G * (zM - H_TROP) / (ISA_R * tTrop));
}

/**
 * @param {number} trueAltM  DCS altitude, metres MSL
 * @param {{pressurePa?:number, tempK?:number}} weather  sea-level pressure and temperature
 * @param {number} [transitionAltFt=18000]
 * @returns {number} feet
 */
function indicatedAltFt(trueAltM, weather = {}, transitionAltFt = 18000) {
  const pressurePa = weather.pressurePa || ISA_P0;
  const tempK = weather.tempK || 288.15;
  const p = pressureAtAlt(trueAltM, pressurePa, tempK);
  const ref = trueAltM / 0.3048 >= transitionAltFt ? ISA_P0 : pressurePa;
  return ((T_REF_ALT / ISA_L) * (1 - Math.pow(p / ref, ISA_INV))) / 0.3048;
}

module.exports = { indicatedAltFt, ISA_P0 };
