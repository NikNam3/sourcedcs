// ═══════════════════════════════════════════════════════════
// roster-table.js — member roster: filter, sort, render, per-row actions
//
// Also owns the status/score display helpers (buildStatusBadgeHtml,
// buildScoreCellHtml, trendHtml, formatRelativeTime) since renderTable is
// their primary consumer — activity-heatmap.js's per-member modal header
// also calls buildStatusBadgeHtml/buildScoreCellHtml (a cross-file
// reference, fine since these are all plain globals loaded before any of
// them actually run).
//
// Public API:
//   loadAll(tok) / refreshFromDiscord(tok)
//   renderTable() / populateSquadronFilter() / setSort(key)
//   squadronDisplayName(sqId)
//   formatRelativeTime(iso)
//   buildStatusBadgeHtml(status) / buildScoreCellHtml(m) / trendHtml(delta7d)
// ═══════════════════════════════════════════════════════════

'use strict';

/* ── Data loading ───────────────────────────────────────── */
function loadAll(tok) {
  var headers = authHeaders(tok);
  Promise.all([
    fetch('/api/members',   { headers: headers }).then(function (r) { return r.json(); }),
    fetch('/api/squadrons').then(function (r) { return r.json(); }).catch(function () { return []; }),
    fetch('/api/role-labels', { headers: headers }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
    fetch('/api/skill-pilots', { headers: headers }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
  ]).then(function (results) {
    _members    = Array.isArray(results[0]) ? results[0] : [];
    _squadrons  = Array.isArray(results[1]) ? results[1] : [];
    _roleLabels = Array.isArray(results[2]) ? results[2] : [];
    _pilots     = Object.values(results[3] || {}).sort(function (a, b) {
      return (a.callsign || a.name || '').localeCompare(b.callsign || b.name || '');
    });
    populateSquadronFilter();
    renderSquadronsTable();
    renderTable();
  }).catch(function (err) {
    console.error('[wing-admin] load failed:', err);
    showToast('Failed to load member data', true);
  });
}

function refreshFromDiscord(tok) {
  var btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.textContent = 'REFRESHING…';
  fetch('/api/members/refresh', { method: 'POST', headers: authHeaders(tok) })
    .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.body.error || 'Refresh failed');
      showToast('Refreshed from Discord');
      loadAll(tok);
    })
    .catch(function (err) {
      showToast(err.message || 'Refresh failed', true);
    })
    .finally(function () {
      btn.disabled = false;
      btn.textContent = 'REFRESH FROM DISCORD';
    });
}

/* ── Helpers ────────────────────────────────────────────── */
function squadronDisplayName(sqId) {
  if (!sqId) return null;
  var sq = _squadrons.find(function (s) { return s.id === sqId; });
  return sq ? (sq.designator + ' ' + sq.name) : sqId;
}

/* ── Filtering ──────────────────────────────────────────── */
function filteredMembers() {
  return _members.filter(function (m) {
    if (_search) {
      var hay = (m.callsign + ' ' + m.username + ' ' + m.globalName + ' ' +
        (m.linkedPilot ? m.linkedPilot.name + ' ' + m.linkedPilot.callsign : '')).toLowerCase();
      if (hay.indexOf(_search) === -1) return false;
    }
    /* Any category other than "ALL SQUADRONS" narrows to a specific slice
       of the roster — members who've left Discord are clutter there unless
       that's literally the slice being asked for. */
    if (_filter && _filter !== '__left_discord' && m.status === 'LEFT_DISCORD') return false;
    if (_filter === '__unassigned')    return !m.squadron;
    if (_filter === '__mismatch')      return !!m.nameMismatch;
    if (_filter === '__left_discord')  return m.status === 'LEFT_DISCORD';
    if (_filter === '__stale')         return m.status === 'STALE';
    if (_filter === '__inactive_score') return m.status === 'INACTIVE';
    if (_filter === '__on_vacation')   return m.status === 'ON_VACATION';
    if (_filter)                       return m.squadron === _filter;
    return true;
  });
}

/* ── Sorting ────────────────────────────────────────────── */
var SORT_ACCESSORS = {
  callsign: function (m) { return (m.callsign || m.username || m.id || '').toLowerCase(); },
  discord:  function (m) { return (m.globalName || m.username || '').toLowerCase(); },
  squadron: function (m) { return (squadronDisplayName(m.squadronOverride || m.squadron) || '').toLowerCase(); },
  role:     function (m) { return (m.roleOverride || m.role || '').toLowerCase(); },
  status:   function (m) { return m.status || ''; },
  score:    function (m) { return m.activityScore; },
  vacation: function (m) { return (m.vacations || []).length; },
  voice:    function (m) { return m.inCall ? Infinity : (m.lastCallEnd ? new Date(m.lastCallEnd).getTime() : -Infinity); },
};

