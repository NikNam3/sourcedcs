// ═══════════════════════════════════════════════════════════
// tree-editor.js — skill tree structural editor: indented outline (left)
// + detail panel (right)
//
// This is the rendering half. The pure data-mutation operations it calls
// (add/remove/move nodes, add/remove grading items/requirements) live in
// tree-mutations.js so they can eventually be unit-tested independently of
// this DOM-building code, the way skills-core.js already is.
//
// Public API:
//   initTreeEditor() / rebuildTreeEditorIndex()
//   renderTreeOutline() / renderTreeDetail()
//   selectNode(id) / patchOutlineLabel(id, title)
//   importScopeSuffix() / squadronShortName(sqId)   — used by import-export.js
// ═══════════════════════════════════════════════════════════

'use strict';

function initTreeEditor() {
  _treeEditor = JSON.parse(JSON.stringify(_tree || { version: 2, tree: [] }));
  rebuildTreeEditorIndex();
  if (_outlineSelectedId && !_treeEditorIndex.modules[_outlineSelectedId]) _outlineSelectedId = null;
  renderTreeOutline();
  renderTreeDetail();
}

function rebuildTreeEditorIndex() {
  _treeEditorIndex = skillsCore.buildIndex(_treeEditor);
}

/* ── Outline (left pane) ─────────────────────────────────── */
/* skillsCore.moduleVisibleToSquadron treats a falsy squadronId as "pilot has
   no squadron" and hides restricted nodes — the opposite of what "ALL
   SQUADRONS" needs here, so this is only ever called when a filter is
   actually active; with no filter every node is shown unconditionally. */
function outlineNodeVisible(node) {
  if (!_outlineSquadronFilter) return true;
  return skillsCore.moduleVisibleToSquadron(_treeEditorIndex, node.id, _outlineSquadronFilter);
}

/* Suffix appended to every IMPORT JSON button's label so the squadron
   scoping driven by the outline's filter (see forceSquadronScope) is never
   silently active — it always says on the button what it's about to do. */
function importScopeSuffix() {
  return _outlineSquadronFilter ? (' → ' + squadronShortName(_outlineSquadronFilter)) : '';
}

function renderTreeOutline() {
  var el = document.getElementById('treeOutline');
  if (!el) return;
  el.innerHTML = '';

  var filterRow = document.createElement('div');
  filterRow.className = 'tree-outline-filter-row';
  var filterLbl = document.createElement('span');
  filterLbl.className   = 'tree-field-label';
  filterLbl.textContent = 'SQUADRON';
  var filterSel = document.createElement('select');
  filterSel.className = 'grade-select';
  filterSel.style.flex = '1';
  var allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = 'ALL SQUADRONS';
  if (!_outlineSquadronFilter) allOpt.selected = true;
  filterSel.appendChild(allOpt);
  _squadrons.forEach(function (sq) {
    var opt = document.createElement('option');
    opt.value = sq.id;
    opt.textContent = sq.designator + ' ' + sq.name;
    if (_outlineSquadronFilter === sq.id) opt.selected = true;
    filterSel.appendChild(opt);
  });
  filterSel.addEventListener('change', function () {
    _outlineSquadronFilter = this.value || null;
    if (_outlineSelectedId && !outlineNodeVisible(_treeEditorIndex.modules[_outlineSelectedId] || {})) {
      _outlineSelectedId = null;
    }
    renderTreeOutline();
    renderTreeDetail();
  });
  filterRow.appendChild(filterLbl);
  filterRow.appendChild(filterSel);
  el.appendChild(filterRow);

  var filterHint = document.createElement('div');
  filterHint.className = 'tree-inherited-note tree-outline-filter-hint';
  filterHint.textContent = _outlineSquadronFilter
    ? ('IMPORT JSON below is scoped to ' + squadronShortName(_outlineSquadronFilter) + ' while this filter is active — uploaded modules are forced into it.')
    : 'This also scopes IMPORT JSON and new root modules — pick a squadron here first to import for it.';
  el.appendChild(filterHint);

  var list = document.createElement('div');
  list.className = 'tree-outline-list';
  (_treeEditor.tree || []).forEach(function (node) {
    if (!outlineNodeVisible(node)) return;
    list.appendChild(buildOutlineRow(node, 0));
  });
  el.appendChild(list);

  var btnRow = document.createElement('div');
  btnRow.className = 'tree-outline-btn-row';
  var addBtn = document.createElement('button');
  addBtn.className   = 'btn-sm btn-sm-blue';
  addBtn.textContent = '+ ADD ROOT MODULE';
  addBtn.addEventListener('click', addRootModule);
  var importRootBtn = document.createElement('button');
  importRootBtn.className   = 'btn-sm';
  importRootBtn.textContent = '+ IMPORT JSON AS ROOT' + importScopeSuffix();
  importRootBtn.addEventListener('click', function () { triggerImport('root'); });
  btnRow.appendChild(addBtn);
  btnRow.appendChild(importRootBtn);
  el.appendChild(btnRow);

  var wholeImportBtn = document.getElementById('treeImportBtn');
  if (wholeImportBtn) wholeImportBtn.textContent = 'IMPORT JSON' + importScopeSuffix();
}

