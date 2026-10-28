'use strict';

// A HAND COPY of crc-sync's airspace schema rules (src/efsp/airspace-schema.js `validateAirspaceDefinition`, src/efsp/
// airspace/containment.js `polygonSelfIntersects`, and the reference check `checkReferences` in airspace-store.js),
// docs/adr/0098 §3, §5. The server decides; this runs as the controller types so Save is disabled with the reason
// instead of failing (ARCH-D7: a client rule table is a hand copy held to the server's by a parity test,
// tests/airspace-validate-parity.test.mjs, which runs one table of cases through both and compares `ok` and `detail`).
// 2P-A owns this file; 2P-B imports it (self-intersection while drawing, the route fix table).
//
// Pure: no DOM, no state. Change a rule on the server and the parity test names the case that now disagrees.

export const AREA_TYPES = ['MOA', 'RESTRICTED', 'PROHIBITED', 'WARNING'];
export const ROUTE_TYPES = ['IR', 'VR', 'SR', 'LLTR'];
export const KINDS = ['AREA', 'ROUTE', 'JURISDICTION'];
/** ICAO classes (crc-sync docs/adr/0125): Class G is nobody's, so never anyone's jurisdiction. Optional (docs/adr/0143). */
export const AIRSPACE_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
/** The VFR service of an area (crc-sync docs/adr/0143, H166; airspace-schema.js has the JO 7110.65BB paragraphs). */
export const VFR_SERVICES = ['ALL_SEPARATED', 'IFR_SEPARATED', 'ADVISORY'];
/** The service a class gives when the area names none; Class A (no VFR) and G (nobody's) have none. */
export const CLASS_VFR_SERVICE = { B: 'ALL_SEPARATED', C: 'IFR_SEPARATED', D: 'ADVISORY', E: 'ADVISORY', F: 'ADVISORY' };

/** An area's VFR service: its own `vfrService`, else its class's, else null (Class A or G). */
export function vfrServiceOf(def) {
  if (!def) return null;
  if (def.vfrService) return def.vfrService;
  return (def.airspaceClass && CLASS_VFR_SERVICE[def.airspaceClass]) || null;
}
export const SOURCES = ['PANEL', 'WEB', 'STANDING', 'ACO'];

export const MIN_ALTITUDE_FT = 0;
export const MAX_ALTITUDE_FT = 100000;
export const MIN_FREQUENCY_MHZ = 30;
export const MAX_FREQUENCY_MHZ = 400;
export const ID_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,23}$/;
export const MAX_NAME_LENGTH = 40;
export const MAX_FIX_NAME_LENGTH = 40;
export const MAX_ROUTE_SEGMENTS = 100;
export const MAX_WIDTH_NM = 100;
export const MAX_POLYGON_VERTICES = 200;
export const MAX_OWNER_POSITIONS = 16;
export const MAX_EXCLUDES = 16;
export const MAX_SOURCE_TEXT_LENGTH = 600;
export const MAX_RADIUS_NM = 250;

export const DEFINITION_FIELDS = ['airspaceId', 'name', 'kind', 'type', 'controllingFacilityId', 'controllingPositionId',
  'usingPositionId', 'usingFacilityId', 'workingFrequencyMhz', 'controlFrequencyMhz', 'altLowerFt', 'altUpperFt',
  'geometry', 'segments', 'defaultWidthNm', 'source', 'ownerPositionIds', 'airspaceClass', 'vfrService', 'excludes', 'sourceText'];
export const JURISDICTION_ONLY_FIELDS = ['ownerPositionIds', 'airspaceClass', 'vfrService', 'excludes', 'sourceText'];
export const IMMUTABLE_FIELDS = ['airspaceId', 'kind'];
export const DERIVED_ROUTE_FIELDS = ['altLowerFt', 'altUpperFt'];
/** R3-23: while SCHEDULED, ACTIVE or RELEASED, or with a pending request, only these may change. */
export const LIVE_EDITABLE_FIELDS = ['name', 'workingFrequencyMhz', 'controlFrequencyMhz'];
export const OPTIONAL_FIELDS = ['usingPositionId', 'usingFacilityId', 'workingFrequencyMhz', 'controlFrequencyMhz',
  'altLowerFt', 'altUpperFt', 'geometry', 'source', 'airspaceClass', 'vfrService', 'excludes', 'sourceText'];

/** ACTIVATION is a rule keyed by `kind`: an AREA is approved, a ROUTE is confirmed (never denied, only delayed). */
export const ACTIVATION_BY_KIND = { AREA: 'APPROVE', ROUTE: 'CONFIRM', JURISDICTION: null };

