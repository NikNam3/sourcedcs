// ═══════════════════════════════════════════════════════════
// map-draw-routes.js — Per-mission route groups (lines + markers)
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Hit-target size ────────────────────────────────────────────
const ROUTE_HIT_RADIUS = 14; // transparent click-target radius for waypoints

// ── Route line style ───────────────────────────────────────────
const ROUTE_STROKE_W       = 1.2;     // normal leg line width
const TARGET_LEG_STROKE_W  = 2;       // thicker line for the target approach leg
const ROUTE_STROKE_OPACITY = 0.9;
const ROUTE_DASH           = '2,6';   // dash pattern for normal legs
const TARGET_DASH          = '6,3';   // shorter gap for target approach legs

// ── Waypoint marker sizes ──────────────────────────────────────
const STEER_RING_R     = 4;             // hollow circle radius for steer points
const TARGET_DOT_R     = 2;             // center dot radius for target markers
const TARGET_DIAMOND   = '0,-8 7,0 0,8 -7,0'; // diamond polygon points
const STEER_LABEL_OFFSET  = 7;   // x-offset for steer-point label
const TARGET_LABEL_OFFSET = 10;  // x-offset for target-point label

// ── Per-mission route groups (lines + markers together) ──
// Each mission gets ONE <g data-msn="key"> so we can toggle opacity atomically.
// Returns msnGroups (object mapping msnKey → SVGElement).
function drawRoutes(ctx, routes, points, showPopup) {
  const msnGroups = {};

  routes.forEach(r => {
    const g = svgEl('g');
    g.setAttribute('data-msn', r.msnKey);
    msnGroups[r.msnKey] = g;

    // ── Route lines ──────────────────────────────────────
    for (let i = 0; i < r.pts.length - 1; i++) {
      const p0    = r.pts[i], p1 = r.pts[i + 1];
      const toTgt = p1.kind === 'target-node';
      g.appendChild(makeSvgEl('line', {
        x1: ctx.bx(p0.lon).toFixed(1), y1: ctx.by(p0.lat).toFixed(1),
        x2: ctx.bx(p1.lon).toFixed(1), y2: ctx.by(p1.lat).toFixed(1),
        stroke:             r.color,
        'stroke-width':     toTgt ? TARGET_LEG_STROKE_W : ROUTE_STROKE_W,
        'stroke-dasharray': toTgt ? TARGET_DASH : ROUTE_DASH,
        'stroke-opacity':   ROUTE_STROKE_OPACITY,
        'vector-effect':    'non-scaling-stroke',
      }));
    }

    // ── Steer + target markers ───────────────────────────
    points
      .filter(p => (p.kind === 'steer' || p.kind === 'steer-ref' || p.kind === 'target') &&
                   p.mission?.mission_number === r.msnNum &&
                   p.mission?.callsign       === r.callsign)
      .forEach(p => {
        const mx = ctx.bx(p.lon).toFixed(1);
        const my = ctx.by(p.lat).toFixed(1);
        const mg = makeSvgEl('g', { transform: `translate(${mx},${my})` });
        mg._baseX = mx; mg._baseY = my;

        // Hit circle makes small markers easier to click
        mg.appendChild(makeSvgEl('circle', { r: ROUTE_HIT_RADIUS, fill: 'transparent', stroke: 'none' }));

        if (p.kind === 'steer') {
          mg.appendChild(makeSvgEl('circle', { r: STEER_RING_R, fill: 'none', stroke: p.color, 'stroke-width': ROUTE_STROKE_W }));
          mapLabel(mg, p.sub, p.label, p.color, STEER_LABEL_OFFSET);
        } else if (p.kind === 'steer-ref') {
          // Named-reference waypoint: small hollow circle without a label so the
          // named location's own marker stays the primary map symbol.
          mg.appendChild(makeSvgEl('circle', { r: STEER_RING_R, fill: 'none', stroke: p.color, 'stroke-width': ROUTE_STROKE_W }));
        } else {
          mg.appendChild(makeSvgEl('polygon', { points: TARGET_DIAMOND, fill: p.color + 'cc', stroke: p.color, 'stroke-width': ROUTE_STROKE_W }));
          mg.appendChild(makeSvgEl('circle',  { r: TARGET_DOT_R, fill: '#fff', opacity: 0.9 }));
          mapLabel(mg, p.sub, p.label, p.color, TARGET_LABEL_OFFSET);
        }

        mg.style.cursor = 'pointer';
        mg.addEventListener('click', e => { e.stopPropagation(); showPopup(p); });
        ctx.constantSizeMarkers.push(mg);
        g.appendChild(mg);
      });
  });

  return msnGroups;
}
