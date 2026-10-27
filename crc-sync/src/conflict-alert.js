'use strict';

// Conflict Alert (CA) and Mode C Intruder (MCI) (docs/adr/0058, 0118).
//
// [SOURCE-DEFINED] (docs/adr/0058, 0059): the straight-line prediction model,
// the thresholds (config/alerting.json `conflictAlert`) and the scoping to ATC
// Positions are ours, not read from the guide or a cited FAA figure.
//
// Every tick, every eligible pair of airborne tracks is projected forward in a
// straight line — course over ground, ground speed and vertical speed, as DCS
// reports them — for `lookAheadSec`. If at some moment in that window they are
// within `lateralNm` AND `verticalFt` of each other at the same time, the pair
// is a conflict, reported with the time to their closest point and how close.
//
// Deliberately simple: straight lines, a flat earth around the pair, true
// altitudes (both aircraft get the same pressure correction, so the difference
// between them is what matters). Good enough for two minutes; turns and level
// offs make the prediction go away on the next tick, which is how the alert
// clears itself.
//
// WHICH PAIRS (docs/adr/0118, H134 LT-RQ16 a, the FAA model). P/CG CONFLICT ALERT: "between tracked targets (known IFR
// or VFR aircraft)"; MODE C INTRUDER ALERT: "between a tracked target (known IFR or VFR aircraft) and an untracked target
// (unknown IFR or VFR aircraft)". Our "tracked" is a track correlated to a Strip (CORRELATED: it carries the flight's
// identification, P/CG ASSOCIATED), S-ARCH-56. So:
//   - two tracked:                    CA (`kind: 'CA'`), IFR or VFR alike;
//   - tracked vs untracked:           MCI (`kind: 'MCI'`), only when the untracked one reports altitude (its transponder
//                                     replies, so Mode C; H136 VQ8 a). The base altitude and the per-Position inhibit
//                                     are the receiving Position's Facility's (JO 7210.3EE para 12-6-12 b/d, 8-2-5 b),
//                                     applied at delivery (`deliverableTo`), because they differ per Facility;
//   - two untracked:                  nothing.
//
// GROUPS (docs/adr/0118, T16, research Q7): the effect of a standing ERAM Group Suppression / STARS inhibit (JO 7110.65BB
// para 5-13-1 c.1(b), 5-14-6 c.2). No alert between aircraft of one formation, nor between the participants of an active
// MARSA relation. A formation is one flight data, so its wingmen are not correlated; an UNCORRELATED target within
// `formationLateralNm` and `formationVerticalFt` of a tracked flight with `flightSize > 1` is taken as one of its members
// (the nearest ones, at most `flightSize - 1`, each to its nearest lead). That recognition is OURS: the orders say a
// standard formation's wingmen squawk standby (para 2-1-13 c.1), which DCS players do not always do, and give the
// formation's dimensions (P/CG FORMATION FLIGHT: 1 mile, 100 ft for a standard one); our vertical is wider because DCS
// wingmen stack. A recognised member is tracked for alerting, as part of its formation (the periphery, para 5-5-8):
// alerts against everyone outside the group are measured from each member.
//
// Callsigns are the Strip's when the track is correlated to one (the name the
// controller is working), else the track's own.
//
// Also not alerted: anything slower than `minGroundSpeedKt`, and a track
// younger than `minTrackAgeSec`.
//
// SUPPRESSED BY A CONTROLLER (docs/adr/0145, H173 VQ-A). JO 7110.65BB para 5-14-6 c.1 (STARS): "The suppress function may
// be used to suppress the display of a specific CA/MCI alert"; para 5-13-1 c.1(a) (ERAM): Conflict Suppress (CO) "between
// specific aircraft for a specific alert"; c.4 / c.3: not "at or for another control position without being coordinated".
// So a suppression is for one pair (the conflict id), at one Position (the one acting), and lasts as long as that alert:
// the tick that no longer finds the pair (it stopped alerting, or a track dropped) forgets it. It changes only how the
// alert is shown at that Position (`presentFor`: `suppressedAt`); the alert itself is still computed and delivered.

