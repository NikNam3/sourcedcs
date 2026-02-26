// ═══════════════════════════════════════════════════════════
// editor-spins.js — SPINS editor (structured)
//
// Replaces raw-YAML textarea editing with a structured
// entry-by-entry form.  Detects C3 (IFF/SIF) and C5
// (EXECUTION) sections and applies specialised editors
// that auto-populate a row / block for every mission in
// the current ATO.
// ═══════════════════════════════════════════════════════════

'use strict';

// ═════════════════════════════════════════════════════════════
// SPINS EDITOR
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
    body._spinsListEl = listEl;
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

// ── Route to the appropriate section editor ───────────────
function _editSpinsSection(sections, index) {
  var sec = sections[index];
  var title = (sec.title || '').toUpperCase();

  if (/\bC3\b|IFF|SIF/.test(title)) {
    _editIffSection(sections, index);
  } else if (/\bC5\b|EXECUTION/.test(title)) {
    _editExecutionSection(sections, index);
  } else {
    _editGenericSection(sections, index);
  }
}

// ═════════════════════════════════════════════════════════════
// C3 — IFF / SIF SECTION EDITOR
// Auto-populates one row per mission.
// ═════════════════════════════════════════════════════════════

function _ensureIffRows(table) {
  var missions = (STATE.pkg && STATE.pkg.ato && STATE.pkg.ato.missions) || [];
  missions.forEach(function (m) {
    // Use callsign as primary MSN reference; fall back to mission_number
    var ref = m.callsign || m.mission_number || '';
    if (!ref) return;
    var exists = (table.rows || []).some(function (r) { return String(r[0]) === ref; });
    if (!exists) {
      if (!table.rows) table.rows = [];
      table.rows.push([ref, '3', '']);
    }
  });
}

function _editIffSection(sections, index) {
  var sec = sections[index];
  if (!sec.table) sec.table = { headers: ['MSN', 'MODE', 'CODE'], rows: [] };
  _ensureIffRows(sec.table);

  var rows = sec.table.rows.map(function (r) { return r.slice(); });

  openEditorDialog('EDIT IFF / SIF', function (body) {
    var backBtn = el('button', 'ef-btn ef-btn-back', 'BACK TO SPINS');
    backBtn.addEventListener('click', function () {
      editorEnsureSection('spins').sections = sections;
      openSpinsEditor();
    });
    body.appendChild(backBtn);

    var fTitle = editorField(body, 'Title', sec.title, { placeholder: 'C3 — IFF / SIF' });
    var fNote  = editorField(body, 'Note',  sec.note,  { placeholder: 'e.g. Squawk assigned Mode 3 code. Mode 4 mandatory.' });

    editorSectionTitle(body, 'IFF TABLE');
    var hdrRow = el('div', 'ef-iff-hdr-row');
    ['MSN / CALLSIGN', 'MODE', 'CODE'].forEach(function (h) {
      hdrRow.appendChild(el('span', 'ef-iff-hdr-cell', h));
    });
    body.appendChild(hdrRow);

    var rowsEl = el('div', 'ef-list-items');
    _renderIffRows(rowsEl, rows);
    body.appendChild(rowsEl);

    var addBtn = el('button', 'ef-btn ef-btn-add', '+ ADD ROW');
    addBtn.addEventListener('click', function () {
      rows.push(['', '3', '']);
      _renderIffRows(rowsEl, rows);
    });
    body.appendChild(addBtn);

    body._iffSecs   = sections;
    body._iffIdx    = index;
    body._iffRows   = rows;
    body._iffFields = { title: fTitle, note: fNote };
  }, function () {
    var body = document.getElementById('editorBody');
    var sec  = body._iffSecs[body._iffIdx];
    var f    = body._iffFields;
    sec.title = f.title.value || sec.title;
    sec.note  = f.note.value || undefined;
    sec.table = {
      headers: ['MSN', 'MODE', 'CODE'],
      rows: body._iffRows.filter(function (r) { return r[0] || r[2]; }),
    };
    editorEnsureSection('spins').sections = body._iffSecs;
    editorReRender('spins');
  });
}

