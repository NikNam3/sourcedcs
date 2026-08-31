'use strict';

// ── APRT / Theater side panel ─────────────────────────────────────────────
// Split out of the former ui.js "god file" — see panels/topbar.js for why
// this stays a plain script rather than an IIFE. This was the single
// largest chunk of ui.js (~625 of its 2234 lines) — airport reference card,
// manual weather entry, ATIS build/transmit/loop, and theater-wide settings
// (transition altitude, heading correction, game-time offset).

let _aprtSelectedApt = null;

// Numeric heading parsed from the APRT panel's runway field, for the
// extended APP-radar centerline (geojson.js buildExtendedCenterline()).
// Cached rather than read from the DOM every map-update tick.
let _aprtRwyHeading = null;

function _updateAprtRwyHeading() {
  const raw = ((document.getElementById('aprt-atis-rwy') || {}).value || '').toUpperCase().trim();
  const m = raw.match(/^(\d{1,2})([LRC]?)$/);
  _aprtRwyHeading = m ? parseInt(m[1], 10) * 10 : null;
  if (typeof updateMap === 'function') updateMap();
}

// Per-app-session id so crc-sync can tell "my own next 5s loop tick" apart
// from a different controller's client transmitting on the same frequency.
const _atisOwnerId = crypto.randomUUID();

// Set once initAprtPanel() has run (it only ever runs once — see dock.js's
// mountExistingPanel), to whatever closure there recomputes the ATIS status
// line from `atisActive` (the live "who's transmitting where" list synced
// from crc-sync — see app.js's 'atis' case). Left null until the panel has
// been opened at least once this session; _updateAprtRefCard()'s call below
// is then just a no-op, which is fine since there's no ATIS status row
// visible to update yet either.
let _atisLiveRefresh = null;