function buildOutlineRow(node, depth) {
  var wrap = document.createElement('div');

  var row = document.createElement('div');
  row.className = 'pilot-row outline-row' + (node.id === _outlineSelectedId ? ' active' : '');
  row.style.paddingLeft = (10 + depth * 16) + 'px';
  row.setAttribute('data-node-id', node.id);

  var hasChildren = !!(node.subModules && node.subModules.length);
  var expanded    = !!_outlineExpanded[node.id];

  var toggle = document.createElement('span');
  toggle.className   = 'outline-toggle';
  toggle.textContent = hasChildren ? (expanded ? '▼' : '▶') : '·';
  if (hasChildren) {
    (function (id) {
      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        _outlineExpanded[id] = !_outlineExpanded[id];
        renderTreeOutline();
      });
    })(node.id);
  }

  var label = document.createElement('span');
  label.className   = 'outline-row-label';
  label.textContent = node.title || '(untitled)';

  var badge = document.createElement('span');
  badge.className = 'outline-badge';
  var itemCount = (node.gradingItems || []).length;
  badge.textContent = hasChildren ? (skillsCore.countModules(node) + ' MOD') : (itemCount > 1 ? itemCount + ' ITEMS' : '');

  var sqBadge = document.createElement('span');
  if (node.squadrons && node.squadrons.length) {
    sqBadge.className = 'outline-badge outline-badge-sq';
    sqBadge.textContent = node.squadrons.length + ' SQ';
    sqBadge.title = node.squadrons.join(', ');
  }

  row.appendChild(toggle);
  row.appendChild(label);
  if (badge.textContent) row.appendChild(badge);
  if (sqBadge.textContent) row.appendChild(sqBadge);

  (function (id) { row.addEventListener('click', function () { selectNode(id); }); })(node.id);

  wrap.appendChild(row);

  if (hasChildren && expanded) {
    node.subModules.forEach(function (child) {
      if (!outlineNodeVisible(child)) return;
      wrap.appendChild(buildOutlineRow(child, depth + 1));
    });
  }

  return wrap;
}

function selectNode(id) {
  _outlineSelectedId = id;
  document.querySelectorAll('#treeOutline .outline-row').forEach(function (r) {
    r.classList.toggle('active', r.getAttribute('data-node-id') === id);
  });
  renderTreeDetail();
}

function patchOutlineLabel(id, title) {
  var rows = document.querySelectorAll('#treeOutline .outline-row');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].getAttribute('data-node-id') === id) {
      var lbl = rows[i].querySelector('.outline-row-label');
      if (lbl) lbl.textContent = title || '(untitled)';
      break;
    }
  }
}

