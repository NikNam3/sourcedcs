// ═══════════════════════════════════════════════════════════
// map-render.js — SVG map drawing orchestrator (drawMap + mapLabel)
// ═══════════════════════════════════════════════════════════

'use strict';

// Refresh the currently open map popup after a display-mode change
// (coord format or time mode).  Set by drawMap; called from app.js.
let _refreshPopup = null;
function mapRefreshPopup() { if (_refreshPopup) _refreshPopup(); }

// ── Measurement helpers ────────────────────────────────────────
// Speed used for transit-time calculation on the measurement band.
const MEAS_SPEED_KT = 400;

// Great-circle distance between two lat/lon points in nautical miles.
function haversineNm(lat1, lon1, lat2, lon2) {
  const R   = 3440.065; // Earth radius in NM
  const toR = d => d * Math.PI / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Format a decimal-hour duration as "Xh XXm" or "XXm".
function fmtMeasureTime(hours) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

// ── Main draw ──────────────────────────────────────────────
// Architecture:
//   SVG
//     <rect> sea bg (static)
//     <g id="clip-wrapper" clip-path="url(#map-clip)">   ← clips to canvas
//       <g id="content" transform="translate/scale">      ← pans & zooms
//         grid, land, cities, per-mission route groups, markers
//     <g id="overlay">  ← grid labels at fixed positions (redrawn on pan)
//
// Per-mission <g data-msn> groups allow opacity toggling for route filter.
//
// Drawing helpers live in:
//   map-draw-layers.js  — drawGrid, drawLand, drawCities
//   map-draw-zones.js   — drawEngagementZones, drawAirspaces, generateRacetrack
//   map-draw-routes.js  — drawRoutes
//   map-draw-markers.js — drawSharedMarkers, drawThreatMarkers
//   map-ui.js           — fmtCoord, createPopup, createGridLabelOverlay, createSidebar

// ── Map layout constants ───────────────────────────────────────
const MAP_WIDTH  = 1400; // SVG viewBox width  (px)
const MAP_HEIGHT = 780;  // SVG viewBox height (px)

// ── Zoom limits ────────────────────────────────────────────────
const MIN_ZOOM = 1.0; // can't zoom out past the initial full-canvas fit
const MAX_ZOOM = 20;  // maximum magnification

// ── Bounding-box padding ───────────────────────────────────────
// Extra breathing room added around the data bbox so features aren't clipped.
const BBOX_PADDING_RATIO = 0.28; // fraction of the data span added on each side
const BBOX_MIN_SPAN      = 1.5;  // minimum bbox span in degrees (avoids degenerate bboxes)

// ── Pan clamp margin ───────────────────────────────────────────
// How far the content edge may move beyond the canvas boundary before clamping.
const PAN_MARGIN_RATIO = 0.1; // fraction of MAP_WIDTH

// ── Marker scale damping ───────────────────────────────────────
// Markers scale by 1/zoom^DAMPING — they shrink as you zoom in, but slowly.
const MARKER_SCALE_DAMPING = 0.8;

// Returns the coordinate grid step (degrees) appropriate for the given longitude span.
function gridStep(spanDeg) {
  if (spanDeg > 30) return 10;
  if (spanDeg > 15) return 5;
  if (spanDeg > 6)  return 2;
  return 1;
}

function drawMap(container, points, routes, geoData, airspaces) {
  airspaces = airspaces || [];
  const movie = STATE.theme === 'movie';
  const C = movie ? {
    sea:'#06111e', land:'#131f11', border:'#2a5438',
    grid:'rgba(57,255,122,0.06)', gridLbl:'rgba(57,255,122,0.35)',
    cityDot:'#b0e8c0', cityLbl:'#6a9878', cityMajor:'#d0f0e0',
    af:'#70c8ff', cv:'#ffd080', dim: 0.06,
  } : {
    sea:'#7aaec8', land:'#e8e0d0', border:'#8a7060',
    grid:'rgba(0,0,0,0.07)', gridLbl:'rgba(0,0,0,0.38)',
    cityDot:'#2a1a0a', cityLbl:'#5a4030', cityMajor:'#1a0800',
    af:'#1858c8', cv:'#8b4500', dim: 0.06,
  };

  const W = MAP_WIDTH;
  const H = MAP_HEIGHT;

  // Markers that should stay constant size when zooming
  const constantSizeMarkers = [];

  // ── Bounding box of all data ──────────────────────────────
  let minLon=Infinity,maxLon=-Infinity,minLat=Infinity,maxLat=-Infinity;
  const expand = p => {
    minLon=Math.min(minLon,p.lon); maxLon=Math.max(maxLon,p.lon);
    minLat=Math.min(minLat,p.lat); maxLat=Math.max(maxLat,p.lat);
  };
  points.forEach(expand);
  routes.forEach(r => r.pts.forEach(expand));
  airspaces.forEach(a => {
    if (a.shape === 'circle') {
      const degOffset = (a.radiusNm || DEFAULT_RADIUS_NM) / 60;
      expand({ lon: a.lon - degOffset, lat: a.lat - degOffset });
      expand({ lon: a.lon + degOffset, lat: a.lat + degOffset });
    } else if (a.shape === 'polygon' && a.boundary) {
      a.boundary.forEach(expand);
    } else if (a.shape === 'anchor' && a.anchorPt) {
      const legNm  = a.legLengthNm || DEFAULT_LEG_NM;
      const reach  = (legNm + legNm / 2) / 60;
      expand({ lon: a.anchorPt.lon - reach, lat: a.anchorPt.lat - reach });
      expand({ lon: a.anchorPt.lon + reach, lat: a.anchorPt.lat + reach });
    }
  });

  const lSpan = Math.max(maxLon - minLon, BBOX_MIN_SPAN);
  const aSpan = Math.max(maxLat - minLat, BBOX_MIN_SPAN);
  const lMarg = Math.max(lSpan * BBOX_PADDING_RATIO, BBOX_MIN_SPAN);
  const aMarg = Math.max(aSpan * BBOX_PADDING_RATIO, BBOX_MIN_SPAN);
  const vMinLon = minLon - lMarg, vMaxLon = maxLon + lMarg;
  const vMinLat = minLat - aMarg, vMaxLat = maxLat + aMarg;
  const vLon = vMaxLon - vMinLon, vLat = vMaxLat - vMinLat;

  // Base projection (zoom=1, pan=0,0) — fills canvas exactly
  const bx     = lon => (lon    - vMinLon) / vLon * W;
  const by     = lat => (vMaxLat - lat)    / vLat * H;
  const nmToSvg = nm  => nm / 60 / vLat * H;
  const step   = gridStep(vLon);

  // ── Context object shared by all drawing helpers ──────────
  const ctx = {
    bx, by, nmToSvg,
    C, movie,
    W, H,
    step,
    vMinLon, vMaxLon, vMinLat, vMaxLat, vLon, vLat,
    constantSizeMarkers,
  };

  // ── SVG skeleton ──────────────────────────────────────────
  const svg = makeSvgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: '100%' });
  svg.style.cssText = 'display:block;cursor:grab;touch-action:none;';

  // Clip path — hard edge so nothing drawn outside the canvas bounds is visible
  const clip = makeSvgEl('clipPath', { id: 'mvc' });
  clip.appendChild(makeSvgEl('rect', { x: 0, y: 0, width: W, height: H }));
  const defs = svgEl('defs');
  defs.appendChild(clip);
  svg.appendChild(defs);

  // Static sea background fills the entire canvas
  svg.appendChild(makeSvgEl('rect', { x: 0, y: 0, width: W, height: H, fill: C.sea }));

  // Clip wrapper — contains all map content
  const clipWrap = makeSvgEl('g', { 'clip-path': 'url(#mvc)' });
  svg.appendChild(clipWrap);

  // Inner content group — receives the pan/zoom transform
  const content = makeSvgEl('g', { id: 'map-content' });
  clipWrap.appendChild(content);

  // ── Draw layers ──────────────────────────────────────────
  content.appendChild(drawGrid(ctx));
  content.appendChild(drawLand(ctx, geoData));
  content.appendChild(drawCities(ctx, geoData));

  // ── Popup (needed by subsequent draw calls) ──────────────
  const { showPopup: _showPopup, refreshPopup } = createPopup(container);
  _refreshPopup = refreshPopup;

  // Wrap showPopup so that coord-pick mode intercepts marker clicks:
  // instead of opening the popup, use the clicked point's lat/lon.
  function showPopup(p) {
    if (typeof EDITOR !== 'undefined' && typeof EDITOR._coordPickCb === 'function' &&
        p.lat != null && p.lon != null) {
      EDITOR._coordPickCb(p.lat, p.lon);
      return;
    }
    _showPopup(p);
  }

  // ── Zones ────────────────────────────────────────────────
  const engResult = drawEngagementZones(ctx, points);
  const engZoneG = engResult.group;
  const threatCol = engResult.threatCol;
  content.appendChild(engZoneG);

  const airResult = drawAirspaces(ctx, airspaces, showPopup);
  const airspaceG = airResult.group;
  content.appendChild(airspaceG);

  // ── Routes ───────────────────────────────────────────────
  const msnGroups = drawRoutes(ctx, routes, points, showPopup);
  Object.values(msnGroups).forEach(g => content.appendChild(g));

  // ── Markers ──────────────────────────────────────────────
  content.appendChild(drawSharedMarkers(ctx, points, showPopup));
  const threatG = drawThreatMarkers(ctx, points, threatCol, showPopup);
  content.appendChild(threatG);

  // ── Grid label overlay ───────────────────────────────────
  const gridLabels = createGridLabelOverlay(ctx);
  svg.appendChild(gridLabels.overlay);

  // ── Measurement overlay ──────────────────────────────────
  // All measurement SVG elements live in this group which sits in SVG
  // coordinate space (not the panned/zoomed content group).  Points are
  // stored in content-space so the band tracks the map on pan/zoom.
  const measureLayer = makeSvgEl('g', { 'pointer-events': 'none' });
  svg.appendChild(measureLayer);

  // Measurement state — mode drives the control flow:
  //   'off'   — inactive, button not highlighted
  //   'waitA' — active, waiting for first click to place start point
  //   'waitB' — start point fixed, end point tracks cursor live
  //   'fixed' — both points placed; any left-click clears the band
  const measure = { mode: 'off', ptA: null, ptB: null };

  // Convert content-space (cx, cy) → current SVG overlay coords
  function contentToOverlay(cx, cy) {
    return { x: cx * state.sc + state.tx, y: cy * state.sc + state.ty };
  }

  // Convert a client mouse position → content-space + lat/lon.
  // Uses svg.getScreenCTM() to correctly handle any viewBox scaling /
  // preserveAspectRatio letterbox offset (avoids the horizontal-offset bug).
  function clientToContent(clientX, clientY) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return { cx: 0, cy: 0, lat: 0, lon: 0 };
    const { x: sx, y: sy } = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    const cx = (sx - state.tx) / state.sc;
    const cy = (sy - state.ty) / state.sc;
    const lat = vMaxLat - cy / H * vLat;
    const lon = vMinLon + cx / W * vLon;
    return { cx, cy, lat, lon };
  }

  const MEAS_COL     = '#e8c84a'; // muted gold — less harsh than pure yellow
  const MEAS_FONT    = 10;
  const MEAS_STROKE  = 1.5;

  function redrawMeasure() {
    measureLayer.innerHTML = '';
    if (!measure.ptA) return;

    const a = contentToOverlay(measure.ptA.cx, measure.ptA.cy);
    // Endpoint A — circle + dot
    measureLayer.appendChild(makeSvgEl('circle', {
      cx: a.x, cy: a.y, r: 5,
      fill: 'none', stroke: MEAS_COL, 'stroke-width': MEAS_STROKE,
    }));
    measureLayer.appendChild(makeSvgEl('circle', {
      cx: a.x, cy: a.y, r: 2, fill: MEAS_COL,
    }));

    if (!measure.ptB) return;

    const b = contentToOverlay(measure.ptB.cx, measure.ptB.cy);

    // Dashed line
    measureLayer.appendChild(makeSvgEl('line', {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      stroke: MEAS_COL, 'stroke-width': MEAS_STROKE, 'stroke-dasharray': '6 3',
    }));

    // Endpoint B
    measureLayer.appendChild(makeSvgEl('circle', {
      cx: b.x, cy: b.y, r: 5,
      fill: 'none', stroke: MEAS_COL, 'stroke-width': MEAS_STROKE,
    }));
    measureLayer.appendChild(makeSvgEl('circle', {
      cx: b.x, cy: b.y, r: 2, fill: MEAS_COL,
    }));

    // Distance + time label at midpoint
    const nm  = haversineNm(measure.ptA.lat, measure.ptA.lon, measure.ptB.lat, measure.ptB.lon);
    const hrs = nm / MEAS_SPEED_KT;
    const lbl = `${nm.toFixed(1)} NM  ·  ${fmtMeasureTime(hrs)} @ ${MEAS_SPEED_KT} KT`;
    const mx  = (a.x + b.x) / 2;
    const my  = (a.y + b.y) / 2;

    // Translucent background pill for readability
    const bgRect = makeSvgEl('rect', {
      x: mx - 84, y: my - 18, width: 168, height: 16,
      rx: 3, fill: '#000000', opacity: '0.55',
    });
    measureLayer.appendChild(bgRect);

    measureLayer.appendChild(svgText(lbl, {
      x: mx, y: my - 6,
      'font-size': MEAS_FONT,
      'font-family': MONO_FONT,
      fill: MEAS_COL,
      'text-anchor': 'middle',
    }));
  }

  container.appendChild(svg);

  // Track mousedown position so we can distinguish a clean click from a drag.
  // Only fire coord pick if the mouse didn't move significantly.
  var _pickStart = null;
  var PICK_DRAG_THRESHOLD = 5; // pixels
  svg.addEventListener('mousedown', (e) => {
    if (e.button === 0) _pickStart = { x: e.clientX, y: e.clientY };
    else _pickStart = null;
  });

  // Close popup when clicking the map background, or handle coord pick
  svg.addEventListener('click', (e) => {
    // Coordinate picker mode — capture click position as lat/lon
    if (typeof EDITOR !== 'undefined' && typeof EDITOR._coordPickCb === 'function') {
      // Ignore if the mouse moved significantly (user was dragging, not clicking)
      if (_pickStart) {
        var dx = e.clientX - _pickStart.x;
        var dy = e.clientY - _pickStart.y;
        var threshold = PICK_DRAG_THRESHOLD * PICK_DRAG_THRESHOLD;
        if (dx * dx + dy * dy > threshold) { _pickStart = null; return; }
      }
      _pickStart = null;
      var pt = clientToContent(e.clientX, e.clientY);
      EDITOR._coordPickCb(pt.lat, pt.lon);
      return;
    }
    _pickStart = null;
    const popup = container.querySelector('.map-popup');
    if (popup) popup.style.display = 'none';
  });

  // ── Sidebar ──────────────────────────────────────────────
  const sidebar = createSidebar({
    routes, msnGroups, points, airspaces,
    engZoneG, airspaceG, threatG,
    C, threatCol,
    airspaceColors: airResult.colors,
    defaultAirspaceCol: airResult.defaultCol,
  });
  container.appendChild(sidebar);

  // ── Pan / Zoom ───────────────────────────────────────────
  const state = { tx: 0, ty: 0, sc: 1 };

  function applyTransform() {
    content.setAttribute('transform',
      `translate(${state.tx.toFixed(2)},${state.ty.toFixed(2)}) scale(${state.sc.toFixed(5)})`);
    // Damped inverse scaling keeps markers readable as you zoom in
    const invSc = 1 / Math.pow(state.sc, MARKER_SCALE_DAMPING);
    constantSizeMarkers.forEach(m => {
      m.setAttribute('transform', `translate(${m._baseX},${m._baseY}) scale(${invSc.toFixed(5)})`);
    });
    gridLabels.redraw(state.tx, state.ty, state.sc);
    redrawMeasure();
  }

  function clamp() {
    // At sc=1 content fills exactly W×H. When zoomed in, allow panning but
    // prevent the far edge from moving more than PAN_MARGIN_RATIO inward.
    const margin = MAP_WIDTH * PAN_MARGIN_RATIO;
    state.tx = Math.min(state.tx,  margin);
    state.tx = Math.max(state.tx, -(MAP_WIDTH  * state.sc - MAP_WIDTH  + margin));
    state.ty = Math.min(state.ty,  margin);
    state.ty = Math.max(state.ty, -(MAP_HEIGHT * state.sc - MAP_HEIGHT + margin));
  }

  // Expose current map transform for laser pointer sync.
  // _mapState: live {tx, ty, sc} object — the presenter reads this on mousemove.
  // _applyMapState: applies a {tx, ty, sc} snapshot with clamping so the
  //   presentee's map view tracks the presenter's pan/zoom exactly.
  window._mapState = state;
  window._applyMapState = function (s) {
    if (!s || typeof s.tx !== 'number' || typeof s.ty !== 'number' || typeof s.sc !== 'number') return;
    if (!isFinite(s.tx) || !isFinite(s.ty) || !isFinite(s.sc) || s.sc <= 0) return;
    state.tx = s.tx;
    state.ty = s.ty;
    state.sc = s.sc;
    clamp();
    applyTransform();
  };

  sidebar._resetBtn.addEventListener('click', () => {
    state.tx = 0; state.ty = 0; state.sc = 1;
    clamp();
    applyTransform();
  });

  // ── Measure mode helpers ──────────────────────────────────
  function setMeasureMode(mode) {
    measure.mode = mode;
    sidebar._measureBtn.classList.toggle('map-msn-active', mode !== 'off');
    svg.style.cursor = (mode === 'waitA' || mode === 'waitB') ? 'crosshair' : 'grab';
  }

  function deactivateMeasure() {
    measure.ptA = null;
    measure.ptB = null;
    setMeasureMode('off');
    redrawMeasure();
  }

  // ── Measure button toggle ─────────────────────────────────
  sidebar._measureBtn.addEventListener('click', () => {
    if (measure.mode === 'off') setMeasureMode('waitA');
    else deactivateMeasure();
  });

  // ── Left-click on SVG (click-mode flow) ──────────────────
  // 'off'   → ignore (let interact handle pan)
  // 'waitA' → place ptA, switch to 'waitB' (ptB tracks cursor)
  // 'waitB' → fix ptB, switch to 'fixed'
  // 'fixed' → deactivate (let interact handle pan)
  svg.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (measure.mode === 'off') return;
    if (measure.mode === 'fixed') { deactivateMeasure(); return; }
    e.preventDefault(); // suppress pan while actively measuring
    if (measure.mode === 'waitA') {
      measure.ptA = clientToContent(e.clientX, e.clientY);
      measure.ptB = null;
      setMeasureMode('waitB');
    } else { // waitB → fix second point
      measure.ptB = clientToContent(e.clientX, e.clientY);
      setMeasureMode('fixed');
      e.stopImmediatePropagation(); // prevent interact handler from starting a drag
    }
    redrawMeasure();
  });

  // Any left-click anywhere while in 'fixed' state → deactivate
  window.addEventListener('mousedown', e => {
    if (!svg.isConnected) return;
    if (e.button !== 0 || measure.mode !== 'fixed') return;
    deactivateMeasure();
  });

  // ── Middle-click-and-hold ─────────────────────────────────
  let midMeasuring = false;
  svg.addEventListener('mousedown', e => {
    if (e.button !== 1) return;
    e.preventDefault();
    midMeasuring = true;
    measure.ptA = clientToContent(e.clientX, e.clientY);
    measure.ptB = null;
    setMeasureMode('waitB'); // highlight button + crosshair cursor
    redrawMeasure();
  });

  // Live cursor tracking — used by waitB (click mode) and middle-drag
  let measureRafPending = false;
  let measureMoveX = 0, measureMoveY = 0;
  window.addEventListener('mousemove', e => {
    if (!svg.isConnected) return;
    if (!midMeasuring && measure.mode !== 'waitB') return;
    measureMoveX = e.clientX;
    measureMoveY = e.clientY;
    if (measureRafPending) return;
    measureRafPending = true;
    requestAnimationFrame(() => {
      measureRafPending = false;
      if (!midMeasuring && measure.mode !== 'waitB') return;
      measure.ptB = clientToContent(measureMoveX, measureMoveY);
      redrawMeasure();
    });
  });

  window.addEventListener('mouseup', e => {
    if (!svg.isConnected) return;
    if (e.button !== 1 || !midMeasuring) return;
    midMeasuring = false;
    // Transition to 'fixed' so the band stays visible after releasing middle button
    if (measure.ptB) setMeasureMode('fixed');
    else deactivateMeasure();
  });

  setupInteraction(svg, MAP_WIDTH, MAP_HEIGHT, MIN_ZOOM, MAX_ZOOM, state, applyTransform, clamp,
    () => measure.mode === 'waitA' || measure.mode === 'waitB');

  // Initial render
  applyTransform();
}

// ── Label helper ──────────────────────────────────────────
// Appends two optional text lines to a marker group.
// line1 is bold; line2 is secondary (faded, smaller).
function mapLabel(parent, line1, line2, color, offsetX) {
  [[line1, color, true, -11], [line2 || '', color + '80', false, 1]].forEach(([txt, col, bold, dy]) => {
    if (!txt) return;
    parent.appendChild(svgText(txt, {
      x: offsetX, y: dy,
      'font-size':   bold ? 9 : 7.5,
      'font-family': MONO_FONT,
      'font-weight': bold ? 700 : 400,
      fill: col,
    }));
  });
}
