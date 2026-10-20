'use strict';
// The airport surface (U-SCOPE-SMALL item 3): the basemap layers a ground or tower controller reads when zoomed in on a
// field (crc-desktop-scope-style.json): apron and paved-area polygons, taxiway lines, runway designators, taxiway, apron and
// gate names, all from the OpenMapTiles `aeroway` layer that MapTiler and the OpenFreeMap fallback both serve. The runway
// lines themselves ("Aeroway") are not part of it: they are the video map's runways and always draw.
// A leaf: no imports, so map-style.js and the unit test use it alike.

export const AIRPORT_SURFACE_LAYERS = Object.freeze([
  'Airport pavement', 'Taxiway', 'Runway designators', 'Taxiway labels', 'Apron labels', 'Airport gate',
]);

/**
 * 'visible' or 'none' for every surface layer: shown when the controller's "Airport surface" switch (Settings → Declutter,
 * on by default) is on, and never on the black strict-STARS ATC scope (crc-sync's docs/adr/0088), which keeps the
 * runways only.
 * @param {{ enabled?: boolean, black?: boolean }} o
 */
export function airportSurfaceVisibility({ enabled, black } = {}) {
  return enabled !== false && !black ? 'visible' : 'none';
}
