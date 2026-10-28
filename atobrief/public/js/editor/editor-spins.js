// ═══════════════════════════════════════════════════════════
// editor-spins.js — SPINS section editor
//
// Data model: each section stores content as a `markdown` string
// and/or an optional `table` object {headers, rows}.
//
// Section editors dispatched by title:
//   C1 — COMMAND & CONTROL  registry agencies (read-only) + package lead
//   C3 — IFF / SIF          table editor (squawk codes)
//   All others              markdown textarea + optional preset picker
//
// Preset data is loaded at startup into window.SPINS_PRESETS
// from spins-presets.json (see app.js).
// ═══════════════════════════════════════════════════════════

'use strict';

// ═════════════════════════════════════════════════════════════
// UTILITIES
// ═════════════════════════════════════════════════════════════

// Convert a preset entries array to a markdown string.
function _entriesToMarkdown(entries) {
  return (entries || []).map(function (e) {
    if (e.heading != null) return '## ' + e.heading;
    if (e.label   != null) return '**' + e.label + '**: ' + (e.value != null ? e.value : '');
    if (e.bullet  != null) return '- ' + e.bullet;
    if (e.value   != null) return String(e.value);
    return '';
  }).filter(Boolean).join('\n');
}

// Return a unique random 4-digit octal Mode-3 squawk,
// excluding emergency codes and any already-used codes.
function _randomSquawkCode(exclude) {
  var FORBIDDEN = new Set(['7500', '7600', '7700']);
  var code;
  do {
    code = '';
    for (var i = 0; i < 4; i++) code += String(Math.floor(Math.random() * 8));
  // 6xxx is crc-sync's synthetic AI block (docs/parallel/decisions.md S-L3).
  } while (FORBIDDEN.has(code) || code[0] === '6' || exclude.has(code));
  return code;
}

// Strip the optional "MSN" prefix from a mission_number string.
function _parseMissionNum(msn) {
  return (msn.mission_number || '').replace(/^MSN/i, '').trim();
}

function _getRegistryAgencies() {
  return Object.values(
    (STATE.pkg && STATE.pkg.registry && STATE.pkg.registry.control_agencies) || {}
  );
}

// ═════════════════════════════════════════════════════════════
// SECTION TYPE DETECTION
// ═════════════════════════════════════════════════════════════

function _spinsIsCommandControl(title) {
  return /\bc1\b|command.*control/i.test(title || '');
}

function _spinsIsIff(title) {
  return /\bc3\b|iff\b/i.test(title || '');
}

// Returns the preset category key for sections that support presets,
// or null for sections that don't.
function _spinsPresetCategory(title) {
  if (/\bc4\b|rules of engagement|roe/i.test(title)) return 'roe';
  if (/\bc7\b|lost comms/i.test(title))              return 'lost_comms';
  if (/\bc8\b|abort crit/i.test(title))              return 'abort_criteria';
  if (/\bc9\b|search.*rescue|sar/i.test(title))      return 'sar';
  if (/\bc10\b|authentication/i.test(title))         return 'authentication';
  if (/\bc11\b|safety/i.test(title))                 return 'safety';
  return null;
}

// ═════════════════════════════════════════════════════════════
// DATA BUILDERS  (return plain data, no DOM)
// ═════════════════════════════════════════════════════════════

// Build the C1 markdown string from registry agencies and a chosen
// package lead callsign.
function _buildC1Markdown(packageLead) {
  var lines = ['## C1.1 \u2014 Tactical Control'];
  var agencies = _getRegistryAgencies();
  if (agencies.length) {
    agencies.forEach(function (ag) {
      var callsign = ag.callsign || '';
      var freq     = ag.primary_freq_mhz || '';
      var role     = (ag.type || 'AWACS').toUpperCase();
      lines.push('**PRIMARY ' + role + '**: ' + callsign + (freq ? ' / ' + freq + ' MHz' : ''));
    });
  } else {
    lines.push('**PRIMARY AWACS**: ');
  }
  lines.push('', '## C1.3 \u2014 Package Lead', '**PACKAGE LEAD**: ' + (packageLead || ''));
  return lines.join('\n');
}

