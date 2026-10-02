'use strict';

// The CARRIER Position family (authority registry, S3-2): CV_MARSHAL, CV_PRIFLY,
// CV_APP1, CV_APP2 (docs/adr/0064 B4, docs/adr/0074). Moved from permission.js.

const { NON_CREATE_OPS } = require('../op-kinds');
const { CARRIER_HANDOFFS } = require('../../carrier/handoffs'); // pure (docs/adr/0064)

const PERMISSIONS = {
  // The CARRIER Facility (docs/adr/0064 B4, docs/adr/0074; guide §4.1: "Military
  // ATC afloat"). Written as literals over NON_CREATE_OPS, which already excludes
  // every coordination primitive, TOFI, ConvertToArrival and the airspace-entry
  // ops: "the carrier does not talk to the centre" (§9.13) holds by construction,
  // not by a list that has to stay current. Only the Marshal originates Strips
  // (launch and recovery check-in); FINAL and PATTERN Strips come only by a
  // carrier transfer. CarrierHandoff is NOT in OP_KINDS (it is not a `.filter()`
  // grant anyone could pick up silently): board/ops/carrier-handoff.js asks
  // canRecordCarrierHandoff below, one acting Position and one transfer kind.
  // docs/adr/0101 (DR-3): the Marshal RECEIVES a HANDOFF (and asks for a ControlRelease); it proposes nothing, which
  // COORDINATION_ACTIONS below holds at the action level, since the grant is by op kind.
  CV_MARSHAL: new Set([...NON_CREATE_OPS, 'CreateStrip', 'HANDOFF', 'ControlRelease']),
  CV_PRIFLY:  new Set(NON_CREATE_OPS),
  CV_APP1:    new Set(NON_CREATE_OPS),
  CV_APP2:    new Set(NON_CREATE_OPS),
};

/**
 * The actions of a coordination op kind a Position may use, where its grant is narrower than the kind (docs/adr/0101).
 * A Position absent here has every action of every kind it holds. CV_MARSHAL answers a HANDOFF and records the two
 * marks; it never PROPOSEs or CANCELs ("the carrier does not talk to the centre" stays true outbound).
 */
const COORDINATION_ACTIONS = {
  CV_MARSHAL: {
    HANDOFF: ['ACCEPT', 'REJECT', 'TRANSFER_COMMS', 'TRANSFER_CONTROL'],
    ControlRelease: ['REQUEST'],
  },
};

/**
 * What a coordination replica is minted as at a Position whose strip type differs from the sender's (docs/adr/0101 DR-3):
 * { receivingPositionId: { senderStripType: { senderState: { stripType, state } } } }. An ARRIVAL at INBOUND handed to
 * the Marshal is a MARSHAL Strip at IN_STACK, and ACCEPT joins it to the stack through the check-in path.
 */
const REPLICA_ON_RECEIPT = {
  CV_MARSHAL: { ARRIVAL: { INBOUND: { stripType: 'MARSHAL', state: 'IN_STACK' } } },
};

const CREATE_STRIP_TYPE_PERMISSIONS = {
  // Launch and recovery check-in are both a MARSHAL Strip (ADR 0064: a launch is
  // a MARSHAL Strip in LAUNCH). FINAL and PATTERN are never created, only
  // converted to by a carrier transfer, so no Position may CreateStrip them.
  CV_MARSHAL: new Set(['MARSHAL']),
};

/**
 * The carrier's ship-level capabilities (docs/adr/0064 B4, docs/adr/0074), in
 * the capability-table shape docs/adr/0080 gave the tactical Positions: one row
 * per Position, one column per capability, static (P5), so the next capability
 * is a column. Read through the one-parameter predicates below (D21: exactly one
 * acting Position, never a signed-on set). They are predicates and not OP_KINDS
 * entries because the Case, the stack and the ship input are not Strip ops: they
 * go to the CarrierStore (carrier-store.js), which asks these.
 *
 *  setsCase        the recovery Case is PriFly's alone (guide §4.1); Marshal may not
 *  sequencesStack  every stack op, including the marshal radial (H27) and Charlie time
 *  editsShipInput  the one thing a controller may enter on the banner: the altimeter
 *
 * A carrier transfer's sender is read from CARRIER_HANDOFFS[kind].from (the
 * model's own data), not repeated here.
 */
const CARRIER_CAPABILITIES = {
  CV_MARSHAL: { setsCase: false, sequencesStack: true,  editsShipInput: true },
  CV_PRIFLY:  { setsCase: true,  sequencesStack: false, editsShipInput: true },
  CV_APP1:    { setsCase: false, sequencesStack: false, editsShipInput: false },
  CV_APP2:    { setsCase: false, sequencesStack: false, editsShipInput: false },
};

function _carrierCap(positionId, key) {
  return Object.prototype.hasOwnProperty.call(CARRIER_CAPABILITIES, positionId) && CARRIER_CAPABILITIES[positionId][key] === true;
}
function canSetRecoveryCase(actingPositionId) { return _carrierCap(actingPositionId, 'setsCase'); }
function canSequenceMarshalStack(actingPositionId) { return _carrierCap(actingPositionId, 'sequencesStack'); }
function canEditShipStateInput(actingPositionId) { return _carrierCap(actingPositionId, 'editsShipInput'); }
/** May this Position record this carrier transfer (the model's `from` list)? */
function canRecordCarrierHandoff(actingPositionId, kind) {
  const row = typeof kind === 'string' && Object.prototype.hasOwnProperty.call(CARRIER_HANDOFFS, kind) ? CARRIER_HANDOFFS[kind] : null;
  return !!row && row.from.includes(actingPositionId);
}

const family = {
  family: 'carrier',
  positions: ['CV_MARSHAL', 'CV_PRIFLY', 'CV_APP1', 'CV_APP2'],
  permissions: PERMISSIONS,
  createsStripTypes: CREATE_STRIP_TYPE_PERMISSIONS,
  capabilities: CARRIER_CAPABILITIES,
  coordinationActions: COORDINATION_ACTIONS,
  replicaOnReceipt: REPLICA_ON_RECEIPT,
};

module.exports = {
  family, CARRIER_CAPABILITIES, canSetRecoveryCase, canSequenceMarshalStack, canEditShipStateInput, canRecordCarrierHandoff,
};
