'use strict';

// Engineering constants that more than one module needs (decisions H88: named constants, one home; DATA-3).
// Not tunables and not doctrine: unit conversions and calendar lengths. The ISA constants stay in altimetry.js.

const MS_PER_KT = 0.514444;            // m/s per knot
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

module.exports = { MS_PER_KT, HOUR_MS, DAY_MS };