// Build an IFF squawk table from the loaded ATO missions.
// Returns null when there are no missions.
function _buildIffTable() {
  var missions = (STATE.pkg && STATE.pkg.ato && STATE.pkg.ato.missions) || [];
  if (!missions.length) return null;
  var used = new Set();
  var rows = missions.map(function (msn) {
    var num    = _parseMissionNum(msn);
    var squawk = _randomSquawkCode(used);
    used.add(squawk);
    return [num, '3', squawk];
  });
  return { headers: ['MSN', 'MODE', 'CODE'], rows: rows };
}

// Generate all nine standard SPINS sections from ATO data + preset defaults.
function _initializeSpinsFromAto() {
  var missions = (STATE.pkg && STATE.pkg.ato && STATE.pkg.ato.missions) || [];

  // C5 execution blocks — one per mission
  var c5Blocks = missions.map(function (msn) {
    var num     = _parseMissionNum(msn);
    var heading = (num ? 'C5.' + num + ' \u2014 ' : '') +
                  (msn.callsign || '') +
                  (msn.mission_type ? ' (' + msn.mission_type + ')' : '');
    return heading.trim() ? '## ' + heading + '\n**OBJECTIVE**: \n**DESIRED EFFECTS**: ' : null;
  }).filter(Boolean);

  var iffTable = _buildIffTable();
  var c3 = { title: 'C3 \u2014 IFF / SIF', note: 'Squawk assigned Mode 3 code. Mode 4 mandatory.' };
  if (iffTable) c3.table = iffTable;

  return [
    { title: 'C1 \u2014 COMMAND & CONTROL', markdown: _buildC1Markdown('') },
    c3,
    { title: 'C4 \u2014 RULES OF ENGAGEMENT', markdown: _entriesToMarkdown(SPINS_PRESETS.roe[0].entries) },
    { title: 'C5 \u2014 EXECUTION',           markdown: c5Blocks.join('\n\n') },
    { title: 'C7 \u2014 LOST COMMS',          markdown: _entriesToMarkdown(SPINS_PRESETS.lost_comms[0].entries) },
    { title: 'C8 \u2014 ABORT CRITERIA',      markdown: _entriesToMarkdown(SPINS_PRESETS.abort_criteria[0].entries) },
    { title: 'C9 \u2014 SEARCH AND RESCUE',   markdown: _entriesToMarkdown(SPINS_PRESETS.sar[0].entries) },
    { title: 'C10 \u2014 AUTHENTICATION',     markdown: _entriesToMarkdown(SPINS_PRESETS.authentication[0].entries) },
    { title: 'C11 \u2014 SAFETY',             markdown: _entriesToMarkdown(SPINS_PRESETS.safety[0].entries) },
  ];
}

// ═════════════════════════════════════════════════════════════
// C1 SECTION EDITOR
// ═════════════════════════════════════════════════════════════

function _buildC1SectionEditor(body, sec) {
  body._spinsC1Mode = true;

  // Tactical control — read-only agency list from registry
  editorSectionTitle(body, 'TACTICAL CONTROL');
  body.appendChild(el('div', 'ef-hint',
    '\u21b3 Populated from registry control agencies. ' +
    'Add agencies in the Registry editor to update this list.'));

  var agenciesEl = el('div', 'ef-list-items');
  _renderC1Agencies(agenciesEl);
  body.appendChild(agenciesEl);

  var refreshBtn = el('button', 'ef-btn ef-btn-sm', '\u21ba REFRESH FROM REGISTRY');
  refreshBtn.addEventListener('click', function () { _renderC1Agencies(agenciesEl); });
  body.appendChild(refreshBtn);

  // Package lead — dropdown of mission callsigns
  editorSectionTitle(body, 'PACKAGE LEAD');
  var missions    = (STATE.pkg && STATE.pkg.ato && STATE.pkg.ato.missions) || [];
  var currentLead = ((sec.markdown || '').match(/\*\*PACKAGE LEAD\*\*:\s*(\S.*)/) || [])[1] || '';

  var pkgSel = document.createElement('select');
  pkgSel.className = 'ef-input';
  pkgSel.appendChild(_makeOption('', '\u2014 select callsign \u2014'));
  missions.forEach(function (msn) {
    if (!msn.callsign) return;
    var label = msn.callsign + (msn.mission_type ? ' (' + msn.mission_type + ')' : '');
    var opt   = _makeOption(msn.callsign, label);
    if (msn.callsign === currentLead.trim()) opt.selected = true;
    pkgSel.appendChild(opt);
  });

  if (!missions.length) {
    pkgSel.disabled = true;
    body.appendChild(el('div', 'ef-hint', 'No ATO missions loaded.'));
  }

  var pkgRow = el('div', 'ef-ap-row');
  pkgRow.appendChild(pkgSel);
  body.appendChild(pkgRow);
  body._spinsC1PkgLeadSel = pkgSel;
}

