'use strict';
// HIGHLIGHT's colours (guide §7.3, docs/adr/0165): the eight swatches, the `#RRGGBB` a controller may type instead, and
// the one rule on it, that nothing close to red is a highlight: red is ATTENTION's (guide §7.7 rule 4, "reserve
// saturated colour for exceptions"), and a controller scanning the Board must never mistake one for the other.
// A leaf: imports nothing, so the popover, Ctrl+click and the tests share it.

/** The swatches, in Ctrl+click order. Light enough to read on the dark Board and as a callsign on the map. */
export const HIGHLIGHT_SWATCHES = Object.freeze([
  { name: 'yellow',   hex: '#ffe14d' },
  { name: 'cyan',     hex: '#33e0ff' },
  { name: 'lime',     hex: '#7cff4d' },
  { name: 'orange',   hex: '#ff9f1a' },
  { name: 'pink',     hex: '#ff6ec7' },
  { name: 'violet',   hex: '#a77bff' },
  { name: 'white',    hex: '#f2f2f2' },
  { name: 'sky blue', hex: '#6cb8ff' },
]);

/** What a highlight is called in a tooltip: its swatch's name, else the colour as stored. */
export function highlightName(colour) {
  const swatch = HIGHLIGHT_SWATCHES.find(s => s.hex === colour);
  return swatch ? swatch.name : String(colour);
}

// Close to red: a hue within RED_HUE_DEG of 0°, saturated and bright enough to read as a colour at all (a dark
// brown or a pale pinkish grey is not mistaken for ATTENTION's red). HSV, the picker's own model.
export const RED_HUE_DEG = 20;
export const RED_MIN_SATURATION = 0.4;
export const RED_MIN_VALUE = 0.35;

/** '#RRGGBB' (any case, with or without '#') as '#rrggbb', or null when it is not one. */
export function parseHexColour(text) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(text == null ? '' : text).trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

/** @returns {{h:number, s:number, v:number}} hue in degrees [0, 360), saturation and value in [0, 1] */
export function hexToHsv(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255; const g = ((n >> 8) & 255) / 255; const b = (n & 255) / 255;
  const max = Math.max(r, g, b); const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
}

/** Whether a '#rrggbb' colour reads as red (ATTENTION's), and so is no highlight. */
export function isNearRed(hex) {
  const { h, s, v } = hexToHsv(hex);
  const fromRed = Math.min(h, 360 - h);
  return fromRed <= RED_HUE_DEG && s >= RED_MIN_SATURATION && v >= RED_MIN_VALUE;
}

/**
 * What a typed colour becomes: `{ colour }` to set, or `{ error }` to show under the input.
 * @returns {{colour: string}|{error: string}}
 */
export function highlightFromInput(text) {
  const hex = parseHexColour(text);
  if (!hex) return { error: 'Type a colour as #RRGGBB' };
  if (isNearRed(hex)) return { error: 'Red is ATTENTION\'s, not a highlight' };
  return { colour: hex };
}

/**
 * The colour one Ctrl+click moves a Strip to: the next swatch, and past the last one, off (null). A colour that is no
 * swatch (typed, or a name an older client wrote) starts the cycle at the first swatch, as no highlight does.
 */
export function nextHighlightColour(current) {
  const i = HIGHLIGHT_SWATCHES.findIndex(s => s.hex === current);
  if (i < 0) return HIGHLIGHT_SWATCHES[0].hex;
  return i + 1 < HIGHLIGHT_SWATCHES.length ? HIGHLIGHT_SWATCHES[i + 1].hex : null;
}
