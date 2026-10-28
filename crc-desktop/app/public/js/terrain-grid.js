// The theater's terrain heights (crc-sync docs/adr/0133): the DCS height cache crc-sync loaded for the mission, fetched
// once per theater from GET /api/terrain/grid (proxied by the local server) and held in memory. The contours
// (elevation.js) and the radar-debug LOS (los.js) read it; nothing in the client asks MapTiler for terrain any more.
// A leaf module: it imports nothing, and the caller passes the auth headers.
//
// No per-tick retry (S-ARCH-77): a load happens when a `theater` message arrives (connect, mission load, new mission
// day). A 404 (no cache for this theater on the server) is remembered until the next `theater` message; any other
// failure waits a back-off, 1 min doubling to 30 min, before the next message may try again.
//
// The file format is crc-sync's src/terrain-grid.js; tests/terrain-grid-parity.test.mjs decodes a file the server wrote.

const MAGIC = 'CRCTERR1';
const HEADER_KEYS = ['format', 'theater', 'spacingM', 'latMin', 'lonMin', 'latStep', 'lonStep', 'rows', 'cols', 'builtAt', 'dcsVersion'];
const UNSAMPLED = -32768;
const EDGE = 1e-6;
const BACKOFF_MIN_MS = 60000;
const BACKOFF_MAX_MS = 30 * 60000;

let grid = null;          // { header, heights: Int16Array }
let etag = null;
let state = { theatre: null, status: 'none', retryAt: 0, backoffMs: BACKOFF_MIN_MS };
let inFlight = null;
const listeners = [];

/** Decodes a cache file (ArrayBuffer). Throws with the reason, like the server. */
export function decodeTerrainGrid(buf) {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 8)) !== MAGIC) throw new Error('not a terrain cache file (bad magic)');
  const len = view.getUint32(8, true);
  if (12 + len > bytes.length) throw new Error('the header runs past the end of the file');
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + len)));
  const keys = Object.keys(header);
  if (keys.length !== HEADER_KEYS.length || !HEADER_KEYS.every((k) => keys.includes(k))) throw new Error('unexpected header keys');
  if (header.format !== 'int16-m') throw new Error(`format ${header.format}`);
  const n = header.rows * header.cols;
  const off = 12 + len;
  if (bytes.length !== off + n * 2) throw new Error('size does not match rows x cols');
  const heights = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const v = view.getInt16(off + i * 2, true);
    if (v === UNSAMPLED) throw new Error('an unfinished build');
    heights[i] = v;
  }
  return { header, heights };
}

/** Height in metres at a position (bilinear), or null: no grid, or outside it. */
export function heightInGrid(g, lat, lon) {
  if (!g) return null;
  const { latMin, lonMin, latStep, lonStep, rows, cols } = g.header;
  const fy = (lat - latMin) / latStep, fx = (lon - lonMin) / lonStep;
  if (!(fy >= -EDGE && fx >= -EDGE && fy <= rows - 1 + EDGE && fx <= cols - 1 + EDGE)) return null;
  const y0 = Math.max(0, Math.min(Math.floor(fy), rows - 2));
  const x0 = Math.max(0, Math.min(Math.floor(fx), cols - 2));
  const ty = Math.min(1, Math.max(0, fy - y0)), tx = Math.min(1, Math.max(0, fx - x0));
  const h = g.heights, i = y0 * cols + x0;
  const south = h[i] + (h[i + 1] - h[i]) * tx;
  const north = h[i + cols] + (h[i + cols + 1] - h[i + cols]) * tx;
  return south + (north - south) * ty;
}

export function terrainGrid() { return grid; }
export function terrainHeightAt(lat, lon) { return heightInGrid(grid, lat, lon); }
export function terrainGridState() { return { ...state, loaded: !!grid, theater: grid ? grid.header.theater : null }; }

/** Runs `fn(grid)` each time the grid changes (loaded, replaced or dropped). */
export function onTerrainGrid(fn) { listeners.push(fn); }

function setGrid(next, nextEtag) {
  if (next === grid) return;
  grid = next;
  etag = nextEtag;
  for (const fn of listeners) { try { fn(grid); } catch (e) { console.warn('[terrain] listener failed', e); } }
}

/**
 * A `theater` message arrived: make sure the grid for `theatre` is loaded. Never throws.
 * @param {string|null} theatre
 * @param {object} headers the auth headers (sync.js _syncAuthHeaders)
 */
export function loadTerrainGrid(theatre, headers = {}, { fetchFn = fetch, now = Date.now } = {}) {
  if (inFlight) return inFlight;
  if (!theatre) { setGrid(null, null); state = { ...state, theatre: null, status: 'none' }; return Promise.resolve(null); }
  const sameTheatre = state.theatre === theatre;
  if (sameTheatre && state.status === 'failed' && now() < state.retryAt) return Promise.resolve(grid);
  if (!sameTheatre) {
    state = { theatre, status: 'none', retryAt: 0, backoffMs: BACKOFF_MIN_MS };
    if (grid && grid.header.theater !== theatre) setGrid(null, null); // another map's heights are never shown
  }
  const h = { ...headers };
  if (grid && etag && grid.header.theater === theatre) h['If-None-Match'] = etag;
  inFlight = (async () => {
    try {
      const res = await fetchFn('/api/terrain/grid', { headers: h });
      if (res.status === 304) { state = { ...state, status: 'loaded' }; return grid; }
      if (res.status === 404) {
        setGrid(null, null);
        state = { ...state, status: 'absent' };
        console.info(`[terrain] crc-sync has no terrain cache for ${theatre}: no contours, radar debug LOS sees to full range`);
        return null;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const g = decodeTerrainGrid(await res.arrayBuffer());
      if (g.header.theater !== theatre) throw new Error(`the grid is for ${g.header.theater}, not ${theatre}`);
      setGrid(g, res.headers.get('etag'));
      state = { theatre, status: 'loaded', retryAt: 0, backoffMs: BACKOFF_MIN_MS };
      return g;
    } catch (e) {
      state = { ...state, status: 'failed', retryAt: now() + state.backoffMs, backoffMs: Math.min(BACKOFF_MAX_MS, state.backoffMs * 2) };
      console.warn(`[terrain] grid unavailable (${e.message}); next try after ${Math.round((state.retryAt - now()) / 1000)} s`);
      return grid;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function _resetTerrainGridForTest() {
  grid = null; etag = null; inFlight = null; listeners.length = 0;
  state = { theatre: null, status: 'none', retryAt: 0, backoffMs: BACKOFF_MIN_MS };
}
