'use strict';
// A data block's size on the screen, estimated from its text (docs/adr/0165), for the two things that must clear it:
// the leader line's end and the side of the block facing its track. A leaf: imports nothing.
//
// MapLibre does not report a symbol's box, so it is estimated: every glyph CHAR_EM wide (Roboto Mono is 0.6 em; the
// tactical label's Roboto runs a little narrower, so the estimate is on the safe side), lines LINE_EM apart (MapLibre's
// default `text-line-height`). The block is drawn `text-anchor: center`, so it grows both ways from its anchor.

export const CHAR_EM = 0.6;
export const LINE_EM = 1.2;

/**
 * @param {string[]} lines  the block's lines, as drawn
 * @param {number} textSizePx
 * @returns {{halfW:number, halfH:number}} half the block's width and height in pixels
 */
export function labelBoxPx(lines, textSizePx) {
  const list = (lines || []).filter(l => l != null);
  const longest = list.reduce((m, l) => Math.max(m, Array.from(String(l)).length), 0);
  return { halfW: (longest * CHAR_EM * textSizePx) / 2, halfH: (list.length * LINE_EM * textSizePx) / 2 };
}

/**
 * How far to move a block sideways (pixels) so that a block wider than the base one grows away from its track
 * instead of toward it: the side facing the track stays where a base-width block's would be.
 * @param {number} halfW  this block's half width
 * @param {number} baseHalfW  the half width every leader and default offset is laid out for (scope-constants LABEL_HALF_W)
 * @param {number} dxPx  the anchor's horizontal offset from its track, in pixels (its sign says which side the block is on)
 */
export function labelNudgePx(halfW, baseHalfW, dxPx) {
  const extra = halfW - baseHalfW;
  if (!(extra > 0) || !dxPx) return 0;
  return dxPx > 0 ? extra : -extra;
}

/**
 * The distance from a block's centre to its edge along a unit direction (ux, uy): where a leader aimed at the centre
 * meets the box.
 */
export function boxEdgeDistPx(ux, uy, halfW, halfH) {
  const ax = Math.abs(ux); const ay = Math.abs(uy);
  const tx = ax > 1e-9 ? halfW / ax : Infinity;
  const ty = ay > 1e-9 ? halfH / ay : Infinity;
  const d = Math.min(tx, ty);
  return Number.isFinite(d) ? d : 0;
}
