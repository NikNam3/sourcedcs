'use strict';

// The field-state board — guide §9.7, crc-sync docs/adr/0061, crc-desktop
// docs/adr/0068. Per Facility with a runway inventory: each runway's status
// and who put it there, the active end, the arresting gear, requests waiting
// on tower, the runway change and its acknowledgements, and the pads.
//
// Its own dock panel, like AIRSPACE, and NOT the `ops-field-state` Bay: a
// runway is not a Strip, so nothing about it belongs in a rack, and a
// controller working TWR wants the field and the Strips open side by side.
// The Bay stays the inert Strip container ADR 0061 left it.
//
// The buttons come from field-state-rules.js's fieldStateActionsFor — a
// proactive mirror of crc-sync's authority split. The server decides; a
// refusal lands in the Strip panel's refusal banner, named by the runway.
//
// Element references are cached once in initFieldStatePanel(), never looked
// up per render — dockview detaches an inactive panel's root from the
// document, so document.getElementById stops finding it while detached (the
// airspace panel's module comment; the same bug if ignored).
//
// Every time shown is in-game Zulu from the server's mission-clock stamps
// (decisions.md H11). The one direction shown, the mission wind that picked
// the active end, goes through F2's toMagneticDisplay (H15, S-W3c).

let _fieldStateListEl = null;
let _fieldStateEmptyEl = null;

const FIELD_STATE_STATUS_BADGES = {
  OPEN: 'OPEN', CLOSED: 'CLOSED', SUSPENDED_WORKS: 'WORKS', SUSPENDED_INSPECTION: 'INSPECT',
};

// decisions.md S-W3c: F2 owns toMagneticDisplay(trueDeg). Until F2 merges this
// stand-in answers "unknown" (null) rather than showing a TRUE direction as if
// it were magnetic; the panel then leaves the direction out.
if (typeof globalThis !== 'undefined' && typeof globalThis.toMagneticDisplay !== 'function') {
  globalThis.toMagneticDisplay = function toMagneticDisplayStub(_trueDeg) { return null; };
}

function _fsZulu(ms) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString().slice(11, 16).replace(':', '') + 'Z';
}

function _fsWho(positionId, by) {
  if (!positionId && !by) return '';
  return by && by !== positionId ? `${positionId || '?'} (${by})` : positionId;
}

function _fsEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function _fsWindText(source) {
  const mag = typeof toMagneticDisplay === 'function' ? toMagneticDisplay(source.windFromTrue) : null;
  const dir = mag === null || mag === undefined ? null
    : typeof mag === 'number' ? `${String(Math.round(mag)).padStart(3, '0')}°` : String(mag);
  const kt = Number.isFinite(source.windKt) ? `${Math.round(source.windKt)} kt` : null;
  const wind = [dir, kt].filter(Boolean).join(' ');
  return `from the mission wind${wind ? ` (${wind})` : ''} ${_fsZulu(source.at)}`.trim();
}

function _fsDispatch(record, action, btn, select) {
  const op = { kind: action.kind };
  if (action.runwayId) op.runwayId = action.runwayId;
  if (action.action) op.action = action.action;
  if (action.needs === 'toEnd') op.toRunwayId = select ? select.value : (action.toEnds || [])[0];
  if (action.needs === 'reason') {
    const what = action.kind === 'CloseRunway' ? `Close runway ${action.runwayId}` : action.title.replace(/^as \S+ — /, '');
    const text = window.prompt(`${what[0].toUpperCase()}${what.slice(1)} — reason?`);
    if (text === null) return; // Cancel aborts (the airspace Deny precedent)
    if (action.kind === 'CloseRunway') op.reason = text || null;
    else op.note = text || null;
  }
  // §7.9: the button goes dead on the press, until the next render.
  if (btn) btn.disabled = true;
  sendEfspFieldStateMutation(action.positionId, record.facilityId, record.rev, op);
}

function _fsActionRow(record, actions) {
  const row = _fsEl('div', 'field-state-actions');
  for (const action of actions) {
    let select = null;
    if (action.needs === 'toEnd') {
      select = _fsEl('select', 'field-state-to-end');
      select.title = 'the runway end to change to';
      for (const end of action.toEnds || []) {
        const opt = _fsEl('option', null, end);
        opt.value = end;
        select.appendChild(opt);
      }
      row.appendChild(select);
    }
    const btn = _fsEl('button', 'field-state-action-btn', action.label);
    btn.title = action.title;
    btn.dataset.kind = action.kind;
    btn.dataset.positionId = action.positionId;
    if (action.action) btn.dataset.action = action.action;
    btn.addEventListener('click', () => _fsDispatch(record, action, btn, select));
    row.appendChild(btn);
  }
  return row;
}

