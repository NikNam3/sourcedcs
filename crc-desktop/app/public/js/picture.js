'use strict';
import { settings } from './settings.js';

// The radar picture as this client holds it, and the mission data and coverage that frame it. A leaf (DESK-GRAPH): `app.js`
// writes it from the socket; every reader imports it from here instead of from the boot module, and `getLatestTrack` /
// `getAllTracks` are plain imports instead of names on `window`.
//
// The radar picture is server-authoritative (crc-sync's docs/adr/0042). This
// renderer no longer derives radars, owns a sweep phase, or decides what it is
// allowed to see: crc-sync sends only the contacts the Positions this
// controller holds can actually see, each stamped with `illuminatedAt` — when
// the beam last passed over it. What each contact carries is only what those
// sensors could know (crc-sync's docs/adr/0059); track-label.js reads it.
//
// Two maps, and the distinction between them is load-bearing:
//   latestFromServer — every contact in this controller's coverage, with
//     who it is (label, IFF) updated at once rather than waiting for a beam.
//   tracks — the contacts still inside the fade window, i.e. what is on the
//     scope right now. Position and altitude stay gated on illumination on
//     purpose: that IS the radar simulation, computed once on the server.
export const latestFromServer = new Map(); // id → track (as delivered, incl. illuminatedAt)
export const tracks           = new Map(); // id → track (displayed)
export const history          = new Map(); // id → [{lat, lon, altFt, timestamp}, ...] — altFt null when no sensor gives one
export const labelOffsets     = new Map(); // id → [dLat, dLon] relative to track

// When the server says each contact was last illuminated. Replaces the local
// `lastSweepMs` the deleted sweep loop used to write, and is the one clock the
// fade is computed against — so two controllers watching one contact see it
// decay together.
export const lastSweepMs      = new Map(); // trackId → illuminatedAt, from the server
export const zeroSpeedSinceMs = new Map(); // trackId → timestamp when 0-speed-airborne first detected

/** The delivered contact with this id (a number or a string), or null. */
export function getLatestTrack(id) { return latestFromServer.get(String(id)) || null; }
/** Every delivered contact. */
export function getAllTracks() { return [...latestFromServer.values()]; }

// Static reference data loaded at startup, and the mission as the last `init` frame stated it
export let aircraftTypes = {};
export let missionData      = null;
export let atisActive       = []; // [{ frequency, ownerId }] — who's currently transmitting ATIS where, from crc-sync

export function setAircraftTypes(v) { aircraftTypes = v; }
export function setMissionData(v) { missionData = v; }
export function setAtisActive(v) { atisActive = v; }

// ── Coverage ──────────────────────────────────────────────────────────────
// What this controller is looking through, as crc-sync's `coverage` message
// last stated it. Not a selection: it follows the Positions they hold
// (crc-sync's docs/adr/0042), so there is nothing here for a user to toggle
// and the radar selector that used to own it is gone. Ground, Clearance
// Delivery and Operations have no scope, and a controller holding only those
// correctly gets an empty list — the banner says so rather than the map going
// quietly blank.
export let coverageRadars = [];          // [{id, type, label, lat, lon, elevM, rangeM, sweepMs, sweepStart, grantedBy, ...}]
export let coverageSignedOnPositions = [];   // [{facilityId, positionId, isPrimary}]
export let coverageDatalink = false;     // whether a Position we are signed on to is on the datalink

export function setCoverage(radars, signedOnPositions, datalink) {
  coverageRadars = radars;
  coverageSignedOnPositions = signedOnPositions;
  coverageDatalink = datalink;
}
export function _setCoverageRadars(v) { coverageRadars = v; }
export function _setCoverageDatalink(v) { coverageDatalink = v; }
export function _setCoverageSignedOnPositions(v) { coverageSignedOnPositions = v; }

/** Every radar this controller is looking through. */
export function getActiveRadars() { return coverageRadars; }

/** The approach radar for an airfield, if we are looking through it — used by the extended centerline. */
export function coverageApproachFor(airportName) {
  return coverageRadars.find(r => r.type === 'approach' && r.airport === airportName) || null;
}

// Effective bullseye positions, combining live mission data with any
// user-configured overrides from the settings panel (per coalition).
export function getBullseye() {
  const base = (missionData && missionData.bullseye) || {};
  const ov   = settings.bullseyeOverride || {};
  const pick = (side) => {
    const o = ov[side];
    if (o && o.enabled && o.lat != null && o.lon != null) return { lat: o.lat, lon: o.lon };
    return base[side] || null;
  };
  return { blue: pick('blue'), red: pick('red') };
}
