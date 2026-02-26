// editor-registry.js — Registry CRUD editor
// Category-picker: compact 2-column grid navigates to per-category lists.
// Categories: airfields, carriers, tankers, targets,
//   reference_points, control_agencies, frequencies

'use strict';

var REGISTRY_CATEGORIES = {
  airfields: {
    label: 'AIRFIELDS',
    idLabel: 'ICAO',
    fields: [
      { key: 'name',         label: 'Name',         placeholder: 'e.g. Al Dhafra AB' },
      { key: 'coords',       label: 'Coordinates',  placeholder: "N24°14'36\" E054°27'07\"", coordPick: true },
      { key: 'elevation_ft', label: 'Elevation (ft)', type: 'number' },
    ],
  },
  carriers: {
    label: 'CARRIERS',
    idLabel: 'ID',
    fields: [
      { key: 'name',            label: 'Name',            placeholder: 'e.g. USS ROOSEVELT' },
      { key: 'callsign',        label: 'Callsign',        placeholder: 'e.g. ROUGH RIDER' },
      { key: 'deploy_coords',   label: 'Deploy Coords',   placeholder: "N24°30'00\" E059°15'00\"", coordPick: true },
      { key: 'recovery_coords', label: 'Recovery Coords',  placeholder: "N24°45'00\" E059°30'00\"", coordPick: true },
    ],
  },
  tankers: {
    label: 'TANKERS',
    idLabel: 'ID',
    fields: [
      { key: 'callsign',            label: 'Callsign',           placeholder: 'e.g. ARCO4' },
      { key: 'ar_track',            label: 'AR Track',           placeholder: 'e.g. AR394' },
      { key: 'altitude',            label: 'Altitude',           placeholder: 'e.g. FL240' },
      { key: 'tacan',               label: 'TACAN',              placeholder: 'e.g. 39X' },
      { key: 'tacan_role',          label: 'TACAN Role',         placeholder: 'e.g. REFUELING' },
      { key: 'freq_mhz',            label: 'Freq (MHz)',         type: 'number', placeholder: '251.0' },
      { key: 'speed_kts',           label: 'Speed (kts)',        type: 'number', placeholder: '300' },
      { key: 'orbit_anchor_coords', label: 'Orbit Anchor',      placeholder: "N24°30'00\" E055°30'00\"", coordPick: true },
      { key: 'orbit_heading_deg',   label: 'Orbit Heading (°)', type: 'number', placeholder: '270' },
      { key: 'orbit_leg_nm',        label: 'Orbit Leg (NM)',    type: 'number', placeholder: '20' },
      { key: 'orbit_width_nm',      label: 'Orbit Width (NM)',  type: 'number', placeholder: '5' },
    ],
  },
  targets: {
    label: 'TARGETS',
    idLabel: 'ID',
    fields: [
      { key: 'name',               label: 'Name',               placeholder: 'e.g. SA-2 Guideline' },
      { key: 'type',               label: 'Type',               placeholder: 'SAM / EWR / BUILDING' },
      { key: 'coords',             label: 'Coordinates',        placeholder: "N26°30'00\" E056°20'00\"", coordPick: true },
      { key: 'elevation',          label: 'Elevation',          placeholder: '150ft' },
      { key: 'engagement_range_nm', label: 'Engagement Range (NM)', type: 'number' },
      { key: 'max_alt_ft',         label: 'Max Altitude (ft)',  type: 'number' },
    ],
  },
  reference_points: {
    label: 'REFERENCE POINTS',
    isList: true,
    fields: [
      { key: 'name',     label: 'Name',     placeholder: 'e.g. COYOTE' },
      { key: 'type',     label: 'Type',     type: 'select', options: [{ value: '', label: '— select type —' }, 'bullseye', 'marshal'] },
      { key: 'coords',   label: 'Coordinates', placeholder: "N26°51'19\" E056°21'37\"", coordPick: true },
      { key: 'altitude', label: 'Altitude', placeholder: 'FL250' },
    ],
  },
  control_agencies: {
    label: 'CONTROL AGENCIES',
    idLabel: 'ID',
    fields: [
      { key: 'type',              label: 'Type',            placeholder: 'AWACS / CRC' },
      { key: 'callsign',          label: 'Callsign',        placeholder: 'e.g. SCREWTOP' },
      { key: 'platform',          label: 'Platform',        placeholder: 'e.g. E-3' },
      { key: 'primary_freq_mhz',  label: 'Primary Freq (MHz)',   placeholder: '260.0' },
      { key: 'secondary_freq_mhz', label: 'Secondary Freq (MHz)', placeholder: '134.0' },
    ],
  },
  frequencies: {
    label: 'FREQUENCIES',
    isList: true,
    idField: 'freq_mhz',
    fields: [
      { key: 'freq_mhz',  label: 'Freq (MHz)', type: 'number', placeholder: '305.0' },
      { key: 'callsign',  label: 'Callsign',   placeholder: 'e.g. GUARD' },
      { key: 'role',      label: 'Role',       placeholder: 'e.g. Emergency' },
    ],
  },
};

