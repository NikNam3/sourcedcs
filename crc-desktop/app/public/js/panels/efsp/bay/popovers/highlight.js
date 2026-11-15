'use strict';
import { getEfspStrip } from '../../efsp-state.js';
import { setHighlight } from '../../efsp-gestures.js';
import { noteEfspGesture } from '../../efsp-metrics-client.js';
import { _dispatchGesture } from '../dispatch.js';
import { effectiveFlag } from '../../flag-writer.js';
import { openPopover } from '../popover-portal.js';
import { HIGHLIGHT_SWATCHES, highlightFromInput, nextHighlightColour } from '../../highlight-colour.js';


// The Highlight swatch popover (guide §7.3, docs/adr/0165): eight swatches, a `#RRGGBB` box for any other colour, and ×
// to clear. Nothing close to red: §7.7 rule 4 reserves red for Attention alone ("reserve saturated colour for
// exceptions"), so a typed red is refused with a line saying so (highlight-colour.js isNearRed). setHighlight replaces a
// different active colour in one Mutation and clears on a repeat of the same colour (see efsp-gestures.test.mjs).
//
// Inputs, counted honestly: the swatch costs 2 inputs (right-click, then a swatch) against guide §7.3's ceiling of 1;
// accepted (S-L15). Ctrl+click on the Strip is the one-input entry point: it steps the colour through the swatches and
// then off (_cycleHighlight).

export function _cycleHighlight(strip) {
  const live = getEfspStrip(strip.stripId) || strip;
  return _dispatchGesture(strip, setHighlight, nextHighlightColour(effectiveFlag(live, 'highlight')));
}

let _openPopoverHandle = null;

function _closeHighlightPopover() { if (_openPopoverHandle) _openPopoverHandle.close(); }

function _pick(strip, colour) {
  const acting = _dispatchGesture(strip, setHighlight, colour); noteEfspGesture('HIGHLIGHT', 'contextmenu+swatch', acting);
  _closeHighlightPopover();
}

function _button(cls, title, onClick) {
  const b = document.createElement('button');
  b.className = cls;
  b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

/** The `#RRGGBB` box: Enter sets a colour that is not red, anything else says why under it. */
function _hexRow(strip, current) {
  const row = document.createElement('div');
  row.className = 'efsp-highlight-hex-row';
  const input = document.createElement('input');
  input.className = 'efsp-highlight-hex';
  input.type = 'text';
  input.maxLength = 7;
  input.spellcheck = false;
  input.placeholder = '#RRGGBB';
  input.title = 'Any colour as #RRGGBB, then Enter (not red: that is ATTENTION\'s)';
  if (current && /^#[0-9a-f]{6}$/i.test(current)) input.value = current;
  const error = document.createElement('div');
  error.className = 'efsp-highlight-error';
  error.hidden = true;
  const submit = () => {
    const r = highlightFromInput(input.value);
    if (r.error) { error.textContent = r.error; error.hidden = false; return; }
    // The colour the Strip already has would clear it (setHighlight's toggle); typing it again means keep it.
    if (r.colour === current) { _closeHighlightPopover(); return; }
    _pick(strip, r.colour);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') { e.preventDefault(); _closeHighlightPopover(); }
  });
  input.addEventListener('input', () => { error.hidden = true; });
  input.addEventListener('click', (e) => e.stopPropagation());
  row.appendChild(input);
  row.appendChild(error);
  return row;
}

export function _openHighlightPopover(strip, anchorEl) {
  _closeHighlightPopover();
  const current = effectiveFlag(getEfspStrip(strip.stripId) || strip, 'highlight');
  const popover = document.createElement('div');
  popover.className = 'efsp-highlight-popover';
  const swatches = document.createElement('div');
  swatches.className = 'efsp-highlight-palette';
  for (const { name, hex } of HIGHLIGHT_SWATCHES) {
    const swatch = _button('efsp-highlight-swatch', name, () => _pick(strip, hex));
    swatch.style.background = hex;
    swatch.dataset.colour = hex;
    if (hex === current) swatch.classList.add('efsp-highlight-current');
    swatches.appendChild(swatch);
  }
  // Off: clicking the colour the Strip already has clears it too, but nobody finds that by looking.
  if (current) {
    const off = _button('efsp-highlight-swatch efsp-highlight-off', 'No highlight', () => _pick(strip, null));
    off.textContent = '×';
    swatches.appendChild(off);
  }
  popover.appendChild(swatches);
  popover.appendChild(_hexRow(strip, current));
  _openPopoverHandle = openPopover({ el: popover, anchor: anchorEl, strip, onClose: () => { _openPopoverHandle = null; } });
}
