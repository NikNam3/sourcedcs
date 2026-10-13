'use strict';
// The Strip face's remarks row (decisions.md H138 U2, H139): the flight's remarks in one bottom row on every strip type,
// only when there are some (an absent row takes no space). One line, never growing the Strip or running under a field:
// cut at a word boundary with an ellipsis (strip-template.js cutRemarksToFit), the whole text on hover and in the
// text-box window a click opens (bay/popovers/remarks.js).
import { getEfspFlightData } from './efsp-state.js';
import { blockLabelFor, cutRemarksToFit, remarksBlockFor, remarksOf } from './strip-template.js';
import { _refusalForStrip } from './bay/block-edit.js';
import { openRemarksPopover } from './bay/popovers/remarks.js';
import { _stripEl } from './strip-dom.js';

// The row's width follows the Strip's (a resized panel, a Bay that gains a scrollbar), so the cut is redone whenever it
// changes. One observer for every row; a row that left the page stops being observed on its next notification.
let _observer = null;
const _fullText = new WeakMap();

function _fit(el) {
  const full = _fullText.get(el);
  if (full == null || !el.isConnected) return;
  const fits = (candidate) => { el.textContent = candidate; return el.scrollWidth <= el.clientWidth; };
  el.textContent = cutRemarksToFit(full, fits);
}

function _observe(el) {
  if (typeof ResizeObserver !== 'function') return; // the node tests' DOM; CSS's own ellipsis still cuts the line
  if (!_observer) {
    _observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (!entry.target.isConnected) { _observer.unobserve(entry.target); continue; }
        _fit(entry.target);
      }
    });
  }
  _observer.observe(el);
}

/** @returns {HTMLElement|null} the remarks row for this Strip, or null when its flight has none. */
export function _buildRemarksRow(strip) {
  const blockId = remarksBlockFor(strip.stripType);
  if (!blockId) return null;
  const full = remarksOf(getEfspFlightData(strip.flightDataId));
  if (!full) return null;
  const row = _stripEl('div', 'efsp-strip-remarks');
  row.dataset.block = blockId;
  row.appendChild(_stripEl('span', 'efsp-block-label efsp-strip-remarks-label', blockLabelFor(blockId, strip.stripType) || 'RMKS'));
  const text = _stripEl('span', 'efsp-strip-remarks-text', full.replace(/\s+/g, ' ').trim());
  text.title = full;
  text.tabIndex = 0;
  text.setAttribute('role', 'button');
  text.dataset.remarksFull = full;
  const refusal = _refusalForStrip(strip);
  if (refusal && refusal.blockId === blockId) {
    text.classList.add('efsp-block-refused');
    text.title = `${refusal.message}\n\n${full}`;
  }
  const open = (e) => { e.stopPropagation(); openRemarksPopover(strip, row); };
  text.addEventListener('click', open);
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
  row.appendChild(text);
  _fullText.set(text, full);
  _observe(text);
  return row;
}