function setSort(key) {
  if (_sortKey === key) {
    _sortDir = -_sortDir;
  } else {
    _sortKey = key;
    _sortDir = 1;
  }
  renderTable();
}

function sortMembers(list) {
  var accessor = SORT_ACCESSORS[_sortKey];
  if (!accessor) return list;
  var sorted = list.slice();
  sorted.sort(function (a, b) {
    var av = accessor(a), bv = accessor(b);
    var aEmpty = (av == null || av === '');
    var bEmpty = (bv == null || bv === '');
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;  /* empty/unknown values always sort last */
    if (bEmpty) return -1;
    var cmp = (typeof av === 'number' && typeof bv === 'number') ? (av - bv) : String(av).localeCompare(String(bv));
    return cmp * _sortDir;
  });
  return sorted;
}

function updateSortHeaders() {
  Array.prototype.forEach.call(document.querySelectorAll('#membersTable th.sortable'), function (th) {
    var arrow = th.querySelector('.sort-arrow');
    if (th.dataset.sort === _sortKey) {
      th.classList.add('sort-active');
      arrow.textContent = _sortDir === 1 ? '▲' : '▼';
    } else {
      th.classList.remove('sort-active');
      arrow.textContent = '';
    }
  });
}

function populateSquadronFilter() {
  var sel = document.getElementById('squadronFilter');
  var extraOpts = Array.prototype.slice.call(sel.querySelectorAll('option')).slice(0, 4);
  sel.innerHTML = '';
  extraOpts.forEach(function (o) { sel.appendChild(o); });
  _squadrons.forEach(function (sq) {
    var opt = document.createElement('option');
    opt.value = sq.id;
    opt.textContent = (sq.designator + ' ' + sq.name).toUpperCase();
    sel.appendChild(opt);
  });
}

