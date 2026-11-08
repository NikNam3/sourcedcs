'use strict';

// docs/adr/0156: what a carrier CreateStrip carries. A carrier Strip is made by its side number (the callsign comes later,
// from the Strip's menu); PriFly types the departure radial, the Marshal the fuel. Checked before anything is minted, so a
// refused create has no side effects (no squawk leaves the pool). A Case I flight gets no squawk: no radar service.

const { validateCarrierFlightField } = require('./flight-record');

const CARRIER_SEED_FIELDS = Object.freeze({
  CV_LAUNCH:   ['sideNumber', 'departureRadialDeg'],
  CV_RECOVERY: ['sideNumber', 'lowStateLb'],
});

/**
 * @param {'CV_LAUNCH'|'CV_RECOVERY'} stripType
 * @param {object} seed the op's flightData: { sideNumber, aircraftType, callsign?, departureRadialDeg?, lowStateLb? }
 * @param {'I'|'II'|'III'|null} shipCase
 * @returns {{ok:true, seed:object, fields:Array<[string, *]>} | {ok:false, reason:string, detail:string}}
 */
function prepareCarrierSeed(stripType, seed, shipCase) {
  const src = seed && typeof seed === 'object' ? seed : {};
  const fields = [];
  for (const field of CARRIER_SEED_FIELDS[stripType] || []) {
    let value = src[field];
    if (value === undefined || value === null || value === '') {
      if (field === 'sideNumber') return { ok: false, reason: 'VALIDATION_ERROR', detail: 'a carrier Strip is created with its side number' };
      continue;
    }
    if (field === 'lowStateLb' && typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) value = Number(value);
    const v = validateCarrierFlightField(field, value);
    if (!v.ok) return { ok: false, reason: 'VALIDATION_ERROR', detail: v.detail };
    fields.push([field, v.value]);
  }
  const rest = { ...src };
  for (const field of CARRIER_SEED_FIELDS[stripType] || []) delete rest[field];
  return { ok: true, seed: { ...rest, ...(shipCase === 'I' ? { noCode: true } : {}) }, fields };
}

module.exports = { prepareCarrierSeed, CARRIER_SEED_FIELDS };