function _updateAprtRefCard() {
  const $card = document.getElementById('aprt-ref-card');
  if (!$card) return;

  const apt = _aprtSelectedApt;
  if (!apt) { $card.style.display = 'none'; return; }
  $card.style.display = 'block';

  const wx       = _aprtLastFetchedWx;
  const key      = apt.icao || apt.name;
  const manualWx = (settings.aprtManualWx && settings.aprtManualWx[key]) || {};

  // Header
  document.getElementById('aprt-ref-name').textContent = apt.name || apt.icao;
  const $icaoBadge = document.getElementById('aprt-ref-icao');
  if ($icaoBadge) $icaoBadge.textContent = (apt.icao && apt.name) ? apt.icao : '';

  // Weather (from gRPC)
  const $wind = document.getElementById('aprt-ref-wind');
  const $qnh  = document.getElementById('aprt-ref-qnh');
  const $temp = document.getElementById('aprt-ref-temp');
  if (wx) {
    const windDir = String(wx.windFrom).padStart(3, '0');
    const inhg    = (wx.pressureHpa / 33.8639).toFixed(2);
    if ($wind) { $wind.textContent = `${windDir}° @ ${wx.windKt} kt`; $wind.className = 'aprt-ref-v'; }
    if ($qnh)  { $qnh.textContent  = `${wx.pressureHpa} hPa  /  ${inhg} inHg`; $qnh.className = 'aprt-ref-v'; }
    if ($temp) { $temp.textContent = `${wx.tempC > 0 ? '+' : ''}${wx.tempC}°C`; $temp.className = 'aprt-ref-v'; }
  } else {
    if ($wind) { $wind.textContent = '—'; $wind.className = 'aprt-ref-v dim'; }
    if ($qnh)  { $qnh.textContent  = '—'; $qnh.className  = 'aprt-ref-v dim'; }
    if ($temp) { $temp.textContent = '—'; $temp.className = 'aprt-ref-v dim'; }
  }

  // VIS (manual)
  const $vis = document.getElementById('aprt-ref-vis');
  if ($vis) {
    const visVal = manualWx.vis !== '' && manualWx.vis != null ? manualWx.vis : null;
    $vis.textContent = visVal != null ? `${visVal} km` : '—';
    $vis.className   = visVal != null ? 'aprt-ref-v' : 'aprt-ref-v dim';
  }

  // Cloud layers (manual)
  const $cldRows = document.getElementById('aprt-ref-cld-rows');
  if ($cldRows) {
    const CLOUD_LABELS = { SKC:'SKC', FEW:'FEW', SCT:'SCT', BKN:'BKN', OVC:'OVC' };
    const clouds = (manualWx.clouds || []).filter(c => c.cover);
    if (clouds.length === 0) {
      $cldRows.innerHTML = '<div class="aprt-ref-row"><span class="aprt-ref-k">CLD</span><span class="aprt-ref-v dim">—</span></div>';
    } else {
      $cldRows.innerHTML = clouds.map((c, i) =>
        `<div class="aprt-ref-row"><span class="aprt-ref-k">${i === 0 ? 'CLD' : ''}</span>` +
        `<span class="aprt-ref-v">${CLOUD_LABELS[c.cover] || c.cover}${c.base ? ' ' + Number(c.base).toLocaleString() + ' ft' : ''}</span></div>`
      ).join('');
    }
  }

  // ATIS ops
  const rwyRaw  = ((document.getElementById('aprt-atis-rwy')  || {}).value || '').toUpperCase().trim();
  const info    = ((document.getElementById('aprt-atis-info') || {}).value || '').toUpperCase().charAt(0);
  const freq    = (document.getElementById('aprt-atis-freq')  || {}).value || '';
  const taFt    = settings.transitionAltFt ?? 18000;

  const $rwy  = document.getElementById('aprt-ref-rwy');
  const $info = document.getElementById('aprt-ref-info');
  const $freq = document.getElementById('aprt-ref-freq');
  const $ta   = document.getElementById('aprt-ref-ta');

  if ($rwy)  { $rwy.textContent  = rwyRaw || '—';  $rwy.className  = rwyRaw  ? 'aprt-ref-v' : 'aprt-ref-v dim'; }
  if ($info) { $info.textContent = info || '—'; $info.className = info ? 'aprt-ref-v' : 'aprt-ref-v dim'; }
  if ($freq) { $freq.textContent = freq   ? `${freq} MHz` : '—'; $freq.className = freq ? 'aprt-ref-v' : 'aprt-ref-v dim'; }
  if ($ta)   { $ta.textContent   = taFt ? `${taFt.toLocaleString()} ft` : '—'; $ta.className = 'aprt-ref-v'; }

  if (_atisLiveRefresh) _atisLiveRefresh();
}

// Re-syncs the theater settings inputs' displayed values from `settings`
// state — called from app.js when a 'theater-settings' broadcast arrives
// from crc-sync (any client, including this one, having edited it) so every
// controller's airport panel shows the same transition altitude / heading
// correction / game-time offset instead of only whoever last edited it
// locally. No-op if the panel has never been mounted (inputs don't exist).
function refreshAprtTheaterInputs() {
  const $transAlt      = document.getElementById('aprt-transition-alt');
  const $hdgCorrection = document.getElementById('aprt-hdg-correction');
  const $timeOffset    = document.getElementById('aprt-time-offset');
  if ($transAlt)      $transAlt.value      = settings.transitionAltFt ?? 18000;
  if ($hdgCorrection) $hdgCorrection.value = settings.hdgCorrection ?? 0;
  if ($timeOffset)    $timeOffset.value    = settings.gameTimeOffset ?? 0;
}

