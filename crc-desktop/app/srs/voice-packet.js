'use strict';
// The SRS UDP voice packet, encode and decode (pure; ADR 0158 §1, §6). Byte for byte what lxsrs_v2's protocol.py
// writes, checked against bytes it produced (tests/fixtures/srs/srs-fixtures.json). Little-endian throughout:
//
//   header       u16 packetLength, u16 audioLength, u16 frequencyPartLength         ("<HHH")
//   audio        the Opus frame, audioLength bytes
//   frequencies  per frequency: f64 Hz, u8 modulation, u8 encryption               ("<dBB", 10 bytes each)
//   fixed        u32 unitId, u64 packetNumber, u8 retransmissionCount              ("<IQB")
//   guids        22 bytes transmissionGuid, then 22 bytes clientGuid
//
// The SRS source (Common/Models/UDPVoicePacket.cs) calls the first GUID `OriginalClientGuid` and the last `Guid`: the
// last is the client that sent this datagram (the server reads the sender from the last 22 bytes), the first is the
// client that originated the audio. A client that is not relaying puts its own GUID in both, as lxsrs_v2 does. It is
// not a per-transmission id (docs/wip/RADIO-CORE.md).

const { GUID_LENGTH } = require('./srs-guid');

const HEADER_LENGTH = 6;
const FREQUENCY_LENGTH = 10;
const FIXED_LENGTH = 13;

/**
 * @param {object} p
 * @param {Uint8Array} p.audio
 * @param {number[]} p.frequencies Hz
 * @param {number[]} p.modulations
 * @param {number[]} p.encryptions
 * @param {number} p.unitId
 * @param {number|bigint} p.packetNumber
 * @param {number} p.retransmissionCount
 * @param {string} p.transmissionGuid 22 ASCII characters
 * @param {string} p.clientGuid 22 ASCII characters
 * @returns {Buffer}
 */
function encodeVoicePacket(p) {
  const n = p.frequencies.length;
  if (p.modulations.length !== n || p.encryptions.length !== n) throw new Error('frequencies, modulations and encryptions differ in length');
  if (p.transmissionGuid.length !== GUID_LENGTH || p.clientGuid.length !== GUID_LENGTH) throw new Error('an SRS GUID is 22 characters');
  const audio = Buffer.from(p.audio.buffer, p.audio.byteOffset, p.audio.byteLength);
  const freqLength = n * FREQUENCY_LENGTH;
  const total = HEADER_LENGTH + audio.length + freqLength + FIXED_LENGTH + 2 * GUID_LENGTH;
  const b = Buffer.alloc(total);
  let o = 0;
  o = b.writeUInt16LE(total, o);
  o = b.writeUInt16LE(audio.length, o);
  o = b.writeUInt16LE(freqLength, o);
  o += audio.copy(b, o);
  for (let i = 0; i < n; i++) {
    o = b.writeDoubleLE(p.frequencies[i], o);
    o = b.writeUInt8(p.modulations[i], o);
    o = b.writeUInt8(p.encryptions[i], o);
  }
  o = b.writeUInt32LE(p.unitId, o);
  o = b.writeBigUInt64LE(BigInt(p.packetNumber), o);
  o = b.writeUInt8(p.retransmissionCount, o);
  o += b.write(p.transmissionGuid, o, GUID_LENGTH, 'latin1');
  b.write(p.clientGuid, o, GUID_LENGTH, 'latin1');
  return b;
}

/**
 * @param {Buffer} data
 * @returns {{audio:Buffer, frequencies:number[], modulations:number[], encryptions:number[], unitId:number,
 *   packetNumber:number, retransmissionCount:number, transmissionGuid:string, clientGuid:string}}
 * @throws on a packet shorter than its header says or than its parts need
 */
function decodeVoicePacket(data) {
  if (data.length < HEADER_LENGTH) throw new Error(`packet too short: ${data.length} bytes`);
  const packetLength = data.readUInt16LE(0);
  const audioLength = data.readUInt16LE(2);
  const freqLength = data.readUInt16LE(4);
  if (packetLength !== data.length) throw new Error(`packet length mismatch: header=${packetLength} actual=${data.length}`);
  const n = Math.floor(freqLength / FREQUENCY_LENGTH);
  if (HEADER_LENGTH + audioLength + freqLength + FIXED_LENGTH + 2 * GUID_LENGTH > data.length) throw new Error('packet truncated');
  let o = HEADER_LENGTH;
  const audio = data.subarray(o, o + audioLength);
  o += audioLength;
  const frequencies = [], modulations = [], encryptions = [];
  for (let i = 0; i < n; i++) {
    frequencies.push(data.readDoubleLE(o));
    modulations.push(data.readUInt8(o + 8));
    encryptions.push(data.readUInt8(o + 9));
    o += FREQUENCY_LENGTH;
  }
  const unitId = data.readUInt32LE(o);
  const packetNumber = Number(data.readBigUInt64LE(o + 4));
  const retransmissionCount = data.readUInt8(o + 12);
  o += FIXED_LENGTH;
  const transmissionGuid = data.toString('latin1', o, o + GUID_LENGTH);
  const clientGuid = data.toString('latin1', o + GUID_LENGTH, o + 2 * GUID_LENGTH);
  return { audio, frequencies, modulations, encryptions, unitId, packetNumber, retransmissionCount, transmissionGuid, clientGuid };
}

module.exports = { encodeVoicePacket, decodeVoicePacket, HEADER_LENGTH, FREQUENCY_LENGTH, FIXED_LENGTH };
