'use strict';

// The terrain height cache (docs/adr/0133): one file per theater and spacing, built once by
// `npm run terrain:build` (tools/terrain/) from DCS's own terrain heights (its Lua height call), read by the running server.
//
// The grid is regular in latitude and longitude, not in DCS x/z: every sample is DCS's height at that exact lat/lon
// (the build's Lua turns each one into map coordinates with coord.LLtoLO), so a lookup needs no Transverse Mercator
// constants in Node, which three theaters have no citable source for (tools/miztoyaml/projection.py). The steps are the
// spacing in metres at the extent's middle latitude, so a cell is `spacingM` square there and within a few percent of
// it across a theater.
//
// File layout, little-endian:
//   8 bytes   magic "CRCTERR1"
//   uint32    header length in bytes (even, padded with spaces)
//   header    UTF-8 JSON, exactly the keys of HEADER_KEYS
//   int16[]   rows*cols heights in whole metres, row-major, row 0 the southern edge, column 0 the western edge
//
// Strict on read: a wrong magic, an unknown or missing header key, a size that does not match, or a sample the build
// never wrote stops this file being used (the caller logs one line and every radar sees to full range). Terrain is
// optional, so it is never a crash.

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const { dirs } = require('./state-paths');

const MAGIC = Buffer.from('CRCTERR1', 'ascii');
const FORMAT = 'int16-m';
/** A sample the build has not written yet (the partial file is pre-filled with it). Never in a finished file. */
const UNSAMPLED = -32768;
const METRES_PER_DEG_LAT = 111320;
const HEADER_KEYS = ['format', 'theater', 'spacingM', 'latMin', 'lonMin', 'latStep', 'lonStep', 'rows', 'cols', 'builtAt', 'dcsVersion'];
const EDGE = 1e-6;
const FILE_RE = /^(.+)-(\d+)m\.terrain(\.gz)?$/;

/** The directory the cache lives in: CRCSYNC_TERRAIN_CACHE_DIR, else state/terrain-cache (the state volume in the stack). */
function terrainCacheDir(env = process.env) {
  return env.CRCSYNC_TERRAIN_CACHE_DIR || path.join(dirs(env).stateDir, 'terrain-cache');
}

/**
 * The caches shipped in the image, read when the state directory has none for the theater (the ADR 0048 read rule):
 * `data/terrain/` (read-only reference data, beside icao.json), gzipped in git. CRCSYNC_TERRAIN_SHIPPED_DIR overrides it;
 * empty means none (the e2e harness and the soak host, which bring their own).
 * @returns {string|null}
 */
function shippedTerrainDir(env = process.env) {
  if (env.CRCSYNC_TERRAIN_SHIPPED_DIR !== undefined) return env.CRCSYNC_TERRAIN_SHIPPED_DIR || null;
  return path.join(__dirname, '..', 'data', 'terrain');
}

/** A cache file's bytes, gunzipped when it ends in `.gz`. */
function readCacheFile(file) {
  const buf = fs.readFileSync(file);
  return file.endsWith('.gz') ? zlib.gunzipSync(buf) : buf;
}

function cacheFileName(theater, spacingM) {
  return `${theater}-${spacingM}m.terrain`;
}

/**
 * The finest-spacing cache file for a theater in `dir` (`<Theater>-<n>m.terrain`, or `.terrain.gz`), or null.
 * At one spacing the plain file wins over its gzipped copy.
 * @returns {{file:string, spacingM:number}|null}
 */
function findCacheFile(dir, theater) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return null; }
  let best = null;
  for (const name of names) {
    const m = FILE_RE.exec(name);
    if (!m || m[1] !== theater) continue;
    const spacingM = Number(m[2]);
    const gz = !!m[3];
    if (!best || spacingM < best.spacingM || (spacingM === best.spacingM && best.gz && !gz)) best = { file: path.join(dir, name), spacingM, gz };
  }
  return best && { file: best.file, spacingM: best.spacingM };
}

/**
 * The grid for a lat/lon box at a spacing in metres.
 * @param {{latMin:number, latMax:number, lonMin:number, lonMax:number}} bbox
 */
function planGrid(bbox, spacingM) {
  if (!(Number.isFinite(spacingM) && spacingM > 0)) throw new Error('spacing must be a positive number of metres');
  const { latMin, latMax, lonMin, lonMax } = bbox;
  if (![latMin, latMax, lonMin, lonMax].every(Number.isFinite) || latMin >= latMax || lonMin >= lonMax) {
    throw new Error('the extent is not a lat/lon box');
  }
  const midLat = (latMin + latMax) / 2;
  const latStep = spacingM / METRES_PER_DEG_LAT;
  const lonStep = spacingM / (METRES_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180));
  const rows = Math.ceil((latMax - latMin) / latStep) + 1;
  const cols = Math.ceil((lonMax - lonMin) / lonStep) + 1;
  return { latMin, lonMin, latStep, lonStep, rows, cols };
}

