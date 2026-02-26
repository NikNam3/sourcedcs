// ═══════════════════════════════════════════════════════════
// editor-sections.js — Times and Weather editors
//
// ACO editor  → editor-aco.js
// SPINS editor → editor-spins.js
// COMMS editor → editor-comms.js
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Shared helper: normalize a time value to Zulu (strip Z/L, re-add Z) ──
function _normalizeZulu(val) {
  var raw = (val || '').replace(/[ZL]$/i, '').trim();
  return raw ? raw + 'Z' : undefined;
}

// ═════════════════════════════════════════════════════════════
// TIMES EDITOR (IRL + INGAME START)
// ═════════════════════════════════════════════════════════════

function openTimesEditor() {
  var ato = editorEnsureSection('ato');
  if (!STATE.pkg.header) STATE.pkg.header = {};
  var hdr = STATE.pkg.header;

  openEditorDialog('EDIT TIMES', function (body) {
    editorSectionTitle(body, 'PACKAGE HEADER');
    var fAtoDate = editorField(body, 'ATO Date (Ingame)', hdr.ato_date, { placeholder: '2026-01-11', hint: 'In-game mission date (YYYY-MM-DD)' });

    editorSectionTitle(body, 'IRL START');
    var fDate = editorField(body, 'IRL Date', ato.irl_date, { placeholder: '2026-01-11', required: true });
    var fTime = editorField(body, 'IRL Time (Zulu)', ato.irl_time_zulu, { placeholder: '1900', required: true, hint: 'Enter in Zulu — Z is added automatically' });

    editorSectionTitle(body, 'INGAME START');
    var fIngame = editorField(body, 'Ingame Start Time (Zulu)', ato.ingame_start_time || ato.ingame_start_local, { placeholder: '2000', required: true, hint: 'Enter in Zulu — Z is added automatically' });

    body._timesFields = { atoDate: fAtoDate, date: fDate, time: fTime, ingame: fIngame };
  }, function () {
    var body = document.getElementById('editorBody');
    var f = body._timesFields;
    var ato = editorEnsureSection('ato');
    if (!STATE.pkg.header) STATE.pkg.header = {};

    STATE.pkg.header.ato_date = f.atoDate.value || undefined;
    ato.irl_date          = f.date.value || undefined;
    ato.irl_time_zulu     = _normalizeZulu(f.time.value);
    ato.ingame_start_time = _normalizeZulu(f.ingame.value);

    editorReRender('ato');
  });
}

// ═════════════════════════════════════════════════════════════
// WEATHER EDITOR
// ═════════════════════════════════════════════════════════════

function openWeatherEditor() {
  var wx = editorEnsureSection('weather');

  openEditorDialog('EDIT WEATHER', function (body) {
    editorSectionTitle(body, 'HEADER');
    var fIssued = editorField(body, 'Issued',     wx.issued);
    var fFrom   = editorField(body, 'Valid From',  wx.valid_from,  { placeholder: '1800' });
    var fTo     = editorField(body, 'Valid To',    wx.valid_to,    { placeholder: '0600' });
    var fOp     = editorField(body, 'Operation',   wx.operation);

    body._wxHeader = { issued: fIssued, from: fFrom, to: fTo, op: fOp };

    // METARs
    editorSectionTitle(body, 'METARs');
    var metarsText = (wx.metars || []).join('\n');
    var fMetars = editorField(body, 'METARs', metarsText, {
      type: 'textarea',
      rows: 4,
      hint: 'One METAR per line',
    });

    // TAFs
    editorSectionTitle(body, 'TAFs');
    var tafsText = (wx.tafs || []).join('\n');
    var fTafs = editorField(body, 'TAFs', tafsText, {
      type: 'textarea',
      rows: 6,
      hint: 'One TAF per line (join continuation lines)',
    });

    // Mission weather notes
    editorSectionTitle(body, 'MISSION WEATHER NOTES');
    var msnWx = (wx.mission_wx || []).map(function (mw) { return Object.assign({}, mw); });
    body._msnWx = msnWx;

    var listEl = el('div', 'ef-list-items');
    body._wxListEl = listEl;
    _renderMsnWxList(listEl, msnWx);
    body.appendChild(listEl);

    var addBtn = el('button', 'ef-btn ef-btn-add', '+ ADD NOTE');
    addBtn.addEventListener('click', function () {
      msnWx.push({ mission_ref: '', notes: '' });
      _renderMsnWxList(listEl, msnWx);
    });
    body.appendChild(addBtn);

    body._wxFields = { metars: fMetars, tafs: fTafs };

  }, function () {
    var body = document.getElementById('editorBody');
    var h = body._wxHeader;
    var f = body._wxFields;
    var wx = editorEnsureSection('weather');

    wx.issued     = h.issued.value || undefined;
    wx.valid_from = h.from.value || undefined;
    wx.valid_to   = h.to.value || undefined;
    wx.operation  = h.op.value || undefined;

    wx.metars = f.metars.value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    wx.tafs   = f.tafs.value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);

    wx.mission_wx = body._msnWx.filter(function (mw) { return mw.mission_ref || mw.notes; });

    editorReRender('weather');
  });
}

function _renderMsnWxList(container, msnWx) {
  container.innerHTML = '';
  msnWx.forEach(function (mw, i) {
    var row = el('div', 'ef-ap-row');

    var refInput = el('input', 'ef-input ef-input-sm');
    refInput.placeholder = 'Mission Ref';
    refInput.value = mw.mission_ref || '';
    refInput.addEventListener('input', function () { mw.mission_ref = this.value; });

    var noteInput = el('input', 'ef-input');
    noteInput.placeholder = 'Notes';
    noteInput.value = mw.notes || '';
    noteInput.addEventListener('input', function () { mw.notes = this.value; });

    var delBtn = el('button', 'ef-btn ef-btn-sm ef-btn-danger', '✕');
    delBtn.addEventListener('click', function () {
      msnWx.splice(i, 1);
      _renderMsnWxList(container, msnWx);
    });

    row.appendChild(refInput);
    row.appendChild(noteInput);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}
