// ═══════════════════════════════════════════════════════════
// editor-registry.js — Registry CRUD editor
//
// Handles editing of all registry categories:
//   airfields, carriers, tankers, targets, reference_points,
//   control_agencies
//
// Each category follows the same pattern:
//   1. List items with edit/delete buttons
//   2. Open sub-dialog for add/edit with category-specific fields
//   3. Save → update STATE.pkg.registry → re-render
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Registry category definitions ────────────────────────────
// Maps category key → { label, tab, fields[] }
// fields: { key, label, type?, placeholder?, hint? }
var REGISTRY_CATEGORIES = {
  airfields: {
    label: 'AIRFIELDS', tab: 'AIRFIELDS',
    idLabel: 'ICAO',
    fields: [
      { key: 'name',         label: 'Name',         placeholder: 'e.g. Al Dhafra AB' },
      { key: 'coords',       label: 'Coordinates',  placeholder: "N24°14'36\" E054°27'07\"", coordPick: true },
      { key: 'elevation_ft', label: 'Elevation (ft)', type: 'number' },
    ],
  },
  carriers: {
    label: 'CARRIERS', tab: 'CARRIERS',
    idLabel: 'ID',
    fields: [
      { key: 'name',            label: 'Name',            placeholder: 'e.g. USS ROOSEVELT' },
      { key: 'callsign',        label: 'Callsign',        placeholder: 'e.g. ROUGH RIDER' },
      { key: 'deploy_coords',   label: 'Deploy Coords',   placeholder: "N24°30'00\" E059°15'00\"", coordPick: true },
      { key: 'recovery_coords', label: 'Recovery Coords',  placeholder: "N24°45'00\" E059°30'00\"", coordPick: true },
    ],
  },
  tankers: {
    label: 'TANKERS', tab: 'TANKERS',
    idLabel: 'ID',
    fields: [
      { key: 'callsign',           label: 'Callsign',           placeholder: 'e.g. ARCO4' },
      { key: 'ar_track',           label: 'AR Track',           placeholder: 'e.g. AR394' },
      { key: 'altitude',           label: 'Altitude',           placeholder: 'e.g. FL240' },
      { key: 'tacan',              label: 'TACAN',              placeholder: 'e.g. 39X' },
      { key: 'tacan_role',         label: 'TACAN Role',         placeholder: 'e.g. REFUELING' },
      { key: 'freq_mhz',           label: 'Freq (MHz)',         type: 'number', placeholder: '251.0' },
      { key: 'speed_kts',          label: 'Speed (kts)',        type: 'number', placeholder: '300' },
      { key: 'orbit_anchor_coords', label: 'Orbit Anchor',     placeholder: "N24°30'00\" E055°30'00\"", coordPick: true },
      { key: 'orbit_heading_deg',  label: 'Orbit Heading (°)', type: 'number', placeholder: '270' },
      { key: 'orbit_leg_nm',       label: 'Orbit Leg (NM)',    type: 'number', placeholder: '20' },
      { key: 'orbit_width_nm',     label: 'Orbit Width (NM)',  type: 'number', placeholder: '5' },
    ],
  },
  targets: {
    label: 'TARGETS', tab: 'TARGETS',
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
    label: 'REFERENCE POINTS', tab: 'REF PTS',
    isList: true,
    fields: [
      { key: 'name',     label: 'Name',     placeholder: 'e.g. COYOTE' },
      { key: 'type',     label: 'Type',     type: 'select', options: [{ value: '', label: '— select type —' }, 'bullseye', 'marshal'] },
      { key: 'coords',   label: 'Coordinates', placeholder: "N26°51'19\" E056°21'37\"", coordPick: true },
      { key: 'altitude', label: 'Altitude', placeholder: 'FL250' },
    ],
  },
  control_agencies: {
    label: 'CONTROL AGENCIES', tab: 'CTRL',
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
    label: 'FREQUENCIES', tab: 'FREQS',
    isList: true,
    idField: 'freq_mhz',
    fields: [
      { key: 'freq_mhz',  label: 'Freq (MHz)', type: 'number', placeholder: '305.0' },
      { key: 'callsign',  label: 'Callsign',   placeholder: 'e.g. GUARD' },
      { key: 'role',      label: 'Role',       placeholder: 'e.g. Emergency' },
    ],
  },
};

// ── Active category for back-navigation (persists across dialog open/close) ──
var _registryActiveCat = null;

