'use strict';

// Stereo routes — the local canned-route table (EFSPImplementationGuide.md
// §9.10, docs/adr/0050). "Implement a local canned-route table keyed by
// short name, resolvable to a full route, with a filing path that does not
// require a full flight-plan form. This is verified real practice: assigned
// aircraft at Kunsan file locally-defined 'Pack' routes by phone or email
// without the international form [Annex §12]."
//
// Static squadron configuration, loaded once at require time, same
// load-or-default/validate/persist pattern as airspace-config.js. §8.2 lists
// "Routes | Stereo/canned route table" under what MUST be configurable, and
// §8.1 is blunt about why: "the configurability is the specification."
//
// **Ships empty**, exactly as airspace-config.js does and for the same
// reason: the real Pack routes are squadron data the project owner supplies,
// and an invented "PACK 1 out of Incirlik" would be the
// [SOURCE-DEFINED]-presented-as-doctrine trap defect D11 names — which WP6's
// own acceptance list makes an audit criterion in its own right. See
// docs/efsp-usage-guide.md §4A for the shape and the three install paths.
//
// **Names are normalised for lookup but stored verbatim.** The guide writes
// the example name as "PACK 1"; a controller types `PACK1`, `.stereo pack1`,
// or `PACK-1`. Resolution therefore keys on a normalised form (uppercase,
// whitespace and hyphens stripped) while `name` keeps whatever the squadron
// wrote, which is what gets displayed on the Strip. Two records whose names
// normalise to the same key is a VALIDATION_ERROR rather than last-one-wins:
// that collision is the entire reason the normaliser exists, so silently
// picking a winner would defeat it.
//
// **A stereo name is local symbology.** Guide §8.3 rule 5: "Local symbology
// defined in configuration MUST be marked local-only and MUST NOT appear in
// any inter-facility message." That is why expansion happens once, at filing
// time, into fdr.filed.route — a Strip replicated to CENTER carries the
// expanded route, never the short name as its route.

const fs = require('fs');
const { statePaths, ensureDirFor } = require('../state-paths');

// Squadron data a live edit would rewrite (setStereoRoutes), so it reads from
// state/ if a live copy exists and always writes there — see state-paths.js
// and docs/adr/0048 for why that split exists at all.
const { read: STEREO_ROUTES_PATH, write: STEREO_ROUTES_WRITE_PATH } =
  statePaths('efsp-stereo-routes.json', process.env.CRCSYNC_EFSP_STEREO_ROUTES_PATH);

// The same ceiling fdr-store.js puts on controller-entered free text, and for
// the same reason: a stereo route seeds an FDR, and an FDR is broadcast whole
// to every connected client on every subsequent change (docs/adr/0004's
// immediate broadcast) and sits in the durable snapshot forever. Duplicated
// rather than imported to keep the require direction one-way — fdr-store.js
// requires this module, not the reverse.
const MAX_FREE_TEXT = 2000;

const OPTIONAL_STRING_FIELDS = [
  'description', 'departureAirport', 'destinationAirport', 'requestedAltitude', 'remarks',
];

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * The lookup key for a stereo route name. Uppercase, with whitespace and
 * hyphens removed, so "PACK 1", "pack1" and "PACK-1" are one route.
 *
 * crc-desktop keeps its own copy of this in efsp-state.js rather than
 * importing it — the two packages are separately deployed with separate
 * Docker build contexts, the same reason docs/adr/0001 keeps the Block Maps
 * as literal duplicates instead of a shared import.
 */
function normalizeStereoName(name) {
  return String(name == null ? '' : name).toUpperCase().replace(/[\s-]+/g, '');
}

/**
 * @param {unknown} candidate
 * @returns {{ok:true}|{ok:false, reason:'VALIDATION_ERROR', detail:string}}
 */
function validateStereoRoutes(candidate) {
  if (!Array.isArray(candidate)) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: 'stereo routes config must be an array' };
  }
  const seen = new Map(); // normalised key -> the name that claimed it, for a useful collision message
  for (const r of candidate) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'each stereo route must be an object' };
    }
    if (!r.name || typeof r.name !== 'string' || !r.name.trim()) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'each stereo route needs a non-empty string name' };
    }
    const key = normalizeStereoName(r.name);
    if (!key) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${JSON.stringify(r.name)} normalises to an empty name` };
    }
    if (seen.has(key)) {
      return {
        ok: false, reason: 'VALIDATION_ERROR',
        detail: `${JSON.stringify(r.name)} and ${JSON.stringify(seen.get(key))} are the same route once normalised (${key})`,
      };
    }
    seen.set(key, r.name);
    // The expansion is the whole point of the record — a stereo with no route
    // resolves to nothing and would produce exactly the incomplete FDR WP6's
    // acceptance criterion exists to rule out.
    if (!r.route || typeof r.route !== 'string' || !r.route.trim()) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${r.name} needs a non-empty route` };
    }
    for (const key2 of ['name', 'route', ...OPTIONAL_STRING_FIELDS]) {
      const value = r[key2];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'string') {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: `${r.name}'s ${key2} must be a string` };
      }
      if (value.length > MAX_FREE_TEXT) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: `${r.name}'s ${key2} is limited to ${MAX_FREE_TEXT} characters` };
      }
    }
    if (r.active !== undefined && typeof r.active !== 'boolean') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${r.name}'s active must be a boolean when present` };
    }
  }
  return { ok: true };
}

