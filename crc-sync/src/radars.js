'use strict';

// The radar list — ported from crc-desktop's app/public/js/app.js
// (the old radar-list builders), which derived it inside each renderer from
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
const { readShipped, checkLayerKeys } = require('./tuning-file');
const { validateDatalinkConfig, validateTransponderConfig } = require('./surveillance/sensor-config');
const log = require('./log').logger('radars');

// Field radars (airport, approach, carrier approach) and the ship antenna height
// are `fieldRadar` / `shipRadarHeightM` in config/sensor-specs.json (DATA-3, H88):
// [SOURCE-DEFINED], DCS models none of it and no figure is any real facility's.
const M_PER_NM = 1852;

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
  // The state/ copy is held to the shipped file's keys (H88 item 8): an unknown or misspelled key stops start-up.
  // `radar` and `carrierRadar` are maps keyed by DCS type name, so their children are free.
  checkLayerKeys(cfg, shipped, path.resolve(specsPath), 'sensor-specs.json', '', { freeMaps: ['radar', 'carrierRadar'] });
  const presentation = { ...shipped.presentation };
  for (const [k, v] of Object.entries(cfg.presentation || {})) if (PRESENTATIONS.has(v)) presentation[k] = v;
  const defaultCaps = {};
  for (const k of Object.keys(shipped.defaultCaps)) defaultCaps[k] = { ...shipped.defaultCaps[k], ...((cfg.defaultCaps || {})[k] || {}) };
  const fieldRadar = {};
  for (const k of Object.keys(shipped.fieldRadar || {})) fieldRadar[k] = { ...shipped.fieldRadar[k], ...((cfg.fieldRadar || {})[k] || {}) };
  const out = {
    radar: cfg.radar || shipped.radar,
    carrierRadar: cfg.carrierRadar || shipped.carrierRadar,
    presentation,
    defaultCaps,
    shipRadarDefault: { ...shipped.shipRadarDefault, ...(cfg.shipRadarDefault || {}) },
    shipRadarHeightM: cfg.shipRadarHeightM !== undefined ? cfg.shipRadarHeightM : shipped.shipRadarHeightM,
    fieldRadar,
    datalink: { ...shipped.datalink, ...(cfg.datalink || {}) },
    transponder: { ...shipped.transponder, ...(cfg.transponder || {}) },
  };
  validateFieldRadar(out, path.resolve(specsPath));
  validateDatalinkConfig(out.datalink, path.resolve(specsPath));
  validateTransponderConfig(out.transponder, path.resolve(specsPath));
  return out;
}

const FIELD_RADAR_KINDS = ['airport', 'approach', 'carrierApproach'];

/** Throws naming the file and the key when a field radar figure or the ship antenna height is missing or not a sane number (DATA-3). */
function validateFieldRadar(specs, file) {
  const bad = (key, why) => { throw new Error(`[sensor-specs] ${file}: "${key}" ${why}`); };
  const num = (v, min) => typeof v === 'number' && Number.isFinite(v) && v >= min;
  if (!num(specs.shipRadarHeightM, 0)) bad('shipRadarHeightM', 'must be a number of metres >= 0');
  for (const kind of FIELD_RADAR_KINDS) {
    const r = specs.fieldRadar[kind];
    if (!r || typeof r !== 'object') bad(`fieldRadar.${kind}`, 'is missing');
    if (!num(r.rangeNm, Number.MIN_VALUE)) bad(`fieldRadar.${kind}.rangeNm`, 'must be a number > 0');
    if (!num(r.sweepMs, Number.MIN_VALUE)) bad(`fieldRadar.${kind}.sweepMs`, 'must be a number > 0');
    if (!num(r.heightM, 0)) bad(`fieldRadar.${kind}.heightM`, 'must be a number of metres >= 0');
  }
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
    const elevM = (apt.elev || 0) + specs.fieldRadar.airport.heightM;
    const appElevM = (apt.elev || 0) + specs.fieldRadar.approach.heightM;

    radars.push({
      id: `apt:${apt.name}`, type: 'airport', label: aptLabel,
      airport: apt.name, airportIcao: apt.icao || null,
      lat: apt.lat, lon: apt.lon, elevM,
      rangeM: specs.fieldRadar.airport.rangeNm * M_PER_NM, sweepMs: specs.fieldRadar.airport.sweepMs,
      // The only radar that sees ground vehicles at all.
      seesGround: true, seesShips: false, noGroundAircraft: false,
      angleFromNose: 360, heading: 0,
      caps: capsFor('airport', null, specs), presentation: presentationFor('airport', specs),
    });

    radars.push({
      id: `app:${apt.name}`, type: 'approach', label: `${aptLabel} APP`,
      airport: apt.name, airportIcao: apt.icao || null,
      lat: apt.lat, lon: apt.lon, elevM: appElevM,
      rangeM: specs.fieldRadar.approach.rangeNm * M_PER_NM, sweepMs: specs.fieldRadar.approach.sweepMs,
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
      lat: t.lat, lon: t.lon, elevM: t.alt + specs.shipRadarHeightM,
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
        lat: t.lat, lon: t.lon, elevM: t.alt + specs.fieldRadar.carrierApproach.heightM,
        rangeM: specs.fieldRadar.carrierApproach.rangeNm * M_PER_NM, sweepMs: specs.fieldRadar.carrierApproach.sweepMs,
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
  M_PER_NM,
};
