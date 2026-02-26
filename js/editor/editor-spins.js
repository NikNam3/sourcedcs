// ═══════════════════════════════════════════════════════════
// editor-spins.js — SPINS section editor (structured)
//
// Replaces raw YAML entry editing with a structured list of
// typed entry rows (HDG / KV / BULLET / TEXT).
//
// Special section handling:
//   C5 / EXECUTION — auto-adds a heading + OBJECTIVE row for
//     each mission in the ATO so nothing is forgotten.
//   C3 / IFF        — auto-builds the IFF table with one row
//     per mission when no table exists yet.
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Open SPINS list editor ────────────────────────────────────
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
    _renderSpinsSectionsList(listEl, body._spinsSections);
    body.appendChild(listEl);

    var addBtn = el('button', 'ef-btn ef-btn-add', '+ ADD SECTION');
    addBtn.addEventListener('click', function () {
      body._spinsSections.push({ title: 'NEW SECTION', entries: [] });
      _renderSpinsSectionsList(listEl, body._spinsSections);
    });
    body.appendChild(addBtn);
  }, function () {
    var body = document.getElementById('editorBody');
    var h = body._spinsHeader;
    var sp = editorEnsureSection('spins');
    sp.operation      = h.op.value || undefined;
    sp.version        = h.ver.value || undefined;
    sp.classification = h.cls.value || undefined;
    sp.sections       = body._spinsSections;
    editorReRender('spins');
  });
}

function _renderSpinsSectionsList(container, sections) {
  container.innerHTML = '';
  sections.forEach(function (sec, i) {
    var label = sec.title || 'Section ' + (i + 1);
    editorItemRow(container, label,
      function () { _editSpinsSection(sections, i); },
      function () {
        sections.splice(i, 1);
        _renderSpinsSectionsList(container, sections);
      }
    );
  });
}

// ── Edit a single SPINS section ──────────────────────────────
function _editSpinsSection(sections, index) {
  var sec = sections[index];

  openEditorDialog('EDIT SPINS SECTION', function (body) {
    var backBtn = el('button', 'ef-btn ef-btn-back', 'BACK TO SPINS');
    backBtn.addEventListener('click', function () {
      _collectSpinsSection(sections, index);
      openSpinsEditor();
    });
    body.appendChild(backBtn);

    var fTitle = editorField(body, 'Title', sec.title, { placeholder: 'e.g. C5 — EXECUTION' });
    var fNote  = editorField(body, 'Note',  sec.note,  { placeholder: 'Optional section note' });

    var isExecution = /c5\b|execution/i.test(sec.title || '');
    var isIff       = /c3\b|iff\b/i.test(sec.title || '');

    // ── Entries ───────────────────────────────────────────────
    editorSectionTitle(body, 'ENTRIES');
    var entries = (sec.entries || []).map(function (e) { return Object.assign({}, e); });
    body._spinsEntries = entries;

    if (isExecution) {
      var hint = el('div', 'ef-hint', '\u21b3 Missing missions are auto-added below. Fill in OBJECTIVE for each.');
      body.appendChild(hint);
      _ensureMissionHeadings(entries);
    }

    var entriesListEl = el('div', 'ef-list-items');
    _renderSpinsEntriesList(entriesListEl, entries);
    body.appendChild(entriesListEl);

    // Add-entry type buttons
    var addRow = el('div', 'ef-add-entry-row');
    [
      ['+ HEADING',   function () { return { heading: '' }; }],
      ['+ LABEL/VAL', function () { return { label: '', value: '' }; }],
      ['+ BULLET',    function () { return { bullet: '' }; }],
      ['+ TEXT',      function () { return { value: '' }; }],
    ].forEach(function (pair) {
      var btn = el('button', 'ef-btn ef-btn-sm ef-btn-add', pair[0]);
      btn.addEventListener('click', function () {
        entries.push(pair[1]());
        _renderSpinsEntriesList(entriesListEl, entries);
      });
      addRow.appendChild(btn);
    });
    body.appendChild(addRow);

    // ── Table (optional) ──────────────────────────────────────
    editorSectionTitle(body, 'TABLE (OPTIONAL)');
    var tableData = sec.table ? JSON.parse(JSON.stringify(sec.table)) : null;
    if (isIff && !tableData) {
      tableData = _buildMissionIffTable();
    }
    _buildSpinsTableEditor(body, tableData);

    body._spinsSecFields = { title: fTitle, note: fNote };
    body._spinsSections  = sections;
    body._spinsSecIndex  = index;
  }, function () {
    _collectSpinsSection(sections, index);
    editorReRender('spins');
  });
}

