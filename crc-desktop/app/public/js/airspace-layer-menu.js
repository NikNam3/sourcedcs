'use strict';

// The airspace layer menu (AIRSP-2P-B, H100 DA-9; mockup scenes 7-8): which airspaces and layers the map shows.
// The model is a set of pure functions (tests/airspace-layer-menu.test.mjs); the DOM half is `mountAirspaceLayerMenu`.
//
// THE WHOLE RULE: an airspace is shown when its layer is on and, if it has an individual setting, that wins (On or Off);
// otherwise when both its kind and its state are enabled (a JURISDICTION area, crc-sync ADR 0125: its kind alone). Nothing is forced on. Default (first run and Reset): Outlines,
// Labels and Route corridors on, centrelines off, every kind on except JURISDICTION, state ACTIVE only, no individual settings.
// A per-user display preference kept in the client's settings store (`settings.airspaceMenu`); the individual settings are
// keyed by theater (ids belong to a theater). Never on the wire, never part of any Board or audit.

export const MENU_LAYERS = ['outlines', 'labels', 'corridors', 'centrelines'];
export const LAYER_LABELS = { outlines: 'Outlines', labels: 'Labels', corridors: 'Route corridors', centrelines: 'Route centrelines' };
export const MENU_KINDS = ['MOA', 'RANGE', 'DANGER', 'RESTRICTED', 'PROHIBITED', 'WARNING', 'ROUTE', 'JURISDICTION'];
export const MENU_STATES = ['SCHEDULED', 'ACTIVE', 'RELEASED', 'RETURNED'];

export function defaultMenu() {
  return {
    layers: { outlines: true, labels: true, corridors: true, centrelines: false },
    // Jurisdiction areas (crc-sync docs/adr/0125) are off by default: reference outlines that would crowd the scope.
    kinds: Object.fromEntries(MENU_KINDS.map(k => [k, k !== 'JURISDICTION'])),
    states: Object.fromEntries(MENU_STATES.map(s => [s, s === 'ACTIVE'])),
    overrides: {}, // theater -> { airspaceId: 'on' | 'off' }
  };
}

const bool = (v, d) => (typeof v === 'boolean' ? v : d);

/** A menu read back from storage: unknown keys dropped, wrong types replaced by the default. */
export function sanitizeMenu(raw) {
  const d = defaultMenu();
  if (!raw || typeof raw !== 'object') return d;
  for (const k of MENU_LAYERS) d.layers[k] = bool(raw.layers && raw.layers[k], d.layers[k]);
  for (const k of MENU_KINDS) d.kinds[k] = bool(raw.kinds && raw.kinds[k], d.kinds[k]);
  for (const k of MENU_STATES) d.states[k] = bool(raw.states && raw.states[k], d.states[k]);
  if (raw.overrides && typeof raw.overrides === 'object') {
    for (const [theater, map] of Object.entries(raw.overrides)) {
      if (!map || typeof map !== 'object') continue;
      const clean = {};
      for (const [id, v] of Object.entries(map)) if (v === 'on' || v === 'off') clean[id] = v;
      if (Object.keys(clean).length) d.overrides[theater] = clean;
    }
  }
  return d;
}

const clone = (m) => JSON.parse(JSON.stringify(m));
export function setLayer(menu, key, on) { const m = clone(menu); m.layers[key] = !!on; return m; }
export function setKind(menu, key, on) { const m = clone(menu); m.kinds[key] = !!on; return m; }
export function setState(menu, key, on) { const m = clone(menu); m.states[key] = !!on; return m; }
/** 'filter' removes the individual setting; 'on' / 'off' set it for this theater. */
export function setOverride(menu, theater, id, value) {
  const m = clone(menu);
  const t = { ...(m.overrides[theater] || {}) };
  if (value === 'on' || value === 'off') t[id] = value; else delete t[id];
  if (Object.keys(t).length) m.overrides[theater] = t; else delete m.overrides[theater];
  return m;
}
export function overrideOf(menu, theater, id) { return (menu.overrides[theater] && menu.overrides[theater][id]) || 'filter'; }
export function resetMenu() { return defaultMenu(); }
export function isDefaultMenu(menu) { return JSON.stringify(sanitizeMenu(menu)) === JSON.stringify(defaultMenu()); }
/** An override for an airspace that no longer exists in this theater is dropped. */
export function pruneOverrides(menu, theater, existingIds) {
  const t = menu.overrides[theater]; if (!t) return menu;
  const keep = Object.fromEntries(Object.entries(t).filter(([id]) => existingIds.includes(id)));
  if (Object.keys(keep).length === Object.keys(t).length) return menu;
  const m = clone(menu); if (Object.keys(keep).length) m.overrides[theater] = keep; else delete m.overrides[theater];
  return m;
}

