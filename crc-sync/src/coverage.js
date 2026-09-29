'use strict';

// What each radar is illuminating, right now, for everybody (docs/adr/0043).
//
// The renderer used to do this by sampling: every 50ms it computed each
// radar's beam angle and kept any track within ±4° of it. That has a bug
// nobody had noticed. A 4° beam on a 2000ms rotation dwells on a target for
// about 22ms, and the ±4° acceptance window is about 44ms wide — against a
// 50ms tick. Targets were being missed, unpredictably, depending on where the
// tick landed. Moving that loop server-side would have moved the bug with it.
//
// So illumination is COMPUTED instead. A 360° beam crosses a target's bearing
// at times sweepStart + sweepMs*(bearing/360) + k*sweepMs; the tick asks only
// whether such an instant fell inside the interval since the last tick, and
// stamps the exact instant. Each target is illuminated exactly once per
// rotation, which is what a radar does, and the tick rate becomes a delivery
// choice rather than a fidelity one. The beam width survives only as
// something the debug overlay draws.
//
// One engine for the whole server: `sweepStart` per radar id lives here, so
// every controller's beams sit at one phase. That is the substance of
// docs/adr/0042 — two controllers at one board now see the same picture,
// which is what lets a Strip's correlated track mean the same thing to both.

const { checkOnGround, haversineM } = require('./geo');

// Beam half-width, for the client's debug overlay only. Detection does not use
// it — see this module's header.
const SWEEP_BEAM_DEG = 4;

// A line-of-sight answer is reused for this long per (radar, track) pair.
// At jet speeds a second is ~250m of movement, against a terrain sample
// spacing of several kilometres at any useful radar range, so the answer
// cannot meaningfully change inside the window — and this is the only part of
// the tick that is not arithmetic.
const LOS_CACHE_MS = 1000;

const LOS_CACHE_MAX = 20000;

function normaliseDeg(d) {
  return ((d % 360) + 360) % 360;
}

