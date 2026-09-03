'use strict';

// ── Radar selection panel: active radars listed short and flat; everything
// else found via search. Split out of the former ui.js "god file" — see
// panels/topbar.js for why this stays a plain script rather than an IIFE.

const TYPE_LABELS = { airport: 'AIRPORT', approach: 'APPROACH', awacs: 'AWACS', fighter: 'FIGHTER', carrier: 'CARRIER' };
const TYPE_RANGE_LABEL = (r) => {
  const nm = Math.round(r.rangeM / 1852);
  return `${nm}nm`;
};

// Single entry point for enabling/disabling a radar — keeps the existing
// side effects (persistence, sweep/zoom recompute, map refresh) and adds
// the radar → panel implication hook (dock.js's notifyRadarToggled).
function setRadarEnabled(radar, enabled) {
  if (enabled) enabledRadarIds.add(radar.id);
  else enabledRadarIds.delete(radar.id);
  saveEnabledRadars();
  updateTopbarUI();
  resetSweepState();
  updateMap();
  updateZoomLimits();
  notifyRadarToggled(radar, enabled);
}

// Called from app.js when the underlying radar list itself changes (new
// mission data, or the AWACS/carrier-derived radar set changing) rather
// than a user toggling one — refreshes both the active list and whatever
// search is currently in progress, without clearing/losing that search.
function refreshRadarPanelData() {
  renderActiveRadars();
  const $search = document.getElementById('radar-search');
  renderRadarSearchResults($search ? $search.value : '');
}

// Only the radars actually in use — the point of this list is to stay
// short and calm rather than showing every airport in the theater at once.
// Turning one off here is the "remove" action (no separate delete control).
function renderActiveRadars() {
  const $list = document.getElementById('radar-active-list');
  if (!$list) return;
  $list.innerHTML = '';

  const active = getAllRadars()
    .filter(r => enabledRadarIds.has(r.id))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (active.length === 0) {
    const $empty = document.createElement('div');
    $empty.className = 'radar-empty';
    $empty.textContent = 'No active radars — search below to add one.';
    $list.appendChild($empty);
    return;
  }

  for (const r of active) {
    const isGnd = !!r.onGround;
    const $row = document.createElement('div');
    $row.className = 'radar-row' + (isGnd ? ' disabled' : '');

    const $check = document.createElement('input');
    $check.type      = 'checkbox';
    $check.checked   = true;
    $check.className = 'radar-check';
    $check.title     = 'Uncheck to remove';
    $check.addEventListener('change', () => {
      setRadarEnabled(r, false);
      renderActiveRadars();
      renderPanelControls();
    });

    const $label = document.createElement('span');
    $label.className = 'radar-row-label';
    $label.textContent = r.label;

    const $range = document.createElement('span');
    $range.className = 'radar-row-range';
    $range.textContent = TYPE_RANGE_LABEL(r) + (isGnd ? ' GND' : '');
    if (isGnd) $range.style.color = '#886633';

    $row.appendChild($check);
    $row.appendChild($label);
    $row.appendChild($range);
    $row.addEventListener('mouseenter', () => showLosProfile(r, $row));
    $row.addEventListener('mouseleave', () => hideLosProfile());
    $list.appendChild($row);
  }
}

// Results only appear while the user is actually typing — an empty search
// box shows nothing, keeping the panel quiet the rest of the time. Already-
// active radars are excluded since they're already visible above.
function renderRadarSearchResults(term) {
  const $results = document.getElementById('radar-search-results');
  if (!$results) return;
  $results.innerHTML = '';

  const q = (term || '').trim().toLowerCase();
  if (!q) return;

  const matches = getAllRadars()
    .filter(r => !enabledRadarIds.has(r.id))
    .filter(r => r.label.toLowerCase().includes(q) || (r.sublabel || '').toLowerCase().includes(q))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, 30); // a broad match (e.g. a single letter) shouldn't dump the whole theater back in

  if (matches.length === 0) {
    const $empty = document.createElement('div');
    $empty.className = 'radar-empty';
    $empty.textContent = 'No match.';
    $results.appendChild($empty);
    return;
  }

  for (const r of matches) {
    const $row = document.createElement('div');
    $row.className = 'radar-row radar-row-add';

    const $label = document.createElement('span');
    $label.className = 'radar-row-label';
    $label.textContent = r.label;

    const $type = document.createElement('span');
    $type.className = 'radar-row-range';
    $type.textContent = TYPE_LABELS[r.type] || r.type.toUpperCase();

    $row.appendChild($label);
    $row.appendChild($type);
    $row.addEventListener('mouseenter', () => showLosProfile(r, $row));
    $row.addEventListener('mouseleave', () => hideLosProfile());
    $row.addEventListener('click', () => {
      setRadarEnabled(r, true);
      const $search = document.getElementById('radar-search');
      if ($search) $search.value = '';
      renderRadarSearchResults('');
      renderActiveRadars();
      renderPanelControls();
    });
    $results.appendChild($row);
  }
}

