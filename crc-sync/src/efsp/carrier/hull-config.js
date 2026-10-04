'use strict';

// The carrier hulls this server knows (docs/adr/0064 B1, docs/adr/0074).
//
// "Hull config is not facility config" (ADR 0064): which DCS ship is the
// squadron's carrier is data about the mission, not about a Facility's Positions
// and Bays, so it ships as config/efsp-carriers.json, read ONCE at startup and
// never written by code (decisions P5). A copy in state/ overrides it, and
// CRCSYNC_EFSP_CARRIERS_PATH points a test at a temp file, like every other
// config path in this package.
//
// `{ "hulls": [ HullConfig ] }`. A hull that fails validateHullConfig (angledDeckDeg
// missing, DATA-3) is a startup error naming the file and the hull, as is an unreadable file or one with no hull (DATA-2, H88: no code copy of the CVN-72 `UNION` hull,
// decisions H13/H26, is kept).
// v1 has one hull and one stack (H29); the keys allow more.

const fs = require('fs');
const { readPath } = require('../../state-paths');
const { validateHullConfig } = require('./ship-state');

const CARRIERS_FILE = 'efsp-carriers.json';

function _load() {
  const file = readPath(CARRIERS_FILE, process.env.CRCSYNC_EFSP_CARRIERS_PATH);
  let list;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(raw.hulls)) throw new Error('no "hulls" array');
    list = raw.hulls;
  } catch (e) {
    throw new Error(`[efsp-carriers] cannot read ${file}: ${e.message}`);
  }
  const hulls = [];
  for (const h of list) {
    const v = validateHullConfig(h);
    if (v.ok) hulls.push(JSON.parse(JSON.stringify(h)));
    else throw new Error(`[efsp-carriers] ${file}: ${v.detail}`);
  }
  if (!hulls.length) throw new Error(`[efsp-carriers] ${file} has no valid hull`);
  return hulls;
}

// Read on first use (createEfsp's carrier store asks for the hulls at start-up), not when this file is required.
let _hulls = null;
function hulls() { return _hulls || (_hulls = _load()); }

/** Every configured hull (copies). */
function getHulls() { return JSON.parse(JSON.stringify(hulls())); }
/** One hull by id, or null. */
function getHull(hullId) { const h = hulls().find(x => x.hullId === hullId); return h ? JSON.parse(JSON.stringify(h)) : null; }
/** The hull v1 runs (H29: one hull, one stack). */
function getDefaultHull() { return JSON.parse(JSON.stringify(hulls()[0])); }

/**
 * Does this radar belong to this hull? By DCS unit name when the hull names one,
 * else by type; never by track id (ids re-mint, docs/adr/0045). A radar record
 * carries `unitName` and `shipType` (radars.js).
 */
function radarIsHull(hullId, radar) {
  const hull = hulls().find(x => x.hullId === hullId);
  if (!hull || !radar) return false;
  if (hull.match.unitName) return radar.unitName === hull.match.unitName;
  return !!hull.match.type && radar.shipType === hull.match.type;
}

function _key(s) { return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }

/**
 * Which configured hull does a USMTF location (an ATO's DEPLOC/ARRLOC text) name?
 * A hull is named by its DCS unit name (UNION), its id (CVN-72), its label or its type (CVN_72),
 * on its own or as one word of the text ("USS UNION"); case, spaces, hyphens and underscores do
 * not matter. An airfield code never matches. `hullList` is for a caller that already holds the
 * hulls (the pure ATO module is handed them, docs/adr/0109). Returns a copy or null.
 */
function hullForLocation(text, hullList) {
  const list = hullList || hulls();
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return null;
  const words = new Set([_key(raw), ...raw.split(/[\s,;/]+/).map(_key).filter(Boolean)]);
  for (const h of list) {
    const keys = [h.hullId, h.label, h.match && h.match.unitName, h.match && h.match.type].map(_key).filter(Boolean);
    if (keys.some((k) => words.has(k))) return JSON.parse(JSON.stringify(h));
  }
  return null;
}

/** The code a hull goes by in the traffic count and on an ATO line: its DCS unit name, else its id. */
function hullCode(hull) { return hull ? String((hull.match && hull.match.unitName) || hull.hullId).toUpperCase() : null; }

module.exports = { getHulls, getHull, getDefaultHull, radarIsHull, hullForLocation, hullCode };