function openRegistryEditor() {
  var reg = (STATE.pkg && STATE.pkg.registry) || {};

  openEditorDialog('REGISTRY', function (body) {
    editorSectionTitle(body, 'SELECT CATEGORY');
    var grid = el('div', 'ef-cat-grid');

    Object.keys(REGISTRY_CATEGORIES).forEach(function (catKey) {
      var cat = REGISTRY_CATEGORIES[catKey];
      var raw = reg[catKey];
      var count = cat.isList
        ? (Array.isArray(raw) ? raw.length : 0)
        : Object.keys(raw || {}).length;

      var btn = el('button', 'ef-btn ef-btn-category', cat.label + '\n(' + count + ')');
      btn.addEventListener('click', function () { openRegistryCategoryEditor(catKey); });
      grid.appendChild(btn);
    });

    body.appendChild(grid);
  }, function () {});
}

function openRegistryCategoryEditor(catKey) {
  var cat = REGISTRY_CATEGORIES[catKey];
  var reg = editorEnsureRegistry();

  openEditorDialog(cat.label, function (body) {
    var backBtn = el('button', 'ef-btn ef-btn-back', 'BACK TO REGISTRY');
    backBtn.addEventListener('click', openRegistryEditor);
    body.appendChild(backBtn);

    if (cat.isList) {
      var items   = Array.isArray(reg[catKey]) ? reg[catKey] : [];
      var idField = cat.idField || 'name';
      items.forEach(function (item) {
        var id = String(item[idField]);
        var label = id;
        // For frequencies, show callsign and role in the list
        if (catKey === 'frequencies') {
          var parts = [item.callsign, item.role].filter(Boolean);
          if (parts.length) label += ' \u2014 ' + parts.join(' \u00b7 ');
        }
        editorItemRow(body, label,
          function () { editRegistryItem(catKey, id); },
          function () { deleteRegistryItem(catKey, id); }
        );
      });
    } else {
      var items = reg[catKey] || {};
      Object.keys(items).forEach(function (id) {
        var item  = items[id];
        var label = id + (item.name ? ' — ' + item.name : '');
        editorItemRow(body, label,
          function () { editRegistryItem(catKey, id); },
          function () { deleteRegistryItem(catKey, id); }
        );
      });
    }

    var addBtn = el('button', 'ef-btn ef-btn-add', '+ ADD');
    addBtn.addEventListener('click', function () { addRegistryItem(catKey); });
    body.appendChild(addBtn);
  }, function () {
    // no-op
  });
}

