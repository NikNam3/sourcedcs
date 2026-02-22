// ═══════════════════════════════════════════════════════════
// editor-sections.js — SPINS, COMMS, Weather editors
//
// Each section editor follows the same pattern as the registry
// and mission editors: open a dialog, build a form, save back
// to STATE.pkg, and re-render.
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

  openEditorDialog('EDIT TIMES', function (body) {
    editorSectionTitle(body, 'IRL START');
    var fDate = editorField(body, 'IRL Date', ato.irl_date, { placeholder: '2026-01-11', required: true });
    var fTime = editorField(body, 'IRL Time (Zulu)', ato.irl_time_zulu, { placeholder: '1900', required: true, hint: 'Enter in Zulu — Z is added automatically' });

    editorSectionTitle(body, 'INGAME START');
    var fIngame = editorField(body, 'Ingame Start Time (Zulu)', ato.ingame_start_time || ato.ingame_start_local, { placeholder: '2000', required: true, hint: 'Enter in Zulu — Z is added automatically' });

    body._timesFields = { date: fDate, time: fTime, ingame: fIngame };
  }, function () {
    var body = document.getElementById('editorBody');
    var f = body._timesFields;
    var ato = editorEnsureSection('ato');

    ato.irl_date          = f.date.value || undefined;
    ato.irl_time_zulu     = _normalizeZulu(f.time.value);
    ato.ingame_start_time = _normalizeZulu(f.ingame.value);

    editorReRender();
  });
}

// ═════════════════════════════════════════════════════════════
// ACO EDITOR
// ═════════════════════════════════════════════════════════════

function openACOEditor() {
  var aco = editorEnsureSection('aco');

  openEditorDialog('EDIT ACO', function (body) {
    editorSectionTitle(body, 'HEADER');
    var fOp   = editorField(body, 'Operation',      aco.operation);
    var fDay  = editorField(body, 'ATO Day',         aco.ato_day);
    var fId   = editorField(body, 'ACO ID',          aco.id);
    var fTz   = editorField(body, 'Timezone',        aco.timezone);
    var fDist = editorField(body, 'Distributing Agency', aco.distributing_agency);

    body._acoHeader = { op: fOp, day: fDay, id: fId, tz: fTz, dist: fDist };

    // ACMs list
    var acms = (aco.acms || []).map(function (a) { return Object.assign({}, a); });
    body._acoAcms = acms;

    editorSectionTitle(body, 'AIRSPACE CONTROL MEASURES');
    var listEl = el('div', 'ef-list-items');
    body._acoListEl = listEl;
    _renderAcmList(listEl, acms);
    body.appendChild(listEl);

    var addBtn = el('button', 'ef-btn ef-btn-add', '+ ADD ACM');
    addBtn.addEventListener('click', function () {
      var newAcm = { name: 'NEW ACM', type: 'ROZ', geometry: {} };
      acms.push(newAcm);
      // Auto-open the edit form for the new ACM
      _editAcm(acms, acms.length - 1);
    });
    body.appendChild(addBtn);
  }, function () {
    var body = document.getElementById('editorBody');
    var h = body._acoHeader;
    var aco = editorEnsureSection('aco');

    aco.operation           = h.op.value || undefined;
    aco.ato_day             = h.day.value || undefined;
    aco.id                  = h.id.value || undefined;
    aco.timezone            = h.tz.value || undefined;
    aco.distributing_agency = h.dist.value || undefined;
    aco.acms                = body._acoAcms;

    // Write directly to the shared header so _syncHeaders treats it as
    // authoritative and doesn't let other sections (which still carry the
    // old propagated value) overwrite the user's edit.
    editorUpdateHeader(h.op.value, h.day.value);

    editorReRender();
  });
}

function _renderAcmList(container, acms) {
  container.innerHTML = '';
  acms.forEach(function (acm, i) {
    var label = (acm.name || 'ACM ' + (i + 1)) + ' (' + (acm.type || '?') + ')';
    editorItemRow(container, label,
      function () { _editAcm(acms, i); },
      function () {
        acms.splice(i, 1);
        _renderAcmList(container, acms);
      }
    );
  });
}

