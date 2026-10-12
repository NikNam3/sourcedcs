'use strict';

// Lossless WebP (VP8L) decoder, pure JavaScript, no dependency.
//
// MapTiler's terrain-rgb-v2 serves WebP only (live-test finding T2), and its
// tiles are lossless: a lossy tile would scramble the RGB-encoded heights, so
// lossless is the only flavour a DEM can come in. This decodes exactly that
// and refuses lossy (VP8) and animated files with an error, the same rule as
// the PNG decoder in terrain.js: a silently mis-decoded DEM masks the wrong
// terrain, which is worse than no terrain.
//
// Written to the format specification, RFC 9649 ("WebP Image Format"), §3
// "Specification for WebP Lossless Bitstream". Pure JS rather than a libwebp
// build (wasm or `sharp`): the tile bytes come off the network and the disk,
// and libwebp's own VP8L Huffman decoder is where CVE-2023-4863 lived; a JS
// decoder cannot overrun memory, and the package stays dependency-free.
// tests/terrain-tiles.test.mjs checks the output byte for byte against
// libwebp 1.6.0 on a real tile.

const NUM_LITERAL_CODES = 256;
const NUM_LENGTH_CODES = 24;
const NUM_DISTANCE_CODES = 40;
const CODE_LENGTH_CODES = 19;
const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const MAX_CODE_LENGTH = 15;
const PRIMARY_BITS = 8;

// RFC 9649 §3.5.2.2: distance codes 1..120 address the 2-D neighbourhood.
// Packed as libwebp does: high nibble = dy, low nibble = 8 - dx.
const CODE_TO_PLANE = [
  0x18, 0x07, 0x17, 0x19, 0x28, 0x06, 0x27, 0x29, 0x16, 0x1a,
  0x26, 0x2a, 0x38, 0x05, 0x37, 0x39, 0x15, 0x1b, 0x36, 0x3a,
  0x25, 0x2b, 0x48, 0x04, 0x47, 0x49, 0x14, 0x1c, 0x35, 0x3b,
  0x46, 0x4a, 0x24, 0x2c, 0x58, 0x45, 0x4b, 0x34, 0x3c, 0x03,
  0x57, 0x59, 0x13, 0x1d, 0x56, 0x5a, 0x23, 0x2d, 0x44, 0x4c,
  0x55, 0x5b, 0x33, 0x3d, 0x68, 0x02, 0x67, 0x69, 0x12, 0x1e,
  0x66, 0x6a, 0x22, 0x2e, 0x54, 0x5c, 0x43, 0x4d, 0x65, 0x6b,
  0x32, 0x3e, 0x78, 0x01, 0x77, 0x79, 0x53, 0x5d, 0x11, 0x1f,
  0x64, 0x6c, 0x42, 0x4e, 0x76, 0x7a, 0x21, 0x2f, 0x75, 0x7b,
  0x31, 0x3f, 0x63, 0x6d, 0x52, 0x5e, 0x00, 0x74, 0x7c, 0x41,
  0x4f, 0x10, 0x20, 0x62, 0x6e, 0x30, 0x73, 0x7d, 0x51, 0x5f,
  0x40, 0x72, 0x7e, 0x61, 0x6f, 0x50, 0x71, 0x7f, 0x60, 0x70,
];

// ── bit reader (LSB first) ──────────────────────────────────────────────────

class BitReader {
  constructor(bytes) {
    // Four bytes of zero padding so a peek near the end never reads undefined.
    this.buf = new Uint8Array(bytes.length + 4);
    this.buf.set(bytes);
    this.len = bytes.length;
    this.pos = 0; // in bits
  }

