// ═══════════════════════════════════════════════════════════
// map-draw-layers.js — Grid, land, and city drawing
// ═══════════════════════════════════════════════════════════

'use strict';

// ── City marker constants ─────────────────────────────────────
// Dot radius keyed by population tier (1 = small, 3 = major city).
const CITY_DOT_RADIUS    = { 3: 2.8, 2: 2.0, 1: 1.4 };
const CITY_DOT_OPACITY   = 0.6;
const CITY_LABEL_OPACITY = 0.7;
const CITY_FONT_MAJOR    = 7;  // px — population tier 3
const CITY_FONT_MINOR    = 6;  // px — population tier 1 and 2

// ── Tile background (TACTICAL / ELEVATION / SATELLITE modes) ──

// Tile provider URLs — all are free / open-access, no API key required.
const TILE_URLS = {
  tactical:  (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  elevation: (z, x, y) => `https://tile.opentopomap.org/${z}/${x}/${y}.png`,
  satellite: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
};

// Attribution text displayed in the bottom-right corner of the map.
const TILE_ATTRIBUTION = {
  tactical:  '© OpenStreetMap contributors',
  elevation: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)',
  satellite: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
};

// Maximum tile zoom per provider (provider hard limits / practical detail caps).
const TILE_MAX_ZOOM = {
  tactical:  15, // OpenStreetMap goes up to z19; z15 already very detailed
  elevation: 12, // OpenTopoMap caps at z17; z12 is the sweet spot for topo
  satellite: 15, // ESRI World Imagery goes up to z23; z15 crisp satellite detail
};

// Convert geographic latitude to the web-mercator tile-Y index.
function _latToTileY(lat, z) {
  const latR = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180;
  return Math.floor(
    (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * Math.pow(2, z)
  );
}

// Convert a tile-Y index back to geographic latitude (north edge of tile).
function _tileYToLat(ty, z) {
  const n = Math.PI - 2 * Math.PI * ty / Math.pow(2, z);
  return Math.atan(Math.sinh(n)) * 180 / Math.PI;
}

// Pick a tile zoom level for the given longitude span (degrees).
// maxZ caps the result so we don't exceed provider limits.
function _tileZoom(vLon, maxZ) {
  return Math.max(3, Math.min(maxZ ?? 15, Math.round(Math.log2(7.5 * 360 / vLon))));
}

// Returns a <g> containing SVG <image> elements for the tile background.
// effectiveVLon is the currently-visible longitude span (ctx.vLon / state.sc).
// Passing a smaller effectiveVLon selects a higher zoom level for more detail.
// tileBounds (optional) restricts which tiles are generated to the given
// geographic area — use this when zoomed in to avoid giant tile counts.
function drawTileBackground(ctx, mode, effectiveVLon, tileBounds) {
  const tileG = svgEl('g');
  const urlFn = TILE_URLS[mode];
  if (!urlFn) return tileG;

  const z   = _tileZoom(effectiveVLon ?? ctx.vLon, TILE_MAX_ZOOM[mode]);
  const pow = Math.pow(2, z);

  // Use provided bounds or fall back to the full base viewport.
  const bMinLon = tileBounds ? tileBounds.minLon : ctx.vMinLon;
  const bMaxLon = tileBounds ? tileBounds.maxLon : ctx.vMaxLon;
  const bMinLat = tileBounds ? tileBounds.minLat : ctx.vMinLat;
  const bMaxLat = tileBounds ? tileBounds.maxLat : ctx.vMaxLat;

  // Tile x range covering the viewport longitude span.
  // (+180 shifts from [-180,180] lon space to [0,360] for tile indexing.)
  const txMin = Math.max(0,       Math.floor((bMinLon + 180) / 360 * pow) - 1);
  const txMax = Math.min(pow - 1, Math.ceil( (bMaxLon + 180) / 360 * pow));

  // Tile y range — y increases southward in tile coords.
  const tyMin = Math.max(0,       _latToTileY(bMaxLat, z) - 1);
  const tyMax = Math.min(pow - 1, _latToTileY(bMinLat, z) + 1);

  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) {
      // Tile geographic bounds.
      // Lon: tile x index maps linearly to [-180, 180] longitude range.
      const lon0 = tx       / pow * 360 - 180; // west edge
      const lon1 = (tx + 1) / pow * 360 - 180; // east edge
      const lat0 = _tileYToLat(ty,     z);      // north edge
      const lat1 = _tileYToLat(ty + 1, z);      // south edge

      // Map tile corners to SVG equirectangular coordinates.
      // Tiles use web-mercator so there is a small vertical distortion
      // (~5-15 % at mid-latitudes) — acceptable for a background layer.
      const svgX = ctx.bx(lon0);
      const svgY = ctx.by(lat0);
      const svgW = Math.max(0, ctx.bx(lon1) - svgX);
      const svgH = Math.max(0, ctx.by(lat1) - svgY);

      tileG.appendChild(makeSvgEl('image', {
        href:                urlFn(z, tx, ty),
        x:                   svgX.toFixed(1),
        y:                   svgY.toFixed(1),
        width:               svgW.toFixed(1),
        height:              svgH.toFixed(1),
        preserveAspectRatio: 'none',
      }));
    }
  }

  return tileG;
}