const { MS_PER_KT } = require('./units');
const M_PER_NM = 1852;
const FT_PER_M = 3.28084;
const AIRBORNE_CATEGORIES = new Set([1, 2]); // airplane, helicopter

/** East/north metres of `p` from `origin` on a flat earth. Plenty for a few tens of miles. */
function toLocal(p, origin) {
  const cosLat = Math.cos(origin.lat * Math.PI / 180);
  return {
    x: (p.lon - origin.lon) * 111320 * cosLat,
    y: (p.lat - origin.lat) * 110540,
  };
}

function fromLocal(q, origin) {
  const cosLat = Math.cos(origin.lat * Math.PI / 180);
  return { lat: origin.lat + q.y / 110540, lon: origin.lon + q.x / (111320 * cosLat) };
}

function velocityOf(track) {
  const rad = track.course * Math.PI / 180;
  return { vx: track.groundSpeed * Math.sin(rad), vy: track.groundSpeed * Math.cos(rad), vz: track.verticalSpeed || 0 };
}

/**
 * The predicted conflict between two tracks, or null.
 * @returns {null|{timeToCpaSec:number, minNm:number, vertFt:number, aAt:{lat,lon}, bAt:{lat,lon}}}
 */
function predictConflict(a, b, cfg) {
  const origin = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
  const pa = toLocal(a, origin);
  const pb = toLocal(b, origin);
  const va = velocityOf(a);
  const vb = velocityOf(b);
  let best = null;
  for (let t = 0; t <= cfg.lookAheadSec; t += cfg.stepSec) {
    const dx = (pa.x + va.vx * t) - (pb.x + vb.vx * t);
    const dy = (pa.y + va.vy * t) - (pb.y + vb.vy * t);
    const nm = Math.hypot(dx, dy) / M_PER_NM;
    const vertFt = Math.abs((a.alt + va.vz * t) - (b.alt + vb.vz * t)) * FT_PER_M;
    if (nm < cfg.lateralNm && vertFt < cfg.verticalFt && (!best || nm < best.minNm)) {
      best = {
        timeToCpaSec: t, minNm: nm, vertFt,
        aAt: fromLocal({ x: pa.x + va.vx * t, y: pa.y + va.vy * t }, origin),
        bAt: fromLocal({ x: pb.x + vb.vx * t, y: pb.y + vb.vy * t }, origin),
      };
    }
  }
  return best;
}

function isEligible(track, now, cfg) {
  if (!AIRBORNE_CATEGORIES.has(track.category)) return false;
  if (!Number.isFinite(track.course) || !Number.isFinite(track.groundSpeed)) return false;
  if (track.groundSpeed < cfg.minGroundSpeedKt * MS_PER_KT) return false;
  if (track.firstSeenAt && now - track.firstSeenAt < cfg.minTrackAgeSec * 1000) return false;
  return true;
}

const TRACKED = 'TRACKED';
const MEMBER = 'MEMBER';
const UNTRACKED = 'UNTRACKED';

/**
 * Which kind of alert a pair can raise, or null (the header's "Which pairs" and "Groups").
 * @param {{role:string, group:string|null}} ra
 * @param {{role:string, group:string|null}} rb
 * @returns {'CA'|'MCI'|null}
 */
function pairKind(ra, rb) {
  const known = (r) => r.role === TRACKED || r.role === MEMBER;
  if (known(ra) && known(rb)) return ra.group && ra.group === rb.group ? null : 'CA';
  if (known(ra) || known(rb)) return 'MCI';
  return null;
}

/**
 * Every conflict among `tracks` right now.
 * @param {object[]} tracks
 * @param {object} cfg
 * @param {number} [now]
 * @param {object} [opts]
 * @param {(track:object) => {role:'TRACKED'|'MEMBER'|'UNTRACKED', group:string|null}} [opts.roleOf] default: every
 *   track tracked and in a group of its own (the geometry alone)
 * @param {(track:object) => boolean} [opts.reportsAltitude] whether an untracked target reports Mode C (MCI needs it)
 * @param {(track:object) => string|null} [opts.callsignFor] the correlated Strip's callsign, if any
 */
