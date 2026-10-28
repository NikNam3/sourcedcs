'use strict';

// Thresholds for conformance monitoring and short-term conflict alerting
// (docs/adr/0058). Shipped defaults in config/alerting.json; a copy in
// state/alerting.json overrides them key by key, so they can be tuned on the
// server without a release.
//
// Read ONCE, at startup, and never written by code: a change takes effect on
// the next restart and never mid-session (docs/adr/0058 "Notes"). Do not add a
// setter, an API or a re-read without revisiting that note.

const { readShipped, readLayer } = require('./tuning-file');

const NAME = 'alerting.json';

/**
 * config/alerting.json is the only source of the numbers; a state/ copy (or the
 * `override` path a test passes) overrides it key by key. A missing shipped file
 * is a startup error naming it.
 */
function loadAlertingConfig(override) {
  const shipped = readShipped(NAME);
  const layer = readLayer(NAME, override, shipped) || {};
  return {
    conformance: { ...shipped.conformance, ...(layer.conformance || {}) },
    conflictAlert: { ...shipped.conflictAlert, ...(layer.conflictAlert || {}) },
    tofiRegime: { ...shipped.tofiRegime, ...(layer.tofiRegime || {}) }, // docs/adr/0102
    airspaceEntry: { ...shipped.airspaceEntry, ...(layer.airspaceEntry || {}) }, // docs/adr/0119
    handoff: { ...shipped.handoff, ...(layer.handoff || {}) }, // docs/adr/0122
  };
}

module.exports = { loadAlertingConfig };
