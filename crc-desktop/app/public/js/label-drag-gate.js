'use strict';
// Click or drag on a contact's label (docs/wip/STRIP-JUMP.md). A leaf: map-interactions.js feeds it the label's
// mouse-down, the distance moved and the click. The dragged state lives for ONE press: a drag released off the label gets
// no click event to clear it, and the next label click used to be thrown away. down() starts every press clean.

/** How far the mouse must travel before a press on a label is a drag rather than a click. Ours; map-setup.js sets MapLibre's clickTolerance to it, so every press is one or the other. */
export const LABEL_DRAG_THRESHOLD_PX = 8;

export function createLabelDragGate(thresholdPx = LABEL_DRAG_THRESHOLD_PX) {
  let dragged = false;
  return {
    /** A press on a label begins. */
    down() { dragged = false; },
    /** The mouse is `distPx` from where the press began. True when the label should follow it. */
    move(distPx) {
      if (!dragged && distPx >= thresholdPx) dragged = true;
      return dragged;
    },
    /** The press ended in a click on the label: true to treat it as a click (it was not a drag). */
    takeClick() {
      const wasDrag = dragged;
      dragged = false;
      return !wasDrag;
    },
  };
}
