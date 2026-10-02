'use strict';

// TOFI (docs/adr/0025) (guide §4.6.3), the
// ATC<->MRU sub-protocol. Kept structurally separate from the 5
// primitives above (own strip.tofiCoordination field, own dispatcher)
// rather than folded into Coordination.applyOp — TOFI is a two-step
// exchange (ENTRY and EXIT) plus a distinct comms-transfer action,
// none of which the single-shot PROPOSE/ACCEPT/REJECT shape above
// was built to express. See board/tofi.js applyOp.
module.exports = {
  kind: 'TOFI',
  undo: 'none', // docs/adr/0100: not undoable (yet); UNDO-S step 2 declares the scopes
  apply: (ctx, strip, op, meta) => ctx.tofi.applyOp(strip, op, meta.by, meta.actingPositionId),
};
