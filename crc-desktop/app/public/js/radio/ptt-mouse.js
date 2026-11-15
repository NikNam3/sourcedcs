'use strict';

// Mouse buttons as a window PTT input (the PTT key and the intercom PTT key, docs/adr/0166 §1; the human 2026-11-15).
// Stored beside the KeyboardEvent.code a key is stored as, under names no key has. Only the middle button and the two
// side buttons: the left and right buttons are the scope's (clicks, Ctrl + right-drag heading, the measure line), and the
// Global PTT allowlist (global-ptt/input-allowlist.js) refuses them for the same reason.

const BY_BUTTON = Object.freeze({ 1: 'MouseMiddle', 3: 'Mouse4', 4: 'Mouse5' }); // MouseEvent.button
const LABELS = Object.freeze({ MouseMiddle: 'Middle Mouse', Mouse4: 'Mouse 4', Mouse5: 'Mouse 5' });

/** The stored code for a MouseEvent.button, or null when that button may not be a PTT. */
export function mouseCode(button) { return BY_BUTTON[button] || null; }

/** True for a stored code that names a mouse button. */
export function isMouseCode(code) { return Object.prototype.hasOwnProperty.call(LABELS, code); }

/** The label for a stored mouse code, or null. */
export function mouseLabel(code) { return LABELS[code] || null; }
