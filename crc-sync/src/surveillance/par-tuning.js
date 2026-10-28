'use strict';

// PAR tuning (docs/adr/0112): the default glidepath angle, the sample rate, the trail length and the PAR's coverage volume.
// A tuning file (decisions P5, H88): the shipped config/par.json is the only source of defaults, a missing or invalid one
// stops start-up naming it, a copy in state/ layers over it key by key, and nothing writes it. Read at start-up, not at
// require time.

const { readShipped, readLayer } = require('../tuning-file');

const NAME = 'par.json';

function _num(v, what, { min, max, integer = false }) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
    throw new Error(`[tuning] ${NAME}: ${what} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}, got ${JSON.stringify(v)}`);
  }
  return v;
}

/** @param {string} [override] explicit path of the state/ layer (a test's temp file) */
function loadParTuning(override) {
  const shipped = readShipped(NAME);
  const layer = readLayer(NAME, override, shipped) || {};
  const m = { ...shipped, ...layer, coverage: { ...(shipped.coverage || {}), ...(layer.coverage || {}) } };
  const c = m.coverage;
  const tuning = {
    defaultGlideslopeDeg: _num(m.defaultGlideslopeDeg, 'defaultGlideslopeDeg', { min: 2, max: 4.5 }),
    sampleMs: _num(m.sampleMs, 'sampleMs', { min: 100, max: 1000, integer: true }),
    trailPlots: _num(m.trailPlots, 'trailPlots', { min: 0, max: 60, integer: true }),
    coverage: Object.freeze({
      rangeNm: _num(c.rangeNm, 'coverage.rangeNm', { min: 1, max: 60 }),
      azimuthHalfDeg: _num(c.azimuthHalfDeg, 'coverage.azimuthHalfDeg', { min: 1, max: 45 }),
      elevationMinDeg: _num(c.elevationMinDeg, 'coverage.elevationMinDeg', { min: -10, max: 0 }),
      elevationMaxDeg: _num(c.elevationMaxDeg, 'coverage.elevationMaxDeg', { min: 1, max: 30 }),
      apexBeyondNm: _num(c.apexBeyondNm, 'coverage.apexBeyondNm', { min: 0, max: 3 }),
    }),
  };
  return Object.freeze(tuning);
}

module.exports = { loadParTuning };
