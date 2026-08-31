// ═══════════════════════════════════════════════════════════
// pilot-list.js — pilot roster list, grouped by squadron
//
// Public API:
//   renderPilotList()
//   pilotOverallScore(sub)
//   memberForSub(sub) / resolvedCallsign(sub, fallback)
//   pilotSquadron(sub) / squadronDisplayName(sqId) / squadronShortName(sqId)*
//   visibleRootModulesForPilot(sub)
//
// * squadronShortName lives in tree-editor.js (tree-editor-specific naming),
//   not here — this file only has the full-name variant used by pilot rows.
// ═══════════════════════════════════════════════════════════

'use strict';

/* ── Score helpers ──────────────────────────────────────── */
function pilotOverallScore(sub) {
  if (!_treeIndex) return 0;
  return skillsCore.overallScore(_treeIndex, pilotSquadron(sub), _allGrades[sub] || {});
}

/* ── Pilot list ─────────────────────────────────────────── */
function rowGroupKey(sqId) {
  var known = sqId && _squadrons.some(function (s) { return s.id === sqId; });
  return known ? sqId : '__unassigned';
}
function pilotGroupKey(sub) { return rowGroupKey(pilotSquadron(sub)); }

function buildPilotRows() {
  var rows = [];
  var subToRow = {};

  Object.keys(_pilots).forEach(function (sub) {
    var row = {
      key: sub, sub: sub, callsign: resolvedCallsign(sub),
      groupKey: pilotGroupKey(sub), registered: true,
    };
    rows.push(row);
    subToRow[sub] = row;
  });

  _members.forEach(function (m) {
    if (m.active === false) return;
    if (m.linkedPilot) {
      var existing = subToRow[m.linkedPilot.sub];
      if (existing) return;
      rows.push({
        key: m.linkedPilot.sub, sub: m.linkedPilot.sub,
        callsign: m.linkedPilot.callsign || m.callsign, groupKey: rowGroupKey(m.squadron), registered: true,
      });
      return;
    }
    rows.push({
      key: 'm:' + m.id, sub: null, memberId: m.id,
      callsign: m.callsign || m.username || m.id, groupKey: rowGroupKey(m.squadron), registered: false,
    });
  });

  return rows;
}

function renderPilotList() {
  var el   = document.getElementById('pilotList');
  var rows = buildPilotRows();

  if (!rows.length) {
    el.innerHTML = '<div class="skills-empty" style="padding:12px 16px;font-size:9px">No members found.</div>';
    return;
  }

  var groups     = _squadrons.map(function (sq) {
    return { key: sq.id, name: (sq.designator + ' ' + sq.name).toUpperCase(), rows: [] };
  });
  var groupByKey = {};
  groups.forEach(function (g) { groupByKey[g.key] = g; });
  var unassigned = { key: '__unassigned', name: 'UNASSIGNED', rows: [] };

  rows.forEach(function (row) {
    var group = groupByKey[row.groupKey] || unassigned;
    group.rows.push(row);
  });

  groups = groups.filter(function (g) { return g.rows.length; });
  if (unassigned.rows.length) groups.push(unassigned);

  groups.forEach(function (g) {
    g.rows.sort(function (a, b) {
      var ca = a.callsign.toLowerCase();
      var cb = b.callsign.toLowerCase();
      return ca < cb ? -1 : (ca > cb ? 1 : 0);
    });
  });

  el.innerHTML = '';
  groups.forEach(function (g) {
    if (!Object.prototype.hasOwnProperty.call(_sqGroupCollapsed, g.key)) {
      _sqGroupCollapsed[g.key] = true;
    }
    var collapsed = !!_sqGroupCollapsed[g.key];

    var groupHdr = document.createElement('div');
    groupHdr.className = 'skill-list-cat-header';
    groupHdr.style.cursor = 'pointer';
    groupHdr.innerHTML =
      '<span class="slc-toggle">' + (collapsed ? '▶' : '▼') + '</span>' +
      '<span class="slc-name">' + esc(g.name) + '</span>' +
      '<span class="slc-count">' + g.rows.length + '</span>';
    (function (key) {
      groupHdr.addEventListener('click', function () {
        _sqGroupCollapsed[key] = !_sqGroupCollapsed[key];
        renderPilotList();
      });
    })(g.key);
    el.appendChild(groupHdr);

    if (collapsed) return;

    g.rows.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'pilot-row' + (r.key === _activeSub ? ' active' : '') + (r.registered ? '' : ' pilot-row--unregistered');
      row.setAttribute('data-sub', r.key);
      var scoreHtml = r.registered
        ? '<span class="pilot-row-score">' + Math.round(pilotOverallScore(r.sub) * 100) + '%</span>'
        : '<span class="pilot-row-score pilot-row-squadron--none" title="Hasn\'t logged into the training page yet">—</span>';
      row.innerHTML = '<span class="pilot-row-callsign">' + esc(r.callsign) + '</span>' + scoreHtml;
      if (r.registered) {
        (function (s) { row.addEventListener('click', function () { selectPilot(s); }); })(r.sub);
      } else {
        (function (id) { row.addEventListener('click', function () { selectGhostMember(id); }); })(r.memberId);
      }
      el.appendChild(row);
    });
  });
}

/* ── Identity resolution ────────────────────────────────────── */
function memberForSub(sub) {
  return _members.find(function (m) { return m.linkedPilot && m.linkedPilot.sub === sub; }) || null;
}
function resolvedCallsign(sub, fallback) {
  var m = memberForSub(sub);
  if (m && m.callsign) return m.callsign;
  var p = _pilots[sub];
  if (p && (p.callsign || p.name)) return p.callsign || p.name;
  return fallback || sub;
}

/* ── Squadron helpers ───────────────────────────────────────── */
function pilotSquadron(sub) {
  return _pilotSquadrons[sub] || null;
}

function squadronDisplayName(sqId) {
  if (!sqId) return null;
  var sq = _squadrons.find(function (s) { return s.id === sqId; });
  return sq ? (sq.designator + ' ' + sq.name) : sqId;
}

function visibleRootModulesForPilot(sub) {
  if (!_treeIndex) return [];
  return skillsCore.visibleRootModules(_treeIndex, pilotSquadron(sub));
}
