// ═══════════════════════════════════════════════════════════
// editor-core.js — Editor framework: state, dialog, form helpers, export
//
// Provides the shared infrastructure for all section editors.
// Keeps editor logic isolated from the read-only view layer.
//
// Public API:
//   EDITOR              — editor state object
//   toggleEditMode()    — enable / disable edit mode
//   openEditorDialog()  — open the generic editor panel
//   closeEditorDialog() — close without saving
//   editorField()       — create a labelled form field
//   editorListBlock()   — create a collapsible list with add/remove
//   editorReRender()    — re-resolve registry + re-render all views
//   exportPackageYaml() — download current package as YAML
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Editor state ─────────────────────────────────────────────
const EDITOR = {
  active:   false,   // true when edit mode is on
  _onSave:  null,    // callback for current dialog
  _coordPickCb: null, // callback for map coordinate picker
};

// ── Edit mode toggle ─────────────────────────────────────────
function toggleEditMode() {
  if (!STATE.pkg) return;
  EDITOR.active = !EDITOR.active;
  document.documentElement.classList.toggle('edit-mode', EDITOR.active);
  const btn = document.getElementById('editModeBtn');
  if (btn) btn.classList.toggle('active', EDITOR.active);
}

// ── Editor dialog ────────────────────────────────────────────
// Opens a full-panel dialog.  buildFn(body) populates the form;
// onSave() is called when the user clicks SAVE.
function openEditorDialog(title, buildFn, onSave) {
  const overlay = document.getElementById('editorOverlay');
  const titleEl = document.getElementById('editorTitle');
  const body    = document.getElementById('editorBody');
  if (!overlay || !body) return;

  titleEl.textContent = title;
  body.innerHTML = '';
  // Clear any stale per-dialog state left from a previous form
  // (e.g. _isNew set by addRegistryItem that would falsely trigger
  // "ID IS REQUIRED" if the user then opens an edit dialog).
  delete body._isNew;
  delete body._editId;
  delete body._editItem;
  delete body._idInput;
  delete body._editorFields;
  delete body._catKey;
  EDITOR._onSave = onSave;
  buildFn(body);
  overlay.style.display = 'flex';
}

function closeEditorDialog() {
  const overlay = document.getElementById('editorOverlay');
  if (overlay) overlay.style.display = 'none';
  EDITOR._onSave = null;
}

function saveEditorDialog() {
  if (typeof EDITOR._onSave === 'function') {
    EDITOR._onSave();
  }
  closeEditorDialog();
}

// ── Form field builders ──────────────────────────────────────
// Each returns the input/select element so callers can read .value.

// Text input field
function editorField(parent, label, value, opts) {
  opts = opts || {};
  const wrap = el('div', 'ef-group');
  var labelEl = el('label', 'ef-label');
  labelEl.textContent = label;
  if (opts.required) {
    labelEl.appendChild(el('span', 'ef-required', ' *'));
  }
  wrap.appendChild(labelEl);

  let input;
  if (opts.type === 'textarea') {
    input = document.createElement('textarea');
    input.className = 'ef-input ef-textarea';
    input.rows = opts.rows || 3;
  } else if (opts.type === 'select') {
    input = document.createElement('select');
    input.className = 'ef-input';
    (opts.options || []).forEach(function (o) {
      const opt = document.createElement('option');
      if (typeof o === 'object') { opt.value = o.value; opt.textContent = o.label; }
      else { opt.value = o; opt.textContent = o; }
      input.appendChild(opt);
    });
  } else {
    input = document.createElement('input');
    input.type = opts.type || 'text';
    input.className = 'ef-input';
  }

  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (value != null) input.value = String(value);
  if (opts.disabled)  input.disabled = true;

  if (opts.coordPick) {
    // Wrap input + pick button in a flex row
    var inputRow = el('div', 'ef-coord-row');
    inputRow.appendChild(input);
    var pickBtn = el('button', 'ef-btn ef-btn-sm ef-btn-pick', '📍');
    pickBtn.title = 'Pick from map';
    pickBtn.type = 'button';
    pickBtn.addEventListener('click', function () {
      _startCoordPick(input);
    });
    inputRow.appendChild(pickBtn);
    wrap.appendChild(inputRow);
  } else {
    wrap.appendChild(input);
  }

  if (opts.hint) wrap.appendChild(el('div', 'ef-hint', opts.hint));
  parent.appendChild(wrap);
  return input;
}

