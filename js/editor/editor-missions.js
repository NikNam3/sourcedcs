// ═══════════════════════════════════════════════════════════
// editor-missions.js — Mission CRUD editor
//
// Add, edit, and delete missions from the ATO.
// Each mission is edited through a multi-section form that
// covers identification, aircraft, target, timing, control,
// refuel, and steer points.
//
// Target sub-dialog and steer-point renderer live in
// editor-missions-targets.js (kept separate for file size).
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Registry dropdown helper ─────────────────────────────────
function _registryOptions(catKey, labelFn) {
  var reg = (STATE.pkg && STATE.pkg.registry && STATE.pkg.registry[catKey]) || {};
  var opts = [{ value: '', label: '— none —' }];
  Object.keys(reg).forEach(function (id) {
    var item = reg[id];
    var label = labelFn ? labelFn(id, item) : id;
    opts.push({ value: id, label: label });
  });
  return opts;
}

// ── Open mission editor for an existing mission ──────────────
function editMission(index) {
  var ato = editorEnsureSection('ato');
  if (!ato.missions) ato.missions = [];
  var m = ato.missions[index];
  if (!m) return;

  _openMissionForm('EDIT MISSION \u2014 ' + (m.callsign || '#' + index), m, function (updated) {
    ato.missions[index] = updated;
    editorReRender();
  });
}

// ── Add a new mission ────────────────────────────────────────
function addMission() {
  var ato = editorEnsureSection('ato');
  if (!ato.missions) ato.missions = [];

  _openMissionForm('ADD MISSION', {}, function (updated) {
    ato.missions.push(updated);
    editorReRender();
  });
}

// ── Delete a mission ─────────────────────────────────────────
function deleteMission(index) {
  var ato = STATE.pkg && STATE.pkg.ato;
  if (!ato || !ato.missions) return;
  var m = ato.missions[index];
  if (!confirm('Delete mission ' + (m.callsign || '#' + index) + '?')) return;

  ato.missions.splice(index, 1);
  editorReRender();
}

// ── Mission form builder ─────────────────────────────────────
function _openMissionForm(title, m, onSave) {
  openEditorDialog(title, function (body) {
    var f = {};

    _buildIdentificationSection(body, m, f);
    _buildAircraftSection(body, m, f);
    _buildTimingSection(body, m, f);
    _buildTargetSection(body, m, title, onSave);
    _buildControlSection(body, m, f);
    _buildRefuelSection(body, m, f);
    _buildSteerPointsSection(body, m);

    body._msnFields = f;
    body._msnOriginal = m;
  }, function () {
    _saveMissionFromForm(onSave);
  });
}

function _buildIdentificationSection(body, m, f) {
  editorSectionTitle(body, 'IDENTIFICATION');
  var msnNum = (m.mission_number || '').replace(/^MSN/i, '');
  f.mission_number = editorField(body, 'Mission Number', msnNum, { placeholder: 'e.g. 3266' });
  f.callsign       = editorField(body, 'Callsign',       m.callsign,       { placeholder: 'e.g. FALCON5', required: true });
  f.mission_type   = editorField(body, 'Mission Type',    m.mission_type,   {
    type: 'select',
    options: ['CAP', 'BAI', 'CAS', 'SEAD', 'STRIKE', 'REFUELING',
              'OCA', 'DCA', 'DEAD', 'AI', 'ESCORT', 'FAC(A)',
              'RECCE', 'ANTISHIP', 'INTERCEPT', 'FERRY', 'TRANSPORT', 'OTHER'],
    required: true,
  });
  if (m.mission_type) f.mission_type.value = m.mission_type;
  f.unit             = editorField(body, 'Unit',              m.unit, { placeholder: 'e.g. 510vFS' });
  var afOpts = _registryOptions('airfields', function (id, af) { return id + (af.name ? ' \u2014 ' + af.name : ''); });
  // Combine airfields and carriers for deploy/recovery location
  var cvOpts = _registryOptions('carriers', function (id, cv) { return id + (cv.name ? ' \u2014 ' + cv.name : ''); });
  var locationOpts = afOpts.concat(cvOpts.filter(function (o) { return o.value !== ''; }));
  f.home_base_icao   = editorField(body, 'Home Base', m.home_base_icao, { type: 'select', options: afOpts });
  f.deploy_location  = editorField(body, 'Deploy Location', m.deploy_location_icao, { type: 'select', options: locationOpts });
  f.aar_location     = editorField(body, 'Recovery Location', m.aar_location_icao, { type: 'select', options: locationOpts });
}

function _buildAircraftSection(body, m, f) {
  editorSectionTitle(body, 'AIRCRAFT');
  var ac = m.aircraft || {};
  f.ac_count  = editorField(body, 'Count',   ac.count,  { type: 'number', placeholder: '2', required: true });
  f.ac_type   = editorField(body, 'Type',    ac.type,   { placeholder: 'e.g. F16C', required: true });
  f.ac_loadout = editorField(body, 'Loadout', ac.loadout, { placeholder: 'e.g. 501+' });
}

