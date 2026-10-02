'use strict';

// Who may create, edit, delete, import and use an airspace (docs/adr/0098 §11): the airspace rows of the authority
// registry (S3-2, AUTH's follow-up: the store used to keep its own `_isControlling`/`_isUsing`).
//
// Rows, by Position, on the Position families (`airspace` column, authority/positions/*.js) and by Position class
// below. A row is `{ create, edit, delete, use }`:
//
//   create/edit/delete  'OWN'       the Position that IS the airspace's controllingPositionId
//                       'FACILITY'  any airspace whose controllingFacilityId is the Position's own Facility (OPS, R3-11)
//                       'FREQUENCY' the airspace's `usingPositionId` is this Position: its control frequency only
//   use                 true        may schedule, request activation and release for an airspace whose
//                                   `usingFacilityId` is the Position's Facility (the `airspaceUse` capability,
//                                   DA-7: TAC_C2 only) or whose `usingPositionId` is this Position (a RANGES Position)
//
// A Position with no row, and a session signed on to nothing, may do none of it (it still reads everything:
// airspaces are not flights). Approve/confirm/deny/return stay with the controlling Position alone, as before.
// Static (P5): read at load, never written.

const SERVICE_ROWS = {
  // The web service principal (ADR 0098 §9): create, edit and delete any airspace in any theater, and import. Still
  // subject to R3-23, the delete guard, defRev and validation, which are not authority.
  SQUADRON_ADMIN: { create: 'ANY', edit: 'ANY', delete: 'ANY', import: true, use: false },
  // The standing-list seed at start-up (ImportAirspaces, via 'SEED').
  SEED: { create: 'ANY', edit: null, delete: null, import: true, use: false },
};

// Class rows, for Positions no family lists (the derived RANGES Facility; authority/classes.js's USING_AGENCY).
const CLASS_ROWS = {
  USING_AGENCY: { create: null, edit: 'FREQUENCY', delete: null, use: true },
};

/** The registry's row for one Position: its family's row merged over its class's row. Null scopes mean "no". */
function rowFor(positionId, { familyRows, classOf }) {
  const own = familyRows[positionId] || {};
  const cls = CLASS_ROWS[classOf(positionId)] || {};
  return { create: null, edit: null, delete: null, use: false, ...cls, ...own };
}

/**
 * @typedef {{positionId:string}|{service:string}} Principal
 * @param {object} deps `{ rowOf(positionId), facilityOf(positionId) }`
 */
function _scopeAllows(scope, def, positionId, facilityOf) {
  if (scope === 'ANY') return true;
  if (scope === 'OWN') return def.controllingPositionId === positionId;
  if (scope === 'FACILITY') return facilityOf(positionId) === def.controllingFacilityId;
  return false;
}

/** 'ALL' (any field), 'FREQUENCY' (control frequency only) or null, for creating/editing/deleting `def`. */
function definitionAuthority(principal, action, def, { rowOf, facilityOf }) {
  const row = principal.service ? SERVICE_ROWS[principal.service] : rowOf(principal.positionId);
  if (!row) return null;
  const scope = row[action];
  if (principal.service) return scope === 'ANY' ? 'ALL' : null;
  if (_scopeAllows(scope, def, principal.positionId, facilityOf)) return 'ALL';
  if (action === 'edit' && scope === 'FREQUENCY' && def.usingPositionId === principal.positionId) return 'FREQUENCY';
  return null;
}

/** May this principal import a list of definitions (service and seed only in v1)? */
function mayImport(principal) {
  return !!(principal.service && SERVICE_ROWS[principal.service] && SERVICE_ROWS[principal.service].import);
}

/** Is `positionId` the controlling Position of `def`? (approve, confirm, deny, return, and the delay of a route request) */
function isControlling(def, positionId) { return def.controllingPositionId === positionId; }

/**
 * Does `positionId` act for the using side of `def`? A using Facility's Positions with the `use` capability; a using
 * Position itself; and, with no using agency at all, the controlling Position (it acts for both sides, as before).
 */
function isUsing(def, positionId, { rowOf, facilityOf }) {
  if (def.usingFacilityId) return !!rowOf(positionId).use && facilityOf(positionId) === def.usingFacilityId;
  if (def.usingPositionId) return def.usingPositionId === positionId;
  return isControlling(def, positionId);
}

module.exports = { SERVICE_ROWS, CLASS_ROWS, rowFor, definitionAuthority, mayImport, isControlling, isUsing };
