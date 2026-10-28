'use strict';
import { getEfspStrip } from '../../efsp-state.js';
import { setHighlight } from '../../efsp-gestures.js';
import { noteEfspGesture } from '../../efsp-metrics-client.js';
import { _dispatchGesture } from '../dispatch.js';
import { openPopover } from '../popover-portal.js';


// Small, fixed swatch set for Highlight (guide §7.3) — deliberately NOT
// red, which §7.7 rule 4 reserves for Attention alone ("reserve saturated
// colour for exceptions" — if both gestures could paint the same colour,
// a controller scanning the Board couldn't tell which one they're looking
// at). setHighlight replaces a different active colour in one Mutation and
// clears on a repeat of the same colour (see efsp-gestures.test.mjs).
//
// Inputs, counted honestly: the swatch costs 2 inputs (right-click, then a swatch)
// against guide §7.3's ceiling of 1; accepted for now (S-L15), one-input entry
// points are a later UI lane's. Ctrl+click on the Strip is the one-input entry
// point: it steps the colour through the swatches and then off (_cycleHighlight).
// The popover remains for choosing a colour directly.
const HIGHLIGHT_SWATCHES = ['yellow', 'cyan', 'lime'];

/** The colour one Ctrl+click moves a Strip to: the next swatch, or (past the last) the last again, which clears it. */
function _nextHighlightColor(current) {
  const i = HIGHLIGHT_SWATCHES.indexOf(current);
  return i < 0 ? HIGHLIGHT_SWATCHES[0] : HIGHLIGHT_SWATCHES[Math.min(i + 1, HIGHLIGHT_SWATCHES.length - 1)];
}

export function _cycleHighlight(strip) {
  const live = getEfspStrip(strip.stripId) || strip;
  return _dispatchGesture(strip, setHighlight, _nextHighlightColor(live.flags.highlight));
}

let _openPopoverHandle = null;

function _closeHighlightPopover() { if (_openPopoverHandle) _openPopoverHandle.close(); }

export function _openHighlightPopover(strip, anchorEl) {
  _closeHighlightPopover();
  const popover = document.createElement('div');
  popover.className = 'efsp-highlight-popover';
  for (const color of HIGHLIGHT_SWATCHES) {
    const swatch = document.createElement('button');
    swatch.className = 'efsp-highlight-swatch';
    swatch.style.background = color;
    swatch.title = color;
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      const acting = _dispatchGesture(strip, setHighlight, color); noteEfspGesture('HIGHLIGHT', 'contextmenu+swatch', acting);
      _closeHighlightPopover();
    });
    popover.appendChild(swatch);
  }
  _openPopoverHandle = openPopover({ el: popover, anchor: anchorEl, strip, onClose: () => { _openPopoverHandle = null; } });
}
