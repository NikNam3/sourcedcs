'use strict';

// The PAR monitor (docs/adr/0112): every `sampleMs` it finds each aircraft on a final, works out the approach it is on,
// and builds its PAR sample (par.js). ws-hub.js sends each sample to the sessions signed on to the Position that owns the
// Strip, and to nobody else (`WsHub#sendParSamples`).
//
// "On a final" is one Board fact: a FINAL Strip in state ON_FINAL in a Bay whose descriptor says `view: 'final'`
// (Incirlik's `par-final`; docs/adr/0075, 0093) at an AIRFIELD Facility (one with `runwayStatus`). The PAR is an airfield
// feature only (decisions H125, docs/adr/0116): the carrier's final Bays (`cv-app1-final` / `cv-app2-final`) get no sample.
// Missed approach and Landing assured move the Strip out of that state, so its sample ends with the op that ended the
// talk-down, and a Strip that comes back starts a fresh trail.
//
// The approach: the Facility's `parApproaches` (Facility config) for the runway end the Strip lands on, resolved the way
// every other runway question is (runway-status.js resolveRunwayForStrip: the flight's assigned landing runway, else the
// active runway).
//
// A plot is taken when DCS has moved the aircraft since the last one and it is inside the PAR's volume. Otherwise the
// sample keeps its last plot and `plotAgeMs` grows: the client's "NO PLOT" after 3 s (H115) reads it. The age is a pure
// duration on the injected wall clock (docs/adr/0096).

const par = require('./par');
const { displayBearing } = require('../efsp/carrier/ship-state');
const { resolveRunwayForStrip } = require('../efsp/runway-status');
const { WALL_CLOCK } = require('../mission-clock');

const _fin = (v) => typeof v === 'number' && Number.isFinite(v);

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
   * @param {{now:()=>number}} [d.wallClock]
   * @param {object} d.tuning                par-tuning.js
   */
  constructor({ facilityConfig, boardStoreFor, flightDataOf, correlatedTrackId, runwayViewOf, trackOf,
    variationAt = () => null, airportElevationFt = () => null, wallClock = WALL_CLOCK, tuning }) {
    Object.assign(this, { _fc: facilityConfig, _board: boardStoreFor, _fd: flightDataOf, _corr: correlatedTrackId, _rwy: runwayViewOf,
      _track: trackOf, _var: variationAt, _aptElev: airportElevationFt, _wall: wallClock, _tuning: tuning });
    this._state = new Map(); // `${facilityId}:${stripId}` -> { fix, plot, plotAt, trail }
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
    return {
      stripId: strip.stripId,
      facilityId,
      positionId: strip.ownerPositionId,
      approach: geom.approach,
      sensor: geom.sensor,
      plot: st.plot,
      plotAgeMs: st.plotAt === null ? null : Math.max(0, now - st.plotAt),
      trail: st.trail.slice(),
    };
  }

  /** The approach and its geometry for a Strip at an airfield Facility. */
  _runwayGeometry(facilityId, strip) {
    const cfg = this._fc.getFacilityConfig(facilityId) || {};
    const approaches = cfg.parApproaches || {};
    const view = this._rwy(facilityId);
    const fd = strip.flightDataId ? this._fd(strip.flightDataId) : null;
    // A FINAL Strip resolves its runway as the ARRIVAL it was (sfa.js turns an ARRIVAL into a FINAL in place); its rack on
    // the final Bay names no runway end.
    const r = view ? resolveRunwayForStrip({ ...strip, stripType: 'ARRIVAL', rackId: null }, fd, view) : null;
    const a = r && r.end && Object.prototype.hasOwnProperty.call(approaches, r.end) && !r.end.startsWith('_') ? approaches[r.end] : null;
    if (!a) return { approach: null, ref: null, sensor: { elevation: 'INOP', azimuth: 'INOP', reason: 'NO_APPROACH' } };
    const icao = (cfg.runwayStatus && cfg.runwayStatus.airportIcao) || null;
    const tdze = _fin(a.tdzeFt) ? a.tdzeFt : (icao ? this._aptElev(icao) : null);
    const tdzeFt = _fin(tdze) ? Math.round(tdze) : null;
    const published = _fin(a.glideslopeDeg);
    const gpaDeg = published ? a.glideslopeDeg : this._tuning.defaultGlideslopeDeg;
    const v = this._var(a.thresholdLat, a.thresholdLon);
    const approach = {
      id: `${icao || facilityId}-${r.end}`, label: a.label, runwayEnd: r.end, airportIcao: icao,
      gpaDeg, gpaPublished: published, tchFt: a.tchFt, tdzeFt, dhFt: a.decisionHeightFt,
      daFt: tdzeFt === null ? null : tdzeFt + a.decisionHeightFt,
      courseTrueDeg: a.courseTrueDeg,
      courseDisplay: displayBearing(a.courseTrueDeg, { ref: 'TRUE', magneticVariationDeg: _fin(v) ? v : null }),
    };
    const ref = { refLat: a.thresholdLat, refLon: a.thresholdLon, courseTrueDeg: a.courseTrueDeg, tdzeFt, tchFt: a.tchFt, gpaDeg };
    const sensor = tdzeFt === null ? { elevation: 'INOP', azimuth: 'OK', reason: 'NO_TDZE' } : { elevation: 'OK', azimuth: 'OK', reason: null };
    return { approach, ref, sensor };
  }
}

module.exports = { ParMonitor };
