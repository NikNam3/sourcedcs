'use strict';

// The airspace-entry alert (docs/adr/0119; H132, H134 LT-Q5 a, LT-RQ14 a, H136 VQ4 b): an aircraft INSIDE an ACTIVE
// airspace it may not be in, now. The FAA's nearest equivalent is ERAM's EDST aircraft-to-airspace alert (JO 7110.65BB
// para 13-1-1, 13-1-2; P/CG AIRSPACE CONFLICT), which is PREDICTIVE (a trajectory probe against active SAA); ours fires on
// actual containment only, and is not limited to en route. Both alert only for ACTIVE airspace.
//
// BY TYPE, as the FAA (this makes the airspace `type` behavioural for the first time):
//   - RESTRICTED, PROHIBITED, and our RANGE and DANGER (restricted-like, an inference from the research): any aircraft
//     inside without an approved entry alerts. Entry needs the using agency's permission (14 CFR 73.13, 73.15 (c)(2),
//     91.133 (a); JO 7110.65BB para 9-3-1 a-b).
//   - MOA and WARNING: a tracked VFR aircraft (a correlated flight with no assigned altitude or heading, vfr.js) never
//     alerts: VFR aircraft are not denied access (JO 7400.2R para 25-1-6 a, 24-1-3 d). A tracked IFR aircraft without an
//     approved entry alerts (ours: the FAA routes IFR through by LOA, para 25-1-6 a-b, and an unapproved one is a
//     nonparticipant ATC separates from the area, para 9-3-2).
//   - An UNTRACKED contact inside any ACTIVE area alerts (H134 LT-Q5 a; supervisor's reading of H136), but only one that
//     reports altitude: the MCI rule (H136 VQ8 a), and an airspace has vertical limits a primary-only target cannot be
//     placed against by the controller (ours). An uncorrelated wingman of a tracked formation is that flight's
//     (conflict-alert.js's formation members, ADR 0118), never an intruder.
//   - A ROUTE (MTR) never alerts: it is no area an aircraft is denied (ours).
//
// APPROVED (para 9-3-1 a-b): a live Strip of the flight working that airspace (`airspaceEntry`, ApproveAirspaceEntry),
// the flight data's `comms.airspaceId`, or an MRU's TOFI for a Facility that uses the airspace (accepted or effective,
// ADR 0102; ours: the MRU is the using agency taking the flight).
//
// DELIVERED to the airspace's controlling Position and to every Position holding a live Strip of the flight
// (`deliverableTo`, asked per session by the hub like conflict-alert.js's MCI; never sent). Amber in the label,
// acknowledged by a click on the target (client-side, like CA), retracted when the aircraft leaves or is approved.
// Not alerted: a track slower than `minGroundSpeedKt` (on the ground, or hovering; ours) or younger than `minTrackAgeSec`.
//
// THE AIRSPACE CARD'S FLIGHT LIST (docs/adr/0124 §1, H140 LT-AQ1 b): the same tick also lists, per airspace an entry
// approval means something for (restricted-like, MOA, warning), every tracked flight INSIDE it (what the alert sees,
// approved or VFR or not) and every live flight FILED through it. "Filed through" has no route geometry to test (a filed
// route is text, nothing resolves it to points): a live Strip already approved in it, the flight data's working airspace,
// or the filed route naming the airspace by its id or name (ours, logged as a default). Each row says whether the flight
// is inside, filed, approved and alerting, and names its live Strips, so the client can send ApproveAirspaceEntry on one
// (same rights and refusals). Sent only to a session holding the airspace's using agency or controlling Position
// (`trafficFor`); an untracked contact has no Strip and is not listed (ADR 0119 stands).

const { hasNoClearance } = require('./vfr');
const { MS_PER_KT } = require('../units');

const AIRBORNE_CATEGORIES = new Set([1, 2]); // airplane, helicopter
const RESTRICTED_LIKE = new Set(['RESTRICTED', 'PROHIBITED', 'RANGE', 'DANGER']);
const JOINT_USE = new Set(['MOA', 'WARNING']);
// docs/adr/0124 §1: the airspace types whose card lists the flights an entry approval is for.
const ENTRY_TYPES = new Set([...RESTRICTED_LIKE, ...JOINT_USE]);