function editRegistryItem(catKey, id) {
  var cat = REGISTRY_CATEGORIES[catKey];
  var reg = editorEnsureRegistry();
  var idField = cat.idField || 'name';

  var item;
  if (cat.isList) {
    if (!Array.isArray(reg[catKey])) reg[catKey] = [];
    item = reg[catKey].find(function (i) { return String(i[idField]) === String(id); }) || {};
  } else {
    if (!reg[catKey]) reg[catKey] = {};
    item = reg[catKey][id] || {};
  }

  openEditorDialog('EDIT ' + cat.label.slice(0, -1) + ' — ' + id, function (body) {
    var backBtn = el('button', 'ef-btn ef-btn-back', 'BACK TO ' + cat.label);
    backBtn.addEventListener('click', function () { openRegistryCategoryEditor(catKey); });
    body.appendChild(backBtn);

    var fields = {};

    if (!cat.isList) {
      editorField(body, cat.idLabel, id, { disabled: true, hint: 'ID cannot be changed' });
    }

    cat.fields.forEach(function (f) {
      var isIdField = cat.isList && f.key === idField;
      fields[f.key] = editorField(body, f.label, item[f.key] != null ? item[f.key] : '', {
        type:        f.type || 'text',
        options:     f.options,
        placeholder: f.placeholder || '',
        coordPick:   f.coordPick || false,
        disabled:    isIdField,
        hint:        isIdField ? (f.label + ' cannot be changed here') : undefined,
      });
    });

    if (catKey === 'targets') {
      _buildAimPointsEditor(body, item);
    }

    body._editorFields = fields;
    body._editId = id;
    body._editItem = item;
    body._catKey = catKey;
  }, function () {
    _saveRegistryItem(catKey);
  });
}

function addRegistryItem(catKey) {
  var cat = REGISTRY_CATEGORIES[catKey];

  openEditorDialog('ADD ' + cat.label.slice(0, -1), function (body) {
    var backBtn = el('button', 'ef-btn ef-btn-back', 'BACK TO ' + cat.label);
    backBtn.addEventListener('click', function () { openRegistryCategoryEditor(catKey); });
    body.appendChild(backBtn);

    var fields = {};

    if (!cat.isList) {
      var idInput = editorField(body, cat.idLabel, '', {
        placeholder: 'Unique identifier',
        required: true,
      });
      body._idInput = idInput;
    }

    cat.fields.forEach(function (f) {
      fields[f.key] = editorField(body, f.label, '', {
        type:        f.type || 'text',
        options:     f.options,
        placeholder: f.placeholder || '',
        coordPick:   f.coordPick || false,
      });
    });

    body._editorFields = fields;
    body._catKey = catKey;
    body._isNew = true;
  }, function () {
    _saveRegistryItem(catKey);
  });
}

function deleteRegistryItem(catKey, id) {
  if (!confirm('Delete ' + id + '?')) return;

  var reg = editorEnsureRegistry();
  var cat = REGISTRY_CATEGORIES[catKey];
  var idField = cat.idField || 'name';

  if (cat.isList) {
    if (Array.isArray(reg[catKey])) {
      reg[catKey] = reg[catKey].filter(function (i) { return String(i[idField]) !== String(id); });
    }
  } else {
    if (reg[catKey]) delete reg[catKey][id];
  }

  _cascadeRegistryDelete(catKey, id);
  editorReRender();
  openRegistryCategoryEditor(catKey);
}

function _cascadeRegistryDelete(catKey, id) {
  var ato = STATE.pkg && STATE.pkg.ato;
  if (!ato) return;
  var missions = ato.missions || [];
  if (catKey === 'airfields') {
    missions.forEach(function (m) {
      if (m.home_base_icao === id)       m.home_base_icao = undefined;
      if (m.deploy_location_icao === id) m.deploy_location_icao = undefined;
      if (m.aar_location_icao === id)    m.aar_location_icao = undefined;
    });
  } else if (catKey === 'tankers') {
    missions.forEach(function (m) {
      if (m.refuel && m.refuel.tanker_id === id) delete m.refuel;
    });
  } else if (catKey === 'targets') {
    missions.forEach(function (m) {
      (m.targets || []).forEach(function (t) {
        if (t.target_id === id) t.target_id = undefined;
      });
    });
  } else if (catKey === 'control_agencies') {
    var gc = ato.global_control;
    if (gc && gc.agency_id === id) {
      gc.agency_id = undefined;
      gc.controlling_unit = undefined;
      gc.aircraft_type = undefined;
      gc.primary_freq_mhz = undefined;
    }
    missions.forEach(function (m) {
      if (m.control && m.control.agency_id === id) delete m.control;
    });
  } else if (catKey === 'reference_points') {
    var gc2 = ato.global_control;
    if (gc2 && gc2.bullseye && typeof gc2.bullseye === 'object' && gc2.bullseye.name === id) {
      gc2.bullseye = undefined;
    }
  }
}

