'use strict';

// Which Positions this session is signed on at, and where it is Observer: the state efsp-ws.js writes (a sign-on, its
// ack, a coverage message) and the panels read. A leaf (only the topology table), so the radio panel can read it without
// pulling in the Board's state: the radio-only page (docs/adr/0161 §2) loads nothing of the strips.
//
// WP4A (docs/adr/0013): keyed by facilityId. Each Facility's signed-on set is independent server-side (a separate
// PositionStore per Facility). Position ids are globally unique, which is what lets the flat lists below be correct.

import { allFacilityIds } from './facility-topology.js';

let _byFacility = Object.fromEntries(allFacilityIds().map(f => [f, []]));
let _observerKeys = new Set(); // 'facility/position' where the controller is Observer (coverage message)

export function setSignedOnAt(facilityId, positionIds) { _byFacility[facilityId] = [...positionIds]; }
export function setObserverKeys(keys) { _observerKeys = keys; }
export function observerKeys() { return _observerKeys; }

/** Every Position the server has this controller signed on at (Primary or Observer): what the Acting-As checkboxes show and what a new declaration extends. */
export function getSignedOnPositions(facilityId) {
  if (facilityId) return [...(_byFacility[facilityId] || [])];
  return Object.values(_byFacility).flat();
}

/**
 * The Positions this controller may ACT at: signed on and Primary. An Observer watches (crc-sync's docs/adr/0105 / the
 * GCLC finding), so it is offered no action and shows no COMBINED line. A Position the coverage message has not named
 * yet counts as Primary (sign-on just landed), and the coverage message that follows corrects it.
 *
 * @param {string} [facilityId] omit to get the flattened union across every Facility.
 */
export function getActingPositions(facilityId) {
  const facilities = facilityId ? [facilityId] : Object.keys(_byFacility);
  return facilities.flatMap(f => (_byFacility[f] || []).filter(p => !_observerKeys.has(`${f}/${p}`)));
}

/** Is the controller an Observer (not Primary) at this Position? */
export function isObserverAt(facilityId, positionId) { return _observerKeys.has(`${facilityId}/${positionId}`); }
