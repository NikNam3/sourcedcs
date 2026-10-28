'use strict';
import { isWithOthersBayId } from '../efsp-state.js';


export function _stripElById(stripId) {
  for (const { containerEl } of _openBayContainers || []) {
    const el = containerEl && containerEl.querySelector
      && containerEl.querySelector(`[data-strip-id="${stripId}"]`);
    if (el) return el;
  }
  return null;
}

/** The Bays currently on screen — correlation-highlight.js prefers a Strip in one. */
export function getOpenEfspBayIds() {
  return (_openBayContainers || []).map(entry => entry.bayId).filter(Boolean);
}

/** The client-local Bays (search results, "with AIC/JTAC"): views onto live Strips, never a destination. */
export function _isPseudoBayId(bayId) {
  return bayId.endsWith('-search') || (isWithOthersBayId(bayId));
}
export let _openBayContainers = []; // [{containerEl, bayId}] — element references, not ids; set by efsp-panel.js as the user switches Bay tabs

export function setOpenEfspBays(containers) { _openBayContainers = containers; }
