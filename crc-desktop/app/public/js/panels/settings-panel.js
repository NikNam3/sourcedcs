'use strict';
import { markEfspChanged } from './efsp/efsp-change-bus.js';
import { buildBullseye, buildNavpoints, buildTextMarks } from '../geojson.js';
import { applyColors, applyMapTheme } from '../map-style.js';
import { clearElevationContours, updateElevationContours } from '../elevation.js';
import { hideLosProfile } from './los-panel.js';
import { initToolsTab } from './tools-panel.js';
import { applyScale } from '../geojson.js';
import { _setBullseyePickTarget, bullseyePickTarget } from '../view-state.js';
import { history, missionData } from '../picture.js';
import { map, mapReady } from '../map-handle.js';
import { saveSettings, settings } from '../settings.js';
import { mountAirspaceMenuInSettings } from '../airspace-layer.js';
import { coordFormatOf } from '../coords.js';
import { getSetting, onSettingsTabsChanged, setSetting, settingsTabs } from '../settings-registry.js';

// ── Settings panel: tab switching, per-tab wiring (map display, bullseye
// override, colours, tools) and the bullseye pick-on-map mode. Split out of
// the former ui.js "god file" (history); dock.js and app.js import these by name.

export function initSettings() {
  const panel   = document.getElementById('settings-panel');

  // ── Tab switching (delegated: registered tabs are added later) ───────
  panel.querySelector('.settings-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.stab');
    if (btn) selectSettingsTab(panel, btn.dataset.pane);
  });
  renderRegisteredTabs(panel);
  onSettingsTabsChanged(() => renderRegisteredTabs(panel));

  const els = {
    pplEnabled:     document.getElementById('set-ppl-enabled'),
    pplDuration:    document.getElementById('set-ppl-duration'),
    pplVal:         document.getElementById('set-ppl-val'),
    trailEn:        document.getElementById('set-trail-enabled'),
    trailLength:    document.getElementById('set-trail-length'),
    trailLenVal:    document.getElementById('set-trail-length-val'),
    trailInterval:  document.getElementById('set-trail-interval'),
    trailIntervalVal: document.getElementById('set-trail-interval-val'),
    fadeGrace:      document.getElementById('set-fade-grace'),
    fadeGraceVal:   document.getElementById('set-fade-grace-val'),
    radarDebug:     document.getElementById('set-radar-debug'),
    datalink:       document.getElementById('set-datalink'),
    textMarks:      document.getElementById('set-text-marks'),
    scale:          document.getElementById('set-scale'),
    scaleVal:       document.getElementById('set-scale-val'),
    lightMode:      document.getElementById('set-light-mode'),
    elevation:      document.getElementById('set-elevation'),
    atcMapBackground: document.getElementById('set-atc-map-background'),
  };

  els.pplEnabled.checked = settings.pplEnabled;
  els.pplDuration.value  = settings.pplDuration;
  els.pplVal.textContent = settings.pplDuration + 's';
  els.trailEn.checked           = settings.trailEnabled;
  els.trailLength.value         = settings.trailLength;
  els.trailLenVal.textContent   = settings.trailLength;
  els.trailInterval.value       = settings.trailIntervalMs ?? 5000;
  els.trailIntervalVal.textContent = ((settings.trailIntervalMs ?? 5000) / 1000).toFixed(0) + 's';
  els.fadeGrace.value           = settings.fadeGraceMs ?? 10000;
  els.fadeGraceVal.textContent  = ((settings.fadeGraceMs ?? 10000) / 1000).toFixed(1) + 's';
  els.scale.value        = settings.scale;
  els.scaleVal.textContent = parseFloat(settings.scale).toFixed(1) + '×';
  els.lightMode.checked  = settings.lightMode;
  els.elevation.checked  = settings.showElevation;
  // crc-sync's docs/adr/0088: on unless turned off (an older install has no key).
  if (els.atcMapBackground) els.atcMapBackground.checked = settings.atcMapBackground !== false;
  els.radarDebug.checked   = settings.radarDebug;
  els.datalink.checked     = settings.showDatalinkLocks !== false;
  els.textMarks.checked    = settings.textMarksEnabled;
  applyLightMode();

  // Coordinates (H102 AP2B-Q2): how the airspace editor and the map readout write positions; input takes all formats.
  const coordSel = document.getElementById('set-coord-format');
  coordSel.value = coordFormatOf(settings.coordFormat);
  coordSel.addEventListener('change', () => { settings.coordFormat = coordFormatOf(coordSel.value); saveSettings(); });
  mountAirspaceMenuInSettings();

  const persist = (key, val) => { settings[key] = val; saveSettings(); markEfspChanged('map'); };

  els.pplEnabled.addEventListener('change', () => persist('pplEnabled',  els.pplEnabled.checked));
  els.pplDuration.addEventListener('input', () => {
    settings.pplDuration = parseInt(els.pplDuration.value);
    els.pplVal.textContent = settings.pplDuration + 's';
    saveSettings(); markEfspChanged('map');
  });
  els.trailEn.addEventListener('change', () => persist('trailEnabled', els.trailEn.checked));
  els.trailLength.addEventListener('input', () => {
    settings.trailLength = parseInt(els.trailLength.value);
    els.trailLenVal.textContent = settings.trailLength;
    saveSettings(); markEfspChanged('map');
  });
  els.trailInterval.addEventListener('input', () => {
    settings.trailIntervalMs = parseInt(els.trailInterval.value);
    els.trailIntervalVal.textContent = (settings.trailIntervalMs / 1000).toFixed(0) + 's';
    history.clear(); // reset trail so old close-together dots are dropped
    saveSettings(); markEfspChanged('map');
  });
  els.fadeGrace.addEventListener('input', () => {
    settings.fadeGraceMs = parseInt(els.fadeGrace.value);
    els.fadeGraceVal.textContent = (settings.fadeGraceMs / 1000).toFixed(1) + 's';
    saveSettings(); markEfspChanged('map');
  });
  els.scale.addEventListener('input', () => {
    settings.scale = parseFloat(els.scale.value);
    els.scaleVal.textContent = settings.scale.toFixed(1) + '×';
    saveSettings();
    applyScale();
  });
  els.lightMode.addEventListener('change', () => {
    settings.lightMode = els.lightMode.checked;
    saveSettings();
    applyLightMode();
  });
  els.elevation.addEventListener('change', () => {
    settings.showElevation = els.elevation.checked;
    saveSettings();
    if (settings.showElevation) updateElevationContours();
    else clearElevationContours();
  });
  if (els.atcMapBackground) {
    // Off: the black strict-STARS scope, in an ATC-only session. atc-scope.js
    // applies it on its next beat.
    els.atcMapBackground.addEventListener('change', () => persist('atcMapBackground', els.atcMapBackground.checked));
  }
  els.radarDebug.addEventListener('change',   () => {
    persist('radarDebug', els.radarDebug.checked);
    if (!els.radarDebug.checked) hideLosProfile();
  });
  els.datalink.addEventListener('change', () => persist('showDatalinkLocks', els.datalink.checked));
  els.textMarks.addEventListener('change', () => {
    settings.textMarksEnabled = els.textMarks.checked;
    saveSettings();
    // Text marks are static (mission-derived), unlike the continuously
    // re-rendered per-tick layers persist() feeds — update the source directly.
    if (missionData) map.getSource('text-marks').setData(buildTextMarks());
  });

  // ── Bullseye override ────────────────────────────────────────────────
  initBullseyeSettings();

  // ── Colours tab ───────────────────────────────────────────────────────
  initColorSettings();

  // ── Tools tab ─────────────────────────────────────────────────────────
  initToolsTab();
}

