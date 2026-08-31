// ═══════════════════════════════════════════════════════════
// pilot-detail.js — pilot detail panel + inline grading outline
//
// A single collapsible outline where every LEAF module (bottom layer — a
// module with grading items and no sub-modules) shows its grade
// select/comment/save controls inline, right under its row. Reads from the
// published _treeIndex (not the unsaved _treeEditor draft).
//
// Public API:
//   selectPilot(sub) / refreshActiveDetail() / selectGhostMember(memberId)
//   deletePilot(sub, callsign)
//   saveGrade(sub, itemId, grade, notes) / clearGrade(sub, itemId)
//   expandGradePathTo(id) / renderGradeOutline()   — used by grading-queue.js
// ═══════════════════════════════════════════════════════════

'use strict';

/* ── Pilot detail ───────────────────────────────────────── */
function selectPilot(sub) {
  if (_activeSub !== sub) {
    /* Switching pilots — start the grading outline fresh. A same-pilot
       re-render (e.g. right after saveGrade/clearGrade) must NOT reset
       this, or every branch the admin had open would collapse back shut
       every time they save a grade. */
    _gradeOutlineExpanded = {};
  }
  _activeSub = sub;

  var groupKey = pilotGroupKey(sub);
  if (_sqGroupCollapsed[groupKey]) {
    _sqGroupCollapsed[groupKey] = false;
    renderPilotList();
  } else {
    document.querySelectorAll('.pilot-row').forEach(function (r) {
      r.classList.toggle('active', r.getAttribute('data-sub') === sub);
    });
  }

  var pilot    = _pilots[sub] || { sub: sub, name: sub, callsign: sub };
  var callsign = resolvedCallsign(sub);
  var grades   = _allGrades[sub] || {};
  var score    = Math.round(pilotOverallScore(sub) * 100);
  var sqId     = pilotSquadron(sub);
  var sqName   = squadronDisplayName(sqId);
  var el       = document.getElementById('pilotDetail');
  el.innerHTML = '';

  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:24px;padding-bottom:12px;border-bottom:1px solid var(--border)';

  var callsignSpan = document.createElement('span');
  callsignSpan.style.cssText = 'font-family:Orbitron,monospace;font-weight:900;font-size:16px;letter-spacing:3px';
  callsignSpan.textContent = callsign;

  var nameSpan = document.createElement('span');
  nameSpan.style.cssText = 'font-size:10px;color:var(--text-3)';
  nameSpan.textContent = pilot.name || '';

  var sqBadge = document.createElement('span');
  sqBadge.className = sqName ? 'pilot-detail-squadron' : 'pilot-detail-squadron pilot-detail-squadron--none';
  sqBadge.textContent = sqName || 'NO SQUADRON';

  var scoreSpan = document.createElement('span');
  scoreSpan.style.cssText = 'font-family:Orbitron,monospace;font-weight:700;font-size:20px;color:var(--green);margin-left:auto';
  scoreSpan.textContent = score + '%';

  var delPilotBtn = document.createElement('button');
  delPilotBtn.className   = 'btn-sm btn-sm-danger';
  delPilotBtn.textContent = 'DELETE PILOT';
  delPilotBtn.title       = 'Permanently remove this pilot and all their grades';
  (function (s, cs) {
    delPilotBtn.addEventListener('click', function () { deletePilot(s, cs); });
  })(sub, callsign);

  hdr.appendChild(callsignSpan);
  hdr.appendChild(nameSpan);
  hdr.appendChild(sqBadge);
  hdr.appendChild(scoreSpan);
  hdr.appendChild(delPilotBtn);
  el.appendChild(hdr);

  var sqOverrideRow = document.createElement('div');
  sqOverrideRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:16px;padding:8px 10px;background:var(--surface-2,rgba(255,255,255,.04));border:1px solid var(--border);border-radius:3px';
  sqOverrideRow.innerHTML =
    '<span style="font-size:9px;letter-spacing:1px;color:var(--text-3)">SQUADRON</span>' +
    '<span style="font-size:10px;flex:1">' + esc(sqName || 'unassigned') + '</span>' +
    '<a class="btn-sm" href="wing-admin.html">MANAGE ON WING ADMIN &rarr;</a>';
  el.appendChild(sqOverrideRow);

  var outlinePane = document.createElement('div');
  outlinePane.className = 'grade-outline-pane grade-outline-pane--full';
  outlinePane.id = 'gradeOutline';
  el.appendChild(outlinePane);

  renderGradeOutline();
}

function refreshActiveDetail() {
  if (!_activeSub) return;
  if (_pilots[_activeSub]) selectPilot(_activeSub);
  else if (_activeSub.indexOf('m:') === 0) selectGhostMember(_activeSub.slice(2));
}

