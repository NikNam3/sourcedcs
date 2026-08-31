// ═══════════════════════════════════════════════════════════
// import-export.js — skill tree JSON import/export + save-to-server
//
// Public API:
//   exportJSON(data, filename)
//   triggerImport(target) / handleImportFileChange(e)
//   importWholeTree(parsed) / importSubtreeUnder(node, parsedJson)
//   saveSkillTree()
// ═══════════════════════════════════════════════════════════

'use strict';

function exportJSON(data, filename) {
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* `target` is 'whole', 'root', or { nodeId } — stashed until the shared
   hidden file input's change event fires. */
function triggerImport(target) {
  _pendingImportTarget = target;
  var input = document.getElementById('treeImportFile');
  if (input) { input.value = ''; input.click(); }
}

function handleImportFileChange(e) {
  var file = e.target.files && e.target.files[0];
  if (!file) return;
  var target = _pendingImportTarget;
  _pendingImportTarget = null;

  var reader = new FileReader();
  reader.onload = function () {
    var parsed;
    try { parsed = JSON.parse(reader.result); } catch (err) { showToast('Invalid JSON: ' + err.message, true); return; }

    if (target === 'whole') {
      importWholeTree(parsed);
    } else if (target === 'root') {
      importSubtreeUnder(null, parsed);
    } else if (target && target.nodeId) {
      var node = _treeEditorIndex.modules[target.nodeId];
      if (!node) { showToast('Target module no longer exists', true); return; }
      importSubtreeUnder(node, parsed);
    }
  };
  reader.onerror = function () { showToast('Failed to read file', true); };
  reader.readAsText(file);
}

/* Whole-document import. With no squadron filter active this REPLACES the
   entire working draft (bulk-authoring the whole curriculum externally).
   With a squadron filter active it stops being destructive: the uploaded
   document's root modules are forced to that squadron and merged in as new
   roots alongside whatever's already there, leaving other squadrons' — and
   general — content untouched. */
function importWholeTree(parsed) {
  if (!_outlineSquadronFilter) {
    var err = skillsCore.validateTree(parsed);
    if (err) { showToast(err, true); return; }
    if (_treeEditor.tree && _treeEditor.tree.length) {
      if (!confirm('This will replace the entire current working draft (' + _treeEditor.tree.length + ' root module(s)). Continue?')) return;
    }
    _treeEditor = parsed;
    rebuildTreeEditorIndex();
    _outlineSelectedId = null;
    renderTreeOutline();
    renderTreeDetail();
    var total = (_treeEditor.tree || []).reduce(function (s, n) { return s + skillsCore.countModules(n); }, 0);
    showToast('Imported tree (' + total + ' module(s))');
    return;
  }

  if (!parsed || !Array.isArray(parsed.tree)) {
    showToast('Expected a { version, tree: [...] } document', true);
    return;
  }
  var nodes = JSON.parse(JSON.stringify(parsed.tree));
  forceSquadronScope(nodes, _outlineSquadronFilter);

  var candidate = JSON.parse(JSON.stringify(_treeEditor));
  candidate.tree = candidate.tree || [];
  nodes.forEach(function (n) { candidate.tree.push(n); });

  var mergeErr = skillsCore.validateTree(candidate);
  if (mergeErr) { showToast(mergeErr, true); return; }

  _treeEditor = candidate;
  rebuildTreeEditorIndex();
  renderTreeOutline();
  renderTreeDetail();
  var count = nodes.reduce(function (s, n) { return s + skillsCore.countModules(n); }, 0);
  showToast('Imported ' + count + ' module(s) for ' + squadronShortName(_outlineSquadronFilter));
}

/* Additive import: inserts the parsed module(s) as new sub-modules of
   `node` (or as new root modules when `node` is null). Any id collision
   against the existing tree is a hard rejection (surfaced via
   skillsCore.validateTree's duplicate-id check) — no silent overwrite. */
function importSubtreeUnder(node, parsedJson) {
  var nodes;
  if (Array.isArray(parsedJson)) {
    nodes = parsedJson;
  } else if (parsedJson && typeof parsedJson === 'object' && parsedJson.id) {
    nodes = [parsedJson];
  } else {
    showToast('Expected a module object or an array of modules', true);
    return;
  }
  nodes = JSON.parse(JSON.stringify(nodes));
  if (_outlineSquadronFilter) forceSquadronScope(nodes, _outlineSquadronFilter);

  var candidate = JSON.parse(JSON.stringify(_treeEditor));
  var targetArr;
  if (node) {
    var candNode = skillsCore.buildIndex(candidate).modules[node.id];
    if (!candNode) { showToast('Target module no longer exists', true); return; }
    candNode.subModules = candNode.subModules || [];
    targetArr = candNode.subModules;
  } else {
    candidate.tree = candidate.tree || [];
    targetArr = candidate.tree;
  }
  nodes.forEach(function (n) { targetArr.push(n); });

  var err = skillsCore.validateTree(candidate);
  if (err) { showToast(err, true); return; }

  _treeEditor = candidate;
  rebuildTreeEditorIndex();
  if (node) _outlineExpanded[node.id] = true;
  renderTreeOutline();
  renderTreeDetail();
  var count = nodes.reduce(function (s, n) { return s + skillsCore.countModules(n); }, 0);
  showToast('Imported ' + count + ' module(s)' + (node ? ' into ' + (node.title || node.id) : ' as new root'));
}

function saveSkillTree() {
  var msg = document.getElementById('treeEditorMsg');

  var err = skillsCore.validateTree(_treeEditor);
  if (err) {
    if (msg) { msg.textContent = 'Error: ' + err; msg.className = 'tree-editor-msg err'; }
    showToast(err, true);
    return;
  }

  var tok = getToken();
  fetch('/api/skill-tree', {
    method:  'PUT',
    headers: authHeaders(tok, { 'Content-Type': 'application/json' }),
    body:    JSON.stringify(_treeEditor),
  }).then(function (r) {
    return r.json().then(function (body) { return { ok: r.ok, body: body }; });
  }).then(function (result) {
    if (!result.ok) {
      if (msg) { msg.textContent = 'Error: ' + (result.body.error || 'unknown'); msg.className = 'tree-editor-msg err'; }
      return;
    }
    _tree       = result.body;
    _treeIndex  = skillsCore.buildIndex(_tree);
    _treeEditor = JSON.parse(JSON.stringify(_tree));
    rebuildTreeEditorIndex();
    renderTreeOutline();
    renderTreeDetail();
    if (msg) { msg.textContent = 'Saved.'; msg.className = 'tree-editor-msg ok'; }
    refreshActiveDetail();
    renderPilotList();
    showToast('Skill tree saved');
  }).catch(function (err2) {
    if (msg) { msg.textContent = 'Error: ' + err2.message; msg.className = 'tree-editor-msg err'; }
  });
}
