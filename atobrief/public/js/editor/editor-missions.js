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

  // Collect steerpoint IDs referenced by this mission
  var referencedSspIds = new Set();
  (m.steer_points || []).forEach(function (sp) {
    if (sp && sp.id) referencedSspIds.add(sp.id);
  });

  ato.missions.splice(index, 1);

  // v2.0: shared_steerpoints are in registry and have no flights[] list — no cleanup needed

  editorReRender();
}

// ── Mission form builder ─────────────────────────────────────
function _openMissionForm(title, m, onSave) {
  openEditorDialog(title, function (body) {
    var f = {};

    _buildIdentificationSection(body, m, f);
    _buildAircraftSection(body, m, f);
    _buildTimingSection(body, m, f);
    _buildUsmtfMissionSections(body, m, f);   // editor-missions-usmtf.js (ADR 0078)
    _buildTargetSection(body, m, title, onSave);
    _buildControlSection(body, m, f);
    _buildRefuelSection(body, m);
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
    options: ['CAP', 'BAI', 'CAS', 'SEAD', 'STRIKE', 'REFUELING', 'AEW',
              'OCA', 'DCA', 'DEAD', 'AI', 'ESCORT', 'FAC(A)',
              'RECCE', 'ANTISHIP', 'INTERCEPT', 'FERRY', 'TRANSPORT', 'OTHER'],
    required: true,
  });
  if (m.mission_type) f.mission_type.value = m.mission_type;
  f.unit             = editorField(body, 'Unit',              m.unit, { placeholder: 'e.g. 510vFS' });
  // Combine airfields and carriers for deploy/recovery/divert
  var afOpts = _registryOptions('airfields', function (id, af) { return id + (af.name ? ' \u2014 ' + af.name : ''); });
  var cvOpts = _registryOptions('carriers', function (id, cv) { return id + (cv.name ? ' \u2014 ' + cv.name : ''); });
  var locationOpts = afOpts.concat(cvOpts.filter(function (o) { return o.value !== ''; }));
  f.deploy   = editorField(body, 'Deploy',   m.deploy,   { type: 'select', options: locationOpts });
  f.recovery = editorField(body, 'Recovery', m.recovery, { type: 'select', options: locationOpts });
  f.divert   = editorField(body, 'Divert',   m.divert,   { type: 'select', options: locationOpts });
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
  // marshal_time, vul_start, vul_end are derived at load time from steerpoints (ip/ep/marshal type)
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
  var resolvedPrimary = ctrl.agency_id && agencyReg[ctrl.agency_id] ? agencyReg[ctrl.agency_id].primary_freq_mhz : null;

  f.ctrl_primary = editorField(body, 'Primary Freq (MHz)', resolvedPrimary || ctrl.primary_freq_mhz || '', {
    placeholder: '260.0',
    disabled: !!resolvedPrimary,
    hint: resolvedPrimary ? 'Read from registry' : undefined,
  });

  _buildUsmtfControlFields(body, ctrl, f);   // RIP, check-in, secondary freq

  // Update freq field when agency selection changes
  f.ctrl_agency_id.addEventListener('change', function () {
    var agId = this.value;
    var ag   = agId ? agencyReg[agId] : null;
    if (ag && ag.primary_freq_mhz) {
      f.ctrl_primary.value    = ag.primary_freq_mhz;
      f.ctrl_primary.disabled = true;
    } else {
      f.ctrl_primary.disabled = false;
    }
  });
}

