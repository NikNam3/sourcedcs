'use strict';

/* setTheme, getUser, logout, esc, showToast provided by /js/auth.js */

function jwtSub(token) {
  try {
    var parts = token.split('.');
    var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.sub || null;
  } catch (e) { return null; }
}

/* ── State ──────────────────────────────────────────────── */
var _tree        = null;
var _treeIndex   = null;   /* skillsCore.buildIndex(_tree) */
var _grades      = {};     /* { [gradingItemId]: gradeRec } for the logged-in pilot */
var _requests    = [];
var _mySub       = null;
var _mySquadron  = null;  /* squadron ID from roster, or null */
var _sheetOpenRows      = {};  /* { [moduleId]: bool } — expanded inline detail strip under a leaf row */
var _sheetSectionClosed = {};  /* { [moduleId]: bool } — collapsed sections/sub-headings (default: expanded) */

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
    _mySub = jwtSub(tok);
    if (isSkillAdminRole(tok)) {
      var nav = document.getElementById('mainNav');
      if (nav && !nav.querySelector('.nav-link-admin')) {
        var adminLink = document.createElement('a');
        adminLink.className = 'nav-link nav-link-admin';
        adminLink.href      = 'skills-admin.html';
        adminLink.textContent = 'ADMIN';
        nav.appendChild(adminLink);
      }
    }
    loadAll(tok);
  } else {
    document.getElementById('loginPrompt').style.display = '';
    if (btn) { btn.textContent = 'LOGIN'; btn.onclick = loginWithCasdoor; }
  }
})();

/* ── Data loading ───────────────────────────────────────── */
function loadAll(tok) {
  var headers = authHeaders(tok);
  Promise.all([
    fetch('/api/skill-tree').then(function (r) { return r.json(); }),
    fetch('/api/skill-grades', { headers: headers }).then(function (r) { return r.json(); }),
    fetch('/api/grading-requests', { headers: headers }).then(function (r) { return r.json(); }),
    fetch('/api/my-squadron', { headers: headers }).then(function (r) { return r.json(); }).catch(function () { return { squadron: null }; }),
  ]).then(function (results) {
    _tree = results[0];
    _treeIndex = skillsCore.buildIndex(_tree);
    var gradesMap = results[1];
    _grades      = (_mySub && gradesMap[_mySub]) ? gradesMap[_mySub] : {};
    _requests    = Array.isArray(results[2]) ? results[2] : [];
    _mySquadron  = (results[3] && results[3].squadron) ? results[3].squadron : null;
    render();
  }).catch(function (err) {
    console.error('[skills] load failed:', err);
    showToast('Failed to load skill data', true);
  });
}

/* ── Render ─────────────────────────────────────────────── */
function render() {
  if (!_tree) return;
  renderScoreBar();
  renderTree();
  renderRequests();
  document.getElementById('scoreBar').style.display   = '';
  document.getElementById('skillsBody').style.display = '';
  document.getElementById('loginPrompt').style.display = 'none';
}

function renderScoreBar() {
  var pct = Math.round(skillsCore.overallScore(_treeIndex, _mySquadron, _grades) * 100);
  document.getElementById('overallScore').textContent = pct + '%';

  var catsEl = document.getElementById('scoreCats');
  catsEl.innerHTML = '';
  skillsCore.visibleRootModules(_treeIndex, _mySquadron).forEach(function (root) {
    var total = skillsCore.countVisibleModules(_treeIndex, root, _mySquadron);
    var done  = skillsCore.countVisibleCompletedModules(_treeIndex, root, _mySquadron, _grades);
    var score = Math.round((total ? done / total : 0) * 100);

    var div = document.createElement('div');
    div.className = 'score-cat';
    div.innerHTML =
      '<div class="score-cat-name">' + esc(root.title) + '</div>' +
      '<div class="score-cat-bar"><div class="score-cat-fill" style="width:' + score + '%"></div></div>' +
      '<div class="score-cat-pct">' + done + '/' + total + ' &nbsp; ' + score + '%</div>';
    catsEl.appendChild(div);
  });
}

