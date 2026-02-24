// ═══════════════════════════════════════════════════════════
// view-comms.js — Frequency preset table renderer
// ═══════════════════════════════════════════════════════════

'use strict';

function renderCOMMS(cm) {
  const div = document.getElementById('comms-content');
  div.innerHTML = '';

  if (!cm) {
    div.appendChild(el('div', 'empty-state', 'NO COMMS DATA'));
    return;
  }

  // Edit button (visible in edit mode)
  const editBtn = el('button', 'editor-btn', '✎ EDIT COMMS');
  editBtn.addEventListener('click', openCommsEditor);
  div.appendChild(editBtn);

  docHeader(div, [
    ['OPERATION', cm.operation],
    ['ATO DAY',   cm.ato_day],
    ['WING LEAD', cm.wing_lead],
    ['CLASS',     cm.classification],
  ]);

  // ── Per-flight comms (new format: comms.flights[]) ────────
  if (Array.isArray(cm.flights) && cm.flights.length > 0) {
    // Flight selector row
    const selectorRow = el('div', 'comms-flight-selector');
    selectorRow.appendChild(el('span', 'comms-selector-lbl', 'FLIGHT'));
    const sel = el('select', 'comms-selector-input');
    cm.flights.forEach((flt, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = (flt.callsign || flt.group || '—') +
        (flt.dtc_cartridge ? ' · DTC ' + flt.dtc_cartridge : '');
      sel.appendChild(opt);
    });
    selectorRow.appendChild(sel);
    div.appendChild(selectorRow);

    // Container re-rendered whenever the selection changes
    const gridWrap = el('div', '');
    div.appendChild(gridWrap);

    function renderFlight(idx) {
      gridWrap.innerHTML = '';
      const flt = cm.flights[idx];
      if (!flt) return;

      const hdr = el('div', 'comms-flight-header');
      hdr.appendChild(el('span', 'comms-flight-cs', flt.callsign || flt.group || '—'));
      if (flt.group && flt.group !== flt.callsign)
        hdr.appendChild(el('span', 'comms-flight-group', flt.group));
      if (flt.dtc_cartridge)
        hdr.appendChild(el('span', 'comms-flight-dtc', 'DTC: ' + flt.dtc_cartridge));
      gridWrap.appendChild(hdr);

      const grid = el('div', 'comms-grid');
      radioBlock(grid, 'RADIO 1 — UHF  (225–400 MHz)', flt.uhf_presets);
      radioBlock(grid, 'RADIO 2 — VHF  (108–174 MHz)', flt.vhf_presets);
      gridWrap.appendChild(grid);
    }

    renderFlight(0);
    sel.addEventListener('change', () => renderFlight(parseInt(sel.value, 10)));
    return;
  }

  // ── Legacy / fallback: flat uhf_presets / vhf_presets ────
  const grid = el('div', 'comms-grid');
  radioBlock(grid, 'RADIO 1 — UHF  (225–400 MHz)', cm.uhf_presets);
  radioBlock(grid, 'RADIO 2 — VHF  (108–174 MHz)', cm.vhf_presets);
  div.appendChild(grid);
}

function radioBlock(container, title, presets) {
  if (!presets) presets = {};

  const block = el('div', 'radio-block');
  block.appendChild(el('div', 'radio-title', title));

  const { table: tbl, tbody } = docTable(['CH', 'CALLSIGN', 'MHz', 'ROLE']);

  // Presets can be keyed by integer or string — normalise and sort numerically.
  // Auto-fill spare rows for channels 1–20 not defined in YAML.
  const TOTAL_CHANNELS = 20;
  for (let ch = 1; ch <= TOTAL_CHANNELS; ch++) {
    const key = Object.keys(presets).find(k => parseInt(k) === ch);
    const p   = key ? presets[key] : { callsign: 'SPARE', freq_mhz: null, role: null };
    const tr      = tbody.insertRow();
    const isEmpty = !p.freq_mhz;
    if (isEmpty) tr.className = 'freq-empty';

    tr.insertCell().appendChild(el('span', 'freq-ch',   String(ch)));
    tr.insertCell().appendChild(el('span', 'freq-cs',   p.callsign || '—'));
    tr.insertCell().appendChild(el('span', p.freq_mhz ? 'freq-mhz' : 'text-dim',
      p.freq_mhz ? String(p.freq_mhz) : '—'));
    tr.insertCell().appendChild(el('span', 'freq-role', p.role || ''));
  }

  block.appendChild(tbl);
  container.appendChild(block);
}
