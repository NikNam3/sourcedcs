'use strict';
// The binary frames on the local /srs WebSocket (ADR 0158 §1): a little JSON header, then the Opus bytes.
//
//   u16 LE headerLength | headerLength bytes of UTF-8 JSON | the Opus frame
//
// Server to renderer, the header is {radioIds, guid, originalGuid, packetNumber, retransmissionCount}; renderer to
// server it is {} (what to transmit on was said by the last `ptt` message). The renderer's copy is
// public/js/radio/srs-frame.js; tests/srs-frame-parity.test.mjs keeps the two equal.

function encodeFrame(header, opus) {
  const h = Buffer.from(JSON.stringify(header || {}), 'utf8');
  const out = Buffer.alloc(2 + h.length + opus.byteLength);
  out.writeUInt16LE(h.length, 0);
  h.copy(out, 2);
  Buffer.from(opus.buffer, opus.byteOffset, opus.byteLength).copy(out, 2 + h.length);
  return out;
}

/** @returns {{header:object, opus:Buffer}} @throws on a frame shorter than its header length, or bad JSON */
function decodeFrame(buf) {
  if (buf.length < 2) throw new Error('frame too short');
  const n = buf.readUInt16LE(0);
  if (2 + n > buf.length) throw new Error('frame header truncated');
  return { header: JSON.parse(buf.toString('utf8', 2, 2 + n)), opus: buf.subarray(2 + n) };
}

module.exports = { encodeFrame, decodeFrame };
