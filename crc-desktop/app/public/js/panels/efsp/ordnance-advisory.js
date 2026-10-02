// Hung ordnance (guide §9.5, crc-sync's docs/adr/0069) — the Strip's HUNG chip
// and its reason line.
//
// An ADVISORY, never an inhibit: nothing here disables a button or refuses
// anything. [SOURCE-DEFINED]: the guide's basis is one base's local practice,
// not doctrine, and SOURCE's hot cargo pad is a placeholder name with no
// geometry (decisions.md H21) — so the reason line states facts (the runway the
// Strip resolves to, the pad's name) and recommends no runway.
//
// hungOrdnanceAdvisoryFor is a COPY of crc-sync's src/efsp/runway-status.js
// function of the same name, runway resolution included: browser scripts cannot
// load crc-sync. tests/efsp-ordnance-client.test.js holds the two together.
// The helpers are prefixed `_ord` because every script here shares one global
// scope, and a second `function resolveRunwayForStrip` would silently replace
// the first.
//
// Computed on every render from the FDR and the runway-status record, both of
// which arrive whole on deltas — nothing is stored (the WP6 plan's rule-4
// argument), so a 3G change re-renders the Strip with no new wiring.

import { getEfspFlightData, getEfspRunwayStatus } from './efsp-state.js';

function _ordNormalizeEnd(text) {
  if (typeof text !== 'string' && typeof text !== 'number') return null;
  const s = String(text).trim().toUpperCase().replace(/^RWY|^RW/, '').replace(/\s+/g, '');
  const m = /^(\d{1,2})([LRC])?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1 || n > 36) return null;
  return String(n).padStart(2, '0') + (m[2] || '');
}

function _ordCompactId(text) {
  return String(text).trim().toUpperCase().replace(/^RWY|^RW/, '').replace(/\s+/g, '');
}

/** crc-sync's resolveRunwayForStrip over the wire record: rack, then 8A/8B, then the active end. */
function _ordResolveRunway(strip, flightData, runwayStatus) {
  if (strip.stripType !== 'DEPARTURE' && strip.stripType !== 'ARRIVAL') return null;
  const runways = runwayStatus.runways || [];
  const rackEnds = {};
  for (const r of runways) for (const [end, rackId] of Object.entries(r.rackIds || {})) rackEnds[rackId] = end;
  const ofEnd = (end) => runways.find(r => (r.ends || []).includes(end)) || null;

  const rackEnd = strip.rackId ? rackEnds[strip.rackId] : null;
  const rackRunway = rackEnd ? ofEnd(rackEnd) : null;
  if (rackRunway) return { runwayId: rackRunway.runwayId, end: rackEnd, source: 'RACK' };

  let text = null;
  if (flightData && strip.stripType === 'DEPARTURE') text = flightData.filed ? flightData.filed.departureRunway : null;
  if (flightData && strip.stripType === 'ARRIVAL') text = flightData.assigned ? flightData.assigned.landingRunway : null;
  if (text !== null && text !== undefined && text !== '') {
    const end = _ordNormalizeEnd(text);
    const byEnd = end ? ofEnd(end) : null;
    if (byEnd) return { runwayId: byEnd.runwayId, end, source: 'FLIGHT_DATA' };
    const compact = _ordCompactId(text);
    const whole = runways.find(r => _ordCompactId(r.runwayId) === compact);
    if (whole) return { runwayId: whole.runwayId, end: null, source: 'FLIGHT_DATA' };
  }

  if (runwayStatus.activeRunway) {
    const active = ofEnd(runwayStatus.activeRunway);
    if (active) return { runwayId: active.runwayId, end: runwayStatus.activeRunway, source: 'ACTIVE_RUNWAY' };
  }
  return null;
}

/** The advisory for a Strip, or null — crc-sync's runway-status.js hungOrdnanceAdvisoryFor, copied. */
export function hungOrdnanceAdvisoryFor(strip, flightData, runwayStatus) {
  if (!strip || !runwayStatus) return null;
  if (!flightData || !flightData.military || flightData.military.ordnanceState !== 'HUNG') return null;
  if (strip.stripType !== 'ARRIVAL' && strip.stripType !== 'DEPARTURE') return null;
  if (strip.state === 'DROPPED') return null;
  const resolved = _ordResolveRunway(strip, flightData, runwayStatus);
  const pad = runwayStatus.hotCargoPad;
  const padName = pad && typeof pad.name === 'string' && pad.name.trim() ? pad.name.trim() : null;
  // [SOURCE-DEFINED] wording: one sentence per fact, no runway recommended (decisions.md H21).
  const when = strip.stripType === 'DEPARTURE' ? 'if it returns' : 'after landing';
  let reason = padName
    ? `Hung ordnance. SOURCE practice: ${when}, taxi to ${padName}; the runway is the controller's call.`
    : `Hung ordnance. No hot cargo pad is configured at ${runwayStatus.facilityId} (SOURCE practice).`;
  if (resolved) reason += ` Runway ${resolved.runwayId}${resolved.end ? ` (${resolved.end})` : ''} assigned.`;
  return {
    kind: 'HUNG_ORDNANCE',
    runway: resolved ? resolved.runwayId : null,
    end: resolved ? resolved.end : null,
    runwaySource: resolved ? resolved.source : null,
    padName,
    text: 'HUNG',
    reason,
  };
}

// [SOURCE-DEFINED] shown while the client has no field state for the Facility
// (L1b's getEfspRunwayStatus not loaded, or no record yet): that ordnance is hung
// must never depend on another piece arriving first.
export const ORDNANCE_NO_RUNWAY_STATUS_REASON = 'Hung ordnance. The hot cargo pad is shown when runway status is available.';

/**
 * strip-view.js's _stripAlerts hook: [] or one `ord` alert — an amber HUNG chip
 * and its reason line. On every Position's view of the Strip, whether or not
 * Block 3G is on that Position's grid.
 */
export function ordnanceAlertsFor(strip) {
  if (!strip || (strip.stripType !== 'ARRIVAL' && strip.stripType !== 'DEPARTURE') || strip.state === 'DROPPED') return [];
  const flightData = typeof getEfspFlightData === 'function' ? getEfspFlightData(strip.flightDataId) : null;
  if (!flightData || !flightData.military || flightData.military.ordnanceState !== 'HUNG') return [];
  const runwayStatus = typeof getEfspRunwayStatus === 'function' ? getEfspRunwayStatus(strip.facilityId) : null;
  const advisory = runwayStatus ? hungOrdnanceAdvisoryFor(strip, flightData, runwayStatus) : null;
  return [{
    key: 'ord', tone: 'attn', legacy: 'efsp-ord-indicator',
    text: 'HUNG',
    reason: advisory ? advisory.reason : ORDNANCE_NO_RUNWAY_STATUS_REASON,
  }];
}