  peek(n) { // n <= 24
    const i = this.pos >>> 3;
    const b = this.buf;
    const word = (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
    return (word >>> (this.pos & 7)) & ((1 << n) - 1);
  }

  skip(n) {
    this.pos += n;
    if (this.pos > this.len * 8) throw new Error('WebP: truncated bitstream');
  }

  read(n) {
    if (n === 0) return 0;
    const v = this.peek(n);
    this.skip(n);
    return v;
  }
}

// ── prefix (Huffman) codes ──────────────────────────────────────────────────

/**
 * A canonical prefix code from per-symbol code lengths. Codes up to
 * PRIMARY_BITS long decode in one table lookup; longer ones walk the canonical
 * counts bit by bit. A code with a single symbol takes zero bits (§3.7.2.1.1).
 */
class PrefixCode {
  constructor(lengths) {
    const count = new Uint16Array(MAX_CODE_LENGTH + 1);
    let used = 0, single = -1;
    for (let s = 0; s < lengths.length; s++) {
      const l = lengths[s];
      if (l > 0) { count[l] += 1; used += 1; single = s; }
    }
    if (used === 0) throw new Error('WebP: empty prefix code');
    if (used === 1) { this.single = single; return; }
    this.single = -1;

    // Kraft check: the code must be complete, as libwebp requires.
    let left = 1;
    for (let l = 1; l <= MAX_CODE_LENGTH; l++) {
      left = (left << 1) - count[l];
      if (left < 0) throw new Error('WebP: over-subscribed prefix code');
    }
    if (left !== 0) throw new Error('WebP: incomplete prefix code');

    const offs = new Uint16Array(MAX_CODE_LENGTH + 2);
    for (let l = 1; l <= MAX_CODE_LENGTH; l++) offs[l + 1] = offs[l] + count[l];
    const sorted = new Uint16Array(used);
    const next = offs.slice();
    for (let s = 0; s < lengths.length; s++) if (lengths[s]) sorted[next[lengths[s]]++] = s;
    this.count = count;
    this.sorted = sorted;

    // Primary table, indexed by the next PRIMARY_BITS stream bits (LSB first,
    // so the code's first bit is the index's lowest bit): symbol | len << 16,
    // or 0 when the code is longer than PRIMARY_BITS.
    const table = new Uint32Array(1 << PRIMARY_BITS);
    let code = 0, k = 0;
    for (let l = 1; l <= MAX_CODE_LENGTH; l++) {
      for (let j = 0; j < count[l]; j++, k++, code++) {
        if (l <= PRIMARY_BITS) {
          let rev = 0;
          for (let b = 0; b < l; b++) rev |= ((code >>> b) & 1) << (l - 1 - b);
          for (let r = rev; r < table.length; r += 1 << l) table[r] = sorted[k] | (l << 16);
        }
      }
      code <<= 1;
    }
    this.table = table;
  }

