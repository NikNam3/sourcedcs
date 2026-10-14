'use strict';

// The airspace SCHEMA and the standing-list SEED LOADER, and nothing else (docs/adr/0098 §3, §5, §10). The
// definitions themselves live in the registry (airspace-store.js), per theater, which is their only writer; this
// module never holds one. `validateAirspaceDefinition` is pure. `loadStandingList` reads the theater-keyed file
// `config/efsp-airspaces.json` (a copy in state/ replaces it whole, ADR 0048) and the store applies it once per id.
//
// [SOURCE-DEFINED]: the guide models no working frequency, no range-control frequency and no airspace *type*
// taxonomy at all. `type`, `workingFrequencyMhz` and `controlFrequencyMhz` are this squadron's operating practice,
// not FAA or DoD doctrine, and must never be presented as such (defect D11). `type` picks no separation regime (D14,
// ADR 0038): the governing agreement does. Since docs/adr/0119 it is read for one behaviour, the airspace-entry alert
// (efsp/airspace-entry-alert.js): a tracked VFR aircraft in an active MOA or warning area does not alert, as the FAA.

const fs = require('fs');
const { statePaths } = require('../state-paths');
const containment = require('./airspace/containment');
const jurisdiction = require('./airspace/jurisdiction');


// What kind of block this is: labels borrowed from FAA and ICAO special-use airspace names (AREA) and from the
// JO 7610.14 / AIM military training route names (ROUTE). Descriptive, except for the airspace-entry alert (ADR 0119).
const AREA_TYPES = new Set(['MOA', 'RANGE', 'DANGER', 'RESTRICTED', 'PROHIBITED', 'WARNING']);
const ROUTE_TYPES = new Set(['IR', 'VR', 'SR', 'LLTR']);
const AIRSPACE_TYPES = new Set([...AREA_TYPES, ...ROUTE_TYPES]);
// JURISDICTION (docs/adr/0125): whose airspace it is, for control at the boundary (JO 7110.65 ¶2-1-15 c). It has no
// schedule and no activation: it always applies. It carries the owning Positions and an airspace class, and its geometry
// may be a circle (fixed, or anchored to a carrier hull) as well as a polygon.
const KINDS = ['AREA', 'ROUTE', 'JURISDICTION'];
// ICAO airspace classes. Class G is airspace nobody controls, so a Class G area is never anyone's jurisdiction.
const AIRSPACE_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const SOURCES = ['PANEL', 'WEB', 'STANDING', 'ACO'];

// Vertical limits, in feet. Both optional: an airspace with neither is
// unbounded as far as this system is concerned, which is honest — the real
// limits are published elsewhere and this is not a charting tool. When they
// ARE set, a flight's altitude block has to fit inside them. The 0..100000 ft
// range is an engineering bound on typed input (a sanity check), not a rule.
const MIN_ALTITUDE_FT = 0;
const MAX_ALTITUDE_FT = 100000;

function isValidAltitude(value) {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= MIN_ALTITUDE_FT && value <= MAX_ALTITUDE_FT;
}

// Deliberately one unit, one type, everywhere inside the EFSP: MHz as a
// number. The wider repo is inconsistent (atis-store keys by integer Hz,
// apt-config stores an unvalidated string, the SRS bridge takes float MHz at
// its HTTP boundary), so conversions happen at those edges, never here.
// 30..400 MHz is likewise an engineering bound on typed input, not a rule.
const MIN_FREQUENCY_MHZ = 30;
const MAX_FREQUENCY_MHZ = 400;

function isValidFrequency(value) {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= MIN_FREQUENCY_MHZ && value <= MAX_FREQUENCY_MHZ;
}


// ── engineering constants ─────────────────────────────────────────────────────────────────────
const ID_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,23}$/;
const MAX_NAME_LENGTH = 40;
const MAX_FIX_NAME_LENGTH = 40;
const MAX_ROUTE_SEGMENTS = 100;
const MAX_WIDTH_NM = 100;
const DEFINITION_HISTORY_CAP = 50;
const MAX_RADIUS_NM = jurisdiction.MAX_RADIUS_NM;
const MAX_OWNER_POSITIONS = 16;
const MAX_EXCLUDES = 16;
const MAX_SOURCE_TEXT_LENGTH = 600;

