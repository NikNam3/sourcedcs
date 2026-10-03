'use strict';

// Session tuning (docs/wip/DESK-SIGNON.md): the sign-on grace. Shipped default in config/sign-on-grace.json; a copy in
// state/sign-on-grace.json overrides it key by key. Read once at startup, never written by code.

const { readShipped, readLayer } = require('./tuning-file');

const NAME = 'sign-on-grace.json';

function loadSessionConfig(override) {
  const shipped = readShipped(NAME);
  const layer = readLayer(NAME, override, shipped) || {};
  const merged = { ...shipped, ...layer };
  if (!Number.isFinite(merged.signOnGraceMs) || merged.signOnGraceMs < 0) throw new Error(`[tuning] ${NAME}: signOnGraceMs must be a number of milliseconds >= 0`);
  return { signOnGraceMs: merged.signOnGraceMs };
}

module.exports = { loadSessionConfig };