/** Signed difference in (-180, 180]. */
function signedDeltaDeg(a, b) {
  let d = normaliseDeg(a - b);
  if (d > 180) d -= 360;
  return d;
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const phi1 = (lat1 * Math.PI) / 180, phi2 = (lat2 * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return normaliseDeg((Math.atan2(y, x) * 180) / Math.PI);
}

/**
 * The most recent time a periodic event at `offset` into a cycle of `period`
 * occurred at or before `now` — or null if that instant is not after `since`.
 *
 * This is the whole scheduling primitive. Both radar kinds reduce to it.
 */
function lastCrossing(since, now, epoch, period, offset) {
  if (!(period > 0)) return null;
  const k = Math.floor((now - epoch - offset) / period);
  const t = epoch + offset + k * period;
  if (t > since && t <= now) return t;
  return null;
}

/**
 * When, if at all, did this radar's beam last cross the target's bearing
 * inside (since, now]? Null when it did not, or when the target is outside a
 * nose radar's arc entirely.
 *
 * A 360° dish: one crossing per rotation, at the bearing's fraction of the
 * circle. A nose radar: the beam oscillates across `angleFromNose`, one pass
 * each way, so a full there-and-back cycle is 2*sweepMs and a target inside
 * the arc is crossed twice per cycle — once on the way out, once on the way
 * back. Both crossings are candidates and the later one wins.
 */
function lastIllumination(radar, bearing, since, now, sweepStart) {
  const { sweepMs, angleFromNose } = radar;
  if (!(sweepMs > 0)) return null;

  if (angleFromNose >= 360) {
    return lastCrossing(since, now, sweepStart, sweepMs, (normaliseDeg(bearing) / 360) * sweepMs);
  }

  const half = angleFromNose / 2;
  const rel = signedDeltaDeg(bearing, radar.heading || 0);
  if (Math.abs(rel) > half) return null; // outside the scanned arc

  const cycleMs = sweepMs * 2;
  const u = (rel + half) / angleFromNose; // 0 at the left edge, 1 at the right
  const out = lastCrossing(since, now, sweepStart, cycleMs, u * sweepMs);
  const back = lastCrossing(since, now, sweepStart, cycleMs, (2 - u) * sweepMs);
  if (out == null) return back;
  if (back == null) return out;
  return Math.max(out, back);
}

class CoverageEngine {
  /**
   * @param {object} deps
   * @param {{hasLineOfSight:Function}|null} deps.terrain — a TerrainStore, or
   *   null to skip masking entirely (range and beam geometry only). Null is a
   *   legitimate configuration, not a degraded one: without a MapTiler key
   *   there is no DEM to mask against.
   */
  constructor({ terrain = null } = {}) {
    this._terrain = terrain;
    this._sweepStart = new Map(); // radarId -> ms. The one phase everybody shares.
    this._los = new Map();        // `${radarId}|${trackId}` -> { at, visible }
    this._lastTickAt = null;
    // trackId -> Map<radarId, at> — the live picture, carried across ticks
    // so a track illuminated two seconds ago is still known to have been
    // illuminated (the client fades it out from `at`). Per radar, because two
    // controllers on different radars must each see their own radar's
    // returns: one radar's sweep must not stand in for, or erase, another's.
    this._illuminated = new Map();
    this._stats = { ticks: 0, losCalls: 0, losUnknown: 0, illuminations: 0 };
  }

  get stats() {
    return { ...this._stats, tracked: this._illuminated.size, losCached: this._los.size };
  }

  /**
   * The live picture — every track any radar has illuminated, and when, per
   * radar: Map<trackId, Map<radarId, at>>. Returned live rather than copied
   * because the only reader (ws-hub.js) does one pass over it per client per
   * tick and never holds it.
   */
  get illuminatedNow() { return this._illuminated; }

  /** The shared phase for a radar, minted on first sight and stable thereafter. */
  sweepStartFor(radarId, now) {
    let start = this._sweepStart.get(radarId);
    if (start === undefined) {
      start = now;
      this._sweepStart.set(radarId, start);
    }
    return start;
  }

  /** Mission reload — the theater changed, so every phase and every answer is void. */
  reset() {
    this._sweepStart.clear();
    this._los.clear();
    this._illuminated.clear();
    this._lastTickAt = null;
  }

  /** Forgets tracks that are no longer in the picture, so the maps do not grow forever. */
  _evict(liveTrackIds) {
    for (const id of this._illuminated.keys()) {
      if (!liveTrackIds.has(id)) this._illuminated.delete(id);
    }
    if (this._los.size > LOS_CACHE_MAX) this._los.clear();
  }

  /**
   * Drops radars that are no longer being swept from the live picture.
   *
   * Without this, illumination outlives the radar that produced it. The swept
   * set is scoped to OCCUPIED Positions, so when the last controller holding
   * Approach vacates, its radar stops sweeping — but its entries stayed put
   * with their old timestamps. Re-taking the Position minutes later then
   * replayed those contacts, stamped with an `illuminatedAt` from before the
   * gap, so the client drew them already faded and expired them on the spot.
   * Self-correcting within one scan, but wrong in the meantime and wrong in a
   * way that reads as a bug rather than as radar behaviour.
   *
   * A contact another manned radar also sees keeps that radar and stays.
   */
  _pruneUnsweptRadars(sweptIds) {
    for (const [trackId, byRadar] of this._illuminated) {
      for (const radarId of [...byRadar.keys()]) if (!sweptIds.has(radarId)) byRadar.delete(radarId);
      if (byRadar.size === 0) this._illuminated.delete(trackId);
    }
  }

  _lineOfSight(radar, track, now) {
    if (!this._terrain) return true;
    const key = `${radar.id}|${track.id}`;
    const cached = this._los.get(key);
    if (cached && now - cached.at < LOS_CACHE_MS) return cached.visible;

    this._stats.losCalls += 1;
    const result = this._terrain.hasLineOfSight(
      radar.lat, radar.lon, radar.elevM, track.lat, track.lon, track.alt,
    );
    // 'unknown' means the DEM is still warming. Fail open — going spuriously
    // blind is worse than seeing slightly too much — and do not cache it, so
    // the next sample asks again once the tile has landed.
    if (result === 'unknown') {
      this._stats.losUnknown += 1;
      return true;
    }
    this._los.set(key, { at: now, visible: result });
    return result;
  }

  /**
   * One sweep over every radar and every track.
   *
   * @param {Array} radars — buildRadars() output, already narrowed to the
   *   radars somebody is actually looking through (a radar nobody is assigned
   *   costs nothing to skip and its phase is minted lazily anyway).
   * @param {Array} tracks — TrackStore.getAll()
   * @param {object|null} missionData — for the on-ground test
   * @returns {{illuminatedNow: Map<string, Map<string, number>>,
   *            changed: Array<{trackId:string, at:number, radarIds:string[]}>}}
   *   `illuminatedNow` is the whole live picture; `changed` is only what this
   *   tick newly illuminated, which is what gets broadcast.
   */
  tick(radars, tracks, missionData, now = Date.now()) {
    const since = this._lastTickAt == null ? now - 1 : this._lastTickAt;
    this._lastTickAt = now;
    this._stats.ticks += 1;

    const liveIds = new Set();
    const onGround = new Map(); // computed once per tick per track, not per radar
    for (const t of tracks) {
      liveIds.add(String(t.id));
      if (t.category === 1 || t.category === 2) onGround.set(String(t.id), checkOnGround(t, missionData));
    }
    this._evict(liveIds);
    // Before the sweep, not after: an entry the sweep is about to refresh must
    // keep whatever it had, and an entry for a radar nobody is looking through
    // any more must not survive to be replayed.
    this._pruneUnsweptRadars(new Set((radars || []).filter(r => !r.onGround).map(r => r.id)));

    const hits = new Map(); // trackId -> { at, byRadar: Map<radarId, at> }

    for (const radar of radars) {
      // A radar sitting on the ramp is not a radar.
      if (radar.onGround) continue;
      const sweepStart = this.sweepStartFor(radar.id, now);

      for (const track of tracks) {
        const id = String(track.id);

        // Gate order is the original's, and the order matters for cost: the
        // cheap category tests first, then range, then the beam arithmetic,
        // and terrain last because it is the only expensive one.
        if (track.category === 3 && !radar.seesGround) continue;
        if (track.category === 4 && !radar.seesShips) continue;
        if (radar.noGroundAircraft && onGround.get(id)) continue;

        const distM = haversineM(radar.lat, radar.lon, track.lat, track.lon);
        if (distM > radar.rangeM) continue;

        const bearing = bearingDeg(radar.lat, radar.lon, track.lat, track.lon);
        const at = lastIllumination(radar, bearing, since, now, sweepStart);
        if (at == null) continue;

        // Ground contacts skip terrain masking. DCS's airfields are not
        // flattened the way the DEM has them, so a vehicle on the ramp reads
        // as buried inside a hill and would never be seen — the original made
        // the same exception for the same reason.
        if (track.category !== 3 && !this._lineOfSight(radar, track, now)) continue;

        let hit = hits.get(id);
        if (!hit) { hit = { at, byRadar: new Map() }; hits.set(id, hit); }
        hit.byRadar.set(radar.id, at);
        if (at > hit.at) hit.at = at;
      }
    }

    const changed = [];
    for (const [trackId, hit] of hits) {
      let byRadar = this._illuminated.get(trackId);
      if (!byRadar) { byRadar = new Map(); this._illuminated.set(trackId, byRadar); }
      for (const [radarId, at] of hit.byRadar) byRadar.set(radarId, at);
      changed.push({ trackId, at: hit.at, radarIds: [...hit.byRadar.keys()] });
      this._stats.illuminations += 1;
    }

    return { illuminatedNow: new Map(this._illuminated), changed };
  }

  /** The last illumination of one track, or null if this picture has never had it. */
  illuminationFor(trackId) {
    const byRadar = this._illuminated.get(String(trackId));
    if (!byRadar) return null;
    return { at: Math.max(...byRadar.values()), radarIds: [...byRadar.keys()], byRadar: new Map(byRadar) };
  }

  /**
   * Has any of these radars ever illuminated this track in the current
   * picture? This is what decides whether a controller may know about it at
   * all — distinct from whether their beam has just passed over it.
   */
  isVisibleThrough(trackId, radarIdSet) {
    const byRadar = this._illuminated.get(String(trackId));
    if (!byRadar) return false;
    for (const id of byRadar.keys()) if (radarIdSet.has(id)) return true;
    return false;
  }
}

module.exports = {
  CoverageEngine,
  lastCrossing, lastIllumination, bearingDeg, signedDeltaDeg, normaliseDeg,
  SWEEP_BEAM_DEG, LOS_CACHE_MS,
};
