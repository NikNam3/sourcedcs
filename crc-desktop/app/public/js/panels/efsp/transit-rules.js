'use strict';
import { isTransitAirspace, transitDeciders } from './airspace-capabilities.js';
import { hasNoClearance } from './vfr.js';

// Transit through active SUA (crc-sync docs/adr/0128, H151): what a Strip and an airspace card offer and show. Pure: the
// caller passes the airspaces, the flight data and the Positions this controller holds. The server decides every op; this
// only keeps a controller from being offered what will be refused, and words the grey marks (H151 MT-Q7 b: grey only).

const OPEN = new Set(['REQUESTED', 'APPROVED']);

/** The transit of this flight on this airspace record, or null. */
export function transitOn(airspace, flightDataId) {
  return ((airspace && airspace.transits) || []).find(t => t.flightDataId === flightDataId) || null;
}

/** Every transit of this flight: [{airspace, transit}], in the airspaces' order. */
export function transitsOfFlight(flightDataId, airspaces) {
  const out = [];
  for (const airspace of airspaces || []) {
    const transit = transitOn(airspace, flightDataId);
    if (transit) out.push({ airspace, transit });
  }
  return out;
}

const _name = (airspace) => (airspace && airspace.definition && airspace.definition.name) || (airspace && airspace.airspaceId) || '?';

/**
 * The grey mark on the transit's Strip: `TRANSIT <name>` once approved, with `REQ` while asked, `DECLINED` until the
 * Position holding the flight acknowledges the decline (crc-sync ADR 0136). `title` says who asked and who decided.
 * @returns {{text:string, title:string, state:string}}
 */
export function transitMark(airspace, transit) {
  const name = _name(airspace);
  const text = transit.state === 'APPROVED' ? `TRANSIT ${name}` : transit.state === 'REQUESTED' ? `TRANSIT ${name} REQ` : `TRANSIT ${name} DECLINED`;
  const bits = [];
  if (transit.requestedPositionId) bits.push(`requested by ${transit.requestedPositionId}`);
  if (transit.state === 'APPROVED') bits.push(`approved by ${transit.decidedPositionId}${transit.selfCoordinated ? ' (self-coordinated)' : ''}`);
  if (transit.state === 'DECLINED') bits.push(`declined by ${transit.decidedPositionId}${transit.reason ? `: ${transit.reason}` : ''}`);
  if (transit.state === 'REQUESTED') bits.push(`waiting for ${transitDeciders(airspace.definition || {}).join(' or ') || 'the decider'}`);
  return { text, title: `Transit of ${name}: ${bits.join(', ')}`, state: transit.state };
}

/**
 * The airspaces this controller may ask a transit of for this Strip's flight: it holds the Strip's owner, the flight is
 * IFR (vfr.js), and the airspace is an ACTIVE transit type with no open transit of this flight. Each choice names the
 * Position the request is sent as (the owner) and, when this controller also holds a decider, that decider: the request
 * is then approved by the same controller at once (self-coordination, crc-sync `_approveTransit`).
 * @returns {{airspace:object, positionId:string, deciderPositionId:string|null}[]}
 */
export function requestTransitChoices(strip, flightData, airspaces, held) {
  if (!strip || strip.state === 'DROPPED' || !(held || []).includes(strip.ownerPositionId)) return [];
  if (!flightData || hasNoClearance(flightData)) return [];
  const out = [];
  for (const airspace of airspaces || []) {
    if (airspace.state !== 'ACTIVE' || !isTransitAirspace(airspace)) continue;
    const t = transitOn(airspace, strip.flightDataId);
    if (t && OPEN.has(t.state)) continue;
    const deciders = transitDeciders(airspace.definition || {});
    const deciderPositionId = deciders.includes(strip.ownerPositionId) ? null : (held.find(p => deciders.includes(p)) || null);
    out.push({ airspace, positionId: strip.ownerPositionId, deciderPositionId });
  }
  return out;
}

/** The REQUESTED transits of this Strip's flight this controller may cancel (it holds the Strip's owner). */
export function cancelableTransits(strip, airspaces, held) {
  if (!strip || strip.state === 'DROPPED' || !(held || []).includes(strip.ownerPositionId)) return [];
  return transitsOfFlight(strip.flightDataId, airspaces)
    .filter(({ transit }) => transit.state === 'REQUESTED')
    .map(({ airspace }) => ({ airspace, positionId: strip.ownerPositionId }));
}

/**
 * The DECLINED transits of this Strip's flight this controller may acknowledge (crc-sync ADR 0136, H156 MTB-Q2 b): it holds
 * the Strip's owner, whoever asked. The decline stays on the Strip and the card until then.
 */
export function acknowledgeableTransits(strip, airspaces, held) {
  if (!strip || strip.state === 'DROPPED' || !(held || []).includes(strip.ownerPositionId)) return [];
  return transitsOfFlight(strip.flightDataId, airspaces)
    .filter(({ transit }) => transit.state === 'DECLINED')
    .map(({ airspace }) => ({ airspace, positionId: strip.ownerPositionId }));
}

/**
 * What one card row offers (crc-sync docs/adr/0124 §1 list, docs/adr/0128): the decider approves or declines; the Position
 * holding one of the flight's live Strips requests or cancels, and acknowledges a decline (ADR 0136). `deciders` is the server's list for the card
 * (`transitDeciders` on the traffic group), else the mirror's. Null fields: not offered. `flightData`, when this client has it,
 * keeps a VFR flight (vfr.js) from being offered a request or an approval (H151 MT-Q5 b); a decline stays.
 * @param {{transit:object|null, strips:{positionId:string}[]}} row
 * @returns {{text:string|null, approveAs:string|null, declineAs:string|null, requestAs:string|null, cancelAs:string|null, acknowledgeAs:string|null}}
 */
export function transitRowOffer(row, airspace, held, deciders, flightData = null) {
  const none = { text: null, approveAs: null, declineAs: null, requestAs: null, cancelAs: null, acknowledgeAs: null };
  if (!airspace || !isTransitAirspace(airspace)) return none;
  const t = row.transit || null;
  const text = t ? (t.state === 'APPROVED' ? 'transit approved' : t.state === 'REQUESTED' ? `transit requested by ${t.requestedPositionId}` : `transit declined${t.reason ? `: ${t.reason}` : ''}`) : null;
  if (airspace.state !== 'ACTIVE') return { ...none, text };
  const decide = deciders && deciders.length ? deciders : transitDeciders(airspace.definition || {});
  const decider = (held || []).find(p => decide.includes(p)) || null;
  const holder = (row.strips || []).map(s => s.positionId).find(p => (held || []).includes(p)) || null;
  const vfr = !!flightData && hasNoClearance(flightData);
  return {
    text,
    approveAs: decider && !vfr && (!t || t.state !== 'APPROVED') ? decider : null,
    declineAs: decider && t && OPEN.has(t.state) ? decider : null,
    requestAs: !decider && holder && !vfr && (!t || t.state === 'DECLINED') ? holder : null,
    cancelAs: !decider && holder && t && t.state === 'REQUESTED' ? holder : null,
    acknowledgeAs: holder && t && t.state === 'DECLINED' ? holder : null,
  };
}