// Fields a definition may carry, and the ones a patch may never touch.
const DEFINITION_FIELDS = ['airspaceId', 'name', 'kind', 'type', 'controllingFacilityId', 'controllingPositionId',
  'usingPositionId', 'usingFacilityId', 'workingFrequencyMhz', 'controlFrequencyMhz', 'altLowerFt', 'altUpperFt',
  'geometry', 'segments', 'defaultWidthNm', 'source', 'ownerPositionIds', 'airspaceClass', 'excludes', 'sourceText'];
// The fields only a JURISDICTION area carries (ADR 0125); an AREA or a ROUTE carrying one is refused.
const JURISDICTION_ONLY_FIELDS = ['ownerPositionIds', 'airspaceClass', 'excludes', 'sourceText'];
const IMMUTABLE_FIELDS = ['airspaceId', 'kind'];
// ROUTE: derived from the segments on every write, never accepted from a client.
const DERIVED_ROUTE_FIELDS = ['altLowerFt', 'altUpperFt'];
// R3-23: while SCHEDULED, ACTIVE or RELEASED, or with a pending request, only these may change.
const LIVE_EDITABLE_FIELDS = ['name', 'workingFrequencyMhz', 'controlFrequencyMhz'];
// Clearable (`null`) fields. The rest are required.
const OPTIONAL_FIELDS = ['usingPositionId', 'usingFacilityId', 'workingFrequencyMhz', 'controlFrequencyMhz',
  'altLowerFt', 'altUpperFt', 'geometry', 'source', 'excludes', 'sourceText'];

/** ACTIVATION is a rule keyed by `kind`, not a stored field (ADR 0098 §3): AREA needs an approval, ROUTE a confirmation. */
const ACTIVATION_BY_KIND = { AREA: 'APPROVE', ROUTE: 'CONFIRM', JURISDICTION: null };

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

const fail = (detail) => ({ ok: false, reason: 'VALIDATION_ERROR', detail });
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isOptStr = (v) => v === undefined || v === null || isStr(v);
const isLat = (v) => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
const isLon = (v) => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;

function _validatePoints(id, label, points) {
  if (!Array.isArray(points) || points.length < 3) return fail(`${id}: ${label} needs at least 3 points`);
  if (points.length > containment.MAX_POLYGON_VERTICES) return fail(`${id}: ${label} has more than ${containment.MAX_POLYGON_VERTICES} points`);
  for (const p of points) {
    if (!Array.isArray(p) || p.length !== 2 || !isLat(p[0]) || !isLon(p[1])) return fail(`${id}: every ${label} point must be [lat, lon] in decimal degrees`);
  }
  const first = points[0]; const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return fail(`${id}: ${label} must not repeat its first point at the end`);
  if (containment.polygonSelfIntersects(points)) return fail(`${id}: ${label} crosses itself`);
  return null;
}

function _validateGeometry(id, geometry) {
  if (geometry === null || geometry === undefined) return null;
  if (typeof geometry !== 'object' || Array.isArray(geometry)) return fail(`${id}: geometry must be an object or null`);
  if (geometry.source === 'POLYGON') {
    const extra = Object.keys(geometry).filter(k => !['source', 'points'].includes(k));
    if (extra.length) return fail(`${id}: a POLYGON geometry has no ${extra[0]}`);
    return _validatePoints(id, 'geometry', geometry.points);
  }
  if (geometry.source === 'DCS_DRAWING') {
    const extra = Object.keys(geometry).filter(k => !['source', 'points', 'drawingRef'].includes(k));
    if (extra.length) return fail(`${id}: a DCS_DRAWING geometry has no ${extra[0]}`);
    const ref = geometry.drawingRef;
    if (!ref || typeof ref !== 'object' || !isStr(ref.layerName) || !isStr(ref.objectName) || !isStr(ref.missionFingerprint)) {
      return fail(`${id}: a DCS_DRAWING geometry needs drawingRef { layerName, objectName, missionFingerprint }`);
    }
    return _validatePoints(id, 'geometry', geometry.points);
  }
  return fail(`${id}: geometry.source must be POLYGON or DCS_DRAWING`);
}

function _bandOk(id, label, lo, hi) {
  for (const [k, v] of [['altLowerFt', lo], ['altUpperFt', hi]]) {
    if (v !== undefined && v !== null && !isValidAltitude(v)) {
      return fail(`${id}: ${label}${k} must be a whole number of feet between ${MIN_ALTITUDE_FT} and ${MAX_ALTITUDE_FT}`);
    }
  }
  if (isValidAltitude(lo) && isValidAltitude(hi) && hi <= lo) return fail(`${id}: ${label}altUpperFt must be above its altLowerFt`);
  return null;
}

