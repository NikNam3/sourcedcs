// ═══════════════════════════════════════════════════════════
// vacation-modal.js — per-member vacation range CRUD
//
// Opened from roster-table.js's per-row "vacation" button
// (openVacationModal(member)). isVacationDayKey (the day/vacation-range
// overlap check) lives in activity-heatmap.js instead of here, since its
// only caller is buildHeatmapSvg — single-consumer, so it stays with its
// consumer rather than here with the rest of the vacation CRUD.
//
// Public API:
//   openVacationModal(member) / closeVacationModal()
// ═══════════════════════════════════════════════════════════

'use strict';

var _vacMember = null;

function openVacationModal(member) {
  _vacMember = member;
  document.getElementById('vacModalName').textContent = (member.callsign || member.username || member.id).toUpperCase();
  document.getElementById('vacAddError').style.display = 'none';
  var now = new Date();
  var plus7 = new Date(Date.now() + 7 * 86400000);
  document.getElementById('vacFrom').value = now.toISOString().slice(0, 10);
  document.getElementById('vacUntil').value = plus7.toISOString().slice(0, 10);
  renderVacList();
  openModal('vacModalOverlay');
}
function closeVacationModal() {
  closeModal('vacModalOverlay');
  _vacMember = null;
}
wireModalOutsideClick('vacModalOverlay', closeVacationModal);

function renderVacList() {
  var container = document.getElementById('vacList');
  var list = (_vacMember && _vacMember.vacations) || [];
  if (!list.length) {
    container.innerHTML = '<div style="color:var(--text-3);font-size:13px;padding:8px 0">No vacation entries.</div>';
    return;
  }
  container.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
    '<thead><tr>' +
    '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text-2)">FROM</th>' +
    '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--text-2)">UNTIL</th>' +
    '<th style="padding:6px 8px;border-bottom:1px solid var(--border)"></th>' +
    '</tr></thead><tbody>' +
    list.map(function (v) {
      return '<tr>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border)"><input type="date" class="form-input" data-vac-id="' + esc(v.id) + '" data-field="from" value="' + esc(v.from.slice(0, 10)) + '"></td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border)"><input type="date" class="form-input" data-vac-id="' + esc(v.id) + '" data-field="until" value="' + esc(v.until.slice(0, 10)) + '"></td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap">' +
          '<button class="btn-sm" data-vac-save="' + esc(v.id) + '">SAVE</button> ' +
          '<button class="btn-sm btn-sm-danger" data-vac-del="' + esc(v.id) + '">&#x2715;</button>' +
        '</td></tr>';
    }).join('') + '</tbody></table>';
  Array.prototype.forEach.call(container.querySelectorAll('[data-vac-save]'), function (btn) {
    btn.addEventListener('click', function () { saveVacationEntry(btn.dataset.vacSave); });
  });
  Array.prototype.forEach.call(container.querySelectorAll('[data-vac-del]'), function (btn) {
    btn.addEventListener('click', function () { deleteVacationEntry(btn.dataset.vacDel); });
  });
}

function addVacationEntry(e) {
  e.preventDefault();
  var fromVal = document.getElementById('vacFrom').value;
  var untilVal = document.getElementById('vacUntil').value;
  var errEl = document.getElementById('vacAddError');
  if (!fromVal || !untilVal || new Date(untilVal) <= new Date(fromVal)) {
    errEl.textContent = '"Until" must be after "from".';
    errEl.style.display = '';
    return;
  }
  errEl.style.display = 'none';
  fetch('/api/members/' + encodeURIComponent(_vacMember.id) + '/vacation', {
    method: 'POST',
    headers: authHeaders(getToken(), { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ from: new Date(fromVal).toISOString(), until: new Date(untilVal).toISOString() }),
  }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) { errEl.textContent = res.body.error || 'Failed to add vacation'; errEl.style.display = ''; return; }
      showToast('Vacation added');
      closeVacationModal();
      loadAll(getToken()); /* status/score depend on vacation state — reload rather than patch in place */
    })
    .catch(function () { errEl.textContent = 'Network error — please try again.'; errEl.style.display = ''; });
}

function saveVacationEntry(vacId) {
  var fromEl = document.querySelector('[data-vac-id="' + vacId + '"][data-field="from"]');
  var untilEl = document.querySelector('[data-vac-id="' + vacId + '"][data-field="until"]');
  if (!fromEl.value || !untilEl.value || new Date(untilEl.value) <= new Date(fromEl.value)) {
    showToast('"Until" must be after "from"', true);
    return;
  }
  fetch('/api/members/' + encodeURIComponent(_vacMember.id) + '/vacation/' + encodeURIComponent(vacId), {
    method: 'PUT',
    headers: authHeaders(getToken(), { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ from: new Date(fromEl.value).toISOString(), until: new Date(untilEl.value).toISOString() }),
  }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) { showToast(res.body.error || 'Failed to update vacation', true); return; }
      showToast('Vacation updated');
      closeVacationModal();
      loadAll(getToken());
    })
    .catch(function () { showToast('Network error — please try again.', true); });
}

function deleteVacationEntry(vacId) {
  if (!confirm('Remove this vacation entry?')) return;
  fetch('/api/members/' + encodeURIComponent(_vacMember.id) + '/vacation/' + encodeURIComponent(vacId), {
    method: 'DELETE',
    headers: authHeaders(),
  }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) { showToast(res.body.error || 'Failed to remove vacation', true); return; }
      showToast('Vacation removed');
      closeVacationModal();
      loadAll(getToken());
    })
    .catch(function () { showToast('Network error — please try again.', true); });
}