function _detectGeoType(geo) {
  if (geo.anchor_point) return 'anchor';
  if (geo.center)       return 'circle';
  if (geo.boundary && geo.boundary.length) return 'polygon';
  return 'anchor'; // default
}

function _editAcm(acms, index) {
  var acm = acms[index];

  openEditorDialog('EDIT ACM — ' + (acm.name || ''), function (body) {
    var backBtn = el('button', 'ef-btn ef-btn-back', 'BACK TO ACO');
    backBtn.addEventListener('click', function () {
      // Persist current ACMs state so new/deleted items survive re-read
      editorEnsureSection('aco').acms = acms;
      openACOEditor();
    });
    body.appendChild(backBtn);

    var fName = editorField(body, 'Name', acm.name, { required: true });
    var fType = editorField(body, 'Type', acm.type, {
      type: 'select',
      options: ['ROZ', 'ORBIT', 'MEZ', 'KILLBOX', 'FACA', 'ANCHOR', 'OTHER'],
    });
    if (acm.type) fType.value = acm.type;

    // Geometry fields (anchor / circle / polygon)
    var geo = acm.geometry || {};
    var geoFields = _buildAcmGeometryFields(body, geo);

    // Parameters
    editorSectionTitle(body, 'PARAMETERS');
    var fMsns    = editorField(body, 'Missions (comma-sep)', (acm.missions || []).join(', '));
    var fAltLo   = editorField(body, 'Alt Lower', acm.alt_lower, { placeholder: 'FL200' });
    var fAltHi   = editorField(body, 'Alt Upper', acm.alt_upper, { placeholder: 'FL260' });
    var fTimeFrom = editorField(body, 'Time From', acm.time_from, { placeholder: '2000' });
    var fTimeTo   = editorField(body, 'Time To', acm.time_to, { placeholder: '2300' });
    var fCtrl    = editorField(body, 'Control Agency', acm.control_agency);
    var fFreq    = editorField(body, 'Control Freq (MHz)', acm.control_freq_mhz);
    var fNotes   = editorField(body, 'Notes', acm.notes, { type: 'textarea', rows: 2 });

    body._acmFields = {
      name: fName, type: fType,
      geoType: geoFields.geoType,
      anchor: geoFields.anchor, heading: geoFields.heading,
      leg: geoFields.leg, dir: geoFields.dir,
      center: geoFields.center, radius: geoFields.radius,
      msns: fMsns, altLo: fAltLo, altHi: fAltHi,
      timeFrom: fTimeFrom, timeTo: fTimeTo,
      ctrl: fCtrl, freq: fFreq, notes: fNotes
    };
    body._acmAcms = acms;
    body._acmIndex = index;
  }, function () {
    _saveAcmFromForm(acms);
  });
}

