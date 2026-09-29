'use strict';

// Which radars a controller is looking through (docs/adr/0042, docs/adr/0043).
//
// Coverage follows the Positions you hold. That is the inverse of what
// docs/adr/0033 rejected: 0033 refused to derive Positions FROM radar
// selection, partly because Ground and Clearance Delivery have no radar at
// all, and partly because "coupling authority to visibility means a controller
// silently acquires or loses the right to act on Strips by adjusting their
// display". Running the arrow the other way removes that hazard rather than
// reintroducing it — visibility becomes a consequence of a deliberate
// declaration of authority, and nothing here touches how a Position is
// acquired, so docs/adr/0029's session binding is untouched.
//
// Held, not Primary. §4.8.2 rule 3 makes a second controller at an occupied
// Position an Observer, and an Observer watches — so holding a Position gets
// you its picture whether or not you are the one who may act on its Strips.
//
// A controller holding no radar-bearing Position gets an empty set, and the
// client says so out loud rather than showing a blank map. A Ground controller
// has no scope; that is the answer.
//
// The datalink rides the same selectors, as `{kind: 'datalink'}`
// (docs/adr/0059). It is not a radar — it matches none — and a Position that
// has it gets the datalink feed (surveillance/datalink.js) alongside whatever
// radars it looks through.

const { USER_COALITION } = require('../surveillance/iff');

// The Position classes that separate traffic and so get short-term conflict
// alerts (docs/adr/0059). The tactical side does not: military positions and
// radars do not do collision avoidance the way ATC does.
const ATC_CLASSES = new Set(['MILITARY_ATC', 'CIVIL_ATC']);

/**
 * Does one radar match one selector?
 *
 * Selectors name what a radar IS, never its id — a radar id is derived from
 * whatever mission is loaded, so a persisted id list would be the inclusion
 * list docs/adr/0041 condemned, in a new costume.
 */
function selectorMatches(selector, radar, { ownCoalition = USER_COALITION } = {}) {
  if (!selector || selector.kind !== radar.type) return false;

  if (selector.airport) {
    if (selector.airport === '*') {
      // Every airfield in the theater. An airborne radar has no airport at
      // all, so this correctly matches nothing among them.
      if (!radar.airport) return false;
    } else {
      const wanted = String(selector.airport).toUpperCase();
      const icao = (radar.airportIcao || '').toUpperCase();
      const name = (radar.airport || '').toUpperCase();
      if (icao !== wanted && name !== wanted) return false;
    }
  }

  if (selector.coalition === 'own' && radar.coalition !== ownCoalition) return false;

  return true;
}

/**
 * The radar ids a set of selectors resolves to against the radars that
 * actually exist right now.
 *
 * @returns {Set<string>}
 */
function resolveSelectors(selectors, radars, opts) {
  const out = new Set();
  for (const selector of selectors || []) {
    for (const radar of radars || []) {
      if (selectorMatches(selector, radar, opts)) out.add(radar.id);
    }
  }
  return out;
}

class StationCoverage {
  /**
   * @param {object} deps
   * @param {object} deps.facilityConfig
   * @param {(facilityId:string)=>object|null} deps.positionStoreFor
   * @param {()=>Array} deps.radars — the live radar list. A function rather
   *   than an array because the list changes every time an AWACS takes off,
   *   and this object outlives any one of them.
   */
  constructor({ facilityConfig, positionStoreFor, radars }) {
    this._facilityConfig = facilityConfig;
    this._positionStoreFor = positionStoreFor;
    this._radars = radars;
  }

  /**
   * Every Position this controller holds, across every Facility, as
   * `{facilityId, positionId, isPrimary}`.
   */
  heldPositions(controllerId) {
    const held = [];
    for (const facilityId of this._facilityConfig.getFacilityIds()) {
      const store = this._positionStoreFor(facilityId);
      if (!store) continue;
      for (const positionId of store.heldBy(controllerId)) {
        held.push({ facilityId, positionId, isPrimary: store.primaryOf(positionId) === controllerId });
      }
    }
    return held;
  }

