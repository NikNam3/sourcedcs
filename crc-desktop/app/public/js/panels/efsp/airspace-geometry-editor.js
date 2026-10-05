'use strict';

// The geometry section of the airspace editor (docs/adr/0098 §5; mockup docs/wip/AIRSP-2P-B-mockup.html scenes 1-3):
// the OUTLINE for an AREA (draw on the map, pick a DCS drawing, refresh from it, clear it) and the ROUTE fix table.
//
//   mountGeometryEditor(container, definition, onChange) -> { destroy(), setReadOnly(reason|null) }
//
//   definition  `kind`, and `geometry` for an AREA, `segments`/`defaultWidthNm` for a ROUTE (the form buffer at mount)
//   onChange    called with a patch: { geometry } or { segments, defaultWidthNm }
//
// Nothing here is saved: every action fills the form buffer, Cancel in the editor undoes it, Save sends it (AIRSP-3).
// The pure half (what a pick copies, the outline's state, the table <-> segments) is airspace-geometry-model.js.

import { missionData } from '../../picture.js';
import { settings } from '../../settings.js';
import { startDraw, stopDraw } from '../../airspace-draw.js';
import { coordFormatOf, formatComponent, formatPair, parseCoord, parsePair, parsePoints } from '../../coords.js';
import { MAX_POLYGON_VERTICES, MAX_ROUTE_SEGMENTS, MAX_WIDTH_NM } from './airspace-validate.js';
import {
  MIN_POLYGON_VERTICES, addFix, blankFix, canAddFix, geometryFromDrawing, legWidthNm, listDrawings, outlineStatus, polygonGeometry,
  polygonProblem, refreshGeometry, removeFix, rowsFromSegments, routeEnvelope, routeSummary, segmentsFromRows, sketchSvg,
} from './airspace-geometry-model.js';
import { altitudeText, parseAltitudeText } from './airspace-draft.js';

const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** The airspace's name as typed in the form around this section (for the map toolbar's title). */
function _nameOf(container) {
  const editor = container.closest('.airspace-editor');
  const row = editor && [...editor.querySelectorAll('.airspace-field')].find(r => /^\W*NAME/.test((r.querySelector('.airspace-field-label') || {}).textContent || ''));
  const input = row && row.querySelector('input');
  return input ? input.value.trim() : '';
}
const drawings = () => (missionData && missionData.drawings) || [];

export function mountGeometryEditor(container, definition, onChange) {
  const route = definition && definition.kind === 'ROUTE';
  const ctx = { container, onChange, readOnly: null, destroyed: false, root: _el('div', 'asg' + (route ? ' asg-route' : ' asg-area')) };
  container.appendChild(ctx.root);
  const view = route ? mountRoute(ctx, definition) : mountArea(ctx, definition);
  return {
    destroy() { ctx.destroyed = true; stopDraw(); ctx.root.remove(); },
    setReadOnly(reason) { ctx.readOnly = reason || null; if (reason) stopDraw(); view.render(); },
  };
}

// ── AREA: the OUTLINE section ────────────────────────────────────────────────────────────────────