  read(br) {
    if (this.single >= 0) return this.single;
    const e = this.table[br.peek(PRIMARY_BITS)];
    if (e) { br.skip(e >>> 16); return e & 0xffff; }
    // Slow path (RFC 1951 style canonical walk) for codes longer than the table.
    const bits = br.peek(MAX_CODE_LENGTH);
    let code = 0, first = 0, index = 0;
    for (let l = 1; l <= MAX_CODE_LENGTH; l++) {
      code |= (bits >>> (l - 1)) & 1;
      const c = this.count[l];
      if (code - c < first) { br.skip(l); return this.sorted[index + code - first]; }
      index += c;
      first = (first + c) << 1;
      code <<= 1;
    }
    throw new Error('WebP: invalid prefix code');
  }
}

function readCodeLengths(br, clLengths, numSymbols) {
  const clCode = new PrefixCode(clLengths);
  const lengths = new Uint8Array(numSymbols);
  let maxSymbol = numSymbols;
  if (br.read(1)) {
    const nbits = 2 + 2 * br.read(3);
    maxSymbol = 2 + br.read(nbits);
    if (maxSymbol > numSymbols) throw new Error('WebP: bad max_symbol');
  }
  let prev = 8, s = 0;
  while (s < numSymbols) {
    if (maxSymbol-- === 0) break;
    const len = clCode.read(br);
    if (len < 16) {
      lengths[s++] = len;
      if (len !== 0) prev = len;
    } else {
      const slot = len - 16;
      const repeat = br.read([2, 3, 7][slot]) + [3, 3, 11][slot];
      if (s + repeat > numSymbols) throw new Error('WebP: code length repeat overflows');
      const v = len === 16 ? prev : 0;
      for (let i = 0; i < repeat; i++) lengths[s++] = v;
    }
  }
  return lengths;
}

function readPrefixCode(br, alphabetSize) {
  const lengths = new Uint8Array(alphabetSize);
  if (br.read(1)) { // simple code: one or two symbols
    const numSymbols = br.read(1) + 1;
    const s0 = br.read(br.read(1) === 0 ? 1 : 8);
    if (s0 >= alphabetSize) throw new Error('WebP: symbol out of range');
    lengths[s0] = 1;
    if (numSymbols === 2) {
      const s1 = br.read(8);
      if (s1 >= alphabetSize) throw new Error('WebP: symbol out of range');
      lengths[s1] = 1;
    }
    return new PrefixCode(lengths);
  }
  const clLengths = new Uint8Array(CODE_LENGTH_CODES);
  const numCodes = br.read(4) + 4;
  for (let i = 0; i < numCodes; i++) clLengths[CODE_LENGTH_ORDER[i]] = br.read(3);
  return new PrefixCode(readCodeLengths(br, clLengths, alphabetSize));
}

function readGroup(br, cacheSize) {
  return [
    readPrefixCode(br, NUM_LITERAL_CODES + NUM_LENGTH_CODES + cacheSize), // green + length + cache
    readPrefixCode(br, NUM_LITERAL_CODES), // red
    readPrefixCode(br, NUM_LITERAL_CODES), // blue
    readPrefixCode(br, NUM_LITERAL_CODES), // alpha
    readPrefixCode(br, NUM_DISTANCE_CODES),
  ];
}

// ── entropy-coded image ─────────────────────────────────────────────────────

const subSize = (size, bits) => (size + (1 << bits) - 1) >> bits;

function prefixValue(br, symbol) {
  if (symbol < 4) return symbol + 1;
  const extra = (symbol - 2) >> 1;
  const offset = (2 + (symbol & 1)) << extra;
  return offset + br.read(extra) + 1;
}

function planeDistance(xsize, code) {
  if (code > 120) return code - 120;
  const v = CODE_TO_PLANE[code - 1];
  const dist = (v >> 4) * xsize + (8 - (v & 0xf));
  return dist >= 1 ? dist : 1;
}

/** Decodes width*height ARGB pixels; `main` allows meta prefix codes (§3.6). */
function decodeImageData(br, width, height, main) {
  let cacheBits = 0;
  if (br.read(1)) {
    cacheBits = br.read(4);
    if (cacheBits < 1 || cacheBits > 11) throw new Error('WebP: bad colour cache size');
  }
  const cacheSize = cacheBits ? 1 << cacheBits : 0;
  const cache = cacheBits ? new Uint32Array(cacheSize) : null;
  const cacheShift = 32 - cacheBits;

  let metaBits = 0, metaImage = null, metaWidth = 0, numGroups = 1;
  if (main && br.read(1)) {
    metaBits = br.read(3) + 2;
    metaWidth = subSize(width, metaBits);
    metaImage = decodeImageData(br, metaWidth, subSize(height, metaBits), false);
    let max = 0;
    for (let i = 0; i < metaImage.length; i++) {
      metaImage[i] = (metaImage[i] >>> 8) & 0xffff;
      if (metaImage[i] > max) max = metaImage[i];
    }
    numGroups = max + 1;
  }
  const groups = [];
  for (let g = 0; g < numGroups; g++) groups.push(readGroup(br, cacheSize));

  const total = width * height;
  const out = new Uint32Array(total);
  const metaMask = metaBits ? (1 << metaBits) - 1 : -1;
  let group = groups[0];
  let pos = 0, x = 0, y = 0, lastCached = 0;

  while (pos < total) {
    if (metaImage && (x & metaMask) === 0) {
      group = groups[metaImage[(y >> metaBits) * metaWidth + (x >> metaBits)]];
    }
    const code = group[0].read(br);
    if (code < NUM_LITERAL_CODES) {
      const red = group[1].read(br);
      const blue = group[2].read(br);
      const alpha = group[3].read(br);
      out[pos++] = ((alpha << 24) | (red << 16) | (code << 8) | blue) >>> 0;
      if (++x >= width) { x = 0; y++; }
    } else if (code < NUM_LITERAL_CODES + NUM_LENGTH_CODES) {
      const length = prefixValue(br, code - NUM_LITERAL_CODES);
      const distCode = prefixValue(br, group[4].read(br));
      const dist = planeDistance(width, distCode);
      if (dist > pos || pos + length > total) throw new Error('WebP: backward reference out of range');
      for (let i = 0; i < length; i++, pos++) out[pos] = out[pos - dist];
      x += length;
      while (x >= width) { x -= width; y++; }
      // A copy can cross a meta-code block boundary; re-select the group.
      if (metaImage && pos < total) group = groups[metaImage[(y >> metaBits) * metaWidth + (x >> metaBits)]];
    } else {
      if (!cache) throw new Error('WebP: colour cache code without a cache');
      out[pos++] = cache[code - NUM_LITERAL_CODES - NUM_LENGTH_CODES];
      if (++x >= width) { x = 0; y++; }
    }
    if (cache) {
      while (lastCached < pos) {
        const c = out[lastCached++];
        cache[Math.imul(c, 0x1e35a7bd) >>> cacheShift] = c;
      }
    }
  }
  return out;
}

// ── transforms (§3.4), applied in reverse order of reading ─────────────────

const ch = (p, s) => (p >>> s) & 0xff;
const pack = (a, r, g, b) => ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;

function addPixels(a, b) {
  return pack((ch(a, 24) + ch(b, 24)) & 0xff, (ch(a, 16) + ch(b, 16)) & 0xff,
    (ch(a, 8) + ch(b, 8)) & 0xff, (ch(a, 0) + ch(b, 0)) & 0xff);
}

function average2(a, b) {
  return pack((ch(a, 24) + ch(b, 24)) >> 1, (ch(a, 16) + ch(b, 16)) >> 1,
    (ch(a, 8) + ch(b, 8)) >> 1, (ch(a, 0) + ch(b, 0)) >> 1);
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

function select(L, T, TL) {
  let pL = 0, pT = 0;
  for (let s = 0; s < 32; s += 8) {
    const p = ch(L, s) + ch(T, s) - ch(TL, s);
    pL += Math.abs(p - ch(L, s));
    pT += Math.abs(p - ch(T, s));
  }
  return pL < pT ? L : T;
}

function clampAddSubtractFull(a, b, c) {
  return pack(clamp255(ch(a, 24) + ch(b, 24) - ch(c, 24)), clamp255(ch(a, 16) + ch(b, 16) - ch(c, 16)),
    clamp255(ch(a, 8) + ch(b, 8) - ch(c, 8)), clamp255(ch(a, 0) + ch(b, 0) - ch(c, 0)));
}

function clampAddSubtractHalf(a, b) {
  const h = (s) => clamp255(ch(a, s) + Math.trunc((ch(a, s) - ch(b, s)) / 2));
  return pack(h(24), h(16), h(8), h(0));
}

function predict(mode, d, i, w) {
  const L = d[i - 1], T = d[i - w], TR = d[i - w + 1], TL = d[i - w - 1];
  switch (mode) {
    case 0: return 0xff000000;
    case 1: return L;
    case 2: return T;
    case 3: return TR;
    case 4: return TL;
    case 5: return average2(average2(L, TR), T);
    case 6: return average2(L, TL);
    case 7: return average2(L, T);
    case 8: return average2(TL, T);
    case 9: return average2(T, TR);
    case 10: return average2(average2(L, TL), average2(T, TR));
    case 11: return select(L, T, TL);
    case 12: return clampAddSubtractFull(L, T, TL);
    case 13: return clampAddSubtractHalf(average2(L, T), TL);
    default: return 0xff000000; // 14 and 15 behave as 0 (libwebp)
  }
}

function inversePredictor(d, w, h, bits, sub) {
  const sw = subSize(w, bits);
  d[0] = addPixels(d[0], 0xff000000);
  for (let x = 1; x < w; x++) d[x] = addPixels(d[x], d[x - 1]);
  for (let y = 1; y < h; y++) {
    const row = y * w;
    d[row] = addPixels(d[row], d[row - w]);
    const srow = (y >> bits) * sw;
    for (let x = 1; x < w; x++) {
      const mode = (sub[srow + (x >> bits)] >>> 8) & 0xf;
      d[row + x] = addPixels(d[row + x], predict(mode, d, row + x, w));
    }
  }
}

const int8 = (v) => (v << 24) >> 24;

function inverseColor(d, w, h, bits, sub) {
  const sw = subSize(w, bits);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const m = sub[(y >> bits) * sw + (x >> bits)];
      const g2r = int8(m & 0xff), g2b = int8((m >>> 8) & 0xff), r2b = int8((m >>> 16) & 0xff);
      const i = y * w + x;
      const p = d[i];
      const green = int8(ch(p, 8));
      const red = (ch(p, 16) + ((g2r * green) >> 5)) & 0xff;
      const blue = (ch(p, 0) + ((g2b * green) >> 5) + ((r2b * int8(red)) >> 5)) & 0xff;
      d[i] = ((p & 0xff00ff00) | (red << 16) | blue) >>> 0;
    }
  }
}

