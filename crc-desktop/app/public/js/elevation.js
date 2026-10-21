'use strict';
import { map, mapReady } from './map-handle.js';
import { settings } from './settings.js';
import { terrainGrid, onTerrainGrid } from './terrain-grid.js';

// ── Elevation contour overlay ────────────────────────────────────────────
// Contours at every zoom, traced with marching squares over the theater's DCS height grid (crc-sync docs/adr/0133:
// the cache crc-sync loaded for the mission, fetched once per theater by terrain-grid.js). Nothing here goes to the
// network: no grid (no cache on the server for this theater) means no contours.
//
// The grid is regular in lat/lon. The view is cut into blocks of ELEV_BLOCK x ELEV_BLOCK cells sampled every `stride`
// grid cells, a power of two picked so a sample is about ELEV_TARGET_PX screen pixels apart; a block's contours are
// cached per stride and interval, so a pan re-traces only the blocks that came into view.

const ELEV_BLOCK       = 64;    // sampled cells per block side
const ELEV_TARGET_PX   = 4;     // screen pixels between samples (the old terrain-RGB overlay sampled every 4th pixel)
const ELEV_MAX_BLOCKS  = 64;    // safety cap; skip update if viewport needs more
const ELEV_CACHE_MAX   = 300;   // max traced blocks kept in memory
const FT_PER_M         = 3.28084;

const elevBlockCache = new Map(); // "stride/bi/bj/interval" -> { lines: Feature[], labels: Feature[] }

function elevIntervalForZoom(zoom) {
  if (zoom < 6)  return 3000;
  if (zoom < 8)  return 1500;
  if (zoom < 10) return 800;
  if (zoom < 12) return 400;
  return 200;
}

/** Grid cells between samples at a zoom: the smallest power of two putting samples at least ELEV_TARGET_PX apart. */
export function elevStrideFor(zoom, lat, spacingM) {
  const metresPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
  const want = (ELEV_TARGET_PX * metresPerPx) / spacingM;
  return want <= 1 ? 1 : 2 ** Math.ceil(Math.log2(want));
}

