// ═══════════════════════════════════════════════════════════
// view-aco.js — Airspace Control Order tab renderer
// ═══════════════════════════════════════════════════════════

'use strict';

// Build the geometry <span> for an ACM table cell using DOM methods.
// Handles anchor/circle/polygon shapes with coord reformatting.
function buildGeoCell(geo) {
  const span = el('span', 'aco-geo');

  // Small helpers to keep the builder readable
  function br()           { span.appendChild(el('br')); }
  function strong(text)   { span.appendChild(el('strong', '', text)); }
  function text(str)      { span.appendChild(document.createTextNode(str)); }
  function indent()       { text('\u00a0\u00a0'); } // two non-breaking spaces

  if (geo.anchor_point) {
    strong('ANCHOR:');
    text(' ' + reformatCoordsInText(String(geo.anchor_point)));
    if (geo.heading_deg != null) {
      br();
      text(`HDG: ${geo.heading_deg}°`);
      if (geo.leg_length_nm) text(` · LEG: ${geo.leg_length_nm} NM`);
      if (geo.direction)     text(` · ${geo.direction.toUpperCase()}`);
    }
  } else if (geo.center) {
    strong('CENTER:');
    text(' ' + reformatCoordsInText(String(geo.center)));
    if (geo.radius_nm) {
      br();
      text(`RADIUS: ${geo.radius_nm} NM`);
    }
  }

  if (geo.boundary?.length) {
    if (span.childNodes.length > 0) br();
    strong('POLYGON:');
    text(` ${geo.boundary.length} pts`);
    geo.boundary.forEach((c, i) => {
      br();
      indent();
      text(`${i + 1}. ${reformatCoordsInText(String(c))}`);
    });
  }

  if (!span.childNodes.length) span.textContent = '—';
  return span;
}

function renderACO(aco) {
  const div = document.getElementById('aco-content');
  div.innerHTML = '';

  // Edit button (visible in edit mode)
  const editBtn = el('button', 'editor-btn', '✎ EDIT ACO');
  editBtn.addEventListener('click', openACOEditor);
  div.appendChild(editBtn);

  if (!aco) {
    div.appendChild(el('div', 'empty-state', 'NO ACO DATA'));
    return;
  }

  docHeader(div, [
    ['OPERATION',   aco.operation],
    ['ATO DAY',     aco.ato_day],
    ['ACO ID',      aco.id],
    ['TIMEZONE',    aco.timezone],
    ['DIST AGENCY', aco.distributing_agency],
  ]);

  if (!aco.acms?.length) {
    div.appendChild(el('div', 'empty-state', 'NO ACMs DEFINED'));
    return;
  }

  // ACM table — one row per airspace control measure
  const { table: tbl, tbody } = docTable(
    ['NAME', 'TYPE', 'GEOMETRY', 'MISSIONS', 'ALTITUDE', `WINDOW (${STATE.display.timeMode})`, 'CONTROL AGENCY', 'FREQ', 'NOTES']
  );

  aco.acms.forEach(acm => {
    const tr      = tbody.insertRow();
    const typeKey = (acm.type || 'OTHER').toUpperCase();

    // Helper: append a cell containing a single span with the given class and text
    function spanCell(cls, text) {
      tr.insertCell().appendChild(el('span', cls, String(text)));
    }

    tr.insertCell().appendChild(el('strong', '', acm.name || '—'));
    tr.insertCell().appendChild(el('span', `acm-badge ${typeKey}`, typeKey));
    tr.insertCell().appendChild(buildGeoCell(acm.geometry || {}));

    spanCell('aco-msns', (acm.missions || []).join(', ') || '—');
    spanCell('aco-alt',  `${acm.alt_lower || '?'} → ${acm.alt_upper || 'FL660'}`);
    spanCell('aco-time', `${fmtTime(acm.time_from) || '—'} – ${fmtTime(acm.time_to) || '—'}`);
    spanCell('aco-ctrl', acm.control_agency || '—');
    spanCell('aco-ctrl', acm.control_freq_mhz ? acm.control_freq_mhz + ' MHz' : '—');
    spanCell('aco-note', acm.notes || '—');
  });

  div.appendChild(tbl);
}
