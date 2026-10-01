'use strict';

// ── Elevation contour overlay ────────────────────────────────────────────
// MapTiler's ready-made contour vector tileset only has data at zoom 9+
// (verified: the tile server itself returns HTTP 400 below that — it's a
// hard floor in their data product, not a client-side setting). To get
// contours at every zoom level, this computes them ourselves from MapTiler's
// terrain-RGB elevation tiles (available zoom 0-14) using a marching-squares
// isoline trace, run per-tile and cached. Same MapTiler key (config.js MAPTILER_KEY) as the rest of
// the map — no new external dependency.

const ELEV_TILE_SIZE   = 512;   // terrain-rgb-v2 tile pixel dimensions
const ELEV_GRID_STRIDE = 4;     // sample every 4th pixel → 128x128 grid/tile
const ELEV_MAX_TILES   = 64;    // safety cap; skip update if viewport needs more
const ELEV_CACHE_MAX   = 300;   // max decoded tiles kept in memory

const elevTileCache = new Map(); // "z/x/y/interval" → { lines: Feature[], labels: Feature[] }
let elevGeneration = 0;          // bumped on every update() call to discard stale async results

function elevIntervalForZoom(zoom) {
  if (zoom < 6)  return 3000;
  if (zoom < 8)  return 1500;
  if (zoom < 10) return 800;
  if (zoom < 12) return 400;
  return 200;
}

function elevDemZoomForMapZoom(zoom) {
  return Math.min(11, Math.max(5, Math.round(zoom)));
}

function elevLonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = (lon + 180) / 360 * n;
  const latRad = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  return [x, y];
}

// Inverse of the standard slippy-map tile projection — tx/ty may be fractional
// (tile index + sub-tile pixel fraction) to locate a point inside a tile.
function elevTileToLonLat(z, tx, ty) {
  const n = 2 ** z;
  const lon = tx / n * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / n)));
  return [lon, latRad * 180 / Math.PI];
}

// Fetches + decodes one terrain-RGB tile into a meters elevation grid. Shared
// by the contour renderer below (elevFetchGrid, which converts to feet) and
// los.js's point-elevation queries (which want meters directly).
async function elevDecodeTileMeters(z, x, y) {
  const url = `https://api.maptiler.com/tiles/terrain-rgb-v2/${z}/${x}/${y}.webp?key=${MAPTILER_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`terrain-rgb ${z}/${x}/${y}: HTTP ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = document.createElement('canvas');
  canvas.width = ELEV_TILE_SIZE;
  canvas.height = ELEV_TILE_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, ELEV_TILE_SIZE, ELEV_TILE_SIZE).data;

  const n = Math.floor(ELEV_TILE_SIZE / ELEV_GRID_STRIDE);
  const grid = new Float32Array(n * n);
  let min = Infinity, max = -Infinity;
  for (let row = 0; row < n; row++) {
    const py = row * ELEV_GRID_STRIDE;
    for (let col = 0; col < n; col++) {
      const px = col * ELEV_GRID_STRIDE;
      const i = (py * ELEV_TILE_SIZE + px) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // Mapbox Terrain-RGB v1 encoding (MapTiler terrain-rgb-v2 is compatible).
      const meters = -10000 + (r * 256 * 256 + g * 256 + b) * 0.1;
      grid[row * n + col] = meters;
      if (meters < min) min = meters;
      if (meters > max) max = meters;
    }
  }
  return { grid, n, min, max };
}

async function elevFetchGrid(z, x, y) {
  const { grid, n, min, max } = await elevDecodeTileMeters(z, x, y);
  const feetGrid = new Float32Array(n * n);
  for (let i = 0; i < grid.length; i++) feetGrid[i] = grid[i] * 3.28084;
  return { grid: feetGrid, n, min: min * 3.28084, max: max * 3.28084 };
}

// Marching squares over one grid at one threshold level. Returns disjoint
// 2-point segments in fractional-pixel [col,row] space (0..n-1) — rendered
// as a single MultiLineString per level, which reads as a continuous
// contour line without needing to stitch segments into full polylines.
function elevMarchSquares(grid, n, level) {
  const segs = [];
  const interp = (va, pa, vb, pb) => {
    const f = va === vb ? 0.5 : (level - va) / (vb - va);
    return [pa[0] + f * (pb[0] - pa[0]), pa[1] + f * (pb[1] - pa[1])];
  };
  for (let row = 0; row < n - 1; row++) {
    for (let col = 0; col < n - 1; col++) {
      const tl = grid[row * n + col],       tr = grid[row * n + col + 1];
      const bl = grid[(row + 1) * n + col], br = grid[(row + 1) * n + col + 1];
      const pTL = [col, row],     pTR = [col + 1, row];
      const pBL = [col, row + 1], pBR = [col + 1, row + 1];
      const c = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
      if (c === 0 || c === 15) continue;

      const N = () => interp(tl, pTL, tr, pTR);
      const E = () => interp(tr, pTR, br, pBR);
      const S = () => interp(bl, pBL, br, pBR);
      const W = () => interp(tl, pTL, bl, pBL);

      switch (c) {
        case 1: case 14: segs.push([W(), S()]); break;
        case 2: case 13: segs.push([S(), E()]); break;
        case 3: case 12: segs.push([W(), E()]); break;
        case 4: case 11: segs.push([N(), E()]); break;
        case 6: case 9:  segs.push([N(), S()]); break;
        case 7: case 8:  segs.push([N(), W()]); break;
        case 5: segs.push([N(), W()]); segs.push([S(), E()]); break;
        case 10: segs.push([N(), E()]); segs.push([S(), W()]); break;
      }
    }
  }
  return segs;
}

