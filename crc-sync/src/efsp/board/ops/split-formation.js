'use strict';

// SplitFormation (docs/adr/0099 §1): one Strip with flightSize N becomes exactly two (k and N-k). The departing part gets a
// typed callsign, a new beacon code, a copy of the plan and the heading, speed or altitude assignment (required unless the
// Strip is on the ground: H100 Q-SJ2; a return from MARSA relaxes nothing: Q-SJ1 b). Every gate runs before any write.

const crypto = require('crypto');
const { newFlags, deepClone } = require('../strip-util');
const { stripScope, callsignOf } = require('../../undo/scopes');

const ASSIGNMENT_KINDS = ['HEADING', 'SPEED', 'ALTITUDE'];

function _refuse(strip, reason, detail) { return { ok: false, reason, detail, strip }; }

/** A coordination or TOFI exchange the Strip is still negotiating (or, for TOFI, working): the split waits for it. */
function _openExchange(strip) {
  if (strip.coordination && strip.coordination.state === 'INITIATED') return 'a coordination proposal is open on this Strip — accept, reject or wait for a response first';
  if (strip.tofiCoordination && strip.tofiCoordination.state === 'INITIATED') return 'a TOFI proposal is open on this Strip — accept, reject or wait for a response first';
  if (strip.tofiCoordination && strip.tofiCoordination.state === 'ACTIVE') return 'the flight is under tactical control — split it after the TOFI exit, as a return from MARSA';
  return null;
}

function _applySplit(ctx, strip, op, meta) {
  const by = meta.by;
  const actionId = meta.clientMutationId || null;
  const elig = ctx.rules.formationEligibility(strip.stripType);
  if (!elig || strip.state === 'DROPPED' || !elig.split.includes(strip.state)) {
    return _refuse(strip, 'VALIDATION_ERROR', `a ${strip.stripType} Strip in ${strip.state} cannot be split`);
  }
  const lead = ctx.flightDataStore.getFlightData(strip.flightDataId);
  if (!lead) return _refuse(strip, 'NOT_FOUND', 'the formation\'s flight data is not found');
  const n = lead.identity.flightSize;
  if (!Number.isInteger(n) || n < 2) return _refuse(strip, 'VALIDATION_ERROR', 'a single aircraft cannot be split');
  const k = op.size;
  if (!Number.isInteger(k) || k < 1 || k >= n) {
    return _refuse(strip, 'VALIDATION_ERROR', `the departing part is 1 to ${n - 1} aircraft of ${n}`);
  }
  if (typeof op.callsign !== 'string' || op.callsign.trim() === '') {
    return _refuse(strip, 'VALIDATION_ERROR', 'type the departing part\'s callsign');
  }
  const exchange = _openExchange(strip);
  if (exchange) return _refuse(strip, 'VALIDATION_ERROR', exchange);

  const onGround = elig.ground.includes(strip.state);
  const assignment = op.assignment || null;
  if (!assignment && !onGround) {
    return _refuse(strip, 'ASSIGNMENT_REQUIRED', 'the departing part needs a heading, speed or altitude assignment');
  }
  if (assignment && !ASSIGNMENT_KINDS.includes(assignment.kind)) {
    return _refuse(strip, 'VALIDATION_ERROR', 'the assignment is a HEADING, SPEED or ALTITUDE');
  }
  // The new Strip goes directly after the lead in the same Rack (a Bay with a capacity refuses one more).
  const full = ctx.placement.bayFullRefusal(strip.bayId, { stripId: null });
  if (full) return _refuse(strip, full.reason, full.detail);

  // The flight-data half: callsign and assignment checks, then the code (the last check, the first write).
  const created = ctx.flightDataStore.createSplitFlightData(strip.flightDataId, {
    callsign: op.callsign, size: k, assignment, onGround, by,
  });
  if (!created.ok) return _refuse(strip, created.reason, created.detail);

  const rack = ctx.state.rack(strip.bayId, strip.rackId);
  const at = rack.findIndex(s => s.stripId === strip.stripId);
  const successor = at >= 0 && at + 1 < rack.length ? rack[at + 1].stripId : null;
  const orderKey = ctx.placement.resolveOrderKey(strip.bayId, strip.rackId, strip.stripId, successor, null);
  const now = ctx.clock.now();
  const annotations = {};
  for (const [blockId, cell] of Object.entries(strip.annotations || {})) {
    const active = (cell.entries || []).filter(e => e.status === 'ACTIVE').map(e => ({ ...deepClone(e), at: now, by: by || null }));
    if (active.length) annotations[blockId] = { blockId, entries: active };
  }
  const part = {
    stripId: crypto.randomUUID(),
    cid: ctx.state.nextCid(),
    flightDataId: created.flightData.flightDataId,
    rev: 1,
    stripType: strip.stripType,
    state: strip.state,
    ownerPositionId: strip.ownerPositionId,
    bayId: strip.bayId, rackId: strip.rackId, orderKey,
    annotations,
    flags: newFlags(),
    coordination: null, tofiCoordination: null,
    airspaceEntry: strip.airspaceEntry ? deepClone(strip.airspaceEntry) : null,
    previousLeg: strip.previousLeg ? deepClone(strip.previousLeg) : null,
    splitFrom: { stripId: strip.stripId, flightDataId: strip.flightDataId, at: now, actionId },
    createdAt: now, updatedAt: now, updatedBy: by || null,
  };
  if (strip.consolidatedFrom) part.consolidatedFrom = strip.consolidatedFrom;
  ctx.state.insert(part);

  const leadResult = ctx.flightDataStore.setFormationSize(strip.flightDataId, n - k, { by });
  ctx.state.bump(strip, by);
  const marsaReturn = op.marsaReturn === true;
  return {
    ok: true, strip, flightData: leadResult.flightData, flightDataList: [created.flightData],
    splitStrip: part,
    split: {
      size: k, remaining: n - k, callsign: created.flightData.identity.callsign, assignment: assignment ? { kind: assignment.kind, value: String(assignment.value).trim().toUpperCase() } : null,
      marsaReturn, newFlightDataId: created.flightData.flightDataId, beaconCode: created.flightData.identity.beaconAssigned,
    },
  };
}

module.exports = {
  kind: 'SplitFormation',
  // docs/adr/0100 §3: the lead Strip and its flight data are written; the new Strip, its flight data and its code are made.
  undo: {
    label: (op, strip, ctx) => `Split ${String(op.callsign || '').trim().toUpperCase()} off ${callsignOf(ctx, strip)}`,
    scope: (ctx, strip) => stripScope(ctx, strip),
    created: (result, ctx) => ({
      strips: result.splitStrip ? [{ facilityId: ctx.rules.facilityId, stripId: result.splitStrip.stripId }] : [],
      flightData: result.split ? [result.split.newFlightDataId] : [],
    }),
  },
  auditFields: (ctx, result) => ({ tail: {
    records: [{ stripId: result.splitStrip.stripId, flightDataId: result.splitStrip.flightDataId, before: null, after: deepClone(result.splitStrip) }],
    split: result.split,
  } }),
  apply: (ctx, strip, op, meta) => _applySplit(ctx, strip, op, meta),
};
