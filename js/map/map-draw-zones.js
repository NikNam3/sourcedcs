// ═══════════════════════════════════════════════════════════
// map-draw-zones.js — Engagement zones, ACO airspaces
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Airspace fill / stroke style ──────────────────────────────
const AIRSPACE_FILL_OPACITY     = 0.07; // pro theme — semi-transparent fill
const AIRSPACE_FILL_OPACITY_MFD = 0.08; // movie theme — slightly brighter
const AIRSPACE_STROKE_WIDTH     = 1.8;
const AIRSPACE_DASH_ARRAY       = '8,4';

// ── Engagement zone style ──────────────────────────────────────
const ENG_ZONE_STROKE_WIDTH = 1.5;
const ENG_ZONE_DASH_ARRAY   = '6,3';

// ── Zone label style ───────────────────────────────────────────
const ZONE_LABEL_FONT_SIZE = 8;   // px
const ZONE_LABEL_OPACITY   = 0.8;
const ZONE_LABEL_WEIGHT    = 600;

// ── Racetrack generator ────────────────────────────────────────
const ARC_SEGMENTS        = 16; // half-circle arc points per turn
const DIRECTION_ARROW_SIZE = 6; // arrow half-size in SVG px

// ── Airspace field defaults (when YAML omits optional keys) ───
const DEFAULT_RADIUS_NM = 5;
const DEFAULT_LEG_NM    = 10;
const DEFAULT_HEADING   = 0;  // degrees

// ── Private helpers ──────────────────────────────────────

// Add a centered text label to a constantSizeMarkers group at (x, y).
// opts.centralBaseline = true enables dominant-baseline:central (used for
// circle/polygon labels where x,y is the shape center).
function addMapLabel(ctx, parent, x, y, text, col, opts) {
  const g = makeSvgEl('g', { transform: `translate(${x},${y})` });
  g._baseX = x; g._baseY = y;
  const attrs = {
    x: 0, y: 0,
    'text-anchor':    'middle',
    'font-size':      ZONE_LABEL_FONT_SIZE,
    'font-family':    MONO_FONT,
    'font-weight':    ZONE_LABEL_WEIGHT,
    fill:             col,
    opacity:          ZONE_LABEL_OPACITY,
    'pointer-events': 'none',
  };
  if (opts?.centralBaseline) attrs['dominant-baseline'] = 'central';
  g.appendChild(svgText(text, attrs));
  ctx.constantSizeMarkers.push(g);
  parent.appendChild(g);
}

// Create a clickable shape (path or circle) that calls clickFn() on click.
function makeClickable(el, clickFn) {
  el.style.cursor = 'pointer';
  el.addEventListener('click', e => { e.stopPropagation(); clickFn(); });
  return el;
}

// ── Circle airspace ──────────────────────────────────────
function drawCircleAirspace(ctx, a, col, parent, showPopup) {
  const opacity = ctx.movie ? AIRSPACE_FILL_OPACITY_MFD : AIRSPACE_FILL_OPACITY;
  const cx = ctx.bx(a.lon).toFixed(1);
  const cy = ctx.by(a.lat).toFixed(1);
  const r  = ctx.nmToSvg(a.radiusNm || DEFAULT_RADIUS_NM).toFixed(1);
  const open = () => showPopup(a);

  parent.appendChild(makeClickable(
    makeSvgEl('circle', { cx, cy, r, fill: col, opacity }),
    open,
  ));
  parent.appendChild(makeClickable(
    makeSvgEl('circle', {
      cx, cy, r,
      fill: 'none', stroke: col,
      'stroke-width':    AIRSPACE_STROKE_WIDTH,
      'stroke-dasharray': AIRSPACE_DASH_ARRAY,
      'vector-effect':   'non-scaling-stroke',
    }),
    open,
  ));
  addMapLabel(ctx, parent, cx, cy,
    `${a.name || '?'} (${(a.type || '?').toUpperCase()})`, col,
    { centralBaseline: true });
}

// ── Polygon airspace ─────────────────────────────────────
function drawPolygonAirspace(ctx, a, col, parent, showPopup) {
  const opacity = ctx.movie ? AIRSPACE_FILL_OPACITY_MFD : AIRSPACE_FILL_OPACITY;
  const d = a.boundary.map((pt, i) =>
    `${i ? 'L' : 'M'}${ctx.bx(pt.lon).toFixed(1)},${ctx.by(pt.lat).toFixed(1)}`).join(' ') + ' Z';
  const open = () => showPopup(a);

  parent.appendChild(makeClickable(makeSvgEl('path', { d, fill: col, opacity }), open));
  parent.appendChild(makeClickable(
    makeSvgEl('path', {
      d, fill: 'none', stroke: col,
      'stroke-width':    AIRSPACE_STROKE_WIDTH,
      'stroke-dasharray': AIRSPACE_DASH_ARRAY,
      'vector-effect':   'non-scaling-stroke',
    }),
    open,
  ));
  // Label at polygon centroid
  const cx = (a.boundary.reduce((s, pt) => s + ctx.bx(pt.lon), 0) / a.boundary.length).toFixed(1);
  const cy = (a.boundary.reduce((s, pt) => s + ctx.by(pt.lat), 0) / a.boundary.length).toFixed(1);
  addMapLabel(ctx, parent, cx, cy,
    `${a.name || '?'} (${(a.type || '?').toUpperCase()})`, col,
    { centralBaseline: true });
}