function _renderC1Agencies(container) {
  container.innerHTML = '';
  var agencies = _getRegistryAgencies();
  if (!agencies.length) {
    container.appendChild(el('div', 'ef-hint', 'No control agencies in registry.'));
    return;
  }
  agencies.forEach(function (ag) {
    var callsign = ag.callsign || '';
    var freq     = ag.primary_freq_mhz || '';
    var role     = (ag.type || 'AWACS').toUpperCase();
    var lbl      = document.createElement('span');
    lbl.style.flex       = '1';
    lbl.style.fontFamily = 'var(--font-mono)';
    lbl.style.fontSize   = '11px';
    lbl.textContent      = callsign + (freq ? ' / ' + freq + ' MHz' : '');
    var row = el('div', 'ef-ap-row');
    row.appendChild(el('span', 'ef-entry-type', role));
    row.appendChild(lbl);
    container.appendChild(row);
  });
}

// ═════════════════════════════════════════════════════════════
// MARKDOWN + PRESET SECTION EDITOR
// ═════════════════════════════════════════════════════════════

function _buildMarkdownEditor(body, sec) {
  editorSectionTitle(body, 'CONTENT');
  var ta = document.createElement('textarea');
  ta.className = 'ef-input ef-textarea ef-markdown-area';
  ta.value     = sec.markdown || '';
  body.appendChild(ta);
  body._spinsMarkdownArea = ta;
}

// Renders a preset selector above the markdown textarea.
// Clicking APPLY replaces the textarea content with the chosen preset.
function _buildPresetPickerRow(body, presetCat) {
  var presets = (SPINS_PRESETS && SPINS_PRESETS[presetCat]) || [];
  if (!presets.length) return;

  body.appendChild(el('div', 'ef-hint',
    '\u21b3 Apply a built-in preset or edit the content freely below.'));

  var sel = document.createElement('select');
  sel.className = 'ef-input';
  presets.forEach(function (p, i) { sel.appendChild(_makeOption(String(i), p.label)); });

  var applyBtn = el('button', 'ef-btn ef-btn-sm', 'APPLY PRESET');
  applyBtn.addEventListener('click', function () {
    var preset = presets[parseInt(sel.value, 10)];
    var ta     = body.querySelector('.ef-markdown-area');
    if (preset && ta) ta.value = _entriesToMarkdown(preset.entries);
  });

  var row = el('div', 'ef-ap-row');
  row.style.marginBottom = '6px';
  row.appendChild(sel);
  row.appendChild(applyBtn);
  body.appendChild(row);
}

// ═════════════════════════════════════════════════════════════
// TABLE SECTION EDITOR  (used for C3 — IFF / SIF)
// ═════════════════════════════════════════════════════════════