// ── Open the registry list dialog (tabbed — one category at a time) ──
function openRegistryEditor() {
  var activeCat = _registryActiveCat || Object.keys(REGISTRY_CATEGORIES)[0];
  _registryActiveCat = null; // consume it

  openEditorDialog('REGISTRY', function (body) {
    var reg = (STATE.pkg && STATE.pkg.registry) || {};

    // Tab bar — one button per category
    var tabBar = el('div', 'ef-tab-bar');
    body.appendChild(tabBar);

    // Content area — filled by showCategory()
    var catContent = el('div', 'ef-cat-content');
    body.appendChild(catContent);

    function showCategory(catKey) {
      // Update active tab button
      tabBar.querySelectorAll('.ef-tab-btn').forEach(function (b) {
        b.classList.toggle('ef-tab-active', b.dataset.cat === catKey);
      });

      catContent.innerHTML = '';
      var cat = REGISTRY_CATEGORIES[catKey];
      var raw = reg[catKey];

      if (cat.isList) {
        var items   = Array.isArray(raw) ? raw : [];
        var idField = cat.idField || 'name';
        var ids     = items.map(function (i) { return String(i[idField]); });
        editorListBlock(catContent, cat.label, ids, function (container, id) {
          editorItemRow(container, id,
            function () { _registryActiveCat = catKey; editRegistryItem(catKey, id); },
            function () { _registryActiveCat = catKey; deleteRegistryItem(catKey, id); }
          );
        }, function () { _registryActiveCat = catKey; addRegistryItem(catKey); });
      } else {
        var items = raw || {};
        var ids   = Object.keys(items);
        editorListBlock(catContent, cat.label, ids, function (container, id) {
          var item  = items[id];
          var label = id + (item.name ? ' \u2014 ' + item.name : '');
          editorItemRow(container, label,
            function () { _registryActiveCat = catKey; editRegistryItem(catKey, id); },
            function () { _registryActiveCat = catKey; deleteRegistryItem(catKey, id); }
          );
        }, function () { _registryActiveCat = catKey; addRegistryItem(catKey); });
      }
    }

    // Build tab buttons
    Object.keys(REGISTRY_CATEGORIES).forEach(function (catKey) {
      var cat = REGISTRY_CATEGORIES[catKey];
      var btn = el('button', 'ef-tab-btn ef-btn', cat.tab);
      btn.dataset.cat = catKey;
      btn.addEventListener('click', function () { showCategory(catKey); });
      tabBar.appendChild(btn);
    });

    showCategory(activeCat);
  }, function () {
    // no-op on save for list view — individual items save themselves
  });
}

// ── Edit a single registry item ──────────────────────────────
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
    var backBtn = el('button', 'ef-btn ef-btn-back', 'BACK TO REGISTRY');
    backBtn.addEventListener('click', function () { _registryActiveCat = catKey; openRegistryEditor(); });
    body.appendChild(backBtn);

    var fields = {};

    if (!cat.isList) {
      // ID field (read-only for existing items)
      editorField(body, cat.idLabel, id, { disabled: true, hint: 'ID cannot be changed' });
    }

    cat.fields.forEach(function (f) {
      var isIdField = cat.isList && f.key === idField;
      fields[f.key] = editorField(body, f.label, item[f.key] != null ? item[f.key] : '', {
        type:        f.type || 'text',
        placeholder: f.placeholder || '',
        options:     f.options,
        coordPick:   f.coordPick || false,
        disabled:    isIdField,
        hint:        isIdField ? (f.label + ' cannot be changed here') : undefined,
      });
    });

    // Target aim points sub-editor
    if (catKey === 'targets') {
      _buildAimPointsEditor(body, item);
    }

    // Store fields reference for save
    body._editorFields = fields;
    body._editId = id;
    body._editItem = item;
    body._catKey = catKey;
  }, function () {
    _saveRegistryItem(catKey);
  });
}

// ── Add a new registry item ──────────────────────────────────
function addRegistryItem(catKey) {
  var cat = REGISTRY_CATEGORIES[catKey];

  openEditorDialog('ADD ' + cat.label.slice(0, -1), function (body) {
    var backBtn = el('button', 'ef-btn ef-btn-back', 'BACK TO REGISTRY');
    backBtn.addEventListener('click', function () { _registryActiveCat = catKey; openRegistryEditor(); });
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
        placeholder: f.placeholder || '',
        options:     f.options,
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

// ── Delete a registry item ───────────────────────────────────
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

  // Cascade: remove all references to the deleted item in missions & global_control
  _cascadeRegistryDelete(catKey, id);

  editorReRender();
  openRegistryEditor(); // refresh list
}

// ── Cascade deletion: clear references to a deleted registry item ─
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
    // Clear global_control reference
    var gc = ato.global_control;
    if (gc && gc.agency_id === id) {
      gc.agency_id = undefined;
      gc.controlling_unit = undefined;
      gc.aircraft_type = undefined;
      gc.primary_freq_mhz = undefined;
    }
    // Clear per-mission control references
    missions.forEach(function (m) {
      if (m.control && m.control.agency_id === id) delete m.control;
    });
  } else if (catKey === 'reference_points') {
    // Clear bullseye if it references the deleted point
    var globalControl = ato.global_control;
    if (globalControl && globalControl.bullseye && typeof globalControl.bullseye === 'object' && globalControl.bullseye.name === id) {
      globalControl.bullseye = undefined;
    }
  }
}

// ── Save registry item (shared by add/edit) ──────────────────
function _saveRegistryItem(catKey) {
  var body   = document.getElementById('editorBody');
  var fields = body._editorFields;
  var reg    = editorEnsureRegistry();
  var cat    = REGISTRY_CATEGORIES[catKey];
  var idField = cat.idField || 'name';

  // Build item from form fields
  var item = body._editItem ? Object.assign({}, body._editItem) : {};
  var preserveNull = catKey === 'frequencies';  // keep explicit nulls for freq metadata
  Object.keys(fields).forEach(function (k) {
    var val = fields[k].value;
    if (val === '' || val == null) {
      if (preserveNull) {
        item[k] = null;
      } else {
        delete item[k];
      }
    } else if (fields[k].type === 'number' || fields[k].getAttribute('data-numtype') === 'number') {
      item[k] = parseFloat(val);
    } else {
      item[k] = val;
    }
  });

  // Save aim points for targets
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
