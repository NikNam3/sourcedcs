'use strict';
// The 22-character SRS GUIDs (ADR 0158 §6). SRS identifies a client by 22 ASCII characters: lxsrs_v2's
// make_srs_guid() takes a UUID4's hex digits without dashes and keeps the first 22. Same here.

const crypto = require('crypto');

const GUID_LENGTH = 22;

/** @param {() => string} [randomUUID] injectable for tests */
function makeSrsGuid(randomUUID = crypto.randomUUID) {
  return randomUUID().replace(/-/g, '').slice(0, GUID_LENGTH);
}

function isSrsGuid(s) {
  return typeof s === 'string' && s.length === GUID_LENGTH && /^[\x20-\x7e]+$/.test(s);
}

module.exports = { GUID_LENGTH, makeSrsGuid, isSrsGuid };
