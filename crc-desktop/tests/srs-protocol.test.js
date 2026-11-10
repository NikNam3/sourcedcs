// The Node SRS port against bytes lxsrs_v2's protocol.py/models.py produced (ADR 0158 "Testing";
// tests/fixtures/srs/make-fixtures.py wrote the fixture once, by hand).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures/srs/srs-fixtures.json');
const { encodeVoicePacket, decodeVoicePacket } = require('../app/srs/voice-packet');
const { makeSrsGuid, isSrsGuid, GUID_LENGTH } = require('../app/srs/srs-guid');
const sm = require('../app/srs/sync-message');

const fieldsOf = (f) => ({ ...f, audio: Buffer.from(f.audioHex, 'hex') });

for (const p of fixtures.packets) {
  test(`voice packet "${p.name}" encodes to protocol.py's bytes`, () => {
    assert.equal(encodeVoicePacket(fieldsOf(p.fields)).toString('hex'), p.hex);
  });
  test(`voice packet "${p.name}" decodes to protocol.py's fields`, () => {
    const d = decodeVoicePacket(Buffer.from(p.hex, 'hex'));
    const { audioHex, ...rest } = p.fields;
    assert.equal(d.audio.toString('hex'), audioHex);
    for (const [k, v] of Object.entries(rest)) assert.deepEqual(d[k], v, k);
  });
}

test('a voice packet whose header length is wrong, or that is cut short, is refused', () => {
  const b = Buffer.from(fixtures.packets[0].hex, 'hex');
  assert.throws(() => decodeVoicePacket(b.subarray(0, 4)), /too short/);
  assert.throws(() => decodeVoicePacket(b.subarray(0, b.length - 1)), /mismatch/);
  const lying = Buffer.from(b); lying.writeUInt16LE(500, 2); // audio length past the end
  assert.throws(() => decodeVoicePacket(lying), /truncated/);
});

test('encode refuses mismatched frequency lists and wrong-length GUIDs', () => {
  const f = fieldsOf(fixtures.packets[0].fields);
  assert.throws(() => encodeVoicePacket({ ...f, modulations: [] }), /differ/);
  assert.throws(() => encodeVoicePacket({ ...f, clientGuid: 'short' }), /22/);
});

test('an SRS GUID is a UUID4 without dashes, first 22 characters', () => {
  const g = makeSrsGuid(() => '12345678-9abc-4def-8123-456789abcdef');
  assert.equal(g, '123456789abc4def812345');
  assert.equal(g.length, GUID_LENGTH);
  assert.ok(isSrsGuid(makeSrsGuid()));
  assert.ok(!isSrsGuid('x'));
});

const byName = Object.fromEntries(fixtures.messages.map(m => [m.name, m]));
const parsed = (name) => JSON.parse(byName[name].line);
const A = fixtures.guidA;

test('SYNC without radios matches models.py', () => {
  const line = sm.encodeSyncMessage(sm.MsgType.SYNC, sm.clientDict({ guid: A, name: 'CRC', coalition: 2 }));
  assert.ok(line.toString().endsWith('\n'));
  assert.deepEqual(sm.decodeSyncMessage(line), parsed('sync-no-radios'));
});

test('RADIO_UPDATE with three radios matches models.py, key order included', () => {
  const radioInfo = sm.radioInfoDict({
    radios: [{ hz: 251e6, modulation: sm.Modulation.AM, name: 'linux1' }, { hz: 122.1e6, modulation: sm.Modulation.AM, name: 'linux2' },
      { hz: 243e6, modulation: sm.Modulation.AM, name: 'Guard UHF!' }],
    unit: 'CRC', unitId: 1, selected: 1,
  });
  const ours = sm.decodeSyncMessage(sm.encodeSyncMessage(sm.MsgType.RADIO_UPDATE, sm.clientDict({ guid: A, name: '', radioInfo })));
  const theirs = parsed('radio-update');
  assert.deepEqual(ours, theirs);
  const keys = (o) => (o && typeof o === 'object' ? Object.keys(o).map(k => [k, keys(o[k])]) : null);
  assert.deepEqual(keys(ours), keys(theirs));
  assert.equal(ours.Client.RadioInfo.radios.length, sm.MAX_RADIOS);
});

test('PING and the version constant match', () => {
  const m = sm.decodeSyncMessage(sm.encodeSyncMessage(sm.MsgType.PING, sm.clientDict({ guid: A, name: 'CRC' })));
  assert.deepEqual(m, parsed('ping'));
  assert.equal(m.Version, sm.SRS_VERSION);
});

test('more than eleven radios is refused (SRS has eleven slots)', () => {
  assert.throws(() => sm.radioInfoDict({ radios: new Array(12).fill({ hz: 1, modulation: 0, name: '' }), unit: '', unitId: 1, selected: 0 }), /11/);
});