// ── Collect section form → save to in-memory array and STATE ─
function _collectSpinsSection(sections, index) {
  var body = document.getElementById('editorBody');
  if (!body || !body._spinsSecFields) return;
  var sec = sections[index];
  sec.title   = body._spinsSecFields.title.value || '';
  sec.note    = body._spinsSecFields.note.value || undefined;
  sec.entries = body._spinsEntries || [];
  if (body._spinsTableEnabled && body._spinsTableHeaders) {
    sec.table = {
      headers: body._spinsTableHeaders,
      rows:    body._spinsTableRows || [],
    };
  } else {
    delete sec.table;
  }
  // Persist to STATE so navigation doesn't lose edits
  editorEnsureSection('spins').sections = sections;
}

// ── Render the structured entries list ────────────────────────
function _renderSpinsEntriesList(container, entries) {
  container.innerHTML = '';
  entries.forEach(function (entry, i) {
    var row = el('div', 'ef-entry-row');

    if (entry.heading != null) {
      row.appendChild(el('span', 'ef-entry-type', 'HDG'));
      var inp = el('input', 'ef-input ef-input-sm');
      inp.placeholder = 'Heading text';
      inp.value = String(entry.heading);
      (function (e) { inp.addEventListener('input', function () { e.heading = this.value; }); })(entry);
      row.appendChild(inp);
    } else if (entry.label != null) {
      row.appendChild(el('span', 'ef-entry-type', 'KV'));
      var lInp = el('input', 'ef-input ef-input-sm');
      lInp.placeholder = 'Label';
      lInp.value = entry.label || '';
      (function (e) { lInp.addEventListener('input', function () { e.label = this.value; }); })(entry);
      row.appendChild(lInp);
      var vInp = el('input', 'ef-input ef-input-sm');
      vInp.placeholder = 'Value';
      vInp.value = entry.value != null ? String(entry.value) : '';
      (function (e) { vInp.addEventListener('input', function () { e.value = this.value; }); })(entry);
      row.appendChild(vInp);
    } else if (entry.bullet != null) {
      row.appendChild(el('span', 'ef-entry-type', '\u2022'));
      var inp = el('input', 'ef-input ef-input-sm');
      inp.placeholder = 'Bullet text';
      inp.value = String(entry.bullet);
      (function (e) { inp.addEventListener('input', function () { e.bullet = this.value; }); })(entry);
      row.appendChild(inp);
    } else {
      row.appendChild(el('span', 'ef-entry-type', 'TXT'));
      var inp = el('input', 'ef-input ef-input-sm');
      inp.placeholder = 'Text';
      inp.value = entry.value != null ? String(entry.value) : '';
      (function (e) { inp.addEventListener('input', function () { e.value = this.value; }); })(entry);
      row.appendChild(inp);
    }

    var delBtn = el('button', 'ef-btn ef-btn-sm ef-btn-danger', '\u2715');
    (function (idx) {
      delBtn.addEventListener('click', function () {
        entries.splice(idx, 1);
        _renderSpinsEntriesList(container, entries);
      });
    })(i);
    row.appendChild(delBtn);

    container.appendChild(row);
  });
}

// ── Auto-populate C5 (EXECUTION) with per-mission headings ───
function _ensureMissionHeadings(entries) {
  var missions = (STATE.pkg && STATE.pkg.ato && STATE.pkg.ato.missions) || [];
  if (!missions.length) return;

  var existingHeadings = entries
    .filter(function (e) { return e.heading != null; })
    .map(function (e) { return String(e.heading || ''); });

  missions.forEach(function (m) {
    var msnNum   = (m.mission_number || '').replace(/^MSN/i, '');
    var callsign = m.callsign || '';
    var msnType  = m.mission_type || '';
    var prefix   = msnNum ? 'C5.' + msnNum + ' \u2014 ' : '';
    var headingText = prefix + callsign + (msnType ? ' (' + msnType + ')' : '');
    if (!headingText.trim()) return;

    var exists = existingHeadings.some(function (h) {
      return callsign ? h.indexOf(callsign) >= 0 : h === headingText;
    });
    if (!exists) {
      entries.push({ heading: headingText });
      entries.push({ label: 'OBJECTIVE', value: '' });
    }
  });
}

