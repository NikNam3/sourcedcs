'use strict';
// The airport surface (U-SCOPE-SMALL item 3, U-SURFACE): the basemap layers a ground or tower controller reads when zoomed
// in on a field (crc-desktop-scope-style.json): apron and paved-area polygons, taxiway lines, runway designators, taxiway,
// apron and gate names, all from the OpenMapTiles `aeroway` layer that MapTiler and the OpenFreeMap fallback both serve. The
// runway lines themselves ("Aeroway") are not part of it: they are the video map's runways and always draw.
//
// Who sees it (docs/parallel/decisions.md H162, H156 SC-Q1): a controller signed on (Primary or Observer) at a Position its
// own Facility lists in `airportSurfacePositions` (crc-sync's facility files, sent in the EFSP snapshot per Facility), on
// the map background and on the black ATC scope alike. No Position id is named here: the table is the snapshot's.
// A leaf: no imports, so map-style.js, efsp-state.js and the unit test use it alike.

export const AIRPORT_SURFACE_LAYERS = Object.freeze([
  'Airport pavement', 'Taxiway', 'Runway designators', 'Taxiway labels', 'Apron labels', 'Airport gate',
]);

// facilityId -> the Position ids whose controller sees the surface (the snapshot's `airportSurfacePositions`).
let _byFacility = {};

/** The snapshot's table (efsp-state.js): replaced whole; anything but an object of lists is none. */
export function setAirportSurfacePositions(byFacility) {
  const next = {};
  if (byFacility && typeof byFacility === 'object') {
    for (const [f, list] of Object.entries(byFacility)) if (Array.isArray(list)) next[f] = [...list];
  }
  _byFacility = next;
}

/** The table as the last snapshot sent it, `{ facilityId: [positionId] }` (a copy). */
export function getAirportSurfacePositions() {
  return Object.fromEntries(Object.entries(_byFacility).map(([f, list]) => [f, [...list]]));
}

/**
 * Does the controller hold a surface Position: one its own Facility lists? `signedOnOf(facilityId)` is the Positions the
 * controller is signed on at there, Primary or Observer (efsp-ws.js getSignedOnPositions). Every Facility is looked at;
 * none is first.
 * @param {Record<string, string[]>} byFacility
 * @param {(facilityId: string) => string[]} signedOnOf
 */
export function airportSurfaceHeld(byFacility, signedOnOf) {
  for (const [facilityId, list] of Object.entries(byFacility || {})) {
    if (!list || !list.length) continue;
    if ((signedOnOf(facilityId) || []).some(p => list.includes(p))) return true;
  }
  return false;
}

/**
 * 'visible' or 'none' for every surface layer: shown while the controller's "Airport surface" switch (Settings → Declutter,
 * on by default) is on and they hold a surface Position (airportSurfaceHeld). The black ATC scope does not hide it (H162);
 * it only greys it (airportSurfacePaint).
 * @param {{ enabled?: boolean, held?: boolean }} o
 */
export function airportSurfaceVisibility({ enabled, held } = {}) {
  return enabled !== false && held === true ? 'visible' : 'none';
}

/**
 * The surface layers' paint, as `[layerId, property, value]`. On the black ATC scope (`black`) the video map's dim grey
 * (`gray`, atc-scope.js ATC_DIM_GRAY, the runways' colour) and darker: pavement a dark grey fill with a grey outline,
 * taxiway lines and names grey, nothing brighter than the runways (dark cockpit). Otherwise the theme's (`light` or dark;
 * the dark values are the style file's). Both lists set the same properties, so the theme's restores what black set.
 * @param {{ black?: boolean, light?: boolean, gray?: string }} o
 */
export function airportSurfacePaint({ black = false, light = false, gray = '#8C8C8C' } = {}) {
  let p;
  if (black) {
    p = {
      pavementFill: '#1A1A1A', pavementOutline: '#4A4A4A', taxiway: '#5A5A5A',
      label: { strong: gray, mid: gray, weak: '#6E6E6E', halo: '#000000' },
    };
  } else if (light) {
    p = {
      pavementFill: ['match', ['get', 'class'], 'runway', '#b4b8b2', 'taxiway', '#c8cbc6', '#dcdbd6'], pavementOutline: '#b4b8b2', taxiway: '#aabaa8',
      label: { strong: '#2a2a2a', mid: '#3a3a3a', weak: '#4a4a4a', halo: '#ffffff' },
    };
  } else {
    p = {
      pavementFill: ['match', ['get', 'class'], 'runway', '#2e362e', 'taxiway', '#262c26', '#1e231e'], pavementOutline: '#2e362e', taxiway: '#323c32',
      label: { strong: '#8a9a8a', mid: '#788878', weak: '#627062', halo: '#000000' },
    };
  }
  const out = [
    ['Airport pavement', 'fill-color', p.pavementFill],
    ['Airport pavement', 'fill-outline-color', p.pavementOutline],
    ['Taxiway', 'line-color', p.taxiway],
  ];
  for (const [id, c] of [['Runway designators', 'strong'], ['Taxiway labels', 'mid'], ['Apron labels', 'weak'], ['Airport gate', 'weak']]) {
    out.push([id, 'text-color', p.label[c]], [id, 'text-halo-color', p.label.halo]);
  }
  return out;
}
