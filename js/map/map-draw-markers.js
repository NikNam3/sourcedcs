// ═══════════════════════════════════════════════════════════
// map-draw-markers.js — Shared markers + threat markers
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Hit-target radius ──────────────────────────────────────────
// Every marker gets a transparent circle of this radius so small symbols
// are easy to click, even at the default zoom level.
const HIT_RADIUS = 18; // SVG px

// ── Bullseye marker ────────────────────────────────────────────
const BULLSEYE_CROSS_HALF  = 15;  // half-length of crosshair lines
const BULLSEYE_RING_R      = 10;  // outer ring radius
const BULLSEYE_DOT_R       = 3;   // center dot radius
const BULLSEYE_LABEL_OFFSET = 17; // x-offset for the callsign label

// ── Airfield marker ────────────────────────────────────────────
const AIRFIELD_CROSS_W      = 12;  // half-width  of the runway bar
const AIRFIELD_CROSS_H      = 7;   // half-height of the runway bar
const AIRFIELD_STROKE_W     = 2.5;
const AIRFIELD_LABEL_OFFSET = 14;

// ── Carrier marker ─────────────────────────────────────────────
const CARRIER_RING_R        = 5;
const CARRIER_MAST_RATIO    = 2.4; // mast height as a multiple of the ring radius
const CARRIER_LABEL_OFFSET  = 14;

// ── Marshal point marker ───────────────────────────────────────
const MARSHAL_HALF          = 8;   // half-diagonal of the diamond
const MARSHAL_RING_R        = 11;  // orbit ring radius
const MARSHAL_LABEL_OFFSET  = 14;

const THREAT_CROSS_HALF    = 7;   // half-size of the × arms
const THREAT_CROSS_STROKE  = 2.5;
const THREAT_DOT_R         = 5;   // threat dot ring radius
const THREAT_LABEL_OFFSET  = 9;

// ── Shared stroke width for marker ring outlines ───────────────
const MARKER_RING_STROKE   = 1.2;

// ── Shared markers (always visible: bullseye, airfields, carriers) ──
// Returns the shared markers <g> element.
function drawSharedMarkers(ctx, points, showPopup) {
  const sharedG = svgEl('g');

  points.filter(p => ['bullseye', 'airfield', 'carrier', 'marshal'].includes(p.kind)).forEach(p => {
    const mx = ctx.bx(p.lon).toFixed(1);
    const my = ctx.by(p.lat).toFixed(1);
    const g  = makeSvgEl('g', { transform: `translate(${mx},${my})` });
    g._baseX = mx; g._baseY = my;

    // Large transparent hit circle for reliable clicking (especially at zoom-in)
    g.appendChild(makeSvgEl('circle', { r: HIT_RADIUS, fill: 'transparent', stroke: 'none' }));

    if (p.kind === 'bullseye') {
      const col = '#ffb020';
      const ch  = BULLSEYE_CROSS_HALF;
      [[-ch, 0, ch, 0], [0, -ch, 0, ch]].forEach(([x1, y1, x2, y2]) =>
        g.appendChild(makeSvgEl('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': 1.5 })));
      g.appendChild(makeSvgEl('circle', { r: BULLSEYE_RING_R, fill: 'none', stroke: col, 'stroke-width': MARKER_RING_STROKE, opacity: 0.5 }));
      g.appendChild(makeSvgEl('circle', { r: BULLSEYE_DOT_R, fill: col }));
      mapLabel(g, p.label, '', col, BULLSEYE_LABEL_OFFSET);

    } else if (p.kind === 'airfield') {
      const col = ctx.C.af;
      const cw  = AIRFIELD_CROSS_W, ch = AIRFIELD_CROSS_H;
      [[-cw, 0, cw, 0], [0, -ch, 0, ch]].forEach(([x1, y1, x2, y2]) =>
        g.appendChild(makeSvgEl('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': AIRFIELD_STROKE_W, 'stroke-linecap': 'round' })));
      mapLabel(g, p.label, p.sub, col, AIRFIELD_LABEL_OFFSET);

    } else if (p.kind === 'carrier') {
      const col  = ctx.C.cv;
      const r    = CARRIER_RING_R;
      const mast = r * CARRIER_MAST_RATIO; // height of the carrier mast/island symbol
      g.appendChild(makeSvgEl('circle', { r, fill: 'none', stroke: col, 'stroke-width': 1.5 }));
      [[0, -r, 0, r], [-r, 0, r, 0], [0, r, 0, mast], [-r, mast, r, mast]].forEach(([x1, y1, x2, y2]) =>
        g.appendChild(makeSvgEl('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': 1.5 })));
      mapLabel(g, p.label, p.sub, col, CARRIER_LABEL_OFFSET);

    } else if (p.kind === 'marshal') {
      // Diamond (rotated square) with a dashed orbit ring — "holding point"
      const col = '#7ec8e3';
      const h   = MARSHAL_HALF;
      const pts = `0,${-h} ${h},0 0,${h} ${-h},0`;
      g.appendChild(makeSvgEl('polygon', {
        points: pts, fill: 'none', stroke: col, 'stroke-width': 1.5,
      }));
      g.appendChild(makeSvgEl('circle', {
        r: MARSHAL_RING_R, fill: 'none', stroke: col,
        'stroke-width': MARKER_RING_STROKE, 'stroke-dasharray': '3 2', opacity: 0.7,
      }));
      mapLabel(g, p.label, p.altitude || '', col, MARSHAL_LABEL_OFFSET);
    }

    g.style.cursor = 'pointer';
    g.addEventListener('click', e => { e.stopPropagation(); showPopup(p); });
    ctx.constantSizeMarkers.push(g);
    sharedG.appendChild(g);
  });

  return sharedG;
}

// ── Threat markers ──────────────────────────────────────
// Returns the threat markers <g> element.
function drawThreatMarkers(ctx, points, threatCol, showPopup) {
  const threatG = svgEl('g');
  threatG.setAttribute('data-role', 'threat-markers');

  points.filter(p => p.kind === 'threat').forEach(p => {
    const mx = ctx.bx(p.lon).toFixed(1);
    const my = ctx.by(p.lat).toFixed(1);
    const g  = makeSvgEl('g', { transform: `translate(${mx},${my})` });
    g._baseX = mx; g._baseY = my;
    g.style.cursor = 'pointer';

    const tc = THREAT_CROSS_HALF;
    g.appendChild(makeSvgEl('circle', { r: HIT_RADIUS, fill: 'transparent', stroke: 'none' }));
    [[-tc, -tc, tc, tc], [tc, -tc, -tc, tc]].forEach(([x1, y1, x2, y2]) =>
      g.appendChild(makeSvgEl('line', { x1, y1, x2, y2, stroke: threatCol, 'stroke-width': THREAT_CROSS_STROKE, 'stroke-linecap': 'round' })));
    g.appendChild(makeSvgEl('circle', { r: THREAT_DOT_R, fill: 'none', stroke: threatCol, 'stroke-width': MARKER_RING_STROKE }));
    mapLabel(g, p.label, p.sub, threatCol, THREAT_LABEL_OFFSET);

    g.addEventListener('click', e => { e.stopPropagation(); showPopup(p); });
    ctx.constantSizeMarkers.push(g);
    threatG.appendChild(g);
  });

  return threatG;
}
