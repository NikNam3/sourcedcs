'use strict';

// The airspace card's two read views (mockup scenes 5 and 6, docs/adr/0098 §4, §8): History and Delete.
//
// History merges the record's `transitions` (state changes, complete: they ride the wire) with the definition edits this
// window has seen arrive (efsp-state.js `getEfspAirspaceEdits`). crc-sync keeps the full `definitionHistory` but does not
// send it, so the view says what it covers; the Mutation log is the audit trail of record. Times are the mission clock.
// Delete lists what blocks it and what clears each blocker, from the data the panel already has (the server's guard is
// the same rule: RETURNED, no request, no flights working it).
//
// Model functions are pure (tests/airspace-detail-views.test.mjs); the open* functions draw.

import { FIELD_LABELS, valueText } from './airspace-draft.js';

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ── History ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The airspace's history, newest first: state changes and the definition edits seen.
 * @param {object} record `transitions: [{state, actingPositionId, window?, selfCoordinated?, occupiedAtRelease?, at, by}]`
 * @param {Array<{defRev:number, at:number, by:string|null, changes:Array, missed?:number}>} edits
 * @param {{zulu:(ms:number)=>string}} fmt
 * @returns {Array<{kind:'State'|'Edit', at:number, who:string, headline:string, changes:Array<{field,from,to}>, note:string|null}>}
 */
export function historyEntries(record, edits, { zulu }) {
  const out = [];
  let previous = 'RETURNED';
  for (const t of record.transitions || []) {
    const bits = [`${previous} → ${t.state}`];
    if (t.state === 'SCHEDULED' && t.window) bits.push(`${zulu(t.window.fromUtc)}–${zulu(t.window.toUtc)}`);
    const notes = [];
    if (t.selfCoordinated) notes.push('self-coordinated: one controller on both sides');
    if (t.occupiedAtRelease > 0) notes.push(`${t.occupiedAtRelease} flight${t.occupiedAtRelease === 1 ? '' : 's'} still in it`);
    out.push({ kind: 'State', at: t.at, who: [t.actingPositionId, t.by].filter(Boolean).join(' · '), headline: bits.join(' '), changes: [], note: notes.join('; ') || null });
    previous = t.state;
  }
  for (const e of edits || []) {
    out.push({
      kind: 'Edit', at: e.at, who: [e.positionId, e.by].filter(Boolean).join(' · '), headline: `Edit, definition rev ${e.defRev}`,
      changes: e.changes || [], note: e.missed > 0 ? `${e.missed} earlier edit${e.missed === 1 ? '' : 's'} arrived while this window was away and are not itemised` : null,
    });
  }
  // newest first; a state change and an edit stamped the same millisecond keep the order they were added in, reversed
  return out.map((e, i) => ({ e, i })).sort((a, b) => (b.e.at - a.e.at) || (b.i - a.i)).map(x => x.e);
}

export const HISTORY_FOOTNOTE = 'Accepted changes only, newest first, in mission time (Zulu). State changes are all here; definition edits are the ones this window has seen since it connected. Every edit, and every refused attempt, is in the Mutation log.';

export function openHistoryView({ record, edits, zulu, transitionAltFt, onClose }) {
  const el = _el('div', 'airspace-history');
  const entries = historyEntries(record, edits, { zulu });
  if (!entries.length) el.appendChild(_el('div', 'airspace-field-why', 'No state change or edit seen yet.'));
  for (const e of entries) {
    const row = _el('div', 'airspace-history-row');
    row.appendChild(_el('span', 'airspace-history-time', zulu(e.at)));
    row.appendChild(_el('span', 'airspace-history-kind', e.kind));
    const main = _el('div', 'airspace-history-main');
    main.appendChild(_el('div', 'airspace-history-who', e.who || 'system'));
    main.appendChild(_el('div', 'airspace-history-head', e.headline));
    for (const c of e.changes) {
      main.appendChild(_el('div', 'airspace-history-change',
        `${(FIELD_LABELS[c.field] || c.field)}: ${valueText(c.field, c.from, transitionAltFt)} → ${valueText(c.field, c.to, transitionAltFt)}`));
    }
    if (e.note) main.appendChild(_el('div', 'airspace-field-why', e.note));
    row.appendChild(main);
    el.appendChild(row);
  }
  el.appendChild(_el('div', 'airspace-field-why', HISTORY_FOOTNOTE));
  const close = _el('button', 'airspace-action-btn', 'Close');
  close.addEventListener('click', () => { el.remove(); onClose({ saved: false }); });
  el.appendChild(close);
  return { el, kind: 'history', handleAck: () => false, destroy: () => el.remove() };
}

// ── Delete ──────────────────────────────────────────────────────────────────────────────────────