function findConflicts(tracks, cfg, now = Date.now(), opts = {}) {
  const roleOf = opts.roleOf || ((t) => ({ role: TRACKED, group: `T:${t.id}` }));
  const reportsAltitude = opts.reportsAltitude || (() => true);
  const callsignFor = opts.callsignFor || (() => null);
  const eligible = tracks.filter(t => isEligible(t, now, cfg));
  const roles = new Map(eligible.map(t => [t, roleOf(t)]));
  const out = [];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i];
      const b = eligible[j];
      // Cheap rejection before projecting: further apart than two minutes of
      // closing at 1,200 kt plus the minimum cannot conflict inside the window.
      const reach = (cfg.lateralNm + (1200 / 3600) * cfg.lookAheadSec) * M_PER_NM;
      const d = toLocal(b, a);
      if (Math.hypot(d.x, d.y) > reach) continue;
      const ra = roles.get(a);
      const rb = roles.get(b);
      const kind = pairKind(ra, rb);
      if (!kind) continue;
      const intruder = kind === 'MCI' ? (ra.role === UNTRACKED ? a : b) : null;
      if (intruder && !reportsAltitude(intruder)) continue; // H136 VQ8 a: no MCI for a primary-only target
      const c = predictConflict(a, b, cfg);
      if (!c) continue;
      const [first, second] = String(a.id) < String(b.id) ? [a, b] : [b, a];
      out.push({
        id: `${first.id}|${second.id}`,
        kind,
        a: String(first.id), b: String(second.id),
        aCallsign: callsignFor(first) || first.callsign || String(first.id),
        bCallsign: callsignFor(second) || second.callsign || String(second.id),
        ...(intruder ? { intruder: String(intruder.id) } : {}),
        timeToCpaSec: Math.round(c.timeToCpaSec), minNm: Math.round(c.minNm * 10) / 10, vertFt: Math.round(c.vertFt / 100) * 100,
        aAt: first === a ? c.aAt : c.bAt, bAt: first === a ? c.bAt : c.aAt,
      });
    }
  }
  return out;
}

/**
 * The formation members among the untracked tracks (the header's "Groups"; ours): each tracked flight with `size > 1`
 * claims the nearest untracked airborne tracks within `formationLateralNm` and `formationVerticalFt` of its own track, at
 * most `size - 1`, and a track two leads could claim goes to the nearer one.
 * @param {object[]} tracks every airborne track
 * @param {Map<object, {flightDataId:string, group:string, size:number}>} leads the tracked ones
 * @returns {Map<object, {flightDataId:string, group:string, lead:object}>}
 */
function formationMembers(tracks, leads, cfg) {
  const lateralM = (cfg.formationLateralNm ?? 1) * M_PER_NM;
  const verticalM = (cfg.formationVerticalFt ?? 1000) / FT_PER_M;
  const candidates = []; // { track, lead, dist }
  for (const [lead, info] of leads) {
    if (!(info.size > 1)) continue;
    for (const t of tracks) {
      if (t === lead || leads.has(t) || !AIRBORNE_CATEGORIES.has(t.category)) continue;
      if (!Number.isFinite(t.alt) || !Number.isFinite(lead.alt) || Math.abs(t.alt - lead.alt) > verticalM) continue;
      const d = toLocal(t, lead);
      const dist = Math.hypot(d.x, d.y);
      if (dist <= lateralM) candidates.push({ track: t, lead, dist });
    }
  }
  candidates.sort((x, y) => x.dist - y.dist);
  const members = new Map();
  const claimed = new Map(); // lead -> count
  for (const { track, lead, dist } of candidates) {
    if (members.has(track)) continue;
    const info = leads.get(lead);
    const n = claimed.get(lead) || 0;
    if (n >= info.size - 1) continue;
    claimed.set(lead, n + 1);
    members.set(track, { flightDataId: info.flightDataId, group: info.group, lead, dist });
  }
  return members;
}

