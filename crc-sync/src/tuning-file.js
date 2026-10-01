'use strict';

// Tuning files (decisions.md P5, H88): the shipped JSON in config/ is the ONLY
// source of defaults, never a literal in code. A missing or unparseable shipped
// file is a startup error that names the file. A copy in state/ (or a test's
// explicit override path) layers over it. Read once at startup, never written.

const fs = require('fs');
const path = require('path');
const { CONFIG_DIR, readPath } = require('./state-paths');

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
 */
function readLayer(name, override) {
  const file = readPath(name, override);
  if (file === path.join(CONFIG_DIR, name)) return null; // no state copy: the shipped file is the whole answer
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn(`[tuning] could not read ${file} (${e.message}), using the shipped ${name}`);
    return null;
  }
}

module.exports = { readShipped, readLayer };
