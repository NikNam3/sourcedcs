'use strict';

// What crc-sync knows about the map the mission is on (docs/adr/0085): the
// theater's fixed facts from config/theaters.json (transition altitude,
// projection, variation override) plus the two inputs magnetic variation
// depends on that change at run time, the theater itself and the mission date.
//
// One instance, built in server.js. It is the server's single answer to
// "what is magnetic here" — for converting a typed magnetic value to true
// (decisions S-R2-12: typed magnetic inputs are converted on the server, never
// in the client) and for the `theater` message that lets every client show
// true bearings as magnetic without a model of its own.
//
// Replaces theater-settings.js: the transition altitude was a synced setting
// any controller could edit from the Airport panel, and the heading was
// corrected by a manual `hdgCorrection` fudge factor. Both are now properties
// of the theater (decisions.md H15, H62).

const magnetic = require('./magnetic');

const DEFAULT_TRANSITION_ALT_FT = 18000; // a theater the table does not list
const DAY_MS = 86400000;

// The variation grid a client interpolates in: the airfields' bounding box,
// padded, at 1°. WMM declination bends slowly enough that bilinear
// interpolation over 1° is within a few hundredths of a degree of the model.
const GRID_STEP_DEG = 1;
const GRID_PAD_DEG  = 3;
const GRID_MAX_CELLS = 40; // per axis — a mission whose airfields span the globe does not get a 10 000-point message

class TheaterContext {
  /**
   * @param {object} deps
   * @param {Record<string, object>} deps.theaters loadTheaters() output
   * @param {{now:() => number, source:string}} deps.clock the mission clock (docs/adr/0079)
   */
  constructor({ theaters = {}, clock }) {
    this._theaters = theaters;
    this._clock = clock;
    this._theatre = null;
    this._airports = [];
    this._dateMs = null;      // the date variation is computed for, snapped to the UTC day
    this._dateSource = 'WALL';
    this._grid = null;
    this.noteClock();
  }

  /** The theater's config entry, or null. */
  entry() { return (this._theatre && this._theaters[this._theatre]) || null; }

  get theatre() { return this._theatre; }

  /** A mission loaded: its theater and airfields. Returns true (the message changed). */
  setMission(missionData) {
    this._theatre = (missionData && missionData.theatre) || null;
    this._airports = ((missionData && missionData.airports) || []).filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lon));
    this._grid = null;
    this.noteClock();
    return true;
  }

  /**
   * Re-reads the mission clock. Variation depends on the date, so a new UTC
   * day, or the clock turning from the wall's answer to the mission's, moves
   * it. Returns true when it did (the caller rebroadcasts).
   */
  noteClock() {
    const now = this._clock.now();
    const source = this._clock.source === 'WALL' ? 'WALL' : 'MISSION';
    const day = Math.floor(now / DAY_MS) * DAY_MS;
    if (day === this._dateMs && source === this._dateSource) return false;
    this._dateMs = day;
    this._dateSource = source;
    this._grid = null;
    return true;
  }

  transitionAltFt() {
    const e = this.entry();
    return (e && e.transitionAltFt) || DEFAULT_TRANSITION_ALT_FT;
  }

  _override() { const e = this.entry(); return (e && e.magneticVariation) || null; }

  /** Variation at a position on the mission date, east positive; null if unknown. */
  variationAt(lat, lon) { return magnetic.variationAt(lat, lon, this._dateMs, this._override()); }

  /** Grid convergence at a position: true = grid + γ; null if the theater's projection is unknown. */
  convergenceAt(lat, lon) { return magnetic.convergenceAt(lat, lon, this.entry()); }

  /** True → magnetic at a position. */
  trueToMagnetic(trueDeg, lat, lon) { return magnetic.trueToMagnetic(trueDeg, this.variationAt(lat, lon)); }

  /** Magnetic (as a controller typed it) → true at a position. */
  magneticToTrue(magDeg, lat, lon) { return magnetic.magneticToTrue(magDeg, this.variationAt(lat, lon)); }

  /** A DCS grid heading/course → magnetic at a position; null if either correction is unknown. */
  gridToMagnetic(gridDeg, lat, lon) {
    const gamma = this.convergenceAt(lat, lon);
    if (gamma == null || !Number.isFinite(gridDeg)) return null;
    return this.trueToMagnetic(gridDeg + gamma, lat, lon);
  }

  /**
   * An airfield's wind for display (decisions.md H76): MAGNETIC in ATIS and
   * tower readouts, TRUE in METAR-style text. DCS's wind is taken as true
   * (decisions S-L1c). Both are whole degrees; magnetic is null when the
   * variation is unknown, and a readout then shows a dash, not the true value.
   * @returns {{ windFromTrue:number|null, windFromMagnetic:number|null }}
   */
  windFrom(windFromTrue, lat, lon) {
    if (!Number.isFinite(windFromTrue)) return { windFromTrue: null, windFromMagnetic: null };
    const t = magnetic.normDeg(Math.round(windFromTrue));
    const m = this.trueToMagnetic(windFromTrue, lat, lon);
    return { windFromTrue: t, windFromMagnetic: m == null ? null : Math.round(m) % 360 };
  }

  _buildGrid() {
    if (!this._airports.length) return null;
    let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
    for (const a of this._airports) {
      latMin = Math.min(latMin, a.lat); latMax = Math.max(latMax, a.lat);
      lonMin = Math.min(lonMin, a.lon); lonMax = Math.max(lonMax, a.lon);
    }
    latMin = Math.max(-89, Math.floor(latMin - GRID_PAD_DEG));
    latMax = Math.min(89, Math.ceil(latMax + GRID_PAD_DEG));
    lonMin = Math.floor(lonMin - GRID_PAD_DEG);
    lonMax = Math.ceil(lonMax + GRID_PAD_DEG);
    const rows = Math.min(GRID_MAX_CELLS, Math.round((latMax - latMin) / GRID_STEP_DEG)) + 1;
    const cols = Math.min(GRID_MAX_CELLS, Math.round((lonMax - lonMin) / GRID_STEP_DEG)) + 1;
    const deg = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = this.variationAt(latMin + r * GRID_STEP_DEG, lonMin + c * GRID_STEP_DEG);
        deg.push(v == null ? null : Math.round(v * 100) / 100);
      }
    }
    return { latMin, lonMin, stepDeg: GRID_STEP_DEG, rows, cols, deg };
  }

  /** The `theater` wire message body (ws-hub.js adds version/type). */
  wireBody() {
    const override = this._override();
    if (!this._grid) this._grid = this._buildGrid();
    const e = this.entry();
    return {
      theatre: this._theatre,
      transitionAltFt: this.transitionAltFt(),
      dateMs: this._dateMs,
      dateSource: this._dateSource,
      magnetic: {
        source: magnetic.variationSource(override),
        modelDateValid: magnetic.modelDateValid(this._dateMs),
        fixedDeg: override && Number.isFinite(override.fixedDeg) ? override.fixedDeg : null,
        grid: this._grid,
      },
      convergence: { tmCentralMeridianDeg: e && Number.isFinite(e.tmCentralMeridianDeg) ? e.tmCentralMeridianDeg : null },
    };
  }
}

module.exports = { TheaterContext, DEFAULT_TRANSITION_ALT_FT };
