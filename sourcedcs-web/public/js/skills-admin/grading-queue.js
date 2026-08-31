// ═══════════════════════════════════════════════════════════
// grading-queue.js — pending grading requests queue (admin view)
//
// Public API:
//   renderGradingQueue()
//   claimRequest(id) / unclaimRequest(id) / deleteRequest(id)
// ═══════════════════════════════════════════════════════════

'use strict';

/* ── Grading queue ──────────────────────────────────────── */
function renderGradingQueue() {
  var el   = document.getElementById('gradingQueue');
  var open = _requests.filter(function (r) { return r.status === 'open' || r.status === 'claimed'; });

  if (!open.length) {
    el.innerHTML = '<div class="skills-empty" style="padding:12px 16px;font-size:9px">No open requests.</div>';
    return;
  }

  el.innerHTML = '';
  open.forEach(function (req) {
    var row = document.createElement('div');
    row.className = 'req-queue-row';
    var statusClass = req.status === 'claimed' ? 'req-claimed' : 'req-open';
    var time = req.requested_at ? new Date(req.requested_at).toLocaleDateString() : '';
    var discordOk = req.discord_message_id ? '' :
      '<span style="font-size:7px;color:var(--text-3);display:block">no discord</span>';

    var infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'flex:1;min-width:0';
    var claimedByHtml = (req.status === 'claimed' && req.claimed_by_name)
      ? '<div style="font-size:8px;color:var(--text-2);margin-top:2px">Claimed by ' + esc(req.claimed_by_name) + '</div>'
      : '';
    var moduleHtml = req.module_title
      ? '<div style="font-size:8px;color:var(--text-2);margin-top:1px">' + esc(req.module_title) + '</div>'
      : '';
    infoDiv.innerHTML =
      '<div style="display:flex;align-items:center;gap:6px">' +
        '<span class="request-status ' + statusClass + '">' + esc(req.status.toUpperCase()) + '</span>' +
        '<span class="req-queue-callsign">' + esc(resolvedCallsign(req.pilot_id, req.pilot_callsign || req.pilot_name)) + '</span>' +
      '</div>' +
      moduleHtml +
      claimedByHtml +
      '<div class="req-queue-time">' + esc(time) + discordOk + '</div>';
    row.appendChild(infoDiv);

    var actDiv = document.createElement('div');
    actDiv.style.cssText = 'display:flex;flex-direction:column;gap:3px;flex-shrink:0';

    if (req.status === 'open') {
      var claimBtn = document.createElement('button');
      claimBtn.className = 'btn-sm btn-sm-blue';
      claimBtn.textContent = 'CLAIM';
      (function (id) { claimBtn.addEventListener('click', function () { claimRequest(id); }); })(req.id);
      actDiv.appendChild(claimBtn);
    }

    if (req.status === 'claimed' && req.claimed_by === _currentUserSub) {
      var unclaimBtn = document.createElement('button');
      unclaimBtn.className = 'btn-sm';
      unclaimBtn.textContent = 'UNCLAIM';
      (function (id) { unclaimBtn.addEventListener('click', function () { unclaimRequest(id); }); })(req.id);
      actDiv.appendChild(unclaimBtn);
    }

    var viewBtn = document.createElement('button');
    viewBtn.className = 'btn-sm';
    viewBtn.textContent = 'VIEW';
    (function (pid, mid) {
      viewBtn.addEventListener('click', function () {
        selectPilot(pid);
        if (mid && _treeIndex.modules[mid]) {
          expandGradePathTo(mid);
          renderGradeOutline();
          var target = document.querySelector('#gradeOutline .grade-outline-node[data-node-id="' + mid + '"]');
          if (target) {
            target.scrollIntoView({ block: 'center' });
            target.classList.add('grade-outline-flash');
            setTimeout(function () { target.classList.remove('grade-outline-flash'); }, 1500);
          }
        }
      });
    })(req.pilot_id, req.module_id);
    actDiv.appendChild(viewBtn);

    var delBtn = document.createElement('button');
    delBtn.className = 'btn-sm btn-sm-danger';
    delBtn.textContent = 'DELETE';
    (function (id) { delBtn.addEventListener('click', function () { deleteRequest(id); }); })(req.id);
    actDiv.appendChild(delBtn);

    row.appendChild(actDiv);
    el.appendChild(row);
  });
}

/* ── Grading request actions ────────────────────────────── */
function claimRequest(id) {
  var tok = getToken();
  fetch('/api/grading-requests/' + id + '/claim', {
    method:  'PUT',
    headers: authHeaders(tok, { 'Content-Type': 'application/json' }),
    body:    JSON.stringify({}),
  }).then(function (r) {
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || String(r.status)); });
    return r.json();
  }).then(function (updated) {
    var idx = _requests.findIndex(function (r) { return r.id === id; });
    if (idx !== -1) _requests[idx] = updated;
    renderGradingQueue();
    showToast('Request claimed');
  }).catch(function (err) { showToast('Error: ' + err.message, true); });
}

function unclaimRequest(id) {
  var tok = getToken();
  fetch('/api/grading-requests/' + id + '/unclaim', {
    method:  'PUT',
    headers: authHeaders(tok, { 'Content-Type': 'application/json' }),
    body:    JSON.stringify({}),
  }).then(function (r) {
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || String(r.status)); });
    return r.json();
  }).then(function (updated) {
    var idx = _requests.findIndex(function (r) { return r.id === id; });
    if (idx !== -1) _requests[idx] = updated;
    renderGradingQueue();
    showToast('Request unclaimed');
  }).catch(function (err) { showToast('Error: ' + err.message, true); });
}

function deleteRequest(id) {
  if (!confirm('Delete this grading request?')) return;
  var tok = getToken();
  fetch('/api/grading-requests/' + id, {
    method:  'DELETE',
    headers: authHeaders(tok),
  }).then(function (r) {
    if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || String(r.status)); });
    return r.json();
  }).then(function () {
    _requests = _requests.filter(function (r) { return r.id !== id; });
    renderGradingQueue();
    showToast('Request deleted');
  }).catch(function (err) { showToast('Error: ' + err.message, true); });
}
