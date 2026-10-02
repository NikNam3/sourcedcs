'use strict';

// The radar list — ported from crc-desktop's app/public/js/app.js
// (_buildAllRadars/getAllRadars), which derived it inside each renderer from
// that client's own copy of the mission data.
//
// It lives here now because the radar picture is server-authoritative
// (docs/adr/0042): every controller's beams sit at one phase, coverage follows
// the Positions they hold, and a Strip's correlated track means the same thing
// to everybody looking at it. Nothing in crc-sync knew a radar existed before
// this file.
//
// Two bugs in the original were fixed while porting rather than carried over
// (both recorded in docs/adr/0042):
//
//   - A CVN's approach radar used the `app:` id prefix, the same one airport
//     approach radars use (`app:${apt.name}` vs `app:${track.id}`). Anything
//     keying on that prefix — geojson.js's extended centerline did — could
//     match a carrier for an airfield. Carriers now get `cvapp:`.
//   - `noseScanLastMs` was declared next to the sweep state and never read or
//     written anywhere. It is not ported.
//
// This module is deliberately pure: give it mission data, tracks and the spec
// table and it returns an array. It holds no state, no clock and no sweep
// phase — coverage.js owns those, so a test can hand this a fixture.

const path = require('path');
const fs = require('fs');

const { checkOnGround } = require('./geo');
const { CONFIG_DIR } = require('./state-paths');
const { readShipped } = require('./tuning-file');
const log = require('./log').logger('radars');

// DCS reports no radar-tower height, so a ground-based radar needs an assumed
// offset or terrain masking would make it unrealistically easy to block.
// Airborne radars use their own live altitude instead.
const AIRPORT_RADAR_HEIGHT_M = 15;
const SHIP_RADAR_HEIGHT_M = 40;

const M_PER_NM = 1852;

// Airport surveillance and approach radars, per airfield. [SOURCE-DEFINED] —
// DCS models neither, so these are SOURCE's own figures and must not be
// presented as any real facility's equipment (defect D11).
const AIRPORT_RADAR = { rangeNm: 40, sweepMs: 2000 };
const APPROACH_RADAR = { rangeNm: 80, sweepMs: 3000 };
const CVN_APPROACH_RADAR = { rangeNm: 50, sweepMs: 4000, heightM: 45 };
const RADAR_TYPES = ['airport', 'approach', 'awacs', 'fighter', 'carrier'];

// What each kind of radar can measure beyond a position (docs/adr/0059).
//   height — a height-finding (3D) radar gives an altitude with no help
//            from the aircraft. A 2D surveillance radar does not.
//   ssr    — it interrogates transponders (SSR, or a military IFF
//            interrogator), so a squawking aircraft gives its code and
//            Mode C altitude.
//   mode4  — it carries a Mode 4/5 interrogator: an own-side aircraft or
//            ship with the right crypto keys answers it, and that answer is
//            what makes a contact friendly (docs/adr/0066). Independent of
//            `ssr`. Tactical radars carry one; ATC radars do not.
// A radar-spec entry may override its kind's defaults with `caps`.
// [SOURCE-DEFINED], like every figure here.
// (the per-kind defaults are `defaultCaps` in config/sensor-specs.json, H53 / docs/adr/0084)

function capsFor(kind, spec, specs) {
  return { ...specs.defaultCaps[kind], ...((spec && spec.caps) || {}) };
}

// Which draw scheme a contact seen by each kind of radar gets (docs/adr/0088,
// decisions H5/H41/H50): 'ATC' is the STARS scheme, 'TACTICAL' today's GCI
// scope. Overridable per kind in sensor-specs.json's `presentation`, read
// once at startup (P5). [SOURCE-DEFINED].
const PRESENTATIONS = new Set(['ATC', 'TACTICAL']);

/** The draw scheme for one kind of radar. loadSensorSpecs has already replaced an unknown value with the shipped one. */
function presentationFor(kind, specs) {
  return specs.presentation[kind];
}

// Overridable so tests drive a fixture without touching disk — the same
// env-var pattern every other config/*.json path in this package uses.
const SENSOR_SPECS_PATH = process.env.CRCSYNC_SENSOR_SPECS_PATH
  || path.join(__dirname, '../config/sensor-specs.json');

