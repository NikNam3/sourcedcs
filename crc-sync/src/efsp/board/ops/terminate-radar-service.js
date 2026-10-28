'use strict';

// TerminateRadarService (H136 VQ6 a, docs/wip/LT-VFR.md; docs/adr/0146: the end of a VFR strip, at whoever holds it):
// "RADAR SERVICE TERMINATED, SQUAWK VFR" (JO 7110.65BB
// para 5-1-9 a, 5-2-7 b, 7-6-11) as one action on the Strip: it is dropped (the one retirement path, which releases
// the code once no other live Strip holds the flight), any airspace entry is cleared, and the explicit binding to the
// contact ends at once rather than at the reconciler's next sweep. The contact is untracked again. The single action is
// ours. Undo puts the Strip, the code, the entry and the binding back (a binding another flight has taken since stays
// with it).

const { retireScope, callsignOf, union } = require('../../undo/scopes');

function _applyTerminate(ctx, strip, op, meta) {
  const { by, actingPositionId } = meta;
  if (strip.state === 'DROPPED') return { ok: false, reason: 'VALIDATION_ERROR', detail: 'this Strip is already dropped', strip };
  const dropped = ctx.run('DropStrip', strip, { kind: 'DropStrip', reason: 'RADAR_SERVICE_TERMINATED' }, meta);
  if (!dropped.ok) return dropped;

  let flightData;
  if (strip.airspaceEntry) {
    const r = ctx.flightDataStore.setWorkingFrequency(strip.flightDataId, null, { airspaceId: null, by });
    if (r.ok) flightData = r.flightData;
    strip.airspaceEntry = null;
    ctx.state.bump(strip, by);
  }
  const ended = ctx.rules.endTrackBinding(strip.flightDataId, { actingPositionId, by });
  const flightDataList = [...(dropped.flightDataList || [])];
  if (flightData && dropped.flightData) flightDataList.push(flightData);
  return {
    ...dropped,
    strip,
    flightData: flightData || dropped.flightData,
    flightDataList: flightDataList.length ? flightDataList : undefined,
    correlationChanged: ended ? [ended] : undefined,
  };
}

module.exports = {
  kind: 'TerminateRadarService',
  // A retirement (DropStrip's scope), plus the binding it ends.
  undo: {
    label: (op, strip, ctx) => `Radar service terminated ${callsignOf(ctx, strip)}`,
    scope: (ctx, strip) => union(retireScope(ctx, strip), { correlations: strip.flightDataId ? [strip.flightDataId] : [] }),
  },
  auditFields: (ctx, result) => (result.controlAudit ? { tail: result.controlAudit } : {}),
  apply: (ctx, strip, op, meta) => _applyTerminate(ctx, strip, op, meta),
};
