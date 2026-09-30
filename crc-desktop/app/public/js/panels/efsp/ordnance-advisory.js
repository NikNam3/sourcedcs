// Hung ordnance (guide §9.5, crc-sync's docs/adr/0069) — the Strip's HUNG chip
// and its reason line.
//
// An ADVISORY, never an inhibit: nothing here disables a button or refuses
// anything. [SOURCE-DEFINED]: the guide's basis is one base's local practice,
// not doctrine, and SOURCE's hot cargo pad is a placeholder name with no
// geometry (decisions.md H21) — so the reason line states facts (the runway the
// Strip resolves to, the pad's name) and recommends no runway.
//
// hungOrdnanceAdvisoryFor is a COPY of crc-sync's src/efsp/field-state.js
// function of the same name, runway resolution included: browser scripts cannot
// load crc-sync. tests/efsp-ordnance-client.test.js holds the two together.
// The helpers are prefixed `_ord` because every script here shares one global
// scope, and a second `function resolveRunwayForStrip` would silently replace
// the first.
//
// Computed on every render from the FDR and the field-state record, both of
// which arrive whole on deltas — nothing is stored (the WP6 plan's rule-4
// argument), so a 3G change re-renders the Strip with no new wiring.

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
function _ordResolveRunway(strip, fdr, fieldState) {
  if (strip.role !== 'DEPARTURE' && strip.role !== 'ARRIVAL') return null;
  const runways = fieldState.runways || [];
  const rackEnds = {};
  for (const r of runways) for (const [end, rackId] of Object.entries(r.rackIds || {})) rackEnds[rackId] = end;
  const ofEnd = (end) => runways.find(r => (r.ends || []).includes(end)) || null;

  const rackEnd = strip.rackId ? rackEnds[strip.rackId] : null;
  const rackRunway = rackEnd ? ofEnd(rackEnd) : null;
  if (rackRunway) return { runwayId: rackRunway.runwayId, end: rackEnd, source: 'RACK' };

  let text = null;
  if (fdr && strip.role === 'DEPARTURE') text = fdr.filed ? fdr.filed.departureRunway : null;
  if (fdr && strip.role === 'ARRIVAL') text = fdr.assigned ? fdr.assigned.landingRunway : null;
  if (text !== null && text !== undefined && text !== '') {
    const end = _ordNormalizeEnd(text);
    const byEnd = end ? ofEnd(end) : null;
    if (byEnd) return { runwayId: byEnd.runwayId, end, source: 'FDR' };
    const compact = _ordCompactId(text);
    const whole = runways.find(r => _ordCompactId(r.runwayId) === compact);
    if (whole) return { runwayId: whole.runwayId, end: null, source: 'FDR' };
  }

  if (fieldState.activeRunway) {
    const active = ofEnd(fieldState.activeRunway);
    if (active) return { runwayId: active.runwayId, end: fieldState.activeRunway, source: 'ACTIVE_RUNWAY' };
  }
  return null;
}

/** The advisory for a Strip, or null — crc-sync's field-state.js hungOrdnanceAdvisoryFor, copied. */
function hungOrdnanceAdvisoryFor(strip, fdr, fieldState) {
  if (!strip || !fieldState) return null;
  if (!fdr || !fdr.military || fdr.military.ordnanceState !== 'HUNG') return null;
  if (strip.role !== 'ARRIVAL' && strip.role !== 'DEPARTURE') return null;
  if (strip.state === 'DROPPED') return null;
  const resolved = _ordResolveRunway(strip, fdr, fieldState);
  const pad = fieldState.hotCargoPad;
  const padName = pad && typeof pad.name === 'string' && pad.name.trim() ? pad.name.trim() : null;
  // [SOURCE-DEFINED] wording: one sentence per fact, no runway recommended (decisions.md H21).
  const when = strip.role === 'DEPARTURE' ? 'if it returns' : 'after landing';
  let reason = padName
    ? `Hung ordnance. SOURCE practice: ${when}, taxi to ${padName}; the runway is the controller's call.`
    : `Hung ordnance. No hot cargo pad is configured at ${fieldState.facilityId} (SOURCE practice).`;
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
// (L1b's getEfspFieldState not loaded, or no record yet): that ordnance is hung
// must never depend on another piece arriving first.
const ORDNANCE_NO_FIELD_STATE_REASON = 'Hung ordnance. The hot cargo pad is shown when field state is available.';

/**
 * strip-view.js's _stripAlerts hook: [] or one `ord` alert — an amber HUNG chip
 * and its reason line. On every Position's view of the Strip, whether or not
 * Block 3G is on that Position's grid.
 */
function ordnanceAlertsFor(strip) {
  if (!strip || (strip.role !== 'ARRIVAL' && strip.role !== 'DEPARTURE') || strip.state === 'DROPPED') return [];
  const fdr = typeof getEfspFdr === 'function' ? getEfspFdr(strip.fdrId) : null;
  if (!fdr || !fdr.military || fdr.military.ordnanceState !== 'HUNG') return [];
  const fieldState = typeof getEfspFieldState === 'function' ? getEfspFieldState(strip.facilityId) : null;
  const advisory = fieldState ? hungOrdnanceAdvisoryFor(strip, fdr, fieldState) : null;
  return [{
    key: 'ord', tone: 'attn', legacy: 'efsp-ord-indicator',
    text: 'HUNG',
    reason: advisory ? advisory.reason : ORDNANCE_NO_FIELD_STATE_REASON,
  }];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { hungOrdnanceAdvisoryFor, ordnanceAlertsFor, ORDNANCE_NO_FIELD_STATE_REASON };
}
