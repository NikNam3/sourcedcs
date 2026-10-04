'use strict';

// A HAND COPY of crc-sync's airspace authority rows (docs/adr/0098 §11; src/efsp/authority/airspace.js and the `airspace`
// column of src/efsp/authority/positions/*.js) and of the Facility -> Position table the editor's pickers need (the
// wire carries no Facility config). tests/airspace-capabilities-parity.test.mjs reads the server's tables and compares
// (ARCH-D7). Proactive only: it exists so a controller is never offered an Edit that will be refused, and so the panel can
// say WHY an action is greyed out (ADR 0056). The server decides.
//
// A row is { create, edit, delete, use }:
//   create/edit/delete  'OWN'       the Position that IS the airspace's controllingPositionId
//                       'FACILITY'  any airspace whose controllingFacilityId is the Position's own Facility (OPS, R3-11)
//                       'FREQUENCY' the airspace's usingPositionId is this Position: its control frequency only
//   use                 true        may schedule, request activation and release for an airspace whose usingFacilityId is the
//                                   Position's Facility (the `airspaceUse` capability, DA-7: TAC_C2) or whose usingPositionId is it

import { FACILITY_POSITIONS, facilityOfPosition, shippedFacilityIds, positionsOf } from './facility-topology.js';
export { FACILITY_POSITIONS, facilityOfPosition, positionsOf };

const ATC_OWN = { create: 'OWN', edit: 'OWN', delete: 'OWN', use: false };
/** The `airspace` column of the Position families, by Position. A Position with no entry has no row (it controls no airspace). */
export const AIRSPACE_ROWS = {
  OPS: { create: 'FACILITY', edit: 'FACILITY', delete: 'FACILITY', use: false },
  CD: { ...ATC_OWN }, GC: { ...ATC_OWN }, LC: { ...ATC_OWN }, AP: { ...ATC_OWN }, CTR: { ...ATC_OWN },
  TAC_C2: { create: null, edit: null, delete: null, use: true },
};

/** A Position no Facility lists is a RANGES Position (class USING_AGENCY): its control frequency, and use. */
export const CLASS_ROWS = {
  USING_AGENCY: { create: null, edit: 'FREQUENCY', delete: null, use: true },
};

const NO_ROW = { create: null, edit: null, delete: null, use: false };

/** Every Facility id a definition may name as controlling or using (RANGES is not one: it has no panel of its own). */
export function facilityIds() { return shippedFacilityIds(); }

/** The registry's row for one Position: its family's row merged over its class's row. */
export function airspaceRowOf(positionId) {
  if (!positionId) return { ...NO_ROW };
  const cls = facilityOfPosition(positionId) === 'RANGES' ? CLASS_ROWS.USING_AGENCY : {};
  return { ...NO_ROW, ...cls, ...(AIRSPACE_ROWS[positionId] || {}) };
}

function _scopeAllows(scope, def, positionId) {
  if (scope === 'OWN') return def.controllingPositionId === positionId;
  if (scope === 'FACILITY') return facilityOfPosition(positionId) === def.controllingFacilityId;
  return false;
}

/**
 * 'ALL' (any field), 'FREQUENCY' (control frequency only) or null, for one Position creating/editing/deleting `def`.
 * @param {string} positionId
 * @param {'create'|'edit'|'delete'} action
 */
export function definitionAuthority(positionId, action, def) {
  const scope = airspaceRowOf(positionId)[action];
  if (_scopeAllows(scope, def, positionId)) return 'ALL';
  if (action === 'edit' && scope === 'FREQUENCY' && def.usingPositionId === positionId) return 'FREQUENCY';
  return null;
}

/**
 * Which of the signed-on Positions acts for `action` on `def`, and with what reach: the one with 'ALL' first, then 'FREQUENCY'.
 * @returns {{positionId:string, scope:'ALL'|'FREQUENCY'}|null}
 */
export function authorityFor(signedOnPositionIds, action, def) {
  let best = null;
  for (const positionId of signedOnPositionIds || []) {
    const scope = definitionAuthority(positionId, action, def);
    if (scope === 'ALL') return { positionId, scope };
    if (scope && !best) best = { positionId, scope };
  }
  return best;
}

/** Is `positionId` the controlling Position of `def`? */
export function isControlling(def, positionId) { return def.controllingPositionId === positionId; }

/** Does `positionId` act for the using side of `def` (a using Facility's `use` Positions, a using Position, else the controlling Position)? */
export function isUsing(def, positionId) {
  if (def.usingFacilityId) return !!airspaceRowOf(positionId).use && facilityOfPosition(positionId) === def.usingFacilityId;
  if (def.usingPositionId) return def.usingPositionId === positionId;
  return isControlling(def, positionId);
}

/** The signed-on Position that acts for the using side of `def`, or null. */
export function usingPositionFor(signedOnPositionIds, def) {
  return (signedOnPositionIds || []).find(p => isUsing(def, p)) || null;
}

/** The signed-on Position that is the controlling Position of `def`, or null. */
export function controllingPositionFor(signedOnPositionIds, def) {
  return (signedOnPositionIds || []).find(p => isControlling(def, p)) || null;
}

/**
 * The Positions a session could create an airspace as, with the scope each has: [{positionId, scope:'OWN'|'FACILITY'}].
 * "+ New airspace" shows only when this is non-empty.
 */
export function createPositionsFor(signedOnPositionIds) {
  const out = [];
  for (const positionId of signedOnPositionIds || []) {
    const scope = airspaceRowOf(positionId).create;
    if (scope) out.push({ positionId, scope });
  }
  return out;
}

/** The controlling Facility/Position pairs this session may name when creating: OWN = itself, FACILITY = any Position of its Facility. */
export function controllingChoicesFor(signedOnPositionIds) {
  const out = [];
  const add = (facilityId, positionId) => { if (!out.some(c => c.facilityId === facilityId && c.positionId === positionId)) out.push({ facilityId, positionId }); };
  for (const { positionId, scope } of createPositionsFor(signedOnPositionIds)) {
    const facilityId = facilityOfPosition(positionId);
    if (scope === 'OWN') add(facilityId, positionId);
    else for (const p of positionsOf(facilityId)) add(facilityId, p);
  }
  return out;
}