/* ── Rendering ──────────────────────────────────────────── */
function renderTable() {
  var statusCounts = { ACTIVE: 0, INACTIVE: 0, STALE: 0, ON_VACATION: 0, LEFT_DISCORD: 0 };
  _members.forEach(function (m) { statusCounts[m.status] = (statusCounts[m.status] || 0) + 1; });
  var unassigned = _members.filter(function (m) { return m.active && !m.squadron; }).length;
  var mismatches = _members.filter(function (m) { return m.nameMismatch; }).length;
  document.getElementById('memberSummary').textContent =
    statusCounts.ACTIVE + ' active · ' + statusCounts.INACTIVE + ' inactive · ' +
    statusCounts.STALE + ' stale · ' + statusCounts.ON_VACATION + ' on vacation · ' +
    statusCounts.LEFT_DISCORD + ' left discord · ' +
    unassigned + ' unassigned · ' + mismatches + ' name mismatch' + (mismatches === 1 ? '' : 'es');

  var list = sortMembers(filteredMembers());
  var tbody = document.getElementById('membersBody');
  updateSortHeaders();

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-3)">No members match.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  list.forEach(function (m) {
    var tr = document.createElement('tr');
    if (!m.active) tr.style.opacity = '.5';

    /* Callsign */
    var tdCallsign = document.createElement('td');
    tdCallsign.innerHTML = '<span class="callsign">' + esc(m.callsign || m.username || m.id) + '</span>';
    tr.appendChild(tdCallsign);

    /* Discord identity */
    var tdDiscord = document.createElement('td');
    tdDiscord.innerHTML =
      '<div>' + esc(m.globalName || m.username) + '</div>' +
      '<div style="font-size:9px;color:var(--text-3)">@' + esc(m.username) + '</div>';
    tr.appendChild(tdDiscord);

    /* Squadron assignment */
    var tdSq = document.createElement('td');
    var sqWrap = document.createElement('div');
    sqWrap.style.cssText = 'display:flex;align-items:center;gap:6px';

    var sqSel = document.createElement('select');
    sqSel.className = 'grade-select';
    var autoName = squadronDisplayName(m.autoSquadron);
    var autoOpt = document.createElement('option');
    autoOpt.value = '';
    autoOpt.textContent = m.squadronOverride ? '(auto: ' + (autoName || 'none') + ')' : '(auto)';
    sqSel.appendChild(autoOpt);
    _squadrons.forEach(function (sq) {
      var opt = document.createElement('option');
      opt.value = sq.id;
      opt.textContent = sq.designator + ' ' + sq.name;
      if (m.squadronOverride === sq.id) opt.selected = true;
      sqSel.appendChild(opt);
    });

    var sqBtn = document.createElement('button');
    sqBtn.className = 'btn-sm btn-sm-blue';
    sqBtn.textContent = 'SET';
    sqBtn.title = 'Override automatic squadron assignment for this member';
    (function (member, selEl) {
      sqBtn.addEventListener('click', function () { setMemberSquadron(member.id, selEl.value); });
    })(m, sqSel);

    sqWrap.appendChild(sqSel);
    sqWrap.appendChild(sqBtn);
    tdSq.appendChild(sqWrap);

    var sqNote = document.createElement('div');
    sqNote.style.cssText = 'font-size:8px;color:var(--text-3);margin-top:3px';
    sqNote.textContent = m.squadronOverride
      ? 'OVERRIDE → ' + (squadronDisplayName(m.squadronOverride) || m.squadronOverride)
      : (m.squadron ? 'auto → ' + squadronDisplayName(m.squadron) : 'no squadron');
    tdSq.appendChild(sqNote);
    tr.appendChild(tdSq);

    /* Role assignment */
    var tdRole = document.createElement('td');
    var roleWrap = document.createElement('div');
    roleWrap.style.cssText = 'display:flex;align-items:center;gap:6px';

    var roleSel = document.createElement('select');
    roleSel.className = 'grade-select';
    var autoRoleOpt = document.createElement('option');
    autoRoleOpt.value = '';
    autoRoleOpt.textContent = m.roleOverride ? '(auto: ' + (m.autoRole || 'none') + ')' : '(auto)';
    roleSel.appendChild(autoRoleOpt);
    _roleLabels.forEach(function (label) {
      var opt = document.createElement('option');
      opt.value = label;
      opt.textContent = label;
      if (m.roleOverride === label) opt.selected = true;
      roleSel.appendChild(opt);
    });

    var roleBtn = document.createElement('button');
    roleBtn.className = 'btn-sm btn-sm-blue';
    roleBtn.textContent = 'SET';
    roleBtn.title = 'Override automatic role assignment for this member';
    (function (member, selEl) {
      roleBtn.addEventListener('click', function () { setMemberRole(member.id, selEl.value); });
    })(m, roleSel);

    roleWrap.appendChild(roleSel);
    roleWrap.appendChild(roleBtn);
    tdRole.appendChild(roleWrap);

    var roleNote = document.createElement('div');
    roleNote.style.cssText = 'font-size:8px;color:var(--text-3);margin-top:3px';
    roleNote.textContent = m.roleOverride
      ? 'OVERRIDE → ' + m.roleOverride
      : (m.role ? 'auto → ' + m.role : 'no role');
    tdRole.appendChild(roleNote);
    tr.appendChild(tdRole);

    /* Website account / name mismatch / manual Casdoor link */
    var tdWeb = document.createElement('td');
    if (m.linkedPilot && m.linkedPilot.manual) {
      var manualHtml = m.linkedPilot.pending
        ? '<div style="color:var(--text-3);font-size:9px">linked &middot; awaiting first login</div>'
        : '<div>' + esc(m.linkedPilot.callsign || m.linkedPilot.name) + '</div>' +
          '<div style="font-size:9px;color:var(--blue,#4af)">manually linked</div>';
      tdWeb.innerHTML = manualHtml;
      var unlinkBtn = document.createElement('button');
      unlinkBtn.className = 'btn-sm';
      unlinkBtn.style.marginTop = '4px';
      unlinkBtn.textContent = 'UNLINK';
      (function (member) {
        unlinkBtn.addEventListener('click', function () { unlinkPilotAccount(member); });
      })(m);
      tdWeb.appendChild(unlinkBtn);
    } else if (m.linkedPilot) {
      var webHtml = '<div>' + esc(m.linkedPilot.callsign || m.linkedPilot.name) + '</div>';
      if (m.nameMismatch) {
        webHtml += '<div style="font-size:9px;color:var(--amber)">website: "' + esc(m.linkedPilot.callsign) +
          '" ≠ discord: "' + esc(m.callsign) + '"</div>';
      }
      tdWeb.innerHTML = webHtml;
      if (m.nameMismatch) {
        var syncBtn = document.createElement('button');
        syncBtn.className = 'btn-sm';
        syncBtn.style.marginTop = '4px';
        syncBtn.textContent = 'SYNC TO DISCORD NAME';
        (function (member) {
          syncBtn.addEventListener('click', function () { syncPilotName(member); });
        })(m);
        tdWeb.appendChild(syncBtn);
      }
    } else {
      tdWeb.innerHTML = '<span style="color:var(--text-3);font-size:9px">not registered on website</span>';
      tdWeb.appendChild(buildLinkPicker(m));
    }
    tr.appendChild(tdWeb);

    /* Status: single merged field — LEFT_DISCORD (guild membership) and
       ON_VACATION (admin-marked) override the activity-score-derived
       label (ACTIVE/INACTIVE/STALE), computed server-side in
       computeMemberStatus(). */
    var tdStatus = document.createElement('td');
    tdStatus.innerHTML = buildStatusBadgeHtml(m.status);
    tr.appendChild(tdStatus);

    /* Activity score: percentage + 7-day trend, provisional flag for
       members under 21 days of history. The label itself is shown in
       STATUS above, so it isn't repeated here. */
    var tdScore = document.createElement('td');
    tdScore.innerHTML = buildScoreCellHtml(m);
    tr.appendChild(tdScore);

    /* Vacation: opens the vacation CRUD modal for this member */
    var tdVac = document.createElement('td');
    var vacCount = (m.vacations || []).length;
    var vacBtn = document.createElement('button');
    vacBtn.className = 'btn-sm';
    vacBtn.textContent = vacCount ? 'VACATION (' + vacCount + ')' : 'VACATION';
    (function (member) {
      vacBtn.addEventListener('click', function () { openVacationModal(member); });
    })(m);
    tdVac.appendChild(vacBtn);
    tr.appendChild(tdVac);

    /* Voice activity: last-online status + per-member heatmap */
    var tdVoice = document.createElement('td');
    var lastOnlineEl = document.createElement('div');
    lastOnlineEl.style.cssText = 'font-size:9px;margin-bottom:4px';
    if (m.inCall) {
      lastOnlineEl.innerHTML = '<span style="color:var(--green)">&#9679; IN CALL NOW</span>';
    } else {
      lastOnlineEl.innerHTML = '<span style="color:var(--text-3)">' + esc(formatRelativeTime(m.lastCallEnd)) + '</span>';
    }
    tdVoice.appendChild(lastOnlineEl);
    var hmBtn = document.createElement('button');
    hmBtn.className = 'btn-sm';
    hmBtn.textContent = 'HEATMAP';
    (function (member) {
      hmBtn.addEventListener('click', function () { openHeatmapModal(member); });
    })(m);
    tdVoice.appendChild(hmBtn);
    tr.appendChild(tdVoice);

    tbody.appendChild(tr);
  });
}

