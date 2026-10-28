'use strict';

// The squadron's comm card (decisions R3-53, H31, H84; DATA-3): approach types,
// the approach-button rule and the frequency list, from config/comm-card.json
// with an optional state/comm-card.json layer (CRCSYNC_COMM_CARD_PATH for a
// test). Read once at startup, never written by code (P5). A missing or invalid
// file is a start-up error naming the file and the key. The frequency list has
// no consumer yet.

const { readShipped, readLayer } = require('./tuning-file');
const { readPath } = require('./state-paths');

const FILE = 'comm-card.json';
const FREQUENCY_USES = Object.freeze(['approach', 'tower', 'ground', 'departure', 'atis', 'other']);

function validateCommCard(card, file = FILE) {
  const bad = (key, why) => { throw new Error(`[comm-card] ${file}: "${key}" ${why}`); };
  if (!card || typeof card !== 'object' || Array.isArray(card)) bad('(file)', 'must be an object');
  const t = card.approachTypes;
  if (!Array.isArray(t) || !t.length || !t.every((x) => typeof x === 'string' && x && x === x.toUpperCase() && x === x.trim()) || new Set(t).size !== t.length) {
    bad('approachTypes', 'must be a non-empty array of distinct upper-case strings');
  }
  const b = card.approachButtons;
  if (!b || typeof b !== 'object') bad('approachButtons', 'is missing');
  if (!Number.isInteger(b.min) || b.min < 0) bad('approachButtons.min', 'must be an integer >= 0');
  if (!Number.isInteger(b.max) || b.max < b.min) bad('approachButtons.max', 'must be an integer >= min');
  if (b.max >= 100) bad('approachButtons.max', 'must be below 100 (a button, never a frequency: guide 9.12 rule 6)');
  if (!Array.isArray(b.buttons)) bad('approachButtons.buttons', 'must be an array');
  const seen = new Set();
  b.buttons.forEach((e, i) => {
    const at = `approachButtons.buttons[${i}]`;
    if (!e || typeof e !== 'object') bad(at, 'must be { button, label }');
    if (!Number.isInteger(e.button) || e.button < b.min || e.button > b.max) bad(`${at}.button`, `must be an integer within ${b.min}..${b.max}`);
    if (seen.has(e.button)) bad(`${at}.button`, `${e.button} is listed twice`);
    seen.add(e.button);
    if (typeof e.label !== 'string' || !e.label.trim()) bad(`${at}.label`, 'must be a non-empty string');
  });
  if (!Array.isArray(card.frequencies)) bad('frequencies', 'must be an array');
  const ids = new Set();
  card.frequencies.forEach((f, i) => {
    const at = `frequencies[${i}]`;
    if (!f || typeof f !== 'object') bad(at, 'must be { id, name, mhz, use }');
    if (typeof f.id !== 'string' || !f.id) bad(`${at}.id`, 'must be a non-empty string');
    if (ids.has(f.id)) bad(`${at}.id`, `"${f.id}" is used twice`);
    ids.add(f.id);
    if (typeof f.name !== 'string' || !f.name.trim()) bad(`${at}.name`, 'must be a non-empty string');
    if (typeof f.mhz !== 'number' || !Number.isFinite(f.mhz) || f.mhz <= 0) bad(`${at}.mhz`, 'must be a number > 0');
    if (!FREQUENCY_USES.includes(f.use)) bad(`${at}.use`, `must be one of ${FREQUENCY_USES.join(', ')}`);
  });
  return card;
}

/** The shipped card with the state/ layer (or `override`) laid over it key by key, validated. */
function loadCommCard(override = process.env.CRCSYNC_COMM_CARD_PATH) {
  const shipped = readShipped(FILE);
  validateCommCard(shipped, `config/${FILE}`);
  const layer = readLayer(FILE, override, shipped);
  if (!layer) return shipped;
  return validateCommCard({ ...shipped, ...layer }, readPath(FILE, override));
}

module.exports = { loadCommCard, validateCommCard, FREQUENCY_USES };
