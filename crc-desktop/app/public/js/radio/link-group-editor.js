'use strict';

// The radio panel's small group editor: each section's header (the automatic group's name, a user group's name with
// RENAME and DELETE, or UNLINKED), and the "+ GROUP" button. The rules (default names, unique names, delete makes the
// radios unlinked) are link-groups.js's; this file only draws and calls back.

import { el } from './radio-dom.js';

/**
 * @param {{ id, name, auto } | null} group   null: the unlinked section
 * @param {object} ctx  renaming (this group's id is being renamed), renameError, onRename(on), onRenameCommit(text), onDelete()
 */
export function buildGroupHeader(group, ctx = {}) {
  const head = el('div', 'radio-group-head');
  if (!group) { head.appendChild(el('span', 'radio-group-name', 'UNLINKED')); return head; }
  if (group.auto) {
    head.appendChild(el('span', 'radio-group-name', group.name, { title: 'Every Position radio, linked: PTT transmits on all of them' }));
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