function _renderIffRows(container, rows) {
  container.innerHTML = '';
  rows.forEach(function (row, i) {
    var rowEl = el('div', 'ef-iff-row');

    var inMsn = el('input', 'ef-input ef-input-sm');
    inMsn.placeholder = 'Callsign / MSN';
    inMsn.value = row[0] || '';
    inMsn.addEventListener('input', function () { row[0] = this.value; });

    var inMode = el('input', 'ef-input ef-input-sm ef-input-code');
    inMode.placeholder = '3';
    inMode.value = row[1] || '';
    inMode.addEventListener('input', function () { row[1] = this.value; });

    var inCode = el('input', 'ef-input ef-input-sm ef-input-code');
    inCode.placeholder = '4811';
    inCode.value = row[2] || '';
    inCode.addEventListener('input', function () { row[2] = this.value; });

    var delBtn = el('button', 'ef-btn ef-btn-sm ef-btn-danger', '✕');
    delBtn.addEventListener('click', function () {
      rows.splice(i, 1);
      _renderIffRows(container, rows);
    });

    rowEl.appendChild(inMsn);
    rowEl.appendChild(inMode);
    rowEl.appendChild(inCode);
    rowEl.appendChild(delBtn);
    container.appendChild(rowEl);
  });
}

// ═════════════════════════════════════════════════════════════
// C5 — EXECUTION SECTION EDITOR
// Auto-populates a heading + objective entry per mission.
// ═════════════════════════════════════════════════════════════

function _ensureExecutionEntries(entries) {
  var missions = (STATE.pkg && STATE.pkg.ato && STATE.pkg.ato.missions) || [];
  missions.forEach(function (m) {
    var cs = m.callsign || '';
    if (!cs) return;
    // Match using the generated heading separator to avoid substring collisions
    // (e.g. "VIPER" should not match a heading for "VIPER12").
    var exists = entries.some(function (e) {
      return e.heading && String(e.heading).indexOf(' \u2014 ' + cs) !== -1;
    });
    if (!exists) {
      var msnNum = m.mission_number ? m.mission_number.replace(/^MSN/i, '') : '';
      var hd = 'C5';
      if (msnNum) hd += '.' + msnNum;
      hd += ' \u2014 ' + cs;
      if (m.mission_type) hd += ' (' + m.mission_type + ')';
      entries.push({ heading: hd });
      entries.push({ label: 'OBJECTIVE', value: '' });
    }
  });
}

function _editExecutionSection(sections, index) {
  var sec = sections[index];
  if (!sec.entries) sec.entries = [];
  _ensureExecutionEntries(sec.entries);

  var entries = sec.entries.map(function (e) { return Object.assign({}, e); });

  openEditorDialog('EDIT EXECUTION', function (body) {
    var backBtn = el('button', 'ef-btn ef-btn-back', 'BACK TO SPINS');
    backBtn.addEventListener('click', function () {
      editorEnsureSection('spins').sections = sections;
      openSpinsEditor();
    });
    body.appendChild(backBtn);

    var fTitle = editorField(body, 'Title', sec.title, { placeholder: 'C5 — EXECUTION' });

    editorSectionTitle(body, 'ENTRIES');
    var listEl = el('div', 'ef-list-items');
    _renderEntryList(listEl, entries);
    body.appendChild(listEl);
    body.appendChild(_buildAddEntryButtons(entries, listEl));

    body._execSecs    = sections;
    body._execIdx     = index;
    body._execEntries = entries;
    body._execFields  = { title: fTitle };
  }, function () {
    var body = document.getElementById('editorBody');
    var sec  = body._execSecs[body._execIdx];
    sec.title   = body._execFields.title.value || sec.title;
    sec.entries = body._execEntries;
    editorEnsureSection('spins').sections = body._execSecs;
    editorReRender('spins');
  });
}

// ═════════════════════════════════════════════════════════════
// GENERIC SECTION EDITOR
// Structured entry list (heading / label+value / bullet / value)
// replacing the raw-YAML textarea approach.
// ═════════════════════════════════════════════════════════════

function _editGenericSection(sections, index) {
  var sec = sections[index];
  var entries = (sec.entries || []).map(function (e) { return Object.assign({}, e); });

  openEditorDialog('EDIT SPINS SECTION', function (body) {
    var backBtn = el('button', 'ef-btn ef-btn-back', 'BACK TO SPINS');
    backBtn.addEventListener('click', function () {
      editorEnsureSection('spins').sections = sections;
      openSpinsEditor();
    });
    body.appendChild(backBtn);

    var fTitle = editorField(body, 'Title', sec.title, { placeholder: 'e.g. C1 — COMMAND & CONTROL' });
    var fNote  = editorField(body, 'Note',  sec.note,  { placeholder: 'Optional note' });

    editorSectionTitle(body, 'ENTRIES');
    var listEl = el('div', 'ef-list-items');
    _renderEntryList(listEl, entries);
    body.appendChild(listEl);
    body.appendChild(_buildAddEntryButtons(entries, listEl));

    body._genSecs    = sections;
    body._genIdx     = index;
    body._genEntries = entries;
    body._genFields  = { title: fTitle, note: fNote };
  }, function () {
    var body = document.getElementById('editorBody');
    var sec  = body._genSecs[body._genIdx];
    sec.title   = body._genFields.title.value || sec.title;
    sec.note    = body._genFields.note.value || undefined;
    sec.entries = body._genEntries;
    editorEnsureSection('spins').sections = body._genSecs;
    editorReRender('spins');
  });
}