// Marching squares over one grid (n columns, nRows rows, row-major) at one threshold level. Returns disjoint
// 2-point segments in fractional [col,row] space, rendered as a single MultiLineString per level, which reads as a
// continuous contour line without needing to stitch segments into full polylines.
export function elevMarchSquares(grid, n, level, nRows = n) {
  const segs = [];
  const interp = (va, pa, vb, pb) => {
    const f = va === vb ? 0.5 : (level - va) / (vb - va);
    return [pa[0] + f * (pb[0] - pa[0]), pa[1] + f * (pb[1] - pa[1])];
  };
  for (let row = 0; row < nRows - 1; row++) {
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

/**
 * The contours of one block: rows [bi*B*s, (bi+1)*B*s] and the same for columns, every s-th grid cell, in feet.
 * Exported for the unit test; the overlay calls it through elevContoursForBlock's cache.
 */
export function elevTraceBlock(g, stride, bi, bj, intervalFt) {
  const { latMin, lonMin, latStep, lonStep, rows, cols } = g.header;
  const r0 = bi * ELEV_BLOCK * stride, c0 = bj * ELEV_BLOCK * stride;
  const nr = Math.min(ELEV_BLOCK, Math.floor((rows - 1 - r0) / stride)) + 1;
  const nc = Math.min(ELEV_BLOCK, Math.floor((cols - 1 - c0) / stride)) + 1;
  const lines = [], labels = [];
  if (nr < 2 || nc < 2) return { lines, labels };
  const grid = new Float32Array(nr * nc);
  let min = Infinity, max = -Infinity;
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) {
      const v = g.heights[(r0 + r * stride) * cols + c0 + c * stride] * FT_PER_M;
      grid[r * nc + c] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const toLonLat = ([col, row]) => [lonMin + (c0 + col * stride) * lonStep, latMin + (r0 + row * stride) * latStep];
  const startLevel = Math.max(intervalFt, Math.ceil(min / intervalFt) * intervalFt); // nothing at or below sea level
  for (let level = startLevel; level <= max; level += intervalFt) {
    const segs = elevMarchSquares(grid, nc, level, nr);
    if (!segs.length) continue;
    const isIndex = Math.round(level / intervalFt) % 5 === 0;
    lines.push({
      type: 'Feature',
      properties: { isIndex },
      geometry: { type: 'MultiLineString', coordinates: segs.map(([p1, p2]) => [toLonLat(p1), toLonLat(p2)]) },
    });
    if (isIndex) {
      // Label anchor: the segment nearest the block centre, so labels do not crowd block edges.
      const cx = (nc - 1) / 2, cy = (nr - 1) / 2;
      let best = null, bestDist = Infinity;
      for (const [p1, p2] of segs) {
        const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
        const d = (mx - cx) ** 2 + (my - cy) ** 2;
        if (d < bestDist) { bestDist = d; best = [mx, my]; }
      }
      labels.push({ type: 'Feature', properties: { text: `${Math.round(level)}'` }, geometry: { type: 'Point', coordinates: toLonLat(best) } });
    }
  }
  return { lines, labels };
}

function elevContoursForBlock(g, stride, bi, bj, intervalFt) {
  const key = `${stride}/${bi}/${bj}/${intervalFt}`;
  const cached = elevBlockCache.get(key);
  if (cached) return cached;
  const result = elevTraceBlock(g, stride, bi, bj, intervalFt);
  elevBlockCache.set(key, result);
  if (elevBlockCache.size > ELEV_CACHE_MAX) elevBlockCache.delete(elevBlockCache.keys().next().value);
  return result;
}

function elevEmptyFC() {
  return { type: 'FeatureCollection', features: [] };
}

export function clearElevationContours() {
  if (!mapReady) return;
  map.getSource('elevation-contours').setData(elevEmptyFC());
  map.getSource('elevation-contour-labels').setData(elevEmptyFC());
}

/** The blocks covering a lon/lat box at a stride, or null when more than ELEV_MAX_BLOCKS (too far out). */
export function elevBlocksFor(g, stride, west, south, east, north) {
  const { latMin, lonMin, latStep, lonStep, rows, cols } = g.header;
  const span = ELEV_BLOCK * stride;
  const clampB = (v, cells) => Math.max(0, Math.min(Math.floor((cells - 2) / span), v));
  const bi0 = clampB(Math.floor((south - latMin) / latStep / span), rows), bi1 = clampB(Math.floor((north - latMin) / latStep / span), rows);
  const bj0 = clampB(Math.floor((west - lonMin) / lonStep / span), cols), bj1 = clampB(Math.floor((east - lonMin) / lonStep / span), cols);
  // Entirely outside the grid: nothing to draw.
  if (north < latMin || south > latMin + (rows - 1) * latStep || east < lonMin || west > lonMin + (cols - 1) * lonStep) return [];
  if ((bi1 - bi0 + 1) * (bj1 - bj0 + 1) > ELEV_MAX_BLOCKS) return null;
  const out = [];
  for (let bi = bi0; bi <= bi1; bi++) for (let bj = bj0; bj <= bj1; bj++) out.push([bi, bj]);
  return out;
}

export async function updateElevationContours() {
  if (!mapReady || !settings.showElevation) return;
  const g = terrainGrid();
  if (!g) { clearElevationContours(); return; }

  const zoom = map.getZoom();
  const intervalFt = elevIntervalForZoom(zoom);
  const bounds = map.getBounds();
  const stride = elevStrideFor(zoom, map.getCenter().lat, g.header.spacingM);
  const blocks = elevBlocksFor(g, stride, bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth());
  if (blocks === null) return; // too zoomed out: leave the last good render

  const lines = [], labels = [];
  for (const [bi, bj] of blocks) {
    const r = elevContoursForBlock(g, stride, bi, bj, intervalFt);
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

export function initElevationContours() {
  map.on('moveend', elevScheduleUpdate);
  // A new grid (another theater, or the first load) invalidates every traced block.
  onTerrainGrid(() => { elevBlockCache.clear(); elevScheduleUpdate(); });
  if (settings.showElevation) updateElevationContours();
}
