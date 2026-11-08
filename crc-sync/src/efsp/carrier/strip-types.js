'use strict';

// The carrier's own strip types (docs/adr/0156), named once: every rule that asks "is this a carrier Strip" reads it here.
const CARRIER_STRIP_TYPES = Object.freeze(['CV_LAUNCH', 'CV_RECOVERY']);
const _set = new Set(CARRIER_STRIP_TYPES);

/** @param {{stripType?:string}|null} strip */
function isCarrierStrip(strip) {
  return !!strip && _set.has(strip.stripType);
}

module.exports = { CARRIER_STRIP_TYPES, isCarrierStrip };