function initAprtPanel() {
  const $panel  = document.getElementById('aprt-panel');
  const $search = document.getElementById('aprt-search');
  if (!$panel) return;

  _renderAprtAptList('');

  if ($search) {
    $search.addEventListener('input', () => _renderAprtAptList($search.value));
    $search.addEventListener('click', e => e.stopPropagation());
  }

  // Edit section toggle
  const $editToggle = document.getElementById('aprt-edit-toggle');
  const $editBody   = document.getElementById('aprt-edit-body');
  if ($editToggle && $editBody) {
    $editToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = $editBody.classList.toggle('open');
      $editToggle.classList.toggle('open', open);
    });
  }

  // Manual wx inputs — save locally + refresh ref card on every keystroke
  // for instant feedback; push to crc-sync (src/apt-config.js, squadron-wide)
  // only on 'change' (blur/enter/select-commit), not per keystroke, so
  // typing "3000" into a cloud base doesn't fire 4 WS messages + 4
  // synchronous config-file writes on the server.
  ['aprt-wx-vis',
   'aprt-cld-1-cov', 'aprt-cld-1-base',
   'aprt-cld-2-cov', 'aprt-cld-2-base',
   'aprt-cld-3-cov', 'aprt-cld-3-base',
  ].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => { _saveAprtManualWx(); _updateAprtRefCard(); });
    el.addEventListener('change', _syncAprtManualWx);
  });

  // ATIS inputs that affect the ref card; freq/rwy/info also persisted per
  // airport and synced squadron-wide (same local-instant / synced-on-change
  // split as the manual wx inputs above).
  const $freqEl = document.getElementById('aprt-atis-freq');
  if ($freqEl) {
    $freqEl.addEventListener('input', () => {
      _updateAprtRefCard();
      if (_aprtSelectedApt) {
        const k = _aprtSelectedApt.icao || _aprtSelectedApt.name;
        if (!settings.aprtAtisFreq) settings.aprtAtisFreq = {};
        settings.aprtAtisFreq[k] = $freqEl.value;
        saveSettings();
      }
    });
    $freqEl.addEventListener('change', () => {
      if (!_aprtSelectedApt) return;
      const k = _aprtSelectedApt.icao || _aprtSelectedApt.name;
      sendToSync({ type: 'aptConfigSet', key: k, freq: $freqEl.value });
    });
  }
  const $infoField = document.getElementById('aprt-atis-info');
  if ($infoField) {
    $infoField.addEventListener('input', _updateAprtRefCard);
    $infoField.addEventListener('change', () => {
      if (!_aprtSelectedApt) return;
      const k = _aprtSelectedApt.icao || _aprtSelectedApt.name;
      if (!settings.aprtAtisInfo) settings.aprtAtisInfo = {};
      settings.aprtAtisInfo[k] = $infoField.value;
      saveSettings();
      sendToSync({ type: 'aptConfigSet', key: k, info: $infoField.value });
    });
  }
  const $rwyField = document.getElementById('aprt-atis-rwy');
  if ($rwyField) {
    $rwyField.addEventListener('input', () => { _updateAprtRwyHeading(); _updateAprtRefCard(); });
    $rwyField.addEventListener('change', () => {
      if (!_aprtSelectedApt) return;
      const k = _aprtSelectedApt.icao || _aprtSelectedApt.name;
      if (!settings.aprtAtisRwy) settings.aprtAtisRwy = {};
      settings.aprtAtisRwy[k] = $rwyField.value;
      saveSettings();
      sendToSync({ type: 'aptConfigSet', key: k, rwy: $rwyField.value });
    });
  }

  // Theater settings — squadron-wide via crc-sync (src/theater-settings.js),
  // same pattern as the SQWK C/S mapping in the Calls panel: update the
  // local cache optimistically so this client feels instant, then push the
  // change so every other connected controller's panel picks it up too
  // (refreshAprtTheaterInputs(), called from app.js's 'theater-settings'
  // case, re-syncs these inputs' displayed values on the resulting
  // broadcast — including back to the client that made the edit, keeping
  // everyone converged on whatever crc-sync ends up persisting).
  const $transAlt   = document.getElementById('aprt-transition-alt');
  const $hdgCorrection = document.getElementById('aprt-hdg-correction');
  const $timeOffset = document.getElementById('aprt-time-offset');

  if ($transAlt) {
    $transAlt.value = settings.transitionAltFt ?? 18000;
    $transAlt.addEventListener('change', () => {
      settings.transitionAltFt = parseInt($transAlt.value) || 18000;
      saveSettings(); updateMap(); _updateAprtRefCard();
      sendToSync({ type: 'theaterSettingsSet', transitionAltFt: settings.transitionAltFt });
    });
  }
  if ($hdgCorrection) {
    $hdgCorrection.value = settings.hdgCorrection ?? 0;
    // 'input' fires on every keystroke — kept local-only (map redraw needs
    // to feel instant while typing). The synced push waits for 'change'
    // (blur/enter/spinner-commit) below so crc-sync isn't getting a
    // WS message + a synchronous config-file write per keystroke.
    $hdgCorrection.addEventListener('input', () => {
      settings.hdgCorrection = parseInt($hdgCorrection.value) || 0;
      saveSettings(); updateMap();
    });
    $hdgCorrection.addEventListener('change', () => {
      sendToSync({ type: 'theaterSettingsSet', hdgCorrection: settings.hdgCorrection });
    });
  }
  if ($timeOffset) {
    $timeOffset.value = settings.gameTimeOffset ?? 0;
    $timeOffset.addEventListener('change', () => {
      settings.gameTimeOffset = parseInt($timeOffset.value) || 0;
      saveSettings();
      sendToSync({ type: 'theaterSettingsSet', gameTimeOffset: settings.gameTimeOffset });
    });
  }

  // ATIS BUILD button
  const $build = document.getElementById('aprt-atis-build');
  if ($build) {
    $build.addEventListener('click', (e) => {
      e.stopPropagation();
      _buildAtisText();
    });
  }

  // ATIS transmit — press to start looping, press again to stop
  let _atisLooping    = false;
  let _atisPauseTimer = null;

  const $tx     = document.getElementById('aprt-atis-tx');
  const $status = document.getElementById('aprt-atis-status');
  // Cached node references, not re-queried per tick — same reasoning as
  // $tx/$status above. dockview detaches the airport panel's DOM subtree
  // from `document` when the panel is closed (checkbox, pin, its own tab's
  // "x"), so a live `document.getElementById('aprt-atis-freq')` inside the
  // 5s _doAtisTransmit loop below started returning null the moment the
  // panel closed — `.value` on that null then threw, silently killing the
  // loop (uncaught inside a setTimeout callback) and the ATIS with it. The
  // cached element reference stays valid — and still reflects its current
  // .value — even while detached, so the loop (and a real ATIS on a real
  // frequency shouldn't care whether anyone has the panel open) keeps
  // running regardless of the panel's open/closed state.
  const $freq   = document.getElementById('aprt-atis-freq');
  const $text   = document.getElementById('aprt-atis-text');

  // Live cross-client indicator: `atisActive` (app.js) is the "who's
  // transmitting on which frequency" list crc-sync broadcasts on every
  // /api/atis-transmit start/stop and on a periodic tick (see AtisStore's
  // presence tracking) — this is what turns "another controller is running
  // ATIS on this frequency" from something you only discover by pressing
  // TRANSMIT yourself and getting a 409 into something visible passively.
  // Deliberately doesn't touch $tx.disabled — the 409 path remains the
  // actual enforcement; this is a status hint, not a lock.
  function _refreshAtisLiveStatus() {
    if (_atisLooping || !$status) return; // our own loop's status already reflects reality
    const freqMhz = parseFloat(($freq || {}).value);
    const freqHz  = freqMhz ? Math.round(freqMhz * 1e6) : null;
    const inUseElsewhere = freqHz != null &&
      atisActive.some(a => a.frequency === freqHz && a.ownerId !== _atisOwnerId);
    if (inUseElsewhere) {
      $status.textContent = 'IN USE (another client)';
      $status.className   = 'aprt-atis-status err';
    } else if ($status.textContent === 'IN USE (another client)') {
      $status.textContent = 'STOPPED';
      $status.className   = 'aprt-atis-status';
    }
  }
  _atisLiveRefresh = _refreshAtisLiveStatus;
  _refreshAtisLiveStatus();

  function _stopAtisLoop() {
    _atisLooping = false;
    clearTimeout(_atisPauseTimer);
    if ($tx) { $tx.textContent = 'TRANSMIT'; $tx.classList.remove('aprt-btn-active'); $tx.disabled = false; }
    if ($status) { $status.textContent = 'STOPPED'; $status.className = 'aprt-atis-status'; }

    // Best-effort: tell crc-sync to cancel/release this frequency so a
    // still-in-flight transmit doesn't keep playing and the frequency frees
    // up for another client immediately, instead of waiting out the TTL.
    const freqMhz = parseFloat(($freq || {}).value);
    if (freqMhz) {
      fetch('/api/atis-transmit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ..._syncAuthHeaders() },
        body: JSON.stringify({ stop: true, frequency: Math.round(freqMhz * 1e6), ownerId: _atisOwnerId }),
      }).catch(() => {});
    }
  }

  function _doAtisTransmit() {
    if (!_atisLooping) return;

    const freqMhz = parseFloat(($freq || {}).value);
    const text    = (($text || {}).value || '').trim();
    if (!freqMhz || !text) { _stopAtisLoop(); return; }

    const pos  = _aprtSelectedApt
      ? { lat: _aprtSelectedApt.lat, lon: _aprtSelectedApt.lon, alt: _aprtSelectedApt.elev || 0 }
      : { lat: 0, lon: 0, alt: 0 };
    const coal = getUserCoalition();

    if ($status) { $status.textContent = 'TRANSMITTING…'; $status.className = 'aprt-atis-status'; }

    fetch('/api/atis-transmit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._syncAuthHeaders() },
      body: JSON.stringify({
        ssml: text, frequency: Math.round(freqMhz * 1e6), coalition: coal, position: pos,
        ownerId: _atisOwnerId,
      }),
    })
      .then(r => r.json().then(d => ({ status: r.status, d })))
      .then(({ status, d }) => {
        if (!_atisLooping) return;
        if (status === 409) {
          _atisLooping = false;
          clearTimeout(_atisPauseTimer);
          if ($tx) { $tx.textContent = 'TRANSMIT'; $tx.classList.remove('aprt-btn-active'); $tx.disabled = false; }
          if ($status) { $status.textContent = 'IN USE (another client)'; $status.className = 'aprt-atis-status err'; }
          return;
        }
        if (!d.ok) { _stopAtisLoop(); if ($status) { $status.textContent = d.error || 'Error'; $status.className = 'aprt-atis-status err'; } return; }
        if ($status) { $status.textContent = 'WAITING…'; $status.className = 'aprt-atis-status'; }
        _atisPauseTimer = setTimeout(_doAtisTransmit, 5000);
      })
      .catch(() => {
        if (_atisLooping) { _stopAtisLoop(); if ($status) { $status.textContent = 'UNAVAILABLE'; $status.className = 'aprt-atis-status err'; } }
      });
  }

  if ($tx) {
    $tx.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_atisLooping) { _stopAtisLoop(); return; }

      const freqMhz = parseFloat(($freq || {}).value);
      const text    = (($text || {}).value || '').trim();
      if (!freqMhz || !text) {
        if ($status) { $status.textContent = 'Freq and text required.'; $status.className = 'aprt-atis-status err'; }
        return;
      }

      _atisLooping = true;
      $tx.textContent = 'STOP';
      $tx.classList.add('aprt-btn-active');
      _doAtisTransmit();
    });
  }
}