// ── Canvas tile renderer ──────────────────────────────────
//
// All tiles preloaded into _tileImageCache are drawn synchronously via
// drawImage().  The canvas uses CSS pixel coordinates so that 1 bitmap
// pixel = 1 CSS display pixel — no upscaling, no pixelation at any zoom.
//
// On every pan/zoom event drawTilesOnCanvas() is called with the current
// (stateTx, stateTy, stateSc) values.  Tile positions are computed as:
//   cssX = (ctx.bx(lon) * stateSc + stateTx) * rX
//   cssY = (ctx.by(lat) * stateSc + stateTy) * rY
// which exactly matches the SVG content-group transform, keeping tile and
// overlay layers pixel-perfectly aligned without any CSS transform on the canvas.

// Persistent store of loaded HTMLImageElement objects.
// Key: tile URL string.  Value: HTMLImageElement.
const _tileImageCache = new Map();

// Set of (mode/z/tileX/tileY) keys already in _tileImageCache to avoid
// duplicate Image objects across re-renders or mode switches.
const _preloadedKeys = new Set();

// Paint all tiles visible at the current pan/zoom onto canvas2d.
// vpW × vpH: canvas bitmap dimensions (= mapViewport.clientWidth/Height).
// tx, ty, sc: current pan/zoom state (SVG user-unit coords).
// onTileLoaded (optional): called when any tile not yet in cache finishes
//   loading — use it to trigger a canvas repaint so newly arrived tiles appear.
// Tiles already in _tileImageCache are drawn synchronously; cache-miss tiles
// are requested lazily and will appear after onTileLoaded fires a repaint.
function drawTilesOnCanvas(canvas2d, ctx, mode, tx, ty, sc, vpW, vpH, seaColor, onTileLoaded) {
  const urlFn = TILE_URLS[mode];
  if (!urlFn || vpW <= 0 || vpH <= 0) return;

  // Scale factors: SVG user units → CSS pixels
  // (preserveAspectRatio="none" on SVG, so X and Y scale independently)
  const rX = vpW / ctx.W;
  const rY = vpH / ctx.H;

  // Tile zoom level matching the current effective visible lon span
  const z   = _tileZoom(ctx.vLon / sc, TILE_MAX_ZOOM[mode]);
  const pow = Math.pow(2, z);

  // Visible SVG user-unit range (what's on screen right now):
  //   cssX = (svgX * sc + tx) * rX = 0  → svgX = -tx / sc
  //   cssX = vpW                         → svgX = (ctx.W - tx) / sc
  const svgXMin = -tx / sc;
  const svgXMax = (ctx.W - tx) / sc;
  const svgYMin = -ty / sc;
  const svgYMax = (ctx.H  - ty) / sc;

  // Convert SVG unit range → geographic bounds
  const visMinLon = svgXMin / ctx.W * ctx.vLon + ctx.vMinLon;
  const visMaxLon = svgXMax / ctx.W * ctx.vLon + ctx.vMinLon;
  const visMaxLat = ctx.vMaxLat - svgYMin / ctx.H * ctx.vLat;
  const visMinLat = ctx.vMaxLat - svgYMax / ctx.H * ctx.vLat;

  // Tile indices covering the visible area (±1 tile buffer)
  const tileXMin = Math.max(0,       Math.floor((visMinLon + 180) / 360 * pow) - 1);
  const tileXMax = Math.min(pow - 1, Math.ceil( (visMaxLon + 180) / 360 * pow));
  const tileYMin = Math.max(0,       _latToTileY(visMaxLat, z) - 1);
  const tileYMax = Math.min(pow - 1, _latToTileY(visMinLat, z) + 1);

  // Sea-color background — shows only where tiles are missing from cache
  canvas2d.fillStyle = seaColor;
  canvas2d.fillRect(0, 0, vpW, vpH);

  for (let tileX = tileXMin; tileX <= tileXMax; tileX++) {
    for (let tileY = tileYMin; tileY <= tileYMax; tileY++) {
      const url = urlFn(z, tileX, tileY);
      let img = _tileImageCache.get(url);

      if (!img) {
        // Lazy-load: request tile on first encounter; repaint when it arrives.
        img = new Image();
        _tileImageCache.set(url, img);
        if (onTileLoaded) {
          // Only trigger repaint on success — error tiles are skipped on next
          // draw (naturalWidth === 0) and don't need to force a redraw.
          img.addEventListener('load', onTileLoaded, { once: true });
        }
        img.src = url;
      }

      if (!img.complete || img.naturalWidth === 0) continue; // not yet loaded

      // Geographic bounds of this tile
      const lon0 = tileX       / pow * 360 - 180;
      const lon1 = (tileX + 1) / pow * 360 - 180;
      const lat0 = _tileYToLat(tileY,     z);
      const lat1 = _tileYToLat(tileY + 1, z);

      // SVG user-unit positions
      const svgX0 = ctx.bx(lon0);  const svgX1 = ctx.bx(lon1);
      const svgY0 = ctx.by(lat0);  const svgY1 = ctx.by(lat1);

      // CSS pixel positions — same formula as SVG content-group transform
      const cssX = (svgX0 * sc + tx) * rX;
      const cssY = (svgY0 * sc + ty) * rY;
      const cssW = (svgX1 - svgX0) * sc * rX;
      const cssH = (svgY1 - svgY0) * sc * rY;

      canvas2d.drawImage(img, cssX, cssY, cssW, cssH);
    }
  }
}

