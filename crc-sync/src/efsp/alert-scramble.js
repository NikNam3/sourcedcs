'use strict';

// Guide §9.6 — alert and scramble (docs/adr/0070). Pure: requires nothing,
// reads only what it is handed, writes nothing.
//
// The guide, verbatim on what to build and what not to:
//
//   "Implement: a `SCRAMBLE` Strip MUST raise a Board-wide priority
//    indication, and MUST mark the configured alert-pad access route as
//    constrained, with any conflicting taxi Strip flagged.
//    [GAP] Do not implement a scramble/interceptor priority *ordering* from
//    this guide. FAA JO 7110.65 §2-1-4 and §9-2-7 were not read. Until then,
//    `SCRAMBLE` raises an indication and the controller decides."
//
// So these are FLAGS ONLY. Nothing here orders, inhibits, moves or transfers
// anything: no Strip's orderKey, Rack, Bay, owner or NLA depends on these
// functions, and nla.js never reads alertStatus (a test holds it). "Taxiing
// aircraft yield to alert scrambles" is SOURCE practice shown as text on a
// flag — sequencing stays the controller's call.
//
// A scramble is ACTIVE while its FDR's military.alertStatus is 'SCRAMBLE' and
// it has a live DEPARTURE Strip in a pre-airborne state. Once that Strip is
// DEPARTED (or DROPPED) the indication ends by itself, derived from state;
// nothing resets the field (it keeps 'SCRAMBLE' for L5's traffic-count latch
// and the audit). Only a controller's SetBlock 14E ever writes it.
//
// [SOURCE-DEFINED] — GROUND_STATES is "everything physically on the movement
// area at the scrambler's Facility": a DEPARTURE from PUSHBACK to LUAW, and an
// ARRIVAL rolling out or taxiing in ("must not block runway access from the
// alert pad" makes LUAW and a landing roll-out count). No taxi-route model
// exists, so this is Facility-wide. A route model (taxiway segments per Strip,
// the alert pad's access route as a segment list) would narrow it to the
// Strips whose cleared taxi route crosses or holds on the access route, plus
// anything on the scrambler's departure runway; until one exists, inventing
// taxiway geometry would be fabricated doctrine (D11).
//
// crc-desktop's panels/efsp/scramble.js mirrors the functions below by hand
// (a browser script cannot load this file); a drift test runs both over one
// fixture table and requires identical answers.

const SCRAMBLE_PRE_AIRBORNE = Object.freeze({
  DEPARTURE: Object.freeze(['PROPOSED', 'PENDING_CLEARANCE', 'CLEARED', 'HELD', 'PUSHBACK', 'TAXI', 'RUNWAY_QUEUE', 'LUAW']),
});

const GROUND_STATES = Object.freeze({
  DEPARTURE: Object.freeze(['PUSHBACK', 'TAXI', 'RUNWAY_QUEUE', 'LUAW']),
  ARRIVAL: Object.freeze(['LANDED', 'TAXI_IN']),
});

function _callsignOf(strip, fdr) {
  return (fdr && fdr.identity && fdr.identity.callsign) || strip.stripId;
}

function _isScrambling(strip, fdr) {
  if (!strip || strip.role !== 'DEPARTURE') return false;
  if (!SCRAMBLE_PRE_AIRBORNE.DEPARTURE.includes(strip.state)) return false;
  return !!(fdr && fdr.military && fdr.military.alertStatus === 'SCRAMBLE');
}

/**
 * Every active scramble, optionally at one Facility. `fdrOf(fdrId)` returns
 * the FDR or null (an archived FDR is null, never a throw).
 * @returns {{stripId, fdrId, facilityId, state, callsign}[]} sorted by callsign
 */
function activeScrambles(strips, fdrOf, facilityId) {
  const out = [];
  for (const strip of strips || []) {
    if (facilityId !== undefined && facilityId !== null && strip.facilityId !== facilityId) continue;
    const fdr = strip.fdrId ? fdrOf(strip.fdrId) : null;
    if (!_isScrambling(strip, fdr)) continue;
    out.push({ stripId: strip.stripId, fdrId: strip.fdrId, facilityId: strip.facilityId, state: strip.state, callsign: _callsignOf(strip, fdr) });
  }
  return out.sort((a, b) => (a.callsign < b.callsign ? -1 : a.callsign > b.callsign ? 1 : (a.stripId < b.stripId ? -1 : 1)));
}

/**
 * The ground Strips at `facilityId` that a scramble there flags — empty when
 * nothing is scrambling at that Facility. Never a scrambler itself (no Strip
 * of a scrambling flight is flagged against its own scramble).
 * @returns {{stripId, fdrId, facilityId, role, state, callsign}[]} in input order
 */
function conflictingGroundStrips(strips, fdrOf, facilityId) {
  const scrambles = activeScrambles(strips, fdrOf, facilityId);
  if (scrambles.length === 0) return [];
  const scramblingFdrs = new Set(scrambles.map(s => s.fdrId));
  const out = [];
  for (const strip of strips || []) {
    if (strip.facilityId !== facilityId) continue;
    const states = GROUND_STATES[strip.role];
    if (!states || !states.includes(strip.state)) continue;
    if (scramblingFdrs.has(strip.fdrId)) continue;
    const fdr = strip.fdrId ? fdrOf(strip.fdrId) : null;
    out.push({ stripId: strip.stripId, fdrId: strip.fdrId, facilityId: strip.facilityId, role: strip.role, state: strip.state, callsign: _callsignOf(strip, fdr) });
  }
  return out;
}

/**
 * How the alert-pad access route is named, from a Facility's field-state
 * record (or null when none is known). Never blocks the indication (§9.6's
 * first MUST does not depend on config).
 */
function accessRouteText(fieldState) {
  if (!fieldState) return 'the alert-pad access route';
  const pad = fieldState.alertPad;
  if (pad && typeof pad.accessRoute === 'string' && pad.accessRoute) return pad.accessRoute;
  return 'the alert-pad access route (not configured)';
}

/**
 * The access route marked constrained while any of `scrambles` (one
 * Facility's) is active, or null when none is.
 * @returns {null | { route: string|null, text: string }}
 */
function alertPadConstraint(fieldState, scrambles) {
  if (!scrambles || scrambles.length === 0) return null;
  const pad = fieldState && fieldState.alertPad;
  const route = pad && typeof pad.accessRoute === 'string' && pad.accessRoute ? pad.accessRoute : null;
  const who = scrambles.map(s => s.callsign).join(', ');
  const head = route ? `ACCESS ROUTE ${route}` : `ALERT-PAD ACCESS ROUTE${fieldState ? ' (not configured)' : ''}`;
  return { route, text: `${head} CONSTRAINED — scramble in progress (${who})` };
}

/** facility-config.js's validateConfig: the one key L13 adds under fieldState.pads.alert. */
function validateAlertPadConfig(alertPad) {
  if (alertPad === null || alertPad === undefined) return null;
  if (alertPad.accessRoute !== undefined && typeof alertPad.accessRoute !== 'string') {
    return 'fieldState.pads.alert.accessRoute must be a string';
  }
  return null;
}

module.exports = {
  SCRAMBLE_PRE_AIRBORNE, GROUND_STATES,
  activeScrambles, conflictingGroundStrips, accessRouteText, alertPadConstraint, validateAlertPadConfig,
};