function _renderAprtAptList(filter) {
  const $list = document.getElementById('aprt-apt-list');
  if (!$list) return;

  const term     = (filter || '').trim().toLowerCase();
  const airports = (missionData && missionData.airports) || [];
  const filtered = airports
    .filter(a => a.lat && a.lon && a.name !== 'H' && !/helipad|farp|fob/i.test(a.name))
    .sort((a, b) => (a.icao || a.name).localeCompare(b.icao || b.name))
    .filter(a => !term ||
      (a.icao || '').toLowerCase().includes(term) ||
      (a.name || '').toLowerCase().includes(term));

  $list.innerHTML = '';

  if (filtered.length === 0) {
    $list.innerHTML = '<div style="font-size:10px;color:var(--ui-text-dim);font-style:italic;padding:4px 14px">' +
      (term ? 'No match.' : 'No airports.') + '</div>';
    return;
  }

  for (const a of filtered) {
    const row      = document.createElement('div');
    const isActive = _aprtSelectedApt && _aprtSelectedApt.name === a.name;
    row.className  = 'aprt-apt-row' + (isActive ? ' active' : '');
    row.innerHTML  =
      `<span>${a.icao || a.name}</span>` +
      `<span class="aprt-apt-sub">${a.icao ? a.name : ''}</span>`;
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      _aprtSelectedApt = a;
      _renderAprtAptList(document.getElementById('aprt-search').value || '');
      // Restore this airport's squadron-wide saved ATIS setup (freq/rwy/info
      // — see crc-sync's apt-config.js; settings.aprtAtis* here is just this
      // client's cache of the server-authoritative value).
      const key = a.icao || a.name;
      const $f = document.getElementById('aprt-atis-freq');
      if ($f) $f.value = (settings.aprtAtisFreq || {})[key] || '';
      const $rwy = document.getElementById('aprt-atis-rwy');
      if ($rwy) $rwy.value = (settings.aprtAtisRwy || {})[key] || '';
      const $info = document.getElementById('aprt-atis-info');
      if ($info) $info.value = (settings.aprtAtisInfo || {})[key] || '';
      _updateAprtRwyHeading();
      _fetchAndShowAprtWeather(a);
    });
    $list.appendChild(row);
  }
}