function mountArea(ctx, definition) {
  const saved = definition.geometry ?? null;
  const st = { geometry: saved, pickerOpen: false, search: '', textOpen: false, notice: null, drawingNow: false };

  function set(geometry, notice = null) { st.geometry = geometry; st.notice = notice; st.pickerOpen = false; ctx.onChange({ geometry }); render(); }

  function drawOnMap() {
    const pts = st.geometry && st.geometry.points ? st.geometry.points : [];
    st.drawingNow = true;
    const ok = startDraw({
      mode: 'polygon', title: _nameOf(ctx.container), points: pts,
      onDone: (points) => { st.drawingNow = false; if (!same(points, pts)) set(polygonGeometry(points)); else render(); },
      onCancel: () => { st.drawingNow = false; render(); },
    });
    if (!ok) { st.drawingNow = false; st.notice = 'The map is not ready.'; }
    render();
  }

  function render() {
    const root = ctx.root; root.innerHTML = '';
    root.classList.toggle('asg-readonly', !!ctx.readOnly);
    const stat = outlineStatus({ geometry: st.geometry, savedGeometry: saved, drawings: drawings(), readOnlyReason: ctx.readOnly });

    const head = _el('div', 'asg-head');
    head.appendChild(_el('span', 'asg-title', 'OUTLINE'));
    if (stat.changed) head.appendChild(_el('span', 'asg-dot', '•'));
    head.appendChild(_el('span', 'asg-chip', stat.source));
    const count = _el('span', 'asg-count', `${stat.count} points`);
    count.appendChild(_el('span', 'asg-limit', ` · ${MIN_POLYGON_VERTICES} to ${MAX_POLYGON_VERTICES}`));
    head.appendChild(count);
    root.appendChild(head);

    const body = _el('div', 'asg-body');
    const thumb = _el('div', 'asg-thumb');
    thumb.innerHTML = sketchSvg(st.geometry ? st.geometry.points : null, { closed: true });
    body.appendChild(thumb);
    const text = _el('div', 'asg-text');
    if (!st.geometry) {
      text.append(document.createTextNode(saved ? 'No outline. On Save, the map stops drawing it and "is a flight inside" answers ' : 'No outline yet. The map cannot draw this airspace, and "is a flight inside" answers '), Object.assign(_el('b'), { textContent: 'unknown' }), document.createTextNode('.'));
      if (saved) text.appendChild(_el('div', 'asg-was', `was: ${saved.source === 'DCS_DRAWING' ? 'copied from a DCS drawing' : 'drawn'}, ${saved.points.length} points`));
    } else if (st.geometry.source === 'DCS_DRAWING') {
      const ref = st.geometry.drawingRef;
      text.append(document.createTextNode('Copied from '), Object.assign(_el('b'), { textContent: `${ref.layerName} / ${ref.objectName}` }), document.createTextNode('.'));
      if (stat.refresh.differs) text.appendChild(_el('div', '', `The loaded mission's drawing differs: ${stat.refresh.newCount} points now.`));
      if (st.notice) text.appendChild(_el('div', '', st.notice));
    } else {
      text.textContent = 'Drawn on the map.';
      if (st.notice) text.appendChild(_el('div', '', st.notice));
    }
    if (stat.changed && st.geometry && saved) text.appendChild(_el('div', 'asg-was', `was: ${saved.source === 'DCS_DRAWING' ? 'copied from a DCS drawing' : 'drawn'}, ${saved.points.length} points`));
    else if (stat.changed && st.geometry && !saved) text.appendChild(_el('div', 'asg-was', 'was: no outline'));
    body.appendChild(text);
    root.appendChild(body);

    const row = _el('div', 'asg-buttons');
    const btn = (label, enabled, on, extra) => { const b = _el('button', 'asg-btn' + (enabled ? '' : ' asg-disabled'), label); b.type = 'button'; b.disabled = !enabled; if (extra) b.id = extra; if (enabled) b.addEventListener('click', on); return b; };
    row.appendChild(btn(stat.drawLabel, stat.canDraw && !st.drawingNow, drawOnMap, 'asg-draw'));
    const pick = btn(st.pickerOpen ? 'Pick DCS drawing ▴' : 'Pick DCS drawing ▾', stat.canPick, () => { st.pickerOpen = !st.pickerOpen; render(); }, 'asg-pick');
    row.appendChild(pick);
    row.appendChild(btn('Refresh from drawing', stat.refresh.enabled, () => {
      const g = refreshGeometry(st.geometry, drawings(), missionData);
      if (g) set(g, `Refreshed: ${g.points.length} points. Save makes it the outline.`);
    }, 'asg-refresh'));
    row.appendChild(btn('Clear outline', stat.canClear, () => set(null), 'asg-clear'));
    const typeBtn = btn(st.textOpen ? 'Type points ▴' : 'Type points ▾', !ctx.readOnly, () => { st.textOpen = !st.textOpen; render(); }, 'asg-type');
    row.appendChild(typeBtn);
    root.appendChild(row);

    const whys = [stat.drawWhy, stat.clearWhy, stat.refresh.why].filter(Boolean);
    const why = ctx.readOnly ? ctx.readOnly : (stat.refresh.enabled ? (stat.clearWhy || '') : whys.filter(w => w !== ctx.readOnly)[stat.canClear ? 0 : 1] || whys[0] || '');
    root.appendChild(_el('div', 'asg-why', ctx.readOnly ? ctx.readOnly : (stat.refresh.enabled ? `Refresh copies the ${stat.refresh.newCount} points into the form; Save makes it the outline.` : (stat.refresh.why || ''))));
    void why;
    if (st.geometry) { const pr = polygonProblem(st.geometry.points); if (pr) root.appendChild(_el('div', 'asg-why asg-why-bad', pr)); }

    if (st.pickerOpen) root.appendChild(buildPicker());
    if (st.textOpen) root.appendChild(buildTyped());
  }

  function buildPicker() {
    const box = _el('div', 'asg-picker');
    const groups = listDrawings(drawings());
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    const top = _el('div', 'asg-picker-top');
    const search = _el('input'); search.type = 'text'; search.placeholder = 'Search drawings by name or layer'; search.value = st.search;
    search.addEventListener('input', () => { st.search = search.value; render(); const s2 = ctx.root.querySelector('.asg-picker input'); if (s2) { s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); } });
    top.append(search, _el('span', 'asg-drawing-meta', `loaded mission: ${total} drawings`));
    box.appendChild(top);
    const q = st.search.trim().toLowerCase();
    if (!total) box.appendChild(_el('div', 'asg-picker-note', missionData ? 'The loaded mission has no drawings.' : 'No mission is loaded.'));
    for (const g of groups) {
      const items = g.items.filter(it => !q || it.name.toLowerCase().includes(q) || g.layerName.toLowerCase().includes(q));
      if (!items.length) continue;
      box.appendChild(_el('div', 'asg-layer', g.layerName.toUpperCase()));
      for (const it of items) {
        const r = _el('div', 'asg-drawing' + (it.eligible ? '' : ' asg-drawing-off'));
        r.dataset.drawing = String(it.index);
        r.appendChild(_el('span', '', it.name));
        const meta = it.eligible
          ? `${it.shape} · ${it.simplifiedFrom ? `${it.simplifiedFrom} → ${it.pointCount}` : it.pointCount} pts`
          : it.reason;
        r.appendChild(_el('span', 'asg-drawing-meta', meta));
        if (it.eligible) r.addEventListener('click', () => {
          const pick = geometryFromDrawing(drawings(), it.index, missionData);
          if (pick) set(pick.geometry, pick.simplifiedFrom ? `Simplified from ${pick.simplifiedFrom} to ${pick.geometry.points.length} points, within 0.1 NM.` : null);
        });
        box.appendChild(r);
      }
    }
    box.appendChild(_el('div', 'asg-picker-note', 'Click a drawing to copy its points into this outline. The airspace keeps the copy in every mission; the drawing\'s layer and name are kept only so "Refresh from drawing" can find it again. Text and icon drawings are not listed.'));
    return box;
  }

  function buildTyped() {
    const box = _el('div', 'asg-picker');
    const ta = document.createElement('textarea'); ta.rows = 6; ta.className = 'airspace-input'; ta.style.width = '100%';
    const fmt = coordFormatOf(settings.coordFormat);
    ta.value = st.geometry && st.geometry.points ? st.geometry.points.map(p => formatPair(p[0], p[1], fmt)).join('\n') : '';
    ta.placeholder = 'One point per line: decimal degrees, DM, DMS or MGRS';
    const msg = _el('div', 'asg-why');
    const apply = _el('button', 'asg-btn', 'Apply points'); apply.type = 'button';
    apply.addEventListener('click', () => {
      const { points, badLines } = parsePoints(ta.value);
      if (badLines.length) { msg.textContent = `Line ${badLines.join(', ')} ${badLines.length === 1 ? 'is' : 'are'} not a coordinate.`; msg.classList.add('asg-why-bad'); return; }
      const clean = points.length > 1 && points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1] ? points.slice(0, -1) : points;
      set(polygonGeometry(clean));
    });
    box.append(ta, apply, msg);
    return box;
  }

  render();
  return { render };
}