function _validateSegments(id, def) {
  const segs = def.segments;
  if (!Array.isArray(segs) || segs.length < 2) return fail(`${id}: a ROUTE needs at least 2 segments (the last is the exit fix)`);
  if (segs.length > MAX_ROUTE_SEGMENTS) return fail(`${id}: a ROUTE has at most ${MAX_ROUTE_SEGMENTS} segments`);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (!s || typeof s !== 'object') return fail(`${id}: segment ${i + 1} must be an object`);
    const extra = Object.keys(s).filter(k => !['fix', 'altLowerFt', 'altUpperFt', 'widthNm'].includes(k));
    if (extra.length) return fail(`${id}: segment ${i + 1} has no ${extra[0]}`);
    const f = s.fix;
    if (!f || typeof f !== 'object' || !isStr(f.name) || f.name.length > MAX_FIX_NAME_LENGTH || !isLat(f.lat) || !isLon(f.lon)) {
      return fail(`${id}: segment ${i + 1} needs fix { name, lat, lon }`);
    }
    const last = i === segs.length - 1;
    if (last) {
      if ((s.altLowerFt ?? null) !== null || (s.altUpperFt ?? null) !== null || (s.widthNm ?? null) !== null) {
        return fail(`${id}: the last segment is the exit fix only: its altitudes and width must be null`);
      }
      continue;
    }
    const band = _bandOk(id, `segment ${i + 1} `, s.altLowerFt, s.altUpperFt);
    if (band) return band;
    if (s.widthNm !== undefined && s.widthNm !== null && !(typeof s.widthNm === 'number' && s.widthNm > 0 && s.widthNm <= MAX_WIDTH_NM)) {
      return fail(`${id}: segment ${i + 1} widthNm must be a number above 0 and at most ${MAX_WIDTH_NM}`);
    }
  }
  if (!(typeof def.defaultWidthNm === 'number' && def.defaultWidthNm > 0 && def.defaultWidthNm <= MAX_WIDTH_NM)) {
    return fail(`${id}: a ROUTE needs a defaultWidthNm above 0 and at most ${MAX_WIDTH_NM}`);
  }
  return null;
}

function _validateCircle(id, g) {
  const extra = Object.keys(g).filter(k => !['source', 'centre', 'radiusNm', 'cut'].includes(k));
  if (extra.length) return fail(`${id}: a CIRCLE geometry has no ${extra[0]}`);
  const c = g.centre;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return fail(`${id}: a CIRCLE needs a centre { lat, lon } or { hullId }`);
  const keys = Object.keys(c).sort().join(',');
  if (keys === 'hullId') {
    if (!isStr(c.hullId)) return fail(`${id}: a CIRCLE's centre hullId must be a hull id`);
    if (g.cut !== undefined && g.cut !== null) return fail(`${id}: a circle on a carrier hull has no cut`);
  } else if (keys === 'lat,lon') {
    if (!isLat(c.lat) || !isLon(c.lon)) return fail(`${id}: a CIRCLE's centre must be { lat, lon } in decimal degrees`);
  } else {
    return fail(`${id}: a CIRCLE needs a centre { lat, lon } or { hullId }`);
  }
  if (!(typeof g.radiusNm === 'number' && Number.isFinite(g.radiusNm) && g.radiusNm > 0 && g.radiusNm <= MAX_RADIUS_NM)) {
    return fail(`${id}: a CIRCLE's radiusNm must be a number above 0 and at most ${MAX_RADIUS_NM}`);
  }
  if (g.cut !== undefined && g.cut !== null) {
    const cut = g.cut;
    const pt = (p) => Array.isArray(p) && p.length === 2 && isLat(p[0]) && isLon(p[1]);
    if (typeof cut !== 'object' || Array.isArray(cut) || Object.keys(cut).sort().join(',') !== 'from,to' || !pt(cut.from) || !pt(cut.to)) {
      return fail(`${id}: a CIRCLE's cut must be { from: [lat, lon], to: [lat, lon] }`);
    }
    if (cut.from[0] === cut.to[0] && cut.from[1] === cut.to[1]) return fail(`${id}: a CIRCLE's cut needs two different points`);
  }
  return null;
}

