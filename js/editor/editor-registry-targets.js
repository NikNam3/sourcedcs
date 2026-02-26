// ═══════════════════════════════════════════════════════════
// editor-registry-targets.js — Aim-points sub-editor
//
// Extracted from editor-registry.js to keep it under 400 lines.
// Contains _buildAimPointsEditor and _renderAimPointsList,
// which are used by editRegistryItem when catKey === 'targets'.
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Aim points sub-editor for targets ────────────────────────
function _buildAimPointsEditor(parent, targetItem) {
  var aimPoints = (targetItem.aim_points || []).map(function (ap) {
    return { id: ap.id || '', name: ap.name || '', coords: ap.coords || '' };
  });

  var body = document.getElementById('editorBody');
  body._aimPoints = aimPoints;

  editorSectionTitle(parent, 'AIM POINTS');

  var listEl = el('div', 'ef-list-items');
  _renderAimPointsList(listEl, aimPoints);
  parent.appendChild(listEl);

  var addBtn = el('button', 'ef-btn ef-btn-add', '+ ADD AIM POINT');
  addBtn.addEventListener('click', function () {
    aimPoints.push({ id: '', name: '', coords: '' });
    body._aimPoints = aimPoints;
    _renderAimPointsList(listEl, aimPoints);
  });
  parent.appendChild(addBtn);
}

function _renderAimPointsList(container, aimPoints) {
  container.innerHTML = '';
  aimPoints.forEach(function (ap, i) {
    var row = el('div', 'ef-ap-row');

    var idInput = el('input', 'ef-input ef-input-sm');
    idInput.placeholder = 'ID';
    idInput.value = ap.id || '';
    idInput.addEventListener('input', function () { ap.id = this.value; });

    var nameInput = el('input', 'ef-input ef-input-sm');
    nameInput.placeholder = 'Name';
    nameInput.value = ap.name || '';
    nameInput.addEventListener('input', function () { ap.name = this.value; });

    var coordInput = el('input', 'ef-input ef-input-sm');
    coordInput.placeholder = 'Coords';
    coordInput.value = ap.coords || '';
    coordInput.addEventListener('input', function () { ap.coords = this.value; });

    var delBtn = el('button', 'ef-btn ef-btn-sm ef-btn-danger', '\u2715');
    (function (idx) {
      delBtn.addEventListener('click', function () {
        aimPoints.splice(idx, 1);
        _renderAimPointsList(container, aimPoints);
      });
    })(i);

    row.appendChild(idInput);
    row.appendChild(nameInput);
    row.appendChild(coordInput);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}