/**
 * What stops this airspace being deleted, and what clears each. Empty = it can be deleted. The rule is the server's
 * (RETURNED, no request, and for an AREA nobody working it), the words are the panel's.
 * @param {object} record
 * @param {Array<{callsign:string}>} flights the flights working an AREA (a ROUTE is never blocked by flights: a count only)
 * @returns {Array<{blocking:string, clears:string}>}
 */
export function deleteBlockers(record, flights, { zulu = () => '' } = {}) {
  const def = record.definition;
  const ctrl = def.controllingPositionId;
  const user = def.usingPositionId || (def.usingFacilityId ? `a ${def.usingFacilityId} Position` : ctrl);
  const out = [];
  if (record.state !== 'RETURNED') {
    const booked = record.window ? ` (booked ${zulu(record.window.fromUtc)}–${zulu(record.window.toUtc)})` : '';
    const clears = { ACTIVE: `${user} releases it, then ${ctrl} takes it back`, SCHEDULED: `${ctrl} cancels the schedule`, RELEASED: `${ctrl} takes it back` }[record.state] || `${ctrl} returns it`;
    out.push({ blocking: `State is ${record.state}${booked}`, clears });
  }
  if (record.pendingRequest) {
    out.push({ blocking: `An activation request from ${record.pendingRequest.requestedPositionId} is outstanding`, clears: `${ctrl} answers it, or cancels the schedule` });
  }
  if (def.kind === 'AREA' && flights.length) {
    out.push({
      blocking: `${flights.length} flight${flights.length === 1 ? '' : 's'} approved into it: ${flights.map(f => f.callsign).join(', ')}`,
      clears: 'Clear their airspace entry on each Strip',
    });
  }
  return out;
}

export function openDeleteView({ record, flights, authority, zulu, send, onClose }) {
  const def = record.definition;
  const el = _el('div', 'airspace-delete');
  const blockers = deleteBlockers(record, flights, { zulu });
  const state = { pending: null };
  const title = _el('div', 'airspace-conflict-title', blockers.length ? `Cannot delete ${def.name} yet.` : `Delete ${def.name}?`);
  el.appendChild(title);
  const lead = _el('div', 'airspace-conflict-text', blockers.length
    ? 'An airspace can be deleted only when it is available (RETURNED), with no request outstanding and no flight working it.'
    : 'It is removed for everyone at once. History and the Mutation log keep its id and its last definition; old Strips show the bare id.');
  el.appendChild(lead);
  const list = _el('div', 'airspace-delete-blockers');
  const fill = (rows) => {
    list.innerHTML = '';
    if (!rows.length) return;
    const table = _el('table', 'airspace-conflict-table');
    const hr = _el('tr'); hr.appendChild(_el('th', '', 'Blocking')); hr.appendChild(_el('th', '', 'What clears it')); table.appendChild(hr);
    for (const r of rows) { const tr = _el('tr'); tr.appendChild(_el('td', '', r.blocking)); tr.appendChild(_el('td', '', r.clears)); table.appendChild(tr); }
    list.appendChild(table);
  };
  fill(blockers);
  el.appendChild(list);
  const actions = _el('div', 'airspace-editor-actions');
  const del = _el('button', 'airspace-save-btn', 'Delete');
  const close = _el('button', 'airspace-action-btn', blockers.length ? 'Close' : 'Cancel');
  const status = _el('span', 'airspace-editor-status');
  actions.append(del, close, status);
  el.appendChild(actions);
  del.disabled = blockers.length > 0;
  del.title = blockers.length ? blockers[0].blocking : '';
  del.addEventListener('click', () => {
    if (del.disabled || !authority) return;
    status.textContent = 'Sending...'; del.disabled = true;
    state.pending = send(authority.positionId, def.airspaceId, record.rev, { kind: 'DeleteAirspace' }, { baseDefRev: record.defRev }, { onAck: handleAck }) ?? '?';
  });
  close.addEventListener('click', () => { el.remove(); onClose({ saved: false }); });

  function handleAck(ack) {
    if (!state.pending) return false;
    state.pending = null;
    if (ack.ok) { el.remove(); onClose({ saved: true, ack }); return true; }
    // The server's own list of blockers (strings), or its reason, replaces the panel's guess.
    if (Array.isArray(ack.blockers) && ack.blockers.length) {
      title.textContent = `Cannot delete ${def.name} yet.`;
      fill(ack.blockers.map(b => ({ blocking: String(b), clears: '' })));
      status.textContent = '';
    } else {
      status.textContent = ack.reason === 'STALE_REV' ? 'Someone edited this airspace since you opened it. Close and open it again.'
        : (ack.detail || ack.reason || 'Refused.');
      status.classList.add('airspace-status-bad');
      del.disabled = false;
    }
    return true;
  }
  return { el, kind: 'delete', handleAck, destroy: () => el.remove() };
}