// Ships empty — see this module's header for why an invented default would be
// defect D11 rather than a convenience.
const DEFAULT_STEREO_ROUTES = [];

function _load() {
  try {
    const onDisk = JSON.parse(fs.readFileSync(STEREO_ROUTES_PATH, 'utf8'));
    const check = validateStereoRoutes(onDisk);
    if (!check.ok) {
      console.warn('[efsp-stereo-routes] on-disk stereo routes failed validation, using defaults:', check.detail);
      return deepClone(DEFAULT_STEREO_ROUTES);
    }
    return onDisk;
  } catch (e) {
    console.warn('[efsp-stereo-routes] no stereo routes config loaded, using defaults:', e.message);
    return deepClone(DEFAULT_STEREO_ROUTES);
  }
}

let stereoRoutes = _load();

/** Every configured route, active or not — the editor/audit view. */
function getStereoRoutes() { return deepClone(stereoRoutes); }

/** Just the filable ones, which is what a picker should ever show. */
function getActiveStereoRoutes() {
  return deepClone(stereoRoutes.filter(r => r.active !== false));
}

/**
 * Looks a route up by short name, case- and spacing-insensitively.
 *
 * Returns the record INCLUDING its `active` flag rather than filtering
 * inactive routes out here: "does this name exist" and "may it be filed" are
 * two different questions, and the caller that refuses an inactive route
 * wants to say so specifically rather than report it as a typo.
 *
 * @returns {object|null} a clone, so a caller mutating the result cannot
 *   corrupt the table.
 */
function resolveStereoRoute(name) {
  const key = normalizeStereoName(name);
  if (!key) return null;
  const found = stereoRoutes.find(r => normalizeStereoName(r.name) === key);
  return found ? deepClone(found) : null;
}

/**
 * The flat FDR seed a resolved route expands to — deliberately the same key
 * set flight-plan-lookup.js's toFdrFiledSeed() produces, because the briefing
 * frames a stereo as "the same shape with a local table instead of an HTTP
 * lookup" and fdr-store.js's createFdr() seed is the shared contract.
 *
 * aircraftType/wakeCategory are absent, unlike the DD1801 seed: a canned
 * ROUTE says nothing about what airframe is flying it, and guessing would put
 * a wrong type on the Strip for every flight that files the route.
 */
function toFdrFiledSeed(route) {
  if (!route || typeof route !== 'object') return {};
  return {
    route: route.route || '',
    requestedAltitude: route.requestedAltitude || '',
    departureAirport: route.departureAirport || '',
    destinationAirport: route.destinationAirport || '',
    remarks: route.remarks || '',
  };
}

/**
 * Replaces the whole table (guide §8.4 — an explicit reload step, not a live
 * mutation). No editing UI calls this; it exists so one is additive later,
 * and so tests can exercise the load path — the same standing this function
 * has in airspace-config.js and facility-config.js.
 *
 * §8.4's "configuration changes MUST be versioned, attributed, and recorded"
 * is satisfied trivially while the only edit path is a file plus a restart.
 * An editor cannot just call this from a button: it has to bring versioning
 * and attribution with it. That debt is recorded in docs/adr/0050.
 */
function setStereoRoutes(next) {
  const check = validateStereoRoutes(next);
  if (!check.ok) return check;
  stereoRoutes = deepClone(next);
  try {
    ensureDirFor(STEREO_ROUTES_WRITE_PATH);
    fs.writeFileSync(STEREO_ROUTES_WRITE_PATH, JSON.stringify(stereoRoutes, null, 2));
  } catch (e) {
    console.warn('[efsp-stereo-routes] failed to persist stereo routes:', e.message);
  }
  return { ok: true };
}

module.exports = {
  getStereoRoutes, getActiveStereoRoutes, resolveStereoRoute, toFdrFiledSeed,
  setStereoRoutes, validateStereoRoutes, normalizeStereoName,
  MAX_FREE_TEXT,
};
