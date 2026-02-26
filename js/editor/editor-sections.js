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
