// ═══════════════════════════════════════════════════════════
// editor-weather.js — WEATHER section editor
//
// Extracted from editor-sections.js. Handles editing of the
// WEATHER section: header fields, METARs/TAFs, and per-mission
// weather notes.
// ═══════════════════════════════════════════════════════════

'use strict';

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

    // Parse METARs
    wx.metars = f.metars.value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);

    // Parse TAFs
    wx.tafs = f.tafs.value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);

    // Mission weather
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

    var delBtn = el('button', 'ef-btn ef-btn-sm ef-btn-danger', '\u2715');
    (function (idx) {
      delBtn.addEventListener('click', function () {
        msnWx.splice(idx, 1);
        _renderMsnWxList(container, msnWx);
      });
    })(i);

    row.appendChild(refInput);
    row.appendChild(noteInput);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}
