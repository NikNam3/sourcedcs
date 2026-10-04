'use strict';
import { missionNow } from '../../mission-clock.js';

// The Strip face's small DOM helpers (DESK-SPLIT, split out of strip-view.js): element and button builders, the waiting-time text.

export const STRIP_TYPE_ABBR = { DEPARTURE: 'DEP', ARRIVAL: 'ARR', OVERFLIGHT: 'OVF', MISSION: 'MSN', MARSHAL: 'MAR', FINAL: 'FNL', PATTERN: 'PAT' };

export function _stripEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) _addClass(node, className);
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Adds classes through `className` AND `classList`. In a browser the second is
 * a no-op; the node tests' DOM stub keeps the two apart, and its assertions
 * read both (descendants by className, a node's own classList.contains).
 */
export function _addClass(node, classes) {
  for (const c of String(classes).split(/\s+/).filter(Boolean)) {
    if (!(' ' + (node.className || '') + ' ').includes(' ' + c + ' ')) {
      node.className = node.className ? `${node.className} ${c}` : c;
    }
    if (node.classList) node.classList.add(c);
  }
}

/** One Strip button, in the single button style. `legacy` keeps the class tests and older CSS select on. */
export function _stripButton(label, legacy, { go = false, disabled = false, title = '', action = '', onClick = null } = {}) {
  const btn = _stripEl('button', `efsp-sbtn${go ? ' efsp-sbtn-go' : ''}${legacy ? ' ' + legacy : ''}`, label);
  if (title) btn.title = title;
  if (action) btn.dataset.stripAction = action;
  if (disabled) btn.disabled = true;
  else if (onClick) {
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(e, btn); });
  }
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  return btn;
}

function _waitingText(since) {
  if (!since) return '';
  // `since` is crc-sync's mission clock (docs/adr/0079), so the elapsed time
  // is measured against the same clock — topbar.js's missionNow().
  const now = missionNow();
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * An exchange's state line: the state word, then " · 0:42" for how long it has
 * waited when the record says when it started. The clock is its own span so
 * the ticker below can rewrite it without rebuilding the Strip.
 */
export function _stateMeta(word, since) {
  const meta = _stripEl('div', 'efsp-x-meta', word);
  if (since) {
    const clock = _stripEl('span', 'efsp-x-waiting', ` · ${_waitingText(since)}`);
    clock.dataset.waitingSince = String(since);
    meta.appendChild(clock);
    _startWaitingTicker();
  }
  return meta;
}

// One interval for the whole panel, rewriting only the elapsed text. Never part
// of the render signature, so a ticking clock never rebuilds a Strip.
let _waitingTicker = null;

function _startWaitingTicker() {
  if (_waitingTicker || typeof setInterval !== 'function' || typeof document === 'undefined'
    || typeof document.querySelectorAll !== 'function') return;
  _waitingTicker = setInterval(() => {
    const nodes = document.querySelectorAll('[data-waiting-since]');
    if (nodes.length === 0) { clearInterval(_waitingTicker); _waitingTicker = null; return; }
    for (const n of nodes) n.textContent = ` · ${_waitingText(Number(n.dataset.waitingSince))}`;
  }, 1000);
}

// ── The tab ────────────────────────────────────────────────────────────────
