'use strict';

// What each carrier hand-over does to the STRIP (docs/adr/0074). transfers.js
// (L4) says who may send it, in which Case, with which trigger type and what it
// does to the stack; this says which Strip it applies to and what the Strip
// becomes. Kept beside it, pure, so board-store.js holds no carrier doctrine.
//
// `owner`: 'TO' hands the Strip to the receiving Position (the lane, or PriFly);
// 'SAME' keeps it where it is. A role change is IN PLACE (same Strip, same
// FDR), as ConvertToArrival does (docs/adr/0023); a flight's EEAT lives on the
// FDR so nothing is copied. [SOURCE-DEFINED] states, ADR 0064 B2.

const CARRIER_TRANSFER_EFFECTS = Object.freeze({
  MARSHAL_TO_APPROACH:       Object.freeze({ role: 'MARSHAL', state: 'IN_STACK',  toRole: 'MARSHAL', toState: 'COMMENCED',  owner: 'TO',   defaultTo: null }),
  APPROACH_TO_FINAL:         Object.freeze({ role: 'MARSHAL', state: 'COMMENCED', toRole: 'FINAL',   toState: 'ON_FINAL',   owner: 'SAME', defaultTo: null }),
  FINAL_TO_LSO:              Object.freeze({ role: 'FINAL',   state: 'ON_FINAL',  toRole: 'FINAL',   toState: 'BALL',       owner: 'SAME', defaultTo: null }),
  MARSHAL_TO_PRIFLY:         Object.freeze({ role: 'MARSHAL', state: 'IN_STACK',  toRole: 'PATTERN', toState: 'IN_PATTERN', owner: 'TO',   defaultTo: 'CV_PRIFLY' }),
  MARSHAL_TO_PATTERN_CASE_I: Object.freeze({ role: 'MARSHAL', state: 'IN_STACK',  toRole: 'PATTERN', toState: 'IN_PATTERN', owner: 'TO',   defaultTo: 'CV_PRIFLY' }),
});

module.exports = { CARRIER_TRANSFER_EFFECTS };
