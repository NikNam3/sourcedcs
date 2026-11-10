'use strict';

// The intercom's unit picker (H183), ported from the old panel (srs-radio.js `_rebuildIntercomUnitSelect`): the
// shared, non-DCS intercom, then the SRS clients by name. An intercom is joined through SRS, so the SRS clients are the
// whole list; the radar picture does not say which contacts are friendly units (docs/adr/0059). The engine reports the
// clients in its state (`srsClients: [{ name, unitId }]`, a contract addition) and joins the unit through
// `setIntercomUnit`.

import { el } from './radio-dom.js';

/** The picker's choices: `[{ value, label, group, missing }]`, `value` '' for the shared intercom. */
export function intercomUnitOptions(clients = [], unitId = null) {
  const out = [{ value: '', label: 'shared (non-DCS)', group: null, missing: false }];
  const sorted = clients.filter(c => Number.isInteger(c.unitId) && c.unitId > 0)
    .slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  for (const c of sorted) out.push({ value: String(c.unitId), label: `${c.name || '?'} (ID ${c.unitId})`, group: 'SRS clients', missing: false });
  // The chosen unit is kept while it is off SRS, so a client's reconnect does not move the controller off it.
  if (unitId != null && !sorted.some(c => c.unitId === unitId)) out.push({ value: String(unitId), label: `ID ${unitId} (not on SRS)`, group: null, missing: true });
  return out;
}

/** The `<select>`; `onPick(unitId | null)`. */
export function buildIntercomUnitSelect(clients, unitId, onPick) {
  const sel = el('select', 'radio-link radio-intercom-unit', null, { title: 'The SRS unit whose intercom to join', 'aria-label': 'Intercom unit' });
  let group = null;
  for (const o of intercomUnitOptions(clients, unitId)) {
    const opt = el('option', o.missing ? 'radio-missing' : null, o.label, { value: o.value });
    if (o.group) {
      if (!group) { group = el('optgroup', null, null, { label: o.group }); sel.appendChild(group); }
      group.appendChild(opt);
    } else sel.appendChild(opt);
  }
  sel.value = unitId == null ? '' : String(unitId);
  sel.addEventListener('change', () => onPick(sel.value === '' ? null : Number(sel.value)));
  return sel;
}
