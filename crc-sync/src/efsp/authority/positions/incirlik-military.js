'use strict';

// Incirlik's military ATC Position family (authority registry, S3-2): RSU, SFA
// and PAR, plus the columns L18 adds to civil-atc.js's APP. Moved from
// permission.js. Registered LAST: it extends APP and the Role families' owner
// tables, so everything it extends must already be there.

const { NON_CREATE_OPS } = require('../op-kinds');

// Incirlik's radar-approach and visual-pattern Positions (docs/adr/0075, L18):
// RSU, SFA and PAR, plus APP's two new columns. ONE table, one row per Position,
// one column per capability (the shape docs/adr/0080 gave the tactical Positions
// and L17 the carrier), and every grant below is DERIVED from it, so no Position
// name is repeated in a second table. Static (P5): read at load, never written.
//
//  ops                 the Strip op kinds the Position holds. Literals over
//                      NON_CREATE_OPS, never a `.filter()` of OP_KINDS (this
//                      module's header: the maximally-permissive trap). None of
//                      them gets a coordination primitive, TOFI, ConvertToArrival
//                      or an airspace-entry op: they sit inside one Facility.
//  createsStripTypes        the Strip Roles it may originate via CreateStrip. Nothing
//                      here is a Role a hand-over would reach it with: only RSU
//                      originates (a PATTERN Strip for an aircraft it watches join
//                      the pattern, [SOURCE-DEFINED]); SFA's arrive from APP and
//                      PAR's by the SFA rotation.
//  ownsStates          { Role: [states] } this Position works (the "normally owned
//                      by" authority, §3.4), merged into STATE_OWNERS_BY_ROLE.
//  requestsRunwayStatus  may SEND RequestRunwayStatus (kinds CLOSE, OPEN,
//                      WORKS; BARRIER_CHANGE is WORKS since L1b). RSU asks; only TWR closes or opens a
//                      runway (decisions.md H18, S-L1b), so no column here grants
//                      CloseRunway, OpenRunway or any other FIELD_STATE_OP_OWNERS row.
//  rotatesSfa          the CEILING on who may change the SFA rotation record (guide
//                      §4.7: APP "retains jurisdiction over the rotation"). The
//                      store narrows it to config's `singleFrequencyApproach.
//                      jurisdiction`, never widens it, as CompleteInspection's
//                      inspectionAuthorityPositionId does.
//  sendsSfaRotation    may send the SFA_ROTATION transfer (ARRIVAL at the Position
//                      -> FINAL at the receiver)
//  receivesSfaRotation the Position an SFA_ROTATION lands on
const INCIRLIK_CAPABILITIES = {
  APP: { // APP's own op grant is in positions/civil-atc.js; these are the columns L18 adds to it
    ops: null, createsStripTypes: null, ownsStates: {},
    requestsRunwayStatus: true, rotatesSfa: true, sendsSfaRotation: true, receivesSfaRotation: false,
  },
  RSU: {
    ops: [...NON_CREATE_OPS, 'CreateStrip'],
    createsStripTypes: ['PATTERN'],
    ownsStates: { PATTERN: ['IN_PATTERN', 'RECOVERED'] },
    requestsRunwayStatus: true, rotatesSfa: false, sendsSfaRotation: false, receivesSfaRotation: false,
  },
  SFA: {
    ops: [...NON_CREATE_OPS],
    createsStripTypes: [],
    ownsStates: { ARRIVAL: ['INBOUND'] },
    requestsRunwayStatus: false, rotatesSfa: false, sendsSfaRotation: true, receivesSfaRotation: false,
  },
  PAR: {
    ops: [...NON_CREATE_OPS],
    createsStripTypes: [],
    ownsStates: { FINAL: ['ON_FINAL', 'BALL', 'BOLTER_WAVEOFF'] },
    requestsRunwayStatus: false, rotatesSfa: false, sendsSfaRotation: false, receivesSfaRotation: true,
  },
};

function _incirlikCap(positionId, key) {
  return Object.prototype.hasOwnProperty.call(INCIRLIK_CAPABILITIES, positionId) && INCIRLIK_CAPABILITIES[positionId][key] === true;
}
/** Positions holding a boolean column of INCIRLIK_CAPABILITIES, in table order. */
function incirlikPositionsWith(key) {
  return Object.keys(INCIRLIK_CAPABILITIES).filter(p => INCIRLIK_CAPABILITIES[p][key] === true);
}
/** May this Position change the SFA rotation record? Only a CEILING: sfa-store.js narrows it to config's jurisdiction. */
function canRotateSfa(actingPositionId) { return _incirlikCap(actingPositionId, 'rotatesSfa'); }
/** May this Position send the SFA_ROTATION transfer (D21: one acting Position)? */
function canSendSfaRotationTransfer(actingPositionId) { return _incirlikCap(actingPositionId, 'sendsSfaRotation'); }
/** The Positions that work the SFA frequencies (the ones the table gives any SFA column): who can be on a frequency in the rotation record. */
function sfaControllerPositions() {
  return Object.keys(INCIRLIK_CAPABILITIES).filter(p => ['rotatesSfa', 'sendsSfaRotation', 'receivesSfaRotation'].some(k => INCIRLIK_CAPABILITIES[p][k] === true));
}
/** The Position an SFA_ROTATION lands on, or null. */
function sfaRotationReceiver() { return incirlikPositionsWith('receivesSfaRotation')[0] || null; }

// Every grant DERIVED from the table, so no Position name is repeated below.
const _rows = Object.entries(INCIRLIK_CAPABILITIES);
const family = {
  family: 'incirlik-military',
  positions: _rows.filter(([, row]) => row.ops).map(([id]) => id),
  extends: _rows.filter(([, row]) => !row.ops).map(([id]) => id),
  permissions: Object.fromEntries(_rows.filter(([, row]) => row.ops).map(([id, row]) => [id, new Set(row.ops)])),
  createsStripTypes: Object.fromEntries(_rows.filter(([, row]) => row.createsStripTypes && row.createsStripTypes.length).map(([id, row]) => [id, new Set(row.createsStripTypes)])),
  ownsStates: Object.fromEntries(_rows.map(([id, row]) => [id, row.ownsStates || {}])),
  fieldStateGrants: { RequestRunwayStatus: incirlikPositionsWith('requestsRunwayStatus') },
  capabilities: INCIRLIK_CAPABILITIES,
};

module.exports = {
  family, INCIRLIK_CAPABILITIES, canRotateSfa, canSendSfaRotationTransfer, sfaRotationReceiver, sfaControllerPositions, incirlikPositionsWith,
};
