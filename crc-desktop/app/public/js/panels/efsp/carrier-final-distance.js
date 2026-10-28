'use strict';
import { getLatestTrack } from '../../picture.js';
import { correlatedTrackIdForStrip } from './efsp-state.js';
import { getEfspCarrier } from './carrier-state.js';
import { facilityOfPosition } from './facility-topology.js';
import { parSampleFor } from './par-samples.js';

// ── The DIST Block (C17) and the Marshal's DME ──────────────────────────
//
// On the carrier (a Strip owned by a CARRIER Position: PriFly, the Marshal, the approach lanes) it is the range from the
// ship to the flight's correlated contact, for every carrier Position (decisions H125, crc-sync docs/adr/0116). The ship's
// position is the banner's, which the server republishes once the ship has moved 0.05 NM (lane CARRIER-FOLLOWUP), so it is
// never more than that out. At an airfield (Incirlik's PAR FINAL Strip, which shares the FINAL Block Map) it is the PAR's
// range to the threshold (docs/adr/0112), blank for a session that is not sent the sample.

const NM_EARTH_R = 3440.065;
const RAD = Math.PI / 180;

/** Nautical miles from the ship to the flight's correlated contact, or null when either is unknown. */
export function shipDistanceNm(strip) {
  const view = getEfspCarrier();
  const s = view && view.shipState;
  if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon) || !strip) return null;
  const trackId = correlatedTrackIdForStrip(strip);
  const track = trackId ? getLatestTrack(trackId) : null;
  if (!track || !Number.isFinite(track.lat) || !Number.isFinite(track.lon)) return null;
  const dLat = (track.lat - s.lat) * RAD;
  const dLon = (track.lon - s.lon) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(s.lat * RAD) * Math.cos(track.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * NM_EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The DIST figure: the ship's range on a carrier Strip, the PAR's range to the threshold elsewhere; null when unknown. */
export function carrierDistanceNm(strip) {
  if (!strip) return null;
  if (facilityOfPosition(strip.ownerPositionId) === 'CARRIER') return shipDistanceNm(strip);
  const sample = parSampleFor(strip.stripId);
  const nm = sample && sample.plot ? sample.plot.rangeNm : null;
  return Number.isFinite(nm) ? nm : null;
}

/** The same, as the DIST Block shows it; '' when unknown. */
export function carrierFinalDistanceText(strip) {
  const nm = carrierDistanceNm(strip);
  return nm == null ? '' : `${nm.toFixed(1)} NM`;
}
