'use strict';

// Tuning files (decisions.md P5, H88): the shipped JSON in config/ is the ONLY
// source of defaults, never a literal in code. A missing or unparseable shipped
// file is a startup error that names the file. A copy in state/ (or a test's
// explicit override path) layers over it. Read once at startup, never written.

const fs = require('fs');
const path = require('path');
const { CONFIG_DIR, readPath } = require('./state-paths');
const log = require('./log').logger('tuning');

/** The shipped default, parsed. Throws with the file name when it is missing or invalid. */
function readShipped(name) {
  const file = path.join(CONFIG_DIR, name);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`[tuning] cannot read the shipped tuning file ${file}: ${e.message}`);
  }
}

/**
 * The operator layer: the state/ copy (or `override`) when it exists and parses,
 * else null. An unreadable layer warns and is ignored; the shipped file still applies.
 *
 * With `shipped`, every key of the layer must be one the shipped file has (H88 item 8, decisions.md S-RENA2): a key
 * the build does not know (an older build's name, `stca` for `conflictAlert`) is an unknown persisted shape and a
 * startup error naming the file and the key, never a value silently ignored. `_comment`-style keys are free.
 */
function readLayer(name, override, shipped) {
  const file = readPath(name, override);
  if (file === path.join(CONFIG_DIR, name)) return null; // no state copy: the shipped file is the whole answer
  let layer;
  try {
    layer = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    log.warn('could not read file, using the shipped one', { file, shipped: name, error: e.message });
    return null;
  }
  if (shipped) checkLayerKeys(layer, shipped, file, name);
  return layer;
}

/** Throws naming `file` and the first key path of `layer` that `shipped` does not have. */
function checkLayerKeys(layer, shipped, file, name, at = '') {
  if (!layer || typeof layer !== 'object' || Array.isArray(layer) || !shipped || typeof shipped !== 'object' || Array.isArray(shipped)) return;
  for (const [k, v] of Object.entries(layer)) {
    if (k.startsWith('_')) continue;
    const key = at ? `${at}.${k}` : k;
    if (!Object.prototype.hasOwnProperty.call(shipped, k)) {
      throw new Error(`[tuning] ${file} has an unknown key "${key}" (config/${name} has no such key; an older build's name?): remove or rename it`);
    }
    checkLayerKeys(v, shipped[k], file, name, key);
  }
}

module.exports = { readShipped, readLayer };
