// ═══════════════════════════════════════════════════════════
// role-sort-modal.js — roster role sort order editor
//
// Public API:
//   openRoleSortModal() / closeRoleSortModal()
//   moveRsoEntry(i, dir) / addRoleSortEntry(e) / saveRoleSortOrder()
// ═══════════════════════════════════════════════════════════

'use strict';

var rsoEntries = []; /* working copy: ordered array of role label strings, most senior first */

function openRoleSortModal() {
  rsoEntries = [];
  document.getElementById('rsoAddError').style.display = 'none';
  document.getElementById('rsoSaveError').style.display = 'none';
  document.getElementById('rsoAddForm').reset();
  openModal('rsoModalOverlay');
  fetch('/api/role-sort-order').then(function (r) {
    if (!r.ok) throw new Error('Failed to load');
    return r.json();
  }).then(function (data) {
    rsoEntries = Array.isArray(data) ? data.slice() : [];
    renderRsoList();
  }).catch(function () {
    document.getElementById('rsoSaveError').textContent = 'Failed to load current sort order.';
    document.getElementById('rsoSaveError').style.display = '';
  });
}

function closeRoleSortModal() {
  closeModal('rsoModalOverlay');
}

function renderRsoList() {
  var container = document.getElementById('rsoList');
  if (!rsoEntries.length) {
    container.innerHTML = '<div style="color:var(--text-3);font-size:13px;padding:8px 0">No roles configured &mdash; all roles will sort in whatever order the roster returns them. Add entries below.</div>';
    return;
  }
  container.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
    '<thead><tr>' +
    '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text-2)">#</th>' +
    '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text-2)">ROLE LABEL</th>' +
    '<th style="padding:6px 8px;border-bottom:1px solid var(--border)"></th>' +
    '</tr></thead><tbody>' +
    rsoEntries.map(function (role, i) {
      return '<tr>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text-3)">' + (i + 1) + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + esc(role) + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap">' +
          '<button class="btn-sm" data-rso-up="' + i + '"' + (i === 0 ? ' disabled' : '') + '>&#x25B2;</button> ' +
          '<button class="btn-sm" data-rso-down="' + i + '"' + (i === rsoEntries.length - 1 ? ' disabled' : '') + '>&#x25BC;</button> ' +
          '<button class="btn-sm btn-sm-danger" data-rso-del="' + i + '">&#x2715;</button>' +
        '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>';
  Array.prototype.forEach.call(container.querySelectorAll('[data-rso-up]'), function (btn) {
    btn.addEventListener('click', function () { moveRsoEntry(Number(btn.dataset.rsoUp), -1); });
  });
  Array.prototype.forEach.call(container.querySelectorAll('[data-rso-down]'), function (btn) {
    btn.addEventListener('click', function () { moveRsoEntry(Number(btn.dataset.rsoDown), 1); });
  });
  Array.prototype.forEach.call(container.querySelectorAll('[data-rso-del]'), function (btn) {
    btn.addEventListener('click', function () { rsoEntries.splice(Number(btn.dataset.rsoDel), 1); renderRsoList(); });
  });
}

function moveRsoEntry(i, dir) {
  var j = i + dir;
  if (j < 0 || j >= rsoEntries.length) return;
  var tmp = rsoEntries[i];
  rsoEntries[i] = rsoEntries[j];
  rsoEntries[j] = tmp;
  renderRsoList();
}

function addRoleSortEntry(e) {
  e.preventDefault();
  var errEl = document.getElementById('rsoAddError');
  var input = document.getElementById('rsoRoleLabel');
  var role  = input.value.trim();
  if (!role) {
    errEl.textContent = 'Role label is required.';
    errEl.style.display = '';
    return;
  }
  if (rsoEntries.some(function (r) { return r.toLowerCase() === role.toLowerCase(); })) {
    errEl.textContent = '"' + role + '" is already in the list.';
    errEl.style.display = '';
    return;
  }
  errEl.style.display = 'none';
  rsoEntries.push(role);
  document.getElementById('rsoAddForm').reset();
  renderRsoList();
}

function saveRoleSortOrder() {
  var btn   = document.getElementById('rsoSaveBtn');
  var errEl = document.getElementById('rsoSaveError');
  btn.disabled    = true;
  btn.textContent = 'SAVING...';
  errEl.style.display = 'none';
  fetch('/api/role-sort-order', {
    method:  'PUT',
    headers: authHeaders(getToken(), { 'Content-Type': 'application/json' }),
    body:    JSON.stringify(rsoEntries),
  }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
    .then(function (res) {
      btn.disabled  = false;
      btn.innerHTML = '<span class="btn-icon">&#x2713;</span> SAVE ORDER';
      if (!res.ok) {
        errEl.textContent   = res.body.error || 'Failed to save.';
        errEl.style.display = '';
        return;
      }
      closeRoleSortModal();
      showToast('Roster role sort order saved');
    }).catch(function () {
      btn.disabled  = false;
      btn.innerHTML = '<span class="btn-icon">&#x2713;</span> SAVE ORDER';
      errEl.textContent   = 'Network error — please try again.';
      errEl.style.display = '';
    });
}

wireModalOutsideClick('rsoModalOverlay', closeRoleSortModal);