/**
 * The altitude an MCI intruder must be above for a Facility's setting (docs/adr/0118; JO 7210.3EE para 12-6-12 b, 8-2-5 b).
 * AGL: the ground plus the base, the ground taken as sea level where it is not known (ours). MSL: the base, or the ground plus
 * `highTerrainAglFt` where the ground is known to be above the base (para 8-2-5 b's "1,500 AGL").
 * @param {{baseAltitudeFt:number, reference:'AGL'|'MSL', highTerrainAglFt:number|null}} mci
 * @param {number|null} groundFt
 */
function mciFloorFt(mci, groundFt) {
  if (mci.reference === 'AGL') return (groundFt ?? 0) + mci.baseAltitudeFt;
  return mci.highTerrainAglFt != null && groundFt != null && groundFt > mci.baseAltitudeFt ? groundFt + mci.highTerrainAglFt : mci.baseAltitudeFt;
}

class ConflictAlertMonitor {
  /**
   * @param {object} deps
   * @param {{getAll: () => object[]}} deps.trackStore
   * @param {object} deps.config alerting.json `conflictAlert`
   * @param {() => Map<string, string>} [deps.trackedFlights] trackId -> flightDataId for every tracked (correlated) contact.
   *   Absent: every track counts as tracked (the geometry alone, for tests)
   * @param {(flightDataId:string) => object|null} [deps.activeMarsaFor] the flight's ACTIVE MARSA relation
   * @param {(flightDataId:string) => number} [deps.flightSizeOf] the formation's size (identity.flightSize)
   * @param {(track:object) => boolean} [deps.reportsAltitude] the target replies Mode C (its transponder is on)
   * @param {(track:object) => string|null} [deps.callsignFor]
   * @param {(intruder:object, facilityId:string, positionId:string) => boolean} [deps.mciShownAt] whether an MCI with this
   *   intruder is shown at that Position: not inhibited there and the intruder above its Facility's base altitude
   * @param {(positionId:string) => boolean} [deps.isAtcPosition] whether a Position is an ATC one (only ATC is shown CA, so
   *   only ATC suppresses one). Absent: every Position is (tests)
   * @param {{now: () => number}} [deps.clock] the mission clock, stamping a suppression (docs/adr/0079)
   */
  constructor(deps) {
    this._d = deps;
    this._conflicts = [];
    this._suppressed = new Map(); // conflict id -> Map(positionId -> { facilityId, positionId, by, at })
    this._intruders = new Map(); // conflict id -> the intruder track, for an MCI
    this._memberFlights = new Map(); // trackId -> flightDataId, the formation members of the last tick
  }

  getAll() { return this._conflicts; }

  /** The uncorrelated wingmen recognised at the last tick, trackId -> their flight's flightDataId (docs/adr/0119 reads it). */
  formationMemberFlights() { return this._memberFlights; }

  /**
   * Whether a conflict is for a session holding `positions` ([{facilityId, positionId}]). A CA always is (the hub already
   * checks an ATC Position and both contacts in the picture); an MCI only when one of those Positions shows it.
   */
  deliverableTo(conflict, positions) {
    if (!conflict || conflict.kind !== 'MCI') return true;
    const intruder = this._intruders.get(conflict.id);
    const shownAt = this._d.mciShownAt;
    if (!intruder || !shownAt) return true;
    return (positions || []).some(p => shownAt(intruder, p.facilityId, p.positionId));
  }

  /**
   * Suppress (or restore) one alert at the acting Position (docs/adr/0145). `position` is the session's own
   * `{facilityId, positionId}`; the caller has checked the session holds it. The alert must be current and shown there.
   * @returns {{ok:true, conflict:object}|{ok:false, reason:string, detail:string}}
   */
  setSuppressed(conflictId, position, suppress, by = null) {
    const { isAtcPosition, clock } = this._d;
    if (isAtcPosition && !isAtcPosition(position.positionId)) {
      return { ok: false, reason: 'PERMISSION_DENIED', detail: `${position.positionId} is not an ATC Position, so it is shown no conflict alert` };
    }
    const conflict = this._conflicts.find(c => c.id === conflictId);
    if (!conflict || !this.deliverableTo(conflict, [position])) {
      return { ok: false, reason: 'NOT_FOUND', detail: 'that conflict alert has ended' };
    }
    let at = this._suppressed.get(conflictId);
    if (suppress) {
      if (!at) { at = new Map(); this._suppressed.set(conflictId, at); }
      if (!at.has(position.positionId)) {
        at.set(position.positionId, { facilityId: position.facilityId, positionId: position.positionId, by, at: clock ? clock.now() : null });
      }
    } else if (at) {
      at.delete(position.positionId);
      if (!at.size) this._suppressed.delete(conflictId);
    }
    return { ok: true, conflict };
  }

