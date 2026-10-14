'use strict';

// The PAR panel's model (decisions H115, H116, H141; mockup docs/mockups/par-panel.html, revision 5; ADR 0123; the sample is crc-sync
// docs/adr/0112, docs/wip/PAR-1.md "The sample"). Pure: it imports nothing and touches no DOM, so par-panel.js draws what this
// works out and the unit tests read it with no browser.
//
// What the panel shows is a picture, never an instruction (H115): no required or suggested calls, no cadence. Colour is the
// dark-cockpit rule: grey unless a problem; red outside a tolerance above DA; amber only for no plot for 3 s; orange-red for a
// scope that is INOP. Below DA the pilot decides, so nothing is coloured there (H116).
//
// ADR 0123 (H141 U-RQ4 b, U-RQ5 a): the azimuth scope is in degrees only (a B-display: range against the angle off the course
// seen from touchdown, the sample's `azDeg`), no feet on it or in its readout. The elevation limits are split: the upper is the
// controller's setting (+1°), the lower defaults to 0.5° below the glidepath, the FAA lower safe limit (Order 8200.1D, the
// "B" cursor), because obstacle clearance is verified only down to it.

export const FT_PER_NM = 6076.12;
export const PHI = 0.618;                  // the golden-ratio point the autoscale keeps the track at (H115)
export const AUTOSCALE_FLOOR_NM = 10;      // autoscale shrinks the window down to 10 NM and stops there
export const NO_PLOT_MS = 3000;            // amber at 3 s without a plot (H115)
export const PAR_DEFAULTS = Object.freeze({ gpaDeg: 3.06, tolElHighDeg: 1, tolElLowDeg: 0.5, tolAzDeg: 1, autoscale: true }); // H116, H141
export const DEFAULT_VIEW = Object.freeze({ rMax: 10, hMax: 3500, azMaxDeg: 2 });
export const ZOOM_STEP = 1.15;
// azMaxDeg: the PAR covers ±10° of the course (Order 8200.1D ch 14 ¶19, lateral coverage), so the azimuth window never opens wider
export const LIMITS = Object.freeze({ rMin: 0.5, rMax: 40, hMin: 150, azMinDeg: 0.25, azMaxDeg: 10 });

// The final controller's actions (crc-sync docs/adr/0117, H134 LT-RQ7 a, LT-RQ8 a), on the FINAL Bay line and the PAR panel:
// "Begin descent" (JO 7110.65BB para 5-12-3; it ends the assigned altitude) and "Cleared to land" (the tower's clearance
// relayed, para 5-10-13) are recorded once each; "Landed" sends the Strip to GC (para 5-12-9); "Missed approach" sends it back
// to AP for another approach (decisions H137 LT-PQ1 a, ours: the orders are silent on who works the climb-out), which frees
// the final and the rotating frequency. "Landing assured" (ADR 0075) is gone: no FAA order uses the phrase. The carrier's Ball / Waveoff are the
// carrier FINAL Bay line's (bay-views.js; the PAR is an airfield feature, decisions H125, crc-sync docs/adr/0116).
export const PAR_TERMINALS = Object.freeze([
  Object.freeze({ id: 'BEGIN_DESCENT', label: 'Begin descent', call: 'BEGIN_DESCENT', once: true }),
  Object.freeze({ id: 'CLEARED_TO_LAND', label: 'Cleared to land', call: 'CLEARED_TO_LAND', once: true }),
  Object.freeze({ id: 'LANDED', label: 'Landed', call: 'LANDED' }),
  Object.freeze({ id: 'MISSED', label: 'Missed approach', call: 'MISSED_APPROACH' }),
]);

const _PM_RAD = Math.PI / 180;
const _pmFin = (v) => typeof v === 'number' && Number.isFinite(v);
const _PM_MINUS = '−';

/** The final controller's actions, as plain data. */
export function parTerminals() {
  return PAR_TERMINALS.map(a => ({ ...a }));
}

/** The op an action sends: a final call (FinalCall), or FINAL's own state when an action names one. */
export function parTerminalOp(terminal) {
  if (!terminal) return null;
  return terminal.call ? { kind: 'FinalCall', call: terminal.call } : { kind: 'SetState', toState: terminal.toState };
}

/** True when a once-only call is already recorded on the Strip (its button is then shown greyed, as the record). */
export function parTerminalRecorded(strip, terminal) {
  return !!(terminal && terminal.once && strip && strip.finalCalls && strip.finalCalls[terminal.call]);
}

