'use strict';
import { parSampleFor } from './par-samples.js';

// ── FINAL's distance: the PAR's range to the touchdown point ─────────────

/**
 * Nautical miles from the carrier's touchdown point to the flight, along the final bearing, as the PAR measured it (crc-sync
 * docs/adr/0112), or null when this session has no PAR sample for the Strip (it is not the lane's controller, or there is no
 * plot yet). It used to be measured here from the ship's centre and from the ship position of the last banner, which the
 * server republishes only on a whole-degree BRC step: minutes old for a ship steaming straight. A blank is better than that.
 */
export function carrierDistanceNm(strip) {
  const sample = strip ? parSampleFor(strip.stripId) : null;
  const nm = sample && sample.plot ? sample.plot.rangeNm : null;
  return Number.isFinite(nm) ? nm : null;
}

/** The same, as FINAL's DIST Block shows it; '' when there is no PAR sample. */
export function carrierFinalDistanceText(strip) {
  const nm = carrierDistanceNm(strip);
  return nm == null ? '' : `${nm.toFixed(1)} NM`;
}