function selectGhostMember(memberId) {
  var key = 'm:' + memberId;
  _activeSub = key;

  var member  = _members.find(function (m) { return m.id === memberId; }) || {};
  var groupKey = rowGroupKey(member.squadron);
  if (_sqGroupCollapsed[groupKey]) {
    _sqGroupCollapsed[groupKey] = false;
    renderPilotList();
  } else {
    document.querySelectorAll('.pilot-row').forEach(function (r) {
      r.classList.toggle('active', r.getAttribute('data-sub') === key);
    });
  }

  var sqName = squadronDisplayName(member.squadron);
  var el = document.getElementById('pilotDetail');
  el.innerHTML =
    '<div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:24px;padding-bottom:12px;border-bottom:1px solid var(--border)">' +
      '<span style="font-family:Orbitron,monospace;font-weight:900;font-size:16px;letter-spacing:3px">' + esc(member.callsign || memberId) + '</span>' +
      '<span style="font-size:10px;color:var(--text-3)">' + esc(member.globalName || '') + '</span>' +
      '<span class="' + (sqName ? 'pilot-detail-squadron' : 'pilot-detail-squadron pilot-detail-squadron--none') + '">' + esc(sqName || 'NO SQUADRON') + '</span>' +
    '</div>' +
    '<p class="skills-empty">This member hasn\'t logged into the Training page yet — there are no skill grades to show. ' +
    'Once they log in and visit /skills.html at least once, they\'ll appear here as a gradable pilot record.</p>';
}

/* ══════════════════════════════════════════════════════════
   Pilot grading outline
══════════════════════════════════════════════════════════ */
function gradeNodeExpanded(node, depth) {
  if (Object.prototype.hasOwnProperty.call(_gradeOutlineExpanded, node.id)) return _gradeOutlineExpanded[node.id];
  return depth === 0;
}

function expandGradePathTo(id) {
  var cur = _treeIndex.parentOf[id];
  while (cur) {
    _gradeOutlineExpanded[cur] = true;
    cur = _treeIndex.parentOf[cur];
  }
}

/* Compact right-aligned status chip for one outline header row: module-
   count fraction for anything with sub-modules, else a grade letter
   (single item) or an items-passed fraction (multi item) — quick-glance
   summary shown above the full inline controls on leaf rows. */
function gradeOutlineChip(node, grades) {
  var hasSub = node.subModules && node.subModules.length;
  if (hasSub) {
    var total     = skillsCore.countModules(node);
    var completed = skillsCore.countCompletedModules(_treeIndex, node, grades);
    return '<span class="grade-chip-frac">' + completed + '/' + total + '</span>';
  }
  var items = node.gradingItems || [];
  if (items.length === 1) {
    var rec = grades[items[0].id];
    return rec
      ? '<span class="grade-chip grade-' + rec.grade + '">' + esc(rec.grade) + '</span>'
      : '<span class="grade-chip grade-chip-empty">—</span>';
  }
  if (items.length > 1) {
    var done = items.filter(function (it) {
      var r = grades[it.id];
      return r && skillsCore.gradeValue(r.grade) >= skillsCore.gradeValue(it.min_pass_grade);
    }).length;
    return '<span class="grade-chip-frac">' + done + '/' + items.length + '</span>';
  }
  return '';
}

function renderGradeOutline() {
  var el = document.getElementById('gradeOutline');
  if (!el || !_activeSub) return;
  el.innerHTML = '';

  var grades = _allGrades[_activeSub] || {};
  var list = document.createElement('div');
  list.className = 'tree-outline-list';
  visibleRootModulesForPilot(_activeSub).forEach(function (root) {
    list.appendChild(buildGradeOutlineNode(root, 0, grades));
  });
  el.appendChild(list);
}

/* One node = a header row (toggle+icon+title+chip) plus, for a leaf
   module, its inline grading block right underneath — or, for a module
   with sub-modules, its expanded children (and, if mixed, its own inline
   grading block first). */
function buildGradeOutlineNode(node, depth, grades) {
  var hasSub = node.subModules && node.subModules.length;
  var wrap = document.createElement('div');
  wrap.className = 'grade-outline-node';
  wrap.setAttribute('data-node-id', node.id);

  if (!hasSub) {
    wrap.appendChild(buildGradeHeaderRow(node, depth, grades, false, false));
    wrap.appendChild(buildGradeLeafBlock(node, depth, grades));
    return wrap;
  }

  var expanded = gradeNodeExpanded(node, depth);
  wrap.appendChild(buildGradeHeaderRow(node, depth, grades, true, expanded));

  if (expanded) {
    var body = document.createElement('div');
    body.className = 'grade-outline-body';
    if (node.gradingItems && node.gradingItems.length) {
      body.appendChild(buildGradeLeafBlock(node, depth + 1, grades));
    }
    node.subModules.forEach(function (child) {
      body.appendChild(buildGradeOutlineNode(child, depth + 1, grades));
    });
    wrap.appendChild(body);
  }

  return wrap;
}