// ── Map coordinate picker ────────────────────────────────────
// Minimises the editor, switches to the MAP tab, sets the map to
// "pick" mode.  On click, the coordinate is written into the
// target input and the editor is restored.
function _startCoordPick(targetInput) {
  if (!STATE.pkg) return;

  // Hide editor overlay but don't close it (preserve form state)
  var overlay = document.getElementById('editorOverlay');
  if (overlay) overlay.style.display = 'none';

  // Remember which tab was active so we can restore later
  var savedTab = STATE.currentTab;
  showTab('map');

  // Set pick callback — map-render.js checks EDITOR._coordPickCb
  EDITOR._coordPickCb = function (lat, lon) {
    EDITOR._coordPickCb = null;
    targetInput.value = fmtCoordDM(lat, lon);
    // Trigger input event so any bound listeners fire
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    // Restore editor overlay and previous tab
    showTab(savedTab);
    if (overlay) overlay.style.display = 'flex';
  };
}

// Cancel coordinate pick mode (called if the editor is closed)
function _cancelCoordPick() {
  EDITOR._coordPickCb = null;
}

// Section divider inside the editor form
function editorSectionTitle(parent, title) {
  parent.appendChild(el('div', 'ef-section-title', title));
}

// A list block with header, items, and an ADD button.
// itemBuildFn(container, item, index) renders one item.
// Returns { container } so the caller can refresh.
function editorListBlock(parent, title, items, itemBuildFn, onAdd) {
  const block = el('div', 'ef-list-block');
  const hdr   = el('div', 'ef-list-header');
  hdr.appendChild(el('span', 'ef-list-title', title + ' (' + items.length + ')'));

  if (onAdd) {
    const addBtn = el('button', 'ef-btn ef-btn-add', '+ ADD');
    addBtn.addEventListener('click', onAdd);
    hdr.appendChild(addBtn);
  }

  block.appendChild(hdr);

  const container = el('div', 'ef-list-items');
  items.forEach(function (item, i) {
    itemBuildFn(container, item, i);
  });
  block.appendChild(container);

  parent.appendChild(block);
  return { container: container };
}

// Inline item row with edit/delete buttons
function editorItemRow(parent, label, onEdit, onDelete) {
  const row = el('div', 'ef-item-row');
  row.appendChild(el('span', 'ef-item-label', label));
  const btns = el('div', 'ef-item-btns');

  if (onEdit) {
    const editBtn = el('button', 'ef-btn ef-btn-sm', 'EDIT');
    editBtn.addEventListener('click', onEdit);
    btns.appendChild(editBtn);
  }
  if (onDelete) {
    const delBtn = el('button', 'ef-btn ef-btn-sm ef-btn-danger', 'DEL');
    delBtn.addEventListener('click', onDelete);
    btns.appendChild(delBtn);
  }

  row.appendChild(btns);
  parent.appendChild(row);
}

// ── Re-render after edits ────────────────────────────────────
// Re-runs the full load pipeline so registry references are resolved,
// then re-renders all views.  Preserves the current tab and selection.
// syncFrom — optional key of the section that was just saved ('ato', 'aco', …).
//   When provided its operation/ato_day values are treated as canonical and
//   propagated to all other sections so the header bar and every view stay
//   consistent.  Callers that don't touch operation/ato_day can omit it.
function editorReRender(syncFrom) {
  if (!STATE.pkg) return;

  // Sync shared header fields across all sections before re-render.
  _syncHeaders(syncFrom);

  var savedTab = STATE.currentTab;
  var savedIdx = STATE.selectedIdx;

  // Rebuild a clean source object from current pkg, stripping internal fields
  var source = editorCleanPkg(STATE.pkg);
  loadPackage_obj(source);

  // Restore the previously selected mission detail panel.
  // selectMission() toggles closed if the same index is already selected,
  // so we reset to -1 first to ensure it opens rather than closing.
  if (savedIdx >= 0 && STATE.pkg && STATE.pkg.ato &&
      STATE.pkg.ato.missions && savedIdx < STATE.pkg.ato.missions.length) {
    STATE.selectedIdx = -1;
    selectMission(savedIdx);
  }

  showTab(savedTab);

  // If presenter in a session, broadcast the updated package
  if (SESSION && SESSION.role === 'presenter' && SESSION.connected && SESSION.socket) {
    var yamlText = jsyaml.dump(source, { lineWidth: -1, noRefs: true });
    SESSION.socket.emit('package-loaded', yamlText);
  }
}