// ── Registered tabs (settings-registry.js) ───────────────────────────────
// One tab and pane per registerSettingsTab(); they sit before SRS. Rebuilt whenever the registry changes.

function selectSettingsTab(panel, pane) {
  panel.querySelectorAll('.stab').forEach(b => b.classList.toggle('active', b.dataset.pane === pane));
  panel.querySelectorAll('.stab-pane').forEach(p => { p.style.display = p.id === 'stab-' + pane ? '' : 'none'; });
}

function fieldRow(f) {
  const row = document.createElement('div');
  row.className = 'setting-row';
  const label = document.createElement('span');
  label.textContent = f.label || f.key;
  row.appendChild(label);
  let input;
  if (f.type === 'toggle') {
    const wrap = document.createElement('label');
    wrap.className = 'toggle';
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!getSetting(f.key);
    input.addEventListener('change', () => setSetting(f.key, input.checked));
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    wrap.append(input, slider);
    row.appendChild(wrap);
  } else if (f.type === 'number') {
    const wrap = document.createElement('span');
    input = document.createElement('input');
    input.type = 'number';
    for (const a of ['min', 'max', 'step']) if (f[a] !== undefined) input.setAttribute(a, f[a]);
    input.style.width = '70px';
    input.value = getSetting(f.key);
    input.addEventListener('change', () => { input.value = setSetting(f.key, input.value); });
    wrap.appendChild(input);
    if (f.unit) wrap.append(' ' + f.unit);
    row.appendChild(wrap);
  } else {
    input = document.createElement('select');
    input.className = 'setting-select';
    for (const o of f.options) {
      const opt = document.createElement('option');
      opt.value = Array.isArray(o) ? o[0] : o;
      opt.textContent = Array.isArray(o) ? o[1] : o;
      input.appendChild(opt);
    }
    input.value = getSetting(f.key);
    input.addEventListener('change', () => setSetting(f.key, input.value));
    row.appendChild(input);
  }
  input.id = 'set-' + f.key;
  return row;
}

