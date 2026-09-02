'use strict';

// The dot-command surface (guide §7.1 rule 5) — a persistent single-line
// input accepting `.verb args`, with a preview/echo area before commit.
// Parsing is kept PURE/testable; the actual input-element wiring
// (keystroke handling, preview rendering, verb dispatch) lives in
// efsp-panel.js. Phase 1 defines no fixed verb vocabulary yet — the guide
// doesn't specify one for DEPARTURE strips — so this module only parses;
// efsp-panel.js's dispatcher is free to grow verbs (.hold, .release,
// .drop, ...) without this file changing shape.

const DOT_COMMAND_RE = /^\.(\S+)(?:\s+(.*))?$/;

/**
 * @param {string} raw
 * @returns {{verb:string, args:string[]}|null} null if `raw` isn't a
 *   well-formed dot-command (doesn't start with '.', or is empty/whitespace).
 */
function parseDotCommand(raw) {
  const trimmed = (raw || '').trim();
  const match = DOT_COMMAND_RE.exec(trimmed);
  if (!match) return null;
  const verb = match[1].toLowerCase();
  const argsStr = match[2] || '';
  const args = argsStr.length > 0 ? argsStr.split(/\s+/) : [];
  return { verb, args };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseDotCommand };
}