// ── ROUTE: the fix table ─────────────────────────────────────────────────────────────────────────

function mountRoute(ctx, definition) {
  const st = { rows: rowsFromSegments(definition.segments), defaultWidthNm: definition.defaultWidthNm ?? 4, bad: new Set(), navFor: null, mapping: false };
  if (st.rows.length < 2) { st.rows = [blankFix(0), blankFix(1)]; }
  const savedJson = JSON.stringify([definition.segments ?? null, definition.defaultWidthNm ?? null]);

  const emit = () => ctx.onChange({ segments: segmentsFromRows(st.rows), defaultWidthNm: st.defaultWidthNm });
  // A cell edit must not rebuild the table (that would drop the focus a Tab is moving to): it updates these in place.
  const refs = { cells: new Map(), legs: [], lo: null, hi: null, chip: null, dot: null, summary: null };
  const fmt = () => coordFormatOf(settings.coordFormat);

  function cell(row, i, field) {
    const input = _el('input'); input.type = 'text'; input.dataset.row = String(i); input.dataset.field = field;
    const fieldKey = `${i}:${field}`;
    const format = fmt();
    const show = () => {
      if (field === 'name') return row.name ?? '';
      if (field === 'lat') return row.lat == null ? '' : (format === 'MGRS' ? formatPair(row.lat, row.lon ?? 0, 'MGRS').replace(/^(.*)$/, (m) => (row.lon == null ? '' : m)) : formatComponent(row.lat, 'lat', format));
      if (field === 'lon') return row.lon == null ? '' : (format === 'MGRS' ? '' : formatComponent(row.lon, 'lon', format));
      if (field === 'altLowerFt' || field === 'altUpperFt') return altitudeText(row[field], settings.transitionAltFt);
      return row.widthNm == null ? '' : String(row.widthNm);
    };
    input.value = show();
    refs.cells.set(fieldKey, { input, show });
    if (field === 'lon' && format === 'MGRS') { input.disabled = true; input.placeholder = 'in MGRS'; }
    if (field === 'widthNm') input.placeholder = String(st.defaultWidthNm);
    if (field === 'lat' && format === 'MGRS') input.placeholder = '36S XC 12345 12345';
    if (st.bad.has(fieldKey)) input.classList.add('asg-bad');
    if (ctx.readOnly) input.disabled = true;
    input.addEventListener('change', () => {
      const t = input.value.trim();
      st.bad.delete(fieldKey);
      if (field === 'name') row.name = t;
      else if (field === 'lat' || field === 'lon') {
        if (t === '') { row[field] = null; }
        else {
          const pair = field === 'lat' ? parsePair(t) : null; // a whole position (MGRS, "N37 21.0 E035 21.0") pasted in the first cell
          const single = parseCoord(t, field);
          if (pair && (single === null || format === 'MGRS')) { row.lat = pair[0]; row.lon = pair[1]; }
          else if (single !== null) row[field] = single;
          else st.bad.add(fieldKey);
        }
      } else if (field === 'altLowerFt' || field === 'altUpperFt') {
        const v = parseAltitudeText(t); if (Number.isNaN(v)) st.bad.add(fieldKey); else row[field] = v;
      } else {
        if (t === '') row.widthNm = null;
        else { const v = Number(t); if (!(v > 0 && v <= MAX_WIDTH_NM)) st.bad.add(fieldKey); else row.widthNm = v; }
      }
      emit(); syncRow(i);
    });
    return input;
  }

  /** After a cell edit: show what was understood in the row's cells, then the derived parts of the section. */
  function syncRow(i) {
    for (const f of ['name', 'lat', 'lon', 'altLowerFt', 'altUpperFt', 'widthNm']) {
      const c = refs.cells.get(`${i}:${f}`); if (!c) continue;
      c.input.value = c.show(); c.input.classList.toggle('asg-bad', st.bad.has(`${i}:${f}`));
    }
    refreshDerived();
  }
  function refreshDerived() {
    const env = routeEnvelope(st.rows);
    if (refs.lo) refs.lo.value = altitudeText(env.altLowerFt, settings.transitionAltFt) || 'surface';
    if (refs.hi) refs.hi.value = altitudeText(env.altUpperFt, settings.transitionAltFt) || 'unbounded';
    st.rows.forEach((r, k) => { if (refs.legs[k] && k < st.rows.length - 1) refs.legs[k].textContent = `${r.name || '?'} \u2192 ${st.rows[k + 1].name || '?'}`; });
    const changed = savedJson !== JSON.stringify([segmentsFromRows(st.rows), st.defaultWidthNm]) && !!definition.segments;
    if (refs.dot) refs.dot.hidden = !changed;
    if (refs.summary) refs.summary.textContent = summaryText();
  }
  const summaryText = () => `A blank width uses the default (${st.defaultWidthNm} NM). Altitudes are indicated feet, FL from ${settings.transitionAltFt}. ${routeSummary(st.rows, st.defaultWidthNm)}.${canAddFix(st.rows) ? '' : ` At most ${MAX_ROUTE_SEGMENTS} fixes.`}`;

  function navMenu(i, anchor) {
    const menu = _el('div', 'asg-navmenu');
    const search = _el('input'); search.type = 'text'; search.placeholder = 'Search navpoints';
    const list = _el('div');
    const fill = () => {
      list.innerHTML = '';
      const q = search.value.trim().toLowerCase();
      const wps = ((missionData && missionData.waypoints) || []).filter(w => w && Number.isFinite(w.lat) && w.name && (!q || String(w.name).toLowerCase().includes(q))).slice(0, 40);
      for (const w of wps) {
        const it = _el('div', 'asg-navitem'); it.dataset.nav = w.name;
        it.append(_el('span', '', w.name), _el('span', 'asg-drawing-meta', formatPair(w.lat, w.lon, fmt())));
        it.addEventListener('click', () => { Object.assign(st.rows[i], { name: String(w.name), lat: w.lat, lon: w.lon }); st.navFor = null; st.bad.delete(`${i}:lat`); st.bad.delete(`${i}:lon`); emit(); render(); });
        list.appendChild(it);
      }
      if (!wps.length) list.appendChild(_el('div', 'asg-picker-note', missionData ? 'No navpoint matches.' : 'No mission is loaded.'));
    };
    search.addEventListener('input', fill); fill();
    menu.append(search, list, _el('div', 'asg-picker-note', 'The loaded mission\'s navpoints. Picking one fills the name and the coordinates (a copy).'));
    setTimeout(() => search.focus(), 0);
    return menu;
  }

  function placeOnMap(i) {
    const ok = startDraw({ mode: 'pick', title: `PLACE FIX ${st.rows[i].name || i + 1}`, onPick: (fix) => { Object.assign(st.rows[i], { lat: fix.lat, lon: fix.lon }); if (fix.name) st.rows[i].name = String(fix.name); st.bad.delete(`${i}:lat`); st.bad.delete(`${i}:lon`); emit(); render(); }, onCancel: () => render() });
    if (!ok) render();
  }

  function addOnMap() {
    const points = st.rows.filter(r => r.lat != null && r.lon != null).map(r => [r.lat, r.lon]);
    const fixed = points.length;
    startDraw({
      mode: 'route', title: '', points, defaultWidthNm: st.defaultWidthNm, routeWidths: st.rows.map(r => r.widthNm),
      onChange: (pts, { names }) => {
        // Existing rows stay as they are; fixes added on the map append, one removed from the end drops the row.
        const base = st.rows.filter(r => r.lat != null && r.lon != null).slice(0, Math.min(fixed, pts.length));
        const added = pts.slice(fixed).map((p, k) => ({ ...blankFix(base.length + k), name: names[fixed + k] || String.fromCharCode(65 + ((base.length + k) % 26)), lat: p[0], lon: p[1] }));
        st.rows = [...base, ...added];
        while (st.rows.length < 2) st.rows.push(blankFix(st.rows.length));
        emit(); render();
      },
      onDone: () => render(), onCancel: () => render(),
    });
  }

  function render() {
    const root = ctx.root; root.innerHTML = '';
    refs.cells.clear(); refs.legs = [];
    root.classList.toggle('asg-readonly', !!ctx.readOnly);
    const changed = savedJson !== JSON.stringify([segmentsFromRows(st.rows), st.defaultWidthNm]) && !!definition.segments;
    const head = _el('div', 'asg-head');
    head.appendChild(_el('span', 'asg-title', 'ROUTE'));
    if (changed) head.appendChild(_el('span', 'asg-dot', '•'));
    head.appendChild(_el('span', 'asg-chip', `${st.rows.length} FIXES · ${Math.max(0, st.rows.length - 1)} LEGS`));
    const onMap = _el('button', 'asg-btn', 'Add fixes on map'); onMap.type = 'button'; onMap.id = 'asg-add-on-map'; onMap.style.marginLeft = 'auto';
    onMap.disabled = !!ctx.readOnly || !canAddFix(st.rows); if (onMap.disabled) onMap.classList.add('asg-disabled'); else onMap.addEventListener('click', addOnMap);
    head.appendChild(onMap);
    root.appendChild(head);
    if (ctx.readOnly) root.appendChild(_el('div', 'asg-why', ctx.readOnly));

    const env = routeEnvelope(st.rows);
    const top = _el('div', 'asg-route-top');
    const lab = (text, node) => { const l = _el('label'); l.append(document.createTextNode(text), node); return l; };
    const w = _el('input', 'airspace-input'); w.type = 'text'; w.id = 'asg-default-width'; w.value = String(st.defaultWidthNm ?? '');
    w.disabled = !!ctx.readOnly;
    w.addEventListener('change', () => {
      const v = Number(w.value); if (v > 0 && v <= MAX_WIDTH_NM) { st.defaultWidthNm = v; st.bad.delete('width'); } else st.bad.add('width');
      w.classList.toggle('asg-bad', st.bad.has('width'));
      for (const [k, c] of refs.cells) if (k.endsWith(':widthNm')) c.input.placeholder = String(st.defaultWidthNm);
      emit(); refreshDerived();
    });
    if (st.bad.has('width')) w.classList.add('asg-bad');
    const lo = _el('input', 'airspace-input asg-derived'); lo.disabled = true; lo.value = altitudeText(env.altLowerFt, settings.transitionAltFt) || 'surface';
    const hi = _el('input', 'airspace-input asg-derived'); hi.disabled = true; hi.value = altitudeText(env.altUpperFt, settings.transitionAltFt) || 'unbounded';
    refs.lo = lo; refs.hi = hi;
    top.append(lab('DEFAULT WIDTH NM', w), lab('ALT LOWER (DERIVED)', lo), lab('ALT UPPER (DERIVED)', hi));
    top.appendChild(_el('div', 'asg-text', 'Width is total (as stored); MTR charts quote it each side of the centreline, so 4 NM is ±2. The envelope is computed from the legs (crc-sync recomputes it on save). It is what a Strip\'s altitude block is checked against.'));
    root.appendChild(top);

    const table = _el('table', 'asg-table');
    const hr = _el('tr'); for (const h of ['', 'FIX', 'LAT', 'LON', '', '', 'LEG', 'LOWER FT', 'UPPER FT', 'WIDTH NM', '']) hr.appendChild(_el('th', '', h));
    table.appendChild(hr);
    st.rows.forEach((row, i) => {
      const tr = _el('tr'); tr.dataset.fix = String(i);
      const last = i === st.rows.length - 1;
      const td = (...n) => { const c = _el('td'); c.append(...n); tr.appendChild(c); return c; };
      td(_el('span', 'asg-leg', String(i + 1)));
      td(cell(row, i, 'name')); td(cell(row, i, 'lat')); td(cell(row, i, 'lon'));
      const nav = _el('button', 'asg-btn', 'Navpt ▾'); nav.type = 'button'; nav.className = 'asg-btn asg-nav'; nav.disabled = !!ctx.readOnly;
      nav.addEventListener('click', () => { st.navFor = st.navFor === i ? null : i; render(); });
      const navCell = td(nav); navCell.style.position = 'relative';
      if (st.navFor === i) navCell.appendChild(navMenu(i, nav));
      const pin = _el('button', 'asg-btn asg-pin', '+'); pin.type = 'button'; pin.title = 'Place this fix with a click on the map'; pin.disabled = !!ctx.readOnly;
      pin.addEventListener('click', () => placeOnMap(i)); td(pin);
      if (last) {
        const c = td(_el('span', 'asg-leg', 'exit fix: the route ends here, no leg')); c.colSpan = 4;
      } else {
        td(_el('span', 'asg-leg', `${row.name || '?'} → ${st.rows[i + 1].name || '?'}`));
        td(cell(row, i, 'altLowerFt')); td(cell(row, i, 'altUpperFt')); td(cell(row, i, 'widthNm'));
      }
      const rm = _el('button', 'asg-btn asg-remove', 'X'); rm.type = 'button'; rm.title = st.rows.length <= 2 ? 'A route needs at least 2 fixes.' : 'Remove this fix';
      rm.disabled = !!ctx.readOnly || st.rows.length <= 2;
      rm.addEventListener('click', () => { st.rows = removeFix(st.rows, i); st.bad.clear(); st.navFor = null; emit(); render(); });
      td(rm);
      table.appendChild(tr);
    });
    root.appendChild(table);

    const foot = _el('div', 'asg-buttons');
    const add = _el('button', 'asg-btn', '+ Add fix'); add.type = 'button'; add.id = 'asg-add-fix';
    add.disabled = !!ctx.readOnly || !canAddFix(st.rows);
    add.addEventListener('click', () => { st.rows = addFix(st.rows, {}); emit(); render(); });
    refs.summary = _el('span', 'asg-why', summaryText());
    foot.append(add, refs.summary);
    root.appendChild(foot);
    void legWidthNm;
  }

  render();
  return { render };
}