/** crc-sync docs/adr/0144 (H171 SUA-Q5 a): the AREA types always in force, with no schedule or activation (server copy). */
export const ALWAYS_IN_FORCE_TYPES = ['PROHIBITED'];
/** Is this definition always in force? */
export function isAlwaysInForce(def) { return !!def && (def.kind || 'AREA') === 'AREA' && ALWAYS_IN_FORCE_TYPES.includes(def.type); }
/** Is this record in force: ACTIVE, or of a type always in force? */
export function inForce(record) { return !!record && (record.state === 'ACTIVE' || isAlwaysInForce(record.definition)); }
/** The state word a controller reads: `IN FORCE` for an area always in force (its record stays RETURNED), else the state. */
export function displayState(record) { return isAlwaysInForce(record && record.definition) ? 'IN FORCE' : record.state; }

export function isValidAltitude(v) { return typeof v === 'number' && Number.isInteger(v) && v >= MIN_ALTITUDE_FT && v <= MAX_ALTITUDE_FT; }
export function isValidFrequency(v) { return typeof v === 'number' && Number.isFinite(v) && v >= MIN_FREQUENCY_MHZ && v <= MAX_FREQUENCY_MHZ; }

const deepClone = (obj) => JSON.parse(JSON.stringify(obj));
const fail = (detail) => ({ ok: false, reason: 'VALIDATION_ERROR', detail });
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isOptStr = (v) => v === undefined || v === null || isStr(v);
const isLat = (v) => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
const isLon = (v) => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;

// ── polygon self-intersection (containment.js: local equirectangular projection about the centroid) ──
const NM_PER_DEGREE = 60;
function _centroidOf(points) {
  let lat = 0; let lon = 0;
  for (const [a, o] of points) { lat += a; lon += o; }
  return [lat / points.length, lon / points.length];
}
function _projector(lat0, lon0) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return ([lat, lon]) => ({ x: (lon - lon0) * k * NM_PER_DEGREE, y: (lat - lat0) * NM_PER_DEGREE });
}
function _orient(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
function _onSeg(a, b, c) {
  return Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y);
}
function _segmentsIntersect(a, b, c, d) {
  const o1 = _orient(a, b, c); const o2 = _orient(a, b, d); const o3 = _orient(c, d, a); const o4 = _orient(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  if (o1 === 0 && _onSeg(a, b, c)) return true;
  if (o2 === 0 && _onSeg(a, b, d)) return true;
  if (o3 === 0 && _onSeg(c, d, a)) return true;
  if (o4 === 0 && _onSeg(c, d, b)) return true;
  return false;
}
/** Do two non-adjacent edges of the (implicitly closed) ring cross or touch? */
export function polygonSelfIntersects(points) {
  const [lat0, lon0] = _centroidOf(points);
  const r = points.map(_projector(lat0, lon0));
  const n = r.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (_segmentsIntersect(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n])) return true;
    }
  }
  return false;
}

function _validatePoints(id, label, points) {
  if (!Array.isArray(points) || points.length < 3) return fail(`${id}: ${label} needs at least 3 points`);
  if (points.length > MAX_POLYGON_VERTICES) return fail(`${id}: ${label} has more than ${MAX_POLYGON_VERTICES} points`);
  for (const p of points) {
    if (!Array.isArray(p) || p.length !== 2 || !isLat(p[0]) || !isLon(p[1])) return fail(`${id}: every ${label} point must be [lat, lon] in decimal degrees`);
  }
  const first = points[0]; const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return fail(`${id}: ${label} must not repeat its first point at the end`);
  if (polygonSelfIntersects(points)) return fail(`${id}: ${label} crosses itself`);
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
  const cls = def.airspaceClass ?? null;
  if (cls !== null && !AIRSPACE_CLASSES.includes(cls)) return fail(`${id}: airspaceClass must be one of ${AIRSPACE_CLASSES.join(', ')}, or absent for unclassified airspace`);
  const vfr = def.vfrService ?? null;
  if (vfr !== null && !VFR_SERVICES.includes(vfr)) return fail(`${id}: vfrService must be one of ${VFR_SERVICES.join(', ')}`);
  if (vfr !== null && (cls === 'A' || cls === 'G')) return fail(`${id}: Class ${cls} airspace has no VFR service: vfrService must be absent`);
  if (vfr === null && cls === null) return fail(`${id}: an unclassified area must name its vfrService (${VFR_SERVICES.join(', ')})`);
  const owners = def.ownerPositionIds;
  if (!Array.isArray(owners) || owners.length > MAX_OWNER_POSITIONS || !owners.every(isStr) || new Set(owners).size !== owners.length) {
    return fail(`${id}: ownerPositionIds must be a list of at most ${MAX_OWNER_POSITIONS} different Position ids`);
  }
  if (cls === 'G' && owners.length) return fail(`${id}: Class G airspace belongs to nobody: ownerPositionIds must be empty`);
  if (cls !== 'G' && !owners.length) return fail(`${id}: ${cls ? `a Class ${cls}` : 'an unclassified'} area needs at least one owner Position`);
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
  out.airspaceClass = cls;
  out.vfrService = vfr;
  out.excludes = [...ex];
  out.sourceText = def.sourceText ?? null;
  return null;
}

