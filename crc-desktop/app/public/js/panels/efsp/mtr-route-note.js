'use strict';

// The MTR route note on a Strip (AIRSP-2P-B, docs/adr/0098 §7, 0062): when the flight's MTR designator names a ROUTE in the
// airspace registry (same normalisation crc-sync's routeOccupancyFor uses: trimmed, upper case), the Strip says whether that
// route is active. Grey, read-only, never a reason line (ADR 0058). An unknown designator gets no note and stays as typed (H23).
// Pure: no DOM, no state.

/** The registry's ROUTE record for a flight's MTR designator, or null. */
export function routeForDesignator(designator, airspaces) {
  if (typeof designator !== 'string') return null;
  const id = designator.trim().toUpperCase();
  if (!id) return null;
  return (airspaces || []).find(a => a.airspaceId === id && a.definition && a.definition.kind === 'ROUTE') || null;
}

/** The note text, or null when there is nothing to say. */
export function mtrRouteNote(flightData, airspaces) {
  const mtr = flightData && flightData.military && flightData.military.mtr;
  const route = mtr ? routeForDesignator(mtr.designator, airspaces) : null;
  if (!route) return null;
  return route.state === 'ACTIVE' ? `${route.airspaceId}: route active` : `${route.airspaceId}: route not active (${route.state})`;
}
