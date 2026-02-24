// ═══════════════════════════════════════════════════════════
// map-ui.js — Grid label overlay, popup, sidebar/legend
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Popup ────────────────────────────────────────────────
// Creates the popup div and a showPopup(p) / refreshPopup() pair.
// refreshPopup() re-renders the popup in-place after a display mode change
// (coord format, time mode) so the user doesn't have to click again.
// Returns { popup, showPopup, refreshPopup }.

// Human-readable heading for each point kind.
const KIND_LABELS = {
  steer:    'WAYPOINT',
  target:   'AIM POINT',
  threat:   'THREAT',
  bullseye: 'BULLSEYE',
  airfield: 'AIRFIELD',
  carrier:  'CARRIER',
  airspace: 'AIRSPACE',
  marshal:  'MARSHAL POINT',
};

// ── Per-kind row builders ─────────────────────────────────
// Each function returns [[key, value], …] for its specific point kind.

function buildSteerTargetRows(p) {
  const rows = [['NAME', p.sub], ['MISSION', p.label]];
  if (p.msnType) rows.push(['TYPE', p.msnType]);
  if (p.altitude) rows.push(['TGT ALT', p.altitude]);
  if (p.altFt != null) rows.push(['WP ALT', `${p.altFt.toLocaleString()} FT`]);
  return rows;
}

function buildThreatRows(p) {
  const rows = [['NAME', p.label]];
  if (p.threatType)      rows.push(['TYPE',      p.threatType]);
  if (p.engagementRange) rows.push(['ENG RANGE', `${p.engagementRange} NM`]);
  if (p.maxAlt)          rows.push(['MAX ALT',   `${p.maxAlt.toLocaleString()} FT`]);
  return rows;
}

function buildAirfieldRows(p) {
  const rows = [['ICAO', p.label]];
  if (p.sub)  rows.push(['INFO', p.sub]);
  if (p.name) rows.push(['NAME', p.name]);
  return rows;
}

function buildCarrierRows(p) {
  const rows = [['NAME', p.label]];
  if (p.sub)      rows.push(['STATUS',   p.sub]);
  if (p.callsign) rows.push(['CALLSIGN', p.callsign]);
  return rows;
}

function buildAirspaceRows(p) {
  const rows = [
    ['NAME', p.name || '?'],
    ['TYPE', (p.type || '?').toUpperCase()],
  ];
  if (p.altLower != null || p.altUpper != null) {
    const lo = p.altLower != null ? p.altLower : '?';
    const hi = p.altUpper != null ? p.altUpper : '?';
    rows.push(['ALTITUDE', `${lo} → ${hi}`]);
  }
  if (p.timeFrom != null || p.timeTo != null) {
    const tf = p.timeFrom != null ? fmtTime(p.timeFrom) : '?';
    const tt = p.timeTo   != null ? fmtTime(p.timeTo)   : '?';
    rows.push(['WINDOW', `${tf} – ${tt}`]);
  }
  if (p.agency)           rows.push(['AGENCY',      p.agency]);
  if (p.freq)             rows.push(['FREQ',         `${p.freq} MHz`]);
  if (p.radiusNm)         rows.push(['RADIUS',       `${p.radiusNm} NM`]);
  if (p.anchorPt)         rows.push(['ANCHOR PT',    fmtCoord(p.anchorPt.lat, p.anchorPt.lon)]);
  if (p.headingDeg != null) rows.push(['HOT LEG HDG', `${p.headingDeg}°`]);
  if (p.legLengthNm)      rows.push(['LEG LENGTH',   `${p.legLengthNm} NM`]);
  if (p.direction)        rows.push(['DIRECTION',    p.direction.toUpperCase()]);
  if (p.boundary?.length) rows.push(['BOUNDARY',
    p.boundary.map(pt => fmtCoord(pt.lat, pt.lon)).join(' → ')]);
  if (p.missions?.length) rows.push(['MISSIONS', p.missions.join(', ')]);
  if (p.notes)            rows.push(['NOTES',    p.notes]);
  return rows;
}