/* ── Detail panel (right pane) ───────────────────────────── */
function renderTreeDetail() {
  var el = document.getElementById('treeDetail');
  if (!el) return;
  el.innerHTML = '';

  var node = _outlineSelectedId ? _treeEditorIndex.modules[_outlineSelectedId] : null;
  if (!node) {
    _outlineSelectedId = null;
    el.innerHTML = '<p class="skills-empty">Select a module on the left, or add a root module to get started.</p>';
    return;
  }

  var crumb = document.createElement('div');
  crumb.className = 'tree-breadcrumb';
  crumb.textContent = skillsCore.breadcrumb(_treeEditorIndex, node.id).join(' › ');
  el.appendChild(crumb);

  var titleInput = document.createElement('input');
  titleInput.className   = 'tree-input tree-detail-title-input';
  titleInput.placeholder = 'Module title';
  titleInput.value       = node.title || '';
  titleInput.addEventListener('input', function () {
    node.title = this.value;
    patchOutlineLabel(node.id, node.title);
  });
  el.appendChild(titleInput);

  el.appendChild(buildIdRow(node, 'module-id', function (oldId, newId) {
    if (node.gradingItems && node.gradingItems.length === 1 && node.gradingItems[0].id === oldId) {
      node.gradingItems[0].id = newId;
    }
    Object.keys(_treeEditorIndex.modules).forEach(function (mid) {
      var m = _treeEditorIndex.modules[mid];
      (m.requirements || []).forEach(function (r) { if (r.module_id === oldId) r.module_id = newId; });
    });
  }));

  var descRow = document.createElement('div');
  descRow.className = 'tree-desc-row';
  var descLabel = document.createElement('span');
  descLabel.className = 'tree-field-label'; descLabel.textContent = 'DESCRIPTION';
  var descTA = document.createElement('textarea');
  descTA.className   = 'tree-textarea';
  descTA.placeholder = 'What must the pilot demonstrate?';
  descTA.value       = node.description || '';
  descTA.addEventListener('input', function () { node.description = this.value; });
  descRow.appendChild(descLabel); descRow.appendChild(descTA);
  el.appendChild(descRow);

  el.appendChild(buildSquadronRow(node));
  el.appendChild(buildSubModulesSection(node));
  el.appendChild(buildGradingItemsSection(node));
  el.appendChild(buildRequirementsSection(node));
  el.appendChild(buildNodeControlsRow(node));
}

/* Shared ID row builder. `onIdChanged(oldId, newId)` fires only when the id
   is actually committed (on blur/change, not per keystroke) and lets the
   caller fix up anything that referenced the old id (the module's own
   single grading item, other modules' requirements). */
function buildIdRow(obj, placeholder, onIdChanged) {
  var row = document.createElement('div');
  row.className = 'tree-id-row';
  var lbl = document.createElement('span');
  lbl.className = 'tree-field-label'; lbl.textContent = 'ID';
  var inp = document.createElement('input');
  inp.className = 'tree-input tree-id-input';
  inp.placeholder = placeholder || 'id';
  inp.value = obj.id || '';
  inp.addEventListener('change', function () {
    var newId = this.value.trim();
    var oldId = obj.id;
    if (!newId || newId === oldId) { this.value = oldId; return; }
    if (_treeEditorIndex.modules[newId] || _treeEditorIndex.itemOwner[newId]) {
      showToast('That id is already in use', true);
      this.value = oldId;
      return;
    }
    if (typeof onIdChanged === 'function') onIdChanged(oldId, newId);
    obj.id = newId;
    rebuildTreeEditorIndex();
    renderTreeOutline();
    renderTreeDetail();
  });
  row.appendChild(lbl); row.appendChild(inp);
  return row;
}

/* Squadron visibility selector — options are constrained to the nearest
   restricting ancestor's set (a child can only narrow, never broaden). */
function squadronNoteText(node, ancestorRestriction) {
  if (!_squadrons.length) return '(no squadrons configured)';
  if (!node.squadrons || !node.squadrons.length) {
    return ancestorRestriction
      ? '(inherited from parent: ' + ancestorRestriction.map(squadronShortName).join(', ') + ')'
      : '(none checked = ALL squadrons)';
  }
  return '';
}

