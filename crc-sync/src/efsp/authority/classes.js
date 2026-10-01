'use strict';

// Rules by Position CLASS (facility-config.js's positionClasses), moved from
// permission.js into the authority registry (AUTH). A class rule covers a
// future Position of that class with no edit to any Position family.

const facilityConfig = require('../facility-config');

// WP4A second slice (docs/adr/0025) — defect D12: "TAC_C2, GCI, AIC and
// JTAC MUST NOT be given HANDOFF or POINT_OUT" (guide §4.1 rule 1), which
// this generalizes to all 5 COORDINATION_OP_KINDS. Read from facility-
// config.js's per-Position positionClasses map (docs/adr/0020's own
// directive: "gate the 5 coordination op kinds on [a class concept]...
// rather than the current flat per-Position-ID PERMISSIONS table") instead
// of a hand-maintained ID list, so a future MRU/non-ATC Position
// automatically inherits the same refusal with no new line needed here.
// Applied as a structural strip-back (authority/index.js), layered on top of the
// hand-authored PERMISSIONS table (belt-and-suspenders): even a future
// typo that accidentally grants a coordination kind to an MRU Position's
// entry gets silently corrected by this loop, not just documented against.
const MRU_OR_NON_ATC_CLASSES = new Set(['MRU', 'MRU_POSITION', 'NON_ATC']);
function _isMruOrNonAtc(positionId) {
  return MRU_OR_NON_ATC_CLASSES.has(facilityConfig.getPositionClass(positionId));
}

// Guide §4.1's `RANGE` row: Class "Using agency", Primitives "no strip
// primitives — owns airspace state", Strip Roles "none". A Position of this
// class works no Strips at all, so it is refused every Strip op kind by
// class, in canMutate below.
//
// Refusing by class rather than by omission from PERMISSIONS matters because
// the RANGES Facility's Positions are DERIVED from the airspace config
// (facility-config.js) rather than hand-listed here — there is no table entry
// to leave out, and an unknown Position currently falls through to "no
// permissions" only as a side effect of PERMISSIONS[id] being undefined.
// This makes the refusal the rule it is meant to be, and keeps holding if
// someone later adds a table entry for a range Position by mistake.
const NO_STRIP_OP_CLASSES = new Set(['USING_AGENCY']);
function _worksNoStrips(positionId) {
  return NO_STRIP_OP_CLASSES.has(facilityConfig.getPositionClass(positionId));
}

// B5 (docs/adr/0080, decisions.md H40): a NON_ATC Position (JTAC) has no scope
// either (`positionRadars.JTAC` is []), so it can neither say which blip a
// flight is nor declare MARSA. Derived from the class, so a future non-ATC
// Position is covered with no edit here.
const NO_SCOPE_CLASSES = new Set(['NON_ATC']);
function _hasNoScope(positionId) {
  return NO_SCOPE_CLASSES.has(facilityConfig.getPositionClass(positionId));
}

module.exports = { MRU_OR_NON_ATC_CLASSES, NO_STRIP_OP_CLASSES, NO_SCOPE_CLASSES, _isMruOrNonAtc, _worksNoStrips, _hasNoScope };
