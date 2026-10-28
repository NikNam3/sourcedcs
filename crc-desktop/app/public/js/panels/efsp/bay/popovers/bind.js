'use strict';
import { pickerText } from '../../../../track-label.js';
import { getAllTracks, getLatestTrack } from '../../../../picture.js';
import { openPopover } from '../popover-portal.js';
import { _dispatchCorrelation } from '../dispatch.js';


let _openPopoverHandle = null;

function _closeBindPopover() { if (_openPopoverHandle) _openPopoverHandle.close(); }

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

  const ids = candidateTrackIds && candidateTrackIds.length
    ? candidateTrackIds
    : getAllTracks().filter(t => t.domain === 'AIR').map(t => String(t.id));

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
    const track = getLatestTrack(trackId);
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

  _openPopoverHandle = openPopover({ el: popover, anchor: anchorEl, strip, onClose: () => { _openPopoverHandle = null; } });
}
