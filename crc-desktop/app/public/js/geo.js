'use strict';

// ── Geo / kinematic math ───────────────────────────────────────────────────
// Pure functions — no globals, no side effects. Unchanged: these run
// per-track locally in every client (crc-desktop and the crc-sync web view
// alike) purely for trail/heading rendering, independent of the shared
// multiplayer state below.

function haversineM(lat1, lon1, lat2, lon2) {
  const R  = 6371000;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const y  = Math.sin(Δλ) * Math.cos(φ2);
  const x  = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

// Central meridians of DCS's per-theater Transverse Mercator projection —
// mirrors tools/miztoyaml/projection.py's _TM table (theatre name → lon0).
// Only lon0 is needed here; fe/fn/k0 matter for the full x/y→lat/lon
// projection, not for the convergence angle below.
const THEATRE_LON0 = {
  PersianGulf:    57,
  Falklands:     -57,
  Caucasus:       33,
  MarianaIslands:147,
  Nevada:       -117,
  Normandy:       -3,
  Syria:          39,
  SinaiMap:       33,
};

// Grid convergence: the angle between DCS's internal flat-world grid north
// (what the cockpit heading tape is referenced to) and true geodetic north
// (what bearingDeg computes from lat/lon). This is the whole correction —
// settings.hdgCorrection is a separate, purely manual fudge factor applied
// on top at the display call sites, and is NOT real-world magnetic
// variation (renamed from magVar once this math-based fix made that name
// misleading — see ui.js/geojson.js call sites).
// It grows with distance from the theater's central meridian and is ~0 near
// it. First-order Transverse Mercator formula, accurate to a small fraction
// of a degree across a DCS map's extent: γ = (lon - lon0) * sin(lat).
// True bearing = grid bearing + γ, so grid bearing = true bearing - γ.
function gridConvergenceDeg(lat, lon) {
  const theatre = missionData && missionData.theatre;
  const lon0    = theatre != null ? THEATRE_LON0[theatre] : null;
  if (lon0 == null) return 0;
  return (lon - lon0) * Math.sin(lat * Math.PI / 180);
}

// True geodetic bearing between two points, corrected to DCS's internal
// flat-grid heading reference — the frame every displayed heading is built
// from before settings.hdgCorrection is added at the call site. Deriving
// this from position history/lat-lon math only (never DCS's own orientation
// telemetry) keeps it something a real radar controller could plausibly
// know for an unidentified contact.
function gridBearingDeg(lat1, lon1, lat2, lon2) {
  const trueBearing = bearingDeg(lat1, lon1, lat2, lon2);
  const conv         = gridConvergenceDeg((lat1 + lat2) / 2, (lon1 + lon2) / 2);
  return ((trueBearing - conv) % 360 + 360) % 360;
}

function projectPos(lat, lon, headingDeg, distM) {
  const R  = 6371000;
  const d  = distM / R;
  const θ  = headingDeg * Math.PI / 180;
  const φ1 = lat * Math.PI / 180;
  const λ1 = lon * Math.PI / 180;
  const φ2 = Math.asin(Math.sin(φ1)*Math.cos(d) + Math.cos(φ1)*Math.sin(d)*Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ)*Math.sin(d)*Math.cos(φ1), Math.cos(d)-Math.sin(φ1)*Math.sin(φ2));
  return [φ2 * 180 / Math.PI, ((λ2 * 180 / Math.PI) + 540) % 360 - 180];
}

function kinematics(hist) {
  if (hist.length < 2) return { heading: 0, speedMs: 0, speedKt: 0 };

  // Heading: last two points — most recent direction.
  const p = hist[hist.length - 2];
  const c = hist[hist.length - 1];
  const heading = bearingDeg(p.lat, p.lon, c.lat, c.lon);

  // Speed: sum distance and time across ALL consecutive pairs.
  // Averaging over the full history window suppresses single-hop noise
  // that would otherwise cause ±400 kt spikes from a single bad position.
  let totalDist = 0, totalTime = 0;
  for (let i = 1; i < hist.length; i++) {
    totalDist += haversineM(hist[i-1].lat, hist[i-1].lon, hist[i].lat, hist[i].lon);
    totalTime += (hist[i].timestamp - hist[i-1].timestamp) / 1000;
  }
  if (totalTime <= 0) return { heading, speedMs: 0, speedKt: 0 };
  const speedMs = totalDist / totalTime;
  return { heading, speedMs, speedKt: speedMs * 1.944 };
}

/**
 * Climb or descent rate from the altitudes in the track history, or null
 * when the history does not carry an altitude — a contact no sensor gives an
 * altitude for has no vertical rate either (crc-sync's docs/adr/0059).
 */
function verticalFpm(hist) {
  if (hist.length < 2) return null;
  const curr   = hist[hist.length - 1];
  const target = curr.timestamp - 5000;
  let ref = hist[0];
  for (let i = 1; i < hist.length - 1; i++) {
    if (hist[i].timestamp <= target) ref = hist[i];
  }
  if (curr.altFt == null || ref.altFt == null) return null;
  const dtS = (curr.timestamp - ref.timestamp) / 1000;
  if (dtS <= 0) return 0;
  return (curr.altFt - ref.altFt) * 60 / dtS;
}

// ── Tags ───────────────────────────────────────────────────────────────────
// A tag names a contact nothing else identifies; crc-sync keeps it for
// everybody (its collab-store.js). A correlated flight's callsign beats it
// (docs/adr/0059). Every name a contact is shown with comes from
// track-label.js.

function setTrackRename(id, name) {
  const clean = (name || '').trim().toUpperCase();
  if (clean) sendToSync({ type: 'rename', trackId: String(id), name: clean });
  else       sendToSync({ type: 'clearRename', trackId: String(id) });
}

function clearTrackRename(id) {
  sendToSync({ type: 'clearRename', trackId: String(id) });
}