/* ── Actions ────────────────────────────────────────────── */
function setMemberSquadron(id, squadronId) {
  var tok = getToken();
  fetch('/api/members/' + encodeURIComponent(id) + '/squadron', {
    method: 'PUT',
    headers: authHeaders(tok, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ squadron_id: squadronId || null }),
  }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.body.error || 'Failed to set squadron');
      var m = _members.find(function (x) { return x.id === id; });
      if (m) {
        m.squadronOverride = res.body.squadron_id;
        m.squadron = res.body.squadron;
      }
      renderTable();
      showToast(squadronId ? 'Squadron override set' : 'Squadron override cleared');
    })
    .catch(function (err) { showToast(err.message || 'Failed to set squadron', true); });
}

function setMemberRole(id, roleLabel) {
  var tok = getToken();
  fetch('/api/members/' + encodeURIComponent(id) + '/role', {
    method: 'PUT',
    headers: authHeaders(tok, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ role: roleLabel || null }),
  }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.body.error || 'Failed to set role');
      var m = _members.find(function (x) { return x.id === id; });
      if (m) {
        m.roleOverride = res.body.role_override;
        m.role = res.body.role;
      }
      renderTable();
      showToast(roleLabel ? 'Role override set' : 'Role override cleared');
    })
    .catch(function (err) { showToast(err.message || 'Failed to set role', true); });
}

function syncPilotName(member) {
  var tok = getToken();
  fetch('/api/skill-pilots/' + encodeURIComponent(member.linkedPilot.sub) + '/name', {
    method: 'PUT',
    headers: authHeaders(tok, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ callsign: member.callsign }),
  }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.body.error || 'Failed to sync name');
      member.linkedPilot.callsign = res.body.callsign;
      member.nameMismatch = false;
      renderTable();
      showToast('Website name synced to Discord');
    })
    .catch(function (err) { showToast(err.message || 'Failed to sync name', true); });
}

