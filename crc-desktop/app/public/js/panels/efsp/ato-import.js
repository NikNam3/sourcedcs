'use strict';

// Importing a USMTF ATO into TACTICAL's Board (crc-sync's docs/adr/0071, guide
// §9.8). TAC_C2 pastes or drops the text (decision H65: paste/drop only), sees
// a preview of every mission line — its warnings, its missing fields and the
// flights it could bind to — and with one confirm gets one MISSION Strip per
// line in `tac-c2-tasked`.
//
// The server re-parses everything. This file sends TEXT and CHOICES and nothing
// else: never a seed, a code or a parsed field (T4).
//
// Only one ATO is ever active (H65): importing a new one updates the lines it
// shares with the flights the last one tasked, and lists the rest as "not in
// this ATO" without touching them.
//
// Mounted under the panel root, not inside Bay content, so a board delta
// cannot destroy it mid-edit (T15).
//
// SOURCE CAVEAT (EFSPImplementationGuide.md §9.9): the parser behind the
// preview follows a DCS community wiki's layout, not MIL-STD-6040.

const ATO_IMPORT_POSITION = 'TAC_C2';
const ATO_IMPORT_MAX_BYTES = 1024 * 1024;

let _atoRootEl = null;
let _atoButtonEl = null;
let _atoDialogEl = null;
let _atoText = '';
let _atoPreview = null;
let _atoPreviewRequestId = null;
let _atoChoices = new Map();   // lineId -> { action, fdrId?, callsignOverride? }
let _atoPendingImportId = null;
let _atoResults = null;
let _atoMessage = '';

function _atoEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function _atoHeld() { return typeof getActingPositions === 'function' && getActingPositions().includes(ATO_IMPORT_POSITION); }

function _atoZ(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '—';
  const d = new Date(Number(ms));
  return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}

function _atoId() { return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `ato-${Date.now()}-${Math.random()}`; }

/** Called once from initEfspPanel: the toolbar button, shown only while TAC_C2 is held. */
function initAtoImport(rootEl) {
  _atoRootEl = rootEl || null;
  if (!_atoRootEl) return;
  const toolbar = _atoRootEl.querySelector ? _atoRootEl.querySelector('.efsp-toolbar') : null;
  _atoButtonEl = _atoEl('button', 'efsp-ato-import-btn', 'Import ATO…');
  _atoButtonEl.title = 'Paste or drop a USMTF ATO — TAC_C2';
  _atoButtonEl.addEventListener('click', () => openAtoImportDialog());
  (toolbar || _atoRootEl).appendChild(_atoButtonEl);
  refreshAtoImportButton();
}

/** "No control that always fails" (efsp-panel.js): hidden unless TAC_C2 is held. */
function refreshAtoImportButton() {
  if (_atoButtonEl) _atoButtonEl.hidden = !_atoHeld();
  if (_atoDialogEl && !_atoHeld()) closeAtoImportDialog();
}

function openAtoImportDialog() {
  if (!_atoRootEl || !_atoHeld()) return;
  if (!_atoDialogEl) {
    _atoDialogEl = _atoEl('div', 'efsp-ato-dialog');
    _atoDialogEl.addEventListener('keydown', _onAtoKeydown);
    _atoDialogEl.addEventListener('dragover', (e) => { if (e && e.preventDefault) e.preventDefault(); });
    _atoDialogEl.addEventListener('drop', _onAtoDrop);
    _atoRootEl.appendChild(_atoDialogEl);
  }
  _atoDialogEl.hidden = false;
  _renderAtoDialog();
}

function closeAtoImportDialog() {
  if (_atoDialogEl) { _atoDialogEl.hidden = true; if (_atoDialogEl.remove) _atoDialogEl.remove(); }
  _atoDialogEl = null;
  _atoText = ''; _atoPreview = null; _atoPreviewRequestId = null; _atoChoices = new Map();
  _atoPendingImportId = null; _atoResults = null; _atoMessage = '';
}

function _onAtoKeydown(e) {
  if (!e) return;
  if (e.key === 'Escape') { e.preventDefault && e.preventDefault(); closeAtoImportDialog(); return; }
  // Enter commits — except inside the paste area, where it is a newline.
  if (e.key === 'Enter' && !(e.target && e.target.tagName === 'textarea')) {
    e.preventDefault && e.preventDefault();
    if (_atoPreview) sendAtoImport(); else requestAtoPreview();
  }
}

function _readAtoFile(file) {
  if (!file) return;
  if (file.size > ATO_IMPORT_MAX_BYTES) { _atoMessage = 'That file is over 1 MiB — not an ATO.'; _renderAtoDialog(); return; }
  const reader = new FileReader();
  reader.onload = () => { setAtoImportText(String(reader.result || '')); };
  reader.readAsText(file);
}

