// ═══════════════════════════════════════════════════════════
// squadron-crud.js — squadron entity CRUD (admin-only section)
//
// Public API:
//   renderSquadronsTable()
//   openSqModal(id) / closeSqModal() / editSquadron(id) / deleteSquadron(id) / submitSquadron(e)
// ═══════════════════════════════════════════════════════════

'use strict';

function renderSquadronsTable() {
  var tbody = document.getElementById('squadronsBody');
  if (!tbody) return;
  if (!_squadrons.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-3)">No squadrons configured.</td></tr>';
    return;
  }
  tbody.innerHTML = _squadrons.map(function (sq) {
    return '<tr>' +
      '<td>' + esc(sq.id) + '</td>' +
      '<td>' + esc(sq.designator) + '</td>' +
      '<td>' + esc(sq.name) + '</td>' +
      '<td>' + esc(sq.airframe || '') + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn-sm" data-sq-id="' + esc(sq.id) + '">EDIT</button> ' +
        '<button class="btn-sm btn-sm-danger" data-sq-id="' + esc(sq.id) + '">DELETE</button>' +
      '</td>' +
    '</tr>';
  }).join('');
  Array.prototype.forEach.call(tbody.querySelectorAll('.btn-sm:not(.btn-sm-danger)'), function (btn) {
    btn.addEventListener('click', function () { openSqModal(btn.dataset.sqId); });
  });
  Array.prototype.forEach.call(tbody.querySelectorAll('.btn-sm-danger'), function (btn) {
    btn.addEventListener('click', function () { deleteSquadron(btn.dataset.sqId); });
  });
}

function openSqModal(id) {
  openModal('sqModalOverlay');
  document.getElementById('sqFormError').style.display = 'none';
  if (id) {
    var sq = _squadrons.find(function (s) { return s.id === id; });
    if (sq) {
      document.getElementById('sqModalTitle').textContent = '✎ EDIT SQUADRON';
      document.getElementById('sqEditId').value = sq.id;
      document.getElementById('sqId').value = sq.id;
      document.getElementById('sqId').disabled = true;
      document.getElementById('sqDesignator').value = sq.designator;
      document.getElementById('sqName').value = sq.name;
      document.getElementById('sqAirframe').value = sq.airframe || '';
      document.getElementById('sqTags').value = (sq.tags || []).join(', ');
      document.getElementById('sqShortDesc').value = sq.shortDesc || '';
      document.getElementById('sqFullDesc').value = sq.fullDesc || '';
      document.getElementById('sqImage').value = sq.image || '';
    }
  } else {
    document.getElementById('sqModalTitle').textContent = '⊕ ADD SQUADRON';
    document.getElementById('sqEditId').value = '';
    document.getElementById('sqId').disabled = false;
    document.getElementById('sqForm').reset();
  }
}
function closeSqModal() {
  closeModal('sqModalOverlay');
}
function editSquadron(id) { openSqModal(id); }
function deleteSquadron(id) {
  if (!confirm('Delete this squadron? This cannot be undone.')) return;
  fetch('/api/squadrons/' + id, {
    method: 'DELETE',
    headers: authHeaders(),
  }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.body.error || 'Failed to delete squadron');
      _squadrons = _squadrons.filter(function (s) { return s.id !== id; });
      populateSquadronFilter();
      renderSquadronsTable();
      renderTable();
      showToast('Squadron deleted');
    })
    .catch(function (err) { showToast(err.message || 'Failed to delete squadron', true); });
}
function submitSquadron(e) {
  e.preventDefault();
  var editId = document.getElementById('sqEditId').value;
  var data = {
    id:         document.getElementById('sqId').value.trim(),
    designator: document.getElementById('sqDesignator').value.trim(),
    name:       document.getElementById('sqName').value.trim(),
    airframe:   document.getElementById('sqAirframe').value.trim(),
    tags:       document.getElementById('sqTags').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean),
    shortDesc:  document.getElementById('sqShortDesc').value.trim(),
    fullDesc:   document.getElementById('sqFullDesc').value.trim(),
    image:      document.getElementById('sqImage').value.trim(),
  };
  if (!data.id || !data.designator || !data.name) {
    document.getElementById('sqFormError').textContent = 'ID, designator and name are required.';
    document.getElementById('sqFormError').style.display = '';
    return;
  }
  var url    = editId ? '/api/squadrons/' + editId : '/api/squadrons';
  var method = editId ? 'PUT' : 'POST';
  fetch(url, {
    method: method,
    headers: authHeaders(getToken(), { 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
    .then(function (res) {
      if (!res.ok) {
        document.getElementById('sqFormError').textContent = res.body.error;
        document.getElementById('sqFormError').style.display = '';
        return;
      }
      if (editId) {
        var idx = _squadrons.findIndex(function (s) { return s.id === editId; });
        if (idx !== -1) _squadrons[idx] = res.body;
      } else {
        _squadrons.push(res.body);
      }
      populateSquadronFilter();
      renderSquadronsTable();
      renderTable();
      closeSqModal();
      showToast(editId ? 'Squadron updated' : 'Squadron added');
    });
}
wireModalOutsideClick('sqModalOverlay', closeSqModal);