function buildSquadronRow(node) {
  var row = document.createElement('div');
  row.className = 'tree-id-row';
  row.style.cssText = 'flex-wrap:wrap;gap:6px;align-items:flex-start';

  var lbl = document.createElement('span');
  lbl.className = 'tree-field-label';
  lbl.textContent = 'VISIBLE TO';
  row.appendChild(lbl);

  var ancestorRestriction = skillsCore.ancestorSquadronRestriction(_treeEditorIndex, node.id);
  var allowedSquadrons = ancestorRestriction
    ? _squadrons.filter(function (sq) { return ancestorRestriction.indexOf(sq.id) !== -1; })
    : _squadrons;

  /* Kept in the DOM permanently (id'd, text toggled in place rather than
     the element being added/removed) — checking a box used to trigger a
     full renderTreeDetail(), which tore this row down and rebuilt it with
     the note gone, shifting the checkboxes up right as you tried to click
     the next one ("the list collapses"). Updating text in place avoids any
     layout shift while multi-selecting. */
  var note = document.createElement('span');
  note.className = 'tree-inherited-note';
  note.id = 'treeSquadronNote';
  note.textContent = squadronNoteText(node, ancestorRestriction);
  row.appendChild(note);

  if (allowedSquadrons.length) {
    var checksWrap = document.createElement('div');
    checksWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;width:100%';

    allowedSquadrons.forEach(function (sq) {
      var label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:9px;cursor:pointer;user-select:none';

      var cb  = document.createElement('input');
      cb.type = 'checkbox';
      cb.value   = sq.id;
      cb.checked = !!(node.squadrons && node.squadrons.indexOf(sq.id) !== -1);

      (function (sqId, checkbox) {
        checkbox.addEventListener('change', function () {
          if (!node.squadrons) node.squadrons = [];
          if (checkbox.checked) {
            if (node.squadrons.indexOf(sqId) === -1) node.squadrons.push(sqId);
          } else {
            node.squadrons = node.squadrons.filter(function (id) { return id !== sqId; });
          }
          if (!node.squadrons.length) delete node.squadrons;

          var noteEl = document.getElementById('treeSquadronNote');
          if (noteEl) noteEl.textContent = squadronNoteText(node, ancestorRestriction);
          renderTreeOutline(); /* cheap — just labels/badges, no focus to lose */
        });
      })(sq.id, cb);

      label.appendChild(cb);
      label.appendChild(document.createTextNode(sq.designator + ' ' + sq.name));
      checksWrap.appendChild(label);
    });

    row.appendChild(checksWrap);
  }

  return row;
}
function squadronShortName(sqId) {
  var sq = _squadrons.find(function (s) { return s.id === sqId; });
  return sq ? (sq.designator || sq.name) : sqId;
}

function buildSubModulesSection(node) {
  var section = document.createElement('div');
  section.className = 'tree-editor-subsection';

  var topRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';
  var lbl = document.createElement('span');
  lbl.className = 'tree-field-label'; lbl.textContent = 'SUB-MODULES';
  var addBtn = document.createElement('button');
  addBtn.className = 'btn-sm'; addBtn.textContent = '+ ADD SUB-MODULE';
  (function (n) { addBtn.addEventListener('click', function () { addSubModule(n); }); })(node);
  topRow.appendChild(lbl); topRow.appendChild(addBtn);
  section.appendChild(topRow);

  var kids = node.subModules || [];
  if (!kids.length) {
    var none = document.createElement('span');
    none.style.cssText = 'font-size:9px;color:var(--text-3)';
    none.textContent   = 'None';
    section.appendChild(none);
    return section;
  }

  kids.forEach(function (child, ci) {
    var row = document.createElement('div');
    row.className = 'tree-prereq-row';

    var titleBtn = document.createElement('button');
    titleBtn.className = 'btn-sm';
    titleBtn.style.cssText = 'flex:1;text-align:left';
    titleBtn.textContent = child.title || '(untitled)';
    (function (id) { titleBtn.addEventListener('click', function () { selectNode(id); }); })(child.id);

    var upBtn = document.createElement('button');
    upBtn.className = 'btn-sm'; upBtn.textContent = '↑'; upBtn.disabled = ci === 0;
    (function (n, i) { upBtn.addEventListener('click', function () { moveSiblingUp(n, i); }); })(node, ci);

    var dnBtn = document.createElement('button');
    dnBtn.className = 'btn-sm'; dnBtn.textContent = '↓'; dnBtn.disabled = ci === kids.length - 1;
    (function (n, i) { dnBtn.addEventListener('click', function () { moveSiblingDown(n, i); }); })(node, ci);

    var delBtn = document.createElement('button');
    delBtn.className = 'btn-sm btn-sm-danger'; delBtn.textContent = '×';
    (function (n, i, title) {
      delBtn.addEventListener('click', function () {
        if (confirm('Remove "' + (title || 'unnamed') + '" and everything nested under it?')) removeChildNode(n, i);
      });
    })(node, ci, child.title);

    row.appendChild(titleBtn); row.appendChild(upBtn); row.appendChild(dnBtn); row.appendChild(delBtn);
    section.appendChild(row);
  });

  return section;
}

