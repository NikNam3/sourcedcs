'use strict';

// ── Track info panel ─────────────────────────────────────────────────────
// Left-clicking an aircraft track opens this persistent side panel. It
// shows live properties and integrates IFF + callsign override controls.
// Also owns the ground-vehicle label popup (a small, unrelated floating
// input shown when left-clicking a ground vehicle icon) — grouped here
// because both are "click a map icon, get a small info/edit surface"
// interactions triggered from the same map click-handling code.
// Split out of the former ui.js "god file" — see panels/topbar.js for why
// this stays a plain script rather than an IIFE.

let _trackPanelId = null; // currently displayed track id (string), or null

function initTrackPanel() {
  const $panel   = document.getElementById('track-panel');
  if (!$panel) return;

  // IFF buttons
  const iffColors = () => ({
    friendly: settings.colFriendly || '#4488cc',
    bogey:    settings.colBogey    || '#ccaa00',
    neutral:  settings.colNeutral  || '#888888',
    bandit:   settings.colBandit   || '#cc6600',
    hostile:  settings.colHostile  || '#cc2222',
  });

  $panel.querySelectorAll('.tp-iff-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_trackPanelId == null) return;
      setIffOverride(_trackPanelId, btn.dataset.state);
      _refreshIffButtons();
      updateMap();
    });
  });

  document.getElementById('tp-iff-clr').addEventListener('click', (e) => {
    e.stopPropagation();
    if (_trackPanelId == null) return;
    clearIffOverride(_trackPanelId);
    _refreshIffButtons();
    updateMap();
  });

  // Rename controls
  const $renameInput = document.getElementById('tp-rename-input');
  const commitRename = () => {
    if (_trackPanelId == null) return;
    setTrackRename(_trackPanelId, $renameInput.value);
    updateMap();
    _refreshCallsign();
  };
  document.getElementById('tp-rename-set').addEventListener('click', (e) => {
    e.stopPropagation(); commitRename();
  });
  document.getElementById('tp-rename-clr').addEventListener('click', (e) => {
    e.stopPropagation();
    if (_trackPanelId == null) return;
    clearTrackRename(_trackPanelId);
    $renameInput.value = '';
    updateMap();
    _refreshCallsign();
  });
  $renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    if (e.key === 'Escape') { closeTrackPanel(); }
  });
  $renameInput.addEventListener('click', e => e.stopPropagation());

  function _refreshIffButtons() {
    const cols = iffColors();
    // Fresh (non-sweep-gated) lookup: an IFF declaration is crc-sync's
    // shared state, not a radar return, so it should reflect immediately —
    // not wait for the simulated radar beam to next illuminate this track.
    const t        = _trackPanelId != null ? window.getLatestTrack(_trackPanelId) : null;
    const override = t ? t.iffOverride : null;
    $panel.querySelectorAll('.tp-iff-btn').forEach(btn => {
      const col = cols[btn.dataset.state] || '#888888';
      btn.style.color       = col;
      btn.style.borderColor = col + '55';
      btn.classList.toggle('iff-active', btn.dataset.state === override);
    });
    if (t) _refreshIffState(t);
  }

  function _refreshCallsign() {
    if (_trackPanelId == null) return;
    const t = window.getLatestTrack(_trackPanelId);
    if (t) document.getElementById('tp-callsign').textContent = resolveCallsign(t);
  }

  // Expose so updateTrackPanel can call them
  initTrackPanel._refreshIffButtons = _refreshIffButtons;

  return { onClose: closeTrackPanel };
}

function _refreshIffState(t) {
  const state  = getIff(t);
  const col    = iffColor(state);
  const $badge = document.getElementById('tp-iff-state');
  if (!$badge) return;
  $badge.innerHTML = '';
  const span = document.createElement('span');
  span.className   = 'tp-iff-state';
  span.textContent = state.toUpperCase();
  span.style.color       = col;
  span.style.borderColor = col + '55';
  $badge.appendChild(span);
}