// The panels this radar list can drive open/closed. Every row is rendered
// identically (label + slider + pin) regardless of whether anything else
// (a radar, for Airport — see dock.js's RADAR_TYPE_TO_PANEL) also drives
// that panel's open/closed state; the slider always reflects live dock
// state either way, so a separate radar-only status readout would just be
// a second way of displaying the same bit. Labels read from dock.js's
// PANEL_TITLES (the single source of truth for panel names) — a function,
// not a top-level const, because dock.js loads after this file and
// PANEL_TITLES wouldn't exist yet if this array were built at parse time
// instead of when a panel actually needs rendering.
function panelControlRows() {
  return [
    { id: 'settings', label: PANEL_TITLES.settings },
    { id: 'airport',  label: PANEL_TITLES.airport },
    { id: 'calls',    label: PANEL_TITLES.calls },
    { id: 'radio',    label: PANEL_TITLES.radio },
    { id: 'efsp',     label: PANEL_TITLES.efsp },
  ];
}

function renderPanelControls() {
  const $panels = document.getElementById('panel-controls');
  if (!$panels) return;
  $panels.innerHTML = '';

  for (const { id, label } of panelControlRows()) {
    const $row = document.createElement('div');
    $row.className = 'panel-ctrl-row';

    const $label = document.createElement('span');
    $label.className = 'panel-ctrl-label';
    $label.textContent = label;
    $label.addEventListener('click', () => {
      toggleDockPanel(id, !isDockPanelOpen(id));
      renderPanelControls();
    });
    $row.appendChild($label);

    const $toggle = document.createElement('label');
    $toggle.className = 'toggle';
    const $cb = document.createElement('input');
    $cb.type = 'checkbox';
    $cb.checked = isDockPanelOpen(id);
    $cb.addEventListener('click', e => e.stopPropagation());
    $cb.addEventListener('change', () => toggleDockPanel(id, $cb.checked));
    const $slider = document.createElement('span');
    $slider.className = 'toggle-slider';
    $toggle.appendChild($cb);
    $toggle.appendChild($slider);
    $row.appendChild($toggle);

    const $pin = document.createElement('button');
    $pin.className = 'panel-pin-btn' + (isPanelPinned(id) ? ' pinned' : '');
    $pin.textContent = 'PIN';
    $pin.title = 'Keep open regardless of radar state';
    $pin.addEventListener('click', (e) => {
      e.stopPropagation();
      setPanelPinned(id, !isPanelPinned(id));
      renderPanelControls();
    });
    $row.appendChild($pin);

    $panels.appendChild($row);
  }
}

// ── EFSP Position selector ("ACTING AS") ────────────────────────────────
// New dedicated control, independent of the radar checkboxes above:
// Ground/Clearance Delivery have no associated radar at all, so radar
// selection can't stand in for "which Position(s) am I acting as" (guide
// §4.8). Lives here rather than as its own panel because which Position a
// controller holds is tied to which panels are relevant to them — the
// same place the Panels section already lives.
//
// WP4A (docs/adr/0013) — grouped by Facility, matching crc-sync's
// facility-config.js's own per-Facility Position sets exactly. Each
// Facility's held set is sent independently (sendEfspSetPositions(
// facilityId, held)) since each has its own PositionStore instance
// server-side — checking CTR never touches INCIRLIK's held set at all.
const EFSP_FACILITY_POSITIONS = {
  INCIRLIK: ['OPS', 'CD', 'GND', 'TWR', 'APP'],
  CENTER: ['CTR'],
};

// Cached once in initRadarPanel(), not looked up fresh per render — this
// panel is called from app.js's async WS message handler (an
// efsp-positions-ack can arrive while the user has switched to a
// different tab), and dockview detaches an inactive tab's DOM from
// `document` (see efsp-panel.js's module comment for the full story —
// this is the exact same bug class, in the other direction: the Panels
// tab going inactive while the Strip panel is what's showing).
let _positionControlsEl = null;
let _positionWarningsEl = null;