let _aprtLastFetchedWx = null; // cache of last successful weather fetch

function _fetchAndShowAprtWeather(apt) {
  _aprtLastFetchedWx = null;
  _loadAprtManualWx(apt);
  _updateAprtRefCard();

  fetch(`/api/apt-weather?lat=${apt.lat}&lon=${apt.lon}&alt=${apt.elev || 0}`, { headers: _syncAuthHeaders() })
    .then(r => r.json())
    .then(d => {
      if (!d.error) {
        _aprtLastFetchedWx = d;
        _updateAprtRefCard();
      }
    })
    .catch(() => {});
}

function _buildAtisText() {
  // ── TTS helpers ─────────────────────────────────────────────────────────
  const NATO = {
    A:'Alpha', B:'Bravo',   C:'Charlie', D:'Delta',   E:'Echo',    F:'Foxtrot',
    G:'Golf',  H:'Hotel',   I:'India',   J:'Juliet',  K:'Kilo',    L:'Lima',
    M:'Mike',  N:'November',O:'Oscar',   P:'Papa',    Q:'Quebec',  R:'Romeo',
    S:'Sierra',T:'Tango',   U:'Uniform', V:'Victor',  W:'Whiskey', X:'X-ray',
    Y:'Yankee',Z:'Zulu',
  };
  const CLOUD_WORDS = { SKC:'sky clear', FEW:'few', SCT:'scattered', BKN:'broken', OVC:'overcast' };
  const RWY_SUFFIX  = { L:'Left', R:'Right', C:'Center' };

  // Space every digit individually; replace decimal point with "decimal"
  const spellDigits = s =>
    String(s).replace(/\./g, '§').split('')
      .map(c => c === '§' ? 'decimal' : c)
      .join(' ').replace(/\s+/g, ' ').trim();

  // Handle negative numbers: "-5" → "minus 5"
  const spellNum = s => {
    const str = String(s);
    return str.startsWith('-') ? 'minus ' + spellDigits(str.slice(1)) : spellDigits(str);
  };

  // Runway: "28R" → "2 8 Right", "05" → "0 5"
  const spellRwy = s => {
    const m = String(s).toUpperCase().match(/^(\d{1,2})([LRC]?)$/);
    if (!m) return s;
    return spellDigits(m[1].padStart(2,'0')) + (RWY_SUFFIX[m[2]] ? ' ' + RWY_SUFFIX[m[2]] : '');
  };

  // ── Data ─────────────────────────────────────────────────────────────────
  const apt      = _aprtSelectedApt;
  const wx       = _aprtLastFetchedWx;
  const key      = apt ? (apt.icao || apt.name) : null;
  const manualWx = (key && settings.aprtManualWx && settings.aprtManualWx[key]) || {};

  const infoLetter = ((document.getElementById('aprt-atis-info')    || {}).value || 'A').toUpperCase().charAt(0);
  const rwyRaw     = ((document.getElementById('aprt-atis-rwy')     || {}).value || '').toUpperCase().trim();
  const comment    = ((document.getElementById('aprt-atis-comment') || {}).value || '').trim();
  const taFt       = settings.transitionAltFt ?? 18000;

  const aptName  = apt ? (apt.name || apt.icao) : 'THIS STATION';
  const windDir  = wx ? String(wx.windFrom).padStart(3, '0') : '000';
  const windKt   = wx ? wx.windKt   : 0;
  const tempC    = wx ? wx.tempC    : 0;
  const qnhHpa   = wx ? wx.pressureHpa : 1013;
  const qnhInhg  = (qnhHpa / 33.8639).toFixed(2);
  const visRaw   = manualWx.vis !== '' && manualWx.vis != null ? String(manualWx.vis) : '10';
  const vis      = spellDigits(visRaw) + ' kilometers';
  const taK      = Math.round(taFt / 1000);

  // ── TTS-ready values ──────────────────────────────────────────────────────
  const infoPhon    = NATO[infoLetter] || infoLetter;
  const rwySpelled  = rwyRaw  ? spellRwy(rwyRaw)            : '—';
  const taSpelled   = spellDigits(taK)  + ' thousand';
  const windDirSp   = spellDigits(windDir);
  const windKtSp    = spellNum(windKt);
  const tempSp      = spellNum(tempC);
  const qnhHpaSp    = spellDigits(qnhHpa);
  const qnhInhgSp   = spellDigits(qnhInhg);

  // Cloud layers
  const cloudLayers = (manualWx.clouds || []).filter(c => c.cover && c.base);
  const hasClouds   = cloudLayers.some(c => c.cover !== 'SKC');

  const cloudLines = hasClouds
    ? cloudLayers
        .filter(c => c.cover && c.cover !== 'SKC' && c.base)
        .map(c => {
          const word    = CLOUD_WORDS[c.cover] || c.cover.toLowerCase();
          const baseStr = Math.round(Number(c.base) / 100).toString().padStart(3, '0');
          return `Cloud base ${word} at ${spellDigits(baseStr)}.`;
        })
    : ['Sky clear.'];

  const lines = [
    `This is ${aptName} ATIS information ${infoPhon}.`,
    `Expect runway ${rwySpelled}.`,
    `Transition altitude ${taSpelled}.`,
    `Wind ${windDirSp} degrees, ${windKtSp} knots.`,
    `Visibility ${vis}.`,
    ...cloudLines,
    `Temperature ${tempSp} degrees.`,
    `Q N H ${qnhHpaSp} hectopascal or ${qnhInhgSp} inches.`,
    ...(comment ? [comment] : []),
    `Advise on initial contact you have information ${infoPhon}.`,
  ];

  const $text = document.getElementById('aprt-atis-text');
  if ($text) $text.value = lines.join('\n');
}