function renderRegisteredTabs(panel) {
  const bar = panel.querySelector('.settings-tabs');
  const active = panel.querySelector('.stab.active')?.dataset.pane;
  panel.querySelectorAll('.stab[data-reg], .stab-pane[data-reg]').forEach(n => n.remove());
  const anchorBtn = bar.querySelector('.stab[data-pane="srs"]');
  const anchorPane = document.getElementById('stab-srs');
  for (const t of settingsTabs()) {
    const btn = document.createElement('button');
    btn.className = 'stab';
    btn.dataset.pane = t.id;
    btn.dataset.reg = '1';
    btn.textContent = t.label;
    bar.insertBefore(btn, anchorBtn);
    const pane = document.createElement('div');
    pane.id = 'stab-' + t.id;
    pane.className = 'stab-pane';
    pane.dataset.reg = '1';
    pane.style.display = 'none';
    const group = document.createElement('div');
    group.className = 'setting-group';
    for (const f of t.fields) group.appendChild(fieldRow(f));
    pane.appendChild(group);
    anchorPane.parentNode.insertBefore(pane, anchorPane);
  }
  if (active) selectSettingsTab(panel, document.getElementById('stab-' + active) ? active : 'general');
}

// ── Bullseye pick-on-map mode ────────────────────────────────────────────
// bullseyePickTarget (declared in app.js) holds 'blue' | 'red' | null while
// waiting for the next map click to set that side's override position.

const $pickBanner = document.getElementById('pick-banner');

function startBullseyePick(side) {
  _setBullseyePickTarget(side);
  document.querySelectorAll('[id^="set-be-"][id$="-pick"]').forEach(b => b.classList.remove('active-pick'));
  const $btn = document.getElementById(`set-be-${side}-pick`);
  if ($btn) { $btn.textContent = 'CLICK MAP…'; $btn.classList.add('active-pick'); }
  if ($pickBanner) {
    $pickBanner.textContent = `CLICK MAP TO SET ${side.toUpperCase()} BULLSEYE — ESC TO CANCEL`;
    $pickBanner.classList.add('visible');
  }
  // Settings now docks beside the map rather than overlaying it, so unlike
  // the old fixed-position panel there's nothing to close for the map to
  // become clickable.
}

function cancelBullseyePick() {
  _setBullseyePickTarget(null);
  document.querySelectorAll('[id^="set-be-"][id$="-pick"]').forEach(b => {
    b.textContent = 'PICK ON MAP';
    b.classList.remove('active-pick');
  });
  if ($pickBanner) $pickBanner.classList.remove('visible');
}

