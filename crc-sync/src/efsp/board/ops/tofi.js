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
  // MARK_ENTERED (docs/adr/0102, DR-5 a) is the MRU's own one-click mark and writes only this Strip and its flight
  // data, so an undo puts the pending regime back. ACCEPT, REJECT and TRANSFER_COMMS answer another party and are not
  // undoable, and neither is the monitor's automatic entry (a system write, never a Mutation).
  undo: {
    label: (op, strip, ctx) => (op.action === 'MARK_ENTERED'
      ? `Mark entered ${callsignOf(ctx, strip)}`
      : `TOFI ${op.direction === 'EXIT' ? 'Exit' : 'Entry'} ${callsignOf(ctx, strip)}`),
    scope: (ctx, strip, op) => {
      if (op.action === 'MARK_ENTERED') return stripScope(ctx, strip);
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
  // docs/adr/0102: the regime entry (ACCEPT already inside, MARK_ENTERED) says how and where it became effective.
  auditFields: (ctx, result) => (result.tofiRegime ? { tail: { tofiRegime: result.tofiRegime } } : {}),
};