function _escapeRe(text) { return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Does the filed route text name this airspace (its id or name, as whole words, any case)? docs/adr/0124 §1. */
function routeNames(route, airspace) {
  if (!route || typeof route !== 'string') return false;
  return [airspace.airspaceId, airspace.name].filter(n => typeof n === 'string' && n.trim().length >= 2)
    .some(n => new RegExp(`(^|[\\s,/])${_escapeRe(n.trim())}($|[\\s,/])`, 'i').test(route));
}

/**
 * Does this aircraft alert in this airspace? `tracked` false: an untracked contact (reporting altitude, checked by the
 * caller). Pure: the whole by-type rule.
 * @param {{type:string}} airspace
 * @param {{tracked:boolean, approved?:boolean, vfr?:boolean}} aircraft
 */
function alertsIn(airspace, { tracked, approved = false, vfr = false }) {
  if (!tracked) return true;
  if (approved) return false;
  if (JOINT_USE.has(airspace.type)) return !vfr;
  return RESTRICTED_LIKE.has(airspace.type);
}

class AirspaceEntryAlertMonitor {
  /**
   * @param {object} deps
   * @param {{getAll: () => object[]}} deps.trackStore
   * @param {{activeAreasContaining: (point:object) => object[], isActiveFor: (airspaceId:string, facilityId:string) => boolean}} deps.airspaceStore
   * @param {(track:object) => ({lat:number, lon:number, altFt:number}|null)} deps.locate the track in indicated feet
   * @param {() => Map<string, string>} deps.trackedFlights trackId -> flightDataId, every tracked (correlated) contact
   * @param {() => Map<string, string>} [deps.formationMembers] trackId -> flightDataId, the uncorrelated wingmen (ADR 0118)
   * @param {(flightDataId:string) => object|null} deps.flightDataOf
   * @param {() => Map<string, {facilityId:string, positionId:string, airspaceId:string|null}[]>} deps.liveStrips the live
   *   Strips of every flight: flightDataId -> each Strip's Facility, owner and working airspace
   * @param {(track:object) => boolean} deps.reportsAltitude
   * @param {(track:object) => string|null} [deps.callsignFor]
   * @param {{now: () => number}} deps.clock the mission clock (`since`)
   * @param {{now: () => number}} deps.wallClock the track age (tracks.js stamps `firstSeenAt` in wall time)
   * @param {{minGroundSpeedKt:number, minTrackAgeSec:number}} deps.config alerting.json `airspaceEntry`
   */
  constructor(deps) {
    this._d = deps;
    this._alerts = [];
    this._to = new Map();    // alert id -> Set of 'facilityId:positionId'
    this._since = new Map(); // alert id -> since
    this._traffic = [];      // docs/adr/0124 §1: [{airspaceId, flights:[...]}], the airspace card's list
    this._trafficOf = new Map(); // airspaceId -> {controllingFacilityId, controllingPositionId}, for `trafficFor`
  }

  getAll() { return this._alerts; }

  /** Every airspace's card list, whoever may see it (tests, QA); the hub sends `trafficFor`. */
  getTraffic() { return this._traffic; }

  /**
   * docs/adr/0124 §1: the card lists of the airspaces a session holding `positions` ([{facilityId, positionId}]) may
   * approve entry into: as the using agency (`airspaceStore.isUsingAgency`) or as the controlling Position. [] otherwise.
   */
  trafficFor(positions) {
    const held = positions || [];
    if (held.length === 0) return [];
    return this._traffic.filter((t) => {
      const c = this._trafficOf.get(t.airspaceId) || {};
      return held.some(p => (p.facilityId === c.controllingFacilityId && p.positionId === c.controllingPositionId)
        || this._d.airspaceStore.isUsingAgency(t.airspaceId, p.positionId));
    });
  }

  /** Whether an alert is for a session holding `positions` ([{facilityId, positionId}]). */
  deliverableTo(alert, positions) {
    const to = alert && this._to.get(alert.id);
    return !!to && (positions || []).some(p => to.has(`${p.facilityId}:${p.positionId}`));
  }

  _eligible(track, now) {
    const cfg = this._d.config || {};
    if (!AIRBORNE_CATEGORIES.has(track.category)) return false;
    if (!Number.isFinite(track.groundSpeed) || track.groundSpeed < (cfg.minGroundSpeedKt ?? 50) * MS_PER_KT) return false;
    if (track.firstSeenAt && now - track.firstSeenAt < (cfg.minTrackAgeSec ?? 10) * 1000) return false;
    return true;
  }

  _approved(flightDataId, airspace, strips) {
    if (strips.some(s => s.airspaceId === airspace.airspaceId)) return true;
    const fd = this._d.flightDataOf(flightDataId);
    if (!fd) return false;
    if (fd.comms && fd.comms.airspaceId === airspace.airspaceId) return true;
    const tofi = fd.tofi || {};
    const mru = tofi.pendingFacilityId || (tofi.regimeEffective && tofi.separationRegime && tofi.separationRegime !== 'ATC' ? tofi.regimeEffective.facilityId : null);
    return !!mru && this._d.airspaceStore.isActiveFor(airspace.airspaceId, mru);
  }

  /** @returns {boolean} whether the alert set changed */
  tick() {
    const wallNow = this._d.wallClock.now();
    const { trackStore, airspaceStore, locate, trackedFlights, formationMembers, reportsAltitude, callsignFor, clock } = this._d;
    const flights = trackedFlights();
    const members = formationMembers ? formationMembers() : new Map();
    const liveStrips = this._d.liveStrips();
    const byId = new Map(); // alert id -> alert
    const to = new Map();
    const traffic = new Map(); // airspaceId -> Map(flightDataId -> row), docs/adr/0124 §1
    const trafficOf = new Map();
    const rowFor = (airspace, flightDataId, callsign) => {
      if (!traffic.has(airspace.airspaceId)) traffic.set(airspace.airspaceId, new Map());
      trafficOf.set(airspace.airspaceId, { controllingFacilityId: airspace.controllingFacilityId || null, controllingPositionId: airspace.controllingPositionId || null });
      const rows = traffic.get(airspace.airspaceId);
      if (!rows.has(flightDataId)) {
        const fd = this._d.flightDataOf(flightDataId);
        const strips = liveStrips.get(flightDataId) || [];
        rows.set(flightDataId, {
          flightDataId,
          callsign: (fd && fd.identity && fd.identity.callsign) || callsign || null,
          inside: false, filed: false,
          approved: this._approved(flightDataId, airspace, strips),
          alerting: false,
          strips: strips.filter(s => s.stripId).map(s => ({ facilityId: s.facilityId, stripId: s.stripId, positionId: s.positionId })),
        });
      }
      return rows.get(flightDataId);
    };
    for (const track of trackStore.getAll()) {
      if (!this._eligible(track, wallNow)) continue;
      const trackId = String(track.id);
      const flightDataId = flights.get(trackId) || members.get(trackId) || null;
      if (!flightDataId && !reportsAltitude(track)) continue;
      const point = locate(track);
      if (!point) continue;
      const inside = airspaceStore.activeAreasContaining(point);
      if (inside.length === 0) continue;
      const strips = flightDataId ? (liveStrips.get(flightDataId) || []) : [];
      const vfr = flightDataId ? hasNoClearance(this._d.flightDataOf(flightDataId)) : false;
      for (const airspace of inside) {
        // The card list: a tracked flight inside, whatever the alert decides (the lead's track names it).
        if (flightDataId && ENTRY_TYPES.has(airspace.type)) {
          const row = rowFor(airspace, flightDataId, callsignFor ? callsignFor(track) : null);
          row.inside = true;
        }
        if (!alertsIn(airspace, { tracked: !!flightDataId, approved: flightDataId && this._approved(flightDataId, airspace, strips), vfr })) continue;
        // One alert per flight and airspace (a formation's wingmen are the flight), one per untracked contact.
        const id = flightDataId ? `F:${flightDataId}:${airspace.airspaceId}` : `T:${trackId}:${airspace.airspaceId}`;
        if (byId.has(id) && flights.get(trackId) !== flightDataId) continue; // the lead's own track names the alert
        byId.set(id, {
          id, kind: 'AIRSPACE_ENTRY', trackId, flightDataId,
          callsign: callsignFor ? callsignFor(track) : null,
          airspaceId: airspace.airspaceId, airspaceName: airspace.name || airspace.airspaceId, airspaceType: airspace.type,
          since: this._since.get(id) ?? clock.now(),
        });
        const keys = new Set();
        if (airspace.controllingFacilityId && airspace.controllingPositionId) keys.add(`${airspace.controllingFacilityId}:${airspace.controllingPositionId}`);
        for (const s of strips) keys.add(`${s.facilityId}:${s.positionId}`);
        to.set(id, keys);
      }
    }
    const next = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // docs/adr/0124 §1: the flights filed through each airspace (see the module comment for what "filed" can mean).
    const all = typeof airspaceStore.getAll === 'function' ? airspaceStore.getAll() : [];
    for (const record of all) {
      const def = record.definition || {};
      if (def.kind === 'ROUTE' || !ENTRY_TYPES.has(def.type)) continue;
      const airspace = {
        airspaceId: record.airspaceId, name: def.name, type: def.type,
        controllingFacilityId: def.controllingFacilityId || null, controllingPositionId: def.controllingPositionId || null,
      };
      for (const [flightDataId, strips] of liveStrips) {
        const fd = this._d.flightDataOf(flightDataId);
        const filed = strips.some(s => s.airspaceId === airspace.airspaceId)
          || !!(fd && fd.comms && fd.comms.airspaceId === airspace.airspaceId)
          || !!(fd && fd.filed && routeNames(fd.filed.route, airspace));
        if (filed) rowFor(airspace, flightDataId, null).filed = true;
      }
    }
    for (const [airspaceId, rows] of traffic) {
      for (const row of rows.values()) row.alerting = byId.has(`F:${row.flightDataId}:${airspaceId}`);
    }
    const nextTraffic = [...traffic.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([airspaceId, rows]) => ({
        airspaceId,
        flights: [...rows.values()].sort((a, b) => String(a.callsign || a.flightDataId).localeCompare(String(b.callsign || b.flightDataId))),
      }));
    const changed = JSON.stringify(next) !== JSON.stringify(this._alerts)
      || JSON.stringify(nextTraffic) !== JSON.stringify(this._traffic)
      || [...to].some(([id, keys]) => { const was = this._to.get(id); return !was || was.size !== keys.size || [...keys].some(k => !was.has(k)); });
    this._alerts = next;
    this._traffic = nextTraffic;
    this._trafficOf = trafficOf;
    this._to = to;
    this._since = new Map(next.map(a => [a.id, a.since]));
    return changed;
  }
}

module.exports = { AirspaceEntryAlertMonitor, alertsIn, routeNames, RESTRICTED_LIKE, JOINT_USE, ENTRY_TYPES };
