// ═══════════════════════════════════════════════════════════
// editor-aco.js — ACO editor
//
// Handles editing of the ACO section (Airspace Control Order):
//   header fields, and the list of Airspace Control Measures.
// Each ACM supports anchor (racetrack), circle, and polygon
// geometry types with show/hide based on a type selector.
// ═══════════════════════════════════════════════════════════

'use strict';

// ═════════════════════════════════════════════════════════════
// ACO EDITOR
// ═════════════════════════════════════════════════════════════

function openACOEditor() {
  var aco = editorEnsureSection('aco');

  openEditorDialog('EDIT ACO', function (body) {
    editorSectionTitle(body, 'HEADER');
    var fOp   = editorField(body, 'Operation',      aco.operation);
    var fId   = editorField(body, 'ACO ID',          aco.id);
    var fTz   = editorField(body, 'Timezone',        aco.timezone);
    var fDist = editorField(body, 'Distributing Agency', aco.distributing_agency);

    body._acoHeader = { op: fOp, id: fId, tz: fTz, dist: fDist };

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
      _editAcm(acms, acms.length - 1);
    });
    body.appendChild(addBtn);
  }, function () {
    var body = document.getElementById('editorBody');
    var h = body._acoHeader;
    var aco = editorEnsureSection('aco');

    aco.operation           = h.op.value || undefined;
    aco.id                  = h.id.value || undefined;
    aco.timezone            = h.tz.value || undefined;
    aco.distributing_agency = h.dist.value || undefined;
    aco.acms                = body._acoAcms;

    editorReRender('aco');
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
      editorEnsureSection('aco').acms = acms;
      openACOEditor();
    });
    body.appendChild(backBtn);

    var fName = editorField(body, 'Name', acm.name, { required: true });
    var fType = editorField(body, 'Type', acm.type, {
      type: 'select',
      options: ['ROZ', 'ORBIT', 'MEZ', 'KILLBOX', 'FACA', 'ANCHOR', 'NFZ', 'OTHER'],
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
