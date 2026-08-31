'use strict';

// ── Topbar chrome: status dots, update banner, patch notes, Zulu clock,
// bullseye cursor readout and measure-line labels. Split out of the former
// ui.js "god file" — these functions are called from app.js/sync.js/
// map-setup.js as plain globals (not wrapped in an IIFE like srs-radio.js,
// since that would hide them from those callers — see panels/README notes
// in the architecture plan for why).

// ── Topbar display elements ────────────────────────────────────────────────

const $aptDisplay = document.getElementById('apt-display');

function updateAptDisplay() {
  if (!selectedApt) {
    $aptDisplay.textContent = 'APT: NONE';
    $aptDisplay.classList.remove('active');
  } else {
    $aptDisplay.textContent = `APT: ${selectedApt.icao || selectedApt.name}`;
    $aptDisplay.classList.add('active');
  }
  if (mapReady) {
    map.getSource('range-ring').setData(buildRangeRing());
  }
}

// Update topbar visibility based on active radar types.
function updateTopbarUI() {
  const $aptSep = document.getElementById('apt-sep');
  const $rwySep = document.getElementById('rwy-sep');
  const $rwyRow = document.getElementById('rwy-row');

  $aptDisplay.style.display = '';
  $aptSep.style.display     = '';

  const hasAptSel = !!selectedApt;
  $rwySep.style.display = hasAptSel ? '' : 'none';
  $rwyRow.style.display = hasAptSel ? '' : 'none';
}

// ── Status UI ─────────────────────────────────────────────────────────────

const $dotGrpc  = document.getElementById('dot-grpc');
const $dotSrs   = document.getElementById('dot-srs');
const $lblGrpc  = document.getElementById('lbl-grpc');
const $discOver = document.getElementById('disc-overlay');
const $stale    = document.getElementById('stale-banner');

function updateStatusUI() {
  $dotGrpc.className   = 'dot ' + grpcStatus;
  $dotSrs.className    = 'dot ' + srsStatus;
  $lblGrpc.textContent = grpcStatus === 'connected' ? 'GRPC' : grpcStatus.toUpperCase();
  $discOver.classList.toggle('visible', grpcStatus === 'disconnected');
}

const $noAwacsOver = document.getElementById('no-awacs-overlay');
function updateNoAwacsUI() {
  $noAwacsOver.classList.toggle('visible', !!noRadarsActive);
}

// ── Update status (electron-updater, via preload IPC bridge) ──────────────

const $statusUpdate = document.getElementById('status-update');
const $updateSep    = document.getElementById('update-sep');
const $dotUpdate    = document.getElementById('dot-update');
const $lblUpdate    = document.getElementById('lbl-update');

function renderUpdateStatus(status) {
  const state = status && status.state;
  const show  = state && state !== 'idle';
  $statusUpdate.style.display = show ? '' : 'none';
  $updateSep.style.display    = show ? '' : 'none';
  if (!show) return;

  $dotUpdate.className = 'dot';
  $statusUpdate.classList.toggle('clickable', state === 'ready');

  if (state === 'checking') {
    $dotUpdate.classList.add('checking');
    $lblUpdate.textContent = 'CHECKING';
  } else if (state === 'downloading') {
    $dotUpdate.classList.add('downloading');
    $lblUpdate.textContent = `${status.percent ?? 0}%`;
  } else if (state === 'ready') {
    $dotUpdate.classList.add('ready');
    $lblUpdate.textContent = 'UPDATE READY';
  }
}

function initUpdateStatus() {
  if (!window.crcUpdate) return; // defensive: absent if preload failed to load
  $statusUpdate.addEventListener('click', () => {
    if ($statusUpdate.classList.contains('clickable')) window.crcUpdate.restartNow();
  });
  window.crcUpdate.onStatus(renderUpdateStatus);
  initPatchNotesButton();
}

// "WHAT'S NEW" — the one-time dialog main.js shows right after an autoupdate
// lands is easy to miss (native message box, fires during startup). This
// button re-shows the same notes at any time, for as long as they're the
// most recent update's — see patch-notes.js's readLastPatchNotes.
function _showPatchNotesModal(version, notes) {
  if (document.getElementById('crc-patch-notes-modal')) return;
  const el = document.createElement('div');
  el.id = 'crc-patch-notes-modal';
  el.style.cssText = 'position:fixed;inset:0;background:rgba(5,8,5,0.75);display:flex;' +
    'align-items:center;justify-content:center;z-index:100000;font-family:"Courier New",monospace;';
  const safeNotes = notes.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  el.innerHTML = `
    <div style="background:#0d130d;border:1px solid #2a3a2a;padding:22px;width:420px;max-height:70vh;
      display:flex;flex-direction:column;gap:14px;color:#c8d8c8;">
      <div style="font-size:13px;letter-spacing:2px;color:#39ff7a;">WHAT'S NEW IN CRC v${version}</div>
      <div style="font-size:11px;line-height:1.6;white-space:pre-wrap;overflow-y:auto;color:#c8d8c8;">${safeNotes}</div>
      <button id="crc-patch-notes-close" style="align-self:flex-end;padding:7px 16px;background:#132313;color:#39ff7a;
        border:1px solid #2a3a2a;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:1px;">CLOSE</button>
    </div>`;
  document.body.appendChild(el);
  document.getElementById('crc-patch-notes-close').addEventListener('click', () => el.remove());
  el.addEventListener('click', (e) => { if (e.target === el) el.remove(); });
}

