'use strict';

// What each carrier handoff does to the STRIP (docs/adr/0074). handoffs.js
// (L4) says who may send it, in which Case, with which trigger type and what it
// does to the stack; this says which Strip it applies to and what the Strip
// becomes. Kept beside it, pure, so the Board (board/ops/carrier-handoff.js) holds no carrier doctrine.
//
// `owner`: 'TO' hands the Strip to the receiving Position (the lane, or PriFly);
// 'SAME' keeps it where it is. A strip type change is IN PLACE (same Strip, same
// flight data), as ConvertToArrival does (docs/adr/0023); a flight's EEAT lives on the
// flight data so nothing is copied. [SOURCE-DEFINED] states, ADR 0064 B2.

const CARRIER_HANDOFF_EFFECTS = Object.freeze({
  MARSHAL_TO_APPROACH:       Object.freeze({ stripType: 'MARSHAL', state: 'IN_STACK',  toStripType: 'MARSHAL', toState: 'COMMENCED',  owner: 'TO',   defaultTo: null }),
  APPROACH_TO_FINAL:         Object.freeze({ stripType: 'MARSHAL', state: 'COMMENCED', toStripType: 'FINAL',   toState: 'ON_FINAL',   owner: 'SAME', defaultTo: null }),
  FINAL_TO_LSO:              Object.freeze({ stripType: 'FINAL',   state: 'ON_FINAL',  toStripType: 'FINAL',   toState: 'BALL',       owner: 'SAME', defaultTo: null }),
  MARSHAL_TO_PRIFLY:         Object.freeze({ stripType: 'MARSHAL', state: 'IN_STACK',  toStripType: 'PATTERN', toState: 'IN_PATTERN', owner: 'TO',   defaultTo: 'CV_PRIFLY' }),
  MARSHAL_TO_PATTERN_CASE_I: Object.freeze({ stripType: 'MARSHAL', state: 'IN_STACK',  toStripType: 'PATTERN', toState: 'IN_PATTERN', owner: 'TO',   defaultTo: 'CV_PRIFLY' }),
});

module.exports = { CARRIER_HANDOFF_EFFECTS };