/** The envelope of a route's legs: min of the lows, max of the highs. A null low is the surface, a null high is unbounded. */
export function deriveRouteEnvelope(segments) {
  const legs = segments.slice(0, -1);
  const lows = legs.map(l => (l.altLowerFt == null ? null : l.altLowerFt));
  const highs = legs.map(l => (l.altUpperFt == null ? null : l.altUpperFt));
  return {
    altLowerFt: lows.some(v => v === null) ? null : Math.min(...lows),
    altUpperFt: highs.some(v => v === null) ? null : Math.max(...highs),
  };
}

/**
 * Validates ONE definition, purely (the server's `validateAirspaceDefinition`, same order, same words). A normalised
 * copy comes back: every optional field present (null when empty), a ROUTE's altitudes derived from its segments.
 * @param {object} def
 * @param {{derived?:'refuse'|'recompute'}} [ctx]
 * @returns {{ok:true, definition:object}|{ok:false, reason:'VALIDATION_ERROR', detail:string}}
 */
export function validateAirspaceDefinition(def, { derived = 'refuse' } = {}) {
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
    if (!types.includes(def.type)) return fail(`${id} has unknown ${kind} type ${JSON.stringify(def.type)}`);
    const only = JURISDICTION_ONLY_FIELDS.find(f => def[f] !== undefined);
    if (only) return fail(`${id}: ${only} belongs to a JURISDICTION area`);
  }
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
 * The hard reference check (the store's `checkReferences`): the controlling Facility exists and names the controlling
 * Position; a using Facility exists and is neither the controlling Facility nor RANGES; a using Position is not already
 * a Position of a shipped Facility.
 * @param {object} def a validated definition
 * @param {{hasFacility:(id:string)=>boolean, positionsOf:(facilityId:string)=>string[], facilityOfPosition:(positionId:string)=>string|null}} lookup
 * @returns {{ok:false, reason:string, detail:string}|null}
 */
export function checkAirspaceReferences(def, lookup) {
  const id = def.airspaceId;
  if (!lookup.hasFacility(def.controllingFacilityId)) return fail(`${id}: controllingFacilityId ${def.controllingFacilityId} is not a configured Facility`);
  if (!lookup.positionsOf(def.controllingFacilityId).includes(def.controllingPositionId)) {
    return fail(`${id}: ${def.controllingPositionId} is not a Position of ${def.controllingFacilityId}`);
  }
  if (def.usingFacilityId) {
    if (!lookup.hasFacility(def.usingFacilityId)) return fail(`${id}: usingFacilityId ${def.usingFacilityId} is not a configured Facility`);
    if (def.usingFacilityId === def.controllingFacilityId) return fail(`${id}: the using Facility cannot be the controlling Facility`);
    if (def.usingFacilityId === 'RANGES') return fail(`${id}: the using Facility cannot be RANGES (name a usingPositionId instead)`);
  }
  if (def.usingPositionId) {
    const home = lookup.facilityOfPosition(def.usingPositionId);
    if (home && home !== 'RANGES') return fail(`${id}: ${def.usingPositionId} is already a Position of ${home}; a range-control Position needs an id of its own`);
  }
  if (def.kind === 'JURISDICTION') {
    const own = lookup.positionsOf(def.controllingFacilityId);
    const stranger = (def.ownerPositionIds || []).find(p => !own.includes(p));
    if (stranger) return fail(`${id}: owner ${stranger} is not a Position of ${def.controllingFacilityId}`);
    const hullId = def.geometry && def.geometry.centre && def.geometry.centre.hullId;
    if (hullId && lookup.hasHull && !lookup.hasHull(hullId)) return fail(`${id}: hull ${hullId} is not a configured carrier hull`);
  }
  return null;
}

/**
 * What changed between two definitions, field by field, in DEFINITION_FIELDS order: [{ field, from, to }] (null for empty).
 * The shape of a `definitionHistory` entry's `changes` (ADR 0098 §4).
 */
export function diffDefinitions(from, to) {
  const a = from || {}; const b = to || {};
  const same = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  return DEFINITION_FIELDS.filter(f => !same(a[f], b[f])).map(f => ({ field: f, from: a[f] ?? null, to: b[f] ?? null }));
}