async function elevContoursForTile(z, x, y, intervalFt) {
  const key = `${z}/${x}/${y}/${intervalFt}`;
  const cached = elevTileCache.get(key);
  if (cached) return cached;

  const { grid, n, min, max } = await elevFetchGrid(z, x, y);
  const lines = [];
  const labels = [];
  const startLevel = Math.ceil(min / intervalFt) * intervalFt;
  for (let level = startLevel; level <= max; level += intervalFt) {
    const segs = elevMarchSquares(grid, n, level);
    if (!segs.length) continue;
    const isIndex = Math.round(level / intervalFt) % 5 === 0;

    const coords = segs.map(([p1, p2]) => [
      elevTileToLonLat(z, x + p1[0] / n, y + p1[1] / n),
      elevTileToLonLat(z, x + p2[0] / n, y + p2[1] / n),
    ]);
    lines.push({
      type: 'Feature',
      properties: { isIndex },
      geometry: { type: 'MultiLineString', coordinates: coords },
    });

    if (isIndex) {
      // Label anchor: the segment nearest the tile center, so labels cluster
      // toward the middle of tiles rather than crowding tile edges.
      const center = n / 2;
      let best = null, bestDist = Infinity;
      for (const [p1, p2] of segs) {
        const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
        const d = (mx - center) ** 2 + (my - center) ** 2;
        if (d < bestDist) { bestDist = d; best = [mx, my]; }
      }
      const [lon, lat] = elevTileToLonLat(z, x + best[0] / n, y + best[1] / n);
      labels.push({
        type: 'Feature',
        properties: { text: `${Math.round(level)}'` },
        geometry: { type: 'Point', coordinates: [lon, lat] },
      });
    }
  }

  const result = { lines, labels };
  elevTileCache.set(key, result);
  if (elevTileCache.size > ELEV_CACHE_MAX) {
    elevTileCache.delete(elevTileCache.keys().next().value);
  }
  return result;
}

function elevEmptyFC() {
  return { type: 'FeatureCollection', features: [] };
}

function clearElevationContours() {
  if (!mapReady) return;
  map.getSource('elevation-contours').setData(elevEmptyFC());
  map.getSource('elevation-contour-labels').setData(elevEmptyFC());
}

async function updateElevationContours() {
  if (!mapReady || !settings.showElevation) return;
  const generation = ++elevGeneration;

  const zoom = map.getZoom();
  const intervalFt = elevIntervalForZoom(zoom);
  const demZoom = elevDemZoomForMapZoom(zoom);
  const bounds = map.getBounds();

  const [x0f, y0f] = elevLonLatToTile(bounds.getWest(), bounds.getNorth(), demZoom);
  const [x1f, y1f] = elevLonLatToTile(bounds.getEast(), bounds.getSouth(), demZoom);
  const n = 2 ** demZoom;
  const x0 = Math.max(0, Math.floor(x0f)), x1 = Math.min(n - 1, Math.ceil(x1f));
  const y0 = Math.max(0, Math.floor(y0f)), y1 = Math.min(n - 1, Math.ceil(y1f));

  const tileCount = (x1 - x0 + 1) * (y1 - y0 + 1);
  if (tileCount <= 0 || tileCount > ELEV_MAX_TILES) return; // too zoomed out — leave last good render

  const jobs = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      jobs.push(elevContoursForTile(demZoom, tx, ty, intervalFt).catch(() => null));
    }
  }
  const results = await Promise.all(jobs);
  if (generation !== elevGeneration || !settings.showElevation) return; // superseded by a newer update

  const lines = [], labels = [];
  for (const r of results) {
    if (!r) continue;
    lines.push(...r.lines);
    labels.push(...r.labels);
  }
  map.getSource('elevation-contours').setData({ type: 'FeatureCollection', features: lines });
  map.getSource('elevation-contour-labels').setData({ type: 'FeatureCollection', features: labels });
}

let elevUpdateTimer = null;
function elevScheduleUpdate() {
  clearTimeout(elevUpdateTimer);
  elevUpdateTimer = setTimeout(updateElevationContours, 300);
}

function initElevationContours() {
  map.on('moveend', elevScheduleUpdate);
  if (settings.showElevation) updateElevationContours();
}