function _manualWxFromDom() {
  return {
    vis: (document.getElementById('aprt-wx-vis') || {}).value || '',
    clouds: [1, 2, 3].map(i => ({
      cover: (document.getElementById(`aprt-cld-${i}-cov`) || {}).value || '',
      base:  (document.getElementById(`aprt-cld-${i}-base`) || {}).value || '',
    })),
  };
}

function _saveAprtManualWx() {
  if (!_aprtSelectedApt) return;
  const key = _aprtSelectedApt.icao || _aprtSelectedApt.name;
  if (!settings.aprtManualWx) settings.aprtManualWx = {};
  settings.aprtManualWx[key] = _manualWxFromDom();
  saveSettings();
}

// Pushes the currently-selected airport's manual wx to crc-sync (squadron-
// wide, src/apt-config.js) — called on 'change' (see initAprtPanel), not
// per-keystroke like _saveAprtManualWx above.
function _syncAprtManualWx() {
  if (!_aprtSelectedApt) return;
  const key = _aprtSelectedApt.icao || _aprtSelectedApt.name;
  sendToSync({ type: 'aptConfigSet', key, manualWx: _manualWxFromDom() });
}

function _loadAprtManualWx(apt) {
  const key = apt.icao || apt.name;
  const wx  = (settings.aprtManualWx || {})[key] || {};
  const $vis = document.getElementById('aprt-wx-vis');
  if ($vis) $vis.value = wx.vis || '';
  (wx.clouds || []).forEach((c, i) => {
    const $cov  = document.getElementById(`aprt-cld-${i + 1}-cov`);
    const $base = document.getElementById(`aprt-cld-${i + 1}-base`);
    if ($cov)  $cov.value  = c.cover || '';
    if ($base) $base.value = c.base  || '';
  });
  // Clear layers not in saved data
  for (let i = (wx.clouds || []).length + 1; i <= 3; i++) {
    const $cov  = document.getElementById(`aprt-cld-${i}-cov`);
    const $base = document.getElementById(`aprt-cld-${i}-base`);
    if ($cov)  $cov.value  = '';
    if ($base) $base.value = '';
  }
}