/** The glidepath angle in use: the approach's published angle wins; otherwise the controller's default (H116). */
export function effectiveGpa(approach, ownGpaDeg) {
  if (approach && approach.gpaPublished && _pmFin(approach.gpaDeg)) return approach.gpaDeg;
  if (_pmFin(ownGpaDeg)) return ownGpaDeg;
  return approach && _pmFin(approach.gpaDeg) ? approach.gpaDeg : PAR_DEFAULTS.gpaDeg;
}

/** Glidepath height (ft above TDZE) at a range, offset by `offDeg` (a tolerance line). */
export function gpHeightFt(rangeNm, gpaDeg, tchFt, offDeg = 0) {
  return (_pmFin(tchFt) ? tchFt : 0) + rangeNm * FT_PER_NM * Math.tan((gpaDeg + offDeg) * _PM_RAD);
}

/** Range (NM) at which the glidepath reaches DA; inside it no tolerance applies (H116). 0 when the approach has no DH. */
export function rangeAtDaNm(approach, gpaDeg) {
  if (!approach || !_pmFin(approach.dhFt) || !_pmFin(gpaDeg) || gpaDeg <= 0) return 0;
  const tch = _pmFin(approach.tchFt) ? approach.tchFt : 0;
  return Math.max(0, (approach.dhFt - tch) / (FT_PER_NM * Math.tan(gpaDeg * _PM_RAD)));
}

/**
 * A plot measured against `gpaDeg` instead of the server's angle (docs/wip/PAR-1.md: when `gpaPublished` is false and the
 * controller's default differs). Angles stay null at range <= 0, as the server sends them.
 */
export function replot(plot, approach, gpaDeg) {
  if (!plot) return null;
  if (!approach || !_pmFin(gpaDeg) || (_pmFin(approach.gpaDeg) && Math.abs(approach.gpaDeg - gpaDeg) < 1e-9)) return { ...plot };
  const out = { ...plot };
  if (_pmFin(plot.elevDeg)) out.elevDevDeg = plot.elevDeg - gpaDeg;
  if (_pmFin(plot.heightFt) && _pmFin(plot.rangeNm)) out.elevDevFt = plot.heightFt - gpHeightFt(plot.rangeNm, gpaDeg, approach.tchFt);
  return out;
}

/**
 * Outside tolerance, per axis, above DA only: 'danger' or ''. Elevation against the glidepath in degrees, more than
 * `tolElHighDeg` above or `tolElLowDeg` below it (ADR 0123: the lower safe limit, 0.5°); azimuth as the angle off the course seen
 * from touchdown (the sample's `azDeg`), ± `tolAzDeg`. On a line is inside. An INOP axis or a missing figure is never red.
 */
export function severity(plot, {
  rDaNm = 0, tolElHighDeg = PAR_DEFAULTS.tolElHighDeg, tolElLowDeg = PAR_DEFAULTS.tolElLowDeg, tolAzDeg = PAR_DEFAULTS.tolAzDeg,
} = {}) {
  const out = { el: '', az: '' };
  if (!plot || !_pmFin(plot.rangeNm) || plot.rangeNm <= rDaNm) return out;
  if (_pmFin(plot.elevDevDeg) && (plot.elevDevDeg > tolElHighDeg + 1e-9 || plot.elevDevDeg < -tolElLowDeg - 1e-9)) out.el = 'danger';
  if (_pmFin(plot.azDeg) && Math.abs(plot.azDeg) > tolAzDeg + 1e-9) out.az = 'danger';
  return out;
}

/** How old the plot is now: its age when the frame left plus the time since it arrived. null with no plot. */
export function plotAgeNow(sample, receivedAtMs, nowMs) {
  if (!sample || !sample.plot) return null;
  const base = _pmFin(sample.plotAgeMs) ? sample.plotAgeMs : 0;
  const since = _pmFin(receivedAtMs) && _pmFin(nowMs) ? Math.max(0, nowMs - receivedAtMs) : 0;
  return base + since;
}

/**
 * NO PLOT, amber (H115): the plot is 3 s old or more, or there has been none for 3 s since the flight's sample first came.
 * Never while both scopes are INOP: the failure says why there is nothing.
 * @returns {{ amber: boolean, seconds: number|null }}
 */
export function noPlotState(sample, { receivedAtMs, nowMs, firstSeenMs } = {}) {
  const none = { amber: false, seconds: null };
  if (!sample) return none;
  const sensor = sample.sensor || {};
  if (sensor.elevation === 'INOP' && sensor.azimuth === 'INOP') return none;
  if (sample.plot) {
    const age = plotAgeNow(sample, receivedAtMs, nowMs);
    return age >= NO_PLOT_MS ? { amber: true, seconds: Math.floor(age / 1000) } : none;
  }
  if (_pmFin(firstSeenMs) && _pmFin(nowMs) && nowMs - firstSeenMs >= NO_PLOT_MS) return { amber: true, seconds: null };
  return none;
}

