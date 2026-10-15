'use strict';

// Incirlik's military ATC Position family (authority registry, S3-2): PAR,
// plus the columns L18 adds to civil-atc.js's AP. No RSU (docs/adr/0126: the
// tower works the pattern). Moved from
// permission.js. Registered LAST: it extends AP and the strip-type families' owner
// tables, so everything it extends must already be there. No SFA Position
// (docs/adr/0117): a single frequency approach is a procedure between AP and PAR
// (JO 7610.14A para 7-1-5), not a third controller.

const { NON_CREATE_OPS, FORMATION_OP_KINDS } = require('../op-kinds');

// Incirlik's radar-approach Positions (docs/adr/0075, 0117, 0126):
// PAR, plus AP's columns. ONE table, one row per Position,
// one column per capability (the shape docs/adr/0080 gave the tactical Positions
// and L17 the carrier), and every grant below is DERIVED from it, so no Position
// name is repeated in a second table. Static (P5): read at load, never written.
//
//  ops                 the Strip op kinds the Position holds. Literals over
//                      NON_CREATE_OPS, never a `.filter()` of OP_KINDS (this
//                      module's header: the maximally-permissive trap). None of
//                      them gets a coordination primitive, TOFI, ConvertToArrival
//                      or an airspace-entry op: they sit inside one Facility.
//  createsStripTypes   the strip types it may originate via CreateStrip. None:
//                      PAR's arrive by AP's handoff.
//  ownsStates          { strip type: [states] } this Position works (the "normally owned
//                      by" authority, §3.4), merged into STATE_OWNERS_BY_STRIP_TYPE.
//  requestsRunwayStatus  may SEND RequestRunwayStatus (kinds CLOSE, OPEN,
//                      WORKS; BARRIER_CHANGE is WORKS since L1b). AP asks; only LC closes or opens a
//                      runway (decisions.md H18, S-L1b), so no column here grants
//                      CloseRunway, OpenRunway or any other RUNWAY_STATUS_OP_OWNERS row.
//  handsOffToFinal     may hand an ARRIVAL at INBOUND to the final controller (the
//                      PAR_HANDOFF conversion, par-final.js): the radar approach
//                      controller, who also holds the SFA rotation (para 7-1-5 c)
//  receivesFinal       the Position that handoff lands on (the GCA controller)
//  recordsFinalCalls   may record Begin descent, Cleared to land and Landed on a
//                      FINAL Strip (op FinalCall, par-final.js)
const INCIRLIK_CAPABILITIES = {
  AP: { // AP's own op grant is in positions/civil-atc.js; these are the columns L18 adds to it
    ops: null, createsStripTypes: null, ownsStates: {},
    requestsRunwayStatus: true, handsOffToFinal: true, receivesFinal: false, recordsFinalCalls: false,
  },
  PAR: {
    ops: [...NON_CREATE_OPS, ...FORMATION_OP_KINDS],
    createsStripTypes: [],
    ownsStates: { FINAL: ['ON_FINAL', 'BOLTER_WAVEOFF'] },
    requestsRunwayStatus: false, handsOffToFinal: false, receivesFinal: true, recordsFinalCalls: true,
  },
};

function _incirlikCap(positionId, key) {
  return Object.prototype.hasOwnProperty.call(INCIRLIK_CAPABILITIES, positionId) && INCIRLIK_CAPABILITIES[positionId][key] === true;
}
/** Positions holding a boolean column of INCIRLIK_CAPABILITIES, in table order. */
function incirlikPositionsWith(key) {
  return Object.keys(INCIRLIK_CAPABILITIES).filter(p => INCIRLIK_CAPABILITIES[p][key] === true);
}
/** May this Position hand an arrival to the final controller (D21: one acting Position)? */
function canHandOffToFinal(actingPositionId) { return _incirlikCap(actingPositionId, 'handsOffToFinal'); }
/** May this Position record the final controller's calls on a FINAL Strip? */
function canRecordFinalCall(actingPositionId) { return _incirlikCap(actingPositionId, 'recordsFinalCalls'); }
/** The Position a handoff to the final lands on (PAR), or null. */
function finalReceiver() { return incirlikPositionsWith('receivesFinal')[0] || null; }

// Every grant DERIVED from the table, so no Position name is repeated below.
const _rows = Object.entries(INCIRLIK_CAPABILITIES);
const family = {
  family: 'incirlik-military',
  positions: _rows.filter(([, row]) => row.ops).map(([id]) => id),
  extends: _rows.filter(([, row]) => !row.ops).map(([id]) => id),
  permissions: Object.fromEntries(_rows.filter(([, row]) => row.ops).map(([id, row]) => [id, new Set(row.ops)])),
  createsStripTypes: Object.fromEntries(_rows.filter(([, row]) => row.createsStripTypes && row.createsStripTypes.length).map(([id, row]) => [id, new Set(row.createsStripTypes)])),
  ownsStates: Object.fromEntries(_rows.map(([id, row]) => [id, row.ownsStates || {}])),
  runwayStatusGrants: { RequestRunwayStatus: incirlikPositionsWith('requestsRunwayStatus') },
  capabilities: INCIRLIK_CAPABILITIES,
};

module.exports = {
  family, INCIRLIK_CAPABILITIES, canHandOffToFinal, canRecordFinalCall, finalReceiver, incirlikPositionsWith,
};