// ── Build geometry type selector + anchor/circle/polygon field groups ──
function _buildAcmGeometryFields(body, geo) {
  var currentGeoType = _detectGeoType(geo);

  var fGeoType = editorField(body, 'Geometry Type', currentGeoType, {
    type: 'select',
    options: [
      { value: 'anchor',  label: 'Anchor (Racetrack)' },
      { value: 'circle',  label: 'Circle (Center + Radius)' },
      { value: 'polygon', label: 'Polygon (Boundary Points)' },
    ],
  });
  fGeoType.value = currentGeoType;

  // Anchor fields
  var anchorSection = el('div', 'ef-geo-section');
  editorSectionTitle(anchorSection, 'ANCHOR GEOMETRY');
  var fAnchor  = editorField(anchorSection, 'Anchor Point', geo.anchor_point, { placeholder: "N25°30'00\" E55°30'00\"", coordPick: true });
  var fHeading = editorField(anchorSection, 'Heading (°)', geo.heading_deg, { type: 'number' });
  var fLeg     = editorField(anchorSection, 'Leg Length (NM)', geo.leg_length_nm, { type: 'number' });
  var fDir     = editorField(anchorSection, 'Direction', geo.direction, { placeholder: 'CW / CCW' });
  body.appendChild(anchorSection);

  // Circle fields
  var circleSection = el('div', 'ef-geo-section');
  editorSectionTitle(circleSection, 'CIRCLE GEOMETRY');
  var fCenter  = editorField(circleSection, 'Center', geo.center, { placeholder: "N25°30'00\" E55°30'00\"", coordPick: true });
  var fRadius  = editorField(circleSection, 'Radius (NM)', geo.radius_nm, { type: 'number' });
  body.appendChild(circleSection);

  // Polygon fields
  var polygonSection = el('div', 'ef-geo-section');
  editorSectionTitle(polygonSection, 'POLYGON BOUNDARY');
  var boundary = (geo.boundary || []).map(function (c) { return String(c); });
  body._acmBoundary = boundary;
  var bListEl = el('div', 'ef-list-items');
  _renderBoundaryList(bListEl, boundary);
  polygonSection.appendChild(bListEl);

  var addPtBtn = el('button', 'ef-btn ef-btn-add', '+ ADD POINT');
  addPtBtn.addEventListener('click', function () {
    boundary.push('');
    _renderBoundaryList(bListEl, boundary);
  });
  polygonSection.appendChild(addPtBtn);
  body.appendChild(polygonSection);

  // Show/hide geometry sections based on selection
  function updateGeoVisibility() {
    var sel = fGeoType.value;
    anchorSection.style.display  = sel === 'anchor'  ? '' : 'none';
    circleSection.style.display  = sel === 'circle'  ? '' : 'none';
    polygonSection.style.display = sel === 'polygon' ? '' : 'none';
  }
  fGeoType.addEventListener('change', updateGeoVisibility);
  updateGeoVisibility();

  return {
    geoType: fGeoType,
    anchor: fAnchor, heading: fHeading, leg: fLeg, dir: fDir,
    center: fCenter, radius: fRadius,
  };
}

// ── Collect form values and save ACM back to state ──
function _saveAcmFromForm(acms) {
  var body = document.getElementById('editorBody');
  var f = body._acmFields;
  var acm = acms[body._acmIndex];

  acm.name = f.name.value || undefined;
  acm.type = f.type.value || undefined;

  // Only save geometry for the selected type
  var geo = {};
  var geoType = f.geoType.value;
  if (geoType === 'anchor') {
    if (f.anchor.value) geo.anchor_point = f.anchor.value;
    if (f.heading.value) geo.heading_deg = parseFloat(f.heading.value);
    if (f.leg.value) geo.leg_length_nm = parseFloat(f.leg.value);
    if (f.dir.value) geo.direction = f.dir.value;
  } else if (geoType === 'circle') {
    if (f.center.value) geo.center = f.center.value;
    if (f.radius.value) geo.radius_nm = parseFloat(f.radius.value);
  } else if (geoType === 'polygon') {
    var boundary = (body._acmBoundary || []).filter(function (c) { return c.trim(); });
    if (boundary.length) geo.boundary = boundary;
  }
  acm.geometry = geo;

  var msnsRaw = f.msns.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  acm.missions = msnsRaw.length ? msnsRaw : undefined;
  acm.alt_lower = f.altLo.value || undefined;
  acm.alt_upper = f.altHi.value || undefined;
  acm.time_from = f.timeFrom.value || undefined;
  acm.time_to   = f.timeTo.value || undefined;
  acm.control_agency = f.ctrl.value || undefined;
  acm.control_freq_mhz = f.freq.value ? parseFloat(f.freq.value) : undefined;
  acm.notes = f.notes.value || undefined;

  // Persist edited ACMs back to STATE.pkg and re-render all views
  // (including the map, so airspace shapes update to new positions).
  editorEnsureSection('aco').acms = acms;
  editorReRender();
}