function inverseSubtractGreen(d) {
  for (let i = 0; i < d.length; i++) {
    const p = d[i];
    const g = ch(p, 8);
    d[i] = ((p & 0xff00ff00) | (((ch(p, 16) + g) & 0xff) << 16) | ((ch(p, 0) + g) & 0xff)) >>> 0;
  }
}

function inverseColorIndexing(packed, packedW, w, h, bits, table) {
  const out = new Uint32Array(w * h);
  const bpp = 8 >> bits, mask = (1 << bpp) - 1, perByte = (1 << bits) - 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const g = ch(packed[y * packedW + (x >> bits)], 8);
      const idx = (g >> (bpp * (x & perByte))) & mask;
      out[y * w + x] = idx < table.length ? table[idx] : 0;
    }
  }
  return out;
}

// ── container ───────────────────────────────────────────────────────────────

function findVp8l(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('not a WebP');
  }
  let off = 12;
  while (off + 8 <= buf.length) {
    const type = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + size);
    if (type === 'VP8L') return body;
    if (type === 'VP8 ') throw new Error('lossy WebP not supported (a DEM tile must be lossless)');
    if (type === 'ANIM' || type === 'ANMF') throw new Error('animated WebP not supported');
    off += 8 + size + (size & 1);
  }
  throw new Error('WebP has no VP8L chunk');
}

