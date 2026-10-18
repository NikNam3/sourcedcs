// Basemap fallback (U-GLYPHS 1b): the scope's basemap is MapTiler's OpenMapTiles vector planet, which needs the key
// crc-sync hands over at login. When MapTiler can't be used (no key, a refused or exhausted key, MapTiler down) the
// same source switches to OpenFreeMap's keyless planet, which serves the same OpenMapTiles schema (water, waterway,
// boundary, aeroway, place, with the class / admin_level / maritime / ref / name:en fields the style filters on).
// Once a session has fallen back it stays there until a new key arrives (no flapping on every errored tile); with
// neither source the map draws everything we own on the style's Background layer.
// A leaf module: no imports, so map-setup.js and the unit test use it alike.

export const BASEMAP_SOURCE = 'maptiler_planet';
export const MAPTILER_TILES = ['https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf'];
export const MAPTILER_ATTRIBUTION = '<a href="https://www.maptiler.com/copyright/" target="_blank">&copy; MapTiler</a> '
  + '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>';
/** OpenFreeMap's TileJSON: its tile URLs carry a dated build, so the source follows the TileJSON, not a fixed URL. */
export const FALLBACK_TILEJSON = 'https://tiles.openfreemap.org/planet';
export const FALLBACK_ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> '
  + '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> '
  + 'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

const MAPTILER = /^https:\/\/api\.maptiler\.com\//;
/** MapTiler answers a missing, refused or over-quota key with 401/403/429; 5xx is an outage. */
const LEAVE_ON = (status) => status === 401 || status === 403 || status === 429 || status >= 500;

/**
 * Whether one maplibre 'error' event means the basemap should leave MapTiler.
 * Only an error of the basemap source counts, and while on MapTiler; with a key, only an error of a request that
 * carried that key (a keyless request still in flight from before the key arrived is stale). No status at all is a
 * network failure, which counts.
 * @param {{ onFallback: boolean, sourceId?: string, status?: number, url?: string, key?: string|null }} e
 */
export function shouldFallBack({ onFallback, sourceId, status, url, key }) {
  if (onFallback || sourceId !== BASEMAP_SOURCE) return false;
  if (url && !MAPTILER.test(url)) return false;
  if (key && url && !url.includes('key=' + encodeURIComponent(key))) return false;
  if (status === undefined || status === null || status === 0) return true;
  return LEAVE_ON(status);
}

/**
 * Points the basemap source at MapTiler or at the fallback, in place: the style is never replaced (setStyle would
 * drop every GeoJSON layer). `setSourceProperty` is VectorTileSource's own (maplibre 3.6.2): it cancels a pending
 * TileJSON request, applies the change and reloads, and the reload clears the old tiles, the errored ones too.
 * The options' `tiles` win over a TileJSON's, so going to the fallback must remove them. Returns false with no source.
 */
export function pointBasemap(map, which) {
  const src = map && typeof map.getSource === 'function' ? map.getSource(BASEMAP_SOURCE) : null;
  if (!src || typeof src.setSourceProperty !== 'function') return false;
  src.setSourceProperty(() => {
    const o = src._options;
    if (which === 'fallback') {
      delete o.tiles;
      o.url = FALLBACK_TILEJSON; src.url = FALLBACK_TILEJSON;
      o.attribution = FALLBACK_ATTRIBUTION; src.attribution = FALLBACK_ATTRIBUTION;
    } else {
      delete o.url; delete src.url;
      o.tiles = MAPTILER_TILES.slice();
      o.attribution = MAPTILER_ATTRIBUTION; src.attribution = MAPTILER_ATTRIBUTION;
    }
  });
  return true;
}

/**
 * The session's basemap state: 'maptiler' (the default), 'fallback', or 'none' (the fallback failed too).
 * `onChange(state)` runs on every change (the notice follows it).
 * @param {{ getMap: () => any, getKey: () => string|null, onChange?: (state: string) => void }} deps
 */
export function createBasemapFallback({ getMap, getKey, onChange = () => {} }) {
  let state = 'maptiler';
  const set = (next) => { if (next !== state) { state = next; onChange(state); } };
  return {
    get state() { return state; },
    /** A maplibre 'error' event. Returns true when it switched the basemap. */
    onMapError(e) {
      const err = (e && e.error) || {};
      const sourceId = e && e.sourceId;
      if (state !== 'maptiler') {
        // A MapTiler request still in flight from before the switch is stale; a missing tile (404) is a hole in
        // the planet, not a dead service.
        const stale = typeof err.url === 'string' && MAPTILER.test(err.url);
        if (state === 'fallback' && sourceId === BASEMAP_SOURCE && !stale && err.status !== 404) set('none');
        return false;
      }
      if (!shouldFallBack({ onFallback: false, sourceId, status: err.status, url: err.url, key: getKey() })) return false;
      pointBasemap(getMap(), 'fallback');
      set('fallback');
      return true;
    },
    /**
     * A new key arrived: back to MapTiler, whatever state the session is in. The source reloads even when it never left
     * MapTiler: a keyless tile that errored is never asked for again by maplibre 3.6.2 (SourceCache.reload skips an
     * errored tile), and the reload clears it. Returns true when the state changed.
     */
    onKey() {
      pointBasemap(getMap(), 'maptiler');
      const changed = state !== 'maptiler';
      set('maptiler');
      return changed;
    },
  };
}