// ── Auto-build IFF table from mission list ────────────────────
function _buildMissionIffTable() {
  var missions = (STATE.pkg && STATE.pkg.ato && STATE.pkg.ato.missions) || [];
  var rows = missions.map(function (m) {
    return [(m.mission_number || '').replace(/^MSN/i, ''), '3', ''];
  });
  return { headers: ['MSN', 'MODE', 'CODE'], rows: rows };
}

// ── Structured table editor ───────────────────────────────────
function _buildSpinsTableEditor(body, tableData) {
  var headers = tableData ? tableData.headers.slice()                           : ['COL1', 'COL2'];
  var rows    = tableData ? tableData.rows.map(function (r) { return r.slice(); }) : [];

  body._spinsTableEnabled = !!tableData;
  body._spinsTableHeaders = headers;
  body._spinsTableRows    = rows;

  // Enable checkbox
  var checkRow = el('div', 'ef-ap-row');
  var enableChk = document.createElement('input');
  enableChk.type = 'checkbox';
  enableChk.checked = !!tableData;
  var lbl = el('label', 'ef-hint');
  lbl.textContent = '\u00a0Include table in this section';
  checkRow.appendChild(enableChk);
  checkRow.appendChild(lbl);
  body.appendChild(checkRow);

  var tableForm = el('div', 'ef-table-form');
  tableForm.style.display = tableData ? '' : 'none';
  enableChk.addEventListener('change', function () {
    body._spinsTableEnabled = this.checked;
    tableForm.style.display = this.checked ? '' : 'none';
  });

  // Header inputs
  editorSectionTitle(tableForm, 'TABLE HEADERS');
  var hdrRow = el('div', 'ef-ap-row');
  _buildTableHeaderInputs(hdrRow, headers, rows, tableForm, body);
  tableForm.appendChild(hdrRow);

  // Data rows
  editorSectionTitle(tableForm, 'TABLE ROWS');
  var rowsEl = el('div', 'ef-list-items');
  _renderSpinsTableRows(rowsEl, headers, rows);
  tableForm.appendChild(rowsEl);

  var addRowBtn = el('button', 'ef-btn ef-btn-add', '+ ROW');
  addRowBtn.addEventListener('click', function () {
    rows.push(headers.map(function () { return ''; }));
    _renderSpinsTableRows(rowsEl, headers, rows);
  });
  tableForm.appendChild(addRowBtn);

  body.appendChild(tableForm);
}

// ── Build header input row (called on initial build and after adding a column) ──
function _buildTableHeaderInputs(hdrRow, headers, rows, tableForm, body) {
  hdrRow.innerHTML = '';
  headers.forEach(function (h, hi) {
    var inp = el('input', 'ef-input ef-input-sm');
    inp.value = h;
    inp.placeholder = 'Col ' + (hi + 1);
    (function (idx) {
      inp.addEventListener('input', function () { headers[idx] = this.value; });
    })(hi);
    hdrRow.appendChild(inp);
  });
  var addColBtn = el('button', 'ef-btn ef-btn-sm', '+ COL');
  addColBtn.addEventListener('click', function () {
    headers.push('');
    rows.forEach(function (r) { r.push(''); });
    _buildTableHeaderInputs(hdrRow, headers, rows, tableForm, body);
    // Re-render rows to add new cell column
    var rowsEl = tableForm.querySelector('.ef-list-items');
    if (rowsEl) _renderSpinsTableRows(rowsEl, headers, rows);
  });
  hdrRow.appendChild(addColBtn);
}

// ── Render table data rows ────────────────────────────────────
function _renderSpinsTableRows(container, headers, rows) {
  container.innerHTML = '';
  rows.forEach(function (row, ri) {
    var rowEl = el('div', 'ef-ap-row');
    headers.forEach(function (h, ci) {
      var inp = el('input', 'ef-input ef-input-sm');
      inp.placeholder = h || ('Col ' + (ci + 1));
      inp.value = row[ci] != null ? String(row[ci]) : '';
      (function (r, idx) {
        inp.addEventListener('input', function () { r[idx] = this.value; });
      })(row, ci);
      rowEl.appendChild(inp);
    });
    var delBtn = el('button', 'ef-btn ef-btn-sm ef-btn-danger', '\u2715');
    (function (idx) {
      delBtn.addEventListener('click', function () {
        rows.splice(idx, 1);
        _renderSpinsTableRows(container, headers, rows);
      });
    })(ri);
    rowEl.appendChild(delBtn);
    container.appendChild(rowEl);
  });
}
