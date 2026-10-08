'use strict';

// Carrier recovery tuning (docs/adr/0113): the first marshal fix, the push spacing, the time from a fix to the ramp (what an
// EAT is worked back by) and the recovery tanker's pattern defaults. A tuning file (decisions P5, H88): the shipped
// config/efsp-carrier-recovery.json is the only source of defaults, a missing or invalid one stops start-up naming it, a copy in
// state/ layers over it key by key, and nothing writes it. Read at start-up, not at require time.

const { readShipped, readLayer } = require('../../tuning-file');

const NAME = 'efsp-carrier-recovery.json';
const SIDES = ['port', 'stbd'];

function _num(v, what, { min, max, integer = false }) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
    throw new Error(`[tuning] ${NAME}: ${what} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}, got ${JSON.stringify(v)}`);
  }
  return v;
}

/** @param {string} [override] explicit path of the state/ layer (a test's temp file) */
function loadRecoveryTuning(override) {
  const shipped = readShipped(NAME);
  const layer = readLayer(NAME, override, shipped) || {};
  const m = { ...shipped, ...layer, tanker: { ...(shipped.tanker || {}), ...(layer.tanker || {}) } };
  const tuning = {
    firstFixDme: _num(m.firstFixDme, 'firstFixDme', { min: 10, max: 40, integer: true }),
    pushSpacingMs: _num(m.pushSpacingSec, 'pushSpacingSec', { min: 10, max: 600 }) * 1000,
    fixToRampMs: _num(m.fixToRampSec, 'fixToRampSec', { min: 0, max: 3600 }) * 1000,
    tanker: {
      altitudeFt: _num(m.tanker.altitudeFt, 'tanker.altitudeFt', { min: 500, max: 40000, integer: true }),
      patternSide: m.tanker.patternSide,
    },
  };
  if (!SIDES.includes(tuning.tanker.patternSide)) throw new Error(`[tuning] ${NAME}: tanker.patternSide must be one of ${SIDES.join(', ')}`);
  return Object.freeze({ ...tuning, tanker: Object.freeze(tuning.tanker) });
}

module.exports = { loadRecoveryTuning, PATTERN_SIDES: SIDES };
