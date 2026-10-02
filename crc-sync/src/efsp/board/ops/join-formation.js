'use strict';

// JoinFormation (docs/adr/0099 §2): the joiner follows the lead. The joiner's Strip ends through the one retirement path
// (`ctx.retire`: code released, MARSA relation ended, archive clock) with endReason JOINED, its flight data is voided, and the
// lead's flightSize grows by the joiner's. Addressed Strip = the joiner; the lead's change rides in the audit `records`.

const { deepClone } = require('../strip-util');

function _refuse(strip, reason, detail) { return { ok: false, reason, detail, strip }; }

function _exchangeProblem(s, label) {
  if (s.coordination && s.coordination.state === 'INITIATED') return `${label} has an open coordination proposal — accept, reject or wait for a response first`;
  if (s.tofiCoordination && (s.tofiCoordination.state === 'INITIATED' || s.tofiCoordination.state === 'ACTIVE')) {
    return `${label} has an open or active TOFI exchange — complete it first`;
  }
  return null;
}

function _applyJoin(ctx, joiner, op, meta) {
  const by = meta.by;
  const elig = ctx.rules.formationEligibility(joiner.stripType);
  if (!elig || joiner.state === 'DROPPED' || !elig.join.includes(joiner.state)) {
    return _refuse(joiner, 'VALIDATION_ERROR', `a ${joiner.stripType} Strip in ${joiner.state} cannot join a formation`);
  }
  const lead = op.leadStripId ? ctx.state.get(op.leadStripId) : null;
  if (!lead) return _refuse(joiner, 'NOT_FOUND', 'the lead Strip is not on this Board');
  if (lead.stripId === joiner.stripId) return _refuse(joiner, 'VALIDATION_ERROR', 'a Strip cannot join itself');
  if (!Number.isInteger(op.leadBaseRev) || lead.rev !== op.leadBaseRev) {
    return { ok: false, reason: 'STALE_REV', detail: 'the lead Strip changed — look again', strip: joiner };
  }
  if (lead.ownerPositionId !== meta.actingPositionId) {
    return _refuse(joiner, 'NOT_OWNER', `${lead.ownerPositionId} holds the lead Strip — both Strips must be yours`);
  }
  const leadElig = ctx.rules.formationEligibility(lead.stripType);
  if (!leadElig || lead.state === 'DROPPED' || !leadElig.join.includes(lead.state)) {
    return _refuse(joiner, 'VALIDATION_ERROR', `a ${lead.stripType} Strip in ${lead.state} cannot lead a formation`);
  }
  if (ctx.isRejectedReplica(lead)) return _refuse(joiner, 'VALIDATION_ERROR', ctx.rejectedReplicaDetail(lead));
  if (lead.flightDataId === joiner.flightDataId) return _refuse(joiner, 'VALIDATION_ERROR', 'both Strips are one flight already');
  const problem = _exchangeProblem(joiner, 'the joiner') || _exchangeProblem(lead, 'the lead');
  if (problem) return _refuse(joiner, 'VALIDATION_ERROR', problem);

  const joinerFd = ctx.flightDataStore.getFlightData(joiner.flightDataId);
  const leadFd = ctx.flightDataStore.getFlightData(lead.flightDataId);
  if (!joinerFd || !leadFd) return _refuse(joiner, 'NOT_FOUND', 'flight data not found');
  if (leadFd.voided) return _refuse(joiner, 'VALIDATION_ERROR', 'the lead\'s flight data is void');
  if (ctx.rules.liveStripsForFlightData(joiner.flightDataId, joiner.stripId) !== 0) {
    return _refuse(joiner, 'VALIDATION_ERROR', `${joinerFd.identity.callsign} has another live Strip (a replica at another Facility or a mission line) — resolve it first`);
  }

  const joinerSize = Number.isInteger(joinerFd.identity.flightSize) ? joinerFd.identity.flightSize : 1;
  const leadBefore = deepClone(lead);
  const warnings = [];
  const a = (joinerFd.identity.aircraftType || '').trim(); const b = (leadFd.identity.aircraftType || '').trim();
  if (a && b && a !== b) warnings.push(`mixed formation: type stays ${b}`);
  if (elig.ground.includes(joiner.state) !== leadElig.ground.includes(lead.state)) warnings.push('one Strip is on the ground and the other airborne');

  const retired = ctx.retire(joiner, by);
  if (!retired.ok) return retired;
  joiner.endReason = 'JOINED';
  joiner.joinedInto = { stripId: lead.stripId, flightDataId: lead.flightDataId };

  const voided = ctx.flightDataStore.voidFlightData(joiner.flightDataId, { reason: 'JOINED', into: lead.flightDataId, by });
  const grown = ctx.flightDataStore.setFormationSize(lead.flightDataId, leadFd.identity.flightSize + joinerSize, { by });
  ctx.state.bump(lead, by);
  return {
    ...retired,
    ok: true, strip: joiner,
    flightData: grown.flightData,
    flightDataList: [voided.flightData, ...(retired.flightDataList || [])],
    warning: warnings.length ? warnings.join('; ') : undefined,
    joinLead: { stripId: lead.stripId, before: leadBefore },
    join: { leadFlightDataId: lead.flightDataId, joinerFlightDataId: joiner.flightDataId, joinerSize, newSize: grown.flightData.identity.flightSize },
  };
}

module.exports = {
  kind: 'JoinFormation',
  // docs/adr/0100 §3: both Strips, both flight data, the joiner's code and its MARSA relations are written.
  undo: {
    label: () => 'Join formation',
    scope: (ctx, strip, op) => {
      const lead = ctx.state.get(op.leadStripId);
      const fd = ctx.flightDataStore.getFlightData(strip.flightDataId);
      const leadFd = lead ? ctx.flightDataStore.getFlightData(lead.flightDataId) : null;
      return {
        strips: [{ facilityId: ctx.rules.facilityId, stripId: strip.stripId }, ...(lead ? [{ facilityId: ctx.rules.facilityId, stripId: lead.stripId }] : [])],
        flightData: [strip.flightDataId, ...(leadFd ? [leadFd.flightDataId] : [])],
        codes: fd && fd.identity.beaconAssigned ? [fd.identity.beaconAssigned] : [],
        marsa: [{ flightDataId: strip.flightDataId }],
      };
    },
  },
  auditFields: (ctx, result) => {
    const lead = ctx.state.get(result.joinLead.stripId);
    return { tail: {
      records: [{ stripId: lead.stripId, flightDataId: lead.flightDataId, before: result.joinLead.before, after: deepClone(lead) }],
      join: result.join,
    } };
  },
  apply: (ctx, strip, op, meta) => _applyJoin(ctx, strip, op, meta),
};