function _buildSpinsTableEditor(body, tableData) {
  var headers = tableData ? tableData.headers.slice() : ['COL1', 'COL2'];
  var rows    = tableData ? tableData.rows.map(function (r) { return r.slice(); }) : [];

  body._spinsTableEnabled = !!tableData;
  body._spinsTableHeaders = headers;
  body._spinsTableRows    = rows;

  // Enable / disable checkbox
  var enableChk = document.createElement('input');
  enableChk.type    = 'checkbox';
  enableChk.checked = !!tableData;
  var chkLabel = el('label', 'ef-hint');
  chkLabel.textContent = '\u00a0Include table in this section';
  var checkRow = el('div', 'ef-ap-row');
  checkRow.appendChild(enableChk);
  checkRow.appendChild(chkLabel);
  body.appendChild(checkRow);

  // Table form (hidden when checkbox is unchecked)
  var tableForm = el('div', 'ef-table-form');
  tableForm.style.display = tableData ? '' : 'none';
  enableChk.addEventListener('change', function () {
    body._spinsTableEnabled  = this.checked;
    tableForm.style.display  = this.checked ? '' : 'none';
  });

  editorSectionTitle(tableForm, 'TABLE HEADERS');
  var hdrRow = el('div', 'ef-ap-row');
  _renderTableHeaderInputs(hdrRow, headers, rows, tableForm);
  tableForm.appendChild(hdrRow);

  editorSectionTitle(tableForm, 'TABLE ROWS');
  var rowsEl = el('div', 'ef-list-items');
  _renderTableRows(rowsEl, headers, rows);
  tableForm.appendChild(rowsEl);

  var addRowBtn = el('button', 'ef-btn ef-btn-add', '+ ROW');
  addRowBtn.addEventListener('click', function () {
    rows.push(headers.map(function () { return ''; }));
    _renderTableRows(rowsEl, headers, rows);
  });
  tableForm.appendChild(addRowBtn);

  body.appendChild(tableForm);
}

function _renderTableHeaderInputs(hdrRow, headers, rows, tableForm) {
  hdrRow.innerHTML = '';
  headers.forEach(function (h, hi) {
    var inp = el('input', 'ef-input ef-input-sm');
    inp.value       = h;
    inp.placeholder = 'Col ' + (hi + 1);
    inp.addEventListener('input', function () { headers[hi] = this.value; });
    hdrRow.appendChild(inp);
  });

  var addColBtn = el('button', 'ef-btn ef-btn-sm', '+ COL');
  addColBtn.addEventListener('click', function () {
    headers.push('');
    rows.forEach(function (r) { r.push(''); });
    _renderTableHeaderInputs(hdrRow, headers, rows, tableForm);
    var rowsEl = tableForm.querySelector('.ef-list-items');
    if (rowsEl) _renderTableRows(rowsEl, headers, rows);
  });
  hdrRow.appendChild(addColBtn);
}

function _renderTableRows(container, headers, rows) {
  container.innerHTML = '';
  rows.forEach(function (row, ri) {
    var rowEl = el('div', 'ef-ap-row');
    headers.forEach(function (h, ci) {
      var inp = el('input', 'ef-input ef-input-sm');
      inp.placeholder = h || 'Col ' + (ci + 1);
      inp.value       = row[ci] != null ? String(row[ci]) : '';
      inp.addEventListener('input', function () { row[ci] = this.value; });
      rowEl.appendChild(inp);
    });
    var delBtn = el('button', 'ef-btn ef-btn-sm ef-btn-danger', '\u2715');
    delBtn.addEventListener('click', function () {
      rows.splice(ri, 1);
      _renderTableRows(container, headers, rows);
    });
    rowEl.appendChild(delBtn);
    container.appendChild(rowEl);
  });
}

// ═════════════════════════════════════════════════════════════
// SECTION COLLECT  (read form state → save to in-memory section)
// ═════════════════════════════════════════════════════════════

function _collectSpinsSection(sections, index) {
  var body = document.getElementById('editorBody');
  if (!body || !body._spinsSecFields) return;

  var sec  = sections[index];
  sec.note = body._spinsSecFields.note.value || undefined;

  if (body._spinsC1Mode) {
    var lead = body._spinsC1PkgLeadSel ? body._spinsC1PkgLeadSel.value : '';
    sec.markdown = _buildC1Markdown(lead);
  } else if (body._spinsMarkdownArea) {
    sec.markdown = body._spinsMarkdownArea.value;
  }

  if (body._spinsTableEnabled && body._spinsTableHeaders) {
    sec.table = { headers: body._spinsTableHeaders, rows: body._spinsTableRows || [] };
  } else if (!body._spinsTableEnabled) {
    delete sec.table;
  }

  editorEnsureSection('spins').sections = sections;
}

