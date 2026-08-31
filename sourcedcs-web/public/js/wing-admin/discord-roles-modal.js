// ═══════════════════════════════════════════════════════════
// discord-roles-modal.js — Discord role → squadron/role mapping editor
//
// Public API:
//   openDiscordRolesModal() / closeDiscordRolesModal()
//   removeDrEntry(roleName) / addDiscordRoleEntry(e) / saveDiscordRoles()
// ═══════════════════════════════════════════════════════════

'use strict';

var drEntries = {}; /* working copy { roleName: { squadron, role } } */

function openDiscordRolesModal() {
  drEntries = {};
  document.getElementById('drAddError').style.display = 'none';
  document.getElementById('drSaveError').style.display = 'none';
  document.getElementById('drAddForm').reset();
  openModal('drModalOverlay');
  fetch('/api/discord-roles', {
    headers: authHeaders(),
  }).then(function (r) {
    if (!r.ok) throw new Error('Failed to load');
    return r.json();
  }).then(function (data) {
    for (var k in data) {
      if (k !== '_comment') drEntries[k] = { squadron: data[k].squadron || '', role: data[k].role || '' };
    }
    renderDrList();
  }).catch(function () {
    document.getElementById('drSaveError').textContent = 'Failed to load current mapping.';
    document.getElementById('drSaveError').style.display = '';
  });
}

function closeDiscordRolesModal() {
  closeModal('drModalOverlay');
}

function renderDrList() {
  var container = document.getElementById('drList');
  var keys = Object.keys(drEntries);
  if (!keys.length) {
    container.innerHTML = '<div style="color:var(--text-3);font-size:13px;padding:8px 0">No role mappings configured. Add entries below.</div>';
    return;
  }
  container.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
    '<thead><tr>' +
    '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text-2)">DISCORD ROLE NAME</th>' +
    '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text-2)">SQUADRON ID</th>' +
    '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text-2)">ROLE LABEL</th>' +
    '<th style="padding:6px 8px;border-bottom:1px solid var(--border)"></th>' +
    '</tr></thead><tbody>' +
    keys.map(function (k) {
      var sq   = drEntries[k].squadron || '';
      var role = drEntries[k].role     || '';
      return '<tr>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + esc(k) + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + (sq   ? esc(sq)   : '<span style="color:var(--text-3)">—</span>') + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + (role ? esc(role) : '<span style="color:var(--text-3)">—</span>') + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap">' +
          '<button class="btn-sm btn-sm-danger" data-role-key="' + esc(k) + '" onclick="removeDrEntry(this.dataset.roleKey)">&#x2715;</button>' +
        '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>';
}

function removeDrEntry(roleName) {
  delete drEntries[roleName];
  renderDrList();
}

function addDiscordRoleEntry(e) {
  e.preventDefault();
  var errEl     = document.getElementById('drAddError');
  var roleName  = document.getElementById('drRoleName').value.trim();
  var squadron  = document.getElementById('drSquadron').value.trim();
  var roleLabel = document.getElementById('drRoleLabel').value.trim();
  if (!roleName) {
    errEl.textContent   = 'Discord role name is required.';
    errEl.style.display = '';
    return;
  }
  if (!squadron && !roleLabel) {
    errEl.textContent   = 'At least one of Squadron ID or Role Label is required.';
    errEl.style.display = '';
    return;
  }
  if (drEntries[roleName] !== undefined) {
    errEl.textContent   = 'A mapping for "' + roleName + '" already exists. Delete it first if you want to replace it.';
    errEl.style.display = '';
    return;
  }
  errEl.style.display = 'none';
  drEntries[roleName] = { squadron: squadron, role: roleLabel };
  document.getElementById('drAddForm').reset();
  renderDrList();
}

function saveDiscordRoles() {
  var btn   = document.getElementById('drSaveBtn');
  var errEl = document.getElementById('drSaveError');
  var tok   = getToken();
  btn.disabled    = true;
  btn.textContent = 'SAVING...';
  errEl.style.display = 'none';
  fetch('/api/discord-roles', {
    method:  'PUT',
    headers: authHeaders(tok, { 'Content-Type': 'application/json' }),
    body:    JSON.stringify(drEntries),
  }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
    .then(function (res) {
      btn.disabled  = false;
      btn.innerHTML = '<span class="btn-icon">&#x2713;</span> SAVE MAPPING';
      if (!res.ok) {
        errEl.textContent   = res.body.error || 'Failed to save.';
        errEl.style.display = '';
        return;
      }
      closeDiscordRolesModal();
      showToast('Discord role mapping saved');
      /* The mapping change affects auto-squadron/auto-role assignment —
         reload members so the table reflects it immediately. */
      loadAll(tok);
    }).catch(function () {
      btn.disabled  = false;
      btn.innerHTML = '<span class="btn-icon">&#x2713;</span> SAVE MAPPING';
      errEl.textContent   = 'Network error — please try again.';
      errEl.style.display = '';
    });
}

wireModalOutsideClick('drModalOverlay', closeDiscordRolesModal);