function buildGradingItemsSection(node) {
  var section = document.createElement('div');
  section.className = 'tree-editor-subsection';

  var topRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';
  var lbl = document.createElement('span');
  lbl.className = 'tree-field-label'; lbl.textContent = 'GRADING ITEMS';
  topRow.appendChild(lbl);
  section.appendChild(topRow);

  var items = node.gradingItems || [];

  if (items.length <= 1) {
    var single = items[0];
    if (!single) {
      var addSingleBtn = document.createElement('button');
      addSingleBtn.className = 'btn-sm';
      addSingleBtn.textContent = '+ ADD GRADING ITEM';
      (function (n) { addSingleBtn.addEventListener('click', function () { addFirstGradingItem(n); }); })(node);
      section.appendChild(addSingleBtn);
      return section;
    }

    var passRow = document.createElement('div');
    passRow.className = 'tree-id-row';
    var passLabel = document.createElement('span');
    passLabel.className = 'tree-field-label'; passLabel.textContent = 'PASS';
    var gradeSel = document.createElement('select');
    gradeSel.className = 'grade-select';
    ['U', 'F', 'G', 'E'].forEach(function (g) {
      var opt = document.createElement('option');
      opt.value = g; opt.textContent = g;
      if ((single.min_pass_grade || 'G') === g) opt.selected = true;
      gradeSel.appendChild(opt);
    });
    gradeSel.addEventListener('change', function () { single.min_pass_grade = this.value; });
    passRow.appendChild(passLabel); passRow.appendChild(gradeSel);
    section.appendChild(passRow);

    var splitBtn = document.createElement('button');
    splitBtn.className = 'btn-sm';
    splitBtn.style.cssText = 'margin-top:6px';
    splitBtn.textContent = '+ SPLIT INTO MULTIPLE ITEMS';
    (function (n) { splitBtn.addEventListener('click', function () { splitIntoMultipleItems(n); }); })(node);
    section.appendChild(splitBtn);
    return section;
  }

  items.forEach(function (item, ii) {
    var row = document.createElement('div');
    row.className = 'tree-prereq-row';

    var labelInput = document.createElement('input');
    labelInput.className   = 'tree-input';
    labelInput.style.flex  = '1';
    labelInput.placeholder = 'Item label (e.g. Level 1)';
    labelInput.value       = item.label || '';
    labelInput.addEventListener('input', function () { item.label = this.value; });

    var gradeSel = document.createElement('select');
    gradeSel.className = 'grade-select';
    ['U', 'F', 'G', 'E'].forEach(function (g) {
      var opt = document.createElement('option');
      opt.value = g; opt.textContent = g + ' PASS';
      if ((item.min_pass_grade || 'G') === g) opt.selected = true;
      gradeSel.appendChild(opt);
    });
    gradeSel.addEventListener('change', function () { item.min_pass_grade = this.value; });

    var delBtn = document.createElement('button');
    delBtn.className = 'btn-sm btn-sm-danger'; delBtn.textContent = '×';
    (function (n, i) {
      delBtn.addEventListener('click', function () {
        if (confirm('Remove this grading item? Any recorded pilot grades under it will be orphaned.')) removeGradingItem(n, i);
      });
    })(node, ii);

    row.appendChild(labelInput); row.appendChild(gradeSel); row.appendChild(delBtn);
    section.appendChild(row);
  });

  var addBtn = document.createElement('button');
  addBtn.className = 'btn-sm';
  addBtn.style.cssText = 'margin-top:6px';
  addBtn.textContent = '+ ADD GRADING ITEM';
  (function (n) { addBtn.addEventListener('click', function () { addGradingItem(n); }); })(node);
  section.appendChild(addBtn);

  return section;
}

function buildRequirementsSection(node) {
  var section = document.createElement('div');
  section.className = 'tree-prereq-section';

  var topRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;align-items:center;gap:8px';
  var lbl = document.createElement('span');
  lbl.className = 'tree-field-label'; lbl.textContent = 'REQUIREMENTS';
  var addBtn = document.createElement('button');
  addBtn.className = 'btn-sm'; addBtn.textContent = '+ ADD';
  (function (n) { addBtn.addEventListener('click', function () { addRequirement(n); }); })(node);
  topRow.appendChild(lbl); topRow.appendChild(addBtn);
  section.appendChild(topRow);

  var reqs = node.requirements || [];
  var availModules = Object.keys(_treeEditorIndex.modules)
    .filter(function (id) { return id !== node.id; })
    .map(function (id) { return _treeEditorIndex.modules[id]; });

  if (!reqs.length) {
    var none = document.createElement('span');
    none.style.cssText = 'font-size:9px;color:var(--text-3);margin-top:4px;display:block';
    none.textContent   = 'None';
    section.appendChild(none);
  } else {
    reqs.forEach(function (req, ri) {
      section.appendChild(buildRequirementRow(node, req, ri, availModules));
    });
  }

  return section;
}