// Dispatch: returns the [[key, value], …] rows appropriate for any point kind.
function buildPopupRows(p) {
  if (p.kind === 'steer' || p.kind === 'target') return buildSteerTargetRows(p);
  if (p.kind === 'threat')   return buildThreatRows(p);
  if (p.kind === 'bullseye') return [['NAME', p.label]];
  if (p.kind === 'airfield') return buildAirfieldRows(p);
  if (p.kind === 'carrier')  return buildCarrierRows(p);
  if (p.kind === 'airspace') return buildAirspaceRows(p);
  if (p.kind === 'marshal') {
    const rows = [['NAME', p.label]];
    if (p.altitude) rows.push(['ALTITUDE', p.altitude]);
    return rows;
  }
  return [];
}

function createPopup(container) {
  const popup = el('div', 'map-popup');
  popup.style.display = 'none';
  container.appendChild(popup);

  let lastPoint = null; // track so refreshPopup() can re-render on mode change

  function showPopup(p) {
    lastPoint = p;
    popup.innerHTML = '';

    popup.appendChild(el('div', 'mp-head', KIND_LABELS[p.kind] ?? p.kind.toUpperCase()));

    const rows = buildPopupRows(p);
    if (p.lat != null && p.lon != null) rows.push(['COORDS', fmtCoord(p.lat, p.lon)]);
    rows.forEach(([k, v]) => {
      const row = el('div', 'mp-row');
      row.appendChild(el('span', 'mp-k', k));
      row.appendChild(el('span', 'mp-v', String(v)));
      popup.appendChild(row);
    });

    const closeBtn = el('button', 'mp-close', '×');
    closeBtn.addEventListener('click', () => { popup.style.display = 'none'; });
    popup.appendChild(closeBtn);
    popup.style.display = 'block';
  }

  // Re-render the popup if it's currently visible — called after coord/time mode changes.
  function refreshPopup() {
    if (lastPoint && popup.style.display !== 'none') showPopup(lastPoint);
  }

  return { popup: popup, showPopup: showPopup, refreshPopup: refreshPopup };
}

// ── Grid label overlay ───────────────────────────────────
// Returns { overlay: SVGElement, redraw: function(tx,ty,sc) }
// Longitude labels run along the bottom edge; latitude labels along the left.
// Both are redrawn on every pan/zoom so they always reflect the visible range.
function createGridLabelOverlay(ctx) {
  const overlay = makeSvgEl('g', { 'pointer-events': 'none' });

  // Shared text attributes for all grid labels
  const LABEL_ATTRS = {
    'font-size':   9,
    'font-family': MONO_FONT,
    fill:          ctx.C.gridLbl,
  };

  function redraw(tx, ty, sc) {
    overlay.innerHTML = '';

    // Coordinate conversion helpers for the current pan/zoom state
    const screenToWorldLon = sx => ctx.vMinLon + (sx / sc - tx / sc) / ctx.W * ctx.vLon;
    const worldToScreenX   = lon => (lon - ctx.vMinLon) / ctx.vLon * ctx.W * sc + tx;
    const worldToScreenY   = lat => (ctx.vMaxLat - lat) / ctx.vLat * ctx.H * sc + ty;

    // Longitude labels along the bottom edge
    const visMinLon = screenToWorldLon(0);
    const visMaxLon = screenToWorldLon(ctx.W);
    const lonStart  = Math.floor(visMinLon / ctx.step) * ctx.step;
    const lonEnd    = Math.ceil (visMaxLon / ctx.step) * ctx.step;
    for (let lon = lonStart; lon <= lonEnd; lon += ctx.step) {
      const sx = worldToScreenX(lon);
      if (sx < 20 || sx > ctx.W - 20) continue;
      const label = lon >= 0 ? `${lon}°E` : `${Math.abs(lon)}°W`;
      overlay.appendChild(svgText(label, { ...LABEL_ATTRS, x: sx, y: ctx.H - 6, 'text-anchor': 'middle' }));
    }

    // Latitude labels along the left edge
    const visMinLat = ctx.vMaxLat - (ctx.H / sc - ty / sc) / ctx.H * ctx.vLat;
    const visMaxLat = ctx.vMaxLat - (-ty / sc)              / ctx.H * ctx.vLat;
    const latStart  = Math.floor(visMinLat / ctx.step) * ctx.step;
    const latEnd    = Math.ceil (visMaxLat / ctx.step) * ctx.step;
    for (let lat = latStart; lat <= latEnd; lat += ctx.step) {
      const sy = worldToScreenY(lat);
      if (sy < 10 || sy > ctx.H - 10) continue;
      const label = lat >= 0 ? `${lat}°N` : `${Math.abs(lat)}°S`;
      overlay.appendChild(svgText(label, { ...LABEL_ATTRS, x: 8, y: sy + 3 }));
    }
  }

  return { overlay, redraw };
}

