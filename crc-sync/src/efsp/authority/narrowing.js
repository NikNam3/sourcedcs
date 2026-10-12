'use strict';

// Authority that NARROWS a grant on facility data (docs/adr/0095, S-M-AUTH; AUDIT-GAPS). The registry's tables say
// which Position CLASS may do an op at all. These rules say which Position, of those, may do it HERE, or what a
// self-coordination needs, so the "who may" doctrine lives in the registry and not in a store. The DATA (who the
// authority is) stays in the facility JSON; the predicates take plain values, never a store, and return null when
// the act is allowed, else the refusal `{ ok:false, reason, detail }` the store hands back unchanged.

/**
 * Only the Facility's named inspection authority may sign off a runway inspection (CompleteInspection).
 * @param {string} actingPositionId
 * @param {{inspectionAuthorityPositionId?:string|null}} inventory the Facility's runway-status inventory slice
 */
function runwayInspectionRefusal(actingPositionId, inventory) {
  const authority = inventory && inventory.inspectionAuthorityPositionId;
  if (authority && actingPositionId !== authority) {
    return { ok: false, reason: 'PERMISSION_DENIED', detail: `only ${authority} may sign off a runway inspection here` };
  }
  return null;
}

/**
 * A self-coordinated runway change is legal only when the proposer is Primary on every acknowledger that is staffed.
 * @param {string[]} required the staffed acknowledgers (the ones whose acknowledgement is still owed)
 * @param {(positionId:string)=>string|null} primaryOf who is Primary at a Position (a plain lookup, evaluated per Position)
 * @param {string|null|undefined} by the proposer
 */
function selfCoordinationRefusal(required, primaryOf, by) {
  const elsewhere = required.filter(p => primaryOf(p) !== by);
  if (elsewhere.length) {
    return { ok: false, reason: 'PERMISSION_DENIED', detail: `a self-coordinated runway change needs you Primary at ${elsewhere.join(' and ')} — ask for the acknowledgement instead` };
  }
  return null;
}

module.exports = { runwayInspectionRefusal, selfCoordinationRefusal };
