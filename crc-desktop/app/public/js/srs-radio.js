'use strict';

// ── SRS Radio panel ──────────────────────────────────────────────────────────
// Communicates with lxsrs_v2 via the /srs-api/ proxy on the CRC server.

(function () {

  const API          = '/srs-api/api';
  const POLL_STATE   = 200;   // ms — radio state
  const POLL_DEVICES = 5000;  // ms — device list

  // ── Persistent preferences (localStorage) ──────────────────────────────────

  const LS_MIC     = 'srs_pref_mic';
  const LS_SINK    = 'srs_pref_sink';
  const LS_PTT_KEY = 'srs_pref_ptt_key';

  function _loadPref(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === 'null') return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  function _savePref(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  let _prefMic  = _loadPref(LS_MIC);
  let _prefSink = _loadPref(LS_SINK);
  let _pttKey   = _loadPref(LS_PTT_KEY) || 'Space';

  // ── Reactive state ─────────────────────────────────────────────────────────

  let _state = {
    connected: false,
    udp_ready: false,
    ptt: false,
    radios: [],
    radio_volumes: [],
    input_volume: 0.5,
    output_volume: 1.0,
    mic_source: null,
    speaker_sink: null,
    sound_set: 'RADIO_TRANS',
    noise_enabled: true,
    status: '',
  };

  let _devices = { inputs: [], outputs: [] };
  let _pttHeld       = false;
  let _pttTimer      = null;
  let _rebuildingSelects = false;
  const _draggingSlots = new Set();  // slots whose vol slider is being dragged

  // ── Frequency modal ────────────────────────────────────────────────────────

  function _promptFreq(slot, defaultVal) {
    return new Promise((resolve) => {
      const overlay  = document.getElementById('srs-freq-modal-overlay');
      const label    = document.getElementById('srs-freq-modal-label');
      const input    = document.getElementById('srs-freq-modal-input');
      const confirm  = document.getElementById('srs-freq-modal-confirm');
      const cancel   = document.getElementById('srs-freq-modal-cancel');

      label.textContent = `Frequency MHz — slot ${slot + 1}:`;
      input.value = defaultVal;
      overlay.classList.remove('hidden');
      input.focus();
      input.select();

      function _close(value) {
        overlay.classList.add('hidden');
        confirm.removeEventListener('click', _onConfirm);
        cancel.removeEventListener('click', _onCancel);
        overlay.removeEventListener('click', _onOverlay);
        input.removeEventListener('keydown', _onKey);
        resolve(value);
      }
      function _onConfirm() { _close(input.value); }
      function _onCancel()  { _close(null); }
      function _onOverlay(e) { if (e.target === overlay) _close(null); }
      function _onKey(e) {
        if (e.key === 'Enter')  { e.preventDefault(); _close(input.value); }
        if (e.key === 'Escape') { e.preventDefault(); _close(null); }
      }
      confirm.addEventListener('click', _onConfirm);
      cancel.addEventListener('click', _onCancel);
      overlay.addEventListener('click', _onOverlay);
      input.addEventListener('keydown', _onKey);
    });
  }

  // ── DOM refs ───────────────────────────────────────────────────────────────

  const _radioList   = document.getElementById('srs-radio-list');
  // Cached with the rest: looked up live in _renderSlots they were null once dockview had the
  // RADIO panel closed (detached), and every poll threw (S-L1b finding).
  const _addRadioBtn = document.getElementById('srs-add-radio');
  const _addIcomBtn  = document.getElementById('srs-add-intercom');
  const _pttBtn      = document.getElementById('srs-ptt-btn');
  const _dot         = document.getElementById('srs-dot');
  // Settings tab elements
  const _inVolLbl    = document.getElementById('srs-in-vol-lbl');
  const _outVolLbl   = document.getElementById('srs-out-vol-lbl');
  const _micSel      = document.getElementById('srs-mic-select');
  const _sinkSel     = document.getElementById('srs-sink-select');
  const _pttKeyInp   = document.getElementById('srs-ptt-key-input');
  const _soundSetSel = document.getElementById('srs-sound-set-select');
  const _noiseChk    = document.getElementById('srs-noise-enabled');

  // ── API helpers ────────────────────────────────────────────────────────────

  async function _get(path) {
    const r = await fetch(API + path);
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }

  async function _post(path, body) {
    try {
      await fetch(API + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body != null ? JSON.stringify(body) : '{}',
      });
    } catch { /* stale until next poll */ }
  }

  // ── State polling ──────────────────────────────────────────────────────────

  async function _pollState() {
    try {
      const data = await _get('/state');
      _state = { connected: true, ...data };
    } catch {
      _state.connected = false;
    }
    _render();
  }

  // ── Device polling + replugging ────────────────────────────────────────────

  async function _pollDevices() {
    try {
      _devices = await _get('/devices');
    } catch {
      return;
    }
    _renderDeviceSelects();
    _maybeRestorePrefs();
  }

  function _maybeRestorePrefs() {
    if (_prefMic !== null && _state.mic_source === null) {
      const found = _devices.inputs.some(d => d.name === _prefMic);
      if (found) _post('/device/input', { source: _prefMic });
    }
    if (_prefSink !== null && _state.speaker_sink === null) {
      const found = _devices.outputs.some(d => d.name === _prefSink);
      if (found) _post('/device/output', { sink: _prefSink });
    }
  }

  // ── Radio slot rendering (diffed so live sliders survive poll redraws) ──────

  function _slotKey(r) { return `${r.slot}|${r.freq_mhz.toFixed(3)}|${r.modulation}|${r.tx}|${r.rx}`; }

  function _buildSlotEl(r, vol) {
    const isIntercom = r.modulation === 'INTERCOM';
    const wrap = document.createElement('div');
    wrap.className = 'srs-slot-wrap';
    wrap.dataset.slot = r.slot;
    const top = document.createElement('div');
    top.className = 'srs-slot' + (r.tx ? ' srs-slot-tx' : '') + (r.rx ? ' srs-slot-rx' : '');
    const modBadge = isIntercom
      ? `<span class="srs-slot-mod srs-slot-mod-fixed" title="Intercom">IC</span>`
      : `<span class="srs-slot-mod" data-slot="${r.slot}" title="Click to cycle modulation">${r.modulation.slice(0,2)}</span>`;
    top.innerHTML =
      `<span class="srs-slot-n">${r.slot + 1}</span>` +
      (isIntercom ? `` : `<span class="srs-slot-freq" data-slot="${r.slot}" title="Click to set frequency">${r.freq_mhz.toFixed(3)}</span>`) +
      modBadge +
      (r.tx ? `<span class="srs-slot-txbadge">TX</span>` : '');
    const rm = document.createElement('span');
    rm.className = 'srs-slot-rm';
    rm.dataset.slot = r.slot;
    rm.title = 'Remove radio';
    rm.textContent = '✕';
    wrap.appendChild(top);
    wrap.appendChild(rm);
    const volRow = document.createElement('div');
    volRow.className = 'srs-slot-volrow';
    volRow.innerHTML =
      `<input class="srs-slot-vol" type="range" min="0" max="5" step="0.1" value="${vol}" data-slot="${r.slot}" title="Per-radio output volume">` +
      `<span class="srs-slot-vol-lbl" data-slot="${r.slot}">${vol.toFixed(1)}x</span>`;
    wrap.appendChild(volRow);
    return wrap;
  }

  const MAX_RADIOS = 11;

  function _renderSlots() {
    const active = (_state.radios || []).filter(r => r.modulation !== 'DISABLED');
    const vols   = _state.radio_volumes || [];
    const addBtn = _addRadioBtn;
    if (!_radioList || !addBtn) return; // panel not in the DOM right now
    addBtn.style.display = active.length >= MAX_RADIOS ? 'none' : '';
    const addIcBtn = _addIcomBtn;
    if (addIcBtn) {
      const hasIntercom = active.some(r => r.modulation === 'INTERCOM');
      addIcBtn.classList.toggle('srs-intercom-active', hasIntercom);
      addIcBtn.disabled = hasIntercom || active.length >= MAX_RADIOS;
      addIcBtn.style.display = active.length >= MAX_RADIOS && !hasIntercom ? 'none' : '';
    }

    // Map current rendered wraps by slot
    const existing = new Map();
    for (const el of _radioList.querySelectorAll('.srs-slot-wrap')) {
      existing.set(parseInt(el.dataset.slot, 10), el);
    }

    // Remove the "no radios" placeholder if it exists
    const noRadios = _radioList.querySelector('.srs-no-radios');

    if (active.length === 0) {
      // Clear everything except the + button
      for (const el of [..._radioList.children]) {
        if (el !== addBtn) el.remove();
      }
      const empty = document.createElement('span');
      empty.className = 'srs-no-radios';
      empty.textContent = '—';
      _radioList.insertBefore(empty, addBtn);
      return;
    }

    if (noRadios) noRadios.remove();

    const activeSlots = new Set(active.map(r => r.slot));

    // Remove slots no longer active
    for (const [slot, el] of existing) {
      if (!activeSlots.has(slot)) el.remove();
    }

    // Add or update slots
    for (const r of active) {
      const vol = vols[r.slot] != null ? vols[r.slot] : 1.0;
      const cur = existing.get(r.slot);

      if (!cur) {
        // New slot — insert in slot-number order, always before the + button
        const newEl = _buildSlotEl(r, vol);
        let inserted = false;
        for (const wrap of _radioList.querySelectorAll('.srs-slot-wrap')) {
          if (parseInt(wrap.dataset.slot, 10) > r.slot) {
            _radioList.insertBefore(newEl, wrap);
            inserted = true;
            break;
          }
        }
        if (!inserted) _radioList.insertBefore(newEl, addBtn);
      } else {
        // Update existing slot
        const key = cur.dataset.key;
        const newKey = _slotKey(r);
        if (key !== newKey) {
          cur.dataset.key = newKey;
          const top = cur.querySelector('.srs-slot');
          if (top) {
            top.className = 'srs-slot' + (r.tx ? ' srs-slot-tx' : '') + (r.rx ? ' srs-slot-rx' : '');
            const _isIcom = r.modulation === 'INTERCOM';
            top.innerHTML =
              `<span class="srs-slot-n">${r.slot + 1}</span>` +
              (_isIcom ? `` : `<span class="srs-slot-freq" data-slot="${r.slot}" title="Click to set frequency">${r.freq_mhz.toFixed(3)}</span>`) +
              (_isIcom
                ? `<span class="srs-slot-mod srs-slot-mod-fixed" title="Intercom">IC</span>`
                : `<span class="srs-slot-mod" data-slot="${r.slot}" title="Click to cycle modulation">${r.modulation.slice(0,2)}</span>`) +
              (r.tx ? `<span class="srs-slot-txbadge">TX</span>` : '') +
              `<span class="srs-slot-rm" data-slot="${r.slot}" title="Remove radio">✕</span>`;
          }
        }
        // Update slider value only when not actively dragging
        if (!_draggingSlots.has(r.slot)) {
          const slider = cur.querySelector('.srs-slot-vol');
          const lbl    = cur.querySelector('.srs-slot-vol-lbl');
          if (slider && parseFloat(slider.value) !== vol) slider.value = vol;
          if (lbl)    lbl.textContent = vol.toFixed(1) + 'x';
        }
      }
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const _panelElRef = document.getElementById('srs-radio-panel');

  function _render() {
    // Hide entire panel when lxsrs is not connected
    if (_panelElRef) _panelElRef.style.display = _state.connected ? '' : 'none';

    // Connection dot — green = fully ready, yellow = partial/connecting, dim = off
    _dot.className = 'dot ' + (_state.connected && _state.udp_ready ? 'connected'
                              : _state.connected                     ? 'reconnecting'
                              :                                        'disconnected');

    // PTT — reflect server state for non-browser sources (pynput, stdin)
    if (_state.ptt && !_pttHeld) _pttBtn.classList.add('ptt-active');
    else if (!_state.ptt && !_pttHeld) _pttBtn.classList.remove('ptt-active');

    // Radio slots — diffed to avoid destroying slider state mid-drag
    _renderSlots();


    // Settings tab values (only update if not focused to avoid fighting user)
    if (_inVolLbl)  _inVolLbl.textContent  = _state.input_volume.toFixed(1)  + 'x';
    if (_outVolLbl) _outVolLbl.textContent = _state.output_volume.toFixed(1) + 'x';

    _syncSelectValue(_micSel,  _state.mic_source   ?? 'default');
    _syncSelectValue(_sinkSel, _state.speaker_sink ?? 'default');

    if (_soundSetSel && document.activeElement !== _soundSetSel) {
      _syncSelectValue(_soundSetSel, _state.sound_set || 'RADIO_TRANS');
    }
    if (_noiseChk && !_noiseChk._userChanging) {
      _noiseChk.checked = _state.noise_enabled !== false;
    }
    if (_icUnitSel && document.activeElement !== _icUnitSel) {
      _syncSelectValue(_icUnitSel, String(_state.unit_id || 1));
    }
  }

  function _syncSelectValue(sel, value) {
    if (!sel) return;
    if (sel.value !== value) sel.value = value;
  }

  function _renderDeviceSelects() {
    if (!_micSel || !_sinkSel) return;

    _rebuildingSelects = true;

    const curMic = _state.mic_source ?? 'default';
    _micSel.innerHTML = '<option value="default">default</option>';
    for (const d of _devices.inputs) {
      const opt = document.createElement('option');
      opt.value = d.name;
      opt.textContent = d.description || d.name;
      opt.title = d.name;
      _micSel.appendChild(opt);
    }
    if (_prefMic !== null && !_devices.inputs.some(d => d.name === _prefMic)) {
      const opt = document.createElement('option');
      opt.value = _prefMic;
      opt.textContent = `[saved: ${_prefMic}] (unplugged)`;
      opt.disabled = true;
      _micSel.insertBefore(opt, _micSel.children[1]);
    }
    _micSel.value = curMic;

    const curSink = _state.speaker_sink ?? 'default';
    _sinkSel.innerHTML = '<option value="default">default</option>';
    for (const s of _devices.outputs) {
      const opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = s.description || s.name;
      opt.title = s.name;
      _sinkSel.appendChild(opt);
    }
    if (_prefSink !== null && !_devices.outputs.some(d => d.name === _prefSink)) {
      const opt = document.createElement('option');
      opt.value = _prefSink;
      opt.textContent = `[saved: ${_prefSink}] (unplugged)`;
      opt.disabled = true;
      _sinkSel.insertBefore(opt, _sinkSel.children[1]);
    }
    _sinkSel.value = curSink;

    // Firefox fires 'change' asynchronously on innerHTML clear — guard past this tick
    setTimeout(() => { _rebuildingSelects = false; }, 0);
  }

  // ── PTT ────────────────────────────────────────────────────────────────────

  function _pttDown(e) {
    if (e) e.preventDefault();
    if (_pttHeld) return;
    _pttHeld = true;
    _post('/ptt/start');
    _pttTimer = setInterval(() => _post('/ptt/start'), 400);
    _pttBtn.classList.add('ptt-active');
  }

  function _pttUp(e) {
    if (e) e.preventDefault();
    if (!_pttHeld) return;
    _pttHeld = false;
    clearInterval(_pttTimer);
    _post('/ptt/stop');
    _pttBtn.classList.remove('ptt-active');
  }

  // ── PTT button wiring ──────────────────────────────────────────────────────

  _pttBtn.addEventListener('mousedown',   _pttDown);
  _pttBtn.addEventListener('mouseup',     _pttUp);
  _pttBtn.addEventListener('mouseleave',  _pttUp);
  _pttBtn.addEventListener('touchstart',  _pttDown, { passive: false });
  _pttBtn.addEventListener('touchend',    _pttUp,   { passive: false });
  _pttBtn.addEventListener('touchcancel', _pttUp,   { passive: false });

  function _isTyping() {
    const tag = (document.activeElement?.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  document.addEventListener('keydown', (e) => {
    if (e.code !== _pttKey || e.repeat || _isTyping()) return;
    e.preventDefault();
    _pttDown(null);
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === _pttKey && !_isTyping()) _pttUp(null);
  });

  // Radio slot clicks — delegated
  _radioList.addEventListener('click', async (e) => {
    const freqEl = e.target.closest('.srs-slot-freq');
    const modEl  = e.target.closest('.srs-slot-mod');
    const rmEl   = e.target.closest('.srs-slot-rm');
    const wrap   = e.target.closest('.srs-slot-wrap');

    if (freqEl) {
      const slot = parseInt(freqEl.dataset.slot, 10);
      const radio = (_state.radios || []).find(r => r.slot === slot);
      const cur   = radio?.freq_mhz?.toFixed(3) ?? '251.000';
      const raw   = await _promptFreq(slot, cur);
      if (raw == null) return;
      const f = parseFloat(raw);
      if (!isNaN(f) && f > 0) _post(`/radio/${slot}/freq`, { freq_mhz: f });
    } else if (modEl) {
      _post(`/radio/${parseInt(modEl.dataset.slot, 10)}/mod`);
    } else if (rmEl) {
      _post(`/radio/${parseInt(rmEl.dataset.slot, 10)}/disable`);
    } else if (wrap && !e.target.closest('.srs-slot-vol')) {
      // Clicking anywhere else on the card sets it as the TX radio
      _post(`/radio/${parseInt(wrap.dataset.slot, 10)}/tx`);
    }
  });

  // Per-radio volume slider — guard against render clobbering during drag
  _radioList.addEventListener('mousedown', (e) => {
    const slider = e.target.closest('.srs-slot-vol');
    if (slider) _draggingSlots.add(parseInt(slider.dataset.slot, 10));
  });
  _radioList.addEventListener('touchstart', (e) => {
    const slider = e.target.closest('.srs-slot-vol');
    if (slider) _draggingSlots.add(parseInt(slider.dataset.slot, 10));
  }, { passive: true });

  _radioList.addEventListener('input', (e) => {
    const slider = e.target.closest('.srs-slot-vol');
    if (!slider) return;
    const slot = parseInt(slider.dataset.slot, 10);
    const vol  = parseFloat(slider.value);
    _draggingSlots.add(slot);
    const lbl = _radioList.querySelector(`.srs-slot-vol-lbl[data-slot="${slot}"]`);
    if (lbl) lbl.textContent = vol.toFixed(1) + 'x';
  });

  // Commit on mouseup/touchend anywhere (slider may lose focus before 'change')
  window.addEventListener('mouseup', () => {
    if (_draggingSlots.size === 0) return;
    for (const slot of _draggingSlots) {
      const slider = _radioList.querySelector(`.srs-slot-vol[data-slot="${slot}"]`);
      if (!slider) continue;
      const vol = parseFloat(slider.value);
      if (_state.radio_volumes) _state.radio_volumes[slot] = vol;
      _post(`/radio/${slot}/volume`, { volume: vol });
    }
    _draggingSlots.clear();
  });
  window.addEventListener('touchend', () => {
    if (_draggingSlots.size === 0) return;
    for (const slot of _draggingSlots) {
      const slider = _radioList.querySelector(`.srs-slot-vol[data-slot="${slot}"]`);
      if (!slider) continue;
      const vol = parseFloat(slider.value);
      if (_state.radio_volumes) _state.radio_volumes[slot] = vol;
      _post(`/radio/${slot}/volume`, { volume: vol });
    }
    _draggingSlots.clear();
  }, { passive: true });

  // ── Settings tab — device selects ──────────────────────────────────────────

  if (_micSel) {
    _micSel.addEventListener('change', () => {
      if (_rebuildingSelects) return;
      const val = _micSel.value === 'default' ? null : _micSel.value;
      _prefMic = val;
      _savePref(LS_MIC, val);
      _state.mic_source = val;
      _post('/device/input', { source: val });
    });
  }

  if (_sinkSel) {
    _sinkSel.addEventListener('change', () => {
      if (_rebuildingSelects) return;
      const val = _sinkSel.value === 'default' ? null : _sinkSel.value;
      _prefSink = val;
      _savePref(LS_SINK, val);
      _state.speaker_sink = val;
      _post('/device/output', { sink: val });
    });
  }

  // ── Settings tab — volumes ──────────────────────────────────────────────────

  function _wire(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  }

  _wire('srs-invol-up',  () => _post('/volume/input',  { volume: Math.min(5.0, +(_state.input_volume  + 0.1).toFixed(1)) }));
  _wire('srs-invol-dn',  () => _post('/volume/input',  { volume: Math.max(0.0, +(_state.input_volume  - 0.1).toFixed(1)) }));
  _wire('srs-outvol-up', () => _post('/volume/output', { volume: Math.min(5.0, +(_state.output_volume + 0.1).toFixed(1)) }));
  _wire('srs-outvol-dn', () => _post('/volume/output', { volume: Math.max(0.0, +(_state.output_volume - 0.1).toFixed(1)) }));
  _wire('srs-add-radio',     () => _post('/radio/add'));
  _wire('srs-add-intercom', () => _post('/radio/add-intercom'));
  _wire('srs-mic-test',  () => _post('/device/test-input'));

  // ── Settings tab — audio effects ───────────────────────────────────────────

  if (_soundSetSel) {
    _soundSetSel.addEventListener('change', () => {
      _state.sound_set = _soundSetSel.value;
      _post('/settings/sound-set', { sound_set: _soundSetSel.value });
    });
  }

  if (_noiseChk) {
    _noiseChk.addEventListener('change', () => {
      _noiseChk._userChanging = true;
      _state.noise_enabled = _noiseChk.checked;
      _post('/settings/noise', { enabled: _noiseChk.checked });
      setTimeout(() => { _noiseChk._userChanging = false; }, 300);
    });
  }

  // ── PTT keybind input ──────────────────────────────────────────────────────

  function _pttKeyLabel(code) {
    if (code === 'Space') return 'Space';
    return code.replace(/^Key/, '');
  }

  if (_pttKeyInp) {
    _pttKeyInp.value = _pttKeyLabel(_pttKey);

    _pttKeyInp.addEventListener('click', () => {
      _pttKeyInp.value = '…press key…';
      _pttKeyInp.classList.add('listening');
      _pttKeyInp.dataset.listening = '1';
    });

    _pttKeyInp.addEventListener('blur', () => {
      _pttKeyInp.classList.remove('listening');
      delete _pttKeyInp.dataset.listening;
      _pttKeyInp.value = _pttKeyLabel(_pttKey);
    });

    document.addEventListener('keydown', (e) => {
      if (!_pttKeyInp.dataset.listening) return;
      e.preventDefault();
      e.stopPropagation();
      _pttKey = e.code;
      _savePref(LS_PTT_KEY, _pttKey);
      _pttKeyInp.value = _pttKeyLabel(_pttKey);
      _pttKeyInp.classList.remove('listening');
      delete _pttKeyInp.dataset.listening;
      _pttKeyInp.blur();
    }, true); // capture phase — fires before PTT keydown handler
  }

  // ── Intercom unit select ────────────────────────────────────────────────────

  const _icUnitSel = document.getElementById('srs-intercom-unit-sel');

  function _rebuildIntercomUnitSelect(currentUnitId) {
    if (!_icUnitSel) return;
    const prev = _icUnitSel.value;
    _icUnitSel.innerHTML = '';

    // "none / shared" option — unitId 1 = all lxsrs_v2 clients share intercom
    const shared = document.createElement('option');
    shared.value = '1';
    shared.textContent = '— shared (non-DCS) —';
    _icUnitSel.appendChild(shared);

    // SRS-connected clients (EAM, other lxsrs_v2, etc.)
    const srsClients = (_state.srs_clients || []).slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (srsClients.length) {
      const grp = document.createElement('optgroup');
      grp.label = 'SRS clients';
      for (const c of srsClients) {
        const opt = document.createElement('option');
        opt.value = String(c.unit_id);
        opt.textContent = `${c.name} (ID ${c.unit_id})`;
        grp.appendChild(opt);
      }
      _icUnitSel.appendChild(grp);
    }

    // No "DCS units" group: an intercom is joined through SRS, so the SRS
    // clients above are the whole list — and the radar picture does not tell
    // this controller which contacts are friendly units (docs/adr/0059).

    // Restore selection
    const target = String(currentUnitId || prev || '1');
    _icUnitSel.value = target;
    if (!_icUnitSel.value) _icUnitSel.value = '1';
  }

  if (_icUnitSel) {
    _icUnitSel.addEventListener('change', () => {
      const uid = parseInt(_icUnitSel.value, 10);
      if (!isNaN(uid) && uid > 0) _post('/radio/intercom-unit', { unit_id: uid });
    });
  }

  // ── Settings tab wiring (refresh devices when RADIO tab opens) ─────────────

  document.querySelectorAll('.stab[data-pane="radio"]').forEach(btn => {
    btn.addEventListener('click', () => {
      _pollDevices();
      _rebuildIntercomUnitSelect(_state.unit_id);
    });
  });

  // ── Init ───────────────────────────────────────────────────────────────────

  _pollDevices().then(() => {
    if (_prefMic  !== null) _post('/device/input',  { source: _prefMic  });
    if (_prefSink !== null) _post('/device/output', { sink:   _prefSink });
  });

  setInterval(_pollState,   POLL_STATE);
  setInterval(_pollDevices, POLL_DEVICES);
  _pollState();

  // Map sizing is owned by dock.js's dockview grid now (see #dock-root in
  // index.html) — until this panel itself is migrated into that grid (a
  // later phase), it still overlaps the map's bottom edge as a fixed
  // overlay rather than reserving space for itself.

})();
