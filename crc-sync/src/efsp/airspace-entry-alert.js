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
// the flight data's `comms.airspaceId`, an MRU's TOFI for a Facility that uses the airspace (accepted or effective,
// ADR 0102; ours: the MRU is the using agency taking the flight), or an APPROVED transit of it (docs/adr/0128: para 9-3-4,
// "permission has been granted to transit the area"). A requested or declined transit is not approved.
//
// DELIVERED to the airspace's controlling Position and to every Position holding a live Strip of the flight
// (`deliverableTo`, asked per session by the hub like conflict-alert.js's MCI; never sent). Amber in the label,
// acknowledged by a click on the target (client-side, like CA), retracted when the aircraft leaves or is approved.
// Not alerted: a track slower than `minGroundSpeedKt` (on the ground, or hovering; ours) or younger than `minTrackAgeSec`.
//
// THE AIRSPACE CARD'S FLIGHT LIST (docs/adr/0124 §1, H140 LT-AQ1 b): the same tick also lists, per airspace an entry
// approval means something for (restricted-like, MOA, warning), every tracked flight INSIDE it (what the alert sees,
// approved or VFR or not), every live flight FILED through it, and every flight with a transit of it (docs/adr/0128).
// "Filed through": a live Strip already approved in it, the flight data's working airspace, or the filed route's geometry
// crossing it (airspace/route-geometry.js, docs/adr/0128 §5, which replaced ADR 0124's name match). Each row says whether
// the flight is inside, filed, approved and alerting, its transit (state, who asked, who decided) and names its live
// Strips, so the client can send ApproveAirspaceEntry on one (same rights and refusals); a group of a transit type names
// its transit deciders. Sent only to a session holding the airspace's using agency or controlling Position (`trafficFor`);
// an untracked contact has no Strip and is not listed (ADR 0119 stands).
//
// THE STRIP'S "INSIDE" FACT (docs/adr/0134, H155 item 4): the same tick says, per live Strip with an `airspaceEntry`,
// whether its flight is airborne inside that Strip's approved airspace, WHATEVER the airspace's state (the store's
// `containing`, the same `containment.evaluate` as `activeAreasContaining`: lateral shape and vertical limits, against
// the same indicated feet). Airborne inside means a track that passes `_eligible` (airplane or helicopter, at least
// `minGroundSpeedKt`, at least `minTrackAgeSec` old: ours, the alert's own filters) and reports a finite altitude; a
// flight on the ground under the block, without a correlated track, or without an altitude is not inside (unknown is
// never inside). Any of the flight's tracks counts (its lead or a formation wingman, as the card list). The client
// colours the Strip's airspace badge amber only while inside and the airspace is not ACTIVE. Delivered per session to
// the Position holding the Strip (`insideFor`), never to anyone else.
//
// THE STRIP'S "COORDINATE" FACT (docs/adr/0136, H156 MTB-Q3): the same pass over the filed routes says, per live Strip,
// which ACTIVE transit-type areas (MOA, WARNING, RESTRICTED, and RANGE/DANGER as restricted: `TRANSIT_TYPES`) the flight's
// filed route crosses by geometry (route-geometry.js `filedThrough`) while the flight is IFR (vfr.js) and has no transit of
// that airspace (in any state: a decline is its own mark) and no approved entry (`_approved`: a Strip working it, the
// working airspace, an APPROVED transit, an MRU's TOFI). No time to the boundary: "nobody can accurately predict the 5
// minutes" (H156). The client draws a grey mark; it goes when a transit is requested, an entry approved, the airspace
// goes cold, or the route no longer crosses it. Delivered to the Strip's holder only (`coordinateFor`), as `insideFor`.

const { hasNoClearance } = require('./vfr');
const routeGeometry = require('./airspace/route-geometry');
const { TRANSIT_TYPES } = require('./authority/airspace');
const { MS_PER_KT } = require('../units');

