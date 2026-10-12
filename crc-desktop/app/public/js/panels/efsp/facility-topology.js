'use strict';

// The one client copy of the Facility -> Position topology (ARCH-C #8). It is a table, not derived from the snapshot,
// because the "acting as" checkboxes and the airspace editor's pickers must work before the first snapshot lands (the
// wire carries no Facility config). tests/facility-topology-parity.test.mjs holds it to crc-sync's shipped
// config/efsp-facility-*.json and facility-config.js. A leaf module: it imports nothing.
//
// RANGES is deliberately absent from FACILITY_POSITIONS: its Position set is derived server-side from the airspace config
// (a Position exists only for a range with control of its own), so the snapshot's `positions` are the only source.

/** Facility -> its Position ids, in display order (crc-sync config/efsp-facility-*.json). */
export const FACILITY_POSITIONS = {
  INCIRLIK: ['OPS', 'CD', 'GC', 'LC', 'RSU', 'AP', 'PAR'],
  CENTER: ['CTR'],
  TACTICAL: ['TAC_C2', 'AIC', 'GCI', 'JTAC'],
  CARRIER: ['CV_MARSHAL', 'CV_PRIFLY', 'CV_APP1', 'CV_APP2'],
};

/** The Facility with no static Position list: its Positions are the snapshot's with this facilityId. */
export const RANGES_FACILITY_ID = 'RANGES';

/** The Facility crc-sync assumes when a message names none (facility-config.js DEFAULT_FACILITY_ID); the snapshot's `facilities[0]` agrees. */
export const DEFAULT_FACILITY_ID = 'INCIRLIK';

/** The shipped (static) Facility ids, default first. */
export function shippedFacilityIds() { return Object.keys(FACILITY_POSITIONS); }

/** Every Facility id the client tracks signed-on Positions for: the shipped ones plus RANGES. */
export function allFacilityIds() { return [...shippedFacilityIds(), RANGES_FACILITY_ID]; }

/** The Facility a Position belongs to: a shipped one, else RANGES (a range-control Position), null for no Position. */
export function facilityOfPosition(positionId) {
  if (!positionId) return null;
  for (const [facility, positions] of Object.entries(FACILITY_POSITIONS)) if (positions.includes(positionId)) return facility;
  return RANGES_FACILITY_ID;
}

/** The Position ids of a shipped Facility ([] for anything else, RANGES included). */
export function positionsOf(facilityId) { return [...(FACILITY_POSITIONS[facilityId] || [])]; }
