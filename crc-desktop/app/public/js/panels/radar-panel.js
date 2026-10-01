'use strict';

// ── Coverage panel: the radars this controller is looking through ─────────
//
// This used to be a radar SELECTOR — a search box, a checkbox per radar, and
// an `enabledRadarIds` set in localStorage that decided what this client could
// see. It is now a read-only list, because coverage follows the Positions a
// controller holds rather than what they tick (crc-sync's docs/adr/0042).
//
// That is the inverse of the arrow crc-sync's docs/adr/0033 rejected. 0033
// refused to derive Positions FROM radar selection, partly because Ground and
// Clearance Delivery have no radar at all, and partly because "coupling
// authority to visibility means a controller silently acquires or loses the
// right to act on Strips by adjusting their display". Running it the other way
// — declare what you hold, receive what it can see — removes that hazard
// instead of reintroducing it, and the "ACTING AS" selector below is still the
// one and only place a Position is declared.
//
// The DATALINK toggle went with the selector. What it did — auto-include every
// own-coalition airborne radar — is now a property of the Positions it belongs
// to: TAC_C2, AIC and GCI carry `coalition: 'own'` selectors in crc-sync's
// facility config. It was never really a display preference; it was a
// description of what a Military Radar Unit works from.
//
// Split out of the former ui.js "god file" — see panels/topbar.js for why this
// stays a plain script rather than an IIFE.

const TYPE_LABELS = { airport: 'AIRPORT', approach: 'APPROACH', awacs: 'AWACS', fighter: 'FIGHTER', carrier: 'CARRIER' };

// Called from app.js when a `coverage` message lands, or when the mission data
// behind the radar list changes. There is nothing to preserve across a
// re-render any more — no search term, no partial selection — so this just
// redraws.
function refreshRadarPanelData() {
  renderCoverageList();
}

/**
 * The radars our held Positions grant us, and why. An empty list is a real
 * answer, not a failure: a Ground or Clearance Delivery controller has no
 * scope, and saying which Position would give them one is more use than an
 * empty box.
 */
function renderCoverageList() {
  const $list = document.getElementById('radar-active-list');
  if (!$list) return;
  $list.innerHTML = '';

  const radars = getActiveRadars();

  if (radars.length === 0) {
    const $empty = document.createElement('div');
    $empty.className = 'radar-empty';
    $empty.textContent = coverageHeldPositions.length === 0
      ? 'No radar coverage — select a Position under ACTING AS below.'
      : `No radar coverage. ${coverageHeldPositions.map(p => p.positionId).join(', ')} ${coverageHeldPositions.length === 1 ? 'works' : 'work'} no scope.`;
    $list.appendChild($empty);
    return;
  }

  for (const r of [...radars].sort((a, b) => a.label.localeCompare(b.label))) {
    const isGnd = !!r.onGround;
    const $row = document.createElement('div');
    $row.className = 'radar-row radar-row-coverage' + (isGnd ? ' disabled' : '');

    const $label = document.createElement('span');
    $label.className = 'radar-row-label';
    $label.textContent = r.label + (isGnd ? ' GND' : '');

    // Which of the held Positions put this radar in the list — the answer to
    // "why am I seeing this", which a checkbox never had to explain.
    const $via = document.createElement('span');
    $via.className = 'radar-row-via';
    $via.textContent = (r.grantedBy || []).join('/');

    const $range = document.createElement('span');
    $range.className = 'radar-row-range';
    $range.textContent = `${Math.round(r.rangeM / 1852)}nm`;
    $range.title = TYPE_LABELS[r.type] || r.type.toUpperCase();

    $row.appendChild($label);
    $row.appendChild($via);
    $row.appendChild($range);
    $row.addEventListener('mouseenter', () => showLosProfile(r, $row));
    $row.addEventListener('mouseleave', () => hideLosProfile());
    $list.appendChild($row);
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
    { id: 'radio',    label: PANEL_TITLES.radio },
    { id: 'efsp',     label: PANEL_TITLES.efsp },
    { id: 'airspace', label: PANEL_TITLES.airspace },
    { id: 'fieldState', label: PANEL_TITLES.fieldState },
    { id: 'metrics',  label: PANEL_TITLES.metrics },
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
  INCIRLIK: ['OPS', 'CD', 'GND', 'TWR', 'RSU', 'APP', 'SFA', 'PAR'], // RSU, SFA and PAR: crc-sync's docs/adr/0075
  CENTER: ['CTR'],
  // WP4A second slice — TAC_C2/AIC/GCI/JTAC (crc-sync's facility-config.js
  // DEFAULT_TACTICAL_CONFIG.positions). JTAC is included the same way as
  // every other Position here even though it's read-only server-side (no
  // ownership/mutation grant, permission.js) — holding it just means
  // "viewing," which this checkbox UI has no separate concept for and
  // doesn't need one: the backend enforces the read-only-ness regardless
  // of what this list renders.
  TACTICAL: ['TAC_C2', 'AIC', 'GCI', 'JTAC'],
  // crc-sync's docs/adr/0074 — the carrier's four Positions (DEFAULT_CARRIER_CONFIG).
  CARRIER: ['CV_MARSHAL', 'CV_PRIFLY', 'CV_APP1', 'CV_APP2'],
  // RANGES is deliberately absent: its Position set is DERIVED server-side
  // from the airspace config (a Position exists only for a range with
  // control of its own), so there is nothing static to list. Those Positions
  // come from the snapshot instead — see _efspPositionsFor below.
};

/**
 * The Positions to offer for a Facility. Static for the three Strip
 * Facilities, whose sets are fixed in facility-config.js; read from the
 * snapshot for RANGES, whose set depends on which ranges are configured.
 *
 * Reading the snapshot for ALL of them would be tidier and would kill this
 * hand-maintained mirror outright, but it would also mean no "acting as"
 * checkboxes at all until the first snapshot lands — a worse failure than
 * the drift it would prevent.
 */
function _efspPositionsFor(facilityId) {
  if (EFSP_FACILITY_POSITIONS[facilityId]) return EFSP_FACILITY_POSITIONS[facilityId];
  if (typeof getAllEfspPositions !== 'function') return [];
  return getAllEfspPositions()
    .filter(p => p.facilityId === facilityId)
    .map(p => p.positionId);
}

/** Every Facility with at least one Position to act as — RANGES disappears entirely when no range is configured. */
function _efspFacilityIds() {
  const ids = Object.keys(EFSP_FACILITY_POSITIONS);
  if (_efspPositionsFor('RANGES').length > 0) ids.push('RANGES');
  return ids;
}

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

  for (const facilityId of _efspFacilityIds()) {
    const positionIds = _efspPositionsFor(facilityId);
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
  _positionControlsEl = document.getElementById('efsp-position-controls');
  _positionWarningsEl = document.getElementById('efsp-position-warnings');

  renderCoverageList();
  renderPanelControls();
  renderPositionControls();

  return {
    // Refresh every time the tab becomes active — coverage, panel statuses and
    // pins may all have drifted while this panel was in the background (a
    // colleague taking a Position changes what an Observer here can see, and a
    // panel may have been closed or pinned from its own tab).
    onShow: () => {
      renderCoverageList();
      renderPanelControls();
      renderPositionControls();
    },
    onClose: hideLosProfile,
  };
}