function buildGradeHeaderRow(node, depth, grades, hasToggle, expanded) {
  var state = skillsCore.moduleState(_treeIndex, node.id, grades);
  var row = document.createElement('div');
  row.className = 'pilot-row outline-row grade-outline-row state-' + state;
  row.style.paddingLeft = (10 + depth * 16) + 'px';

  var toggle = document.createElement('span');
  toggle.className   = 'outline-toggle';
  toggle.textContent = hasToggle ? (expanded ? '▼' : '▶') : '·';
  if (hasToggle) {
    row.style.cursor = 'pointer';
    (function (id) {
      row.addEventListener('click', function () {
        _gradeOutlineExpanded[id] = !gradeNodeExpanded(node, depth);
        renderGradeOutline();
      });
    })(node.id);
  }

  var icon = document.createElement('span');
  icon.className = 'grade-outline-icon';
  var ICONS = { locked: '—', 'not-started': '○', 'in-progress': '◑', completed: '✓' };
  icon.textContent = ICONS[state] || '○';

  var label = document.createElement('span');
  label.className   = 'outline-row-label';
  label.textContent = node.title || '(untitled)';

  var chip = document.createElement('span');
  chip.innerHTML = gradeOutlineChip(node, grades);

  row.appendChild(toggle);
  row.appendChild(icon);
  row.appendChild(label);
  row.appendChild(chip);

  return row;
}

/* The always-visible, no-extra-click grading area for one leaf module:
   requirements for context (descriptions are for the pilot's own record,
   not needed on the grading sheet), then one grade line per grading item —
   select + comment + clear, reachable directly instead of behind a
   detail-panel selection. */
function buildGradeLeafBlock(node, depth, grades) {
  var block = document.createElement('div');
  block.className = 'grade-leaf-block';
  block.style.paddingLeft = (10 + depth * 16 + 16) + 'px';

  if (node.requirements && node.requirements.length) {
    var reqDiv = document.createElement('div');
    reqDiv.className = 'grade-leaf-reqs';
    var parts = node.requirements.map(function (r) {
      var target = _treeIndex.modules[r.module_id];
      var eg     = skillsCore.effectiveModuleGrade(_treeIndex, r.module_id, grades);
      var met    = skillsCore.gradeValue(eg) >= skillsCore.gradeValue(r.min_grade);
      return (target ? target.title : r.module_id) + ' (' + (r.min_grade || 'G') + '+)' + (met ? ' ✓' : ' ✗');
    });
    reqDiv.textContent = 'Requires: ' + parts.join(', ');
    block.appendChild(reqDiv);
  }

  var items = node.gradingItems || [];
  items.forEach(function (item) {
    block.appendChild(buildGradeItemControls(item, grades, _activeSub, items.length > 1));
  });

  return block;
}

/* One line per grading item: a compact grade select that saves itself on
   change (no separate SAVE button to click), a note-toggle icon that only
   reveals a comment field when there's actually something to say (dot
   marks one that already has a comment), and a small × to clear. No
   bordered "card" — the functionality (grade + comment) doesn't need a box
   around every single item to exist. */