// ── Sync shared header fields ────────────────────────────────
// Propagates operation / ato_day so all sections and the top-level
// header stay consistent after a section edit.
//
// syncFrom — key of the section that was just saved.  That section's
//   values are treated as authoritative and written to every other
//   section and to pkg.header.  When omitted (e.g. mission / registry
//   edits that don't touch these fields) we fall back to first-non-null
//   across all sections and only update the header.
//
// Note: sections use 'ato_day' while header uses 'ato_date' — this is
// the existing naming convention in the data model (see loadPackage_obj).
function _syncHeaders(syncFrom) {
  var pkg = STATE.pkg;
  if (!pkg) return;

  var SECTIONS = ['ato', 'aco', 'spins', 'comms', 'weather'];
  var operation = null;
  var propagateToSections = false;

  if (syncFrom && pkg[syncFrom]) {
    // Use the just-saved section as the single source of truth for operation
    var src = pkg[syncFrom];
    operation = src.operation || null;
    propagateToSections = true;
  } else {
    // Fallback: first non-null operation across all sections
    SECTIONS.forEach(function (key) {
      var sec = pkg[key];
      if (!sec) return;
      if (!operation && sec.operation) operation = sec.operation;
    });
  }

  // ato_date is canonical in header — set directly by the Times editor.
  // No further action needed here; loadPackage_obj propagates it to sections
  // in-memory for display after each re-render.

  // Always update the top-level header
  if (!pkg.header) pkg.header = {};
  if (operation) pkg.header.operation = operation;

  // When saving a section editor, push operation to every other section
  // so the header bar shows the updated text.  ato_day is NOT propagated
  // to sections — header.ato_date is the single canonical source.
  if (propagateToSections) {
    SECTIONS.forEach(function (key) {
      var sec = pkg[key];
      if (!sec) return;
      if (operation) sec.operation = operation;
    });
  }
}

// ── Clean package for export ─────────────────────────────────
// Strips internal fields (prefixed with _) added during resolution.
function editorCleanPkg(pkg) {
  if (pkg == null || typeof pkg !== 'object') return pkg;
  if (Array.isArray(pkg)) return pkg.map(editorCleanPkg);

  var clean = {};
  Object.keys(pkg).forEach(function (k) {
    if (k.charAt(0) === '_') return;  // skip internal fields
    if (k === 'ato_day') return;      // ato_day lives only in header.ato_date
    clean[k] = editorCleanPkg(pkg[k]);
  });

  // Strip auto-copied ingame_start_local so re-resolution can re-derive it
  if (clean.ingame_start_time && clean.ingame_start_local) {
    delete clean.ingame_start_local;
  }

  return clean;
}

// ── Export as YAML ───────────────────────────────────────────
function exportPackageYaml() {
  if (!STATE.pkg) { showToast('NO PACKAGE LOADED', 'error'); return; }

  var fileName = prompt('Enter file name:', 'package.yaml');
  if (!fileName) return; // cancelled
  // Ensure .yaml extension (strip any existing extension first)
  fileName = fileName.replace(/\.[^.]+$/, '') + '.yaml';

  var clean    = editorCleanPkg(STATE.pkg);
  var yamlText = jsyaml.dump(clean, { lineWidth: -1, noRefs: true, sortKeys: false });
  var blob     = new Blob([yamlText], { type: 'text/yaml' });
  var url      = URL.createObjectURL(blob);

  var a = document.createElement('a');
  a.href     = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Ensure section exists ────────────────────────────────────
// Initialises a top-level section (ato, aco, spins, comms, weather)
// if it doesn't already exist.
function editorEnsureSection(key) {
  if (!STATE.pkg) STATE.pkg = {};
  if (!STATE.pkg[key]) STATE.pkg[key] = {};
  return STATE.pkg[key];
}

function editorEnsureRegistry() {
  if (!STATE.pkg) STATE.pkg = {};
  if (!STATE.pkg.registry) STATE.pkg.registry = {};
  return STATE.pkg.registry;
}