function _onAtoDrop(e) {
  if (!e) return;
  if (e.preventDefault) e.preventDefault();
  const dt = e.dataTransfer;
  if (dt && dt.files && dt.files.length) return _readAtoFile(dt.files[0]);
  const text = dt && dt.getData ? dt.getData('text/plain') : '';
  if (text) setAtoImportText(text);
}

/** New text invalidates any preview: the server checks the text is the one previewed. */
function setAtoImportText(text) {
  _atoText = String(text || '');
  _atoPreview = null; _atoChoices = new Map(); _atoResults = null; _atoMessage = '';
  _renderAtoDialog();
}

function requestAtoPreview() {
  if (!_atoText.trim()) { _atoMessage = 'Paste or drop the ATO text first.'; _renderAtoDialog(); return; }
  _atoPreviewRequestId = _atoId();
  _atoMessage = 'Reading the ATO…';
  _sendEfsp({ version: 1, type: 'efsp-ato-preview', requestId: _atoPreviewRequestId, actingPositionId: ATO_IMPORT_POSITION, text: _atoText });
  _renderAtoDialog();
}

/** app.js: case 'efsp-ato-preview-result'. */
function onAtoPreviewResult(msg) {
  if (!msg || msg.requestId !== _atoPreviewRequestId) return; // a stale answer
  _atoPreviewRequestId = null;
  if (!msg.ok) {
    _atoMessage = '';
    if (typeof _showMutationError === 'function') _showMutationError(msg.reason || 'Rejected', msg.detail, { subject: 'ATO import' });
    _renderAtoDialog();
    return;
  }
  _atoPreview = msg.preview;
  _atoChoices = new Map();
  for (const l of _atoPreview.lines) {
    const c = { action: l.action };
    if (l.action === 'BIND' && l.bindCandidates.length === 1) c.fdrId = l.bindCandidates[0].fdrId;
    _atoChoices.set(l.lineId, c);
  }
  _atoMessage = '';
  _renderAtoDialog();
}

/** Lines that stop the import: a CREATE with no callsign that fits (T10). */
function atoImportBlockers(preview, choices) {
  if (!preview) return [];
  return preview.lines.filter((l) => {
    const c = choices.get(l.lineId) || { action: l.action };
    if (c.action !== 'CREATE') return false;
    const cs = String(c.callsignOverride || l.callsign || '').toUpperCase();
    return !/^[A-Z0-9]{1,7}$/.test(cs);
  }).map(l => l.lineId);
}

/** The choices exactly as the wire carries them. */
function atoImportChoices(preview, choices) {
  return preview.lines.map((l) => {
    const c = choices.get(l.lineId) || { action: l.action };
    const out = { lineId: l.lineId, action: c.action };
    if (c.action === 'BIND') out.fdrId = c.fdrId;
    if (c.action === 'CREATE' && c.callsignOverride) out.callsignOverride = String(c.callsignOverride).toUpperCase();
    return out;
  });
}

function sendAtoImport() {
  if (!_atoPreview || _atoPendingImportId) return null;
  const blockers = atoImportBlockers(_atoPreview, _atoChoices);
  if (blockers.length) {
    _atoMessage = `Type a callsign (1–7 letters and digits) or skip: ${blockers.join(', ')}`;
    _renderAtoDialog();
    return null;
  }
  _atoPendingImportId = _atoId();
  _sendEfsp({
    version: 1, type: 'efsp-ato-mutation', clientMutationId: _atoPendingImportId, facilityId: 'TACTICAL',
    actingPositionId: ATO_IMPORT_POSITION,
    op: { kind: 'ImportAto', text: _atoText, textSha1: _atoPreview.textSha1, choices: atoImportChoices(_atoPreview, _atoChoices) },
  });
  _atoMessage = 'Importing…';
  _renderAtoDialog();
  return _atoPendingImportId;
}

/** app.js: case 'efsp-ato-ack'. Closes on all-ok; otherwise shows each line's result. */
function onAtoAck(msg) {
  if (!msg || msg.clientMutationId !== _atoPendingImportId) return;
  _atoPendingImportId = null;
  if (!msg.ok) {
    _atoMessage = '';
    if (typeof _showMutationError === 'function') _showMutationError(msg.reason || 'Rejected', msg.detail, { subject: 'ATO import' });
    if (msg.reason === 'STALE_REV') _atoPreview = null;
    _renderAtoDialog();
    return;
  }
  _atoResults = msg.results || [];
  if (_atoResults.every(r => r.ok)) { closeAtoImportDialog(); return; }
  _atoMessage = `${_atoResults.filter(r => !r.ok).length} line(s) were not imported — see below.`;
  _atoPreview = null;
  _renderAtoDialog();
}

