'use strict';

// The Mode 3/A code block crc-sync mints for AI aircraft (docs/adr/0059),
// `transponder.syntheticBlock` in config/sensor-specs.json (DATA-3, H88).
// Read once at startup through the same loader as every other sensor spec, so
// the transponder model and the EFSP's code rules cannot disagree.
// [SOURCE-DEFINED]: the guide has no such block.

const { loadSensorSpecs } = require('./radars');

let _block = null;
/** @returns {{SYNTHETIC_BLOCK_START:number, SYNTHETIC_BLOCK_SIZE:number, SYNTHETIC_BLOCK_LABEL:string}} read on first use, not when this file is required */
function syntheticBlock() {
  if (_block) return _block;
  const { first, last } = loadSensorSpecs().transponder.syntheticBlock;
  const start = parseInt(first, 8);
  _block = Object.freeze({
    SYNTHETIC_BLOCK_START: start,
    SYNTHETIC_BLOCK_SIZE: parseInt(last, 8) - start + 1,
    /** For refusal and warning texts: "6000\u20136777". */
    SYNTHETIC_BLOCK_LABEL: `${first}\u2013${last}`,
  });
  return _block;
}

module.exports = { syntheticBlock };
