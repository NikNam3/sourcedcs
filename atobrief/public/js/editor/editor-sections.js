// ═══════════════════════════════════════════════════════════
// editor-sections.js — Times editor and shared time helper
//
// ACO, SPINS, COMMS, and Weather editors have been split into
// dedicated files: editor-aco.js, editor-spins.js,
// editor-comms.js, and editor-weather.js.
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
    var fTime = editorField(body, 'IRL Time (Zulu)', ato.irl_time_zulu, { placeholder: '1900', required: true, hint: 'Enter in Zulu \u2014 Z is added automatically' });

    editorSectionTitle(body, 'INGAME START');
    var fIngame = editorField(body, 'Ingame Start Time (Zulu)', ato.ingame_start_time || ato.ingame_start_local, { placeholder: '2000', required: true, hint: 'Enter in Zulu \u2014 Z is added automatically' });

    // USMTF ATO header (ADR 0078): all optional, defaults in usmtf-ato.js
    var um = hdr.usmtf || {};
    editorSectionTitle(body, 'USMTF ATO HEADER');
    var fKind = editorField(body, 'Message Kind', um.message_kind || '', { type: 'select',
      options: [{ value: '', label: '— default (EXER) —' }, 'EXER', 'OPER'] });
    if (um.message_kind) fKind.value = String(um.message_kind).toUpperCase();
    var fOrig = editorField(body, 'Originator', um.originator, { placeholder: 'SOURCEDCS AOC' });
    var fSer  = editorField(body, 'Serial', um.serial, { placeholder: 'e.g. ATO C' });
    var fAsof = editorField(body, 'As Of (in-game)', um.asof, { placeholder: '2026-09-13 1800Z' });
    var fCtry = editorField(body, 'Tasked Country', um.country, { placeholder: 'US' });
    var fSvc  = editorField(body, 'Tasked Service', um.service, { placeholder: 'F' });
    var fUnit = editorField(body, 'Default Unit', um.default_unit, { placeholder: 'SOURCE DCS' });

    body._timesFields = { atoDate: fAtoDate, date: fDate, time: fTime, ingame: fIngame,
      usmtf: { message_kind: fKind, originator: fOrig, serial: fSer, asof: fAsof, country: fCtry, service: fSvc, default_unit: fUnit } };
  }, function () {
    var body = document.getElementById('editorBody');
    var f = body._timesFields;
    var ato = editorEnsureSection('ato');
    if (!STATE.pkg.header) STATE.pkg.header = {};

    STATE.pkg.header.ato_date = f.atoDate.value || undefined;
    ato.irl_date          = f.date.value || undefined;
    ato.irl_time_zulu     = _normalizeZulu(f.time.value);
    ato.ingame_start_time = _normalizeZulu(f.ingame.value);

    var um = {};
    Object.keys(f.usmtf).forEach(function (k) {
      var v = (f.usmtf[k].value || '').trim();
      if (v) um[k] = k === 'asof' ? v : v.toUpperCase();
    });
    if (Object.keys(um).length) STATE.pkg.header.usmtf = um;
    else delete STATE.pkg.header.usmtf;

    editorReRender('ato');
  });
}

// ═════════════════════════════════════════════════════════════
// CODEWORDS EDITOR
// ═════════════════════════════════════════════════════════════

function openCodewordsEditor() {
  var ato = editorEnsureSection('ato');
  if (!Array.isArray(ato.codewords)) { ato.codewords = []; }

  openEditorDialog('EDIT CODEWORDS', function (body) {
    editorSectionTitle(body, 'CODEWORDS — shown as markers on the timeline');

    var listEl = el('div', '');
    body._cwListEl = listEl;

    function appendCwRow(word, time) {
      var row = el('div', 'ef-codeword-row');

      var fWord = editorField(row, 'Codeword', word, { placeholder: 'BRAVE SWORD' });
      var fTime = editorField(row, 'Time (Zulu)', time, {
        placeholder: '2040',
        hint: 'Z is added automatically',
      });
      row._cwWord = fWord;
      row._cwTime = fTime;

      // DEL button aligned with inputs
      var delWrap = el('div', 'ef-group');
      delWrap.appendChild(el('label', 'ef-label', '\u00A0'));
      var delBtn = el('button', 'ef-btn ef-btn-sm ef-btn-danger', 'DEL');
      delBtn.type = 'button';
      delBtn.addEventListener('click', function () { row.remove(); });
      delWrap.appendChild(delBtn);
      row.appendChild(delWrap);

      listEl.appendChild(row);
    }

    ato.codewords.forEach(function (cw) {
      appendCwRow(cw.word || '', (cw.time || '').replace(/Z$/i, ''));
    });
    body.appendChild(listEl);

    var addBtn = el('button', 'ef-btn ef-btn-add', '+ ADD CODEWORD');
    addBtn.type = 'button';
    addBtn.addEventListener('click', function () { appendCwRow('', ''); });
    body.appendChild(addBtn);

  }, function () {
    var ato  = editorEnsureSection('ato');
    var body = document.getElementById('editorBody');
    var listEl = body._cwListEl;
    if (!listEl) { return; }

    var codewords = [];
    listEl.querySelectorAll('.ef-codeword-row').forEach(function (row) {
      var word    = row._cwWord ? row._cwWord.value.trim().toUpperCase() : '';
      var rawTime = row._cwTime ? row._cwTime.value.replace(/[ZL]$/i, '').trim() : '';
      if (!word && !rawTime) { return; }
      var entry = {};
      if (word)    { entry.word = word; }
      if (rawTime) { entry.time = rawTime + 'Z'; }
      codewords.push(entry);
    });

    if (codewords.length) {
      ato.codewords = codewords;
    } else {
      delete ato.codewords;
    }
    editorReRender('ato');
  });
}
