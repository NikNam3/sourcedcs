// ═══════════════════════════════════════════════════════════
// main.js — skills-admin bootstrap + data loading
//
// Loaded LAST (see skills-admin.html) — its top-level IIFE runs immediately
// on load and calls into every other skills-admin/*.js file (loadAll,
// initTreeEditor, saveSkillTree, triggerImport, exportJSON, ...), so
// everything it references must already be defined by earlier <script>
// tags. state.js must load first of all (declares the shared globals every
// other file, including this one, reads and writes).
//
// Public API:
//   loadAll(tok)
// ═══════════════════════════════════════════════════════════

'use strict';

/* ── Data loading ───────────────────────────────────────── */
function loadAll(tok) {
  var headers = authHeaders(tok);

  Promise.all([
    fetch('/api/skill-tree').then(function (r) { return r.json(); }),
    fetch('/api/skill-grades', { headers: headers }).then(function (r) { return r.json(); }),
    fetch('/api/skill-pilots', { headers: headers }).then(function (r) { return r.json(); }),
    fetch('/api/grading-requests', { headers: headers }).then(function (r) { return r.json(); }),
    fetch('/api/squadrons').then(function (r) { return r.json(); }).catch(function () { return []; }),
    fetch('/api/skill-pilots-squadrons', { headers: headers }).then(function (r) { return r.json(); }).catch(function () { return {}; }),
    fetch('/api/members', { headers: headers }).then(function (r) { return r.json(); }).catch(function () { return []; }),
  ]).then(function (results) {
    _tree              = results[0];
    _treeIndex         = skillsCore.buildIndex(_tree);
    _allGrades         = results[1] || {};
    _pilots            = results[2] || {};
    _requests          = Array.isArray(results[3]) ? results[3] : [];
    _squadrons         = Array.isArray(results[4]) ? results[4] : [];
    _pilotSquadrons    = (results[5] && typeof results[5] === 'object') ? results[5] : {};
    _members           = Array.isArray(results[6]) ? results[6] : [];

    renderGradingQueue();
    renderPilotList();
    initTreeEditor();
  }).catch(function (err) {
    console.error('[skills-admin] load failed:', err);
    showToast('Failed to load admin data', true);
  });
}

/* ── Bootstrap ──────────────────────────────────────────── */
(function () {
  var tok  = getToken();
  var user = getUser();
  var btn  = document.getElementById('loginBtn');

  if (tok && user) {
    if (btn) {
      btn.textContent = (user.name || 'USER').toUpperCase() + ' ⏻';
      btn.title = 'Click to log out';
      btn.classList.add('login-btn--logout');
      btn.onclick = logout;
    }
    _currentUserSub = jwtSub(tok);
  } else {
    if (btn) { btn.textContent = 'LOGIN'; btn.onclick = loginWithCasdoor; }
  }

  if (!tok || !isSkillAdminRole(tok)) {
    document.getElementById('accessDenied').style.display = '';
    return;
  }

  document.getElementById('adminPanel').style.display = '';

  var saveBtn  = document.getElementById('treeSaveBtn');
  var resetBtn = document.getElementById('treeResetBtn');
  if (saveBtn)  saveBtn.addEventListener('click', saveSkillTree);
  if (resetBtn) resetBtn.addEventListener('click', initTreeEditor);

  var importBtn  = document.getElementById('treeImportBtn');
  var exportBtn  = document.getElementById('treeExportBtn');
  var importFile = document.getElementById('treeImportFile');
  if (importBtn)  importBtn.addEventListener('click', function () { triggerImport('whole'); });
  if (exportBtn)  exportBtn.addEventListener('click', function () { exportJSON(_treeEditor, 'skill-tree.json'); });
  if (importFile) importFile.addEventListener('change', handleImportFileChange);

  loadAll(tok);
})();