function _buildTimingSection(body, m, f) {
  editorSectionTitle(body, 'TIMING');
  f.takeoff_time  = editorField(body, 'Takeoff Time',  m.takeoff_time,  { placeholder: '2000' });
  f.recovery_time = editorField(body, 'Recovery Time', m.recovery_time, { placeholder: '2300' });
  f.vul_start     = editorField(body, 'VUL Start',     m.vul_start,     { placeholder: '2040' });
  f.vul_end       = editorField(body, 'VUL End',       m.vul_end,       { placeholder: '2115' });
}

function _buildTargetSection(body, m, msnTitle, onSave) {
  editorSectionTitle(body, 'TARGETS');
  var targets = (m.targets || []).map(function (t) { return Object.assign({}, t); });
  body._targets = targets;

  var listEl = el('div', 'ef-list-items');
  _renderTargetsList(listEl, targets, msnTitle, onSave);
  body.appendChild(listEl);

  var addTgtBtn = el('button', 'ef-btn ef-btn-add', '+ ADD TARGET');
  addTgtBtn.type = 'button';
  addTgtBtn.addEventListener('click', function () {
    targets.push({});
    _editTarget(targets, targets.length - 1, msnTitle, onSave);
  });
  body.appendChild(addTgtBtn);
}

function _buildControlSection(body, m, f) {
  editorSectionTitle(body, 'CONTROL');
  var ctrl = m.control || {};
  var ctrlOpts = _registryOptions('control_agencies', function (id, ag) { return id + (ag.callsign ? ' \u2014 ' + ag.callsign : ''); });
  f.ctrl_agency_id = editorField(body, 'Control Agency', ctrl.agency_id, { type: 'select', options: ctrlOpts });

  // Resolve freq from registry when agency is selected
  var agencyReg = (STATE.pkg && STATE.pkg.registry && STATE.pkg.registry.control_agencies) || {};
  var resolvedPrimary   = ctrl.agency_id && agencyReg[ctrl.agency_id] ? agencyReg[ctrl.agency_id].primary_freq_mhz   : null;
  var resolvedSecondary = ctrl.agency_id && agencyReg[ctrl.agency_id] ? agencyReg[ctrl.agency_id].secondary_freq_mhz : null;

  f.ctrl_primary   = editorField(body, 'Primary Freq (MHz)',   resolvedPrimary || ctrl.primary_freq_mhz || '', {
    placeholder: '260.0',
    disabled: !!resolvedPrimary,
    hint: resolvedPrimary ? 'Read from registry' : undefined,
  });
  f.ctrl_secondary = editorField(body, 'Secondary Freq (MHz)', resolvedSecondary || ctrl.secondary_freq_mhz || '', {
    placeholder: '134.0',
    disabled: !!resolvedSecondary,
    hint: resolvedSecondary ? 'Read from registry' : undefined,
  });

  // Update freq fields when agency selection changes
  f.ctrl_agency_id.addEventListener('change', function () {
    var agId = this.value;
    var ag   = agId ? agencyReg[agId] : null;
    if (ag && ag.primary_freq_mhz) {
      f.ctrl_primary.value    = ag.primary_freq_mhz;
      f.ctrl_primary.disabled = true;
    } else {
      f.ctrl_primary.disabled = false;
    }
    if (ag && ag.secondary_freq_mhz) {
      f.ctrl_secondary.value    = ag.secondary_freq_mhz;
      f.ctrl_secondary.disabled = true;
    } else {
      f.ctrl_secondary.disabled = false;
    }
  });
}

function _buildRefuelSection(body, m, f) {
  editorSectionTitle(body, 'REFUEL');
  var ref = m.refuel || {};
  var tnkOpts = _registryOptions('tankers', function (id, t) { return id + (t.callsign ? ' \u2014 ' + t.callsign : ''); });
  f.ref_tanker_id = editorField(body, 'Tanker', ref.tanker_id, { type: 'select', options: tnkOpts });
  f.ref_net = editorField(body, 'AAR NET', ref.not_earlier_than, { placeholder: '2143' });
  f.ref_nlt = editorField(body, 'AAR NLT', ref.not_later_than,  { placeholder: '2150' });
}

function _buildSteerPointsSection(body, m) {
  editorSectionTitle(body, 'STEER POINTS');
  var steerPts = (m.steer_points || []).map(function (sp) {
    return { name: sp.name || '', coords: sp.coords || '' };
  });
  body._steerPoints = steerPts;

  var spListEl = el('div', 'ef-list-items');
  _renderSteerPointsList(spListEl, steerPts);
  body.appendChild(spListEl);

  var addSpBtn = el('button', 'ef-btn ef-btn-add', '+ ADD STEER POINT');
  addSpBtn.addEventListener('click', function () {
    steerPts.push({ name: '', coords: '' });
    body._steerPoints = steerPts;
    _renderSteerPointsList(spListEl, steerPts);
  });
  body.appendChild(addSpBtn);
}

