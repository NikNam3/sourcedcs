'use strict';

// Does the controller sending a handoff also hold the receiving Position? (guide §4.8.3 self-coordination, widened to
// cover.) True when the controller is Primary at `positionId`, or `positionId` is unstaffed and the Position covering it
// (`consolidatedAt`: its hat-taker, else its hand-back target, docs/adr/0110) is one the controller is Primary at.
// STARS treats consolidated sectors as one: a handoff between them has nobody else to answer it, so it is accepted at
// once (the handoff ops' auto-accept). `rules` is the receiving Facility's (facility-rules.js).

/**
 * @param {{isSelfCoordinated:(c:string,p:string)=>boolean, isStaffed:(p:string)=>boolean, consolidatedAt:(p:string)=>string|null}} rules
 * @param {string|null|undefined} controllerId
 * @param {string} positionId
 * @returns {boolean}
 */
function heldByController(rules, controllerId, positionId) {
  if (!controllerId || !positionId) return false;
  if (rules.isSelfCoordinated(controllerId, positionId)) return true;
  if (rules.isStaffed(positionId)) return false;
  const cover = rules.consolidatedAt(positionId);
  return !!cover && rules.isSelfCoordinated(controllerId, cover);
}

module.exports = { heldByController };
