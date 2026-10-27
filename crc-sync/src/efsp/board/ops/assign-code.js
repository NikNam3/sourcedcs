'use strict';

// AssignCode (docs/adr/0146, H175 VR-Q4): the holder of a strip whose flight has no code asks for a computer-assigned
// discrete one (JO 7110.65BB para 5-2-7 a). A VFR tagged on its primary target has none (StartFlightFollowing); this is
// the optional code from the label menu. A code can then be changed by typing it into Block 5, as on every strip.
// Not undone (docs/adr/0100 §1): the strip's Block 5 changes it, a drop releases it.

function _applyAssignCode(ctx, strip, op, meta) {
  if (strip.state === 'DROPPED') return { ok: false, reason: 'VALIDATION_ERROR', detail: 'this strip is dropped', strip };
  const r = ctx.flightDataStore.assignDiscreteCode(strip.flightDataId, { by: meta.by });
  if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail, strip };
  return { ok: true, strip, flightData: r.flightData, assignedCode: r.code };
}

module.exports = {
  kind: 'AssignCode',
  undo: 'none',
  auditFields: (ctx, result) => ({ tail: { assignedCode: result.assignedCode } }),
  apply: (ctx, strip, op, meta) => _applyAssignCode(ctx, strip, op, meta),
};