function showTrackPanel(id) {
  _trackPanelId = String(id);
  // Track Info is a normal closable panel now (see dock.js's REQUIRED_PANELS
  // comment) — clicking a track is its reopen path, so get-or-create it
  // rather than assuming it's already there.
  if (dock) ensureTrackPanel().api.setActive();
  updateTrackPanel();
}

// Clears the currently-displayed track's data. Track Info now lives as a
// permanent tab in the left dockview group rather than a panel that can be
// hidden outright, so "closing" it just blanks its content — it no longer
// forces the view away to whatever tab the user had open before (dockview
// owns tab switching, and yanking focus away on every empty-map click would
// be more surprising than useful).
function closeTrackPanel() {
  _trackPanelId    = null;
  _fplFetchCallsign = null;
  const $fplSec = document.getElementById('tp-fpl-section');
  if ($fplSec) $fplSec.style.display = 'none';
  _clearFiledRoute();
}

// Fetch and display the flight plan for the resolved callsign of the current track.
// Aborts silently if the panel is closed or a newer fetch has started.
let _fplFetchCallsign = null;
let _currentFplMessage = null;
let _filedRouteShown   = false;

function _clearFiledRoute() {
  _filedRouteShown = false;
  if (mapReady) map.getSource('filed-route').setData({ type: 'FeatureCollection', features: [] });
  const $btn    = document.getElementById('tp-fpl-route-btn');
  const $status = document.getElementById('tp-fpl-route-status');
  if ($btn) $btn.textContent = 'OVERLAY ROUTE';
  if ($status) $status.textContent = '';
}

function _refreshTrackFpl(callsign) {
  const $section = document.getElementById('tp-fpl-section');
  const $msg     = document.getElementById('tp-fpl-msg');
  if (!$section || !$msg) return;

  _currentFplMessage = null;
  _clearFiledRoute();

  if (!callsign) {
    $section.style.display = 'none';
    return;
  }

  _fplFetchCallsign = callsign;
  fetch('/api/fpl/' + encodeURIComponent(callsign))
    .then(r => r.json().then(j => ({ ok: r.ok, body: j })))
    .then(({ ok, body }) => {
      if (_fplFetchCallsign !== callsign) return; // stale
      if (!ok || !body.fplMessage) {
        $section.style.display = 'none';
        return;
      }
      $msg.textContent       = body.fplMessage;
      _currentFplMessage     = body.fplMessage;
      $section.style.display = 'block';
    })
    .catch(() => {
      if (_fplFetchCallsign !== callsign) return;
      $section.style.display = 'none';
    });
}

(function initFiledRouteButton() {
  const $btn    = document.getElementById('tp-fpl-route-btn');
  const $status = document.getElementById('tp-fpl-route-status');
  if (!$btn) return;

  $btn.addEventListener('click', () => {
    if (_filedRouteShown) { _clearFiledRoute(); return; }

    if (!_currentFplMessage) return;
    const { points, matched, total } = parseFiledRouteWaypoints(_currentFplMessage);
    if (matched < 2) {
      if ($status) $status.textContent = total > 0
        ? `only ${matched} of ${total} waypoints resolved — can't plot a route`
        : 'no route waypoints found';
      return;
    }

    map.getSource('filed-route').setData(buildFiledRoute(points));
    _filedRouteShown = true;
    $btn.textContent = 'HIDE ROUTE';
    if ($status) $status.textContent = `${matched} of ${total} waypoints plotted`;
  });
})();