function renderPositionControls() {
  if (!_positionControlsEl || typeof getActingPositions !== 'function') return;
  const $positions = _positionControlsEl;
  $positions.innerHTML = '';

  for (const [facilityId, positionIds] of Object.entries(EFSP_FACILITY_POSITIONS)) {
    const held = new Set(getActingPositions(facilityId));

    const $facilityHeader = document.createElement('div');
    $facilityHeader.className = 'panel-ctrl-facility-header';
    $facilityHeader.textContent = facilityId;
    $positions.appendChild($facilityHeader);

    for (const positionId of positionIds) {
      const $row = document.createElement('div');
      $row.className = 'panel-ctrl-row';

      const $label = document.createElement('span');
      $label.className = 'panel-ctrl-label';
      $label.textContent = positionId;
      $row.appendChild($label);

      const $toggle = document.createElement('label');
      $toggle.className = 'toggle';
      const $cb = document.createElement('input');
      $cb.type = 'checkbox';
      $cb.checked = held.has(positionId);
      $cb.addEventListener('change', () => {
        const next = new Set(held);
        if ($cb.checked) next.add(positionId); else next.delete(positionId);
        console.warn('[efsp] Acting-As checkbox changed:', facilityId, positionId, '->', $cb.checked, '| sending held =', [...next]);
        sendEfspSetPositions(facilityId, [...next]);
        renderPositionControls();
      });
      const $slider = document.createElement('span');
      $slider.className = 'toggle-slider';
      $toggle.appendChild($cb);
      $toggle.appendChild($slider);
      $row.appendChild($toggle);

      $positions.appendChild($row);
    }
  }
}

// Rendered from the efsp-positions-ack's `warnings` array (app.js) —
// "warn, do not block" (guide §4.8.6 rule 5): the position change has
// already been committed by the time this renders, this is purely the
// count/destination notice, never a confirmation gate.
function renderPositionWarnings(warnings) {
  if (!_positionWarningsEl) return;
  const $el = _positionWarningsEl;
  if (!warnings || warnings.length === 0) { $el.textContent = ''; return; }
  $el.textContent = warnings.map(w =>
    w.routedTo
      ? `${w.count} Strip(s) from ${w.positionId} routed to ${w.routedTo}`
      : `${w.count} Strip(s) from ${w.positionId} have no covering Position — unassigned`
  ).join(' · ');
}

// Updates the topbar Panels-control button's badge (number of active radars)
function updateRadarBadge() {
  const $badge = document.getElementById('radar-count-badge');
  if (!$badge) return;
  const n = getActiveRadars().length;
  $badge.textContent = n;
}

// Now a normal dockview panel, reached via the topbar Panels-control button
// (dock.js's wireRadarsPanelButton/toggleOrFocusPanel) — no open/close
// class toggling or outside-click handling needed here any more.
function initRadarPanel() {
  const $dlToggle = document.getElementById('datalink-toggle');
  const $dlRow    = document.getElementById('datalink-row');
  const $search   = document.getElementById('radar-search');
  _positionControlsEl = document.getElementById('efsp-position-controls');
  _positionWarningsEl = document.getElementById('efsp-position-warnings');

  if ($dlToggle) {
    $dlToggle.checked = settings.datalink ?? false;
    if ($dlRow) $dlRow.classList.toggle('active', !!settings.datalink);
    $dlToggle.addEventListener('change', () => {
      settings.datalink = $dlToggle.checked;
      if ($dlRow) $dlRow.classList.toggle('active', $dlToggle.checked);
      saveSettings();
      updateTopbarUI();
      resetSweepState();
      updateMap();
      updateZoomLimits();
    });
  }

  if ($search) {
    $search.addEventListener('input', () => renderRadarSearchResults($search.value));
  }

  renderActiveRadars();
  renderRadarSearchResults('');
  renderPanelControls();
  renderPositionControls();

  return {
    // Refresh every time the tab becomes active — active-radar list, search
    // (cleared), and panel statuses/pins may all have drifted while this
    // panel was in the background (e.g. a radar toggled elsewhere, or a
    // panel closed/pinned from its own tab).
    onShow: () => {
      if ($search) { $search.value = ''; setTimeout(() => $search.focus(), 60); }
      renderActiveRadars();
      renderRadarSearchResults('');
      renderPanelControls();
      renderPositionControls();
    },
    onClose: hideLosProfile,
  };
}