function _fsGearLine(gear) {
  const type = { BAK_12: 'BAK-12', E_5: 'E-5', OTHER: 'Gear' }[gear.type] || gear.type;
  const position = String(gear.position || '').replace(/_/g, ' ');
  const distance = Number.isFinite(gear.distanceFt) ? `${gear.distanceFt.toLocaleString('en-US')} ft` : null;
  return [type, `${gear.end} end`, position, distance, String(gear.state).replace(/_/g, ' ')].filter(Boolean).join(' · ');
}

function _buildRunwayCard(record, runway, actions) {
  const card = _fsEl('div', `field-state-runway field-state-status-${String(runway.status).toLowerCase().replace(/_/g, '-')}`);
  card.dataset.runwayId = runway.runwayId;

  const header = _fsEl('div', 'field-state-runway-header');
  header.appendChild(_fsEl('span', 'field-state-runway-id', runway.runwayId));
  const ends = _fsEl('span', 'field-state-ends');
  for (const end of runway.ends || []) {
    const active = end === record.activeRunway;
    ends.appendChild(_fsEl('span', `field-state-end${active ? ' field-state-end-active' : ''}`, active ? `▶ ${end} ACTIVE` : end));
  }
  header.appendChild(ends);
  header.appendChild(_fsEl('span', 'field-state-badge', FIELD_STATE_STATUS_BADGES[runway.status] || runway.status));
  card.appendChild(header);

  const line = (cls, text) => card.appendChild(_fsEl('div', `field-state-line ${cls}`, text));
  const s = runway.suspension;
  if (s) {
    const why = s.kind === 'RUNWAY_CHANGE' ? 'RUNWAY CHANGE' : 'WORKS';
    const asked = s.requestedBy ? ` · requested by ${_fsWho(s.requestedBy.positionId, s.requestedBy.by)}` : '';
    const stage = runway.status === 'SUSPENDED_INSPECTION' ? ' · awaiting inspection' : '';
    line('field-state-suspension', `SUSPENDED ${why} by ${_fsWho(s.positionId, s.by)} ${_fsZulu(s.since)}${asked}${s.note ? ` — ${s.note}` : ''}${stage}`);
  }
  const c = runway.closure;
  if (c) {
    const asked = c.requestedBy ? ` · requested by ${_fsWho(c.requestedBy.positionId, c.requestedBy.by)}` : '';
    line('field-state-closure', `CLOSED by ${_fsWho(c.positionId, c.by)} ${_fsZulu(c.since)}${asked}${c.reason ? ` — ${c.reason}` : ''}`);
  }
  const i = runway.lastInspection;
  if (i) line('field-state-inspection', `INSPECTED by ${_fsWho(i.positionId, i.by)} ${_fsZulu(i.at)}${i.note ? ` — ${i.note}` : ''}`);

  const r = runway.pendingRequest;
  if (r) {
    line('field-state-request', `REQUEST ${String(r.action).replace(/_/g, ' ')} from ${_fsWho(r.requestedPositionId, r.requestedBy)} ${_fsZulu(r.requestedAt)}${r.note ? ` — ${r.note}` : ''} · waiting on TWR`);
  }

  const gear = runway.arrestingGear || [];
  if (gear.length === 0) line('field-state-gear field-state-gear-none', 'No arresting gear configured (SOURCE practice).');
  for (const g of gear) line(`field-state-gear field-state-gear-${String(g.state).toLowerCase()}`, _fsGearLine(g));

  if (actions.length) card.appendChild(_fsActionRow(record, actions));
  return card;
}

function _fsAckChip(positionId, ack) {
  if (ack === null || ack === undefined) return _fsEl('span', 'field-state-ack field-state-ack-waiting', `${positionId} …`);
  if (ack.skipped) {
    const chip = _fsEl('span', 'field-state-ack field-state-ack-skipped', `${positionId} skipped`);
    chip.title = `${positionId} was unmanned when the change was proposed, so it was skipped (and audited)`;
    return chip;
  }
  return _fsEl('span', 'field-state-ack field-state-ack-done', `${positionId} ✓${ack.selfCoordinated ? ' self' : ''} ${_fsZulu(ack.at)}`);
}

function _buildRunwayChange(record, actions) {
  const change = record.runwayChange;
  const box = _fsEl('div', 'field-state-change');
  if (change) {
    box.dataset.state = change.state;
    const who = _fsWho(change.proposedPositionId, change.proposedBy);
    box.appendChild(_fsEl('div', 'field-state-line field-state-change-head',
      `${change.fromRunwayId || '—'} → ${change.toRunwayId} · ${String(change.state).replace(/_/g, ' ')} · proposed by ${who} ${_fsZulu(change.proposedAt)}${change.selfCoordinated ? ' · self-coordinated' : ''}${change.note ? ` — ${change.note}` : ''}`));
    if ((change.acknowledgers || []).length) {
      const acks = _fsEl('div', 'field-state-acks');
      for (const p of change.acknowledgers) acks.appendChild(_fsAckChip(p, (change.acks || {})[p]));
      box.appendChild(acks);
    }
    if (change.rejected) {
      const rj = change.rejected;
      box.appendChild(_fsEl('div', 'field-state-line field-state-change-rejected',
        `${rj.cause === 'WITHDRAWN' ? 'WITHDRAWN' : 'REJECTED'} by ${_fsWho(rj.positionId, rj.by)} ${_fsZulu(rj.at)}${rj.note ? ` — ${rj.note}` : ''}`));
    }
    if (change.state === 'PENDING_INSPECTION' && (change.pendingInspection || []).length) {
      box.appendChild(_fsEl('div', 'field-state-line field-state-change-pending', `PENDING INSPECTION: ${change.pendingInspection.join(', ')}`));
    }
  }
  if (actions.length) box.appendChild(_fsActionRow(record, actions));
  return change || actions.length ? box : null;
}