// Called from map-setup.js when a map click lands while pick mode is active.
export function applyBullseyePick(side, lat, lon) {
  settings.bullseyeOverride[side].enabled = true;
  settings.bullseyeOverride[side].lat = lat;
  settings.bullseyeOverride[side].lon = lon;
  const $en  = document.getElementById(`set-be-${side}-enabled`);
  const $lat = document.getElementById(`set-be-${side}-lat`);
  const $lon = document.getElementById(`set-be-${side}-lon`);
  if ($en)  $en.checked = true;
  if ($lat) $lat.value  = lat.toFixed(4);
  if ($lon) $lon.value  = lon.toFixed(4);
  saveSettings();
  if (mapReady) map.getSource('bullseye').setData(buildBullseye());
  cancelBullseyePick();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && bullseyePickTarget) cancelBullseyePick();
});

// Manual per-coalition bullseye position override, editable from the
// settings panel. Falls back to the live mission bullseye when disabled.
function initBullseyeSettings() {
  for (const side of ['blue', 'red']) {
    const $en   = document.getElementById(`set-be-${side}-enabled`);
    const $lat  = document.getElementById(`set-be-${side}-lat`);
    const $lon  = document.getElementById(`set-be-${side}-lon`);
    const $use  = document.getElementById(`set-be-${side}-use-mission`);
    const $pick = document.getElementById(`set-be-${side}-pick`);
    if (!$en || !$lat || !$lon) continue;

    const ov = settings.bullseyeOverride[side];
    $en.checked = !!ov.enabled;
    $lat.value  = ov.lat  ?? '';
    $lon.value  = ov.lon  ?? '';

    const refreshBullseye = () => {
      saveSettings();
      if (mapReady) map.getSource('bullseye').setData(buildBullseye());
    };

    $en.addEventListener('change', () => {
      settings.bullseyeOverride[side].enabled = $en.checked;
      refreshBullseye();
    });
    $lat.addEventListener('input', () => {
      settings.bullseyeOverride[side].lat = $lat.value === '' ? null : parseFloat($lat.value);
      refreshBullseye();
    });
    $lon.addEventListener('input', () => {
      settings.bullseyeOverride[side].lon = $lon.value === '' ? null : parseFloat($lon.value);
      refreshBullseye();
    });

    if ($use) {
      $use.addEventListener('click', () => {
        const base = missionData && missionData.bullseye && missionData.bullseye[side];
        if (!base) return;
        $lat.value = base.lat;
        $lon.value = base.lon;
        settings.bullseyeOverride[side].lat = base.lat;
        settings.bullseyeOverride[side].lon = base.lon;
        refreshBullseye();
      });
    }

    if ($pick) {
      $pick.addEventListener('click', () => {
        if (bullseyePickTarget === side) { cancelBullseyePick(); return; }
        startBullseyePick(side);
      });
    }
  }
}