/* ── Document/report-card view ───────────────────────────── */
/* A pilot's own record reads top-to-bottom like a transcript, not a tool UI:
   root modules are titled sections; nested organizer modules are plain
   sub-headings; only gradable leaves get a dotted leader to a right-aligned
   grade letter/status. Clicking a leaf reveals an inline detail strip
   (description, requirements, request-grading action) instead of every
   module showing that at once — same density fix as the admin outline, in
   a layout that looks like a document rather than a tree-editor tool. */
function renderTree() {
  var el = document.getElementById('skillsTree');
  el.innerHTML = '';
  var sheet = document.createElement('div');
  sheet.className = 'grade-sheet';
  skillsCore.visibleRootModules(_treeIndex, _mySquadron).forEach(function (root) {
    sheet.appendChild(buildSheetNode(root, 0));
  });
  el.appendChild(sheet);
}

/* A module with sub-modules is a section/sub-heading (collapsible, no
   leader/grade of its own — completion is implied by its children, shown
   as a small "done/total" note). A module without sub-modules is a
   gradable leaf. A module can carry both (mixed) — its own grading items
   render first, then its sub-modules recurse. */
function buildSheetNode(node, depth) {
  var hasSub = node.subModules && node.subModules.length;
  var wrap = document.createElement('div');
  wrap.className = 'sheet-node';

  if (!hasSub) {
    wrap.appendChild(buildSheetLeaf(node, depth));
    return wrap;
  }

  var collapsed = !!_sheetSectionClosed[node.id];
  var total     = skillsCore.countModules(node);
  var completed = skillsCore.countCompletedModules(_treeIndex, node, _grades);

  var hdr = document.createElement('div');
  hdr.className = 'sheet-section-hdr' + (depth === 0 ? ' sheet-section-hdr--root' : '');
  hdr.style.paddingLeft = (depth * 18) + 'px';
  hdr.setAttribute('role', 'button');
  hdr.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  hdr.innerHTML =
    '<span class="sheet-toggle">' + (collapsed ? '▸' : '▾') + '</span>' +
    '<span class="sheet-section-title">' + esc(node.title) + '</span>' +
    '<span class="sheet-section-note">' + completed + '/' + total + '</span>';
  (function (id) {
    hdr.addEventListener('click', function () {
      _sheetSectionClosed[id] = !_sheetSectionClosed[id];
      render();
    });
  })(node.id);
  wrap.appendChild(hdr);

  if (!collapsed) {
    var body = document.createElement('div');
    body.className = 'sheet-section-body';
    if (node.gradingItems && node.gradingItems.length) {
      body.appendChild(buildSheetLeaf(node, depth + 1));
    }
    node.subModules.forEach(function (child) {
      body.appendChild(buildSheetNode(child, depth + 1));
    });
    wrap.appendChild(body);
  }

  return wrap;
}

/* A single-item module IS the dotted-leader row (its title carries its own
   grade directly). A multi-item module renders its title as a plain
   sub-line, then one dotted-leader row per item underneath (e.g. "Wing
   Work Exercise" / "Level 1 ... G" / "Level 2 ... G" / "Level 3 ... U") —
   only the title line is clickable to reveal the shared detail strip. */
function buildSheetLeaf(node, depth) {
  var state = skillsCore.moduleState(_treeIndex, node.id, _grades);
  var items = node.gradingItems || [];
  var wrap  = document.createElement('div');
  wrap.className = 'sheet-leaf';

  if (items.length > 1) {
    var titleRow = document.createElement('div');
    titleRow.className = 'sheet-row sheet-row--heading sheet-row--clickable state-' + state;
    titleRow.style.paddingLeft = (depth * 18) + 'px';
    titleRow.innerHTML = '<span class="sheet-row-name">' + esc(node.title) + '</span>';
    (function (id) { titleRow.addEventListener('click', function () { toggleSheetDetail(id); }); })(node.id);
    wrap.appendChild(titleRow);
    items.forEach(function (item) {
      wrap.appendChild(buildSheetGradeRow(item.label || item.id, depth + 1, state, _grades[item.id], null));
    });
  } else {
    wrap.appendChild(buildSheetGradeRow(node.title, depth, state, items[0] ? _grades[items[0].id] : null, node.id));
  }

  if (_sheetOpenRows[node.id]) {
    wrap.appendChild(buildSheetDetailStrip(node, depth));
  }

  return wrap;
}