export function kindOf(definition) { return definition.kind === 'ROUTE' || definition.kind === 'JURISDICTION' ? definition.kind : definition.type; }
export function hasOutline(definition) {
  if (definition.kind === 'JURISDICTION') return !!(definition.geometry && (definition.geometry.source === 'CIRCLE' || (definition.geometry.points && definition.geometry.points.length >= 3)));
  return definition.kind === 'ROUTE' ? Array.isArray(definition.segments) && definition.segments.length >= 2 : !!(definition.geometry && definition.geometry.points && definition.geometry.points.length >= 3);
}

/**
 * What the menu does with one airspace record `{airspaceId, state, definition}`:
 * `{ shown, word, filterShown, drawsOutline, drawsLabel, drawsCorridor, drawsCentreline }`; `word` is the grey word
 * beside the switch: "shown", "hidden" or "no outline".
 */
export function decide(record, menu, theater) {
  const def = record.definition;
  const o = overrideOf(menu, theater, record.airspaceId);
  // A jurisdiction area has no state (it always applies): its kind alone decides.
  const filterShown = !!menu.kinds[kindOf(def)] && (def.kind === 'JURISDICTION' || !!menu.states[record.state]);
  const wanted = o === 'on' ? true : o === 'off' ? false : filterShown;
  const route = def.kind === 'ROUTE';
  const layerOn = route ? (menu.layers.corridors || menu.layers.centrelines) : menu.layers.outlines;
  const outline = hasOutline(def);
  const shown = wanted && layerOn && outline;
  return {
    shown, filterShown, override: o,
    word: !outline ? 'no outline' : (wanted && layerOn ? 'shown' : 'hidden'),
    drawsOutline: shown && !route,
    drawsCorridor: shown && route && menu.layers.corridors,
    drawsCentreline: shown && route && menu.layers.centrelines,
    drawsLabel: shown && menu.layers.labels,
  };
}

/** The per-airspace checklist: grouped by controlling Facility (Facility order, then name), filtered by a search box. */
export function checklistGroups(airspaces, query) {
  const q = String(query || '').trim().toLowerCase();
  const groups = new Map();
  for (const a of airspaces) {
    const d = a.definition;
    if (q && !(String(d.name).toLowerCase().includes(q) || String(a.airspaceId).toLowerCase().includes(q))) continue;
    const f = d.controllingFacilityId || '—';
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(a);
  }
  return [...groups.entries()].map(([facilityId, list]) => ({ facilityId, airspaces: list.sort((x, y) => String(x.definition.name).localeCompare(String(y.definition.name))) }));
}

// ── the DOM half ────────────────────────────────────────────────────────────────────────────────

const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/**
 * Draw the menu into `host` and keep it in step. Dependencies are passed in so this file imports nothing from the app:
 * `getMenu()`, `setMenu(menu)` (stores and redraws the map), `getAirspaces()`, `getTheater()`, `getName()` (theater label).
 * Returns `{ refresh() }`, to call when the airspace list changes.
 */