function initColorSettings() {
  // Each entry: [inputId, swatchId, settingsKey, defaultColor]
  const COLOR_DEFS = [
    ['col-friendly',    'sw-friendly',    'colFriendly',    '#4488cc'],
    ['col-bogey',       'sw-bogey',       'colBogey',       '#ccaa00'],
    ['col-neutral',     'sw-neutral',     'colNeutral',     '#888888'],
    ['col-bandit',      'sw-bandit',      'colBandit',      '#cc6600'],
    ['col-hostile',     'sw-hostile',     'colHostile',     '#cc2222'],
    ['col-emerg-gen',   'sw-emerg-gen',   'colEmergGen',    '#cc2222'],
    ['col-emerg-radio', 'sw-emerg-radio', 'colEmergRadio',  '#b8a000'],
    ['col-emerg-hijack','sw-emerg-hijack','colEmergHijack', '#cc6600'],
    ['col-bra',         'sw-bra',         'braColor',       '#4488cc'],
    ['col-range-ring',  'sw-range-ring',  'colRangeRing',   '#8aaa6a'],
    ['col-navpoint',    'sw-navpoint',    'colNavpoint',    '#3a5a3a'],
  ];

  for (const [inputId, swatchId, key, def] of COLOR_DEFS) {
    const inp    = document.getElementById(inputId);
    const swatch = document.getElementById(swatchId);
    if (!inp) continue;

    // Initialise input and swatch from current settings
    const cur = settings[key] || def;
    inp.value = cur;
    if (swatch) swatch.style.background = cur;

    inp.addEventListener('input', () => {
      settings[key] = inp.value;
      if (swatch) swatch.style.background = inp.value;
      saveSettings();
      // BRA cursor: update CSS color directly
      if (key === 'braColor') {
        const $bra = document.getElementById('cursor-bra');
        if ($bra) $bra.style.color = inp.value;
        markEfspChanged('map');
        return;
      }
      applyColors();
    });
  }

  // Reset buttons — restore default, persist, refresh
  document.querySelectorAll('.col-reset').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      const def = btn.dataset.default;
      settings[key] = def;
      saveSettings();
      // Sync the matching input and swatch
      const def2 = COLOR_DEFS.find(d => d[2] === key);
      if (def2) {
        const inp    = document.getElementById(def2[0]);
        const swatch = document.getElementById(def2[1]);
        if (inp)    inp.value = def;
        if (swatch) swatch.style.background = def;
      }
      if (key === 'braColor') {
        const $bra = document.getElementById('cursor-bra');
        if ($bra) $bra.style.color = def;
        markEfspChanged('map');
      } else {
        applyColors();
      }
    });
  });

  // ── Declutter tab ─────────────────────────────────────────────────────
  const $declutter  = document.getElementById('set-declutter');
  const $navDecl    = document.getElementById('set-nav-declutter');
  const $navDecl5   = document.getElementById('set-nav-declutter-5');
  const $shipsEn         = document.getElementById('set-ships-enabled');
  const $caPaths         = document.getElementById('set-ca-paths');

  if ($declutter) {
    $declutter.checked = settings.declutter ?? false; // H6: off by default
    $declutter.addEventListener('change', () => {
      settings.declutter = $declutter.checked;
      saveSettings();
      markEfspChanged('map');
    });
  }

  if ($navDecl) {
    $navDecl.checked = settings.navDeclutter ?? true;
    $navDecl.addEventListener('change', () => {
      settings.navDeclutter = $navDecl.checked;
      saveSettings();
      if (mapReady && missionData) map.getSource('navpoints').setData(buildNavpoints());
    });
  }

  if ($navDecl5) {
    $navDecl5.checked = settings.navDeclutter5 ?? true;
    $navDecl5.addEventListener('change', () => {
      settings.navDeclutter5 = $navDecl5.checked;
      saveSettings();
      if (mapReady && missionData) map.getSource('navpoints').setData(buildNavpoints());
    });
  }

  if ($shipsEn) {
    $shipsEn.checked = settings.shipsEnabled;
    $shipsEn.addEventListener('change', () => { settings.shipsEnabled = $shipsEn.checked; saveSettings(); markEfspChanged('map'); });
  }

  if ($caPaths) { // T30: the conflict alert's paths only; the alert itself is never decluttered (H115-H119)
    $caPaths.checked = settings.conflictAlertPaths !== false;
    $caPaths.addEventListener('change', () => { settings.conflictAlertPaths = $caPaths.checked; saveSettings(); markEfspChanged('map'); });
  }

  const $extCenterlineNm = document.getElementById('set-ext-centerline-nm');
  if ($extCenterlineNm) {
    $extCenterlineNm.value = settings.extCenterlineNm ?? 25;
    $extCenterlineNm.addEventListener('input', () => {
      const v = parseInt($extCenterlineNm.value, 10);
      settings.extCenterlineNm = Number.isFinite(v) && v > 0 ? v : 25;
      saveSettings();
      markEfspChanged('map');
    });
  }
}

export function applyLightMode() {
  document.body.classList.toggle('light', !!settings.lightMode);
  applyMapTheme();
}
