// ═══════════════════════════════════════════════════════════
// tree-mutations.js — skill tree structural mutation operations
//
// The data-mutation half of the tree editor (tree-editor.js has the
// rendering half that calls into these). Each mutation here re-renders via
// renderTreeOutline()/renderTreeDetail() afterward, matching the original
// combined file's behavior exactly — so these aren't pure functions in the
// strict sense, but isolating them from the DOM-building code is a step
// toward that (a future pass could split the "mutate `_treeEditor`" logic
// from the "re-render" call at each site if unit tests are added later).
//
// Public API:
//   siblingsArrayOf(parentNode) / newModuleStub(id)
//   addRootModule() / addSubModule(parentNode) / removeChildNode(parentNode, index)
//   moveSiblingUp(parentNode, index) / moveSiblingDown(parentNode, index)
//   addFirstGradingItem(node) / splitIntoMultipleItems(node)
//   addGradingItem(node) / removeGradingItem(node, ii)
//   addRequirement(node) / removeRequirement(node, ri)
//   forceSquadronScope(nodes, squadronId)   — used by import-export.js
// ═══════════════════════════════════════════════════════════

'use strict';

function siblingsArrayOf(parentNode) {
  return parentNode ? (parentNode.subModules = parentNode.subModules || []) : (_treeEditor.tree = _treeEditor.tree || []);
}

function newModuleStub(id) {
  return { id: id, title: '', description: '', requirements: [], subModules: [], gradingItems: [{ id: id, label: '', min_pass_grade: 'G' }] };
}

function addRootModule() {
  var id = 'mod-' + Date.now();
  (_treeEditor.tree = _treeEditor.tree || []).push(newModuleStub(id));
  rebuildTreeEditorIndex();
  _outlineSelectedId = id;
  renderTreeOutline();
  renderTreeDetail();
}

function addSubModule(parentNode) {
  var id = 'mod-' + Date.now();
  (parentNode.subModules = parentNode.subModules || []).push(newModuleStub(id));
  _outlineExpanded[parentNode.id] = true;
  rebuildTreeEditorIndex();
  _outlineSelectedId = id;
  renderTreeOutline();
  renderTreeDetail();
}

function removeChildNode(parentNode, index) {
  var arr = siblingsArrayOf(parentNode);
  var removedId = arr[index] && arr[index].id;
  arr.splice(index, 1);
  if (_outlineSelectedId === removedId) _outlineSelectedId = parentNode ? parentNode.id : null;
  rebuildTreeEditorIndex();
  renderTreeOutline();
  renderTreeDetail();
}

function moveSiblingUp(parentNode, index) {
  var arr = siblingsArrayOf(parentNode);
  if (index < 1) return;
  var t = arr[index - 1]; arr[index - 1] = arr[index]; arr[index] = t;
  renderTreeOutline();
  renderTreeDetail();
}
function moveSiblingDown(parentNode, index) {
  var arr = siblingsArrayOf(parentNode);
  if (index < 0 || index >= arr.length - 1) return;
  var t = arr[index + 1]; arr[index + 1] = arr[index]; arr[index] = t;
  renderTreeOutline();
  renderTreeDetail();
}

function addFirstGradingItem(node) {
  node.gradingItems = [{ id: node.id, label: '', min_pass_grade: 'G' }];
  rebuildTreeEditorIndex();
  renderTreeOutline();
  renderTreeDetail();
}

function splitIntoMultipleItems(node) {
  if (!confirm('Splitting into multiple items changes this module\'s grading-item id(s). Any grade already recorded under the old id will be orphaned. Continue?')) return;
  var old = (node.gradingItems && node.gradingItems[0]) || { min_pass_grade: 'G' };
  var id1 = skillsCore.gradingItemId(node.id, 'level-1', _treeEditorIndex);
  var id2 = skillsCore.gradingItemId(node.id, 'level-2', _treeEditorIndex);
  node.gradingItems = [
    { id: id1, label: 'Level 1', min_pass_grade: old.min_pass_grade || 'G' },
    { id: id2, label: 'Level 2', min_pass_grade: 'G' },
  ];
  rebuildTreeEditorIndex();
  renderTreeOutline();
  renderTreeDetail();
}

function addGradingItem(node) {
  var label = 'Item ' + ((node.gradingItems || []).length + 1);
  var id    = skillsCore.gradingItemId(node.id, label, _treeEditorIndex);
  (node.gradingItems = node.gradingItems || []).push({ id: id, label: label, min_pass_grade: 'G' });
  rebuildTreeEditorIndex();
  renderTreeOutline();
  renderTreeDetail();
}

function removeGradingItem(node, ii) {
  node.gradingItems.splice(ii, 1);
  if (node.gradingItems.length === 1 && node.gradingItems[0].id !== node.id) {
    showToast('Only one grading item left — collapsed back to a single grade (old grades under it are orphaned)', true);
    node.gradingItems[0] = { id: node.id, label: '', min_pass_grade: node.gradingItems[0].min_pass_grade };
  }
  rebuildTreeEditorIndex();
  renderTreeOutline();
  renderTreeDetail();
}

function addRequirement(node) {
  var candidates = Object.keys(_treeEditorIndex.modules).filter(function (id) { return id !== node.id; });
  if (!candidates.length) { showToast('No other modules exist yet to require', true); return; }
  var existing = (node.requirements || []).map(function (r) { return r.module_id; });
  var first    = candidates.find(function (id) { return existing.indexOf(id) === -1; }) || candidates[0];
  (node.requirements = node.requirements || []).push({ module_id: first, min_grade: 'G' });
  renderTreeDetail();
}
function removeRequirement(node, ri) {
  node.requirements.splice(ri, 1);
  renderTreeDetail();
}

/* Forces every top-level node in `nodes` to belong to exactly `squadronId`,
   stripping any explicit `squadrons` from all of their descendants so those
   simply inherit the one restriction — trivially satisfies the subset-of-
   ancestor validation rule with no per-node reconciliation. Mutates and
   returns `nodes`. */
function forceSquadronScope(nodes, squadronId) {
  function stripDeep(n) {
    delete n.squadrons;
    (n.subModules || []).forEach(stripDeep);
  }
  nodes.forEach(function (n) {
    (n.subModules || []).forEach(stripDeep);
    n.squadrons = [squadronId];
  });
  return nodes;
}