function buildSheetGradeRow(label, depth, state, gradeRec, clickableModuleId) {
  var row = document.createElement('div');
  row.className = 'sheet-row state-' + state + (clickableModuleId ? ' sheet-row--clickable' : '');
  row.style.paddingLeft = (depth * 18) + 'px';

  var name = document.createElement('span');
  name.className   = 'sheet-row-name';
  name.textContent = label;

  var leader = document.createElement('span');
  leader.className = 'sheet-leader';

  var gradeSpan = document.createElement('span');
  if (gradeRec) {
    gradeSpan.className   = 'sheet-grade grade-' + gradeRec.grade;
    gradeSpan.textContent = gradeRec.grade;
  } else {
    gradeSpan.className   = 'sheet-grade sheet-grade-empty';
    gradeSpan.textContent = (state === 'locked') ? '—' : '·';
  }

  row.appendChild(name);
  row.appendChild(leader);
  row.appendChild(gradeSpan);

  if (clickableModuleId) {
    (function (id) { row.addEventListener('click', function () { toggleSheetDetail(id); }); })(clickableModuleId);
  }

  return row;
}

function toggleSheetDetail(id) {
  _sheetOpenRows[id] = !_sheetOpenRows[id];
  render();
}

function buildSheetDetailStrip(node, depth) {
  var items = node.gradingItems || [];
  var state = skillsCore.moduleState(_treeIndex, node.id, _grades);

  var strip = document.createElement('div');
  strip.className = 'sheet-detail-strip';
  strip.style.paddingLeft = (depth * 18) + 'px';

  if (node.description) {
    var desc = document.createElement('p');
    desc.className   = 'slm-desc';
    desc.textContent = node.description;
    strip.appendChild(desc);
  }

  items.forEach(function (item) {
    var rec = _grades[item.id] || null;
    var labelPart = (items.length > 1) ? ((item.label || item.id) + ' — ') : '';

    var req = document.createElement('div');
    req.className   = 'slm-prereqs';
    req.textContent = labelPart + 'Pass requirement: ' + (item.min_pass_grade || 'G') + ' — ' + (skillsCore.GRADE_NAMES[item.min_pass_grade] || '');
    strip.appendChild(req);

    if (rec) {
      var g = document.createElement('div');
      g.className   = 'slm-prereqs';
      g.textContent = labelPart + 'Current grade: ' + rec.grade + (rec.notes ? ' — "' + rec.notes + '"' : '');
      strip.appendChild(g);
    }
  });

  if (node.requirements && node.requirements.length) {
    var preDiv = document.createElement('div');
    preDiv.className = 'slm-prereqs';
    var preParts = node.requirements.map(function (r) {
      var target = _treeIndex.modules[r.module_id];
      return (target ? target.title : r.module_id) + ' (' + (r.min_grade || 'G') + '+)';
    });
    preDiv.textContent = 'Requires: ' + preParts.join(', ');
    strip.appendChild(preDiv);
  }

  if (state === 'locked') return strip;

  var latestGradedAt = null, latestGradedBy = null;
  items.forEach(function (it) {
    var rec = _grades[it.id];
    if (rec && rec.graded_at) latestGradedAt = rec.graded_at;
    if (rec && rec.graded_by) latestGradedBy = rec.graded_by;
  });
  if (latestGradedBy || latestGradedAt) {
    var gradedBy = document.createElement('div');
    gradedBy.className = 'slm-graded-by';
    var dStr = latestGradedAt ? ' on ' + new Date(latestGradedAt).toLocaleDateString() : '';
    gradedBy.textContent = 'Graded by ' + (latestGradedBy || '—') + dStr;
    strip.appendChild(gradedBy);
  }

  var actDiv = document.createElement('div');
  actDiv.style.marginTop = '10px';

  var myOpenReq = _requests.find(function (r) {
    return r.pilot_id === _mySub && (r.status === 'open' || r.status === 'claimed');
  }) || null;
  var isThisModuleReq = myOpenReq && (!myOpenReq.module_id || myOpenReq.module_id === node.id);
  var allTop = items.length && items.every(function (it) {
    var rec = _grades[it.id];
    return rec && rec.grade === 'E';
  });

  if (isThisModuleReq) {
    var pendingSpan = document.createElement('span');
    pendingSpan.className   = 'grading-pending-notice';
    pendingSpan.textContent = 'GRADING REQUEST ' + myOpenReq.status.toUpperCase();
    var cancelBtn = document.createElement('button');
    cancelBtn.className   = 'btn-cancel-request';
    cancelBtn.textContent = 'CANCEL REQUEST';
    cancelBtn.style.marginLeft = '10px';
    (function (id) { cancelBtn.addEventListener('click', function () { cancelRequest(id); }); })(myOpenReq.id);
    actDiv.appendChild(pendingSpan);
    actDiv.appendChild(cancelBtn);
  } else if (items.length && !allTop) {
    var reqBtn = document.createElement('button');
    reqBtn.className   = 'btn-request-grading';
    reqBtn.textContent = 'REQUEST GRADING';
    (function (mid, mtitle) {
      reqBtn.addEventListener('click', function () { requestGrading(mid, mtitle); });
    })(node.id, node.title);
    actDiv.appendChild(reqBtn);
  }

  strip.appendChild(actDiv);
  return strip;
}