  /**
   * The full coverage picture for one controller.
   *
   * Returns the radar records rather than just ids, because the client renders
   * a list of them (label, type, range) and draws the debug beam from their
   * geometry — everything the deleted radar selector used to derive locally.
   * Each record carries `grantedBy`, the Position that put it there, so the
   * panel can answer "why am I seeing this".
   *
   * @returns {{radars:Array, radarIds:Set<string>, heldPositions:Array,
   *            radarBearingPositions:Array<string>, datalink:boolean, stca:boolean}}
   */
  forController(controllerId) {
    const radars = this._radars() || [];
    const byId = new Map(radars.map(r => [r.id, r]));
    const held = this.heldPositions(controllerId);
    const opts = { ownCoalition: USER_COALITION };

    const grantedBy = new Map(); // radarId -> [positionId]
    const radarBearingPositions = [];
    let datalink = false;

    for (const { facilityId, positionId } of held) {
      const selectors = this._facilityConfig.getPositionRadars(positionId, facilityId);
      if (!selectors.length) continue;
      if (selectors.some(s => s.kind === 'datalink')) datalink = true;
      radarBearingPositions.push(positionId);
      for (const radarId of resolveSelectors(selectors, radars, opts)) {
        const list = grantedBy.get(radarId);
        if (list) list.push(positionId);
        else grantedBy.set(radarId, [positionId]);
      }
    }

    const out = [];
    for (const [radarId, positions] of grantedBy) {
      const radar = byId.get(radarId);
      if (radar) out.push({ ...radar, grantedBy: positions });
    }
    // Stable order so a client diffing two coverage messages sees a real
    // change rather than a reshuffle.
    out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    return {
      radars: out,
      radarIds: new Set(out.map(r => r.id)),
      heldPositions: held,
      radarBearingPositions,
      datalink,
      stca: held.some(p => ATC_CLASSES.has(this._facilityConfig.getPositionClass(p.positionId))),
    };
  }

  /**
   * The union of every occupied Position's coverage — the radars somebody is
   * actually looking through. coverage.js sweeps this rather than every radar
   * in the theater, so an unattended airfield's radar costs nothing.
   */
  activeRadars() {
    const radars = this._radars() || [];
    const opts = { ownCoalition: USER_COALITION };
    const wanted = new Set();

    for (const facilityId of this._facilityConfig.getFacilityIds()) {
      const store = this._positionStoreFor(facilityId);
      if (!store) continue;
      for (const positionId of this._facilityConfig.getPositionSet(facilityId)) {
        if (!store.isOccupied(positionId)) continue;
        const selectors = this._facilityConfig.getPositionRadars(positionId, facilityId);
        for (const radarId of resolveSelectors(selectors, radars, opts)) wanted.add(radarId);
      }
    }

    return radars.filter(r => wanted.has(r.id));
  }
}

/**
 * Every radar any Position's selectors resolve to, whether or not anybody is
 * on position — the set worth pre-fetching terrain for.
 *
 * Distinct from StationCoverage.activeRadars(), which is scoped to OCCUPIED
 * Positions: a controller taking Approach mid-session must not then wait for
 * a DEM. This is "could anyone ever look through it in this theater", which in
 * a 225-airfield map is a handful rather than 450.
 */
function assignableRadars(facilityConfig, radars, opts) {
  const wanted = new Set();
  for (const facilityId of facilityConfig.getFacilityIds()) {
    const config = facilityConfig.getFacilityConfig(facilityId);
    for (const selectors of Object.values(config.positionRadars || {})) {
      for (const radarId of resolveSelectors(selectors, radars, opts)) wanted.add(radarId);
    }
  }
  return (radars || []).filter(r => wanted.has(r.id));
}

/**
 * Reports selectors that resolved to nothing against the theater that is
 * actually loaded.
 *
 * Deliberately called on mission load rather than at construction, because at
 * construction there is no theater to check against — an earlier version ran
 * at startup and could only print "this will have no coverage in a theater
 * without that airfield" for every selector unconditionally, which is noise
 * on every boot and is how a real warning gets ignored.
 *
 * Warns rather than throwing, the _validateAirspaceReferences precedent: a
 * selector naming an airfield this map lacks is legitimate config, since the
 * same file has to work across theaters.
 */
function reportUnresolvedSelectors(facilityConfig, radars, opts) {
  const unresolved = [];
  for (const facilityId of facilityConfig.getFacilityIds()) {
    const config = facilityConfig.getFacilityConfig(facilityId);
    for (const [positionId, selectors] of Object.entries(config.positionRadars || {})) {
      for (const selector of selectors) {
        if (selector.kind === 'datalink') continue; // a network, not a radar in the theater
        if (resolveSelectors([selector], radars, opts).size > 0) continue;
        const where = selector.airport ? ` at ${selector.airport}` : '';
        unresolved.push(`${facilityId}/${positionId} wants ${selector.kind}${where}`);
      }
    }
  }
  if (unresolved.length) {
    console.warn(`[efsp] ${unresolved.length} radar selector(s) match nothing in this theater, so those Positions have no coverage: ${unresolved.join('; ')}`);
  }
  return unresolved;
}

module.exports = {
  StationCoverage, selectorMatches, resolveSelectors, ATC_CLASSES,
  assignableRadars, reportUnresolvedSelectors,
};