// Re-syncs the freq/runway/info/manual-wx inputs for whichever airport is
// currently selected — called from app.js when an 'apt-config' broadcast
// arrives from crc-sync (any client, including this one, having edited it),
// so a second controller looking at the same airport sees the update live
// instead of only the next time they reselect it. Skips whichever field (if
// any) the user currently has focused, so a live edit from someone else
// can't overwrite this controller's own in-progress keystrokes.
function refreshAprtSelectedApt() {
  if (!_aprtSelectedApt) return;
  const key    = _aprtSelectedApt.icao || _aprtSelectedApt.name;
  const active = document.activeElement;

  const $f    = document.getElementById('aprt-atis-freq');
  const $rwy  = document.getElementById('aprt-atis-rwy');
  const $info = document.getElementById('aprt-atis-info');
  if ($f    && active !== $f)    $f.value    = (settings.aprtAtisFreq || {})[key] || '';
  if ($rwy  && active !== $rwy)  $rwy.value  = (settings.aprtAtisRwy  || {})[key] || '';
  if ($info && active !== $info) $info.value = (settings.aprtAtisInfo || {})[key] || '';

  const wx = (settings.aprtManualWx || {})[key] || {};
  const $vis = document.getElementById('aprt-wx-vis');
  if ($vis && active !== $vis) $vis.value = wx.vis || '';
  for (let i = 1; i <= 3; i++) {
    const c     = (wx.clouds || [])[i - 1] || {};
    const $cov  = document.getElementById(`aprt-cld-${i}-cov`);
    const $base = document.getElementById(`aprt-cld-${i}-base`);
    if ($cov  && active !== $cov)  $cov.value  = c.cover || '';
    if ($base && active !== $base) $base.value = c.base  || '';
  }

  _updateAprtRwyHeading();
  _updateAprtRefCard();
}

// Called when airport list changes (new mission) while panel is open
function refreshAprtAptList() {
  const $panel = document.getElementById('aprt-panel');
  if (!$panel || !$panel.classList.contains('open')) return;
  _renderAprtAptList(document.getElementById('aprt-search').value || '');
}
