'use strict';
import { pickerText } from '../../../../track-label.js';
import { _mountPopover, _unmountPopover } from '../popover-portal.js';
import { _dispatchCorrelation } from '../../bay-view.js';


let _openBindPopoverEl = null;

function _closeBindPopover() {
  _unmountPopover(_openBindPopoverEl);
  _openBindPopoverEl = null;
  document.removeEventListener('pointerdown', _onDocPointerDownCloseBindPopover, true);
}

// The dismiss-on-outside-click listener MUST test the target, the way
// _onDocPointerDownCloseTofiPopover and its Coordinate/Highlight peers always
// have. This one was registered as a bare `_closeBindPopover`, so it closed on
// ANY pointerdown — including one inside its own popover.
//
// The popover's own `pointerdown` -> stopPropagation() looks like it should
// prevent that and cannot: this listener is on `document` in the CAPTURE
// phase, so it runs BEFORE the event ever reaches the popover to be stopped.
// The candidate row was therefore torn out of the DOM between pointerdown and
// pointerup, and a `click` never fired on it at all — so binding by pointer
// silently did nothing, while `.bind` worked and every dispatch test passed
// (the DOM stub invokes click handlers directly and fires no pointerdown).
function _onDocPointerDownCloseBindPopover(e) {
  if (_openBindPopoverEl && !_openBindPopoverEl.contains(e.target)) _closeBindPopover();
}

/**
 * A picker of candidate contacts. `candidateTrackIds` narrows it to the ones
 * the server called ambiguous; null offers everything currently on the scope,
 * which is the uncorrelated case where the controller knows something the
 * matcher cannot.
 */
export function _openBindPopover(strip, anchorEl, candidateTrackIds) {
  _closeBindPopover();
  const popover = document.createElement('div');
  popover.className = 'efsp-coordinate-popover';
  popover.addEventListener('pointerdown', (e) => e.stopPropagation());

  const ids = candidateTrackIds && candidateTrackIds.length
    ? candidateTrackIds
    : (typeof window !== 'undefined' && typeof window.getAllTracks === 'function'
      ? window.getAllTracks().filter(t => t.domain === 'AIR').map(t => String(t.id))
      : []);

  if (ids.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'efsp-coordinate-degraded-warning';
    // Under the station-derived picture an empty scope has a cause worth
    // naming (crc-sync's docs/adr/0042) — a Position with no radar sees
    // nothing, so there is nothing to bind.
    empty.textContent = 'No contacts in your coverage to bind.';
    popover.appendChild(empty);
  }

  for (const trackId of ids) {
    const track = typeof window !== 'undefined' && typeof window.getLatestTrack === 'function'
      ? window.getLatestTrack(trackId) : null;
    const row = document.createElement('button');
    row.className = 'efsp-coordinate-submit';
    row.textContent = track ? pickerText(track) : String(trackId);
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      _dispatchCorrelation(strip, { kind: 'BindTrack', trackId: String(trackId) });
      _closeBindPopover();
    });
    popover.appendChild(row);
  }

  _openBindPopoverEl = popover;
  _mountPopover(popover, anchorEl, strip, _closeBindPopover);
  setTimeout(() => document.addEventListener('pointerdown', _onDocPointerDownCloseBindPopover, true), 0);
}