function _buildPads(record) {
  const pads = _fsEl('div', 'field-state-pads');
  const pad = (label, p, extra) => {
    const occupied = p && p.occupied ? ` · occupied${p.occupantFdrId ? ` (${p.occupantFdrId})` : ''}` : '';
    pads.appendChild(_fsEl('div', 'field-state-line field-state-pad', `${label} · ${(p && p.name) || 'not configured'}${occupied}`));
    if (extra) pads.appendChild(_fsEl('div', 'field-state-line field-state-pad-constraint', extra));
  };
  pad('HOT CARGO PAD', record.hotCargoPad);
  // L13 (alert/scramble) defines alertPadConstraintFor; absent until it merges.
  const constraint = typeof alertPadConstraintFor === 'function' ? alertPadConstraintFor(record.facilityId) : null;
  pad('ALERT PAD', record.alertPad, constraint);
  return pads;
}

function _buildFieldStateSection(record, heldPositionIds) {
  const section = _fsEl('div', 'field-state-facility');
  section.dataset.facilityId = record.facilityId;

  const header = _fsEl('div', 'field-state-facility-header');
  header.appendChild(_fsEl('span', 'field-state-facility-id', record.facilityId));
  header.appendChild(_fsEl('span', 'field-state-active', record.activeRunway ? `▶ ${record.activeRunway} ACTIVE` : 'ACTIVE —'));
  header.appendChild(_fsEl('span', 'field-state-rev', `rev ${record.rev}`));
  section.appendChild(header);

  const src = record.activeRunwaySource;
  if (src && src.kind === 'WIND') section.appendChild(_fsEl('div', 'field-state-line field-state-active-source', `Active end ${_fsWindText(src)}`));
  else if (src && src.kind === 'RUNWAY_CHANGE') section.appendChild(_fsEl('div', 'field-state-line field-state-active-source', `Active end by runway change ${_fsZulu(src.at)}`));
  else if (!record.activeRunway) section.appendChild(_fsEl('div', 'field-state-line field-state-active-source', 'No active end yet: set from the mission wind at load, or by a runway change.'));

  const actions = fieldStateActionsFor(record, heldPositionIds);
  for (const runway of record.runways || []) {
    section.appendChild(_buildRunwayCard(record, runway, actions.filter(a => a.runwayId === runway.runwayId)));
  }
  const change = _buildRunwayChange(record, actions.filter(a => !a.runwayId));
  if (change) section.appendChild(change);
  section.appendChild(_buildPads(record));
  return section;
}

/** The tab title, with a count of runway requests waiting on THIS controller (L1b-Q9 (a)). */
function _fsUpdateTitle(records) {
  let waiting = 0;
  for (const record of records) {
    const held = getActingPositions(record.facilityId);
    waiting += fieldStateActionsFor(record, held).filter(a => a.kind === 'AcceptRunwayRequest').length;
  }
  const base = (typeof PANEL_TITLES === 'object' && PANEL_TITLES.fieldState) || 'FIELD STATE';
  const title = waiting ? `${base} (${waiting})` : base;
  const panel = typeof dock !== 'undefined' && dock && dock.api ? dock.api.getPanel('fieldState') : null;
  // Only on a change: setting a dockview title re-lays the tab out, and doing
  // that on every render would churn the panel under a controller's click.
  if (panel && panel.api && typeof panel.api.setTitle === 'function' && panel.title !== title) panel.api.setTitle(title);
  return waiting;
}

function renderFieldStatePanel() {
  const records = getAllEfspFieldStates();
  _fsUpdateTitle(records);
  if (!_fieldStateListEl) return; // not initialized yet
  _fieldStateListEl.innerHTML = '';
  // L1b-Q6 (a): every record, since a CTR controller may want to know the
  // runway is shut; actions only for Positions held at THAT Facility.
  for (const record of records) {
    _fieldStateListEl.appendChild(_buildFieldStateSection(record, getActingPositions(record.facilityId)));
  }
  if (_fieldStateEmptyEl) _fieldStateEmptyEl.hidden = records.length > 0;
}

function initFieldStatePanel() {
  _fieldStateListEl = document.getElementById('field-state-list');
  _fieldStateEmptyEl = document.getElementById('field-state-empty');
  renderFieldStatePanel();
  return { onShow: () => renderFieldStatePanel() };
}