function _atoActionOptions(line) {
  const opts = [];
  if (line.existingFdrId) opts.push({ value: 'UPDATE', label: 'Update the tasked flight' });
  for (const b of line.bindCandidates) opts.push({ value: `BIND:${b.fdrId}`, label: `Bind to ${b.callsign} · ${b.beaconAssigned} (${b.key === 'MODE3' ? 'Mode 3' : 'callsign'})` });
  opts.push({ value: 'CREATE', label: 'New flight' });
  opts.push({ value: 'SKIP', label: 'Skip' });
  return opts;
}

function _renderAtoDialog() {
  if (!_atoDialogEl) return;
  _atoDialogEl.innerHTML = '';
  const head = _atoEl('div', 'efsp-ato-head');
  head.appendChild(_atoEl('span', 'efsp-ato-title', 'Import ATO'));
  const close = _atoEl('button', 'efsp-ato-close', '✕');
  close.title = 'Close (Esc)';
  close.addEventListener('click', () => closeAtoImportDialog());
  head.appendChild(close);
  _atoDialogEl.appendChild(head);

  const area = _atoEl('textarea', 'efsp-ato-text');
  area.placeholder = 'Paste the USMTF ATO here, or drop a .txt file';
  area.value = _atoText;
  area.addEventListener('input', () => { _atoText = area.value; _atoPreview = null; _atoChoices = new Map(); });
  _atoDialogEl.appendChild(area);

  const row = _atoEl('div', 'efsp-ato-actions');
  const file = _atoEl('input', 'efsp-ato-file');
  file.type = 'file';
  file.accept = '.txt,.usmtf,text/plain';
  file.addEventListener('change', () => _readAtoFile(file.files && file.files[0]));
  row.appendChild(file);
  const previewBtn = _atoEl('button', 'efsp-ato-preview-btn', 'Preview');
  previewBtn.addEventListener('click', () => requestAtoPreview());
  row.appendChild(previewBtn);
  _atoDialogEl.appendChild(row);

  if (_atoMessage) _atoDialogEl.appendChild(_atoEl('div', 'efsp-ato-msg', _atoMessage));

  if (_atoResults && !_atoPreview) {
    const list = _atoEl('div', 'efsp-ato-results');
    for (const r of _atoResults) {
      list.appendChild(_atoEl('div', `efsp-ato-result${r.ok ? '' : ' efsp-ato-result-bad'}`,
        `${r.lineId}: ${r.ok ? r.action : `${r.reason}${r.detail ? ` — ${r.detail}` : ''}`}`));
    }
    _atoDialogEl.appendChild(list);
  }
  if (!_atoPreview) return;

  const p = _atoPreview;
  const title = [p.header && p.header.operation && p.header.operation.name, p.header && p.header.msgId && p.header.msgId.serial].filter(Boolean).join(' · ');
  if (title) _atoDialogEl.appendChild(_atoEl('div', 'efsp-ato-docname', title));
  for (const w of p.warnings || []) _atoDialogEl.appendChild(_atoEl('div', `efsp-ato-warning efsp-ato-${w.severity || 'info'}`, w.message));

  const table = _atoEl('div', 'efsp-ato-lines');
  for (const l of p.lines) table.appendChild(_atoLineRow(l));
  _atoDialogEl.appendChild(table);

  if ((p.arLinks || []).length) {
    const ar = _atoEl('div', 'efsp-ato-ar');
    ar.appendChild(_atoEl('div', 'efsp-ato-subhead', 'AR groups'));
    for (const a of p.arLinks) {
      ar.appendChild(_atoEl('div', 'efsp-ato-ar-row',
        `${a.tankerCallsign || a.tankerMissionNumber || '?'} → ${a.receiverCallsign || a.receiverMissionNumber || '?'} · ARCT ${_atoZ(a.arctUtc)}${a.offloadKlb != null ? ` · ${a.offloadKlb} klb` : ''}${a.arcp ? ` · ${a.arcp}` : ''}`));
    }
    _atoDialogEl.appendChild(ar);
  }
  if ((p.notInThisAto || []).length) {
    const gone = _atoEl('div', 'efsp-ato-gone');
    gone.appendChild(_atoEl('div', 'efsp-ato-subhead', 'Tasked earlier, not in this ATO (left as they are)'));
    for (const n of p.notInThisAto) gone.appendChild(_atoEl('div', 'efsp-ato-gone-row', `${n.missionNumber || n.lineId} · ${n.callsign}`));
    _atoDialogEl.appendChild(gone);
  }

  const count = p.lines.filter(l => (_atoChoices.get(l.lineId) || l).action !== 'SKIP').length;
  const importBtn = _atoEl('button', 'efsp-ato-import-go', `Import ${count} line${count === 1 ? '' : 's'}`);
  importBtn.disabled = !!_atoPendingImportId || atoImportBlockers(p, _atoChoices).length > 0 || count === 0;
  importBtn.addEventListener('click', () => sendAtoImport());
  _atoDialogEl.appendChild(importBtn);
}

