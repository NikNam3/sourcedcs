// ═══════════════════════════════════════════════════════════
// export-pdf.js — PDF export via browser print + export dialog
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Constants ─────────────────────────────────────────────────

// Delay (ms) before auto-triggering print — allows the print window to
// finish loading CSS and fonts before the print dialog appears.
const PDF_PRINT_DELAY_MS = 400;

// Maximum number of radio preset channels shown in the comms table.
const PDF_MAX_PRESET_CHANNELS = 20;

// ── Export dialog ─────────────────────────────────────────────

function openExportDialog() {
  if (!STATE.pkg) { showToast('NO PACKAGE LOADED', 'error'); return; }
  const overlay = document.getElementById('exportDialog');
  if (!overlay) return;
  _populateExportMissionSelect();
  // Reset to YAML format on open
  selectExportFormat('yaml');
  overlay.style.display = 'flex';
}

function closeExportDialog() {
  const overlay = document.getElementById('exportDialog');
  if (overlay) overlay.style.display = 'none';
}

function selectExportFormat(format) {
  document.querySelectorAll('#exportFormatToggle .dialog-role-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.format === format);
  });
  const pdfOpts = document.getElementById('exportPdfOptions');
  if (pdfOpts) pdfOpts.style.display = format === 'pdf' ? '' : 'none';
}

function _populateExportMissionSelect() {
  const sel = document.getElementById('exportMissionSelect');
  if (!sel) return;
  sel.innerHTML = '';
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = '— ALL MISSIONS —';
  sel.appendChild(allOpt);
  const missions = STATE.pkg?.ato?.missions || [];
  missions.forEach((m, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = (m.callsign || '—') + (m.mission_number ? ' · ' + m.mission_number : '');
    sel.appendChild(opt);
  });
}

function submitExportDialog() {
  const activeBtn = document.querySelector('#exportFormatToggle .dialog-role-btn.active');
  const format = activeBtn ? activeBtn.dataset.format : 'yaml';

  if (format === 'yaml') {
    closeExportDialog();
    exportPackageYaml();
    return;
  }

  // PDF
  const sel    = document.getElementById('exportMissionSelect');
  const msnIdx = (sel && sel.value !== '') ? parseInt(sel.value) : -1;

  const sections = {
    map:      document.getElementById('exportChkMap')?.checked      !== false,
    comms:    document.getElementById('exportChkComms')?.checked    !== false,
    timeline: document.getElementById('exportChkTimeline')?.checked !== false,
    spins:    document.getElementById('exportChkSpins')?.checked    !== false,
    weather:  document.getElementById('exportChkWeather')?.checked  !== false,
  };

  closeExportDialog();
  exportPackagePDF(msnIdx, sections);
}

// ── PDF export ────────────────────────────────────────────────

function exportPackagePDF(msnIdx, sections) {
  if (!STATE.pkg) return;

  const missions = STATE.pkg.ato?.missions || [];
  const mission  = msnIdx >= 0 ? missions[msnIdx] : null;
  const msnKey   = mission ? (mission.mission_number || mission.callsign) : null;

  const op  = STATE.pkg.ato?.operation || STATE.pkg.header?.operation || 'ATO BRIEF';
  const day = STATE.pkg.header?.ato_date || STATE.pkg.ato?.ato_day || '';
  const title = [op, mission ? mission.callsign : null, day].filter(Boolean).join(' · ');

  const parts = [];

  if (sections.map)      parts.push(_buildMapSection(msnKey, mission));
  if (sections.comms)    parts.push(_buildCommsSection(mission));
  if (sections.timeline) parts.push(_buildTimelineSection());
  if (sections.spins)    parts.push(_buildSpinsSection());
  if (sections.weather)  parts.push(_buildWeatherSection());

  if (!parts.length) {
    showToast('SELECT AT LEAST ONE SECTION TO EXPORT', 'error');
    return;
  }

  _openPrintWindow(title, parts.join('\n'));
}

// ── Print window ──────────────────────────────────────────────

