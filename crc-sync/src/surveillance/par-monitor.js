'use strict';

// The PAR monitor (docs/adr/0112): every `sampleMs` it finds each aircraft on a final, works out the approach it is on,
// and builds its PAR sample (par.js). ws-hub.js sends each sample to the sessions signed on to the Position that owns the
// Strip, and to nobody else (`WsHub#sendParSamples`).
//
// "On a final" is one Board fact: a FINAL Strip in state ON_FINAL in a Bay whose descriptor says `view: 'final'`
// (Incirlik's `par-final`; docs/adr/0075, 0093) at an AIRFIELD Facility (one with `runwayStatus`). The PAR is an airfield
// feature only (decisions H125, docs/adr/0116): the carrier's final Bays (`cv-app1-final` / `cv-app2-final`) get no sample.
// Landed and Missed approach (par-final.js's LANDED and MISSED_APPROACH conversions) move the Strip out of that state, so
// its sample ends with the op that ended the talk-down, and a Strip that comes back starts a fresh trail.
//
// The approach: the Facility's `parApproaches` (Facility config) for the runway end the Strip lands on, resolved the way
// every other runway question is (runway-status.js resolveRunwayForStrip: the flight's assigned landing runway, else the
// active runway). Its TDZE, TCH, decision height and glidepath angle are the PAR controller's where they set one
// (runway-status-store.js `SetParApproach`, docs/adr/0130), else the Facility file's.
//
// A plot is taken when DCS has moved the aircraft since the last one and it is inside the PAR's volume. Otherwise the
// sample keeps its last plot and `plotAgeMs` grows: the client's "NO PLOT" after 3 s (H115) reads it. The age is a pure
// duration on the injected wall clock (docs/adr/0096).

const par = require('./par');
const { displayBearing } = require('../efsp/carrier/ship-state');
const { resolveRunwayForStrip } = require('../efsp/runway-status');
const { WALL_CLOCK } = require('../mission-clock');

const _fin = (v) => typeof v === 'number' && Number.isFinite(v);
const NO_PLOT_MS = 3000; // H115: the PAR panel's NO PLOT; a plot this old is no basis for a glidepath alert
const KT_PER_MS = 1.943844;
const _whole = (d) => (_fin(d) ? (Math.round(((d % 360) + 360) % 360) % 360) || 360 : null);

class ParMonitor {
  /**
   * @param {object} d
   * @param {object} d.facilityConfig        getFacilityIds, getAllBays, getFacilityConfig
   * @param {(facilityId:string)=>object} d.boardStoreFor
   * @param {(flightDataId:string)=>object|null} d.flightDataOf
   * @param {(flightDataId:string)=>string|null} d.correlatedTrackId
   * @param {(facilityId:string)=>object|null} d.runwayViewOf  runwayStatusStore.statusView
   * @param {(trackId:string)=>object|null} d.trackOf
   * @param {(lat:number, lon:number)=>number|null} [d.variationAt]
   * @param {(icao:string)=>number|null} [d.airportElevationFt] the DCS airfield elevation, for an approach with `tdzeFt: null`
   * @param {(facilityId:string)=>object|null} [d.parValuesOf] runwayStatusStore.parValues: runway end -> the values the PAR
   *   controller set (docs/adr/0130)
   * @param {(lat:number, lon:number)=>number|null} [d.convergenceAt] grid convergence (true = grid + it), for DCS's grid
   *   heading and course (docs/adr/0085)
   * @param {(icao:string)=>{windFromTrue:number, windKt:number}|null} [d.fieldWindOf] the airfield's wind as ATIS and the tower
   *   read it (DCS's, true; app/airport-weather.js), for the needed heading (docs/adr/0139)
   * @param {{now:()=>number}} [d.wallClock]
   * @param {object} d.tuning                par-tuning.js
   */
  constructor({ facilityConfig, boardStoreFor, flightDataOf, correlatedTrackId, runwayViewOf, trackOf,
    variationAt = () => null, convergenceAt = () => null, fieldWindOf = () => null, airportElevationFt = () => null,
    parValuesOf = () => null, wallClock = WALL_CLOCK, tuning }) {
    Object.assign(this, { _fc: facilityConfig, _board: boardStoreFor, _fd: flightDataOf, _corr: correlatedTrackId, _rwy: runwayViewOf,
      _track: trackOf, _var: variationAt, _conv: convergenceAt, _wind: fieldWindOf, _aptElev: airportElevationFt, _parValues: parValuesOf,
      _wall: wallClock, _tuning: tuning });
    this._state = new Map(); // `${facilityId}:${stripId}` -> { fix, plot, plotAt, trail, rDaNm, elevOk }
  }

  /**
   * The glidepath figures of a Strip's latest plot, for the glidepath alert (conformance.js evaluateGlidepath, docs/adr/0139):
   * `{ elevDevDeg, beyondDa }`, or null with no plot, a plot older than the panel's NO PLOT (3 s, H115) or the elevation
   * INOP. Read from the last tick; nothing is measured here.
   */
  glidepathOf(facilityId, stripId) {
    const st = this._state.get(`${facilityId}:${stripId}`);
    if (!st || !st.plot || !st.elevOk || st.plotAt === null || this._wall.now() - st.plotAt > NO_PLOT_MS) return null;
    if (!_fin(st.plot.elevDevDeg) || !_fin(st.plot.rangeNm)) return null;
    return { elevDevDeg: st.plot.elevDevDeg, beyondDa: st.plot.rangeNm > st.rDaNm };
  }