function updateTrackPanel() {
  if (_trackPanelId == null) return;
  const t = tracks.get(_trackPanelId);
  if (!t) return; // track faded out — leave panel open with last values

  // crc-sync's shared state (IFF/callsign/rename) should reflect immediately,
  // independent of the sweep-gated `t` used for telemetry below — see
  // window.getLatestTrack's definition in app.js.
  const fresh = window.getLatestTrack(_trackPanelId) || t;

  const hist     = history.get(_trackPanelId) || [];
  const { heading, speedKt } = kinematics(hist);
  const fpm      = verticalFpm(hist);
  const altFt    = Math.round(indicatedAltFt(t.alt || 0));
  const fl       = Math.round(altFt / 100);
  const spec     = aircraftTypes && aircraftTypes[t.type];

  // Header
  const cs = resolveCallsign(fresh);
  document.getElementById('tp-callsign').textContent = cs;
  document.getElementById('tp-type').textContent     = (spec && spec.label) || t.type || '';

  // Properties
  const taFt = settings.transitionAltFt ?? 18000;
  document.getElementById('tp-alt').textContent  = altFt >= taFt
    ? `FL${String(fl).padStart(3,'0')}`
    : altFt.toLocaleString();
  const vsSign = fpm >  50 ? '+' : fpm < -50 ? '' : '±';
  document.getElementById('tp-vs').textContent   =
    Math.abs(fpm) < 50 ? 'level' : `${vsSign}${Math.round(fpm)} fpm`;
  // heading here is a true bearing (kinematics() derives it from raw
  // lat/lon deltas) — first correct true→grid (gridConvergenceDeg, see
  // geo.js: DCS's cockpit heading tape is referenced to its flat internal
  // grid, not true geodetic north — the two differ by the local convergence
  // angle), then apply settings.hdgCorrection the same way every other
  // displayed heading does (BRA/cursor bearing above, runway heading in
  // geojson.js): displayed = grid + hdgCorrection. hdgCorrection is a manual
  // fudge factor, not real-world magnetic variation — see app.js DEFAULTS.
  const conv   = gridConvergenceDeg(t.lat, t.lon);
  const hdgMag = (Math.round(heading - conv) + (settings.hdgCorrection || 0) + 360) % 360;
  document.getElementById('tp-hdg').textContent  =
    `${String(hdgMag).padStart(3,'0')}°`;
  document.getElementById('tp-spd').textContent  =
    `${Math.round(speedKt)} kt`;
  document.getElementById('tp-sqwk').textContent =
    t.squawk != null ? String(t.squawk).padStart(4,'0') : '—';

  // IFF state badge
  _refreshIffState(fresh);

  // IFF buttons
  if (initTrackPanel._refreshIffButtons) initTrackPanel._refreshIffButtons();

  // Rename input (only pre-fill if it's not focused)
  const $ri = document.getElementById('tp-rename-input');
  if ($ri && document.activeElement !== $ri) {
    $ri.value = fresh.rename || '';
  }

  // Flight plan (fetched once per callsign change; compare uppercase to avoid case-drift stalls)
  if ((cs || '').toUpperCase() !== (_fplFetchCallsign || '').toUpperCase()) _refreshTrackFpl(cs);
}

// ── Ground vehicle label popup ────────────────────────────────────────────
// Left-clicking a ground vehicle icon opens a small floating input so the
// controller can assign a custom label.  The popup is dismissed on Enter,
// Escape, or clicking outside.

function showGroundLabelPopup(id, clientX, clientY) {
  const popup = document.getElementById('gnd-label-popup');
  const input = document.getElementById('gnd-label-input');
  if (!popup || !input) return;

  // Pre-fill with any existing label for this vehicle
  input.value = groundLabels.get(id) || '';

  // Position near the click, keeping it inside the viewport
  const popW = 160, popH = 36;
  let left = clientX + 10;
  let top  = clientY + 10;
  if (left + popW > window.innerWidth)  left = clientX - popW - 4;
  if (top  + popH > window.innerHeight) top  = clientY - popH - 4;

  popup.style.left    = left + 'px';
  popup.style.top     = top  + 'px';
  popup.style.display = 'block';
  input.focus();
  input.select();

  function commit() {
    const label = input.value.trim().toUpperCase();
    if (label) groundLabels.set(id, label);
    else       groundLabels.delete(id);
    close();
    updateMap();
  }

  function close() {
    popup.style.display = 'none';
    input.removeEventListener('keydown', onKey);
    document.removeEventListener('click', onOutside, true);
  }

  function onKey(e) {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { close(); }
  }

  function onOutside(e) {
    if (!popup.contains(e.target)) close();
  }

  input.addEventListener('keydown', onKey);
  // Delay attaching the outside-click listener so the current click event
  // that triggered the popup doesn't immediately dismiss it.
  setTimeout(() => document.addEventListener('click', onOutside, true), 0);
}
