'use strict';

const { stripScope, retireScope, union, callsignOf } = require('../../undo/scopes');

// TOFI (docs/adr/0025) (guide §4.6.3), the
// ATC<->MRU sub-protocol. Kept structurally separate from the 5
// primitives above (own strip.tofiCoordination field, own dispatcher)
// rather than folded into Coordination.applyOp — TOFI is a two-step
// exchange (ENTRY and EXIT) plus a distinct comms-transfer action,
// none of which the single-shot PROPOSE/ACCEPT/REJECT shape above
// was built to express. See board/tofi.js applyOp.
module.exports = {
  kind: 'TOFI',
  // docs/adr/0100: a PROPOSE (ENTRY or EXIT) is withdrawn by an undo while the MRU has not answered (H100 Q-U3 a);
  // ACCEPT, REJECT and TRANSFER_COMMS answer another party and are not undoable.
  undo: {
    label: (op, strip, ctx) => `TOFI ${op.direction === 'EXIT' ? 'Exit' : 'Entry'} ${callsignOf(ctx, strip)}`,
    scope: (ctx, strip, op) => {
      if (op.action !== 'PROPOSE') return null;
      const scope = stripScope(ctx, strip);
      if (op.direction === 'EXIT') {
        const prior = strip.tofiCoordination;
        if (prior && prior.peerFacilityId && prior.peerStripId) scope.strips.push({ facilityId: prior.peerFacilityId, stripId: prior.peerStripId });
        return scope;
      }
      // ENTRY mints a MISSION Strip on the MRU Board, or re-uses its live one for this flight.
      const peer = op.toFacilityId ? ctx.rules.peerBoard(op.toFacilityId) : null;
      for (const s of peer ? peer.getAll() : []) {
        if (s.flightDataId === strip.flightDataId && s.state !== 'DROPPED') scope.strips.push({ facilityId: op.toFacilityId, stripId: s.stripId });
      }
      return scope;
    },
    created: (result) => (result.peerStrip && result.peerFacilityId
      ? { strips: [{ facilityId: result.peerFacilityId, stripId: result.peerStrip.stripId }] } : {}),
  },
  apply: (ctx, strip, op, meta) => ctx.tofi.applyOp(strip, op, meta.by, meta.actingPositionId),
};
