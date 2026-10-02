'use strict';

// The Mode 3/A code block crc-sync mints for AI aircraft (docs/adr/0059),
// `transponder.syntheticBlock` in config/sensor-specs.json (DATA-3, H88).
// Read once at startup through the same loader as every other sensor spec, so
// the transponder model and the EFSP's code rules cannot disagree.
// [SOURCE-DEFINED]: the guide has no such block.

const { loadSensorSpecs } = require('./radars');

const { first, last } = loadSensorSpecs().transponder.syntheticBlock;

const SYNTHETIC_BLOCK_START = parseInt(first, 8);
const SYNTHETIC_BLOCK_SIZE = parseInt(last, 8) - SYNTHETIC_BLOCK_START + 1;
/** For refusal and warning texts: "6000\u20136777". */
const SYNTHETIC_BLOCK_LABEL = `${first}\u2013${last}`;

module.exports = { SYNTHETIC_BLOCK_START, SYNTHETIC_BLOCK_SIZE, SYNTHETIC_BLOCK_LABEL };