function _renderBoundaryList(container, boundary) {
  container.innerHTML = '';
  if (!boundary.length) {
    container.appendChild(el('div', 'ef-hint', 'No polygon points. Click "+ ADD POINT" to create a polygon boundary.'));
    return;
  }
  boundary.forEach(function (coord, i) {
    var row = el('div', 'ef-ap-row');

    var numLabel = el('span', 'ef-preset-ch', (i + 1) + '.');
    row.appendChild(numLabel);

    var input = el('input', 'ef-input ef-input-sm');
    input.placeholder = "N25°30'00\" E55°30'00\"";
    input.value = coord;
    input.addEventListener('input', function () { boundary[i] = this.value; });
    row.appendChild(input);

    var pickBtn = el('button', 'ef-btn ef-btn-sm ef-btn-pick', '📍');
    pickBtn.title = 'Pick from map';
    pickBtn.type = 'button';
    pickBtn.addEventListener('click', function () {
      _startCoordPick(input);
    });
    row.appendChild(pickBtn);

    var delBtn = el('button', 'ef-btn ef-btn-sm ef-btn-danger', '✕');
    delBtn.addEventListener('click', function () {
      boundary.splice(i, 1);
      _renderBoundaryList(container, boundary);
    });
    row.appendChild(delBtn);

    container.appendChild(row);
  });
}

// ═════════════════════════════════════════════════════════════
// SPINS EDITOR
// ═════════════════════════════════════════════════════════════

