'use strict';

// Thresholds for conformance monitoring and short-term conflict alerting
// (docs/adr/0058). Shipped defaults in config/alerting.json; a copy in
// state/alerting.json overrides them key by key, so they can be tuned on the
// server without a release.
//
// Read ONCE, at startup, and never written by code: a change takes effect on
// the next restart and never mid-session (docs/adr/0058 "Notes"). Do not add a
// setter, an API or a re-read without revisiting that note.

const fs = require('fs');
const { readPath } = require('./state-paths');

const DEFAULTS = {
  conformance: {
    minGroundSpeedKt: 50,
    headingToleranceDeg: 5,
    headingGraceSec: 30,
    headingPersistSec: 10,
    atAltitudeBandFt: 400,
    levelBustFt: 500,
    levelBustPersistSec: 3,
    wrongWayFpm: 500,
    wrongWayPersistSec: 5,
  },
  stca: {
    lateralNm: 3,
    verticalFt: 1000,
    lookAheadSec: 120,
    stepSec: 2,
    minGroundSpeedKt: 50,
    minTrackAgeSec: 10,
  },
};

function loadAlertingConfig(override) {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(readPath('alerting.json', override), 'utf8'));
  } catch (e) {
    console.warn('[alerting] no alerting.json, using built-in thresholds:', e.message);
  }
  return {
    conformance: { ...DEFAULTS.conformance, ...(file.conformance || {}) },
    stca: { ...DEFAULTS.stca, ...(file.stca || {}) },
  };
}

module.exports = { DEFAULTS, loadAlertingConfig };