// ── Sidebar / Legend ─────────────────────────────────────
// opts = {
//   routes, msnGroups, points, airspaces,
//   engZoneG, airspaceG, threatG,
//   C, threatCol, airspaceColors, defaultAirspaceCol,
// }
// Returns the sidebar HTMLElement with everything wired.
function createSidebar(opts) {
  const sidebar = el('div', 'map-sidebar');

  // ── Map mode selector ─────────────────────────────────────
  sidebar.appendChild(el('div', 'map-sidebar-title', 'MAP MODE'));

  const MAP_MODES = [
    { id: 'chart',     label: '⊞ CHART'     },
    { id: 'tactical',  label: '⊞ TACTICAL'  },
    { id: 'elevation', label: '⊞ ELEVATION' },
    { id: 'satellite', label: '⊞ SATELLITE' },
  ];
  const currentMode = STATE.mapUI?.mapMode || 'chart';
  MAP_MODES.forEach(({ id, label }) => {
    const btn = el('button', 'map-msn-btn map-mode-btn' + (currentMode === id ? ' map-msn-active' : ''), label);
    btn.addEventListener('click', () => {
      STATE.mapUI.mapMode = id;
      renderMAP(STATE.pkg.ato);
    });
    sidebar.appendChild(btn);
  });

  sidebar.appendChild(el('div', 'map-sidebar-sep'));
  sidebar.appendChild(el('div', 'map-sidebar-title', 'ROUTES'));

  // null = all visible, '__none__' = all hidden, key = solo highlight
  let highlighted = STATE.mapUI?.highlighted ?? null;

  function applyVisibility() {
    Object.entries(opts.msnGroups).forEach(([key, g]) => {
      const visible = highlighted === null || highlighted === key;
      g.setAttribute('opacity', visible ? '1' : String(opts.C.dim));
      if (visible) {
        g.removeAttribute('pointer-events');
      } else {
        g.setAttribute('pointer-events', 'none');
      }
    });
    sidebar.querySelectorAll('.map-msn-btn').forEach(btn => {
      const k = btn.dataset.key;
      if (!k) return;
      btn.classList.toggle('map-msn-active', highlighted === k);
      btn.classList.toggle('map-msn-dimmed', highlighted !== null && highlighted !== k);
    });
    sidebar.querySelector('.map-all-btn')?.classList.toggle('map-msn-active',   highlighted === null);
    sidebar.querySelector('.map-none-btn')?.classList.toggle('map-msn-active',  highlighted === '__none__');
    // Persist to centralized state
    STATE.mapUI.highlighted = highlighted;
  }

  opts.routes.forEach(r => {
    const btn = el('button', 'map-msn-btn');
    btn.dataset.key = r.msnKey;

    const swatch = el('span', 'map-msn-swatch');
    swatch.style.background = r.color;
    btn.appendChild(swatch);
    btn.appendChild(el('span', 'map-msn-label', r.callsign + (r.msnNum ? ' · ' + r.msnNum : '')));

    btn.addEventListener('click', () => {
      highlighted = (highlighted === r.msnKey) ? null : r.msnKey;
      applyVisibility();
    });
    sidebar.appendChild(btn);
  });

  const allBtn = el('button', 'map-msn-btn map-all-btn', '◈ ALL');
  allBtn.classList.add('map-msn-active');
  allBtn.addEventListener('click', () => { highlighted = null; applyVisibility(); });
  sidebar.appendChild(allBtn);

  const noneBtn = el('button', 'map-msn-btn map-none-btn', '◇ NONE');
  noneBtn.addEventListener('click', () => { highlighted = '__none__'; applyVisibility(); });
  sidebar.appendChild(noneBtn);

  sidebar.appendChild(el('div', 'map-sidebar-sep'));

  // Overlays toggle (engagement zones + airspaces)
  const hasEngZones  = opts.points.some(p => p.kind === 'threat' && p.engagementRange);
  const hasAirspaces = opts.airspaces.length > 0;

  if (hasEngZones || hasAirspaces) {
    sidebar.appendChild(el('div', 'map-sidebar-title', 'OVERLAYS'));

    if (hasEngZones) {
      let engVisible = STATE.mapUI?.engVisible !== false;
      const engBtn = el('button', 'map-msn-btn' + (engVisible ? ' map-msn-active' : ''), '◯ ENG ZONES');
      engBtn.addEventListener('click', () => {
        engVisible = !engVisible;
        opts.engZoneG.setAttribute('display', engVisible ? '' : 'none');
        if (opts.threatG) opts.threatG.setAttribute('display', engVisible ? '' : 'none');
        engBtn.classList.toggle('map-msn-active', engVisible);
        STATE.mapUI.engVisible = engVisible;
      });
      // Apply initial visibility from saved state
      if (!engVisible) {
        opts.engZoneG.setAttribute('display', 'none');
        if (opts.threatG) opts.threatG.setAttribute('display', 'none');
      }
      sidebar.appendChild(engBtn);
    }

    if (hasAirspaces) {
      let airspaceVisible = STATE.mapUI?.airVisible !== false;
      const airspaceBtn = el('button', 'map-msn-btn' + (airspaceVisible ? ' map-msn-active' : ''), '◯ AIRSPACES');
      airspaceBtn.addEventListener('click', () => {
        airspaceVisible = !airspaceVisible;
        opts.airspaceG.setAttribute('display', airspaceVisible ? '' : 'none');
        airspaceBtn.classList.toggle('map-msn-active', airspaceVisible);
        STATE.mapUI.airVisible = airspaceVisible;
      });
      // Apply initial visibility from saved state
      if (!airspaceVisible) {
        opts.airspaceG.setAttribute('display', 'none');
      }
      sidebar.appendChild(airspaceBtn);
    }

    sidebar.appendChild(el('div', 'map-sidebar-sep'));
  }

  // Legend — mission types, fixed marker types, airspace types
  sidebar.appendChild(el('div', 'map-sidebar-title', 'LEGEND'));

  // Helper: append a color swatch + label row to the legend
  function addLegendRow(color, label) {
    const row = el('div', 'map-legend-item');
    const dot = el('span', 'map-legend-dot');
    dot.style.background = color;
    row.appendChild(dot);
    row.appendChild(el('span', 'map-legend-lbl', label));
    sidebar.appendChild(row);
  }

  // Mission type rows (only types that appear in the data)
  const seenMsnTypes = [...new Set(opts.points.filter(p => p.msnType).map(p => p.msnType))];
  seenMsnTypes.forEach(t => addLegendRow(typeColor(t), t));

  // Fixed marker types (shown only when present in the data)
  const markerTypes = [
    { check: opts.points.some(p => p.kind === 'bullseye'), color: '#ffb020',      label: 'BULLSEYE'      },
    { check: opts.points.some(p => p.kind === 'airfield'), color: opts.C.af,      label: 'AIRFIELD'      },
    { check: opts.points.some(p => p.kind === 'carrier'),  color: opts.C.cv,      label: 'CARRIER (EST)' },
    { check: opts.points.some(p => p.kind === 'threat'),   color: opts.threatCol, label: 'THREAT'        },
    { check: hasEngZones,                                   color: opts.threatCol, label: 'ENG ZONE'      },
    { check: opts.points.some(p => p.kind === 'marshal'),  color: '#7ec8e3',      label: 'MARSHAL PT'    },
  ];
  markerTypes.forEach(({ check, color, label }) => {
    if (check) addLegendRow(color, label);
  });

  // Airspace type rows (one per unique type seen in the data)
  const seenAirspaceTypes = [...new Set(opts.airspaces.map(a => (a.type || 'OTHER').toUpperCase()))];
  seenAirspaceTypes.forEach(t => {
    addLegendRow(opts.airspaceColors[t] || opts.defaultAirspaceCol, t);
  });

  const measureBtn = el('button', 'map-msn-btn map-measure-btn', '⊕ MEASURE');
  sidebar.appendChild(measureBtn);

  const resetBtn = el('button', 'map-msn-btn map-reset-btn', '⊙ RESET VIEW');
  sidebar.appendChild(resetBtn);

  // Expose buttons so drawMap can wire them
  sidebar._measureBtn = measureBtn;
  sidebar._resetBtn = resetBtn;

  return sidebar;
}