// ── Entry list renderer (inline editing) ─────────────────
function _renderEntryList(container, entries) {
  container.innerHTML = '';
  if (!entries.length) {
    container.appendChild(el('div', 'ef-hint', 'No entries. Use the buttons below to add entries.'));
    return;
  }

  entries.forEach(function (entry, i) {
    var row = el('div', 'ef-entry-row');

    if (entry.heading !== undefined) {
      row.appendChild(el('span', 'ef-entry-tag ef-entry-tag-hdg', 'HDG'));
      var inp = el('input', 'ef-input ef-input-sm ef-entry-inp');
      inp.value = entry.heading || '';
      inp.placeholder = 'Heading text…';
      inp.addEventListener('input', function () { entry.heading = this.value; });
      row.appendChild(inp);
    } else if (entry.label !== undefined) {
      row.appendChild(el('span', 'ef-entry-tag ef-entry-tag-lv', 'L/V'));
      var inpL = el('input', 'ef-input ef-input-sm ef-entry-inp-half');
      inpL.value = entry.label || '';
      inpL.placeholder = 'Label';
      inpL.addEventListener('input', function () { entry.label = this.value; });
      row.appendChild(inpL);
      row.appendChild(el('span', 'ef-entry-sep', ':'));
      var inpV = el('input', 'ef-input ef-input-sm ef-entry-inp-half');
      inpV.value = entry.value || '';
      inpV.placeholder = 'Value';
      inpV.addEventListener('input', function () { entry.value = this.value; });
      row.appendChild(inpV);
    } else if (entry.bullet !== undefined) {
      row.appendChild(el('span', 'ef-entry-tag ef-entry-tag-bul', '•'));
      var inpB = el('input', 'ef-input ef-input-sm ef-entry-inp');
      inpB.value = entry.bullet || '';
      inpB.placeholder = 'Bullet text…';
      inpB.addEventListener('input', function () { entry.bullet = this.value; });
      row.appendChild(inpB);
    } else {
      row.appendChild(el('span', 'ef-entry-tag ef-entry-tag-val', 'VAL'));
      var inpVal = el('input', 'ef-input ef-input-sm ef-entry-inp');
      inpVal.value = entry.value || '';
      inpVal.placeholder = 'Value text…';
      inpVal.addEventListener('input', function () { entry.value = this.value; });
      row.appendChild(inpVal);
    }

    var upBtn = el('button', 'ef-btn ef-btn-sm', '↑');
    upBtn.title = 'Move up';
    upBtn.addEventListener('click', function () {
      if (i > 0) {
        entries.splice(i - 1, 0, entries.splice(i, 1)[0]);
        _renderEntryList(container, entries);
      }
    });

    var delBtn = el('button', 'ef-btn ef-btn-sm ef-btn-danger', '✕');
    delBtn.addEventListener('click', function () {
      entries.splice(i, 1);
      _renderEntryList(container, entries);
    });

    row.appendChild(upBtn);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}

// ── Add-entry buttons strip ───────────────────────────────
function _buildAddEntryButtons(entries, listEl) {
  var wrap = el('div', 'ef-add-entry-btns');

  function addEntry(newEntry) {
    entries.push(newEntry);
    _renderEntryList(listEl, entries);
  }

  var hdgBtn = el('button', 'ef-btn ef-btn-sm ef-btn-add', '+ HEADING');
  hdgBtn.addEventListener('click', function () { addEntry({ heading: '' }); });

  var lvBtn = el('button', 'ef-btn ef-btn-sm ef-btn-add', '+ LABEL/VALUE');
  lvBtn.addEventListener('click', function () { addEntry({ label: '', value: '' }); });

  var bulBtn = el('button', 'ef-btn ef-btn-sm ef-btn-add', '+ BULLET');
  bulBtn.addEventListener('click', function () { addEntry({ bullet: '' }); });

  var valBtn = el('button', 'ef-btn ef-btn-sm ef-btn-add', '+ VALUE');
  valBtn.addEventListener('click', function () { addEntry({ value: '' }); });

  wrap.appendChild(hdgBtn);
  wrap.appendChild(lvBtn);
  wrap.appendChild(bulBtn);
  wrap.appendChild(valBtn);
  return wrap;
}