function buildGradeItemControls(item, grades, sub, showLabel) {
  var gradeRec = grades[item.id] || null;

  var wrap = document.createElement('div');
  wrap.className = 'grade-item-row';

  var line = document.createElement('div');
  line.className = 'grade-item-line';

  if (showLabel) {
    var lbl = document.createElement('span');
    lbl.className   = 'grade-item-label';
    lbl.textContent = item.label || item.id;
    line.appendChild(lbl);
  }

  /* Dotted leader — always present, even on a single-item row with no
     label — so the select/comment/clear cluster lands on the same right
     edge on every row, at every depth, regardless of label length or
     indentation. That's what makes this read as a grading sheet's aligned
     grade column instead of controls trailing wherever the text ends. */
  var leader = document.createElement('span');
  leader.className = 'grade-item-leader';
  line.appendChild(leader);

  var sel = document.createElement('select');
  sel.className = 'grade-select grade-item-select';
  var opts = '<option value="">—</option>';
  ['U', 'F', 'G', 'E'].forEach(function (g) {
    var selected = (gradeRec && gradeRec.grade === g) ? ' selected' : '';
    opts += '<option value="' + g + '"' + selected + '>' + g + '</option>';
  });
  sel.innerHTML = opts;
  sel.title = gradeRec
    ? ((skillsCore.GRADE_NAMES[gradeRec.grade] || '') +
       (gradeRec.graded_by ? ' — graded by ' + gradeRec.graded_by : '') +
       (gradeRec.graded_at ? ' on ' + new Date(gradeRec.graded_at).toLocaleDateString() : ''))
    : 'Not graded';
  line.appendChild(sel);

  var noteRow = document.createElement('div');
  noteRow.className = 'grade-note-row';
  noteRow.style.display = 'none';
  var noteInput = document.createElement('input');
  noteInput.type        = 'text';
  noteInput.className   = 'grade-notes-input';
  noteInput.placeholder = 'Comment (optional)';
  noteInput.value       = gradeRec ? (gradeRec.notes || '') : '';
  noteRow.appendChild(noteInput);

  var noteBtn = document.createElement('button');
  noteBtn.type = 'button';
  noteBtn.className = 'grade-note-toggle' + (gradeRec && gradeRec.notes ? ' has-note' : '');
  noteBtn.textContent = '💬';
  noteBtn.title = (gradeRec && gradeRec.notes) ? gradeRec.notes : 'Add comment';
  noteBtn.addEventListener('click', function () {
    var open = noteRow.style.display !== 'none';
    noteRow.style.display = open ? 'none' : '';
    if (!open) noteInput.focus();
  });
  line.appendChild(noteBtn);

  var clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'grade-item-clear';
  clearBtn.textContent = '×';
  clearBtn.title = 'Clear grade';
  clearBtn.style.visibility = gradeRec ? 'visible' : 'hidden';
  (function (s, iid) {
    clearBtn.addEventListener('click', function () { clearGrade(s, iid); });
  })(sub, item.id);
  line.appendChild(clearBtn);

  (function (s, iid, selEl, noteEl) {
    selEl.addEventListener('change', function () {
      if (!selEl.value) return;
      saveGrade(s, iid, selEl.value, noteEl.value);
    });
    noteEl.addEventListener('change', function () {
      if (!selEl.value) { showToast('Select a grade before adding a comment', true); return; }
      saveGrade(s, iid, selEl.value, noteEl.value);
    });
  })(sub, item.id, sel, noteInput);

  wrap.appendChild(line);
  wrap.appendChild(noteRow);
  return wrap;
}

/* ── Pilot delete ───────────────────────────────────────── */
function deletePilot(sub, callsign) {
  var confirm1 = confirm(
    'DELETE PILOT: ' + callsign + '\n\n' +
    'This will permanently remove the pilot and ALL their skill grades and grading requests.\n\n' +
    'This cannot be undone. Are you sure?'
  );
  if (!confirm1) return;

  var typed = prompt('Type the callsign "' + callsign + '" to confirm deletion:');
  if (typed === null) return;
  if (typed.trim() !== callsign) { showToast('Callsign did not match — pilot not deleted', true); return; }

  var tok = getToken();
  fetch('/api/skill-pilots/' + encodeURIComponent(sub), {
    method:  'DELETE',
    headers: authHeaders(tok),
  }).then(function (r) {
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || String(r.status)); });
    return r.json();
  }).then(function () {
    delete _pilots[sub];
    delete _allGrades[sub];
    _requests = _requests.filter(function (r) { return r.pilot_id !== sub; });
    _activeSub = null;
    document.getElementById('pilotDetail').innerHTML = '';
    renderPilotList();
    renderGradingQueue();
    showToast('Pilot deleted');
  }).catch(function (err) { showToast('Error: ' + err.message, true); });
}

/* ── Grade API calls ────────────────────────────────────── */
function saveGrade(sub, itemId, grade, notes) {
  var tok = getToken();
  fetch('/api/skill-grades/' + encodeURIComponent(sub) + '/' + encodeURIComponent(itemId), {
    method:  'PUT',
    headers: authHeaders(tok, { 'Content-Type': 'application/json' }),
    body:    JSON.stringify({ grade: grade, notes: notes }),
  }).then(function (r) {
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || String(r.status)); });
    return r.json();
  }).then(function (gradeRec) {
    if (!_allGrades[sub]) _allGrades[sub] = {};
    _allGrades[sub][itemId] = gradeRec;
    var parentModuleId = (_treeIndex.itemOwner[itemId]) || itemId;
    _requests = _requests.filter(function (r) {
      return !(r.pilot_id === sub && (r.module_id === parentModuleId || !r.module_id));
    });
    renderPilotList();
    renderGradingQueue();
    selectPilot(sub);
    showToast('Grade saved');
  }).catch(function (err) { showToast('Error: ' + err.message, true); });
}

function clearGrade(sub, itemId) {
  var tok = getToken();
  fetch('/api/skill-grades/' + encodeURIComponent(sub) + '/' + encodeURIComponent(itemId), {
    method:  'DELETE',
    headers: authHeaders(tok),
  }).then(function (r) {
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || String(r.status)); });
    return r.json();
  }).then(function () {
    if (_allGrades[sub]) delete _allGrades[sub][itemId];
    renderPilotList();
    selectPilot(sub);
    showToast('Grade cleared');
  }).catch(function (err) { showToast('Error: ' + err.message, true); });
}