/** The JURISDICTION half of the validator (docs/adr/0125); fills `out`'s jurisdiction fields. */
function _validateJurisdiction(id, def, out) {
  if (def.segments !== undefined || def.defaultWidthNm !== undefined) return fail(`${id}: a JURISDICTION area has a geometry, not segments`);
  if (!AIRSPACE_CLASSES.includes(def.airspaceClass)) return fail(`${id}: airspaceClass must be one of ${AIRSPACE_CLASSES.join(', ')}`);
  const owners = def.ownerPositionIds;
  if (!Array.isArray(owners) || owners.length > MAX_OWNER_POSITIONS || !owners.every(isStr) || new Set(owners).size !== owners.length) {
    return fail(`${id}: ownerPositionIds must be a list of at most ${MAX_OWNER_POSITIONS} different Position ids`);
  }
  if (def.airspaceClass === 'G' && owners.length) return fail(`${id}: Class G airspace belongs to nobody: ownerPositionIds must be empty`);
  if (def.airspaceClass !== 'G' && !owners.length) return fail(`${id}: a Class ${def.airspaceClass} area needs at least one owner Position`);
  const ex = def.excludes === undefined || def.excludes === null ? [] : def.excludes;
  if (!Array.isArray(ex) || ex.length > MAX_EXCLUDES || !ex.every(e => typeof e === 'string' && ID_PATTERN.test(e)) || new Set(ex).size !== ex.length) {
    return fail(`${id}: excludes must be a list of at most ${MAX_EXCLUDES} different airspace ids`);
  }
  if (ex.includes(id)) return fail(`${id} cannot exclude itself`);
  if (def.sourceText !== undefined && def.sourceText !== null && !(isStr(def.sourceText) && def.sourceText.length <= MAX_SOURCE_TEXT_LENGTH)) {
    return fail(`${id}: sourceText must be text of at most ${MAX_SOURCE_TEXT_LENGTH} characters`);
  }
  const band = _bandOk(id, '', def.altLowerFt, def.altUpperFt);
  if (band) return band;
  const g = def.geometry;
  if (!g || typeof g !== 'object' || Array.isArray(g)) return fail(`${id}: a JURISDICTION area needs a geometry`);
  if (g.source === 'CIRCLE') {
    const bad = _validateCircle(id, g);
    if (bad) return bad;
    if (g.centre.hullId !== undefined && ex.length) return fail(`${id}: a circle on a carrier hull excludes nothing (it wins everywhere it is)`);
  } else if (g.source === 'POLYGON') {
    const bad = _validateGeometry(id, g);
    if (bad) return bad;
  } else {
    return fail(`${id}: a JURISDICTION geometry.source must be POLYGON or CIRCLE`);
  }
  out.altLowerFt = def.altLowerFt ?? null;
  out.altUpperFt = def.altUpperFt ?? null;
  out.geometry = g.source === 'CIRCLE'
    ? { source: 'CIRCLE', centre: deepClone(g.centre), radiusNm: g.radiusNm, cut: g.cut ? deepClone(g.cut) : null }
    : deepClone(g);
  out.ownerPositionIds = [...owners];
  out.airspaceClass = def.airspaceClass;
  out.excludes = [...ex];
  out.sourceText = def.sourceText ?? null;
  return null;
}

/** The envelope of a route's legs: min of the lows, max of the highs. A null low is the surface, a null high is unbounded. */
function deriveRouteEnvelope(segments) {
  const legs = segments.slice(0, -1);
  const lows = legs.map(l => (l.altLowerFt == null ? null : l.altLowerFt));
  const highs = legs.map(l => (l.altUpperFt == null ? null : l.altUpperFt));
  return {
    altLowerFt: lows.some(v => v === null) ? null : Math.min(...lows),
    altUpperFt: highs.some(v => v === null) ? null : Math.max(...highs),
  };
}

/**
 * Validates ONE definition (ADR 0098 §3, §5), purely: no Facility lookup and no store (the cross-references are the
 * store's hard check). A normalised copy comes back, so every optional field is present (null when empty) and a
 * ROUTE's `altLowerFt`/`altUpperFt` are derived from its segments.
 *
 * @param {object} def
 * @param {{derived?:'refuse'|'recompute'}} [ctx] `refuse` (default, a client's definition): a ROUTE carrying
 *   `altLowerFt`/`altUpperFt` is refused. `recompute` (a stored definition, or a patch merged onto one): they are
 *   overwritten from the segments.
 * @returns {{ok:true, definition:object}|{ok:false, reason:'VALIDATION_ERROR', detail:string}}
 */