function initPatchNotesButton() {
  const $btn = document.getElementById('btn-patch-notes');
  if (!$btn || !window.crcUpdate.getPatchNotes) return;

  window.crcUpdate.getPatchNotes().then((info) => {
    if (!info) return; // no update has ever landed on this install yet
    $btn.style.display = '';
    $btn.addEventListener('click', () => _showPatchNotesModal(info.version, info.notes));
  }).catch(() => {});
}

function checkStale() {
  const isStale  = grpcStatus === 'reconnecting'
    && lastUpdateMs != null
    && Date.now() - lastUpdateMs > STALE_MS;
  const wasStale = $stale.classList.contains('visible');
  $stale.classList.toggle('visible', isStale);
  if (isStale !== wasStale) updateMap();
}

// ── Bullseye cursor BRA ────────────────────────────────────────────────────

const $cursorBra = document.getElementById('cursor-bra');

function updateBullseyeCursor(e) {
  const bulls = getBullseye();
  const be = bulls.blue || bulls.red;
  if (!be) { $cursorBra.classList.remove('visible'); return; }

  const rect   = map.getCanvas().getBoundingClientRect();
  const cursor = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
  const distNm = haversineM(be.lat, be.lon, cursor.lat, cursor.lng) / 1852;
  const hdg    = (Math.round(gridBearingDeg(be.lat, be.lon, cursor.lat, cursor.lng)) + (settings.hdgCorrection || 0) + 360) % 360;

  $cursorBra.textContent = `${hdg.toString().padStart(3, '0')}/${Math.round(distNm).toString().padStart(3, '0')}`;
  $cursorBra.style.color = settings.braColor;
  $cursorBra.classList.add('visible');

  const offX = 14, offY = 14;
  const nearRight = e.clientX + offX + 80 > window.innerWidth;
  $cursorBra.style.left = (nearRight ? e.clientX - 80 : e.clientX + offX) + 'px';
  $cursorBra.style.top  = (e.clientY + offY) + 'px';
}

// ── Measure line ──────────────────────────────────────────────────────────

function updateMeasureLine(lng1, lat1, lng2, lat2) {
  if (!mapReady) return;
  const distNm  = Math.round(haversineM(lat1, lng1, lat2, lng2) / 1852);
  const bearing = (Math.round(gridBearingDeg(lat1, lng1, lat2, lng2)) + (settings.hdgCorrection || 0) + 360) % 360;
  const label   = `${bearing.toString().padStart(3,'0')} / ${distNm.toString().padStart(3,'0')}`;
  map.getSource('measure').setData({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[lng1, lat1], [lng2, lat2]] }, properties: { kind: 'line' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [(lng1+lng2)/2, (lat1+lat2)/2] }, properties: { kind: 'label', label } },
    ],
  });
}

// ── Zulu clock (DCS in-game time) ─────────────────────────────────────────
// Server pushes GetScenarioCurrentTime every 5 s as an ISO 8601 string.
// We anchor that to a local timestamp and advance the display in real-time
// between server updates.

let _gameTimeBaseMs  = null; // real Date.now() when the anchor was set
let _gameTimeBaseSec = null; // game seconds-of-day at the anchor

function updateGameTime(isoDatetime) {
  // Parse HH:MM:SS directly from the ISO string — avoids browser local/UTC
  // ambiguity with Date(). DCS returns theater local time, not UTC.
  const m = isoDatetime.match(/T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return;
  _gameTimeBaseMs  = Date.now();
  _gameTimeBaseSec = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
}

function initZuluClock() {
  const $el = document.getElementById('zulu-clock');
  if (!$el) return;
  setInterval(() => {
    if (_gameTimeBaseSec === null) {
      $el.textContent = '--:--:--Z';
      return;
    }
    const elapsed    = Math.floor((Date.now() - _gameTimeBaseMs) / 1000);
    const offsetSec  = (settings.gameTimeOffset || 0) * 3600;
    const total      = ((_gameTimeBaseSec + elapsed - offsetSec) % 86400 + 86400) % 86400;
    const hh = String(Math.floor(total / 3600)).padStart(2, '0');
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    $el.textContent = `${hh}:${mm}:${ss}Z`;
  }, 1000);
}