  /**
   * How a conflict is shown to a session holding `positions` (docs/adr/0145): with `shownAt`, the session's own ATC
   * Positions it is shown at (where a suppress can be made), and, when any of them suppressed it, `suppressedAt`. A
   * suppression at a Position the session does not hold is never shown.
   */
  presentFor(conflict, positions) {
    const { isAtcPosition } = this._d;
    const shownAt = (positions || [])
      .filter(p => (!isAtcPosition || isAtcPosition(p.positionId)) && this.deliverableTo(conflict, [p]))
      .map(p => p.positionId);
    const at = this._suppressed.get(conflict.id);
    const suppressedAt = at ? shownAt.filter(id => at.has(id)) : [];
    return { ...conflict, shownAt, ...(suppressedAt.length ? { suppressedAt } : {}) };
  }

  /** The role of every track this tick (the header's "Which pairs" and "Groups"). */
  _roles(tracks) {
    const { trackedFlights, activeMarsaFor, flightSizeOf } = this._d;
    if (!trackedFlights) return null;
    const flights = trackedFlights();
    const leads = new Map();
    for (const t of tracks) {
      const flightDataId = flights.get(String(t.id));
      if (!flightDataId) continue;
      const relation = activeMarsaFor ? activeMarsaFor(flightDataId) : null;
      leads.set(t, { flightDataId, group: relation ? `M:${relation.marsaId}` : `F:${flightDataId}`, size: flightSizeOf ? flightSizeOf(flightDataId) : 1 });
    }
    const members = formationMembers(tracks.filter(t => AIRBORNE_CATEGORIES.has(t.category)), leads, this._d.config);
    this._memberFlights = new Map([...members].map(([t, m]) => [String(t.id), m.flightDataId]));
    const roles = new Map();
    for (const t of tracks) {
      const lead = leads.get(t);
      const member = members.get(t);
      roles.set(t, lead ? { role: TRACKED, group: lead.group } : member ? { role: MEMBER, group: member.group } : { role: UNTRACKED, group: null });
    }
    return roles;
  }

  /** @returns {boolean} whether anything changed (any conflict present counts: its countdown moves) */
  tick(now = Date.now()) {
    const { trackStore, config, callsignFor, reportsAltitude } = this._d;
    const tracks = trackStore.getAll();
    const roles = this._roles(tracks);
    const next = findConflicts(tracks, config, now, {
      roleOf: roles ? (t) => roles.get(t) : undefined,
      reportsAltitude,
      callsignFor: callsignFor || (() => null),
    });
    const byId = new Map(tracks.map(t => [String(t.id), t]));
    this._intruders = new Map(next.filter(c => c.intruder).map(c => [c.id, byId.get(c.intruder)]));
    const changed = next.length > 0 || this._conflicts.length > 0;
    this._conflicts = next;
    // docs/adr/0145: a suppression lasts as long as its alert. A pair this tick does not find (it stopped alerting, or one
    // of the tracks dropped) is forgotten, so the next alert between the same two aircraft is a new one, shown in full.
    if (this._suppressed.size) {
      const live = new Set(next.map(c => c.id));
      for (const id of [...this._suppressed.keys()]) if (!live.has(id)) this._suppressed.delete(id);
    }
    return changed;
  }
}

module.exports = { findConflicts, formationMembers, pairKind, mciFloorFt, ConflictAlertMonitor, isEligible };
