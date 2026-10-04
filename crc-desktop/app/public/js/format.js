'use strict';

// Display formatters with no dependencies. A leaf (DESK-GRAPH): the Strip rule modules and the panels both format a
// time, and a rule module must not import a panel to do it.

/** Epoch ms as the four-digit Zulu time a Strip shows ('1432'), or '' for no time. Mirrors crc-sync's zulu-time.js. */
export function formatZuluHhmm(ms) {
  if (ms == null || ms === '' || !Number.isFinite(Number(ms))) return '';
  const d = new Date(Number(ms));
  return String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0');
}
