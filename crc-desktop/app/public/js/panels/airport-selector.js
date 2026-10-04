'use strict';
import { _syncAuthHeaders } from '../sync.js';
import { escapeHtml } from '../html-escape.js';
import { requestTrueFromMagnetic } from '../magnetic.js';
import { updateMap } from '../geojson.js';
import { $aptDisplay, updateAptDisplay, updateTopbarUI } from './topbar.js';
import { approachRwyCourse, missionData, selectedApt } from '../app.js';
import { _setApproachRwyCourse, _setSelectedApt } from '../app.js';

// ── Airport selector (topbar dropdown + runway course input) and the
// airport-weather popup shown when left-clicking an airport label on the
// map. Split out of the former ui.js "god file" (history).

const HELIPAD_PATTERN = /helipad|farp|fob/i;

function populateAptDropdown($dd) {
  const $list  = document.getElementById('apt-list');
  const search = (document.getElementById('apt-search') || {}).value || '';
  const term   = search.trim().toLowerCase();
  $list.innerHTML = '';

  const airports = (missionData && missionData.airports) || [];
  const sorted   = [...airports]
    .filter(a => a.lat && a.lon && a.name !== 'H' && !HELIPAD_PATTERN.test(a.name))
    .sort((a, b) => (a.icao || a.name).localeCompare(b.icao || b.name))
    .filter(a => {
      if (!term) return true;
      return (a.icao  || '').toLowerCase().includes(term)
          || (a.name  || '').toLowerCase().includes(term);
    });

  if (sorted.length === 0) {
    const el = document.createElement('div');
    el.className   = 'apt-option';
    el.style.color = '#2a4a2a';
    el.textContent = term ? 'NO MATCH' : 'NO AIRPORTS';
    $list.appendChild(el);
    return;
  }

  for (const a of sorted) {
    const el       = document.createElement('div');
    const isActive = selectedApt && selectedApt.name === a.name;
    el.className   = 'apt-option' + (isActive ? ' active' : '');
    const code = document.createElement('span');
    code.textContent = a.icao || a.name;
    const full = document.createElement('span');
    full.className = 'apt-opt-name';
    full.textContent = a.icao ? a.name : '';
    el.append(code, full);
    el.addEventListener('click', () => {
      _setSelectedApt(a);
      $dd.classList.remove('open');
      updateAptDisplay();
      updateTopbarUI();
      resolveApproachCourse();
      updateMap();
    });
    $list.appendChild(el);
  }
}

function openAptDropdown() {
  const $dd     = document.getElementById('apt-dropdown');
  const $search = document.getElementById('apt-search');
  $search.value = '';
  populateAptDropdown($dd);
  const rect = $aptDisplay.getBoundingClientRect();
  $dd.style.left = rect.left + 'px';
  $dd.classList.add('open');
  // Focus search after transition settles
  setTimeout(() => $search.focus(), 30);
}

export function initAptSelector() {
  const $dd     = document.getElementById('apt-dropdown');
  const $search = document.getElementById('apt-search');

  $aptDisplay.addEventListener('click', (e) => {
    e.stopPropagation();
    if ($dd.classList.contains('open')) { $dd.classList.remove('open'); return; }
    openAptDropdown();
  });
  document.addEventListener('click', () => $dd.classList.remove('open'));

  // Live search filtering — stop propagation so the document click doesn't close
  $search.addEventListener('input', () => populateAptDropdown($dd));
  $search.addEventListener('click', e => e.stopPropagation());
}

// ── Approach vector (runway course input) ─────────────────────────────────
// The course is typed MAGNETIC. The map draws in true, and a typed magnetic
// value is converted by crc-sync, never here (its docs/adr/0085): until the
// answer comes back, no approach vector is drawn.

export let approachRwyCourseTrue = null; // approachRwyCourse at selectedApt, in true
let _approachCourseReq = 0;

export function resolveApproachCourse() {
  const req = ++_approachCourseReq;
  approachRwyCourseTrue = null;
  if (approachRwyCourse == null || !selectedApt) return;
  requestTrueFromMagnetic(approachRwyCourse, selectedApt.lat, selectedApt.lon).then((t) => {
    if (req !== _approachCourseReq) return; // a newer entry replaced it
    approachRwyCourseTrue = t;
    updateMap();
  });
}

export function initRwyInput() {
  const $rwyInput = document.getElementById('rwy-input');
  if (!$rwyInput) return;

  $rwyInput.addEventListener('input', () => {
    const val = parseInt($rwyInput.value, 10);
    _setApproachRwyCourse((!isNaN(val) && val >= 0 && val <= 360) ? val % 360 : null);
    resolveApproachCourse();
    updateMap();
  });
  $rwyInput.addEventListener('click', e => e.stopPropagation());
}

// ── Airport weather popup ─────────────────────────────────────────────────
// Shown when the user left-clicks an airport label on the map.

export function showAptWeatherPanel(label, lat, lon, elevM, clientX, clientY) {
  const panel = document.getElementById('apt-weather-panel');
  if (!panel) return;

  panel.innerHTML =
    `<div class="awp-header"><span class="awp-label">${escapeHtml(label)}</span>` +
    `<button class="awp-close" id="awp-close">✕</button></div>` +
    `<div class="awp-body" id="awp-body"><div class="awp-loading">FETCHING…</div></div>`;

  // Position near click, keep inside viewport
  const W = 170, H = 120;
  let left = clientX + 12;
  let top  = clientY + 12;
  if (left + W > window.innerWidth)  left = clientX - W - 4;
  if (top  + H > window.innerHeight) top  = clientY - H - 4;
  panel.style.left    = left + 'px';
  panel.style.top     = top  + 'px';
  panel.style.display = 'block';

  document.getElementById('awp-close').addEventListener('click', closeAptWeatherPanel);

  fetch(`/api/apt-weather?lat=${lat}&lon=${lon}&alt=${elevM}`, { headers: _syncAuthHeaders() })
    .then(r => r.json())
    .then(d => {
      const body = document.getElementById('awp-body');
      if (!body) return;
      if (d.error) {
        body.innerHTML = `<div class="awp-err">${escapeHtml(d.error)}</div>`;
        return;
      }
      const inhg  = (d.pressureHpa / 33.8639).toFixed(2);
      // Tower/ATIS wind: magnetic, converted by crc-sync (decisions H76).
      const windDir = d.windFromMagnetic == null ? '---' : String(d.windFromMagnetic).padStart(3, '0');
      body.innerHTML =
        `<div class="awp-row"><span class="awp-k">QNH</span><span class="awp-v">${escapeHtml(d.pressureHpa)} hPa / ${escapeHtml(inhg)} inHg</span></div>` +
        `<div class="awp-row"><span class="awp-k">TEMP</span><span class="awp-v">${escapeHtml(d.tempC)}°C</span></div>` +
        `<div class="awp-row"><span class="awp-k">WIND</span><span class="awp-v">${escapeHtml(windDir)}°M @ ${escapeHtml(d.windKt)} kt</span></div>`;
    })
    .catch(() => {
      const body = document.getElementById('awp-body');
      if (body) body.innerHTML = '<div class="awp-err">UNAVAILABLE</div>';
    });
}

export function closeAptWeatherPanel() {
  const panel = document.getElementById('apt-weather-panel');
  if (panel) panel.style.display = 'none';
}