/**
 * Which flight the scopes show when several are on finals sent to this controller. The controller's pick holds while that
 * flight is still sent; otherwise the one nearest touchdown (a flight with no plot counts as farthest), ties by Strip id.
 */
export function pickFlight(samples, selectedStripId) {
  const list = (samples || []).filter(s => s && s.stripId);
  if (!list.length) return null;
  if (selectedStripId && list.some(s => s.stripId === selectedStripId)) return selectedStripId;
  const r = (s) => (s.plot && _pmFin(s.plot.rangeNm) ? s.plot.rangeNm : Infinity);
  return [...list].sort((a, b) => r(a) - r(b) || (a.stripId < b.stripId ? -1 : 1))[0].stripId;
}

/**
 * The window that keeps the track at the golden-ratio point, never smaller than 10 NM (H115). Azimuth in degrees: twice the
 * tolerance, or wider to keep the track at the golden-ratio point of the half-window, never past the ±10° the PAR covers.
 */
export function autoscaleView(plot, { gpaDeg, tchFt, tolAzDeg = PAR_DEFAULTS.tolAzDeg } = {}) {
  const gpa = _pmFin(gpaDeg) ? gpaDeg : PAR_DEFAULTS.gpaDeg;
  const r = plot && _pmFin(plot.rangeNm) ? Math.max(0, plot.rangeNm) : 0;
  const rMax = Math.max(AUTOSCALE_FLOOR_NM, r / PHI);
  const hTrack = plot && _pmFin(plot.heightFt) ? plot.heightFt : gpHeightFt(r, gpa, tchFt);
  const hMax = Math.max(gpHeightFt(rMax, gpa, tchFt) * 1.08, hTrack / PHI);
  const azTrack = plot && _pmFin(plot.azDeg) ? Math.abs(plot.azDeg) : 0;
  const tolAz = _pmFin(tolAzDeg) && tolAzDeg > 0 ? tolAzDeg : PAR_DEFAULTS.tolAzDeg;
  const azMaxDeg = Math.min(LIMITS.azMaxDeg, Math.max(2 * tolAz, azTrack / PHI));
  return { rMax, hMax, azMaxDeg };
}

/**
 * One wheel step, anchored at touchdown (no pan). `scope` is 'el' | 'az'; `vertical` (Shift) zooms this scope's height or
 * lateral offset, otherwise the range of both. deltaY > 0 zooms out.
 */
export function zoomView(view, scope, vertical, deltaY) {
  const z = deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
  const v = { ...view };
  if (vertical) {
    if (scope === 'el') v.hMax = Math.max(LIMITS.hMin, v.hMax * z);
    else v.azMaxDeg = Math.min(LIMITS.azMaxDeg, Math.max(LIMITS.azMinDeg, v.azMaxDeg * z));
  } else {
    v.rMax = Math.min(LIMITS.rMax, Math.max(LIMITS.rMin, v.rMax * z));
  }
  return v;
}

/** An azimuth axis label: the course is `0°`, otherwise the angle and the side (`0.5°L`, `1°R`). */
export function azAxisLabel(deg) {
  if (!_pmFin(deg) || Math.abs(deg) < 1e-9) return '0°';
  return `${+Math.abs(deg).toFixed(2)}°${deg < 0 ? 'L' : 'R'}`;
}

