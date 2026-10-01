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
// `{ "hulls": [ HullConfig ] }`. A hull that fails validateHullConfig is dropped
// with a warning; an empty or unreadable file falls back to DEFAULT_HULL (the
// CVN-72 `UNION`, decisions H13/H26), so the carrier is never silently absent.
// v1 has one hull and one stack (H29); the keys allow more.

const fs = require('fs');
const { readPath } = require('../../state-paths');
const { DEFAULT_HULL, validateHullConfig } = require('./ship-state');

const CARRIERS_FILE = 'efsp-carriers.json';

function _load() {
  let list = null;
  try {
    const raw = JSON.parse(fs.readFileSync(readPath(CARRIERS_FILE, process.env.CRCSYNC_EFSP_CARRIERS_PATH), 'utf8'));
    if (Array.isArray(raw.hulls)) list = raw.hulls;
  } catch (e) {
    console.warn(`[efsp-carriers] no usable ${CARRIERS_FILE}, using the default hull:`, e.message);
  }
  const hulls = [];
  for (const h of list || []) {
    const v = validateHullConfig(h);
    if (v.ok) hulls.push(JSON.parse(JSON.stringify(h)));
    else console.warn(`[efsp-carriers] dropping a hull: ${v.detail}`);
  }
  if (!hulls.length) hulls.push(JSON.parse(JSON.stringify(DEFAULT_HULL)));
  return hulls;
}

const HULLS = _load();

/** Every configured hull (copies). */
function getHulls() { return JSON.parse(JSON.stringify(HULLS)); }
/** One hull by id, or null. */
function getHull(hullId) { const h = HULLS.find(x => x.hullId === hullId); return h ? JSON.parse(JSON.stringify(h)) : null; }
/** The hull v1 runs (H29: one hull, one stack). */
function getDefaultHull() { return JSON.parse(JSON.stringify(HULLS[0])); }

/**
 * Does this radar belong to this hull? By DCS unit name when the hull names one,
 * else by type; never by track id (ids re-mint, docs/adr/0045). A radar record
 * carries `unitName` and `shipType` (radars.js).
 */
function radarIsHull(hullId, radar) {
  const hull = HULLS.find(x => x.hullId === hullId);
  if (!hull || !radar) return false;
  if (hull.match.unitName) return radar.unitName === hull.match.unitName;
  return !!hull.match.type && radar.shipType === hull.match.type;
}

module.exports = { getHulls, getHull, getDefaultHull, radarIsHull, CARRIERS_FILE };