// ── Tile preloader ────────────────────────────────────────
// Warms _tileImageCache with tiles for the initial viewport at zoom levels
// z0, z0+1, and z0+2.  This covers sc=1 through sc≈4× without any lazy-load
// delay for the most common interaction range.
//
// Higher zoom levels (sc > 4×) are handled lazily by drawTilesOnCanvas():
// cache-miss tiles are fetched on demand and the canvas repainted on arrival.
//
// onProgress(loaded, total) fires as each tile resolves — use it to drive
// a real progress bar.

function preloadTiles(ctx, mode, onProgress) {
  const urlFn = TILE_URLS[mode];
  if (!urlFn) return Promise.resolve();

  const maxZ = TILE_MAX_ZOOM[mode];
  const z0   = _tileZoom(ctx.vLon, maxZ);

  // Collect tile URLs for a geographic bounding box at zoom z.
  function tilesForZBounds(z, minLon, maxLon, minLat, maxLat) {
    const pow  = Math.pow(2, z);
    const txMn = Math.max(0,       Math.floor((minLon + 180) / 360 * pow) - 1);
    const txMx = Math.min(pow - 1, Math.ceil( (maxLon + 180) / 360 * pow));
    const tyMn = Math.max(0,       _latToTileY(maxLat, z) - 1);
    const tyMx = Math.min(pow - 1, _latToTileY(minLat, z) + 1);
    const urls = [];
    for (let tx = txMn; tx <= txMx; tx++) {
      for (let ty = tyMn; ty <= tyMx; ty++) {
        const key = `${mode}/${z}/${tx}/${ty}`;
        if (!_preloadedKeys.has(key)) {
          _preloadedKeys.add(key);
          urls.push(urlFn(z, tx, ty));
        }
      }
    }
    return urls;
  }

  // Preload full viewport at z0, z0+1, z0+2.
  // z0+3 and deeper are lazy-loaded on demand in drawTilesOnCanvas().
  const allUrls = [];
  for (let z = z0; z <= Math.min(z0 + 2, maxZ); z++) {
    allUrls.push(...tilesForZBounds(z, ctx.vMinLon, ctx.vMaxLon, ctx.vMinLat, ctx.vMaxLat));
  }

  if (allUrls.length === 0) return Promise.resolve();

  const total  = allUrls.length;
  let   loaded = 0;

  function loadOne(url) {
    let img = _tileImageCache.get(url);
    if (!img) {
      img = new Image();
      _tileImageCache.set(url, img);
      img.src = url;
    }
    if (img.complete) {
      loaded++;
      if (onProgress) onProgress(loaded, total);
      return Promise.resolve();
    }
    return new Promise(resolve => {
      function done() { loaded++; if (onProgress) onProgress(loaded, total); resolve(); }
      img.addEventListener('load',  function h() {
        img.removeEventListener('load', h); img.removeEventListener('error', h); done();
      });
      img.addEventListener('error', function h() {
        img.removeEventListener('load', h); img.removeEventListener('error', h); done();
      });
    });
  }

  return Promise.all(allUrls.map(loadOne));
}