function _saveRegistryItem(catKey) {
  var body   = document.getElementById('editorBody');
  var fields = body._editorFields;
  var reg    = editorEnsureRegistry();
  var cat    = REGISTRY_CATEGORIES[catKey];
  var idField = cat.idField || 'name';

  var item = body._editItem ? Object.assign({}, body._editItem) : {};
  var preserveNull = catKey === 'frequencies';
  Object.keys(fields).forEach(function (k) {
    var val = fields[k].value;
    if (val === '' || val == null) {
      if (preserveNull) { item[k] = null; } else { delete item[k]; }
    } else if (fields[k].type === 'number') {
      item[k] = parseFloat(val);
    } else {
      item[k] = val;
    }
  });

  if (catKey === 'targets' && body._aimPoints) {
    item.aim_points = body._aimPoints;
  }

  if (cat.isList) {
    if (!Array.isArray(reg[catKey])) reg[catKey] = [];
    if (body._isNew) {
      var idVal = item[idField];
      if (idVal == null || idVal === '') { showToast((idField.toUpperCase()) + ' IS REQUIRED', 'error'); return; }
      if (reg[catKey].some(function (i) { return String(i[idField]) === String(idVal); })) {
        showToast((idField.toUpperCase()) + ' ALREADY EXISTS', 'error'); return;
      }
      reg[catKey].push(item);
    } else {
      var idx = reg[catKey].findIndex(function (i) { return String(i[idField]) === String(body._editId); });
      if (idx >= 0) reg[catKey][idx] = item;
      else reg[catKey].push(item);
    }
  } else {
    if (!reg[catKey]) reg[catKey] = {};
    var id;
    if (body._isNew) {
      id = (body._idInput.value || '').trim();
      if (!id) { showToast('ID IS REQUIRED', 'error'); return; }
      if (reg[catKey][id]) { showToast('ID ALREADY EXISTS', 'error'); return; }
    } else {
      id = body._editId;
    }
    reg[catKey][id] = item;
  }

  editorReRender();
}

function _buildAimPointsEditor(parent, targetItem) {
  var aimPoints = (targetItem.aim_points || []).map(function (ap) {
    return { id: ap.id || '', name: ap.name || '', coords: ap.coords || '' };
  });
  var body = document.getElementById('editorBody');
  body._aimPoints = aimPoints;
  editorSectionTitle(parent, 'AIM POINTS');
  var listEl = el('div', 'ef-list-items');
  _renderAimPointsList(listEl, aimPoints);
  parent.appendChild(listEl);
  var addBtn = el('button', 'ef-btn ef-btn-add', '+ ADD AIM POINT');
  addBtn.addEventListener('click', function () {
    aimPoints.push({ id: '', name: '', coords: '' });
    body._aimPoints = aimPoints;
    _renderAimPointsList(listEl, aimPoints);
  });
  parent.appendChild(addBtn);
}

function _renderAimPointsList(container, aimPoints) {
  container.innerHTML = '';
  aimPoints.forEach(function (ap, i) {
    var row = el('div', 'ef-ap-row');
    var idInput = el('input', 'ef-input ef-input-sm');
    idInput.placeholder = 'ID'; idInput.value = ap.id || '';
    idInput.addEventListener('input', function () { ap.id = this.value; });
    var nameInput = el('input', 'ef-input ef-input-sm');
    nameInput.placeholder = 'Name'; nameInput.value = ap.name || '';
    nameInput.addEventListener('input', function () { ap.name = this.value; });
    var coordInput = el('input', 'ef-input ef-input-sm');
    coordInput.placeholder = 'Coords'; coordInput.value = ap.coords || '';
    coordInput.addEventListener('input', function () { ap.coords = this.value; });
    var delBtn = el('button', 'ef-btn ef-btn-sm ef-btn-danger', '✕');
    delBtn.addEventListener('click', function () {
      aimPoints.splice(i, 1);
      _renderAimPointsList(container, aimPoints);
    });
    row.appendChild(idInput); row.appendChild(nameInput);
    row.appendChild(coordInput); row.appendChild(delBtn);
    container.appendChild(row);
  });
}
