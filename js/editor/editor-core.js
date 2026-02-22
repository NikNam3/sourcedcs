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
function editorReRender() {
  if (!STATE.pkg) return;

  // Sync shared header fields across all sections before re-render.
  // If any section has operation or ato_day, propagate to all others.
  _syncHeaders();

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
// Propagates operation/ato_day to all sections so they stay consistent.
// The header is the single authoritative source of truth; section editors
// write to STATE.pkg.header directly when saving, so the value is stable
// across re-renders.  Sections without a header (old-style packages) still
// work: the first non-null section value is collected as a fallback.
function _syncHeaders() {
  var pkg = STATE.pkg;
  if (!pkg) return;

  var sections = ['ato', 'aco', 'spins', 'comms', 'weather'];
  // Note: sections use 'ato_day' while header uses 'ato_date' — this is the
  // existing naming convention in the data model (see loadPackage_obj).
  var operation = null;
  var atoDay    = null;

  // 1. Header is authoritative — section editors write here directly on save.
  if (pkg.header) {
    if (pkg.header.operation) operation = pkg.header.operation;
    if (pkg.header.ato_date)  atoDay   = pkg.header.ato_date;
  }

  // 2. Fallback for packages that have no header: collect from sections.
  if (!operation || !atoDay) {
    sections.forEach(function (key) {
      var sec = pkg[key];
      if (!sec) return;
      if (!operation && sec.operation) operation = sec.operation;
      if (!atoDay   && sec.ato_day)   atoDay   = sec.ato_day;
    });
  }

  // 3. Propagate the final value to all sections and header.
  if (operation || atoDay) {
    sections.forEach(function (key) {
      var sec = pkg[key];
      if (!sec) return;
      if (operation) sec.operation = operation;
      if (atoDay)    sec.ato_day   = atoDay;
    });
    if (!pkg.header) pkg.header = {};
    if (operation) pkg.header.operation = operation;
    if (atoDay)    pkg.header.ato_date  = atoDay;
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
  if (!STATE.pkg) { alert('No package loaded'); return; }

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

// ── Update shared header ──────────────────────────────────────
// Section editors call this after saving their own operation/ato_day fields
// so that _syncHeaders() can treat pkg.header as the authoritative source.
function editorUpdateHeader(operation, atoDay) {
  if (!STATE.pkg) return;
  if (!STATE.pkg.header) STATE.pkg.header = {};
  if (operation) STATE.pkg.header.operation = operation;
  if (atoDay)    STATE.pkg.header.ato_date  = atoDay;
}

function editorEnsureRegistry() {
  if (!STATE.pkg) STATE.pkg = {};
  if (!STATE.pkg.registry) STATE.pkg.registry = {};
  return STATE.pkg.registry;
}
