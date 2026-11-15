'use strict';
import { getEfspBays, getEfspStrip } from './efsp-state.js';
import { getActingPositions } from './efsp-ws.js';
import { _stripElById } from './bay/open-bays.js';
import { hasOpenPopover } from './bay/popover-portal.js';
import { _setActiveBayId, _setActivePositionTab } from './panel/state.js';
import { markEfspChanged } from './efsp-change-bus.js';

// Contact click -> the Strip panel shows the Strip (docs/wip/STRIP-JUMP.md). A controller holding several Positions has a
// dozen Bays; clicking a contact on the map switches the panel to the Position tab and Bay that hold its Strip, so it can
// be worked at once. Called by correlation-highlight.js's selectStripForTrack before it selects (and scrolls to) the Strip.
//
// It switches only inside the Strip panel and never brings the panel's dock tab forward: the track panel opens on the same
// click and the two can share a dock group. It never imports tabs.js (that would close an import cycle through
// bay-view.js); it writes the leaf panel/state.js and marks 'tabs', which tabs.js redraws on, synchronously.
//
// An open Block edit does not stop it: the draft survives a rebuild and comes back with its Strip (bay/block-edit.js).
// An open Strip popover does: it is anchored to a Strip element the switch would take off screen.

/**
 * Where the panel must go to show `strip`, or null to stay. Pure.
 * @param {object|null} strip
 * @param {{bays: Array<{bayId:string, positionId:string}>, actingPositionIds: string[], onScreen: boolean, editing: boolean}} o
 * @returns {{positionId: string, bayId: string} | null}
 */
export function stripRevealTarget(strip, { bays, actingPositionIds, onScreen, editing }) {
  if (!strip || onScreen || editing) return null;
  const bay = (bays || []).find(b => b.bayId === strip.bayId);
  if (!bay || !(actingPositionIds || []).includes(bay.positionId)) return null;
  return { positionId: bay.positionId, bayId: bay.bayId };
}

/** Switches the panel to the Strip's Position and Bay when stripRevealTarget says so. Returns whether it switched. */
export function revealEfspStrip(stripId) {
  const target = stripRevealTarget(getEfspStrip(stripId) || null, {
    bays: getEfspBays(),
    actingPositionIds: getActingPositions(),
    onScreen: !!_stripElById(stripId),
    editing: hasOpenPopover(),
  });
  if (!target) return false;
  _setActivePositionTab(target.positionId);
  _setActiveBayId(target.bayId);
  markEfspChanged('tabs');
  return true;
}
