// ═══════════════════════════════════════════════════════════
// export-usmtf.js — USMTF ATO preview dialog (COPY / DOWNLOAD)
//
// The exporter is UsmtfAto (js/usmtf-ato.js, ADR 0078). Presentees can
// export too: they already hold the whole package.
// ═══════════════════════════════════════════════════════════

'use strict';

var _usmtfLast = null;   // { text, fileName } of the open preview

function openUsmtfExport() {
  if (!STATE.pkg) { showToast('NO PACKAGE LOADED', 'error'); return; }
  var pkg = editorCleanPkg(STATE.pkg);
  var r = UsmtfAto.buildUsmtf(pkg);
  if (r.errors.length) {
    showToast('USMTF EXPORT REFUSED — ' + r.errors.map(function (e) { return e.message; }).join('; '), 'error');
    return;
  }
  _usmtfLast = { text: r.text, fileName: UsmtfAto.usmtfFileName(pkg) };

  var overlay = document.getElementById('usmtfDialog');
  document.getElementById('usmtfText').value = r.text;
  document.getElementById('usmtfWarnCount').textContent = String(r.warnings.length);

  var list = document.getElementById('usmtfWarnings');
  list.innerHTML = '';
  r.warnings.forEach(function (w) {
    var li = document.createElement('li');
    li.className = 'usmtf-warn usmtf-warn-' + w.severity;
    var code = document.createElement('b');
    code.textContent = w.code;
    li.appendChild(code);
    li.appendChild(document.createTextNode(
      (w.missionNumber ? ' [' + w.missionNumber + ']' : '') + ' — ' + w.message +
      (w.count > 1 ? ' (×' + w.count + ')' : '')));
    list.appendChild(li);
  });
  overlay.style.display = 'flex';
}

function closeUsmtfExport() {
  var overlay = document.getElementById('usmtfDialog');
  if (overlay) overlay.style.display = 'none';
}

function copyUsmtfExport() {
  if (!_usmtfLast) return;
  var ta = document.getElementById('usmtfText');
  function fallback() {
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); showToast('COPIED'); }
    catch (e) { showToast('COPY FAILED — select the text and copy it by hand', 'error'); }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(_usmtfLast.text).then(function () { showToast('COPIED'); }, fallback);
  } else {
    fallback();
  }
}

function downloadUsmtfExport() {
  if (!_usmtfLast) return;
  var blob = new Blob([_usmtfLast.text], { type: 'text/plain' });
  var url  = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href     = url;
  a.download = _usmtfLast.fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