  /** How often the hub should run `tick()` (config/par.json). */
  get sampleMs() { return this._tuning.sampleMs; }

  /** The final Bays at airfield Facilities: [{ facilityId, bayId, positionId }]. Read from the config each tick (cheap) so a test reload is seen. */
  _finalBays() {
    const out = [];
    for (const facilityId of this._fc.getFacilityIds()) {
      const cfg = this._fc.getFacilityConfig(facilityId);
      if (!cfg || !cfg.runwayStatus) continue; // not an airfield: no PAR (H125)
      for (const bay of this._fc.getAllBays(facilityId)) if (bay.view === 'final') out.push({ facilityId, bayId: bay.bayId, positionId: bay.positionId });
    }
    return out;
  }

  /** @returns {object[]} one sample entry (par.SAMPLE_KEYS) per aircraft on a final */
  tick() {
    const now = this._wall.now();
    const seen = new Set();
    const out = [];
    for (const { facilityId, bayId } of this._finalBays()) {
      const board = this._board(facilityId);
      if (!board) continue;
      for (const strip of board.getAll()) {
        if (strip.bayId !== bayId || strip.stripType !== 'FINAL' || strip.state !== 'ON_FINAL') continue;
        const key = `${facilityId}:${strip.stripId}`;
        seen.add(key);
        out.push(this._sample(key, facilityId, strip, this._runwayGeometry(facilityId, strip), now));
      }
    }
    for (const key of [...this._state.keys()]) if (!seen.has(key)) this._state.delete(key);
    return out;
  }

  _sample(key, facilityId, strip, geom, now) {
    let st = this._state.get(key);
    if (!st) { st = { fix: null, plot: null, plotAt: null, trail: [] }; this._state.set(key, st); }
    const trackId = strip.flightDataId ? this._corr(strip.flightDataId) : null;
    const track = trackId ? this._track(trackId) : null;
    if (geom.ref && track && _fin(track.lat) && _fin(track.lon)) {
      const fix = `${track.lat},${track.lon},${track.alt}`;
      const p = { lat: track.lat, lon: track.lon, altFt: _fin(track.alt) ? track.alt * par.FT_PER_M : null, gsMs: track.groundSpeed, vsMs: track.verticalSpeed };
      if (fix !== st.fix && par.inCoverage(geom.ref, p, this._tuning.coverage)) {
        if (st.plot) {
          st.trail.push(par.trailEntry(st.plot));
          while (st.trail.length > this._tuning.trailPlots) st.trail.shift();
        }
        st.plot = par.measure(geom.ref, p);
        if (geom.sensor.elevation === 'INOP') for (const k of ['heightFt', 'elevDeg', 'elevDevDeg', 'elevDevFt']) st.plot[k] = null;
        if (geom.sensor.azimuth === 'INOP') for (const k of ['azDeg', 'azDevFt']) st.plot[k] = null;
        st.plotAt = now;
      }
      st.fix = fix;
    }
    st.rDaNm = geom.approach ? par.rangeAtDaNm(geom.approach) : 0;
    st.elevOk = geom.sensor.elevation !== 'INOP';
    return {
      stripId: strip.stripId,
      facilityId,
      positionId: strip.ownerPositionId,
      approach: geom.approach,
      sensor: geom.sensor,
      plot: st.plot,
      plotAgeMs: st.plotAt === null ? null : Math.max(0, now - st.plotAt),
      trail: st.trail.slice(),
      headings: this._headings(facilityId, geom, track),
    };
  }

  /**
   * The needed and current headings, magnetic (docs/adr/0139, decisions H164 FT-Q5): the heading that holds the final
   * approach course in the field wind, and the aircraft's own. DCS's heading and course are GRID, the course and the wind
   * TRUE; each is turned magnetic at the threshold (H15, the variation every PAR bearing uses).
   */
  _headings(facilityId, geom, track) {
    const none = { needed: null, current: null, windFrom: null, windKt: null };
    const a = geom.approach;
    if (!a || !track || !geom.ref) return none;
    const { refLat: lat, refLon: lon } = geom.ref;
    const v = this._var(lat, lon);
    const gamma = this._conv(track.lat, track.lon);
    const toMag = (trueDeg) => (_fin(trueDeg) && _fin(v) ? trueDeg - v : null);
    const gridToTrue = (g) => (_fin(g) && _fin(gamma) ? g + gamma : null);
    const w = a.airportIcao ? this._wind(a.airportIcao) : null;
    const windFrom = w && _fin(w.windFromTrue) ? w.windFromTrue : null;
    const windKt = w && _fin(w.windKt) ? w.windKt : null;
    const need = par.neededHeading({
      courseTrueDeg: a.courseTrueDeg, windFromTrueDeg: windFrom, windKt,
      trackTrueDeg: gridToTrue(track.course), gsKt: _fin(track.groundSpeed) ? track.groundSpeed * KT_PER_MS : null,
    });
    return {
      needed: need ? _whole(toMag(need.headingTrueDeg)) : null,
      current: _whole(toMag(gridToTrue(track.heading))),
      windFrom: _whole(toMag(windFrom)),
      windKt: windKt === null ? null : Math.round(windKt),
    };
  }

