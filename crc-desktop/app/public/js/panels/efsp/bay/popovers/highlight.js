'use strict';
import { getEfspStrip } from '../../efsp-state.js';
import { setHighlight } from '../../efsp-gestures.js';
import { noteEfspGesture } from '../../efsp-metrics-client.js';
import { _dispatchGesture } from '../../bay-view.js';
import { _mountPopover, _unmountPopover } from '../popover-portal.js';


// Small, fixed swatch set for Highlight (guide §7.3) — deliberately NOT
// red, which §7.7 rule 4 reserves for Attention alone ("reserve saturated
// colour for exceptions" — if both gestures could paint the same colour,
// a controller scanning the Board couldn't tell which one they're looking
// at). setHighlight replaces a different active colour in one Mutation and
// clears on a repeat of the same colour (see efsp-gestures.test.js).
//
// Inputs, counted honestly (S-L15; the comment here used to say the swatch met the
// one-input ceiling, which it does not: right-click + swatch is TWO). The one-input
// entry point is Ctrl+click on the Strip, which steps the colour through the swatches
// and then off (_cycleHighlight). The popover remains for choosing a colour directly.
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

let _openHighlightPopoverEl = null;

function _closeHighlightPopover() {
  if (!_openHighlightPopoverEl) return;
  _unmountPopover(_openHighlightPopoverEl);
  _openHighlightPopoverEl = null;
  document.removeEventListener('pointerdown', _onDocPointerDownCloseHighlightPopover, true);
}

function _onDocPointerDownCloseHighlightPopover(e) {
  if (_openHighlightPopoverEl && !_openHighlightPopoverEl.contains(e.target)) _closeHighlightPopover();
}

export function _openHighlightPopover(strip, anchorEl) {
  _closeHighlightPopover();
  const popover = document.createElement('div');
  popover.className = 'efsp-highlight-popover';
  for (const color of HIGHLIGHT_SWATCHES) {
    const swatch = document.createElement('button');
    swatch.className = 'efsp-highlight-swatch';
    swatch.style.background = color;
    swatch.title = color;
    swatch.addEventListener('pointerdown', (e) => e.stopPropagation());
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      const acting = _dispatchGesture(strip, setHighlight, color); if (typeof noteEfspGesture === 'function') noteEfspGesture('HIGHLIGHT', 'contextmenu+swatch', acting);
      _closeHighlightPopover();
    });
    popover.appendChild(swatch);
  }
  _openHighlightPopoverEl = popover;
  _mountPopover(popover, anchorEl, strip, _closeHighlightPopover);
  // Deferred so the contextmenu event that opened this doesn't immediately
  // close it via the same pointerdown-outside listener.
  setTimeout(() => document.addEventListener('pointerdown', _onDocPointerDownCloseHighlightPopover, true), 0);
}