function openSpinsEditor() {
  var sp = editorEnsureSection('spins');

  openEditorDialog('EDIT SPINS', function (body) {
    // Header fields
    editorSectionTitle(body, 'HEADER');
    var fOp  = editorField(body, 'Operation',      sp.operation);
    var fDay = editorField(body, 'ATO Day',         sp.ato_day);
    var fVer = editorField(body, 'Version',         sp.version);
    var fCls = editorField(body, 'Classification',  sp.classification);

    body._spinsHeader = { op: fOp, day: fDay, ver: fVer, cls: fCls };

    // Sections list
    var sections = sp.sections || [];
    body._spinsSections = sections.map(function (s) { return Object.assign({}, s); });

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
    sp.ato_day        = h.day.value || undefined;
    sp.version        = h.ver.value || undefined;
    sp.classification = h.cls.value || undefined;
    sp.sections       = body._spinsSections;

    editorUpdateHeader(h.op.value, h.day.value);

    editorReRender();
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

function _editSpinsSection(sections, index) {
  var sec = sections[index];

  openEditorDialog('EDIT SPINS SECTION', function (body) {
    var fTitle = editorField(body, 'Title', sec.title, { placeholder: 'e.g. C1 — COMMAND & CONTROL' });
    var fNote  = editorField(body, 'Note',  sec.note,  { placeholder: 'Optional note' });

    // Entries as raw YAML text for maximum flexibility
    editorSectionTitle(body, 'ENTRIES (YAML)');
    var entriesYaml = '';
    if (sec.entries && sec.entries.length) {
      entriesYaml = jsyaml.dump(sec.entries, { lineWidth: -1, noRefs: true });
    }
    var fEntries = editorField(body, 'Entries', entriesYaml, {
      type: 'textarea',
      rows: 12,
      hint: 'YAML list of entries. Each entry: {label, value, style?}, {bullet, style?}, {heading}, or {value}',
    });

    // Table as raw YAML
    var tableYaml = '';
    if (sec.table) {
      tableYaml = jsyaml.dump(sec.table, { lineWidth: -1, noRefs: true });
    }
    var fTable = editorField(body, 'Table (optional)', tableYaml, {
      type: 'textarea',
      rows: 6,
      hint: 'YAML object: {headers: [...], rows: [[...], ...], cell_classes?: [...]}',
    });

    body._spinsSecFields = { title: fTitle, note: fNote, entries: fEntries, table: fTable };
    body._spinsSections = sections;
    body._spinsSecIndex = index;
  }, function () {
    var body = document.getElementById('editorBody');
    var f = body._spinsSecFields;
    var sec = body._spinsSections[body._spinsSecIndex];

    sec.title = f.title.value || '';
    sec.note  = f.note.value || undefined;

    // Parse entries YAML
    try {
      var entries = f.entries.value.trim() ? jsyaml.load(f.entries.value) : [];
      sec.entries = Array.isArray(entries) ? entries : [];
    } catch (e) {
      alert('Entries YAML error: ' + e.message);
      return;
    }

    // Parse table YAML
    try {
      if (f.table.value.trim()) {
        sec.table = jsyaml.load(f.table.value);
      } else {
        delete sec.table;
      }
    } catch (e) {
      alert('Table YAML error: ' + e.message);
      return;
    }

    // Go back to SPINS list editor
    openSpinsEditor();
  });
}

// ═════════════════════════════════════════════════════════════
// COMMS EDITOR
// ═════════════════════════════════════════════════════════════

function openCommsEditor() {
  var cm = editorEnsureSection('comms');

  openEditorDialog('EDIT COMMS', function (body) {
    editorSectionTitle(body, 'HEADER');
    var fOp   = editorField(body, 'Operation',      cm.operation);
    var fDay  = editorField(body, 'ATO Day',         cm.ato_day);
    var fLead = editorField(body, 'Wing Lead',       cm.wing_lead);
    var fCls  = editorField(body, 'Classification',  cm.classification);

    body._commsHeader = { op: fOp, day: fDay, lead: fLead, cls: fCls };

    // UHF presets
    editorSectionTitle(body, 'UHF PRESETS');
    body._uhfFields = _buildPresetFields(body, cm.uhf_presets || {});

    // VHF presets
    editorSectionTitle(body, 'VHF PRESETS');
    body._vhfFields = _buildPresetFields(body, cm.vhf_presets || {});

  }, function () {
    var body = document.getElementById('editorBody');
    var h = body._commsHeader;
    var cm = editorEnsureSection('comms');
    cm.operation      = h.op.value || undefined;
    cm.ato_day        = h.day.value || undefined;
    cm.wing_lead      = h.lead.value || undefined;
    cm.classification = h.cls.value || undefined;
    cm.uhf_presets    = _collectPresets(body._uhfFields);
    cm.vhf_presets    = _collectPresets(body._vhfFields);

    editorUpdateHeader(h.op.value, h.day.value);

    editorReRender();
  });
}

function _buildPresetFields(parent, presets) {
  var fields = [];
  for (var ch = 1; ch <= 20; ch++) {
    var p = presets[ch] || {};
    var row = el('div', 'ef-preset-row');
    row.appendChild(el('span', 'ef-preset-ch', 'CH ' + String(ch).padStart(2, '0')));

    var fCs = el('input', 'ef-input ef-input-sm');
    fCs.placeholder = 'Callsign';
    fCs.value = p.callsign || '';

    var fFreq = el('input', 'ef-input ef-input-sm');
    fFreq.placeholder = 'MHz';
    fFreq.value = p.freq_mhz != null ? String(p.freq_mhz) : '';

    var fRole = el('input', 'ef-input ef-input-sm');
    fRole.placeholder = 'Role';
    fRole.value = p.role || '';

    row.appendChild(fCs);
    row.appendChild(fFreq);
    row.appendChild(fRole);
    parent.appendChild(row);

    fields.push({ ch: ch, cs: fCs, freq: fFreq, role: fRole });
  }
  return fields;
}

function _collectPresets(fields) {
  var presets = {};
  fields.forEach(function (f) {
    if (f.cs.value || f.freq.value) {
      var p = {};
      if (f.cs.value)   p.callsign = f.cs.value;
      if (f.freq.value) p.freq_mhz = parseFloat(f.freq.value) || f.freq.value;
      if (f.role.value) p.role = f.role.value;
      presets[f.ch] = p;
    }
  });
  return presets;
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

    editorUpdateHeader(h.op.value, null);

    // Parse METARs
    wx.metars = f.metars.value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);

    // Parse TAFs
    wx.tafs = f.tafs.value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);

    // Mission weather
    wx.mission_wx = body._msnWx.filter(function (mw) { return mw.mission_ref || mw.notes; });

    editorReRender();
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
