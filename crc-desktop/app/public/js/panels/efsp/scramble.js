'use strict';

// Guide §9.6 — alert and scramble, on the client (crc-sync's docs/adr/0070).
//
//   "a `SCRAMBLE` Strip MUST raise a Board-wide priority indication, and MUST
//    mark the configured alert-pad access route as constrained, with any
//    conflicting taxi Strip flagged.
//    [GAP] Do not implement a scramble/interceptor priority *ordering* from
//    this guide. FAA JO 7110.65 §2-1-4 and §9-2-7 were not read. Until then,
//    `SCRAMBLE` raises an indication and the controller decides."
//
// Three things, all derived from state the client already has — nothing here
// writes, orders, inhibits, moves or transfers a Strip:
//   1. the Board-wide line at the top of the Strip panel (every Position tab,
//      every controller — decisions.md Q5 default), renderEfspScrambleLine();
//   2. a chip and a reason line on the scrambling Strip and on every ground
//      Strip at its Facility, scrambleAlertsFor() — strip-view.js's wave-2 hook;
//   3. the access route marked constrained, alertPadConstraintFor() — read by
//      L1b's field-state panel when both are loaded.
// The local rules are shown as "SOURCE practice", never as FAA/USAF doctrine.
//
// The pure half below is a hand copy of crc-sync/src/efsp/alert-scramble.js (a
// browser script cannot load it); efsp-scramble-client.test.js runs both over
// one fixture table and requires identical answers. Change them together.

// ── the pure half (mirrors crc-sync's alert-scramble.js) ──────────────────

const SCRAMBLE_PRE_AIRBORNE = Object.freeze({
  DEPARTURE: Object.freeze(['PROPOSED', 'PENDING_CLEARANCE', 'CLEARED', 'HELD', 'PUSHBACK', 'TAXI', 'RUNWAY_QUEUE', 'LUAW']),
});

const GROUND_STATES = Object.freeze({
  DEPARTURE: Object.freeze(['PUSHBACK', 'TAXI', 'RUNWAY_QUEUE', 'LUAW']),
  ARRIVAL: Object.freeze(['LANDED', 'TAXI_IN']),
});

function _scrambleCallsignOf(strip, fdr) {
  return (fdr && fdr.identity && fdr.identity.callsign) || strip.stripId;
}

function _isScrambling(strip, fdr) {
  if (!strip || strip.role !== 'DEPARTURE') return false;
  if (!SCRAMBLE_PRE_AIRBORNE.DEPARTURE.includes(strip.state)) return false;
  return !!(fdr && fdr.military && fdr.military.alertStatus === 'SCRAMBLE');
}

function activeScrambles(strips, fdrOf, facilityId) {
  const out = [];
  for (const strip of strips || []) {
    if (facilityId !== undefined && facilityId !== null && strip.facilityId !== facilityId) continue;
    const fdr = strip.fdrId ? fdrOf(strip.fdrId) : null;
    if (!_isScrambling(strip, fdr)) continue;
    out.push({ stripId: strip.stripId, fdrId: strip.fdrId, facilityId: strip.facilityId, state: strip.state, callsign: _scrambleCallsignOf(strip, fdr) });
  }
  return out.sort((a, b) => (a.callsign < b.callsign ? -1 : a.callsign > b.callsign ? 1 : (a.stripId < b.stripId ? -1 : 1)));
}

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
    out.push({ stripId: strip.stripId, fdrId: strip.fdrId, facilityId: strip.facilityId, role: strip.role, state: strip.state, callsign: _scrambleCallsignOf(strip, fdr) });
  }
  return out;
}

function accessRouteText(fieldState) {
  if (!fieldState) return 'the alert-pad access route';
  const pad = fieldState.alertPad;
  if (pad && typeof pad.accessRoute === 'string' && pad.accessRoute) return pad.accessRoute;
  return 'the alert-pad access route (not configured)';
}

function alertPadConstraint(fieldState, scrambles) {
  if (!scrambles || scrambles.length === 0) return null;
  const pad = fieldState && fieldState.alertPad;
  const route = pad && typeof pad.accessRoute === 'string' && pad.accessRoute ? pad.accessRoute : null;
  const who = scrambles.map(s => s.callsign).join(', ');
  const head = route ? `ACCESS ROUTE ${route}` : `ALERT-PAD ACCESS ROUTE${fieldState ? ' (not configured)' : ''}`;
  return { route, text: `${head} CONSTRAINED — scramble in progress (${who})` };
}

// ── the client half ────────────────────────────────────────────────────────

function _scrambleLiveStrips() {
  return (typeof getAllEfspStrips === 'function' ? getAllEfspStrips() : []).filter(s => s.state !== 'DROPPED');
}
function _scrambleFdrOf(fdrId) {
  return typeof getEfspFdr === 'function' ? getEfspFdr(fdrId) : null;
}
/** L1b's client field state when it is loaded (decisions.md T6: never block on it). */
function _scrambleFieldStateFor(facilityId) {
  return typeof getEfspFieldState === 'function' ? getEfspFieldState(facilityId) : null;
}

