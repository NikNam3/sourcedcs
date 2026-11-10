'use strict';

// The radio panel's small group editor: each section's header (the automatic group's name, a user group's name with
// RENAME and DELETE, or UNLINKED), and the "+ GROUP" button. The rules (default names, unique names, delete makes the
// radios unlinked) are link-groups.js's; this file only draws and calls back.

import { el } from './radio-dom.js';

// The one grey mark on a group crc-sync relays (docs/adr/0160): a pilot on one of its frequencies is re-sent on every
// other frequency of its network (this group, and any other controller's group sharing a frequency with it). Dark
// cockpit: nothing more, and nothing when not.
const relayMark = () => el('span', 'radio-note radio-relaying', 'RELAYING', { title: 'Pilots on one frequency of this group are relayed by crc-sync onto the others, and onto every group linked to it' });

// PTT is per group (the human, 2026-11-10): the mark is on the group's header; PTT transmits on all its radios.
function pttMark(ptt) {
  const b = el('button', 'radio-target' + (ptt.isTarget ? ' radio-target-on' : ''), ptt.isTarget ? '●' : '○', {
    type: 'button', title: ptt.isTarget ? 'PTT transmits on this group' : 'Transmit on this group', disabled: !!ptt.disabled,
  });
  b.addEventListener('click', () => ptt.onTarget());
  return b;
}

/**
 * @param {{ id, name, auto } | null} group   null: the unlinked section
 * @param {object} ctx  relaying (crc-sync relays the group's network), ptt ({isTarget, disabled, onTarget}: PTT is per
 *   group), renaming (this group's id is being renamed), renameError, onRename(on), onRenameCommit(text), onDelete()
 */
export function buildGroupHeader(group, ctx = {}) {
  const head = el('div', 'radio-group-head');
  if (!group) { head.appendChild(el('span', 'radio-group-name', 'UNLINKED')); return head; }
  if (ctx.ptt) head.appendChild(pttMark(ctx.ptt));
  if (group.auto) {
    head.appendChild(el('span', 'radio-group-name', group.name, { title: 'Every Position radio, linked: PTT transmits on all of them' }));
    if (ctx.relaying) head.appendChild(relayMark());
    return head;
  }
  if (ctx.renaming) {
    const input = el('input', 'radio-group-input', null, { type: 'text', value: group.name, maxlength: 12, 'aria-label': 'Group name' });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); ctx.onRenameCommit(input.value); }
      if (e.key === 'Escape') { e.preventDefault(); ctx.onRename(false); }
    });
    queueMicrotask(() => { input.focus(); input.select(); });
    head.appendChild(input);
    if (ctx.renameError) head.appendChild(el('span', 'radio-note radio-conflict', ctx.renameError));
    return head;
  }
  head.appendChild(el('span', 'radio-group-name', group.name));
  if (ctx.relaying) head.appendChild(relayMark());
  const rename = el('button', 'radio-small-btn', 'RENAME', { type: 'button' });
  rename.addEventListener('click', () => ctx.onRename(true));
  const del = el('button', 'radio-small-btn', 'DELETE', { type: 'button', title: 'Delete the group: its radios become unlinked' });
  del.addEventListener('click', () => ctx.onDelete());
  head.append(rename, del);
  return head;
}

/** The "+ GROUP" button: a new group with the next default name (A, B, C...). */
export function buildGroupCreate(onCreate, error) {
  const wrap = el('span', 'radio-group-create');
  const b = el('button', 'radio-small-btn', '+ GROUP', { type: 'button', title: 'A new link group' });
  b.addEventListener('click', () => onCreate());
  wrap.appendChild(b);
  if (error) wrap.appendChild(el('span', 'radio-note radio-conflict', error));
  return wrap;
}
