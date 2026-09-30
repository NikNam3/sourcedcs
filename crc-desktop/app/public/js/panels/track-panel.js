'use strict';

// ── Track info panel ─────────────────────────────────────────────────────
// Left-clicking an aircraft track opens this persistent side panel. It
// shows what this controller's sensors know about the contact (crc-sync's
// docs/adr/0059 — every string from track-label.js), its correlated flight,
// and the IFF and tag controls. Also owns the ground-vehicle tag popup (a small, unrelated floating
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

  // Tag controls: a name for a contact nothing else identifies. Disabled
  // while the contact's flight (or its datalink report) names it.
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
    if (t) document.getElementById('tp-callsign').textContent = trackName(t) + trackNameSuffix(t);
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
  _fplShownFor     = null;
  const $fplSec = document.getElementById('tp-fpl-section');
  if ($fplSec) $fplSec.style.display = 'none';
  _clearFiledRoute();
}

// The correlated flight's filed plan. The flight record IS the flight plan
// (docs/adr/0059): a contact has one once it is correlated to a Strip, and
// there is nothing to look up by callsign any more.
let _fplShownFor     = null; // fdrId + rev last rendered
let _currentFiled    = null;
let _filedRouteShown = false;

function _clearFiledRoute() {
  _filedRouteShown = false;
  if (mapReady) map.getSource('filed-route').setData({ type: 'FeatureCollection', features: [] });
  const $btn    = document.getElementById('tp-fpl-route-btn');
  const $status = document.getElementById('tp-fpl-route-status');
  if ($btn) $btn.textContent = 'OVERLAY ROUTE';
  if ($status) $status.textContent = '';
}

function _refreshTrackFpl(fdr) {
  const $section = document.getElementById('tp-fpl-section');
  const $msg     = document.getElementById('tp-fpl-msg');
  if (!$section || !$msg) return;
  const key = fdr ? `${fdr.fdrId}:${fdr.rev}` : null;
  if (key === _fplShownFor) return;
  _fplShownFor = key;
  _clearFiledRoute();
  const filed = fdr && fdr.filed;
  if (!filed || !(filed.route || filed.departureAirport || filed.destinationAirport)) {
    _currentFiled = null;
    $section.style.display = 'none';
    return;
  }
  _currentFiled = filed;
  const cruise = filed.requestedAltitude ? ` · ${filed.requestedAltitude}` : '';
  $msg.textContent = [
    `${fdr.identity.callsign}${fdr.identity.aircraftType ? ' ' + fdr.identity.aircraftType : ''}${cruise}`,
    [filed.departureAirport, filed.route, filed.destinationAirport].filter(Boolean).join(' '),
  ].join('\n');
  $section.style.display = 'block';
}