export function mountAirspaceLayerMenu(host, { getMenu, setMenu, getAirspaces, getTheater, onChange }) {
  let query = '';
  host.classList.add('aslm');
  const root = _el('div', 'aslm-body');
  host.appendChild(root);

  const check = (label, checked, onToggle, dotted) => {
    const l = _el('label', 'aslm-check');
    const i = document.createElement('input'); i.type = 'checkbox'; i.checked = checked;
    i.addEventListener('change', () => onToggle(i.checked));
    l.append(i, document.createTextNode(label));
    if (dotted) l.appendChild(_el('span', 'aslm-dot', '•'));
    return l;
  };

  function render() {
    const menu = getMenu(); const theater = getTheater(); const d = defaultMenu();
    const active = document.activeElement;
    const keepSearch = active && active.classList && active.classList.contains('aslm-search');
    root.innerHTML = '';
    const head = _el('div', 'aslm-head');
    head.appendChild(_el('span', 'aslm-title', 'AIRSPACES ON THE MAP'));
    const reset = _el('button', 'aslm-reset', 'Reset');
    reset.disabled = isDefaultMenu(menu);
    reset.title = reset.disabled ? 'Already the default (ACTIVE airspaces only).' : 'Back to the default: ACTIVE airspaces only.';
    reset.addEventListener('click', () => { setMenu(resetMenu()); render(); if (onChange) onChange(); });
    head.appendChild(reset);
    root.appendChild(head);

    const section = (title, keys, group, labels, set) => {
      root.appendChild(_el('div', 'aslm-section', title));
      const row = _el('div', 'aslm-checks');
      for (const k of keys) row.appendChild(check(labels ? labels[k] : k, menu[group][k], (on) => { setMenu(set(getMenu(), k, on)); render(); if (onChange) onChange(); }, menu[group][k] !== d[group][k]));
      root.appendChild(row);
    };
    section('LAYERS', MENU_LAYERS, 'layers', LAYER_LABELS, setLayer);
    section('KIND', MENU_KINDS, 'kinds', null, setKind);
    section('STATE', MENU_STATES, 'states', null, setState);

    root.appendChild(_el('div', 'aslm-section', `EACH AIRSPACE · ${theater || 'no mission'}`));
    const search = _el('input', 'aslm-search'); search.type = 'text'; search.placeholder = 'Search by name or ID'; search.value = query;
    search.addEventListener('input', () => { query = search.value; render(); });
    root.appendChild(search);
    const list = _el('div', 'aslm-list');
    const airspaces = getAirspaces();
    const groups = checklistGroups(airspaces, query);
    if (!airspaces.length) list.appendChild(_el('div', 'aslm-empty', 'No airspaces in this theater.'));
    for (const g of groups) {
      list.appendChild(_el('div', 'aslm-group', g.facilityId));
      for (const a of g.airspaces) {
        const dec = decide(a, menu, theater);
        const row = _el('div', 'aslm-row');
        const name = _el('div', 'aslm-name');
        name.appendChild(_el('div', '', a.definition.name));
        name.appendChild(_el('div', 'aslm-sub', hasOutline(a.definition) ? a.state : `${a.state} · no outline`));
        row.appendChild(name);
        const seg = _el('span', 'aslm-seg');
        for (const [v, label] of [['filter', 'Filter'], ['on', 'On'], ['off', 'Off']]) {
          const b = _el('button', 'aslm-seg-btn', label); b.type = 'button';
          b.setAttribute('aria-pressed', String(dec.override === v));
          b.addEventListener('click', () => { setMenu(setOverride(getMenu(), theater, a.airspaceId, v)); render(); if (onChange) onChange(); });
          seg.appendChild(b);
        }
        row.appendChild(seg);
        row.appendChild(_el('span', 'aslm-word', dec.word));
        list.appendChild(row);
      }
    }
    root.appendChild(list);
    root.appendChild(_el('div', 'aslm-foot', `Saved for you on this computer. Not shared with other controllers.${isDefaultMenu(menu) ? ' Reset is disabled because this is already the default.' : ''}`));
    if (keepSearch) { const s = root.querySelector('.aslm-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }
  render();
  return { refresh: render };
}
