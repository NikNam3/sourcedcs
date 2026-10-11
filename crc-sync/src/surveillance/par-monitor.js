'use strict';

// The PAR monitor (docs/adr/0112): every `sampleMs` it finds each aircraft on a final, works out the approach it is on,
// and builds its PAR sample (par.js). ws-hub.js sends each sample to the sessions signed on to the Position that owns the
// Strip, and to nobody else (`WsHub#sendParSamples`).
//
// "On a final" is one Board fact: a FINAL Strip in state ON_FINAL in a Bay whose descriptor says `view: 'final'`
// (Incirlik's `par-final`, the carrier's `cv-app1-final` / `cv-app2-final`; docs/adr/0075, 0093). Missed approach, Landing
// assured, Ball and Waveoff all move the Strip out of that state, so its sample ends with the op that ended the talk-down,
// and a Strip that comes back starts a fresh trail.
//
// The approach:
//   - an airfield Facility: its `parApproaches` (Facility config) for the runway end the Strip lands on, resolved the way
//     every other runway question is (runway-status.js resolveRunwayForStrip: the flight's assigned landing runway, else
//     the active runway);
//   - the CARRIER Facility: the hull's `approach` (config/efsp-carriers.json) on the LIVE ship track, matched each tick
//     (the banner in the carrier store only republishes on a whole-degree BRC step, so its position can be minutes old).
//
// A plot is taken when DCS has moved the aircraft since the last one and it is inside the PAR's volume. Otherwise the
// sample keeps its last plot and `plotAgeMs` grows: the client's "NO PLOT" after 3 s (H115) reads it. The age is a pure
// duration on the injected wall clock (docs/adr/0096).

const par = require('./par');
const { matchHullTrack, displayBearing } = require('../efsp/carrier/ship-state');
const { gridToTrue, normDeg } = require('../efsp/carrier/angles');
const { resolveRunwayForStrip } = require('../efsp/runway-status');
const { WALL_CLOCK } = require('../mission-clock');