(function initFiledRouteButton() {
  const $btn    = document.getElementById('tp-fpl-route-btn');
  const $status = document.getElementById('tp-fpl-route-status');
  if (!$btn) return;

  $btn.addEventListener('click', () => {
    if (_filedRouteShown) { _clearFiledRoute(); return; }

    if (!_currentFiled) return;
    const { points, matched, total } = parseFiledRouteWaypoints(_currentFiled);
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

/**
 * docs/adr/0058 — the flight's assigned altitude and heading (from its Strip's
 * flight record, when correlated), and any conflict or conformance alert.
 * Nothing is shown while nothing is wrong.
 */
function _refreshTrackAlerts(trackId) {
  const fdr = typeof _fdrForTrack === 'function' ? _fdrForTrack(trackId) : null;
  // "ALT FL180 · HDG 050".
  const active = (cell) => cell && cell.entries.find(e => e.status === 'ACTIVE');
  const alt = fdr && fdr.clearance && active(fdr.clearance.altitude);
  const hdg = fdr && fdr.clearance && active(fdr.clearance.heading);
  const parts = [];
  if (alt && Number.isFinite(alt.parsed)) parts.push(`ALT ${assignedAltText(alt.parsed)}`);
  if (hdg && Number.isFinite(hdg.parsed)) parts.push(`HDG ${String(hdg.parsed).padStart(3, '0')}`);
  const $key = document.getElementById('tp-asgn-key');
  const $val = document.getElementById('tp-asgn');
  if ($key && $val) {
    $key.hidden = parts.length === 0;
    $val.hidden = parts.length === 0;
    $val.textContent = parts.join(' · ');
  }
  const $alerts = document.getElementById('tp-alerts');
  if (!$alerts) return;
  const lines = [];
  const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  for (const c of (typeof stcaConflictsForTrack === 'function' ? stcaConflictsForTrack(trackId) : [])) {
    lines.push({ bad: true, text: `STCA with ${c.otherCallsign} in ${clock(c.timeToCpaSec)}. Closest ${c.minNm} NM / ${c.vertFt} ft.` });
  }
  for (const a of (fdr && typeof conformanceAlertsForFdr === 'function' ? conformanceAlertsForFdr(fdr.fdrId) : [])) {
    const pad = (n) => String(n).padStart(3, '0');
    if (a.kind === 'HEADING') lines.push({ bad: false, text: `Assigned heading ${pad(a.assigned)}, tracking ${pad(a.actual)}.` });
    if (a.kind === 'WRONG_WAY') lines.push({ bad: true, text: `Assigned ${a.assigned.toLocaleString('en-US')} ft, ${a.fpm < 0 ? 'descending' : 'climbing'} at ${Math.abs(a.fpm).toLocaleString('en-US')} ft/min.` });
    if (a.kind === 'LEVEL_BUST') lines.push({ bad: true, text: `Level bust: ${a.deviationFt > 0 ? '+' : '−'}${Math.abs(a.deviationFt)} ft from ${a.assigned.toLocaleString('en-US')} ft.` });
  }
  $alerts.innerHTML = '';
  for (const l of lines) {
    const div = document.createElement('div');
    div.className = 'tp-alert' + (l.bad ? '' : ' tp-alert-attn');
    div.textContent = l.text;
    $alerts.appendChild(div);
  }
}

function updateTrackPanel() {
  if (_trackPanelId == null) return;
  const t = tracks.get(_trackPanelId);
  if (!t) return; // track faded out — leave panel open with last values

  // Who the contact is (its name, IFF, tag) reflects immediately, independent
  // of the sweep-gated `t` used for position and altitude below — see
  // window.getLatestTrack's definition in app.js.
  const fresh = window.getLatestTrack(_trackPanelId) || t;

  const hist     = history.get(_trackPanelId) || [];
  const { heading, speedKt } = kinematics(hist);
  const fpm      = verticalFpm(hist);

  // Header
  document.getElementById('tp-callsign').textContent = trackName(fresh) + trackNameSuffix(fresh);
  document.getElementById('tp-type').textContent     = typeText(fresh);

  // Properties — only what a sensor gives; '—' for the rest.
  document.getElementById('tp-alt').textContent = altitudeLong(t);
  document.getElementById('tp-vs').textContent  = fpm == null ? '—'
    : Math.abs(fpm) < 50 ? 'level' : `${fpm > 0 ? '+' : ''}${Math.round(fpm)} fpm`;
  // kinematics() gives a TRUE course over the ground (from lat/lon deltas);
  // shown magnetic, like every heading (magnetic.js, crc-sync docs/adr/0085).
  document.getElementById('tp-hdg').textContent  =
    `${magneticText(heading, t.lat, t.lon)}°`;
  document.getElementById('tp-spd').textContent  =
    `${Math.round(speedKt)} kt`;
  document.getElementById('tp-sqwk').textContent = (t.ssr && t.ssr.code) || '—';

  // IFF state badge
  _refreshIffState(fresh);

  // Assigned values and alerts (docs/adr/0058)
  _refreshTrackAlerts(String(_trackPanelId));

  // IFF buttons
  if (initTrackPanel._refreshIffButtons) initTrackPanel._refreshIffButtons();

  // Tag input (only pre-fill if it's not focused); disabled while the
  // contact's flight or datalink report names it.
  const $ri = document.getElementById('tp-rename-input');
  if ($ri) {
    const editable = tagEditable(fresh);
    $ri.disabled = !editable;
    $ri.placeholder = editable ? 'tag…' : `named by its ${fresh.label.source === 'DATALINK' ? 'datalink report' : 'flight'}`;
    if (document.activeElement !== $ri) $ri.value = (fresh.label && fresh.label.tag) || '';
  }

  // The correlated flight's plan
  _refreshTrackFpl(typeof _fdrForTrack === 'function' ? _fdrForTrack(String(_trackPanelId)) : null);
}

// ── Ground vehicle tag popup ──────────────────────────────────────────────
// Left-clicking a ground vehicle icon opens a small floating input so the
// controller can tag it — the same shared tag the track panel sets, so every
// controller sees it. Dismissed on Enter, Escape, or clicking outside.

function showGroundLabelPopup(id, clientX, clientY) {
  const popup = document.getElementById('gnd-label-popup');
  const input = document.getElementById('gnd-label-input');
  if (!popup || !input) return;

  // Pre-fill with the vehicle's existing tag
  const t = window.getLatestTrack(id);
  input.value = (t && t.label && t.label.tag) || '';

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
    setTrackRename(id, input.value);
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
