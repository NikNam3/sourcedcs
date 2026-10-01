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
// A ship type with no entry in sensor-specs.json still has a surface-search
// radar — falling back is right, refusing to model it is not.
const SHIP_RADAR_DEFAULT = { rangeNm: 40, sweepMs: 5000 };

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
const DEFAULT_CAPS = {
  // H53: the squadron's fields and the carrier are military, so their ATC radars
  // carry a Mode 4/5 interrogator (docs/adr/0084).
  airport:         { height: false, ssr: true, mode4: true },
  approach:        { height: false, ssr: true, mode4: true },
  awacs:           { height: true,  ssr: true, mode4: true },
  fighter:         { height: true,  ssr: true, mode4: true },
  carrier:         { height: true,  ssr: true, mode4: true },
  carrierApproach: { height: false, ssr: true, mode4: true },
};

function capsFor(kind, spec) {
  return { ...DEFAULT_CAPS[kind], ...((spec && spec.caps) || {}) };
}

// Which draw scheme a contact seen by each kind of radar gets (docs/adr/0088,
// decisions H5/H41/H50): 'ATC' is the STARS scheme, 'TACTICAL' today's GCI
// scope. Overridable per kind in sensor-specs.json's `presentation`, read
// once at startup (P5). [SOURCE-DEFINED].
const DEFAULT_PRESENTATION = {
  airport: 'ATC', approach: 'ATC', carrierApproach: 'ATC',
  awacs: 'TACTICAL', fighter: 'TACTICAL', carrier: 'TACTICAL',
};
const PRESENTATIONS = new Set(['ATC', 'TACTICAL']);

/** The draw scheme for one kind of radar: the spec table's, else the default. */
function presentationFor(kind, specs) {
  const configured = specs && specs.presentation && specs.presentation[kind];
  return PRESENTATIONS.has(configured) ? configured : DEFAULT_PRESENTATION[kind];
}

// Overridable so tests drive a fixture without touching disk — the same
// env-var pattern every other config/*.json path in this package uses.
const SENSOR_SPECS_PATH = process.env.CRCSYNC_SENSOR_SPECS_PATH
  || path.join(__dirname, '../config/sensor-specs.json');

const EMPTY_SPECS = () => ({
  radar: {}, carrierRadar: {}, presentation: { ...DEFAULT_PRESENTATION },
  datalink: { participants: [], pliPeriodMs: 4000, lockPollMs: 2000 },
  transponder: { syntheticFor: ['own', 'neutral'], mode4For: ['own'] },
});

// Helipads/FARPs/FOBs are not radar sites. Matches the original's own filter.
const HELIPAD_RE = /helipad|farp|fob/i;

/** config/sensor-specs.json, with every section present. */
function loadSensorSpecs(specsPath = SENSOR_SPECS_PATH) {
  const base = EMPTY_SPECS();
  try {
    const cfg = JSON.parse(fs.readFileSync(specsPath, 'utf8'));
    return {
      radar: cfg.radar || {},
      carrierRadar: cfg.carrierRadar || {},
      presentation: { ...base.presentation, ...(cfg.presentation || {}) },
      datalink: { ...base.datalink, ...(cfg.datalink || {}) },
      transponder: { ...base.transponder, ...(cfg.transponder || {}) },
    };
  } catch (e) {
    console.warn('[radars] failed to load config/sensor-specs.json — every sensor falls back to defaults:', e.message);
    return base;
  }
}

function isRadarSite(apt) {
  if (!apt || !apt.lat || !apt.lon) return false;
  if (apt.name === 'H' || HELIPAD_RE.test(apt.name || '')) return false;
  return true;
}

/**
 * Every radar that exists in the theater right now, regardless of who can see
 * through it. station-coverage.js decides which of these a Position is
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
  const specs = radarSpecs || EMPTY_SPECS();
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
      caps: capsFor('airport'), presentation: presentationFor('airport', specs),
    });

    radars.push({
      id: `app:${apt.name}`, type: 'approach', label: `${aptLabel} APP`,
      airport: apt.name, airportIcao: apt.icao || null,
      lat: apt.lat, lon: apt.lon, elevM,
      rangeM: APPROACH_RADAR.rangeNm * M_PER_NM, sweepMs: APPROACH_RADAR.sweepMs,
      seesGround: false, seesShips: false, noGroundAircraft: true,
      angleFromNose: 360, heading: 0,
      caps: capsFor('approach'), presentation: presentationFor('approach', specs),
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
      caps: capsFor(kind, spec), presentation: presentationFor(kind, specs),
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
    const spec = specs.carrierRadar[t.type] || SHIP_RADAR_DEFAULT;
    radars.push({
      id: `carrier:${t.id}`, type: 'carrier', carrierRadar: 'search', unitName: t.name || null, shipType: t.type || null,
      caps: capsFor('carrier', specs.carrierRadar[t.type]),
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
        caps: capsFor('carrierApproach'),
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
  buildRadars, loadSensorSpecs, isRadarSite, capsFor, presentationFor, DEFAULT_PRESENTATION,
  RADAR_TYPES, DEFAULT_CAPS, SENSOR_SPECS_PATH,
  AIRPORT_RADAR_HEIGHT_M, SHIP_RADAR_HEIGHT_M,
  AIRPORT_RADAR, APPROACH_RADAR, CVN_APPROACH_RADAR, SHIP_RADAR_DEFAULT,
  M_PER_NM,
};
