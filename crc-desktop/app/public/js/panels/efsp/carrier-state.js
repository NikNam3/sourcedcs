'use strict';

// Client mirror of the carrier's record (crc-sync's docs/adr/0074, ADR 0064):
// the recovery Case, the Marshal stack with its DERIVED angels / DME / push
// time, the ship banner. Plain module-level state like efsp-state.js, a guarded
// module.exports at the end so node:test can require it.
//
// The server sends the whole hull view on every change (`efsp-carrier-delta`)
// and computes everything derived: crc-desktop cannot import crc-sync, so one
// implementation of the arithmetic on the server beats a client copy under a
// parity test. This file therefore holds NO arithmetic (no angels + 15, no
// final bearing, no magnetic conversion): it formats what arrives. The server's
// `display` objects say which reference a bearing is in (M, T or G).

const efspCarriers = new Map(); // hullId -> hull view

function applyEfspCarrierSnapshot(msg) {
  efspCarriers.clear();
  for (const v of (msg && msg.carriers) || []) if (v && v.hullId) efspCarriers.set(v.hullId, v);
}

function applyEfspCarrierDelta(msg) {
  for (const v of (msg && msg.carriers && msg.carriers.updated) || []) if (v && v.hullId) efspCarriers.set(v.hullId, v);
}

/** The hull view, or null before the snapshot. v1 has one hull (decisions H29). */
function getEfspCarrier(hullId) {
  if (hullId) return efspCarriers.get(hullId) || null;
  const first = efspCarriers.values().next();
  return first.done ? null : first.value;
}

function _resetEfspCarrierStateForTest() { efspCarriers.clear(); }

/** 'I' | 'II' | 'III', or null before the first snapshot. */
function carrierCaseValue() {
  const c = getEfspCarrier();
  return c && c.recoveryCase ? c.recoveryCase.value : null;
}

/** The derived stack, in stack order. */
function carrierDerivedStack(stackId = 'MAIN') {
  const c = getEfspCarrier();
  return (c && c.derived && c.derived[stackId]) || [];
}

/** The derived entry for a flight, or null when it is not in the stack. */
function carrierDerivedFor(fdrId) {
  return carrierDerivedStack().find(e => e.fdrId === fdrId) || null;
}

/** Is the (possibly derived) value one a controller may NOT type? Every Block of kind `carrier-derived`. */
function isCarrierDerivedBlock(def) { return !!def && def.target && def.target.kind === 'carrier-derived'; }

function _pad(n, w = 2) { return String(n).padStart(w, '0'); }

/** `1432` for a Zulu epoch ms; '' when none. */
function carrierHhmm(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '';
  const d = new Date(Number(ms));
  return _pad(d.getUTCHours()) + _pad(d.getUTCMinutes());
}

/** `035M`: a bearing as the server says it is to be read, three digits with its reference letter. */
function carrierBearingText(display) {
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
function carrierDerivedText(field, fdrId, ship) {
  const c = getEfspCarrier();
  const d = carrierDerivedFor(fdrId);
  const caseValue = c && c.recoveryCase ? c.recoveryCase.value : null;
  switch (field) {
    case 'case': return caseValue || '';
    case 'angels': return d && d.angels != null ? String(d.angels) : (d && caseValue === 'I' ? 'assign' : '');
    case 'marshalDme': return d && d.marshalDme != null ? String(d.marshalDme) : (d && caseValue === 'I' ? '≤5 NM' : '');
    case 'eatPush': return d && d.pushTimeUtc != null ? carrierHhmm(d.pushTimeUtc) : '';
    case 'marshalRadial': return d && d.marshalRadialDeg != null ? carrierBearingText(d.marshalRadialDisplay) : (d && caseValue === 'I' ? 'overhead' : '');
    case 'expectedFinalBearing': return d ? carrierBearingText(d.expectedFinalBearingDisplay) : (ship && ship.finalBearingDisplay ? carrierBearingText(ship.finalBearingDisplay) : '');
    // FINAL's three derived fields (deck, final bearing, distance): the ship's own banner, never typed.
    case 'finalBearing': return ship && ship.finalBearingDisplay ? carrierBearingText(ship.finalBearingDisplay) : '';
    case 'deck': return c && c.hullId ? c.hullId : '';
    case 'callsign': case 'aircraftType': return '';
    default: return '';
  }
}

/**
 * The text of the ship banner (guide §9.12 rule 5: heading, final bearing,
 * speed, time, altimeter, shared by every carrier Position). Says what is wrong
 * rather than showing a stale number as live.
 * @returns {{text:string, problem:string|null, parts:Object<string,string>}}
 */
function carrierBannerParts(view = getEfspCarrier()) {
  const s = view && view.shipState;
  if (!s) return { text: 'hull not found', problem: 'hull not found', parts: {} };
  const parts = {};
  parts.hull = (view.hullId || '');
  if (!s.found) return { text: `${parts.hull} — ${s.hullProblem || 'hull not found'}`, problem: s.hullProblem || 'hull not found', parts };
  parts.brc = s.brcDisplay && s.brcDisplay.value != null ? carrierBearingText(s.brcDisplay) : '';
  parts.finalBearing = s.finalBearingDisplay && s.finalBearingDisplay.value != null ? carrierBearingText(s.finalBearingDisplay) : '';
  parts.speed = s.speedKt != null ? `${s.speedKt} KT` : '';
  parts.altimeter = s.altimeterInHg != null ? `${s.altimeterInHg.toFixed(2)}${s.altimeterSource === 'SET' ? '' : ' (wx)'}` : '';
  parts.time = carrierHhmm(s.atUtc) ? `${carrierHhmm(s.atUtc)}Z` : '';
  let problem = null;
  if (s.stale) problem = 'ship track lost — last known values';
  else if (s.finalBearingUnavailable) problem = s.finalBearingUnavailable;
  const text = [`BRC ${parts.brc || '—'}`, `FINAL ${parts.finalBearing || '—'}`, parts.speed, `ALT ${parts.altimeter || '—'}`, parts.time].filter(Boolean).join('  ');
  return { text, problem, parts };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    applyEfspCarrierSnapshot, applyEfspCarrierDelta, getEfspCarrier, carrierCaseValue,
    carrierDerivedStack, carrierDerivedFor, isCarrierDerivedBlock, carrierDerivedText,
    carrierHhmm, carrierBearingText, carrierBannerParts, _resetEfspCarrierStateForTest,
  };
}
