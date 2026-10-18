'use strict';
// Map glyphs for server.js's /fonts/ route, bundled under public/fonts/ so labels and tracks never depend on MapTiler (a
// failed glyph range errors the whole tile of a GeoJSON source, tracks included).
//
// maplibre asks for the whole stack in one request, "Roboto Regular,Noto Sans Regular". The answer MERGES the fonts we
// ship: their range files are concatenated fallback-first, primary-last. A glyph PBF is one protobuf message whose
// fontstacks are a repeated field, so concatenation is a valid message holding every font, and maplibre 3.6.2 keeps the
// LAST glyph it reads for a code point (loadGlyphRange: `glyphs[glyph.id] = glyph`). So Roboto draws what Roboto has, and
// Noto Sans fills in what it lacks: the ↑↓ trend arrows, ▲▼, ≠ and the rest (returning only the first shipped font
// would draw none of those).
// A Roboto Mono face (not in the openmaptiles set) stands in as the Roboto face of the same weight; a stack with no font
// we ship gets Roboto Regular; a range we don't ship answers an empty 200, which draws nothing instead of erroring the tile.

const fs = require('fs');
const path = require('path');

const ROUTE = /^\/fonts\/([^/]+)\/(\d{1,5}-\d{1,5})\.pbf$/;
const FONT_NAME = /^[A-Za-z0-9 ]+$/;
const ALIAS = { 'Roboto Mono Regular': 'Roboto Regular', 'Roboto Mono Medium': 'Roboto Medium' };
const DEFAULT_FONT = 'Roboto Regular';

/**
 * Resolves one request URL. Returns null when it is not a glyph URL, { status: 400 } for a malformed stack, and
 * otherwise { status: 200, body: Buffer } (empty when no shipped font has the range). Never reads outside `fontsDir`:
 * a font name is letters, digits and spaces only, and the range is digits.
 */
function resolveGlyphs(url, fontsDir) {
  const m = ROUTE.exec(String(url).split('?')[0]);
  if (!m) return null;
  let stack;
  try { stack = decodeURIComponent(m[1]).split(',').map((f) => f.trim()); } catch (_) { return { status: 400 }; }
  const shipped = (f) => FONT_NAME.test(f) && fs.existsSync(path.join(fontsDir, f));
  const fonts = [];
  for (const f of stack) {
    const name = shipped(f) ? f : (ALIAS[f] && shipped(ALIAS[f]) ? ALIAS[f] : null);
    if (name && !fonts.includes(name)) fonts.push(name);
  }
  if (!fonts.length && shipped(DEFAULT_FONT)) fonts.push(DEFAULT_FONT);
  const parts = [];
  for (const f of fonts.reverse()) {
    try { parts.push(fs.readFileSync(path.join(fontsDir, f, `${m[2]}.pbf`))); } catch (_) { /* not shipped for this font */ }
  }
  return { status: 200, body: Buffer.concat(parts) };
}

module.exports = { resolveGlyphs };