// ═════════════════════════════════════════════════════════════
// SECTION LIST + SINGLE-SECTION EDITOR
// ═════════════════════════════════════════════════════════════

function _renderSpinsSectionsList(container, sections) {
  container.innerHTML = '';
  sections.forEach(function (sec, i) {
    editorItemRow(
      container,
      sec.title || 'Section ' + (i + 1),
      function () { _editSpinsSection(sections, i); },
      null  // individual section deletion is not permitted; use ⟳ GENERATE to reset all sections
    );
  });
}

function _editSpinsSection(sections, index) {
  var sec       = sections[index];
  var isC1      = _spinsIsCommandControl(sec.title);
  var isIff     = _spinsIsIff(sec.title);
  var presetCat = _spinsPresetCategory(sec.title);

  openEditorDialog('EDIT SPINS SECTION', function (body) {
    // Reset per-section transient state so previously edited sections
    // cannot leak mode/inputs into the current section.
    body._spinsC1Mode       = false;
    body._spinsC1PkgLeadSel = null;
    body._spinsMarkdownArea = null;
    body._spinsTableEnabled = false;
    body._spinsTableHeaders = null;
    body._spinsTableRows    = null;

    var backBtn = el('button', 'ef-btn ef-btn-back', 'BACK TO SPINS');
    backBtn.addEventListener('click', function () {
      _collectSpinsSection(sections, index);
      openSpinsEditor();
    });
    body.appendChild(backBtn);

    // Title is read-only — sections have a fixed layout
    editorField(body, 'Title', sec.title, { disabled: true });
    var fNote = editorField(body, 'Note', sec.note, { placeholder: 'Optional section note' });

    if (isC1) {
      _buildC1SectionEditor(body, sec);
    } else if (isIff) {
      var tableData = sec.table ? JSON.parse(JSON.stringify(sec.table)) : _buildIffTable();
      _buildSpinsTableEditor(body, tableData);
    } else {
      if (presetCat) _buildPresetPickerRow(body, presetCat);
      _buildMarkdownEditor(body, sec);
    }

    body._spinsSecFields = { note: fNote };
    body._spinsSections  = sections;
    body._spinsSecIndex  = index;

  }, function () {
    _collectSpinsSection(sections, index);
    editorReRender('spins');
  });
}

// ═════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════

function _makeOption(value, label) {
  var opt = document.createElement('option');
  opt.value       = value;
  opt.textContent = label;
  return opt;
}

// ═════════════════════════════════════════════════════════════
// PUBLIC API
// ═════════════════════════════════════════════════════════════

function openSpinsEditor() {
  var sp = editorEnsureSection('spins');

  openEditorDialog('EDIT SPINS', function (body) {
    editorSectionTitle(body, 'HEADER');
    var fOp  = editorField(body, 'Operation',     sp.operation);
    var fVer = editorField(body, 'Version',        sp.version);
    var fCls = editorField(body, 'Classification', sp.classification);
    body._spinsHeader = { op: fOp, ver: fVer, cls: fCls };

    var sections = (sp.sections || []).map(function (s) { return Object.assign({}, s); });
    body._spinsSections = sections;

    editorSectionTitle(body, 'SECTIONS');
    var listEl = el('div', 'ef-list-items');
    _renderSpinsSectionsList(listEl, sections);
    body.appendChild(listEl);

  }, function () {
    var body = document.getElementById('editorBody');
    var h    = body._spinsHeader;
    var sp   = editorEnsureSection('spins');
    sp.operation      = h.op.value  || undefined;
    sp.version        = h.ver.value || undefined;
    sp.classification = h.cls.value || undefined;
    sp.sections       = body._spinsSections;
    editorReRender('spins');
  });
}
