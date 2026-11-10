// The binary frames on the local /srs WebSocket, the renderer's copy (leaf; ADR 0158 §1). The format and its other
// copy are in app/srs/srs-frame.js; tests/srs-frame-parity.test.mjs keeps the two equal.
//
//   u16 LE headerLength | headerLength bytes of UTF-8 JSON | the Opus frame

const enc = new TextEncoder();
const dec = new TextDecoder();

/** @param {object} header @param {Uint8Array} opus @returns {ArrayBuffer} */
export function encodeFrame(header, opus) {
  const h = enc.encode(JSON.stringify(header || {}));
  const out = new Uint8Array(2 + h.length + opus.byteLength);
  new DataView(out.buffer).setUint16(0, h.length, true);
  out.set(h, 2);
  out.set(opus, 2 + h.length);
  return out.buffer;
}

/** @param {ArrayBuffer} buf @returns {{header:object, opus:Uint8Array}} @throws on a short frame or bad JSON */
export function decodeFrame(buf) {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 2) throw new Error('frame too short');
  const n = new DataView(bytes.buffer, bytes.byteOffset).getUint16(0, true);
  if (2 + n > bytes.length) throw new Error('frame header truncated');
  return { header: JSON.parse(dec.decode(bytes.subarray(2, 2 + n))), opus: bytes.subarray(2 + n) };
}