const CARRIER_FACILITY = 'CARRIER';

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
   * @param {()=>object[]} d.tracks          every live track (to find the ship)
   * @param {object} [d.carrierStore]        hullIds(), hull(id), defaultHullId
   * @param {()=>number|null} [d.ownCoalition]
   * @param {(lat:number, lon:number)=>number|null} [d.convergenceAt]
   * @param {(lat:number, lon:number)=>number|null} [d.variationAt]
   * @param {(icao:string)=>number|null} [d.airportElevationFt] the DCS airfield elevation, for an approach with `tdzeFt: null`
   * @param {{now:()=>number}} [d.wallClock]
   * @param {object} d.tuning                par-tuning.js
   */
  constructor({ facilityConfig, boardStoreFor, flightDataOf, correlatedTrackId, runwayViewOf, trackOf, tracks, carrierStore = null,
    ownCoalition = () => null, convergenceAt = () => null, variationAt = () => null, airportElevationFt = () => null,
    wallClock = WALL_CLOCK, tuning }) {
    Object.assign(this, { _fc: facilityConfig, _board: boardStoreFor, _fd: flightDataOf, _corr: correlatedTrackId, _rwy: runwayViewOf,
      _track: trackOf, _tracks: tracks, _carrier: carrierStore, _own: ownCoalition, _conv: convergenceAt, _var: variationAt,
      _aptElev: airportElevationFt, _wall: wallClock, _tuning: tuning });
    this._state = new Map(); // `${facilityId}:${stripId}` -> { fix, plot, plotAt, trail }
  }

  /** How often the hub should run `tick()` (config/par.json). */
  get sampleMs() { return this._tuning.sampleMs; }

  /** The final Bays: [{ facilityId, bayId, positionId }]. Read from the config each tick (cheap) so a test reload is seen. */
  _finalBays() {
    const out = [];
    for (const facilityId of this._fc.getFacilityIds()) {
      for (const bay of this._fc.getAllBays(facilityId)) if (bay.view === 'final') out.push({ facilityId, bayId: bay.bayId, positionId: bay.positionId });
    }
    return out;
  }

  /** @returns {object[]} one sample entry (par.SAMPLE_KEYS) per aircraft on a final */
  tick() {
    const now = this._wall.now();
    const seen = new Set();
    const out = [];
    const carrierGeom = new Map(); // hullId -> geometry, once per tick
    for (const { facilityId, bayId } of this._finalBays()) {
      const board = this._board(facilityId);
      if (!board) continue;
      for (const strip of board.getAll()) {
        if (strip.bayId !== bayId || strip.stripType !== 'FINAL' || strip.state !== 'ON_FINAL') continue;
        const key = `${facilityId}:${strip.stripId}`;
        seen.add(key);
        const geom = facilityId === CARRIER_FACILITY ? this._carrierGeometry(carrierGeom) : this._runwayGeometry(facilityId, strip);
        out.push(this._sample(key, facilityId, strip, geom, now));
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
      id: `${icao || facilityId}-${r.end}`, kind: 'RUNWAY', label: a.label, runwayEnd: r.end, airportIcao: icao, hullId: null,
      gpaDeg, gpaPublished: published, tchFt: a.tchFt, tdzeFt, dhFt: a.decisionHeightFt,
      daFt: tdzeFt === null ? null : tdzeFt + a.decisionHeightFt,
      courseTrueDeg: a.courseTrueDeg,
      courseDisplay: displayBearing(a.courseTrueDeg, { ref: 'TRUE', magneticVariationDeg: _fin(v) ? v : null }),
    };
    const ref = { refLat: a.thresholdLat, refLon: a.thresholdLon, courseTrueDeg: a.courseTrueDeg, tdzeFt, tchFt: a.tchFt, gpaDeg };
    const sensor = tdzeFt === null ? { elevation: 'INOP', azimuth: 'OK', reason: 'NO_TDZE' } : { elevation: 'OK', azimuth: 'OK', reason: null };
    return { approach, ref, sensor };
  }

  /** The carrier lane's approach on the live ship: the touchdown point moves with the ship, the course turns with it. */
  _carrierGeometry(cache) {
    const store = this._carrier;
    const hullId = store ? store.defaultHullId : null;
    if (cache.has(hullId)) return cache.get(hullId);
    const hull = hullId ? store.hull(hullId) : null;
    let geom;
    if (!hull || !hull.approach) {
      geom = { approach: null, ref: null, sensor: { elevation: 'INOP', azimuth: 'INOP', reason: 'NO_APPROACH' } };
    } else {
      const a = hull.approach;
      const ship = matchHullTrack(hull, this._tracks() || [], { ownCoalition: this._own() });
      const approach = {
        id: hull.hullId, kind: 'CARRIER', label: hull.label || hull.hullId, runwayEnd: null, airportIcao: null, hullId: hull.hullId,
        gpaDeg: a.glideslopeDeg, gpaPublished: true, tchFt: a.tchFt, tdzeFt: a.deckHeightFt, dhFt: a.decisionHeightFt,
        daFt: a.deckHeightFt + a.decisionHeightFt, courseTrueDeg: null, courseDisplay: { value: null, ref: null },
      };
      if (!ship || !_fin(ship.lat) || !_fin(ship.lon)) {
        geom = { approach, ref: null, sensor: { elevation: 'INOP', azimuth: 'INOP', reason: 'NO_SHIP' } };
      } else {
        // The live heading: DCS's grid heading made true with the grid convergence at the ship (H15); with no convergence
        // the grid heading stands (a degree or two, a few metres at the touchdown point).
        const grid = normDeg(ship.heading);
        const gamma = this._conv(ship.lat, ship.lon);
        const known = grid == null ? null : gridToTrue(grid, _fin(gamma) ? gamma : null);
        const trueHdg = known ?? grid;
        if (trueHdg == null) {
          geom = { approach, ref: null, sensor: { elevation: 'INOP', azimuth: 'INOP', reason: 'NO_COURSE' } };
        } else {
          const td = par.carrierTouchdown({ shipLat: ship.lat, shipLon: ship.lon, headingTrueDeg: trueHdg, aftM: a.touchdownAftM, portM: a.touchdownPortM });
          // The landing area's centreline: the hull's heading less the angled deck (ship-state.js computeFinalBearing).
          const course = normDeg(trueHdg - hull.angledDeckDeg);
          const v = this._var(ship.lat, ship.lon);
          approach.courseTrueDeg = Math.round(course * 10) / 10;
          approach.courseDisplay = displayBearing(course, { ref: known == null ? 'GRID' : 'TRUE', magneticVariationDeg: _fin(v) ? v : null });
          geom = {
            approach,
            ref: { refLat: td.lat, refLon: td.lon, courseTrueDeg: course, tdzeFt: a.deckHeightFt, tchFt: a.tchFt, gpaDeg: a.glideslopeDeg },
            sensor: { elevation: 'OK', azimuth: 'OK', reason: null },
          };
        }
      }
    }
    cache.set(hullId, geom);
    return geom;
  }
}

module.exports = { ParMonitor, CARRIER_FACILITY };
