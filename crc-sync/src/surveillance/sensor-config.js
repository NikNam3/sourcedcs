'use strict';

// Validators for the sensor-specs.json sections the surveillance code reads
// (DATA-3, H88: config/sensor-specs.json is the only source of these numbers,
// no `|| 4000` in code). A missing or invalid key is a startup error naming
// the key. Called by loadSensorSpecs (so a bad file stops start-up) and by
// each constructor (so a test that hands in a config object is held to it).

const COALITION_CLASSES = ['own', 'neutral', 'hostile'];

function fail(file, key, why) {
  throw new Error(`[sensor-specs] ${file}: "${key}" ${why}`);
}

const posNum = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const strList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x);

/** `datalink`: { participants: string[], pliPeriodMs > 0, lockPollMs > 0 }. */
function validateDatalinkConfig(cfg, file = 'sensor-specs.json') {
  if (!cfg || typeof cfg !== 'object') fail(file, 'datalink', 'is missing');
  if (!strList(cfg.participants)) fail(file, 'datalink.participants', 'must be an array of DCS unit type names');
  if (!posNum(cfg.pliPeriodMs)) fail(file, 'datalink.pliPeriodMs', 'must be a number of ms > 0');
  if (!posNum(cfg.lockPollMs)) fail(file, 'datalink.lockPollMs', 'must be a number of ms > 0');
  return cfg;
}

/** `transponder`: { syntheticFor, mode4For: arrays of own|neutral|hostile }. */
function validateTransponderConfig(cfg, file = 'sensor-specs.json') {
  if (!cfg || typeof cfg !== 'object') fail(file, 'transponder', 'is missing');
  for (const k of ['syntheticFor', 'mode4For']) {
    if (!Array.isArray(cfg[k]) || !cfg[k].every((c) => COALITION_CLASSES.includes(c))) {
      fail(file, `transponder.${k}`, `must be an array of ${COALITION_CLASSES.join(' | ')}`);
    }
  }
  return cfg;
}

module.exports = { validateDatalinkConfig, validateTransponderConfig };