// ── Grid ─────────────────────────────────────────────────
// Returns the grid <g> element.
function drawGrid(ctx) {
  const gridG = svgEl('g');
  // Lines extend beyond canvas so they stay visible while panning.
  for (let lon = Math.floor(ctx.vMinLon / ctx.step) * ctx.step - ctx.step; lon <= ctx.vMaxLon + ctx.step; lon += ctx.step) {
    gridG.appendChild(makeSvgEl('line', {
      x1: ctx.bx(lon), y1: -ctx.H,
      x2: ctx.bx(lon), y2:  ctx.H * 2,
      stroke: ctx.C.grid, 'stroke-width': 0.5,
    }));
  }
  for (let lat = Math.floor(ctx.vMinLat / ctx.step) * ctx.step - ctx.step; lat <= ctx.vMaxLat + ctx.step; lat += ctx.step) {
    gridG.appendChild(makeSvgEl('line', {
      x1: -ctx.W,      y1: ctx.by(lat),
      x2:  ctx.W * 2,  y2: ctx.by(lat),
      stroke: ctx.C.grid, 'stroke-width': 0.5,
    }));
  }
  return gridG;
}

// ── Land ─────────────────────────────────────────────────
// Returns the land <g> element.
function drawLand(ctx, geoData) {
  const landG = svgEl('g');
  landG.setAttribute('data-role', 'land');
  Object.values(geoData.countries).forEach(poly => {
    landG.appendChild(makeSvgEl('path', {
      d: poly.map((pt, i) =>
        `${i ? 'L' : 'M'}${ctx.bx(pt[0]).toFixed(1)},${ctx.by(pt[1]).toFixed(1)}`).join(' ') + ' Z',
      fill: ctx.C.land,
      stroke: ctx.C.border,
      'stroke-width': 0.8,
      'vector-effect': 'non-scaling-stroke',
    }));
  });
  return landG;
}

// ── Cities ───────────────────────────────────────────────
// Returns the cities <g> element.
function drawCities(ctx, geoData) {
  const cityG = svgEl('g');
  cityG.setAttribute('data-role', 'cities');
  geoData.cities.forEach(city => {
    const major = city.pop === 3;
    const r     = CITY_DOT_RADIUS[city.pop] ?? CITY_DOT_RADIUS[1];
    const mx    = ctx.bx(city.lon).toFixed(1);
    const my    = ctx.by(city.lat).toFixed(1);
    const g     = makeSvgEl('g', { transform: `translate(${mx},${my})` });
    g._baseX = mx; g._baseY = my;

    g.appendChild(makeSvgEl('circle', {
      cx: 0, cy: 0, r,
      fill:    major ? ctx.C.cityMajor : ctx.C.cityDot,
      opacity: CITY_DOT_OPACITY,
    }));
    g.appendChild(svgText(city.n, {
      x: 3, y: -2,
      'font-size':   major ? CITY_FONT_MAJOR : CITY_FONT_MINOR,
      'font-family': MONO_FONT,
      'font-weight': major ? 600 : 400,
      fill:    major ? ctx.C.cityMajor : ctx.C.cityLbl,
      opacity: CITY_LABEL_OPACITY,
    }));

    ctx.constantSizeMarkers.push(g);
    cityG.appendChild(g);
  });
  return cityG;
}