function _atoLineRow(l) {
  const row = _atoEl('div', 'efsp-ato-line');
  row.dataset.lineId = l.lineId;
  const s = l.summary || {};
  const iff = s.iff || {};
  const cells = [
    l.missionNumber, l.callsign || l.callsignRaw || '—', s.packageId || '—',
    `${_atoZ(s.vul && s.vul.startUtc)}–${_atoZ(s.vul && s.vul.endUtc)}`, s.agency || '—',
    `M1 ${iff.modeOne || '—'} M2 ${iff.modeTwo || '—'} M3 ${iff.modeThree || '—'}`,
  ];
  for (const c of cells) row.appendChild(_atoEl('span', 'efsp-ato-cell', c));
  if (l.missing && l.missing.length) row.appendChild(_atoEl('span', 'efsp-ato-missing', `missing: ${l.missing.join(', ')}`));

  const choice = _atoChoices.get(l.lineId) || { action: l.action };
  const select = _atoEl('select', 'efsp-ato-action');
  for (const o of _atoActionOptions(l)) {
    const opt = _atoEl('option', null, o.label);
    opt.value = o.value;
    select.appendChild(opt);
  }
  select.value = choice.action === 'BIND' ? `BIND:${choice.fdrId}` : choice.action;
  select.addEventListener('change', () => {
    const v = select.value;
    const next = v.startsWith('BIND:') ? { action: 'BIND', fdrId: v.slice(5) } : { action: v };
    if (next.action === 'CREATE') next.callsignOverride = choice.callsignOverride;
    _atoChoices.set(l.lineId, next);
    _renderAtoDialog();
  });
  row.appendChild(select);

  if (choice.action === 'CREATE' && !l.seedable) {
    const input = _atoEl('input', 'efsp-ato-callsign');
    input.placeholder = `callsign for ${l.callsignRaw || l.lineId}`;
    input.maxLength = 7;
    input.value = choice.callsignOverride || '';
    input.addEventListener('input', () => {
      _atoChoices.set(l.lineId, { action: 'CREATE', callsignOverride: String(input.value || '').toUpperCase().trim() });
    });
    input.addEventListener('change', () => _renderAtoDialog());
    row.appendChild(input);
  }
  if (l.changes && l.changes.length) {
    row.appendChild(_atoEl('span', 'efsp-ato-changes', l.changes.map(ch =>
      `${ch.path}: ${ch.from == null ? '—' : ch.from} → ${ch.to == null ? '—' : ch.to}${ch.ownedBy === 'CONTROLLER' ? ' (kept: typed by a controller)' : ch.ownedBy === 'FLIGHT' ? ' (kept: the filed flight\'s)' : ''}`).join('; ')));
  }
  if (l.warnings && l.warnings.length) {
    const w = _atoEl('details', 'efsp-ato-line-warnings');
    w.appendChild(_atoEl('summary', null, `${l.warnings.length} warning${l.warnings.length === 1 ? '' : 's'}`));
    for (const x of l.warnings) w.appendChild(_atoEl('div', `efsp-ato-warning efsp-ato-${x.severity || 'info'}`, x.message));
    row.appendChild(w);
  }
  return row;
}

/** For tests and the e2e: the dialog's state without reading the DOM. */
function getAtoImportState() {
  return { open: !!_atoDialogEl, preview: _atoPreview, choices: [..._atoChoices.entries()], pending: _atoPendingImportId, message: _atoMessage, results: _atoResults };
}

/** For the toolbar's ATO-first path (efsp-panel.js step 8). */
function setAtoLineChoice(lineId, choice) { _atoChoices.set(lineId, choice); _renderAtoDialog(); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initAtoImport, refreshAtoImportButton, openAtoImportDialog, closeAtoImportDialog, setAtoImportText,
    requestAtoPreview, onAtoPreviewResult, sendAtoImport, onAtoAck, atoImportBlockers, atoImportChoices,
    getAtoImportState, setAtoLineChoice,
  };
}