/* ── Requests section ───────────────────────────────────── */
function renderRequests() {
  var myReqs  = _requests.filter(function (r) { return r.pilot_id === _mySub; });
  var section = document.getElementById('requestsSection');
  var list    = document.getElementById('requestsList');

  if (!myReqs.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = '';

  myReqs.slice().reverse().forEach(function (req) {
    var row = document.createElement('div');
    row.className = 'request-row';
    var STATUS_CLASS = { open: 'req-open', claimed: 'req-claimed', closed: 'req-closed' };
    var date = req.requested_at ? new Date(req.requested_at).toLocaleDateString() : '';

    row.innerHTML =
      '<span class="request-status ' + (STATUS_CLASS[req.status] || 'req-closed') + '">' +
        esc(req.status.toUpperCase()) + '</span>' +
      '<span class="request-date">' + esc(date) + '</span>' +
      (req.status === 'claimed' && req.claimed_by_name
        ? '<span class="request-claim-info">Claimed by ' + esc(req.claimed_by_name) + '</span>'
        : '') +
      (!req.discord_message_id && (req.status === 'open' || req.status === 'claimed')
        ? '<span style="font-size:8px;color:var(--text-3)">(Discord not notified)</span>'
        : '');

    if (req.status === 'open') {
      var btn = document.createElement('button');
      btn.className   = 'btn-cancel-request';
      btn.textContent = 'CANCEL';
      (function (id) { btn.addEventListener('click', function () { cancelRequest(id); }); })(req.id);
      row.appendChild(btn);
    }
    list.appendChild(row);
  });
}

/* ── User actions ───────────────────────────────────────── */
function requestGrading(moduleId, moduleTitle) {
  var tok = getToken();
  if (!tok) { showToast('Please log in first', true); return; }

  fetch('/api/grading-requests', {
    method:  'POST',
    headers: authHeaders(tok, { 'Content-Type': 'application/json' }),
    body:    JSON.stringify({ module_id: moduleId || null, module_title: moduleTitle || null }),
  }).then(function (r) {
    if (r.status === 409) { showToast('You already have an open grading request', true); return null; }
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || String(r.status)); });
    return r.json();
  }).then(function (req) {
    if (!req) return;
    _requests.push(req);
    showToast(req.discord_message_id
      ? 'Grading request submitted — instructors notified'
      : 'Grading request submitted (Discord notification skipped — check server config)');
    render();
  }).catch(function (err) { showToast('Error: ' + err.message, true); });
}

function cancelRequest(id) {
  var tok = getToken();
  if (!tok) return;
  fetch('/api/grading-requests/' + id, {
    method:  'DELETE',
    headers: authHeaders(tok),
  }).then(function (r) {
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || String(r.status)); });
    return r.json();
  }).then(function () {
    _requests = _requests.filter(function (r) { return r.id !== id; });
    render();
    showToast('Request cancelled');
  }).catch(function (err) { showToast('Error: ' + err.message, true); });
}

/* esc, showToast provided by /js/auth.js (toast duration now 3000ms, was 4000ms here) */
