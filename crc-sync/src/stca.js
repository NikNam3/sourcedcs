'use strict';

// Short-term conflict alert (docs/adr/0058).
//
// Every tick, every pair of airborne tracks is projected forward in a straight
// line — course over ground, ground speed and vertical speed, as DCS reports
// them — for `lookAheadSec`. If at some moment in that window they are within
// `lateralNm` AND `verticalFt` of each other at the same time, the pair is a
// conflict, reported with the time to their closest point and how close.
//
// Deliberately simple: straight lines, a flat earth around the pair, true
// altitudes (both aircraft get the same pressure correction, so the difference
// between them is what matters). Good enough for two minutes; turns and level
// offs make the prediction go away on the next tick, which is how the alert
// clears itself.
//
// Callsigns are the Strip's when the track is correlated to one (the name the
// controller is working), else the track's own.
//
// Not suppressed: a pair with no Strips. Two unknowns can still collide.
// Suppressed: a pair in the same active MARSA relation (military authority is
// separating them, guide §9.2), anything slower than `minGroundSpeedKt`, and a
// track younger than `minTrackAgeSec`.

const MS_PER_KT = 0.514444;
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

/**
 * Every conflict among `tracks` right now.
 * @param {object[]} tracks
 * @param {object} cfg
 * @param {(a:object, b:object) => boolean} [suppress] true to skip a pair (MARSA)
 * @param {(track:object) => string|null} [callsignFor] the correlated Strip's callsign, if any
 */
function findConflicts(tracks, cfg, now = Date.now(), suppress = () => false, callsignFor = () => null) {
  const eligible = tracks.filter(t => isEligible(t, now, cfg));
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
      if (suppress(a, b)) continue;
      const c = predictConflict(a, b, cfg);
      if (!c) continue;
      const [first, second] = String(a.id) < String(b.id) ? [a, b] : [b, a];
      out.push({
        id: `${first.id}|${second.id}`,
        a: String(first.id), b: String(second.id),
        aCallsign: callsignFor(first) || first.callsign || String(first.id),
        bCallsign: callsignFor(second) || second.callsign || String(second.id),
        timeToCpaSec: Math.round(c.timeToCpaSec), minNm: Math.round(c.minNm * 10) / 10, vertFt: Math.round(c.vertFt / 100) * 100,
        aAt: first === a ? c.aAt : c.bAt, bAt: first === a ? c.bAt : c.aAt,
      });
    }
  }
  return out;
}

class StcaMonitor {
  /**
   * @param {object} deps { trackStore, config, fdrForTrack?(trackId), activeMarsaFor?(fdrId), callsignFor?(track) }
   */
  constructor(deps) {
    this._d = deps;
    this._conflicts = [];
  }

  getAll() { return this._conflicts; }

  /** @returns {boolean} whether anything changed (any conflict present counts: its countdown moves) */
  tick(now = Date.now()) {
    const { trackStore, config, fdrForTrack, activeMarsaFor, callsignFor } = this._d;
    const suppress = (a, b) => {
      if (!fdrForTrack || !activeMarsaFor) return false;
      const fa = fdrForTrack(a.id);
      const fb = fdrForTrack(b.id);
      if (!fa || !fb) return false;
      const rel = activeMarsaFor(fa);
      return !!rel && rel.participants.includes(fb);
    };
    const next = findConflicts(trackStore.getAll(), config, now, suppress, callsignFor || (() => null));
    const changed = next.length > 0 || this._conflicts.length > 0;
    this._conflicts = next;
    return changed;
  }
}

module.exports = { findConflicts, StcaMonitor, isEligible };
