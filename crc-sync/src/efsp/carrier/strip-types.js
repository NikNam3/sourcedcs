'use strict';

// The carrier's own strip types (docs/adr/0156), named once: every rule that asks "is this a carrier Strip" reads it here.
const CARRIER_STRIP_TYPES = Object.freeze(['CV_LAUNCH', 'CV_RECOVERY']);
const _set = new Set(CARRIER_STRIP_TYPES);

/** @param {{stripType?:string}|null} strip */
function isCarrierStrip(strip) {
  return !!strip && _set.has(strip.stripType);
}

/**
 * The Case this carrier Strip's flight flies (docs/adr/0156): a recovery's is its stack's (`rules.carrierCaseOf`); a launch
 * on deck takes the ship's; an airborne launch is under departure control, which is Case II/III. Null for a non-carrier Strip.
 * @param {object} strip
 * @param {{carrierCase:Function, carrierCaseOf:Function}} rules
 */
function flightCaseOf(strip, rules) {
  if (!isCarrierStrip(strip)) return null;
  if (strip.stripType === 'CV_RECOVERY') return rules.carrierCaseOf(strip) || rules.carrierCase();
  return strip.state === 'ON_DECK' ? rules.carrierCase() : 'III';
}

module.exports = { CARRIER_STRIP_TYPES, isCarrierStrip, flightCaseOf };