// Helipads/FARPs/FOBs are not radar sites. Matches the original's own filter.
const HELIPAD_RE = /helipad|farp|fob/i;

/**
 * config/sensor-specs.json is the only source of every default (DATA-2, H88): it
 * is read strictly (a missing or invalid shipped file is a startup error naming
 * it), and `specsPath` (a state copy or a test fixture) layers over it. `radar`
 * and `carrierRadar` are replaced whole by a layer that has them; the other
 * sections merge key by key. An unknown `presentation` value keeps the shipped one.
 */
function loadSensorSpecs(specsPath = SENSOR_SPECS_PATH) {
  const shipped = readShipped('sensor-specs.json');
  let cfg = {};
  if (path.resolve(specsPath) !== path.join(CONFIG_DIR, 'sensor-specs.json')) {
    try {
      cfg = JSON.parse(fs.readFileSync(specsPath, 'utf8'));
    } catch (e) {
      log.warn('could not read sensor specs, using the shipped sensor-specs.json', { file: specsPath, error: e.message });
    }
  }
  const presentation = { ...shipped.presentation };
  for (const [k, v] of Object.entries(cfg.presentation || {})) if (PRESENTATIONS.has(v)) presentation[k] = v;
  const defaultCaps = {};
  for (const k of Object.keys(shipped.defaultCaps)) defaultCaps[k] = { ...shipped.defaultCaps[k], ...((cfg.defaultCaps || {})[k] || {}) };
  return {
    radar: cfg.radar || shipped.radar,
    carrierRadar: cfg.carrierRadar || shipped.carrierRadar,
    presentation,
    defaultCaps,
    shipRadarDefault: { ...shipped.shipRadarDefault, ...(cfg.shipRadarDefault || {}) },
    datalink: { ...shipped.datalink, ...(cfg.datalink || {}) },
    transponder: { ...shipped.transponder, ...(cfg.transponder || {}) },
  };
}

function isRadarSite(apt) {
  if (!apt || !apt.lat || !apt.lon) return false;
  if (apt.name === 'H' || HELIPAD_RE.test(apt.name || '')) return false;
  return true;
}

/**
 * Every radar that exists in the theater right now, regardless of who can see
 * through it. position-coverage.js decides which of these a Position is
 * assigned; coverage.js decides what each one is currently illuminating.
 *
 * @param {object} args
 * @param {{airports?:Array}|null} args.missionData
 * @param {Array} args.tracks — TrackStore.getAll()
 * @param {{radar:object, carrierRadar:object}} args.radarSpecs
 * @returns {Array<object>} radar records
 *
 * An airborne or ship radar is labelled with its unit's own DCS callsign. A
 * radar is a sensor the controller is working through — their own AWACS,
 * their own carrier — not a contact they are identifying.
 */