function _buildRefuelSection(body, m) {
  editorSectionTitle(body, 'REFUEL');
  var refuels = (Array.isArray(m.refuel) ? m.refuel : []).map(function (r) { return Object.assign({}, r); });
  body._refuelEntriesEl   = el('div', 'ef-list-items');
  body._refuelEntriesMeta = [];

  function renderRefuelEntries() {
    body._refuelEntriesEl.innerHTML = '';
    body._refuelEntriesMeta = [];
    var tnkOpts = _registryOptions('tankers', function (id, t) { return id + (t.callsign ? ' \u2014 ' + t.callsign : ''); });
    refuels.forEach(function (ref, ri) {
      var wrap = el('div', 'ef-refuel-entry');
      var hdr  = el('div', 'ef-list-row');
      hdr.appendChild(el('span', 'ef-list-row-label', 'AAR ' + (ri + 1)));
      var delBtn = el('button', 'ef-btn ef-btn-sm ef-btn-del', '\u2715');
      delBtn.type = 'button';
      delBtn.addEventListener('click', (function (idx) {
        return function () { refuels.splice(idx, 1); renderRefuelEntries(); };
      })(ri));
      hdr.appendChild(delBtn);
      wrap.appendChild(hdr);
      var meta = {
        tanker_id: editorField(wrap, 'Tanker',     ref.tanker_id, { type: 'select', options: tnkOpts }),
        time_from: editorField(wrap, 'From (NET)', ref.time_from, { placeholder: '2143' }),
        time_to:   editorField(wrap, 'To (NLT)',   ref.time_to,   { placeholder: '2150' }),
        offload_klb: editorField(wrap, 'Offload (klb)', ref.offload_klb, { type: 'number', placeholder: '12.0' }),
        orig:      ref,
      };
      body._refuelEntriesMeta.push(meta);
      body._refuelEntriesEl.appendChild(wrap);
    });
  }

  renderRefuelEntries();
  body.appendChild(body._refuelEntriesEl);

  var addBtn = el('button', 'ef-btn ef-btn-add', '+ ADD REFUEL');
  addBtn.type = 'button';
  addBtn.addEventListener('click', function () { refuels.push({}); renderRefuelEntries(); });
  body.appendChild(addBtn);
}

function _collectRefuel(body) {
  var metas  = body._refuelEntriesMeta || [];
  var result = metas.map(function (meta) {
    var tid  = meta.tanker_id.value || undefined;
    var from = meta.time_from.value || undefined;
    var to   = meta.time_to.value   || undefined;
    var off  = parseFloat(meta.offload_klb.value);
    if (!tid && !from && !to) return null;
    // Merge onto the original entry so YAML-only keys survive an edit.
    var entry = Object.assign({}, meta.orig || {}, { tanker_id: tid, time_from: from, time_to: to });
    if (isNaN(off)) delete entry.offload_klb; else entry.offload_klb = off;
    Object.keys(entry).forEach(function (k) { if (entry[k] === undefined) delete entry[k]; });
    return entry;
  }).filter(Boolean);
  return result.length ? result : undefined;
}