function validateAirspaceDefinition(def, { derived = 'refuse' } = {}) {
  if (!def || typeof def !== 'object' || Array.isArray(def)) return fail('an airspace definition must be an object');
  const unknown = Object.keys(def).filter(k => !DEFINITION_FIELDS.includes(k));
  if (unknown.length) return fail(`an airspace definition has no field ${unknown[0]}`);
  const id = def.airspaceId;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return fail('airspaceId must be 2-24 characters of A-Z, 0-9 and "-", starting with a letter or digit');
  if (!isStr(def.name) || def.name.trim() !== def.name || def.name.length > MAX_NAME_LENGTH) return fail(`${id} needs a name of 1-${MAX_NAME_LENGTH} characters`);
  const kind = def.kind === undefined ? 'AREA' : def.kind;
  if (!KINDS.includes(kind)) return fail(`${id} has unknown kind ${JSON.stringify(def.kind)}`);
  if (kind === 'JURISDICTION') {
    if (def.type !== undefined && def.type !== null) return fail(`${id}: a JURISDICTION area has no type`);
  } else {
    const types = kind === 'ROUTE' ? ROUTE_TYPES : AREA_TYPES;
    if (!types.has(def.type)) return fail(`${id} has unknown ${kind} type ${JSON.stringify(def.type)}`);
    const only = JURISDICTION_ONLY_FIELDS.find(f => def[f] !== undefined);
    if (only) return fail(`${id}: ${only} belongs to a JURISDICTION area`);
  }
  // Who approves activation (§9.11; docs/adr/0036): per airspace, so a MOA inside Ankara Center's airspace is
  // approved by CTR rather than by an Approach that does not own it.
  if (!isStr(def.controllingFacilityId)) return fail(`${id} needs a controllingFacilityId`);
  if (!isStr(def.controllingPositionId)) return fail(`${id} needs a controllingPositionId`);
  if (kind === 'JURISDICTION') {
    const none = ['usingPositionId', 'usingFacilityId', 'workingFrequencyMhz', 'controlFrequencyMhz'].find(k => def[k] !== undefined && def[k] !== null);
    if (none) return fail(`${id}: a JURISDICTION area has no ${none}`);
  }
  if (!isOptStr(def.usingPositionId)) return fail(`${id}'s usingPositionId must be a string when present`);
  if (!isOptStr(def.usingFacilityId)) return fail(`${id}'s usingFacilityId must be a string when present`);
  if (def.usingPositionId && def.usingFacilityId) return fail(`${id} cannot have both a usingPositionId and a usingFacilityId: at most one using agency`);
  for (const key of ['workingFrequencyMhz', 'controlFrequencyMhz']) {
    if (def[key] !== undefined && def[key] !== null && !isValidFrequency(def[key])) {
      return fail(`${id}'s ${key} must be a number between ${MIN_FREQUENCY_MHZ} and ${MAX_FREQUENCY_MHZ} MHz`);
    }
  }
  if (def.source !== undefined && def.source !== null && !SOURCES.includes(def.source)) return fail(`${id}'s source must be one of ${SOURCES.join(', ')}`);

  const out = {
    airspaceId: id, name: def.name, kind, type: kind === 'JURISDICTION' ? null : def.type,
    controllingFacilityId: def.controllingFacilityId, controllingPositionId: def.controllingPositionId,
    usingPositionId: def.usingPositionId || null, usingFacilityId: def.usingFacilityId || null,
    workingFrequencyMhz: def.workingFrequencyMhz ?? null, controlFrequencyMhz: def.controlFrequencyMhz ?? null,
    altLowerFt: null, altUpperFt: null, geometry: null, source: def.source ?? null,
  };
  if (kind === 'ROUTE') {
    if (def.geometry !== undefined && def.geometry !== null) return fail(`${id}: a ROUTE has segments, not a geometry`);
    if (derived === 'refuse' && ((def.altLowerFt ?? null) !== null || (def.altUpperFt ?? null) !== null)) {
      return fail(`${id}: a ROUTE's altLowerFt and altUpperFt are derived from its segments and cannot be set`);
    }
    const bad = _validateSegments(id, def);
    if (bad) return bad;
    out.segments = deepClone(def.segments).map(s => ({
      fix: s.fix, altLowerFt: s.altLowerFt ?? null, altUpperFt: s.altUpperFt ?? null, widthNm: s.widthNm ?? null,
    }));
    out.defaultWidthNm = def.defaultWidthNm;
    Object.assign(out, deriveRouteEnvelope(out.segments));
  } else if (kind === 'JURISDICTION') {
    const bad = _validateJurisdiction(id, def, out);
    if (bad) return bad;
  } else {
    if (def.segments !== undefined || def.defaultWidthNm !== undefined) return fail(`${id}: an AREA has a geometry, not segments`);
    const band = _bandOk(id, '', def.altLowerFt, def.altUpperFt);
    if (band) return band;
    out.altLowerFt = def.altLowerFt ?? null;
    out.altUpperFt = def.altUpperFt ?? null;
    const bad = _validateGeometry(id, def.geometry);
    if (bad) return bad;
    out.geometry = def.geometry ? deepClone(def.geometry) : null;
  }
  return { ok: true, definition: out };
}