/** Where a value is drawn on a scope: clamped to the window's edge (a plot past it stays at the edge, never vanishes). */
export function clampTo(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** A tick spacing that gives about `target` ticks across `span`. */
export function niceStep(span, target) {
  const raw = span / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return p * (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10);
}

const _pmPlotKey = (p) => (p ? [p.rangeNm, p.heightFt, p.azDevFt].join('|') : '');

/**
 * The trail as drawn: the server's trail with every plot measured against an earlier approach left out (the landing runway
 * changed: its plots were ranged from the old threshold, docs/wip/PAR-1.md "Not walked"). One per Strip.
 */
export function createTrailFilter() {
  let approachId;
  let dropped = new Set();
  return {
    apply(sample) {
      const trail = (sample && Array.isArray(sample.trail)) ? sample.trail : [];
      const id = sample && sample.approach ? sample.approach.id : null;
      if (approachId !== undefined && id !== approachId) {
        // the plot on screen may still be the old approach's (the server re-measures only on a new DCS fix): it joins the
        // trail on the next fix, so it is left out too
        dropped = new Set([...trail.map(_pmPlotKey), _pmPlotKey(sample.plot)]);
        dropped.delete('');
      }
      approachId = id;
      if (!dropped.size) return trail;
      const out = trail.filter(p => !dropped.has(_pmPlotKey(p)));
      // every old plot has aged out of the trail and the plot itself is a new one
      if (out.length === trail.length && !dropped.has(_pmPlotKey(sample && sample.plot))) dropped = new Set();
      return out;
    },
  };
}

function _pmSigned(n) {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${_PM_MINUS}${Math.abs(n)}`;
  return '0';
}

const _PM_SENSOR_REASON = Object.freeze({
  NO_APPROACH: 'no approach for the landing runway',
  NO_SHIP: 'ship not found',
  NO_COURSE: 'no final approach course',
  NO_TDZE: 'no touchdown zone elevation',
});

/** Why a scope is INOP, in words. */
export function sensorReasonText(reason) {
  return _PM_SENSOR_REASON[reason] || (reason ? String(reason) : 'no data');
}

function _pmCourse(approach) {
  const d = approach && approach.courseDisplay;
  if (!d || !_pmFin(d.value)) return '';
  return `${String(Math.round(d.value) % 360 || 360).padStart(3, '0')}${d.ref === 'M' ? 'M' : 'T'}`;
}

/** The approach header's text pieces. */
export function headerModel(approach, gpaDeg) {
  if (!approach) return { title: 'NO APPROACH', gpa: '', tch: '', da: '', fac: '' };
  const title = [approach.runwayEnd ? `RWY ${approach.runwayEnd}` : (approach.label || ''), approach.airportIcao || ''].filter(Boolean).join(' · ');
  return {
    title,
    gpa: _pmFin(gpaDeg) ? `${gpaDeg.toFixed(2)}°` : '',
    tch: _pmFin(approach.tchFt) ? String(Math.round(approach.tchFt)) : '',
    da: _pmFin(approach.daFt) ? String(Math.round(approach.daFt)) : '',
    fac: _pmCourse(approach),
  };
}

/**
 * Everything par-panel.js writes as text, for one flight. `plot` is already measured against the angle in use (replot).
 * @param {object} i { sample, plot, flight: { name, type, beacon }, sev, noPlot }
 */
export function readoutModel({ sample, plot, flight = {}, sev = { el: '', az: '' }, noPlot = { amber: false, seconds: null } } = {}) {
  const s = sample || {};
  const sensor = s.sensor || {};
  const elInop = sensor.elevation === 'INOP';
  const azInop = sensor.azimuth === 'INOP';
  const p = plot || null;
  const approach = s.approach || null;
  const range = p && _pmFin(p.rangeNm) ? (p.rangeNm < 0 ? `${_PM_MINUS}${Math.abs(p.rangeNm).toFixed(1)}` : p.rangeNm.toFixed(1)) : '—';
  const elFt = p && _pmFin(p.elevDevFt) && !elInop ? Math.round(p.elevDevFt) : null;
  // rounded by magnitude, so left and right read the same
  const azDeg = p && _pmFin(p.azDeg) && !azInop ? Math.sign(p.azDeg) * Math.round(Math.abs(p.azDeg) * 10) / 10 : null;
  const alt = p && _pmFin(p.heightFt) && approach && _pmFin(approach.tdzeFt) && !elInop ? Math.round(approach.tdzeFt + p.heightFt) : null;
  return {
    name: flight.name || '',
    type: flight.type || '',
    beacon: flight.beacon || '',
    gs: p && _pmFin(p.gsKt) ? `${Math.round(p.gsKt)} kt` : '—',
    vs: p && _pmFin(p.vsFpm) ? _pmSigned(Math.round(p.vsFpm)) : '—',
    range,
    el: elFt == null ? '—' : `${_pmSigned(elFt)} ft`,
    // degrees only (ADR 0123): `0.4° L`, `0.0°` on the course
    az: azDeg == null ? '—' : `${Math.abs(azDeg).toFixed(1)}°${azDeg < 0 ? ' L' : azDeg > 0 ? ' R' : ''}`,
    alt: alt == null ? '—' : `${alt.toLocaleString('en-US')} ft`,
    elSev: elInop ? '' : sev.el,
    azSev: azInop ? '' : sev.az,
    elInop, azInop,
    inopReason: (elInop || azInop) ? sensorReasonText(sensor.reason) : '',
    noPlot: noPlot.amber ? (noPlot.seconds == null ? 'NO PLOT' : `NO PLOT ${noPlot.seconds} s`) : '',
  };
}