// ── Anchor / racetrack airspace ──────────────────────────
// The DCS anchor point marks the END of the hot leg (where the aircraft arrives
// before the first turn).  generateRacetrack() expects the START of the hot leg,
// so we shift the origin backwards along the heading by legNm.
//
// Conversion: 60 NM = 1 degree of latitude/longitude (approximate), so
//   distance_in_degrees = distance_in_nm / 60
function drawAnchorAirspace(ctx, a, col, parent, showPopup) {
  const NM_TO_DEG = 60;  // 1° ≈ 60 NM (used to convert NM offsets to lat/lon degrees)
  const legNm    = a.legLengthNm || DEFAULT_LEG_NM;
  const turnR    = a.widthNm != null ? a.widthNm / 2 : legNm / 4;
  const headRad  = (a.headingDeg || DEFAULT_HEADING) * Math.PI / 180;
  const cosLat   = Math.cos(a.anchorPt.lat * Math.PI / 180);

  // Compute hot-leg start by going backwards from the DCS anchor point
  const startLat = a.anchorPt.lat - legNm / NM_TO_DEG * Math.cos(headRad);
  const startLon = a.anchorPt.lon - legNm / (NM_TO_DEG * cosLat) * Math.sin(headRad);

  const rPts = generateRacetrack(
    startLat, startLon,
    a.headingDeg || DEFAULT_HEADING, legNm,
    turnR,
    a.direction === 'ccw',
  );
  const d = rPts.map((pt, i) =>
    `${i ? 'L' : 'M'}${ctx.bx(pt.lon).toFixed(1)},${ctx.by(pt.lat).toFixed(1)}`).join(' ') + ' Z';
  const opacity = ctx.movie ? AIRSPACE_FILL_OPACITY_MFD : AIRSPACE_FILL_OPACITY;
  const open = () => showPopup(a);

  // Semi-transparent fill (makes the interior clickable, consistent with other shapes)
  parent.appendChild(makeClickable(makeSvgEl('path', { d, fill: col, opacity }), open));
  parent.appendChild(makeClickable(
    makeSvgEl('path', {
      d, fill: 'none', stroke: col,
      'stroke-width': AIRSPACE_STROKE_WIDTH, 'vector-effect': 'non-scaling-stroke',
    }),
    open,
  ));

  // Direction arrow at the midpoint of the hot leg (pointing in heading direction)
  const halfLen  = legNm / 2;
  const midLat   = startLat + Math.cos(headRad) * halfLen / NM_TO_DEG;
  const midLon   = startLon + Math.sin(headRad) * halfLen / (NM_TO_DEG * cosLat);
  const amx = ctx.bx(midLon).toFixed(1);
  const amy = ctx.by(midLat).toFixed(1);

  const adx   = Math.sin(headRad), ady = -Math.cos(headRad);
  const perpX = -ady, perpY = adx;
  const sz    = DIRECTION_ARROW_SIZE;
  const arrowG = makeSvgEl('g', { transform: `translate(${amx},${amy})` });
  arrowG._baseX = amx; arrowG._baseY = amy;
  arrowG.appendChild(makeSvgEl('polygon', {
    points:
      `${(adx * sz).toFixed(1)},${(ady * sz).toFixed(1)} ` +
      `${(-adx * sz + perpX * sz * 0.5).toFixed(1)},${(-ady * sz + perpY * sz * 0.5).toFixed(1)} ` +
      `${(-adx * sz - perpX * sz * 0.5).toFixed(1)},${(-ady * sz - perpY * sz * 0.5).toFixed(1)}`,
    fill: col, opacity: 0.9,
  }));
  ctx.constantSizeMarkers.push(arrowG);
  parent.appendChild(arrowG);

  // Label at the DCS anchor point (top / end of hot leg)
  const lblX = ctx.bx(a.anchorPt.lon).toFixed(1);
  const lblY = (ctx.by(a.anchorPt.lat) - 5).toFixed(1);
  addMapLabel(ctx, parent, lblX, lblY,
    `${a.name || '?'} (${(a.type || '?').toUpperCase()} ${a.direction === 'ccw' ? 'CCW' : 'CW'})`, col);
}