const isWebp = (buf) => buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';

/**
 * Decodes a lossless WebP to RGBA, the shape terrain.js's decodePng returns.
 * @returns {{width:number, height:number, channels:4, data:Buffer}}
 */
function decodeWebp(buf) {
  const br = new BitReader(findVp8l(buf));
  if (br.read(8) !== 0x2f) throw new Error('bad VP8L signature');
  const width = br.read(14) + 1;
  const height = br.read(14) + 1;
  br.read(1); // alpha_is_used: a hint only, the alpha channel is decoded regardless
  if (br.read(3) !== 0) throw new Error('unsupported VP8L version');

  const transforms = [];
  let xsize = width;
  const seen = new Set();
  while (br.read(1)) {
    const type = br.read(2);
    if (seen.has(type)) throw new Error('WebP: transform repeated');
    seen.add(type);
    if (type === 0 || type === 1) {
      const bits = br.read(3) + 2;
      const sub = decodeImageData(br, subSize(xsize, bits), subSize(height, bits), false);
      transforms.push({ type, bits, sub, w: xsize });
    } else if (type === 2) {
      transforms.push({ type, w: xsize });
    } else {
      const size = br.read(8) + 1;
      const table = decodeImageData(br, size, 1, false);
      for (let i = 1; i < size; i++) table[i] = addPixels(table[i], table[i - 1]);
      const bits = size <= 2 ? 3 : size <= 4 ? 2 : size <= 16 ? 1 : 0;
      transforms.push({ type, bits, table, w: xsize });
      xsize = subSize(xsize, bits);
    }
  }

  let d = decodeImageData(br, xsize, height, true);
  for (let t = transforms.length - 1; t >= 0; t--) {
    const tr = transforms[t];
    if (tr.type === 0) inversePredictor(d, tr.w, height, tr.bits, tr.sub);
    else if (tr.type === 1) inverseColor(d, tr.w, height, tr.bits, tr.sub);
    else if (tr.type === 2) inverseSubtractGreen(d);
    else d = inverseColorIndexing(d, subSize(tr.w, tr.bits), tr.w, height, tr.bits, tr.table);
  }

  const data = Buffer.alloc(width * height * 4);
  for (let i = 0, o = 0; i < d.length; i++, o += 4) {
    const p = d[i];
    data[o] = ch(p, 16); data[o + 1] = ch(p, 8); data[o + 2] = ch(p, 0); data[o + 3] = ch(p, 24);
  }
  return { width, height, channels: 4, data };
}

module.exports = { decodeWebp, isWebp };