function buildRequirementRow(node, req, ri, availModules) {
  var row = document.createElement('div');
  row.className = 'tree-prereq-row';

  var modSel = document.createElement('select');
  modSel.className = 'grade-select';
  modSel.style.flex = '1';
  if (!availModules.length) {
    var noOpt = document.createElement('option');
    noOpt.value = ''; noOpt.textContent = '(no other modules yet)';
    modSel.appendChild(noOpt);
  } else {
    availModules.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = skillsCore.breadcrumb(_treeEditorIndex, m.id).join(' › ');
      if (req.module_id === m.id) opt.selected = true;
      modSel.appendChild(opt);
    });
  }
  modSel.addEventListener('change', function () {
    var newTarget = this.value;
    var candidate = JSON.parse(JSON.stringify(_treeEditor));
    var idxCand   = skillsCore.buildIndex(candidate);
    idxCand.modules[node.id].requirements[ri].module_id = newTarget;
    if (skillsCore.detectRequirementCycle(idxCand)) {
      showToast('That would create a circular requirement', true);
      this.value = req.module_id;
      return;
    }
    req.module_id = newTarget;
  });

  var gradeSel = document.createElement('select');
  gradeSel.className = 'grade-select';
  ['U', 'F', 'G', 'E'].forEach(function (g) {
    var opt = document.createElement('option');
    opt.value = g; opt.textContent = g + '+';
    if ((req.min_grade || 'G') === g) opt.selected = true;
    gradeSel.appendChild(opt);
  });
  gradeSel.addEventListener('change', function () { req.min_grade = this.value; });

  var delBtn = document.createElement('button');
  delBtn.className = 'btn-sm btn-sm-danger'; delBtn.textContent = '×';
  (function (n, i) { delBtn.addEventListener('click', function () { removeRequirement(n, i); }); })(node, ri);

  row.appendChild(modSel); row.appendChild(gradeSel); row.appendChild(delBtn);
  return row;
}

function buildNodeControlsRow(node) {
  var wrap = document.createElement('div');
  wrap.className = 'tree-node-controls';

  var parentId  = _treeEditorIndex.parentOf[node.id];
  var parentObj = parentId ? _treeEditorIndex.modules[parentId] : null;
  var siblings  = siblingsArrayOf(parentObj);
  var idx       = siblings.findIndex(function (n) { return n.id === node.id; });

  var upBtn = document.createElement('button');
  upBtn.className = 'btn-sm'; upBtn.textContent = '↑ MOVE UP'; upBtn.disabled = idx <= 0;
  upBtn.addEventListener('click', function () { moveSiblingUp(parentObj, idx); });

  var dnBtn = document.createElement('button');
  dnBtn.className = 'btn-sm'; dnBtn.textContent = 'MOVE DOWN ↓'; dnBtn.disabled = (idx === -1 || idx >= siblings.length - 1);
  dnBtn.addEventListener('click', function () { moveSiblingDown(parentObj, idx); });

  var importBtn = document.createElement('button');
  importBtn.className   = 'btn-sm';
  importBtn.textContent = 'IMPORT JSON HERE' + importScopeSuffix();
  (function (n) { importBtn.addEventListener('click', function () { triggerImport({ nodeId: n.id }); }); })(node);

  var exportBtn = document.createElement('button');
  exportBtn.className   = 'btn-sm';
  exportBtn.textContent = 'EXPORT SUBTREE';
  (function (n) { exportBtn.addEventListener('click', function () { exportJSON(n, n.id + '.json'); }); })(node);

  var delBtn = document.createElement('button');
  delBtn.className = 'btn-sm btn-sm-danger';
  delBtn.textContent = 'DELETE MODULE';
  delBtn.style.marginLeft = 'auto';
  delBtn.addEventListener('click', function () {
    if (confirm('Remove "' + (node.title || 'unnamed') + '" and everything nested under it?')) {
      removeChildNode(parentObj, idx);
    }
  });

  wrap.appendChild(upBtn); wrap.appendChild(dnBtn);
  wrap.appendChild(importBtn); wrap.appendChild(exportBtn);
  wrap.appendChild(delBtn);
  return wrap;
}