function _buildSteerPointsSection(body, m) {
  editorSectionTitle(body, 'STEER POINTS');
  // Preserve the full steer_points array including registry ref entries.
  // Regular steer points are represented as { name, coords, altitude_ft?, time?, orbit? }.
  // Registry steerpoint refs are { id: '...', time?: '...' } — kept as-is.
  // Extra informational properties (aim_point_id, altitude_ft, name_ref, _x, _y, etc.)
  // are not editable in the UI but must be round-tripped so that saving the form does
  // not silently strip data produced by miztoyaml or manually added by the user.
  var steerPts = (m.steer_points || []).map(function (sp) {
    if (sp && sp.id) {
      // Preserve registry steerpoint reference; keep optional time field
      return sp.time ? { id: sp.id, time: sp.time } : { id: sp.id };
    }
    // Copy all properties so non-editable fields (aim_point_id, altitude_ft, name_ref,
    // _x, _y, special_type, …) survive the round-trip through the editor.
    var point = Object.assign({}, sp, {
      name:   sp.name   || '',
      coords: sp.coords || '',
    });
    if (sp.orbit) {
      point.orbit = Object.assign({}, sp.orbit);
    }
    return point;
  });
  body._steerPoints = steerPts;

  var spListEl = el('div', 'ef-list-items');
  _renderSteerPointsList(spListEl, steerPts);
  body.appendChild(spListEl);

  var addSpBtn = el('button', 'ef-btn ef-btn-add', '+ ADD INLINE POINT');
  addSpBtn.addEventListener('click', function () {
    steerPts.push({ name: '', coords: '' });
    body._steerPoints = steerPts;
    _renderSteerPointsList(spListEl, steerPts);
  });
  body.appendChild(addSpBtn);

  var addRefBtn = el('button', 'ef-btn ef-btn-add', '+ ADD REGISTRY REF');
  addRefBtn.title = 'Add a reference to a steerpoint in registry.steerpoints';
  addRefBtn.addEventListener('click', function () {
    var reg = editorEnsureRegistry();
    var sspList = reg.steerpoints || [];
    if (!sspList.length) {
      alert('No steerpoints defined in the registry yet. Add them via STEER PTS editor first.');
      return;
    }
    // Pick the first one not yet referenced — user can change it via the select
    var usedIds = steerPts.filter(function (s) { return s && s.id; }).map(function (s) { return s.id; });
    var unused = sspList.find(function (s) { return !usedIds.includes(s.id); }) || sspList[0];
    steerPts.push({ id: unused.id });
    body._steerPoints = steerPts;
    _renderSteerPointsList(spListEl, steerPts);
  });
  body.appendChild(addRefBtn);
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
  m.mission_number = rawMsn ? 'MSN' + rawMsn.replace(/^MSN/i, '') : undefined;
  m.callsign       = f.callsign.value      || undefined;
  m.mission_type   = f.mission_type.value  || undefined;
  m.unit           = f.unit.value          || undefined;
  m.deploy         = f.deploy.value        || undefined;
  m.recovery       = f.recovery.value      || undefined;
  m.divert         = f.divert.value        || undefined;

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

  if (f.ctrl_agency_id && (f.ctrl_agency_id.value || f.ctrl_primary.value)) {
    m.control = m.control || {};
    m.control.agency_id        = f.ctrl_agency_id.value || undefined;
    m.control.primary_freq_mhz = f.ctrl_primary.disabled ? undefined : (f.ctrl_primary.value || undefined);
  }

  // Refuel — v2.0 array; collect from dynamic list rendered in body
  m.refuel = _collectRefuel(body);
  _collectUsmtfMissionFields(f, m);

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
  m.callsign     = f.callsign.value     || undefined;
  m.mission_type = f.mission_type.value || undefined;
  m.unit         = f.unit.value         || undefined;
  m.deploy       = f.deploy.value       || undefined;
  m.recovery     = f.recovery.value     || undefined;
  m.divert       = f.divert.value       || undefined;

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
  // marshal_time, vul_start, vul_end are derived from steerpoints at load time

  // Targets
  var savedTargets = (body._targets || []).filter(function (t) {
    return t.target_id || t.tot_net || t.tos;
  });
  m.targets = savedTargets.length ? savedTargets : undefined;

  // Control
  if (f.ctrl_agency_id.value || f.ctrl_primary.value) {
    m.control = m.control || {};
    m.control.agency_id        = f.ctrl_agency_id.value || undefined;
    // Only save freq if it was manually entered (not resolved from registry)
    m.control.primary_freq_mhz = f.ctrl_primary.disabled ? undefined : (f.ctrl_primary.value || undefined);
  }

  // Refuel — v2.0: array of {tanker_id, time_from, time_to, offload_klb?}
  m.refuel = _collectRefuel(body);

  // USMTF ATO fields (package, IFF, datalink, vul, control extras)
  _collectUsmtfMissionFields(f, m);

  // Steer points: keep shared steerpoint refs as-is; keep regular pts that have
  // coordinates (named or unnamed).  Unnamed steerpoints (no name, has coords) are
  // valid route-shaping waypoints and must not be discarded.  Completely empty
  // placeholder rows (added by the UI but never filled in) are filtered out.
  var steerPts = (body._steerPoints || []).filter(function (sp) {
    if (sp && sp.id) return true; // always keep registry steerpoint refs
    return sp.coords || sp.name_ref;                // coords or named-location ref required
  });
  m.steer_points = steerPts.length ? steerPts : undefined;

  onSave(m);
}