/**
 * The standing list (R3-26): `{ [theater]: [definition] }`. Shipped as `{}` until the human supplies it. A missing
 * or malformed file is a startup error naming the theater and id (no code default, DATA-2, H88).
 * @param {{paths?:{read:string}}} [opts]
 * @returns {Object<string, object[]>}
 */
function loadStandingList({ paths = statePaths('efsp-airspaces.json', process.env.CRCSYNC_EFSP_AIRSPACES_PATH) } = {}) {
  let onDisk;
  try {
    onDisk = JSON.parse(fs.readFileSync(paths.read, 'utf8'));
  } catch (e) {
    throw new Error(`[efsp-airspace-schema] cannot read ${paths.read}: ${e.message}`);
  }
  if (!onDisk || typeof onDisk !== 'object' || Array.isArray(onDisk)) {
    throw new Error(`[efsp-airspace-schema] ${paths.read} must be an object keyed by theater (the pre-0098 array shape is not read)`);
  }
  const out = {};
  for (const [theater, list] of Object.entries(onDisk)) {
    if (theater === '_comment') continue; // the file's note to the human (ADR 0125), not a theater
    if (!Array.isArray(list)) throw new Error(`[efsp-airspace-schema] ${paths.read}: theater ${theater} must hold an array of airspace definitions`);
    const seen = new Set();
    out[theater] = list.map((def) => {
      const check = validateAirspaceDefinition(def, { derived: 'refuse' });
      if (!check.ok) throw new Error(`[efsp-airspace-schema] ${paths.read}: theater ${theater}, airspace ${def && def.airspaceId}: ${check.detail}`);
      if (seen.has(def.airspaceId)) throw new Error(`[efsp-airspace-schema] ${paths.read}: theater ${theater} lists ${def.airspaceId} twice`);
      seen.add(def.airspaceId);
      return check.definition;
    });
    // ADR 0125 (H144): the theater's JURISDICTION areas name only areas of this list in `excludes` and share no volume.
    const bad = jurisdiction.checkTheater(out[theater]);
    if (bad) throw new Error(`[efsp-airspace-schema] ${paths.read}: theater ${theater}: ${bad}`);
  }
  return out;
}

module.exports = {
  validateAirspaceDefinition, loadStandingList, deriveRouteEnvelope,
  isValidFrequency, isValidAltitude,
  AIRSPACE_TYPES, AREA_TYPES, ROUTE_TYPES, KINDS, SOURCES, ACTIVATION_BY_KIND, AIRSPACE_CLASSES,
  DEFINITION_FIELDS, JURISDICTION_ONLY_FIELDS, MAX_OWNER_POSITIONS, MAX_EXCLUDES, MAX_SOURCE_TEXT_LENGTH, MAX_RADIUS_NM, IMMUTABLE_FIELDS, DERIVED_ROUTE_FIELDS, LIVE_EDITABLE_FIELDS, OPTIONAL_FIELDS,
  MIN_FREQUENCY_MHZ, MAX_FREQUENCY_MHZ, MIN_ALTITUDE_FT, MAX_ALTITUDE_FT,
  MAX_NAME_LENGTH, DEFINITION_HISTORY_CAP, MAX_ROUTE_SEGMENTS, MAX_WIDTH_NM,
};
