// ═══════════════════════════════════════════════════════════
// editor-missions-usmtf.js — mission form fields for the USMTF ATO
//
// The ATO fields atobrief lacked before decision H43 (ADR 0078): package,
// IFF Modes 1/2/3, datalink, alert status, priority, explicit vul window,
// narrative, and the control report-in point / check-in / secondary freq.
// All optional; an empty input removes the key. Codes are kept as TEXT so
// leading zeros survive (registry number fields are parseFloat'ed).
//
// Called from editor-missions.js (_openMissionForm, _buildControlSection,
// _collectMissionDraft, _saveMissionFromForm).
// ═══════════════════════════════════════════════════════════

'use strict';

function _usmtfSetOrDelete(obj, key, value) {
  if (value === undefined || value === null || value === '') delete obj[key];
  else obj[key] = value;
}

function _usmtfText(input, upper) {
  var v = (input && input.value != null ? String(input.value) : '').trim();
  return v === '' ? undefined : (upper ? v.toUpperCase() : v);
}

// PACKAGE + IFF / DATALINK + ATO sections, after TIMING.
function _buildUsmtfMissionSections(body, m, f) {
  var iff = m.iff || {};
  var dl  = m.datalink || {};
  var vul = m.vul || {};

  editorSectionTitle(body, 'PACKAGE');
  f.u_package_id = editorField(body, 'Package ID', m.package_id, { placeholder: 'e.g. AB' });
  f.u_package_cmdr = editorField(body, 'Package Commander', m.package_commander ? 'YES' : '', {
    type: 'select', options: [{ value: '', label: '— no —' }, { value: 'YES', label: 'YES (MC)' }],
  });
  if (m.package_commander) f.u_package_cmdr.value = 'YES';

  editorSectionTitle(body, 'IFF / DATALINK');
  f.u_mode1 = editorField(body, 'Mode 1', iff.mode1, { placeholder: 'e.g. 12', hint: '2 digits: 0-7 then 0-3' });
  f.u_mode2 = editorField(body, 'Mode 2', iff.mode2, { placeholder: 'e.g. 0011', hint: '4 octal digits' });
  f.u_mode3 = editorField(body, 'Mode 3', iff.mode3, { placeholder: 'e.g. 4521', hint: '4 octal digits; wins over the SPINS C3 table' });
  f.u_l16 = editorField(body, 'Link 16 Callsign', dl.l16_callsign, { placeholder: 'e.g. VP11' });
  f.u_tacan = editorField(body, 'TACAN', dl.tacan, { placeholder: 'e.g. 38Y' });
  f.u_ju = editorField(body, 'JTIDS Unit (JU)', dl.ju, { placeholder: 'e.g. 00011', hint: '5 octal digits' });

  editorSectionTitle(body, 'ATO');
  f.u_alert = editorField(body, 'Alert Status', m.alert_status, { placeholder: 'optional' });
  f.u_priority = editorField(body, 'Mission Priority', m.priority, { type: 'number', placeholder: 'e.g. 1' });
  f.u_vul_start = editorField(body, 'Vul Start (Zulu)', (vul.start || '').replace(/Z$/i, ''), {
    placeholder: '1300', hint: 'Explicit ATO vul window; otherwise the first target TOS/TOFFS is used',
  });
  f.u_vul_end = editorField(body, 'Vul End (Zulu)', (vul.end || '').replace(/Z$/i, ''), { placeholder: '1500' });
  f.u_narrative = editorField(body, 'Narrative', Array.isArray(m.narrative) ? m.narrative.join('\n') : m.narrative,
    { type: 'textarea', rows: 2, placeholder: 'Free text (NARR)' });
}

// Extra CONTROL inputs, appended inside the CONTROL section.
function _buildUsmtfControlFields(body, ctrl, f) {
  f.u_rip = editorField(body, 'Report-In Point', ctrl.report_in_point, { placeholder: 'e.g. ALPHA' });
  f.u_checkin = editorField(body, 'Check-In Time (Zulu)', (ctrl.check_in_time || '').replace(/Z$/i, ''), { placeholder: '1300' });
  f.u_sfreq = editorField(body, 'Secondary Freq (MHz)', ctrl.secondary_freq_mhz, { placeholder: '305.5' });
}

// Writes the fields above into mission m (a copy owned by the caller).
function _collectUsmtfMissionFields(f, m) {
  if (!f || !f.u_package_id) return;

  _usmtfSetOrDelete(m, 'package_id', _usmtfText(f.u_package_id, true));
  _usmtfSetOrDelete(m, 'package_commander', f.u_package_cmdr.value === 'YES' ? true : undefined);

  var iff = Object.assign({}, m.iff || {});
  _usmtfSetOrDelete(iff, 'mode1', _usmtfText(f.u_mode1));
  _usmtfSetOrDelete(iff, 'mode2', _usmtfText(f.u_mode2));
  _usmtfSetOrDelete(iff, 'mode3', _usmtfText(f.u_mode3));
  _usmtfSetOrDelete(m, 'iff', Object.keys(iff).length ? iff : undefined);

  var dl = Object.assign({}, m.datalink || {});
  _usmtfSetOrDelete(dl, 'l16_callsign', _usmtfText(f.u_l16, true));
  _usmtfSetOrDelete(dl, 'tacan', _usmtfText(f.u_tacan, true));
  _usmtfSetOrDelete(dl, 'ju', _usmtfText(f.u_ju));
  _usmtfSetOrDelete(m, 'datalink', Object.keys(dl).length ? dl : undefined);

  _usmtfSetOrDelete(m, 'alert_status', _usmtfText(f.u_alert, true));
  var prio = parseInt(f.u_priority.value, 10);
  _usmtfSetOrDelete(m, 'priority', isNaN(prio) ? undefined : prio);

  var vul = {};
  _usmtfSetOrDelete(vul, 'start', _normalizeZulu(f.u_vul_start.value));
  _usmtfSetOrDelete(vul, 'end', _normalizeZulu(f.u_vul_end.value));
  _usmtfSetOrDelete(m, 'vul', Object.keys(vul).length ? vul : undefined);

  _usmtfSetOrDelete(m, 'narrative', _usmtfText(f.u_narrative));

  if (f.u_rip) {
    var ctrl = Object.assign({}, m.control || {});
    _usmtfSetOrDelete(ctrl, 'report_in_point', _usmtfText(f.u_rip, true));
    _usmtfSetOrDelete(ctrl, 'check_in_time', _normalizeZulu(f.u_checkin.value));
    _usmtfSetOrDelete(ctrl, 'secondary_freq_mhz', _usmtfText(f.u_sfreq));
    Object.keys(ctrl).forEach(function (k) { if (ctrl[k] === undefined) delete ctrl[k]; });
    _usmtfSetOrDelete(m, 'control', Object.keys(ctrl).length ? ctrl : undefined);
  }
}
