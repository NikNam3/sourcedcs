'use strict';

// Client mirror of the carrier's record (crc-sync's docs/adr/0074, ADR 0064, 0113):
// the recovery Case, the carrier state (every value with its source and override),
// the Marshal stack with its DERIVED angels / DME / push time, the ship banner. Plain module-level state like efsp-state.js, an ES
// module whose exports node:test imports directly.
//
// The server sends the whole hull view on every change (`efsp-carrier-delta`)
// and computes everything derived: crc-desktop cannot import crc-sync, so one
// implementation of the arithmetic on the server beats a client copy under a
// parity test. This file therefore holds NO arithmetic (no angels + 15, no
// final bearing, no magnetic conversion): it formats what arrives. The server's
// `display` objects say which reference a bearing is in (M, T or G).

const efspCarriers = new Map(); // hullId -> hull view

export function applyEfspCarrierSnapshot(msg) {
  efspCarriers.clear();
  for (const v of (msg && msg.carriers) || []) if (v && v.hullId) efspCarriers.set(v.hullId, v);
}

export function applyEfspCarrierDelta(msg) {
  for (const v of (msg && msg.carriers && msg.carriers.updated) || []) if (v && v.hullId) efspCarriers.set(v.hullId, v);
}

/** The hull view, or null before the snapshot. v1 has one hull (decisions H29). */
export function getEfspCarrier(hullId) {
  if (hullId) return efspCarriers.get(hullId) || null;
  const first = efspCarriers.values().next();
  return first.done ? null : first.value;
}

export function _resetEfspCarrierStateForTest() { efspCarriers.clear(); }

/** 'I' | 'II' | 'III', or null before the first snapshot. */
export function carrierCaseValue() {
  const c = getEfspCarrier();
  return c && c.recoveryCase ? c.recoveryCase.value : null;
}

/** The derived stack, in stack order. */
export function carrierDerivedStack(stackId = 'MAIN') {
  const c = getEfspCarrier();
  return (c && c.derived && c.derived[stackId]) || [];
}

/** The derived entry for a flight, or null when it is not in the stack. */
export function carrierDerivedFor(flightDataId) {
  return carrierDerivedStack().find(e => e.flightDataId === flightDataId) || null;
}

function _pad(n, w = 2) { return String(n).padStart(w, '0'); }

/** `1432` for a Zulu epoch ms; '' when none. */
export function carrierHhmm(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '';
  const d = new Date(Number(ms));
  return _pad(d.getUTCHours()) + _pad(d.getUTCMinutes());
}

/** `035M`: a bearing as the server says it is to be read, three digits with its reference letter. */
export function carrierBearingText(display) {
  if (!display || display.value == null) return '';
  const v = display.value === 0 ? 360 : display.value;
  return `${_pad(v, 3)}${display.ref || ''}`;
}

/**
 * The value a `carrier-derived` Block shows for this flight (docs/adr/0064 B3),
 * and the placeholder when the model has none (Case I has no DME, no push time
 * and no radial; an unsequenced Case I flight has no altitude yet).
 * @returns {string}
 */
export function carrierDerivedText(field, flightDataId, ship) {
  const c = getEfspCarrier();
  const d = carrierDerivedFor(flightDataId);
  const caseValue = c && c.recoveryCase ? c.recoveryCase.value : null;
  switch (field) {
    case 'case': return caseValue || '';
    case 'angels': return d && d.angels != null ? String(d.angels) : (d && caseValue === 'I' ? 'assign' : '');
    case 'marshalDme': return d && d.marshalDme != null ? String(d.marshalDme) : (d && caseValue === 'I' ? '≤5 NM' : '');
    case 'eatPush': return d && d.pushTimeUtc != null ? carrierHhmm(d.pushTimeUtc) : '';
    case 'marshalRadial': return d && d.marshalRadialDeg != null ? carrierBearingText(d.marshalRadialDisplay) : (d && caseValue === 'I' ? 'overhead' : '');
    case 'expectedFinalBearing': return d ? carrierBearingText(d.expectedFinalBearingDisplay) : carrierBearingText(c && c.state ? c.state.finalBearing.display : null);
    // FINAL's three derived fields (deck, final bearing, distance): the final bearing in force (the ship's heading less the deck, or a controller's override).
    case 'finalBearing': return carrierBearingText(c && c.state ? c.state.finalBearing.display : null);
    case 'deck': return c && c.hullId ? c.hullId : '';
    case 'callsign': case 'aircraftType': return '';
    default: return '';
  }
}

/** The resolved carrier state (every value with its `source` and `override`), or null before the first snapshot. */
export function carrierStateOf(view = getEfspCarrier()) {
  return view && view.state ? view.state : null;
}

/**
 * Where a value comes from, as words: 'DCS', 'default', 'set' (a controller typed it, and the automatic value is beside it),
 * or 'not known'. The automatic value is the server's (`entry.default`); nothing is worked out here.
 */
export function carrierSourceText(entry, format = (v) => String(v)) {
  if (!entry) return '';
  switch (entry.source) {
    case 'override': return entry.default != null ? `set (${format(entry.default)} automatic)` : 'set';
    case 'dcs': return 'DCS';
    case 'default': return 'default';
    default: return 'not known';
  }
}

/**
 * The text of the ship banner (guide §9.12 rule 5: heading, final bearing,
 * speed, time, altimeter, shared by every carrier Position). Says what is wrong
 * rather than showing a stale number as live. BRC, final bearing and altimeter are the values in force
 * (the game's, or a controller's override: `view.state`).
 * @returns {{text:string, problem:string|null, parts:Object<string,string>}}
 */
export function carrierBannerParts(view = getEfspCarrier()) {
  const s = view && view.shipState;
  if (!s) return { text: 'hull not found', problem: 'hull not found', parts: {} };
  const st = carrierStateOf(view);
  const parts = {};
  parts.hull = (view.hullId || '');
  if (!s.found) return { text: s.hullProblem || 'hull not found', problem: s.hullProblem || 'hull not found', parts };
  parts.brc = st && st.brc.value != null ? carrierBearingText(st.brc.display) : '';
  parts.finalBearing = st && st.finalBearing.value != null ? carrierBearingText(st.finalBearing.display) : '';
  parts.speed = s.speedKt != null ? `${s.speedKt} KT` : '';
  const alt = st ? st.weather.altimeter : null;
  parts.altimeter = alt && alt.value != null ? `${alt.value.toFixed(2)}${alt.source === 'override' ? '' : ' (wx)'}` : '';
  parts.time = carrierHhmm(s.atUtc) ? `${carrierHhmm(s.atUtc)}Z` : '';
  let problem = null;
  if (s.stale) problem = 'ship track lost — last known values';
  else if (s.finalBearingUnavailable) problem = s.finalBearingUnavailable;
  const text = [`BRC ${parts.brc || '—'}`, `FINAL ${parts.finalBearing || '—'}`, parts.speed, `ALT ${parts.altimeter || '—'}`, parts.time].filter(Boolean).join('  ');
  return { text, problem, parts };
}