function _joinCallsigns(list) {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * strip-view.js's wave-2 hook: this Strip's scramble chip, as
 * [{ key, tone, legacy, text, reason }], or [] when it has nothing to do with
 * a scramble. ALERT alone shows nothing beyond its 14E field (ADR 0058).
 */
function scrambleAlertsFor(strip) {
  if (!strip || !strip.facilityId) return [];
  const strips = _scrambleLiveStrips();
  const scrambles = activeScrambles(strips, _scrambleFdrOf, strip.facilityId);
  if (scrambles.length === 0) return [];
  if (scrambles.some(s => s.stripId === strip.stripId)) {
    return [{
      key: 'scram', tone: 'bad', legacy: 'efsp-scramble-indicator', text: 'SCRAMBLE',
      reason: 'Alert scramble. SOURCE practice: taxiing traffic yields and the alert-pad access route stays clear; sequencing is the controller\'s call.',
    }];
  }
  if (!conflictingGroundStrips(strips, _scrambleFdrOf, strip.facilityId).some(s => s.stripId === strip.stripId)) return [];
  const who = _joinCallsigns(scrambles.map(s => s.callsign));
  const plural = scrambles.length > 1;
  const route = accessRouteText(_scrambleFieldStateFor(strip.facilityId));
  return [{
    key: 'scram', tone: 'attn', legacy: 'efsp-scramble-conflict-indicator', text: 'SCRAMBLE',
    reason: `${who} ${plural ? 'are' : 'is'} scrambling from ${strip.facilityId}. SOURCE practice: keep clear of ${route}. `
      + `Clears when ${plural ? 'they are' : `${who} is`} airborne or the scramble is cancelled.`,
  }];
}

/** L1b's field-state panel hook: the constrained-route line for a Facility, or null. */
function alertPadConstraintFor(facilityId) {
  const scrambles = activeScrambles(_scrambleLiveStrips(), _scrambleFdrOf, facilityId);
  const c = alertPadConstraint(_scrambleFieldStateFor(facilityId), scrambles);
  return c ? c.text : null;
}

const _seenScrambleStripIds = new Set();

/**
 * Switches to the Position and Bay holding the Strip when this client holds
 * that Position (the arrivals line's click, efsp-panel.js), then selects it.
 * efsp-panel.js's tab state is a top-level binding of a classic script, so it
 * is reachable here in the browser; guarded so a test sandbox without it
 * simply selects.
 */
function _revealScrambleStrip(stripId) {
  const strip = typeof getEfspStrip === 'function' ? getEfspStrip(stripId) : null;
  const held = typeof getActingPositions === 'function' ? getActingPositions() : [];
  if (strip && held.includes(strip.ownerPositionId)
      && typeof _renderPositionTabs === 'function' && typeof _activePositionTab !== 'undefined') {
    _activePositionTab = strip.ownerPositionId; // eslint-disable-line no-global-assign
    _activeBayId = strip.bayId; // eslint-disable-line no-global-assign
    _renderPositionTabs();
  }
  if (typeof selectEfspStripById === 'function') selectEfspStripById(stripId);
}

/**
 * The Board-wide priority indication (§9.6's first MUST): one row per active
 * scramble at any Facility, at the top of the Strip panel, on every Position
 * tab. Hidden when nothing is scrambling. A row never collapses (H6).
 */
function renderEfspScrambleLine() {
  const line = typeof document !== 'undefined' ? document.getElementById('efsp-scramble-line') : null;
  if (!line) return;
  const strips = _scrambleLiveStrips();
  const scrambles = activeScrambles(strips, _scrambleFdrOf);
  line.innerHTML = '';
  line.hidden = scrambles.length === 0;
  const live = new Set(scrambles.map(s => s.stripId));
  for (const id of [..._seenScrambleStripIds]) if (!live.has(id)) _seenScrambleStripIds.delete(id);
  const flaggedByFacility = new Map();
  for (const s of scrambles) {
    if (!flaggedByFacility.has(s.facilityId)) {
      flaggedByFacility.set(s.facilityId, conflictingGroundStrips(strips, _scrambleFdrOf, s.facilityId).length);
    }
    const row = document.createElement('div');
    row.className = 'efsp-scramble-row' + (_seenScrambleStripIds.has(s.stripId) ? '' : ' efsp-scramble-row-new');
    row.dataset.stripId = s.stripId;
    _seenScrambleStripIds.add(s.stripId);

    const tag = document.createElement('span');
    tag.className = 'efsp-scramble-tag';
    tag.textContent = 'SCRAMBLE';
    row.appendChild(tag);

    const cs = document.createElement('button');
    cs.className = 'efsp-scramble-cs';
    cs.textContent = s.callsign;
    cs.title = `select ${s.callsign}`;
    cs.addEventListener('click', () => _revealScrambleStrip(s.stripId));
    row.appendChild(cs);

    const flagged = flaggedByFacility.get(s.facilityId);
    const route = accessRouteText(_scrambleFieldStateFor(s.facilityId));
    const detail = document.createElement('span');
    detail.className = 'efsp-scramble-detail';
    detail.textContent = [s.facilityId, s.state, `${route} constrained`, `${flagged} flagged`].join(' · ');
    row.appendChild(detail);
    line.appendChild(row);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCRAMBLE_PRE_AIRBORNE, GROUND_STATES,
    activeScrambles, conflictingGroundStrips, accessRouteText, alertPadConstraint,
    scrambleAlertsFor, alertPadConstraintFor, renderEfspScrambleLine,
  };
}