function _openPrintWindow(title, bodyHtml) {
  const win = window.open('', '_blank', 'width=960,height=700');
  if (!win) {
    showToast('POP-UP BLOCKED — allow pop-ups for PDF export', 'error');
    return;
  }

  // Derive the base URL so CSS imports resolve correctly
  const cssBase = new URL('/css/app.css', window.location.href).href;

  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${_escHtml(title)}</title>
<link rel="stylesheet" href="${cssBase}">
<style>
  body {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    padding: 24px 32px;
    background: #fff;
    color: #111;
    max-width: 960px;
    margin: 0 auto;
  }
  .pdf-title {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 3px;
    border-bottom: 2px solid #333;
    padding-bottom: 6px;
    margin-bottom: 20px;
  }
  .pdf-section {
    margin-bottom: 32px;
    page-break-inside: avoid;
  }
  .pdf-section-title {
    font-size: 10px;
    letter-spacing: 2px;
    font-weight: 700;
    border-bottom: 1px solid #ccc;
    padding-bottom: 4px;
    margin: 0 0 10px 0;
    text-transform: uppercase;
  }
  /* Map */
  .pdf-map svg { width: 100%; height: auto; display: block; }
  /* Comms */
  .pdf-comms-flight { margin-bottom: 20px; }
  .pdf-comms-cs {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 1px;
    margin-bottom: 6px;
  }
  .pdf-freq-label {
    font-size: 9px;
    letter-spacing: 1px;
    color: #555;
    margin: 8px 0 3px;
  }
  table { border-collapse: collapse; width: 100%; font-size: 10px; margin-bottom: 4px; }
  th, td { border: 1px solid #ccc; padding: 3px 7px; text-align: left; }
  th { background: #eee; font-weight: 700; letter-spacing: 0.5px; }
  tr.freq-empty td { color: #bbb; }
  /* Timeline */
  .pdf-tl-wrap { overflow-x: auto; }
  .tl-canvas { display: block; }
  .tl-ticks {
    display: flex;
    height: 18px;
    border-bottom: 1px solid #ccc;
    margin-left: 140px;
    font-size: 8px;
    color: #888;
  }
  .tl-tick { flex: 1 0 0%; border-left: 1px solid #ddd; padding: 2px; white-space: nowrap; }
  .tl-row {
    display: flex;
    align-items: stretch;
    height: 28px;
    border-bottom: 1px solid #f0f0f0;
  }
  .tl-label {
    width: 140px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding-right: 8px;
    font-size: 9px;
  }
  .tl-label-callsign { font-weight: 700; font-size: 10px; }
  .tl-label-type { font-size: 8px; color: #888; }
  .tl-track {
    flex: 1;
    position: relative;
    border-left: 1px solid #ddd;
    overflow: hidden;
  }
  .tl-bar {
    position: absolute;
    top: 3px; bottom: 3px;
    border-radius: 2px;
    display: flex;
    align-items: center;
    padding: 0 3px;
    font-size: 7px;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
  }
  .tl-grid-line {
    position: absolute;
    top: 0; bottom: 0;
    width: 1px;
    background: #eee;
  }
  .tl-marker {
    position: absolute;
    top: 0; bottom: 0;
    width: 2px;
    background: currentColor;
  }
  .tl-marker.takeoff  { background: #1a7a40; }
  .tl-marker.recovery { background: #8b2000; }
  /* SPINS */
  .pdf-spins-sec { margin-bottom: 16px; }
  .pdf-spins-sec-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    border-bottom: 1px solid #ddd;
    padding-bottom: 3px;
    margin-bottom: 6px;
    text-transform: uppercase;
  }
  .pdf-spins-note { font-size: 10px; color: #555; margin-bottom: 4px; }
  .pdf-spins-kv { display: flex; gap: 12px; margin: 2px 0; font-size: 10px; }
  .pdf-spins-k { min-width: 100px; color: #666; flex-shrink: 0; }
  .pdf-spins-v { flex: 1; }
  .pdf-spins-bullet { font-size: 10px; margin: 2px 0 2px 12px; }
  .pdf-spins-heading { font-weight: 700; font-size: 10px; margin: 6px 0 2px; border-left: 3px solid #ccc; padding-left: 6px; }
  .pdf-spins-obj { font-size: 10px; margin: 2px 0; color: #333; }
  /* Weather */
  .pdf-wx-block { border: 1px solid #ccc; margin-bottom: 10px; }
  .pdf-wx-hdr {
    display: flex; align-items: center; gap: 12px;
    background: #f5f5f5; padding: 4px 10px;
    border-bottom: 1px solid #ccc; font-size: 11px;
  }
  .pdf-wx-station { font-weight: 700; font-size: 13px; letter-spacing: 2px; }
  .pdf-wx-time { font-size: 9px; color: #888; }
  .pdf-wx-cat {
    margin-left: auto; padding: 2px 7px;
    font-size: 9px; font-weight: 700; letter-spacing: 1px; color: #fff;
  }
  .pdf-wx-cat-vfr  { background: #1a5c2e; }
  .pdf-wx-cat-mvfr { background: #1a3a6b; }
  .pdf-wx-cat-ifr  { background: #9b1c1c; }
  .pdf-wx-cat-lifr { background: #4a1a6b; }
  .pdf-wx-raw { font-size: 8px; color: #888; padding: 3px 10px;
                border-bottom: 1px solid #eee; word-break: break-all; }
  .pdf-wx-row { display: flex; gap: 8px; padding: 3px 10px;
                border-bottom: 1px solid #f0f0f0; font-size: 10px; }
  .pdf-wx-row:last-child { border-bottom: none; }
  .pdf-wx-lbl { min-width: 130px; color: #888; flex-shrink: 0; font-size: 9px; }
  .pdf-wx-chg-hdr { background: #f8f8f8; padding: 3px 10px;
                     border-top: 1px dashed #ccc; border-bottom: 1px solid #eee;
                     font-size: 9px; font-weight: 700; letter-spacing: 1px; color: #555; }
  .pdf-wx-msn-row { display: flex; gap: 12px; padding: 4px 10px;
                     border-bottom: 1px solid #f0f0f0; font-size: 10px; }
  .pdf-wx-msn-ref { font-weight: 700; min-width: 90px; color: #333; }
  .pdf-wx-subsec { font-size: 9px; letter-spacing: 1.5px; color: #888;
                   padding: 8px 0 3px; border-bottom: 1px solid #ddd; margin-bottom: 6px; }
  @media print {
    body { padding: 0; }
    .pdf-section { page-break-inside: avoid; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
<div class="pdf-title">${_escHtml(title)}</div>
${bodyHtml}
<script>window.onload = function() { setTimeout(function() { window.print(); }, ${PDF_PRINT_DELAY_MS}); };<\/script>
</body>
</html>`);
  win.document.close();
}

// ── Print window helper ───────────────────────────────────────
function _escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Map section ───────────────────────────────────────────────

function _buildMapSection(msnKey, mission) {
  const mapContainer = document.getElementById('map-container');
  const svg = mapContainer ? mapContainer.querySelector('svg') : null;

  if (!svg) {
    return `<div class="pdf-section">
<h2 class="pdf-section-title">MAP</h2>
<p>No map rendered — navigate to the MAP tab first so the chart can be captured.</p>
</div>`;
  }

  const baseLabel = mission
    ? `MAP — ${mission.callsign}${mission.mission_number ? ' · ' + mission.mission_number : ''} ROUTE`
    : 'MAP — ALL ROUTES';

  // Retrieve the projection context and geo data stored by drawMap().
  // Use a dummy constantSizeMarkers array so any new elements drawn for the PDF
  // don't corrupt the live map's marker list.
  const rawCtx  = STATE.mapUI?._ctx;
  const geoData = STATE.mapUI?._geoData;
  const pdfCtx  = rawCtx ? Object.assign({}, rawCtx, { constantSizeMarkers: [] }) : null;

  // ── Shared clone helper ───────────────────────────────────
  // Clones the SVG, strips interactive elements, handles mission dimming,
  // always hides engagement-zone circles, and applies the per-variant rules.
  //
  // mapMode:     'chart' | 'satellite' — controls background layer treatment
  // showTargets: whether to show target-node diamond markers
  // showLabels:  whether to show all text labels
  function _cloneSvg(mapMode, showTargets, showLabels) {
    const clone = svg.cloneNode(true);

    // Remove popups and interactive overlays
    clone.querySelectorAll('.map-popup, .map-tile-attr').forEach(n => n.remove());
    clone.removeAttribute('style');
    // Remove preserveAspectRatio="none" so the SVG scales with correct aspect
    // ratio in the print layout (default xMidYMid meet is what we want).
    clone.removeAttribute('preserveAspectRatio');

    // Reset pan/zoom transform so the PDF always shows the full map, not the
    // user's current zoomed-in / panned view.
    const contentGEl = clone.getElementById('map-content');
    if (contentGEl) contentGEl.removeAttribute('transform');

    // ── Chart background ──────────────────────────────────
    if (mapMode === 'chart') {
      // Ensure the sea-blue background rect is present (absent in satellite mode).
      const existingBg = clone.querySelector('rect:first-child');
      if (!existingBg || existingBg.getAttribute('clip-path')) {
        const ns = 'http://www.w3.org/2000/svg';
        const bg = document.createElementNS(ns, 'rect');
        const vb = (clone.getAttribute('viewBox') || '0 0 1400 780').split(' ');
        bg.setAttribute('x',      vb[0] || '0');
        bg.setAttribute('y',      vb[1] || '0');
        bg.setAttribute('width',  vb[2] || '1400');
        bg.setAttribute('height', vb[3] || '780');
        // Match C.sea from the chart color palette in map-render.js
        bg.setAttribute('fill', '#7aaec8');
        clone.insertBefore(bg, clone.firstChild);
      }

      // If the live map was in satellite/tile mode the SVG won't have land or
      // cities — add them now using the stored ctx + geoData.
      const contentG = clone.getElementById('map-content');
      if (contentG && pdfCtx && geoData) {
        const hasLand   = !!contentG.querySelector('[data-role="land"]');
        const hasCities = !!contentG.querySelector('[data-role="cities"]');
        // Reference node: insert before eng-zones (or before first child)
        const refNode = contentG.querySelector('[data-role="eng-zones"]') || contentG.firstChild;
        if (!hasCities) {
          contentG.insertBefore(drawCities(pdfCtx, geoData), refNode);
        }
        if (!hasLand) {
          const cityNode = contentG.querySelector('[data-role="cities"]') || refNode;
          contentG.insertBefore(drawLand(pdfCtx, geoData), cityNode);
        }
      }
    } else {
      // ── Satellite background ────────────────────────────
      // Remove chart-only SVG layers (land polygons, city dots/labels) so the
      // tile images show through cleanly.
      clone.querySelectorAll('[data-role="land"], [data-role="cities"]').forEach(n => n.remove());

      // Insert satellite tile <image> elements into the content group.
      if (pdfCtx) {
        const contentG = clone.getElementById('map-content');
        if (contentG) {
          const tileG = drawTileBackground(pdfCtx, 'satellite', pdfCtx.vLon);
          contentG.insertBefore(tileG, contentG.firstChild);
        }
      }

      // Ensure a sea-blue fallback rect is present (shown where tiles haven't loaded yet).
      const existingBg = clone.querySelector('rect:first-child');
      if (!existingBg || existingBg.getAttribute('clip-path')) {
        const ns = 'http://www.w3.org/2000/svg';
        const bg = document.createElementNS(ns, 'rect');
        const vb = (clone.getAttribute('viewBox') || '0 0 1400 780').split(' ');
        bg.setAttribute('x',      vb[0] || '0');
        bg.setAttribute('y',      vb[1] || '0');
        bg.setAttribute('width',  vb[2] || '1400');
        bg.setAttribute('height', vb[3] || '780');
        bg.setAttribute('fill', '#1a2530');
        clone.insertBefore(bg, clone.firstChild);
      }
    }

    // Filter mission routes: dim groups that don't belong to the selected mission
    if (msnKey) {
      clone.querySelectorAll('[data-msn]').forEach(g => {
        if (g.getAttribute('data-msn') !== String(msnKey)) {
          g.setAttribute('opacity', '0.07');
        }
      });
    }

    // Always hide engagement zone circles in the PDF
    const engGroup = clone.querySelector('[data-role="eng-zones"]');
    if (engGroup) engGroup.setAttribute('display', 'none');

    // Threat ×-dot markers are always hidden in the PDF (replaced by target-node
    // diamonds in satellite mode — both are hidden in chart mode).
    const threatGroup = clone.querySelector('[data-role="threat-markers"]');
    if (threatGroup) threatGroup.setAttribute('display', 'none');

    // Show or hide target-node (aim-point diamond) markers
    clone.querySelectorAll('[data-role="target-node"]').forEach(g => {
      g.setAttribute('display', showTargets ? '' : 'none');
    });

    // Show or hide all text labels — always explicitly set so labels hidden
    // in the live map are correctly shown/hidden per variant, not inherited
    // from the live map's toggle state.
    clone.querySelectorAll('text').forEach(t => t.setAttribute('display', showLabels ? '' : 'none'));

    return new XMLSerializer().serializeToString(clone);
  }

  // Map 1 — CHART: chart background, no target markers, labels on
  const svgChart = _cloneSvg('chart', false, true);
  // Map 2 — SATELLITE: satellite tile background, target markers visible, labels off
  const svgSat   = _cloneSvg('satellite', true, false);

  return `<div class="pdf-section pdf-map">
<h2 class="pdf-section-title">${_escHtml(baseLabel)} — CHART (NAV)</h2>
${svgChart}
</div>
<div class="pdf-section pdf-map">
<h2 class="pdf-section-title">${_escHtml(baseLabel)} — SATELLITE (THREATS)</h2>
${svgSat}
</div>`;
}

// ── Comms section ─────────────────────────────────────────────

function _buildCommsSection(mission) {
  const comms = STATE.pkg?.comms;
  if (!comms) {
    return `<div class="pdf-section">
<h2 class="pdf-section-title">COMMS</h2>
<p>No comms data in this package.</p>
</div>`;
  }

  let html = '<div class="pdf-section">\n<h2 class="pdf-section-title">COMMS</h2>\n';

  if (Array.isArray(comms.flights) && comms.flights.length > 0) {
    let flights = comms.flights;

    // Filter to the selected mission's callsign when one is chosen
    if (mission && mission.callsign) {
      const cs = mission.callsign.trim().toUpperCase();
      const filtered = flights.filter(f =>
        (f.callsign || '').trim().toUpperCase() === cs ||
        (f.group    || '').trim().toUpperCase() === cs
      );
      if (filtered.length > 0) flights = filtered;
    }

    flights.forEach(flt => {
      html += `<div class="pdf-comms-flight">\n`;
      html += `<div class="pdf-comms-cs">${_escHtml(flt.callsign || flt.group || '—')}`;
      if (flt.group && flt.group !== flt.callsign) {
        html += ` — ${_escHtml(flt.group)}`;
      }
      if (flt.dtc_cartridge) html += ` &nbsp;·&nbsp; DTC: ${_escHtml(flt.dtc_cartridge)}`;
      html += `</div>\n`;
      html += _buildFreqTable('UHF (225–400 MHz)', flt.uhf_presets);
      html += _buildFreqTable('VHF (108–174 MHz)', flt.vhf_presets);
      html += `</div>\n`;
    });
  } else {
    // Legacy flat format — no per-flight filtering possible
    html += _buildFreqTable('UHF (225–400 MHz)', comms.uhf_presets);
    html += _buildFreqTable('VHF (108–174 MHz)', comms.vhf_presets);
  }

  html += '</div>';
  return html;
}

// ── Comms frequency table ─────────────────────────────────────
function _buildFreqTable(label, presets) {
  if (!presets) return '';
  let html = `<p class="pdf-freq-label">${_escHtml(label)}</p>\n`;
  html += '<table><thead><tr><th>CH</th><th>CALLSIGN</th><th>MHz</th><th>ROLE</th></tr></thead><tbody>\n';

  // Build a Map from freq_mhz → metadata for O(1) registry lookups.
  // Use String keys so floating-point precision doesn't affect matching
  // (both sides come from the same YAML parser so string form is identical).
  const freqRegistry = STATE.pkg?.registry?.frequencies;
  const freqMap = new Map();
  if (Array.isArray(freqRegistry)) {
    freqRegistry.forEach(f => { if (f.freq_mhz != null) freqMap.set(String(f.freq_mhz), f); });
  }

  for (let ch = 1; ch <= PDF_MAX_PRESET_CHANNELS; ch++) {
    const key = Object.keys(presets).find(k => parseInt(k) === ch);
    let p;
    if (key !== undefined) {
      const val = presets[key];
      if (val !== null && typeof val === 'object') {
        // Old format: inline {callsign, freq_mhz, role}
        p = val;
      } else {
        // New format: just a freq_mhz number — look up metadata from registry
        const freq = parseFloat(val);
        const meta = !isNaN(freq) ? freqMap.get(String(freq)) || null : null;
        p = {
          callsign: meta ? meta.callsign : null,
          freq_mhz: isNaN(freq) ? null : freq,
          role:     meta ? meta.role : null,
        };
      }
    } else {
      p = { callsign: 'SPARE', freq_mhz: null, role: null };
    }
    const cls = !p.freq_mhz ? ' class="freq-empty"' : '';
    html += `<tr${cls}><td>${ch}</td><td>${_escHtml(p.callsign || '—')}</td><td>${_escHtml(String(p.freq_mhz ?? '—'))}</td><td>${_escHtml(p.role || '')}</td></tr>\n`;
  }
  html += '</tbody></table>\n';
  return html;
}

// ── Timeline section ──────────────────────────────────────────

function _buildTimelineSection() {
  const tlCanvas = document.getElementById('tl-canvas');
  if (!tlCanvas || !tlCanvas.children.length) {
    return `<div class="pdf-section">
<h2 class="pdf-section-title">TIMELINE — ALL MISSIONS</h2>
<p>No timeline data. Load a package with mission time data to see the timeline.</p>
</div>`;
  }

  const clone = tlCanvas.cloneNode(true);
  // Remove click handlers from bars (not needed in print)
  clone.querySelectorAll('.tl-bar, .tl-label').forEach(n => {
    n.removeAttribute('onclick');
  });

  return `<div class="pdf-section">
<h2 class="pdf-section-title">TIMELINE — ALL MISSIONS</h2>
<div class="pdf-tl-wrap">${clone.outerHTML}</div>
</div>`;
}

// ── SPINS section ─────────────────────────────────────────────

function _buildSpinsSection() {
  const spins = STATE.pkg?.spins;
  if (!spins) {
    return `<div class="pdf-section">
<h2 class="pdf-section-title">SPINS</h2>
<p>No SPINS data in this package.</p>
</div>`;
  }

  let html = '<div class="pdf-section">\n<h2 class="pdf-section-title">SPINS</h2>\n';

  (spins.sections || []).forEach(sec => {
    html += `<div class="pdf-spins-sec">\n`;
    html += `<div class="pdf-spins-sec-title">${_escHtml(sec.title || '')}</div>\n`;

    if (sec.note) {
      html += `<div class="pdf-spins-note">${_escHtml(sec.note)}</div>\n`;
    }

    (sec.entries || []).forEach(e => {
      if (e.heading != null) {
        html += `<div class="pdf-spins-heading">${_escHtml(String(e.heading))}</div>\n`;
      } else if (e.label != null) {
        html += `<div class="pdf-spins-kv"><span class="pdf-spins-k">${_escHtml(e.label)}</span><span class="pdf-spins-v">${_escHtml(String(e.value ?? ''))}</span></div>\n`;
      } else if (e.bullet != null) {
        html += `<div class="pdf-spins-bullet">• ${_escHtml(String(e.bullet))}</div>\n`;
      } else if (e.value != null) {
        html += `<div class="pdf-spins-obj">${_escHtml(String(e.value))}</div>\n`;
      }
    });

    if (sec.table) {
      html += '<table><thead><tr>';
      (sec.table.headers || []).forEach(h => {
        html += `<th>${_escHtml(String(h))}</th>`;
      });
      html += '</tr></thead><tbody>\n';
      (sec.table.rows || []).forEach(row => {
        html += '<tr>' + row.map(c => `<td>${_escHtml(String(c ?? '—'))}</td>`).join('') + '</tr>\n';
      });
      html += '</tbody></table>\n';
    }

    html += '</div>\n';
  });

  html += '</div>';
  return html;
}

// ── Weather section ───────────────────────────────────────────

function _buildWeatherSection() {
  const wx = STATE.pkg?.weather;
  if (!wx) {
    return `<div class="pdf-section">
<h2 class="pdf-section-title">WEATHER</h2>
<p>No weather data in this package.</p>
</div>`;
  }

  let html = '<div class="pdf-section">\n<h2 class="pdf-section-title">WEATHER</h2>\n';

  // Header fields
  const hdrPairs = [
    ['ISSUED',      wx.issued],
    ['VALID FROM',  wx.valid_from],
    ['VALID TO',    wx.valid_to],
    ['OPERATION',   wx.operation],
  ].filter(([, v]) => v);
  if (hdrPairs.length) {
    html += '<div style="display:flex;gap:20px;margin-bottom:10px;font-size:10px;">\n';
    hdrPairs.forEach(([k, v]) => {
      html += `<div><span style="color:#888;font-size:8px;letter-spacing:1px;">${_escHtml(k)}</span>` +
              `<br><strong>${_escHtml(String(v))}</strong></div>\n`;
    });
    html += '</div>\n';
  }

  // METARs
  const metars = wx.metars || [];
  if (metars.length > 0) {
    html += '<div class="pdf-wx-subsec">CURRENT CONDITIONS — METAR</div>\n';
    metars.forEach(raw => { html += _buildMetarBlock(String(raw)); });
  }

  // TAFs
  const tafs = wx.tafs || [];
  if (tafs.length > 0) {
    html += '<div class="pdf-wx-subsec">FORECAST — TAF</div>\n';
    tafs.forEach(raw => { html += _buildTafBlock(String(raw)); });
  }

  // Mission weather notes
  const msnWx = wx.mission_wx || [];
  if (msnWx.length > 0) {
    html += '<div class="pdf-wx-subsec">MISSION WEATHER NOTES</div>\n';
    html += '<div class="pdf-wx-block">\n';
    msnWx.forEach(mw => {
      html += `<div class="pdf-wx-msn-row">` +
              `<span class="pdf-wx-msn-ref">${_escHtml(String(mw.mission_ref || '—'))}</span>` +
              `<span>${_escHtml(String(mw.notes || ''))}</span></div>\n`;
    });
    html += '</div>\n';
  }

  html += '</div>';
  return html;
}

// Build HTML for a single decoded METAR block.
// Reuses parseMetar / flightCategory / fmtWind / fmtVisibility / fmtCloud /
// decodePhenomenon from view-weather.js (loaded in the same page scope).
// Build HTML for a single decoded TAF block reuses parseTAF / fmtChangeType
// from the same file.
function _buildMetarBlock(raw) {
  const m = parseMetar(raw);
  const cat = flightCategory(m.clouds, m.visibility_m, m.cavok);
  const catCls = { VFR: 'vfr', MVFR: 'mvfr', IFR: 'ifr', LIFR: 'lifr' }[cat.cat] || 'vfr';
  let h = '<div class="pdf-wx-block">\n';
  h += `<div class="pdf-wx-hdr">` +
       `<span class="pdf-wx-station">${_escHtml(m.station || '—')}</span>` +
       (m.time ? `<span class="pdf-wx-time">Day ${_escHtml(m.day || '??')} ${_escHtml(m.time)}</span>` : '') +
       `<span class="pdf-wx-cat pdf-wx-cat-${catCls}">${_escHtml(cat.cat)}</span>` +
       `</div>\n`;
  h += `<div class="pdf-wx-raw">${_escHtml(m.raw)}</div>\n`;
  h += _wxCondRows(m);
  if (m.temperature_c != null || m.dewpoint_c != null) {
    const t = m.temperature_c != null ? m.temperature_c + '°C' : '—';
    const d = m.dewpoint_c    != null ? m.dewpoint_c    + '°C' : '—';
    h += _wxRow('Temp / Dew', t + '  /  ' + d);
  }
  if (m.qnh_hpa != null) {
    const inhg = m.qnh_inhg != null
      ? m.qnh_inhg.toFixed(2)
      : (m.qnh_hpa / 33.8639).toFixed(2);
    h += _wxRow('QNH', m.qnh_hpa + ' hPa  (' + inhg + ' inHg)');
  }
  if (m.nosig) h += _wxRow('Trend', 'NOSIG — No Significant Change');
  if (m.remarks) h += _wxRow('Remarks', m.remarks);
  h += '</div>\n';
  return h;
}

// Build HTML for a single decoded TAF block.
function _buildTafBlock(raw) {
  const t = parseTAF(raw);
  let h = '<div class="pdf-wx-block">\n';
  h += `<div class="pdf-wx-hdr">` +
       `<span class="pdf-wx-station">${_escHtml(t.station || '—')}</span>` +
       (t.issued_time ? `<span class="pdf-wx-time">Issued Day ${_escHtml(t.issued_day || '??')} ${_escHtml(t.issued_time)}</span>` : '') +
       (t.valid_from  ? `<span class="pdf-wx-time">Valid: ${_escHtml(t.valid_from)} – ${_escHtml(t.valid_to || '—')}</span>` : '') +
       `</div>\n`;
  h += `<div class="pdf-wx-raw">${_escHtml(t.raw)}</div>\n`;
  if (t.nil) { h += `<div class="pdf-wx-row"><span>NIL — No forecast issued</span></div>\n`; }
  else {
    h += `<div class="pdf-wx-chg-hdr">PREVAILING CONDITIONS</div>\n`;
    h += _wxCondRows(t.conditions);
    (t.changes || []).forEach(chg => {
      const period = [chg.from, chg.to].filter(Boolean).join(' – ');
      const label  = fmtChangeType(chg) + (period ? ' · ' + period : '');
      h += `<div class="pdf-wx-chg-hdr">${_escHtml(label)}</div>\n`;
      h += _wxCondRows(chg);
    });
  }
  h += '</div>\n';
  return h;
}

// Shared: render wind / visibility / phenomena / clouds rows.
function _wxCondRows(g) {
  let h = '';
  if (g.wind) h += _wxRow('Wind', fmtWind(g.wind));
  if (g.cavok) {
    h += _wxRow('Visibility', 'CAVOK  (≥10 km, no significant cloud, no weather)');
  } else {
    if (g.visibility_m != null || g.visibility_sm != null)
      h += _wxRow('Visibility', fmtVisibility(g.visibility_m, g.visibility_sm));
    if (g.phenomena && g.phenomena.length)
      h += _wxRow('Present WX', g.phenomena.map(decodePhenomenon).join('  ·  '));
    (g.clouds || []).forEach((c, ci) =>
      h += _wxRow(ci === 0 ? 'Sky Condition' : '', fmtCloud(c)));
  }
  return h;
}

function _wxRow(label, value) {
  return `<div class="pdf-wx-row">` +
         `<span class="pdf-wx-lbl">${_escHtml(label)}</span>` +
         `<span>${_escHtml(String(value ?? ''))}</span></div>\n`;
}
