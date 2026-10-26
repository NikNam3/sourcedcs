'use strict';
import { settings } from '../../settings.js';
import { getEfspFlightData, getAllEfspStrips, stripsInAirspace } from './efsp-state.js';
import { formatZuluHhmm } from '../../format.js';
import * as caps from './airspace-capabilities.js';
import { altitudeText } from './airspace-draft.js';
import { deleteBlockers } from './airspace-detail-views.js';
import { isAlwaysInForce } from './airspace-validate.js';

// What a controller may do to an airspace, and how its facts read (DESK-SPLIT, split out of airspace-panel.js): rules and text, no DOM state.

/**
 * The actions this controller may take on an airspace right now, given the
 * Positions they are signed on to and where the airspace is in its lifecycle.
 *
 * Mirrors airspace-store.js's authority split (§9.11): the using agency
 * schedules, asks and releases; the controlling agency approves and takes
 * back. An airspace with no using agency of its own — an ordinary MOA — has
 * no second party, so its controlling Position does both, which is the
 * common case rather than a special one. A using Facility (ADR 0098 §3, DA-7) acts through
 * the Positions with the `use` capability (TAC_C2), never through the controlling Position.
 * A ROUTE is confirmed or delayed, never denied (S-R3-80): Approve reads Confirm, there is no Deny,
 * and a request is not required before the controlling Position confirms.
 *
 * Proactive only. The server decides; this exists so a controller is not
 * offered a button that will be refused.
 */
export function airspaceActionsFor(airspace, signedOnPositionIds) {
  const signedOn = signedOnPositionIds || [];
  const definition = (airspace && airspace.definition) || {};
  const isRoute = definition.kind === 'ROUTE';
  const hasUsingAgency = !!(definition.usingPositionId || definition.usingFacilityId);
  const controlling = caps.controllingPositionFor(signedOn, definition);
  const using = caps.usingPositionFor(signedOn, definition);

  const actions = [];
  const as = (positionId, kind, label) => actions.push({ positionId, kind, label });
  if (isAlwaysInForce(definition)) return actions; // crc-sync docs/adr/0144: a prohibited area has no lifecycle

  if (airspace.state === 'RETURNED' && (using || controlling)) {
    as(using || controlling, 'ScheduleAirspace', 'Schedule');
  }
  if (airspace.state === 'SCHEDULED') {
    if (using && hasUsingAgency && !airspace.pendingRequest) as(using, 'RequestActivation', 'Request activation');
    if (controlling && (isRoute || airspace.pendingRequest || !hasUsingAgency)) {
      as(controlling, 'ApproveActivation', isRoute ? 'Confirm' : 'Approve activation');
    }
    if (controlling && airspace.pendingRequest) {
      if (isRoute) as(controlling, 'DelayActivation', 'Delay');
      else as(controlling, 'DenyActivation', 'Deny');
    }
    if (controlling) as(controlling, 'ReturnAirspace', 'Cancel');
  }
  if (airspace.state === 'ACTIVE' && using) as(using, 'ReleaseAirspace', 'Release');
  if (airspace.state === 'RELEASED' && controlling) as(controlling, 'ReturnAirspace', 'Take back');
  return actions;
}

// ── what a controller may do to the DEFINITION (the ⋯ menu) ────────────────────────────────────

/** Why Edit is unavailable (ADR 0056: disabled with the reason), or null when it is offered. */
export function editReason(airspace, signedOnPositionIds) {
  const def = airspace.definition;
  if (!signedOnPositionIds.length) return 'Sign on to a Position to edit';
  return caps.authorityFor(signedOnPositionIds, 'edit', def) ? null : `Owned by ${def.controllingPositionId}`;
}

/** Why Delete is unavailable, or null. Authority first; then the first thing blocking it. */
export function deleteReason(airspace, signedOnPositionIds, flights) {
  const def = airspace.definition;
  if (!signedOnPositionIds.length) return 'Sign on to a Position to delete';
  if (!caps.authorityFor(signedOnPositionIds, 'delete', def)) return `Owned by ${def.controllingPositionId}`;
  const blockers = deleteBlockers(airspace, flights);
  return blockers.length ? blockers[0].blocking : null;
}

/** Which airspaces "Mine" shows: the ones a signed-on Position controls or acts for. With nothing signed on, everything. */
export function visibleAirspaces(airspaces, signedOnPositionIds, filter) {
  if (filter === 'all' || !signedOnPositionIds.length) return airspaces;
  return airspaces.filter(a => caps.controllingPositionFor(signedOnPositionIds, a.definition)
    || (a.definition.usingPositionId || a.definition.usingFacilityId ? caps.usingPositionFor(signedOnPositionIds, a.definition) : null));
}

/** Group by controlling Facility: shipped Facilities in their table order, then any other; airspaces by name inside. */
export function groupByFacility(airspaces) {
  const order = caps.facilityIds();
  const groups = new Map();
  for (const a of airspaces) {
    const f = a.definition.controllingFacilityId || '?';
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(a);
  }
  return [...groups.entries()]
    .sort(([x], [y]) => (order.indexOf(x) < 0 ? 99 : order.indexOf(x)) - (order.indexOf(y) < 0 ? 99 : order.indexOf(y)) || x.localeCompare(y))
    .map(([facilityId, list]) => ({ facilityId, airspaces: list.sort((p, q) => String(p.definition.name).localeCompare(String(q.definition.name))) }));
}

export function _zulu(ms) {
  const t = formatZuluHhmm(ms);
  return t ? `${t}Z` : '--';
}

export function _formatWindow(window) {
  if (!window) return '';
  return `${_zulu(window.fromUtc)}–${_zulu(window.toUtc)}`;
}

export function _transitionAlt() { return (settings && settings.transitionAltFt) || 18000; }

export function _altText(ft) { return altitudeText(ft, _transitionAlt()); }

export function _formatFrequency(definition) {
  // A range with a control tower of its own hands the flight to that tower;
  // an ordinary MOA to its working frequency. Showing which is which matters
  // — they are different things to say on the radio.
  if (definition.controlFrequencyMhz) return `${definition.controlFrequencyMhz.toFixed(3)} control`;
  if (definition.workingFrequencyMhz) return `${definition.workingFrequencyMhz.toFixed(3)} working`;
  return '';
}

/** The flights working an AREA: [{stripId, callsign, frequencyMhz}] for the editor's impact note and Delete's blockers. */
export function _flightsOf(airspace) {
  if (airspace.definition.kind === 'ROUTE') return [];
  return stripsInAirspace(airspace.airspaceId).map((s) => {
    const fd = getEfspFlightData(s.flightDataId);
    return { stripId: s.stripId, callsign: (fd && fd.identity && fd.identity.callsign) || s.cid || s.stripId, frequencyMhz: (s.airspaceEntry && s.airspaceEntry.frequencyMhz) ?? null };
  });
}

/** A ROUTE's occupancy: the distinct flights with a live Strip whose MTR designator (trimmed, upper case) is the route's id. A count, never a warning (S-R3-80). */
export function routeFlightCount(airspaceId) {
  const flights = new Set();
  for (const s of getAllEfspStrips()) {
    if (s.state === 'DROPPED') continue;
    const fd = getEfspFlightData(s.flightDataId);
    const d = fd && fd.military && fd.military.mtr && fd.military.mtr.designator;
    if (typeof d === 'string' && d.trim().toUpperCase() === airspaceId) flights.add(s.flightDataId);
  }
  return flights.size;
}
