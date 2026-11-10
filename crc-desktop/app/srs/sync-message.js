'use strict';
// The SRS TCP sync messages (pure; ADR 0158 §6): newline-delimited JSON `{Client, MsgType, Version}`, the
// `Client`/`RadioInfo` shapes, the message types and the protocol version. A port of lxsrs_v2's models.py and
// protocol.py; the shapes are checked against lines that code wrote (tests/fixtures/srs/srs-fixtures.json).
// Key order follows models.py. Numbers serialise the JavaScript way (251000000, not 251000000.0), which is the same
// JSON value to the SRS server.

/** The SRS protocol version this client speaks. The one place it is written (ADR 0158 §1). */
const SRS_VERSION = '2.3.3.3';
const MAX_RADIOS = 11;

const MsgType = Object.freeze({
  UPDATE: 0, PING: 1, SYNC: 2, RADIO_UPDATE: 3, SERVER_SETTINGS: 4, CLIENT_DISCONNECT: 5, VERSION_MISMATCH: 6,
  EXTERNAL_AWACS_MODE_PASSWORD: 7, EXTERNAL_AWACS_MODE_DISCONNECT: 8, GATEWAY_CLIENT_FULL_UPDATE: 9,
  GATEWAY_CLIENT_METADATA_UPDATE: 10, GATEWAY_CLIENT_DISCONNECT: 11,
});

const Modulation = Object.freeze({ AM: 0, FM: 1, INTERCOM: 2, DISABLED: 3, HAVEQUICK: 4, SATCOM: 5, MIDS: 6, SINCGARS: 7 });

/** A DISABLED slot, and an enabled radio with no frequency, carry 1 Hz: it matches no station (models.py). */
const UNTUNED_HZ = 1.0;

/** models.py `_clean_radio_label`: lower case letters and digits only, at most 32. */
function cleanRadioLabel(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32);
}

const round5 = (v) => (v ? Math.round(v * 1e5) / 1e5 : 0);

/** The radio `Model` this client reports (S-RADIO-1 RQ3; lxsrs_v2 sent linux1..11). */
const RADIO_MODEL = 'crc';

/**
 * One radio slot. `name` and `model` are cleaned as models.py does. Pass `model` explicitly; it defaults to the name
 * only so an empty slot stays empty. @param {{hz?:number, modulation?:number, name?:string, model?:string}} [r]
 */
function radioDict(r = {}) {
  const name = cleanRadioLabel(r.name || '');
  const model = cleanRadioLabel(r.model ?? r.name ?? '');
  return {
    enc: false,
    encKey: 0,
    freq: r.hz ?? UNTUNED_HZ,
    modulation: r.modulation ?? Modulation.DISABLED,
    retransmit: false,
    secFreq: 1.0,
    Model: model,
    Name: name,
    IntercomUnitId: 0,
  };
}

/**
 * @param {object} o
 * @param {Array<{hz:number, modulation:number, name:string}>} o.radios at most MAX_RADIOS; the rest of the slots are DISABLED
 * @param {string} o.unit @param {number} o.unitId @param {number} o.selected the transmit slot
 */
function radioInfoDict({ radios, unit, unitId, selected }) {
  if (radios.length > MAX_RADIOS) throw new Error(`SRS carries at most ${MAX_RADIOS} radios`);
  const slots = [];
  for (let i = 0; i < MAX_RADIOS; i++) slots.push(radioDict(radios[i]));
  return {
    ambient: { vol: 0.0, abType: '' },
    iff: { control: 2, expansion: false, mic: -1, mode1: -1, mode2: -1, mode3: -1, mode4: false, status: 0 },
    radios: slots,
    unit,
    unitId,
    radioIndex: selected,
  };
}

/**
 * @param {object} o
 * @param {string} o.guid @param {string} o.name @param {number} [o.coalition]
 * @param {object|null} [o.radioInfo] from radioInfoDict
 * @param {{lat:number, lng:number, alt:number}} [o.position]
 */
function clientDict({ guid, name, coalition = 0, radioInfo = null, position = { lat: 0, lng: 0, alt: 0 } }) {
  return {
    ClientGuid: guid,
    Name: name || '---',
    Coalition: coalition,
    AllowRecord: false,
    Seat: 0,
    LatLngPosition: { lat: round5(position.lat), lng: round5(position.lng), alt: round5(position.alt) },
    Gateway: false,
    GatewayClient: false,
    DISEntityId: -1,
    RadioInfo: radioInfo,
  };
}

/** @returns {Buffer} one line, newline included */
function encodeSyncMessage(msgType, client, version = SRS_VERSION) {
  return Buffer.from(JSON.stringify({ Client: client, MsgType: msgType, Version: version }) + '\n', 'utf8');
}

/** @returns {object} @throws on invalid JSON */
function decodeSyncMessage(line) {
  return JSON.parse(typeof line === 'string' ? line : line.toString('utf8'));
}

module.exports = {
  SRS_VERSION, MAX_RADIOS, RADIO_MODEL, MsgType, Modulation, UNTUNED_HZ,
  cleanRadioLabel, radioDict, radioInfoDict, clientDict, encodeSyncMessage, decodeSyncMessage,
};