function _headerBytes(header) {
  const keys = Object.keys(header).sort();
  if (keys.join() !== [...HEADER_KEYS].sort().join()) throw new Error(`header keys must be exactly ${HEADER_KEYS.join(', ')}`);
  let json = Buffer.from(JSON.stringify(header), 'utf8');
  if (json.length % 2) json = Buffer.concat([json, Buffer.from(' ')]);
  return json;
}

/** The whole file for a header and its heights. */
function encodeGrid(header, heights) {
  if (heights.length !== header.rows * header.cols) throw new Error('heights do not match rows*cols');
  const json = _headerBytes(header);
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  const data = Buffer.alloc(heights.length * 2);
  for (let i = 0; i < heights.length; i++) data.writeInt16LE(heights[i], i * 2);
  return Buffer.concat([MAGIC, len, json, data]);
}

/** Byte offset of the heights in a file with this header (the build writes chunks there). */
function dataOffset(header) {
  return MAGIC.length + 4 + _headerBytes(header).length;
}

function _checkHeader(h) {
  if (!h || typeof h !== 'object' || Array.isArray(h)) throw new Error('the header is not an object');
  const keys = Object.keys(h);
  const unknown = keys.filter((k) => !HEADER_KEYS.includes(k));
  const missing = HEADER_KEYS.filter((k) => !keys.includes(k));
  if (unknown.length) throw new Error(`unknown header key(s): ${unknown.join(', ')}`);
  if (missing.length) throw new Error(`missing header key(s): ${missing.join(', ')}`);
  if (h.format !== FORMAT) throw new Error(`format is ${JSON.stringify(h.format)}, not ${FORMAT}`);
  if (typeof h.theater !== 'string' || !h.theater) throw new Error('theater is not a name');
  for (const k of ['spacingM', 'latStep', 'lonStep']) if (!(Number.isFinite(h[k]) && h[k] > 0)) throw new Error(`${k} is not a positive number`);
  for (const k of ['latMin', 'lonMin']) if (!Number.isFinite(h[k])) throw new Error(`${k} is not a number`);
  for (const k of ['rows', 'cols']) if (!(Number.isInteger(h[k]) && h[k] >= 2)) throw new Error(`${k} is not an integer of at least 2`);
  if (typeof h.builtAt !== 'string' || typeof h.dcsVersion !== 'string') throw new Error('builtAt and dcsVersion must be strings');
}

/**
 * Reads a cache file's bytes. Throws with the reason on anything it does not expect.
 * @param {Buffer} buf
 * @param {{theater?:string}} [expect] the theater the caller asked for
 * @returns {TerrainGrid}
 */
function decodeGrid(buf, expect = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < MAGIC.length + 4 || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('not a terrain cache file (bad magic)');
  }
  const len = buf.readUInt32LE(MAGIC.length);
  const start = MAGIC.length + 4;
  if (start + len > buf.length) throw new Error('the header runs past the end of the file');
  let header;
  try { header = JSON.parse(buf.toString('utf8', start, start + len)); } catch (e) { throw new Error(`the header is not JSON (${e.message})`); }
  _checkHeader(header);
  if (expect.theater && header.theater !== expect.theater) throw new Error(`the file is for ${header.theater}, not ${expect.theater}`);
  const n = header.rows * header.cols;
  const off = start + len;
  if (buf.length !== off + n * 2) throw new Error(`size ${buf.length} bytes, expected ${off + n * 2} for ${header.rows}x${header.cols}`);
  const heights = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const v = buf.readInt16LE(off + i * 2);
    if (v === UNSAMPLED) throw new Error(`sample ${i} was never written (an unfinished build)`);
    heights[i] = v;
  }
  return new TerrainGrid(header, heights);
}

class TerrainGrid {
  constructor(header, heights) {
    this.header = header;
    this.heights = heights;
  }

  /** Height in metres at a position by bilinear interpolation, or null outside the grid. */
  heightAt(lat, lon) {
    const { latMin, lonMin, latStep, lonStep, rows, cols } = this.header;
    // EDGE absorbs floating-point error on a position exactly on the grid's edge.
    const fy = (lat - latMin) / latStep;
    const fx = (lon - lonMin) / lonStep;
    if (!(fy >= -EDGE && fx >= -EDGE && fy <= rows - 1 + EDGE && fx <= cols - 1 + EDGE)) return null;
    const y0 = Math.max(0, Math.min(Math.floor(fy), rows - 2));
    const x0 = Math.max(0, Math.min(Math.floor(fx), cols - 2));
    const ty = Math.min(1, Math.max(0, fy - y0)), tx = Math.min(1, Math.max(0, fx - x0));
    const h = this.heights;
    const i = y0 * cols + x0;
    const v00 = h[i], v10 = h[i + 1], v01 = h[i + cols], v11 = h[i + cols + 1];
    const south = v00 + (v10 - v00) * tx;
    const north = v01 + (v11 - v01) * tx;
    return south + (north - south) * ty;
  }
}

module.exports = {
  TerrainGrid, planGrid, encodeGrid, decodeGrid, dataOffset, terrainCacheDir, shippedTerrainDir, readCacheFile, cacheFileName, findCacheFile,
  MAGIC, FORMAT, UNSAMPLED, HEADER_KEYS, METRES_PER_DEG_LAT,
};