/* Builds a small "pick a Casdoor account + link" control for members whose
   website account couldn't be auto-matched (e.g. their Casdoor login name
   shares nothing with their Discord identity). Only accounts that have
   logged in at least once (present in the pilot registry) are selectable. */
function buildLinkPicker(member) {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:4px';

  var sel = document.createElement('select');
  sel.className = 'grade-select';
  var placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = _pilots.length ? 'link Casdoor account…' : 'no logins yet';
  sel.appendChild(placeholder);
  _pilots.forEach(function (p) {
    var opt = document.createElement('option');
    opt.value = p.sub;
    opt.textContent = p.callsign || p.name || p.sub;
    sel.appendChild(opt);
  });

  var btn = document.createElement('button');
  btn.className = 'btn-sm btn-sm-blue';
  btn.textContent = 'LINK';
  btn.addEventListener('click', function () {
    if (!sel.value) return;
    linkPilotAccount(member.id, sel.value);
  });

  wrap.appendChild(sel);
  wrap.appendChild(btn);
  return wrap;
}

function linkPilotAccount(id, sub) {
  var tok = getToken();
  fetch('/api/members/' + encodeURIComponent(id) + '/casdoor-link', {
    method: 'PUT',
    headers: authHeaders(tok, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sub: sub }),
  }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.body.error || 'Failed to link account');
      var m = _members.find(function (x) { return x.id === id; });
      if (m) {
        m.linkedPilot  = res.body.linkedPilot;
        m.nameMismatch = false;
      }
      renderTable();
      showToast('Website account linked');
    })
    .catch(function (err) { showToast(err.message || 'Failed to link account', true); });
}

function unlinkPilotAccount(member) {
  var tok = getToken();
  fetch('/api/members/' + encodeURIComponent(member.id) + '/casdoor-link', {
    method: 'PUT',
    headers: authHeaders(tok, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sub: null }),
  }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.body.error || 'Failed to unlink account');
      var m = _members.find(function (x) { return x.id === member.id; });
      if (m) m.linkedPilot = null;
      renderTable();
      showToast('Website account unlinked');
    })
    .catch(function (err) { showToast(err.message || 'Failed to unlink account', true); });
}

/* ── Status / activity score display ────────────────────── */
function formatRelativeTime(iso) {
  if (!iso) return 'never';
  var ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) ms = 0;
  var min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min + 'm ago';
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  var day = Math.floor(hr / 24);
  if (day < 365) return day + 'd ago';
  return Math.floor(day / 365) + 'y ago';
}

var STATUS_LABEL = {
  ACTIVE:       ['ACTIVE',        'status-active'],
  INACTIVE:     ['INACTIVE',      'status-inactive'],
  STALE:        ['STALE',         'status-stale'],
  ON_VACATION:  ['ON VACATION',   'status-on-vacation'],
  LEFT_DISCORD: ['LEFT DISCORD',  'status-left-discord'],
};
var SCORE_LABEL_CLASS = { active: 'score-active', inactive: 'score-inactive', stale: 'score-stale' };

function buildStatusBadgeHtml(status) {
  var entry = STATUS_LABEL[status] || STATUS_LABEL.ACTIVE;
  return '<span class="status-badge ' + entry[1] + '">' + entry[0] + '</span>';
}

function buildScoreCellHtml(m) {
  if (m.activityScore == null) {
    return '<span style="color:var(--text-3);font-size:9px">&mdash;</span>';
  }
  var pct = Math.round(m.activityScore * 100);
  var labelClass = SCORE_LABEL_CLASS[m.activityLabel] || 'score-inactive';
  var html = '<span class="score-badge ' + labelClass + '">' + pct + '%</span>';
  html += trendHtml(m.activityDelta7d);
  if (m.activityProvisional) {
    html += '<div style="font-size:8px;color:var(--text-3);margin-top:2px">provisional &middot; &lt;21d history</div>';
  }
  return html;
}

function trendHtml(delta7d) {
  if (delta7d == null) return '';
  var deltaPct = Math.round(delta7d * 100);
  var up = deltaPct >= 0;
  return ' <span style="font-size:9px;color:' + (up ? 'var(--green)' : 'var(--red)') + '">' +
    (up ? '&#9650;' : '&#9660;') + (up ? '+' : '') + deltaPct + '</span>';
}