function buildRadars({ missionData, tracks, radarSpecs }) {
  const specs = radarSpecs || loadSensorSpecs();
  const label = (t) => t.callsign;
  const radars = [];
  const airports = (missionData && missionData.airports) || [];

  for (const apt of airports) {
    if (!isRadarSite(apt)) continue;
    const aptLabel = apt.icao || apt.name;
    const elevM = (apt.elev || 0) + AIRPORT_RADAR_HEIGHT_M;

    radars.push({
      id: `apt:${apt.name}`, type: 'airport', label: aptLabel,
      airport: apt.name, airportIcao: apt.icao || null,
      lat: apt.lat, lon: apt.lon, elevM,
      rangeM: AIRPORT_RADAR.rangeNm * M_PER_NM, sweepMs: AIRPORT_RADAR.sweepMs,
      // The only radar that sees ground vehicles at all.
      seesGround: true, seesShips: false, noGroundAircraft: false,
      angleFromNose: 360, heading: 0,
      caps: capsFor('airport', null, specs), presentation: presentationFor('airport', specs),
    });

    radars.push({
      id: `app:${apt.name}`, type: 'approach', label: `${aptLabel} APP`,
      airport: apt.name, airportIcao: apt.icao || null,
      lat: apt.lat, lon: apt.lon, elevM,
      rangeM: APPROACH_RADAR.rangeNm * M_PER_NM, sweepMs: APPROACH_RADAR.sweepMs,
      seesGround: false, seesShips: false, noGroundAircraft: true,
      angleFromNose: 360, heading: 0,
      caps: capsFor('approach', null, specs), presentation: presentationFor('approach', specs),
    });
  }

  for (const t of tracks || []) {
    if (t.category !== 1 && t.category !== 2) continue;
    const spec = specs.radar[t.type];
    if (!spec) continue;
    // A 360° dish is an AWACS; a forward-looking cone is a fighter. The split
    // is the scan arc, not the airframe, so an MPA with a 180° arc is a
    // "fighter" for coverage purposes and that is the right answer.
    const kind = spec.angleFromNose === 360 ? 'awacs' : 'fighter';
    radars.push({
      id: `crc:${t.id}`,
      type: kind,
      caps: capsFor(kind, spec, specs), presentation: presentationFor(kind, specs),
      label: label(t), sublabel: t.type,
      lat: t.lat, lon: t.lon, elevM: t.alt,
      rangeM: spec.rangeNm * M_PER_NM, sweepMs: spec.sweepMs,
      seesGround: false, seesShips: true, noGroundAircraft: true,
      angleFromNose: spec.angleFromNose, heading: t.heading || 0,
      // A radar on the ramp is not a radar. Callers filter on this rather than
      // it being absent from the list, so the coverage panel can still say
      // "your AWACS is on the ground" instead of silently showing nothing.
      onGround: checkOnGround(t, missionData),
      coalition: t.coalition,
    });
  }

  for (const t of tracks || []) {
    if (t.category !== 4) continue;
    const spec = specs.carrierRadar[t.type] || specs.shipRadarDefault;
    radars.push({
      id: `carrier:${t.id}`, type: 'carrier', carrierRadar: 'search', unitName: t.name || null, shipType: t.type || null,
      caps: capsFor('carrier', specs.carrierRadar[t.type], specs),
      presentation: presentationFor('carrier', specs),
      label: label(t) || t.type, sublabel: t.type,
      lat: t.lat, lon: t.lon, elevM: t.alt + SHIP_RADAR_HEIGHT_M,
      rangeM: spec.rangeNm * M_PER_NM, sweepMs: spec.sweepMs,
      seesGround: false, seesShips: true, noGroundAircraft: true,
      angleFromNose: 360, heading: 0, onGround: false,
      coalition: t.coalition,
    });

    if (isCarrier(t)) {
      radars.push({
        // `cvapp:`, not `app:` — see this module's header.
        id: `cvapp:${t.id}`, type: 'carrier', carrierRadar: 'approach', unitName: t.name || null, shipType: t.type || null,
        caps: capsFor('carrierApproach', null, specs),
        presentation: presentationFor('carrierApproach', specs),
        label: `${label(t) || t.type} APP RDR`, sublabel: t.type,
        lat: t.lat, lon: t.lon, elevM: t.alt + CVN_APPROACH_RADAR.heightM,
        rangeM: CVN_APPROACH_RADAR.rangeNm * M_PER_NM, sweepMs: CVN_APPROACH_RADAR.sweepMs,
        seesGround: false, seesShips: false, noGroundAircraft: true,
        angleFromNose: 360, heading: 0, onGround: false,
        coalition: t.coalition,
      });
    }
  }

  return radars;
}

/**
 * Only a CVN gets a second, approach radar. The original also tested the
 * display label for 'CVN', which never matched anything the type check missed
 * — the three non-CVN ship types with specs are labelled "CV-59 Forrestal",
 * "LHA Tarawa" and "Kuznetsov". That branch is dropped rather than reproduced,
 * since the labels no longer exist server-side at all.
 */
function isCarrier(track) {
  return !!(track.type && track.type.includes('CVN'));
}

module.exports = {
  buildRadars, loadSensorSpecs, isRadarSite,
  AIRPORT_RADAR_HEIGHT_M, SHIP_RADAR_HEIGHT_M,
  AIRPORT_RADAR, APPROACH_RADAR,
  M_PER_NM,
};