  /** The approach and its geometry for a Strip at an airfield Facility. */
  _runwayGeometry(facilityId, strip) {
    const view = this._rwy(facilityId);
    const fd = strip.flightDataId ? this._fd(strip.flightDataId) : null;
    // A FINAL Strip resolves its runway as the ARRIVAL it was (par-final.js's PAR_HANDOFF turns an ARRIVAL into a FINAL in place); its rack on
    // the final Bay names no runway end.
    const r = view ? resolveRunwayForStrip({ ...strip, stripType: 'ARRIVAL', rackId: null }, fd, view) : null;
    return this._approachGeometry(facilityId, r && r.end);
  }

  /**
   * The approach each final Bay's next aircraft would fly, so its controller can set the values with nobody on the final
   * (decisions H156 PV-Q1 a, H161 V2-Q1 a): the runway end an ARRIVAL with no runway of its own resolves to (the active
   * runway), one entry per final Bay that has one, whatever is on it. Every airfield Facility, every final Bay: no count.
   * @returns {{facilityId:string, positionId:string, approach:object}[]} par.FINAL_APPROACH_KEYS
   */
  finalApproaches() {
    const out = [];
    const seen = new Set();
    for (const { facilityId, positionId } of this._finalBays()) {
      const view = this._rwy(facilityId);
      const r = view ? resolveRunwayForStrip({ stripType: 'ARRIVAL', rackId: null }, null, view) : null;
      const { approach } = this._approachGeometry(facilityId, r && r.end);
      const key = approach && `${facilityId}:${positionId}:${approach.id}`;
      if (!approach || seen.has(key)) continue;
      seen.add(key);
      out.push({ facilityId, positionId, approach });
    }
    return out;
  }

  /** The approach to a runway end at an airfield Facility, its geometry and the sensor's state (`end` null: none). */
  _approachGeometry(facilityId, end) {
    const cfg = this._fc.getFacilityConfig(facilityId) || {};
    const approaches = cfg.parApproaches || {};
    const r = end ? { end } : null;
    const a = r && Object.prototype.hasOwnProperty.call(approaches, r.end) && !r.end.startsWith('_') ? approaches[r.end] : null;
    if (!a) return { approach: null, ref: null, sensor: { elevation: 'INOP', azimuth: 'INOP', reason: 'NO_APPROACH' } };
    const icao = (cfg.runwayStatus && cfg.runwayStatus.airportIcao) || null;
    // The defaults: the Facility file's values, a null TDZE being the DCS airfield's elevation and a null angle par.json's
    // default (H116's 3.06). Over them, what the PAR controller set for this runway end (docs/adr/0130, H153): one value per
    // approach, so every PAR scope and this monitor agree.
    const tdzeDefault = _fin(a.tdzeFt) ? a.tdzeFt : (icao ? this._aptElev(icao) : null);
    const defaults = {
      tdzeFt: _fin(tdzeDefault) ? Math.round(tdzeDefault) : null,
      tchFt: a.tchFt,
      dhFt: a.decisionHeightFt,
      gpaDeg: _fin(a.glideslopeDeg) ? a.glideslopeDeg : this._tuning.defaultGlideslopeDeg,
    };
    const setValues = (this._parValues(facilityId) || {})[r.end] || {};
    const set = par.PAR_VALUE_FIELDS.filter(k => _fin(setValues[k]));
    const val = (k) => (set.includes(k) ? setValues[k] : defaults[k]);
    const tdzeFt = val('tdzeFt');
    const tchFt = val('tchFt');
    const dhFt = val('dhFt');
    const gpaDeg = val('gpaDeg');
    const v = this._var(a.thresholdLat, a.thresholdLon);
    const approach = {
      id: `${icao || facilityId}-${r.end}`, label: a.label, runwayEnd: r.end, airportIcao: icao,
      gpaDeg, tchFt, tdzeFt, dhFt,
      daFt: tdzeFt === null ? null : tdzeFt + dhFt,
      courseTrueDeg: a.courseTrueDeg,
      courseDisplay: displayBearing(a.courseTrueDeg, { ref: 'TRUE', magneticVariationDeg: _fin(v) ? v : null }),
      defaults,
      set,
    };
    const ref = { refLat: a.thresholdLat, refLon: a.thresholdLon, courseTrueDeg: a.courseTrueDeg, tdzeFt, tchFt, gpaDeg };
    const sensor = tdzeFt === null ? { elevation: 'INOP', azimuth: 'OK', reason: 'NO_TDZE' } : { elevation: 'OK', azimuth: 'OK', reason: null };
    return { approach, ref, sensor };
  }
}

module.exports = { ParMonitor };
