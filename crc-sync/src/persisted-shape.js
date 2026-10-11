'use strict';

// A persisted shape: every key a strict file may hold, as one data structure (H88 item 8, decisions.md S-RENA2).
// A key the build does not know stops start-up, naming the file and the key path. The Board snapshot
// (efsp/stores.js's checkPersistedShape) and the carrier hull config (efsp/carrier/hull-config.js, H127) use it.
// A leaf: it requires nothing.
//
//   true          any value, not looked into
//   { k: shape }  an object whose keys must be among these
//   { '[]': s }   an array; each object element has shape s
//   { '*': s }    an object keyed by ids (Facilities, Block ids, Position ids, stacks); each value has shape s

const anyOf = (...names) => Object.fromEntries(names.map(n => [n, true]));
const arrayOf = (shape) => ({ '[]': shape });
const mapOf = (shape) => ({ '*': shape });

/**
 * Throws `unknownKey(path)` at the first key path `shape` does not know, and `arrayWhereObject(path)` at an array
 * where the shape expects an object. With `freeUnderscore`, a `_comment`-style key is free at any level.
 */
function checkShape(data, shape, { unknownKey, arrayWhereObject, freeUnderscore = false }) {
  const walk = (v, s, at) => {
    if (s === true || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      if (!s['[]']) throw arrayWhereObject(at);
      v.forEach(e => walk(e, s['[]'], `${at}[]`));
      return;
    }
    for (const [k, child] of Object.entries(v)) {
      if (freeUnderscore && k.startsWith('_')) continue;
      const sub = s['*'] || (Object.prototype.hasOwnProperty.call(s, k) ? s[k] : undefined);
      if (sub === undefined) throw unknownKey(at ? `${at}.${k}` : k);
      walk(child, sub, at ? `${at}.${k}` : k);
    }
  };
  walk(data, shape, '');
}

module.exports = { anyOf, arrayOf, mapOf, checkShape };
