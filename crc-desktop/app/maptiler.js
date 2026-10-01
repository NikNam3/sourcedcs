'use strict';
// The MapTiler API key: one source of truth (QAC D-3). It used to be spelled
// out in elevation.js and in crc-desktop-scope-style.json. Now the local
// server reads it once (CRC_MAPTILER_KEY, else the squadron's shipped default
// below), hands it to the renderer as MAPTILER_KEY in /js/config.js, and fills
// the style JSON's placeholder when it serves that file.
const DEFAULT_MAPTILER_KEY = 'b08eN2ojRae78YJNYhyu';
const KEY_PLACEHOLDER = '__MAPTILER_KEY__';

function maptilerKey(env = process.env) {
  return (env.CRC_MAPTILER_KEY || '').trim() || DEFAULT_MAPTILER_KEY;
}

function renderStyle(styleText, key) {
  return styleText.split(KEY_PLACEHOLDER).join(key);
}

module.exports = { DEFAULT_MAPTILER_KEY, KEY_PLACEHOLDER, maptilerKey, renderStyle };