// ── Snapshot mission form without saving to state ────────────
// Called before navigating to the target sub-dialog so we can
// restore the rest of the form when the user presses BACK.
function _collectMissionDraft() {
  var body = document.getElementById('editorBody');
  var f = body._msnFields;
  if (!f) return null;
  var m = Object.assign({}, body._msnOriginal || {});

  var rawMsn = (f.mission_number.value || '').trim();
  m.mission_number       = rawMsn ? 'MSN' + rawMsn.replace(/^MSN/i, '') : undefined;
  m.callsign             = f.callsign.value || undefined;
  m.mission_type         = f.mission_type.value || undefined;
  m.unit                 = f.unit.value || undefined;
  m.home_base_icao       = f.home_base_icao.value || undefined;
  m.deploy_location_icao = f.deploy_location.value || undefined;
  m.aar_location_icao    = f.aar_location.value || undefined;

  var acCount = parseInt(f.ac_count.value);
  if (f.ac_type.value || !isNaN(acCount)) {
    m.aircraft = {
      count:   isNaN(acCount) ? undefined : acCount,
      type:    f.ac_type.value || undefined,
      loadout: f.ac_loadout.value || undefined,
    };
  }

  m.takeoff_time  = f.takeoff_time.value || undefined;
  m.recovery_time = f.recovery_time.value || undefined;
  m.vul_start     = f.vul_start.value || undefined;
  m.vul_end       = f.vul_end.value || undefined;

  if (f.ctrl_agency_id && (f.ctrl_agency_id.value || f.ctrl_primary.value)) {
    m.control = m.control || {};
    m.control.agency_id          = f.ctrl_agency_id.value || undefined;
    m.control.primary_freq_mhz   = f.ctrl_primary.disabled   ? undefined : (f.ctrl_primary.value || undefined);
    m.control.secondary_freq_mhz = f.ctrl_secondary.disabled ? undefined : (f.ctrl_secondary.value || undefined);
  }

  if (f.ref_tanker_id && f.ref_tanker_id.value) {
    m.refuel = m.refuel || {};
    m.refuel.tanker_id        = f.ref_tanker_id.value || undefined;
    m.refuel.not_earlier_than = f.ref_net.value || undefined;
    m.refuel.not_later_than   = f.ref_nlt.value || undefined;
  }

  // Preserve live arrays so edits made in sub-dialogs are reflected
  m.targets      = body._targets || [];
  m.steer_points = body._steerPoints || [];
  return m;
}

// ── Collect mission form values and invoke save callback ─────
function _saveMissionFromForm(onSave) {
  var body = document.getElementById('editorBody');
  var f = body._msnFields;
  var m = Object.assign({}, body._msnOriginal);

  // Identification
  var rawMsn = (f.mission_number.value || '').trim();
  m.mission_number = rawMsn ? 'MSN' + rawMsn.replace(/^MSN/i, '') : undefined;
  m.callsign             = f.callsign.value || undefined;
  m.mission_type         = f.mission_type.value || undefined;
  m.unit                 = f.unit.value || undefined;
  m.home_base_icao       = f.home_base_icao.value || undefined;
  m.deploy_location_icao = f.deploy_location.value || undefined;
  m.aar_location_icao    = f.aar_location.value || undefined;

  // Aircraft
  var acCount = parseInt(f.ac_count.value);
  if (f.ac_type.value || !isNaN(acCount)) {
    m.aircraft = {
      count:   isNaN(acCount) ? undefined : acCount,
      type:    f.ac_type.value || undefined,
      loadout: f.ac_loadout.value || undefined,
    };
  }

  // Timing
  m.takeoff_time  = f.takeoff_time.value || undefined;
  m.recovery_time = f.recovery_time.value || undefined;
  m.vul_start     = f.vul_start.value || undefined;
  m.vul_end       = f.vul_end.value || undefined;

  // Targets
  var savedTargets = (body._targets || []).filter(function (t) {
    return t.location || t.target_id || t.tot_net || t.tos;
  });
  m.targets = savedTargets.length ? savedTargets : undefined;

  // Control
  if (f.ctrl_agency_id.value || f.ctrl_primary.value) {
    m.control = m.control || {};
    m.control.agency_id          = f.ctrl_agency_id.value || undefined;
    // Only save freq if it was manually entered (not resolved from registry)
    m.control.primary_freq_mhz   = f.ctrl_primary.disabled   ? undefined : (f.ctrl_primary.value || undefined);
    m.control.secondary_freq_mhz = f.ctrl_secondary.disabled ? undefined : (f.ctrl_secondary.value || undefined);
  }

  // Refuel
  if (f.ref_tanker_id.value) {
    m.refuel = m.refuel || {};
    m.refuel.tanker_id         = f.ref_tanker_id.value || undefined;
    m.refuel.not_earlier_than  = f.ref_net.value || undefined;
    m.refuel.not_later_than    = f.ref_nlt.value || undefined;
  }

  // Steer points (require both name and coords)
  var steerPts = (body._steerPoints || []).filter(function (sp) { return sp.name && sp.coords; });
  m.steer_points = steerPts.length ? steerPts : undefined;

  onSave(m);
}