const AIRBORNE_CATEGORIES = new Set([1, 2]); // airplane, helicopter
const RESTRICTED_LIKE = new Set(['RESTRICTED', 'PROHIBITED', 'RANGE', 'DANGER']);
const JOINT_USE = new Set(['MOA', 'WARNING']);
// docs/adr/0124 §1: the airspace types whose card lists the flights an entry approval is for.
const ENTRY_TYPES = new Set([...RESTRICTED_LIKE, ...JOINT_USE]);


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
   * @param {() => object|null} [deps.missionData] the DCS mission's nav points and airports (docs/adr/0128 route geometry)
   */
  constructor(deps) {
    this._d = deps;
    this._alerts = [];
    this._to = new Map();    // alert id -> Set of 'facilityId:positionId'
    this._since = new Map(); // alert id -> since
    this._traffic = [];      // docs/adr/0124 §1: [{airspaceId, flights:[...]}], the airspace card's list
    this._trafficOf = new Map(); // airspaceId -> {controllingFacilityId, controllingPositionId}, for `trafficFor`
    this._inside = [];       // docs/adr/0134: [{facilityId, stripId, airspaceId}], each Strip inside its approved airspace
    this._insideTo = new Map(); // 'facilityId:stripId' -> 'facilityId:positionId' of the Strip's holder
    this._insideKeys = new Set(); // 'facilityId:stripId:airspaceId' of `_inside`, for `isInside`
    this._coordinate = [];   // docs/adr/0136: [{facilityId, stripId, airspaceId, positionId}], a Strip's flight to coordinate
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

  /** Every live Strip whose flight is airborne inside its approved airspace (tests, QA); the hub sends `insideFor`. */
  getInside() { return this._inside; }

  /**
   * docs/adr/0134: is this Strip's flight airborne inside `airspaceId`, its approved airspace, on the last tick? The same fact
   * as `getInside()` (the badge's), read by the obligation monitor's UNACTIVATED_AIRSPACE_ENTRY (H161 V2-Q2 a).
   */
  isInside(facilityId, stripId, airspaceId) {
    return this._insideKeys.has(`${facilityId}:${stripId}:${airspaceId}`);
  }

  /** docs/adr/0134: the inside facts of the Strips a session holding `positions` ([{facilityId, positionId}]) holds. */
  insideFor(positions) {
    const held = new Set((positions || []).map(p => `${p.facilityId}:${p.positionId}`));
    if (held.size === 0) return [];
    return this._inside.filter(x => held.has(this._insideTo.get(`${x.facilityId}:${x.stripId}`)));
  }

  /** Every live Strip whose flight is filed through an ACTIVE transit-type area with nothing coordinated (tests, QA). */
  getCoordinate() { return this._coordinate.map(({ positionId, ...x }) => x); }

  /** docs/adr/0136: the coordinate facts of the Strips a session holding `positions` ([{facilityId, positionId}]) holds. */
  coordinateFor(positions) {
    const held = new Set((positions || []).map(p => `${p.facilityId}:${p.positionId}`));
    if (held.size === 0) return [];
    return this._coordinate.filter(x => held.has(`${x.facilityId}:${x.positionId}`)).map(({ positionId, ...x }) => x);
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
    if (typeof this._d.airspaceStore.approvedTransit === 'function' && this._d.airspaceStore.approvedTransit(airspace.airspaceId, flightDataId)) return true;
    const tofi = fd.tofi || {};
    const mru = tofi.pendingFacilityId || (tofi.regimeEffective && tofi.separationRegime && tofi.separationRegime !== 'ATC' ? tofi.regimeEffective.facilityId : null);
    return !!mru && this._d.airspaceStore.isActiveFor(airspace.airspaceId, mru);
  }

  /**
   * docs/adr/0134: marks each of the flight's live Strips with an approved airspace that contains `point` (any state).
   * No finite altitude: unknown, never inside.
   */
  _markInside(insideOf, point, strips) {
    const approved = strips.filter(s => s.airspaceId && s.stripId);
    if (approved.length === 0 || !Number.isFinite(point.altFt)) return;
    if (typeof this._d.airspaceStore.containing !== 'function') return;
    const containing = new Set(this._d.airspaceStore.containing(point).map(a => a.airspaceId));
    for (const s of approved) {
      if (!containing.has(s.airspaceId)) continue;
      insideOf.set(`${s.facilityId}:${s.stripId}`, { facilityId: s.facilityId, stripId: s.stripId, airspaceId: s.airspaceId, positionId: s.positionId });
    }
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
    const insideOf = new Map(); // docs/adr/0134: 'facilityId:stripId' -> {facilityId, stripId, airspaceId, positionId}
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
          transit: null, // docs/adr/0128: filled from the airspace record below
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
      if (flightDataId) this._markInside(insideOf, point, liveStrips.get(flightDataId) || []);
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
    const index = routeGeometry.buildPointIndex(this._d.missionData ? this._d.missionData() : null, all);
    const deciders = new Map(); // airspaceId -> the transit deciders (docs/adr/0128), for a transit type
    const coordinate = []; // docs/adr/0136: [{facilityId, stripId, airspaceId, positionId}]
    for (const record of all) {
      const def = record.definition || {};
      if (def.kind === 'ROUTE' || !ENTRY_TYPES.has(def.type)) continue;
      const airspace = {
        airspaceId: record.airspaceId, name: def.name, type: def.type,
        controllingFacilityId: def.controllingFacilityId || null, controllingPositionId: def.controllingPositionId || null,
      };
      if (typeof airspaceStore.transitDecidersFor === 'function') {
        const ids = airspaceStore.transitDecidersFor(record.airspaceId);
        if (ids.length) deciders.set(record.airspaceId, ids);
      }
      const coordinates = record.state === 'ACTIVE' && def.kind === 'AREA' && TRANSIT_TYPES.includes(def.type);
      for (const [flightDataId, strips] of liveStrips) {
        const fd = this._d.flightDataOf(flightDataId);
        const crosses = !!(fd && fd.filed && routeGeometry.filedThrough(fd, def, index));
        const filed = strips.some(s => s.airspaceId === airspace.airspaceId)
          || !!(fd && fd.comms && fd.comms.airspaceId === airspace.airspaceId)
          || crosses;
        if (filed) rowFor(airspace, flightDataId, null).filed = true;
        if (crosses && coordinates && !hasNoClearance(fd) && !(record.transits || []).some(t => t.flightDataId === flightDataId)
          && !this._approved(flightDataId, airspace, strips)) {
          for (const st of strips) {
            if (st.stripId) coordinate.push({ facilityId: st.facilityId, stripId: st.stripId, airspaceId: airspace.airspaceId, positionId: st.positionId });
          }
        }
      }
      // docs/adr/0128: a flight with a transit is listed whatever its route says (the decider must see the request).
      for (const t of record.transits || []) {
        if (!liveStrips.has(t.flightDataId)) continue; // the sweep ends it; never a row without a Strip
        rowFor(airspace, t.flightDataId, t.callsign || null).transit = {
          state: t.state, requestedPositionId: t.requestedPositionId || null, decidedPositionId: t.decidedPositionId || null,
          reason: t.reason || null, selfCoordinated: !!t.selfCoordinated,
        };
      }
    }
    for (const [airspaceId, rows] of traffic) {
      for (const row of rows.values()) row.alerting = byId.has(`F:${row.flightDataId}:${airspaceId}`);
    }
    const nextTraffic = [...traffic.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([airspaceId, rows]) => ({
        airspaceId,
        ...(deciders.has(airspaceId) ? { transitDeciders: deciders.get(airspaceId) } : {}),
        flights: [...rows.values()].sort((a, b) => String(a.callsign || a.flightDataId).localeCompare(String(b.callsign || b.flightDataId))),
      }));
    const nextInside = [...insideOf.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, x]) => ({ facilityId: x.facilityId, stripId: x.stripId, airspaceId: x.airspaceId }));
    const insideTo = new Map([...insideOf.entries()].map(([key, x]) => [key, `${x.facilityId}:${x.positionId}`]));
    const coordKey = (x) => `${x.facilityId}:${x.stripId}:${x.airspaceId}`;
    coordinate.sort((a, b) => (coordKey(a) < coordKey(b) ? -1 : coordKey(a) > coordKey(b) ? 1 : 0));
    const changed = JSON.stringify(next) !== JSON.stringify(this._alerts)
      || JSON.stringify(nextTraffic) !== JSON.stringify(this._traffic)
      || JSON.stringify(nextInside) !== JSON.stringify(this._inside)
      || [...insideTo].some(([key, to]) => this._insideTo.get(key) !== to)
      || JSON.stringify(coordinate) !== JSON.stringify(this._coordinate)
      || [...to].some(([id, keys]) => { const was = this._to.get(id); return !was || was.size !== keys.size || [...keys].some(k => !was.has(k)); });
    this._alerts = next;
    this._traffic = nextTraffic;
    this._trafficOf = trafficOf;
    this._inside = nextInside;
    this._insideTo = insideTo;
    this._insideKeys = new Set(nextInside.map(x => `${x.facilityId}:${x.stripId}:${x.airspaceId}`));
    this._coordinate = coordinate;
    this._to = to;
    this._since = new Map(next.map(a => [a.id, a.since]));
    return changed;
  }
}

module.exports = { AirspaceEntryAlertMonitor, alertsIn, RESTRICTED_LIKE, JOINT_USE, ENTRY_TYPES };
