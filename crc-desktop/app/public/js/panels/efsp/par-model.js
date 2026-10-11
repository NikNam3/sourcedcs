'use strict';

// The PAR panel's model (decisions H115, H116; mockup docs/mockups/par-panel.html, revision 4; the sample is crc-sync
// docs/adr/0112, docs/wip/PAR-1.md "The sample"). Pure: it imports nothing and touches no DOM, so par-panel.js draws what this
// works out and the unit tests read it with no browser.
//
// What the panel shows is a picture, never an instruction (H115): no required or suggested calls, no cadence. Colour is the
// dark-cockpit rule: grey unless a problem; red outside a tolerance above DA; amber only for no plot for 3 s; orange-red for a
// scope that is INOP. Below DA the pilot decides, so nothing is coloured there (H116).

export const FT_PER_NM = 6076.12;
export const PHI = 0.618;                  // the golden-ratio point the autoscale keeps the track at (H115)
export const AUTOSCALE_FLOOR_NM = 10;      // autoscale shrinks the window down to 10 NM and stops there
export const NO_PLOT_MS = 3000;            // amber at 3 s without a plot (H115)
export const PAR_DEFAULTS = Object.freeze({ gpaDeg: 3.06, tolElDeg: 1, tolAzDeg: 1, autoscale: true }); // H116
export const DEFAULT_VIEW = Object.freeze({ rMax: 10, hMax: 3500, yMax: 1200 });
export const ZOOM_STEP = 1.15;
export const LIMITS = Object.freeze({ rMin: 0.5, rMax: 40, hMin: 150, yMin: 100 });

// The terminal ops stay the FINAL view's (ADR 0064, 0075): PAR's "Landing assured" and "Missed approach" are FINAL's own
// states; on the carrier lane "Ball" is the recorded FINAL_TO_LSO handoff and "Waveoff" the state change.
export const PAR_TERMINALS = Object.freeze({
  RUNWAY: Object.freeze([
    Object.freeze({ id: 'ASSURED', label: 'Landing assured', toState: 'BALL' }),
    Object.freeze({ id: 'MISSED', label: 'Missed approach', toState: 'BOLTER_WAVEOFF' }),
  ]),
  CARRIER: Object.freeze([
    Object.freeze({ id: 'BALL', label: 'Ball', toState: 'BALL' }),
    Object.freeze({ id: 'WAVEOFF', label: 'Waveoff', toState: 'BOLTER_WAVEOFF' }),
  ]),
});

const _PM_RAD = Math.PI / 180;
const _pmFin = (v) => typeof v === 'number' && Number.isFinite(v);
const _PM_MINUS = '−';

/** The two terminal actions of an approach kind ('RUNWAY' | 'CARRIER'), as plain data. */
export function terminalsFor(kind) {
  return (kind === 'CARRIER' ? PAR_TERMINALS.CARRIER : PAR_TERMINALS.RUNWAY).map(a => ({ ...a }));
}

/** The op a terminal button sends: FINAL's own state, or the carrier's recorded Ball handoff. */
export function terminalOp(kind, terminal) {
  if (!terminal) return null;
  if (kind === 'CARRIER' && terminal.toState === 'BALL') return { kind: 'CarrierHandoff', transfer: 'FINAL_TO_LSO' };
  return { kind: 'SetState', toState: terminal.toState };
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

/** Lateral offset (ft) of a line `deg` off the course at a range. */
export function lateralFt(rangeNm, deg) {
  return rangeNm * FT_PER_NM * Math.tan(deg * _PM_RAD);
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
 * Outside tolerance, per axis, above DA only: 'danger' or ''. Elevation against the glidepath in degrees, azimuth as the angle
 * off the course seen from touchdown (the sample's `azDeg`). An INOP axis or a missing figure is never red.
 */
export function severity(plot, { rDaNm = 0, tolElDeg = PAR_DEFAULTS.tolElDeg, tolAzDeg = PAR_DEFAULTS.tolAzDeg } = {}) {
  const out = { el: '', az: '' };
  if (!plot || !_pmFin(plot.rangeNm) || plot.rangeNm <= rDaNm) return out;
  if (_pmFin(plot.elevDevDeg) && Math.abs(plot.elevDevDeg) > tolElDeg + 1e-9) out.el = 'danger';
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

/** The name the flight row shows (H122): the side number on a carrier lane when one is typed, else the callsign. */
export function flightName({ approachKind, callsign, sideNumber } = {}) {
  const side = String(sideNumber || '').trim();
  if (approachKind === 'CARRIER' && side) return side;
  return callsign || '';
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

/** The window that keeps the track at the golden-ratio point, never smaller than 10 NM (H115). */
export function autoscaleView(plot, { gpaDeg, tchFt, tolAzDeg = PAR_DEFAULTS.tolAzDeg } = {}) {
  const gpa = _pmFin(gpaDeg) ? gpaDeg : PAR_DEFAULTS.gpaDeg;
  const r = plot && _pmFin(plot.rangeNm) ? Math.max(0, plot.rangeNm) : 0;
  const rMax = Math.max(AUTOSCALE_FLOOR_NM, r / PHI);
  const hTrack = plot && _pmFin(plot.heightFt) ? plot.heightFt : gpHeightFt(r, gpa, tchFt);
  const hMax = Math.max(gpHeightFt(rMax, gpa, tchFt) * 1.08, hTrack / PHI);
  const yTrack = plot && _pmFin(plot.azDevFt) ? Math.abs(plot.azDevFt) : 0;
  const yMax = Math.max(lateralFt(rMax, Math.max(tolAzDeg, 1.5)) * 1.15, yTrack / PHI);
  return { rMax, hMax, yMax };
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
    else v.yMax = Math.max(LIMITS.yMin, v.yMax * z);
  } else {
    v.rMax = Math.min(LIMITS.rMax, Math.max(LIMITS.rMin, v.rMax * z));
  }
  return v;
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
  const title = approach.kind === 'CARRIER'
    ? `${approach.label || approach.hullId || 'CARRIER'}`
    : [approach.runwayEnd ? `RWY ${approach.runwayEnd}` : (approach.label || ''), approach.airportIcao || ''].filter(Boolean).join(' · ');
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
  const azFt = p && _pmFin(p.azDevFt) && !azInop ? Math.round(p.azDevFt) : null;
  const alt = p && _pmFin(p.heightFt) && approach && _pmFin(approach.tdzeFt) && !elInop ? Math.round(approach.tdzeFt + p.heightFt) : null;
  return {
    name: flight.name || '',
    type: flight.type || '',
    beacon: flight.beacon || '',
    gs: p && _pmFin(p.gsKt) ? `${Math.round(p.gsKt)} kt` : '—',
    vs: p && _pmFin(p.vsFpm) ? _pmSigned(Math.round(p.vsFpm)) : '—',
    range,
    el: elFt == null ? '—' : `${_pmSigned(elFt)} ft`,
    az: azFt == null ? '—' : `${Math.abs(azFt)} ft ${azFt < 0 ? 'L' : azFt > 0 ? 'R' : ''}`.trim(),
    alt: alt == null ? '—' : `${alt.toLocaleString('en-US')} ft`,
    elSev: elInop ? '' : sev.el,
    azSev: azInop ? '' : sev.az,
    elInop, azInop,
    inopReason: (elInop || azInop) ? sensorReasonText(sensor.reason) : '',
    noPlot: noPlot.amber ? (noPlot.seconds == null ? 'NO PLOT' : `NO PLOT ${noPlot.seconds} s`) : '',
  };
}
