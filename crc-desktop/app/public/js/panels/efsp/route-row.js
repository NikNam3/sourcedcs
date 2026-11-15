'use strict';
// The Blocks a Strip draws as a full-width row at its bottom, the whole text wrapped over as many lines as it needs, never
// cut or ellipsised (lane U-STRIP-FACE, SF-Q2 a, SF-Q3 a: the last row of the face, under the remarks). Today the route: the
// filed route (9) and the full route clearance (9D). Their editor wraps too (bay/block-edit.js). A leaf module.

export const FULL_ROW_BLOCKS = Object.freeze(['9', '9D']);

/** Is this Block drawn as the bottom full-width row (and edited in a wrapping box)? */
export function isFullRowBlock(blockId) {
  return FULL_ROW_BLOCKS.includes(blockId);
}

/** A route as it is stored: one line, newlines (a paste) folded to spaces. */
export function oneLine(text) {
  return String(text == null ? '' : text).replace(/[\r\n]+/g, ' ');
}