// ── Engagement zones (drawn first, behind routes and markers) ──
// Returns { group: SVGElement, threatCol: string }
function drawEngagementZones(ctx, points) {
  const threatCol = ctx.movie ? '#ff4444' : '#c0392b';
  const fillColor = ctx.movie ? 'rgba(255,68,68,0.08)' : 'rgba(192,57,43,0.07)';
  const engZoneG  = svgEl('g');
  engZoneG.setAttribute('data-role', 'eng-zones');
  points.filter(p => p.kind === 'threat' && p.engagementRange).forEach(p => {
    engZoneG.appendChild(makeSvgEl('circle', {
      cx: ctx.bx(p.lon).toFixed(1),
      cy: ctx.by(p.lat).toFixed(1),
      r:  ctx.nmToSvg(p.engagementRange).toFixed(1),
      fill: fillColor, stroke: threatCol,
      'stroke-width':    ENG_ZONE_STROKE_WIDTH,
      'stroke-dasharray': ENG_ZONE_DASH_ARRAY,
      'vector-effect':   'non-scaling-stroke', 'pointer-events': 'none',
    }));
  });
  return { group: engZoneG, threatCol };
}

// ── ACO airspace measures (orbits, ROZ, restricted zones, etc.) ──
// Returns { group: SVGElement, colors: object, defaultCol: string }
function drawAirspaces(ctx, airspaces, showPopup) {
  const airspaceColors = {
    ROZ:    ctx.movie ? '#ffb347' : '#c07c2b',
    ORBIT:  ctx.movie ? '#4fc3f7' : '#1a3a6b',
    MEZ:    ctx.movie ? '#c084fc' : '#4a1a6b',
    NFZ:    ctx.movie ? '#ff4444' : '#9b1c1c',
    TRA:    ctx.movie ? '#ffb020' : '#7c5000',
    ANCHOR: ctx.movie ? '#00e5ff' : '#006680',
  };
  const defaultAirspaceCol = ctx.movie ? '#6aaa7a' : '#5a6a60';
  const airspaceG = svgEl('g');

  airspaces.forEach(a => {
    const col = airspaceColors[(a.type || '').toUpperCase()] || defaultAirspaceCol;
    if (a.shape === 'circle')                    drawCircleAirspace (ctx, a, col, airspaceG, showPopup);
    else if (a.shape === 'polygon' && a.boundary) drawPolygonAirspace(ctx, a, col, airspaceG, showPopup);
    else if (a.shape === 'anchor'  && a.anchorPt) drawAnchorAirspace (ctx, a, col, airspaceG, showPopup);
  });

  return { group: airspaceG, colors: airspaceColors, defaultCol: defaultAirspaceCol };
}

// ── Racetrack generator ──────────────────────────────────
// Returns an array of {lat,lon} points forming a closed racetrack
// (two parallel legs connected by semicircular turns).
function generateRacetrack(anchorLat, anchorLon, headingDeg, legLengthNm, turnRadiusNm, isCCW) {
  const headRad = headingDeg * Math.PI / 180;
  const cosLat  = Math.cos(anchorLat * Math.PI / 180);
  const nmToLat = 1 / 60;
  const nmToLon = 1 / (60 * cosLat);

  function localToGeo(x, y) {
    return {
      lat: anchorLat + (x * Math.cos(headRad) - y * Math.sin(headRad)) * nmToLat,
      lon: anchorLon + (x * Math.sin(headRad) + y * Math.cos(headRad)) * nmToLon,
    };
  }

  const L = legLengthNm, R = turnRadiusNm;
  const s = isCCW ? -1 : 1; // CW → right turn (+y), CCW → left turn (-y)
  const pts = [];

  // Hot leg: anchor (0,0) → (L,0)
  pts.push(localToGeo(0, 0));
  pts.push(localToGeo(L, 0));

  // Turn 1: semicircle at end of hot leg, center at (L, R*s).
  // The arc must sweep OUTWARD (beyond the hot leg end) — achieved by multiplying
  // the sweep direction by s so CCW arcs go CW in standard maths and vice-versa.
  for (let i = 1; i <= ARC_SEGMENTS; i++) {
    const a = s * (-Math.PI / 2 + Math.PI * i / ARC_SEGMENTS);
    pts.push(localToGeo(L + R * Math.cos(a), s * R + R * Math.sin(a)));
  }

  // Return leg: (L, 2R*s) → (0, 2R*s)
  pts.push(localToGeo(0, 2 * R * s));

  // Turn 2: semicircle at start of hot leg, center at (0, R*s).
  // Must go OUTWARD (x < 0, beyond the hot-leg start) by sweeping in the same
  // rotational direction as Turn 1 — i.e. adding π*i/N so the arc passes
  // through the exterior of the racetrack at (−R, R*s) before closing at (0,0).
  for (let i = 1; i <= ARC_SEGMENTS; i++) {
    const a = s * (Math.PI / 2 + Math.PI * i / ARC_SEGMENTS);
    pts.push(localToGeo(R * Math.cos(a), s * R + R * Math.sin(a)));
  }

  return pts;
}
