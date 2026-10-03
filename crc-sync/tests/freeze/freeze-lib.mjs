// Shared helpers for the freeze suite (docs/wip/FREEZE.md). Test-side only.
//
// A "golden" file is JSON with one line per step/cell so a git diff points at the step that
// moved. Heavy records (a whole Strip, a whole flight data) are not stored verbatim: they are replaced
// by a one-line summary carrying a content hash of the record's PROJECTION (see PROJECTION below), and the
// readable summary says which Strip. To see the full before/after of a changed record, dump both runs
// (FREEZE_DUMP=dir, see docs/wip/FREEZE.md) and diff the dumps (the dumps hold every field, ext included).
//
// Grain (docs/wip/FREEZE-GRAIN.md): a golden changes only when behaviour that file records changes.
//   * ids: the recordings carry the deterministic uuids as they are; a golden is renumbered "#1, #2, ..." by FIRST
//     APPEARANCE IN THAT FILE when it is written or compared (renumberIds), so an extra randomUUID() elsewhere
//     renumbers nothing; a hash renumbers inside its own record only.
//   * records: a hash covers PROJECTION (identity, placement and the behavioural groups, with empty values
//     pruned), not the whole record. Every other field is "ext": still in the FREEZE_DUMP dumps, in no hash.
//     A lane that wants a field frozen PROMOTES it on purpose: add it to PROJECTION.<kind>.core (scalars and
//     values that are always meaningful) or .sparse (objects, hashed with null/false/""/[]/{} dropped), then
//     `npm run freeze:update` in its own commit.
//   * VOLATILE_KEYS: cross-cutting counters (epochs, boardSeq, undoable) the normaliser drops everywhere; a new
//     epoch key is covered by VOLATILE_RE, any other cross-cutting key is one line in VOLATILE_KEYS.
//   * big tables are split per op into a directory of goldens (checkGoldenSet).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GOLDEN_DIR = path.join(HERE, 'golden');
export const UPDATE = process.env.UPDATE_GOLDEN === '1';

// Every uuid in a recording is deterministic (the freeze counter's 00000000-0000-4000-8000-<n>, or the hub host's seeded ones).
const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const TMP_RE = /\/(?:tmp|var\/folders)[^"\s']*?(efsp|freeze)[-\w]*/g;

/** Cross-cutting volatile keys: dropped from every normalised value (canonical), so adding one is one line here. */
export const VOLATILE_KEYS = new Set(['boardSeq', 'boardSeqByFacility', 'storeSeqs', 'undoable']);
/** Every `...Epoch`, `...Epochs`, `...EpochByFacility` key is volatile too (boardEpoch, marsaEpoch, storeEpochs, a future one). */
export const VOLATILE_RE = /Epoch(s|ByFacility)?$/;
export const isVolatileKey = (k) => VOLATILE_KEYS.has(k) || VOLATILE_RE.test(k);

/**
 * The uuids in `text`, renumbered "#1, #2, ..." by first appearance in
 * `text`. Applied to a whole golden when it is written or compared, and to each record before it is hashed.
 */
export function renumberIds(text) {
  const seen = new Map();
  return text.replace(UUID_G, (m) => { if (!seen.has(m)) seen.set(m, seen.size + 1); return `#${seen.get(m)}`; });
}

const HAS_UUID = new RegExp(UUID_G.source);
/** Sorted keys, except that keys holding a uuid keep their insertion order after the others (a raw uuid's value is not stable, its place is). */
const sortKeys = (keys) => keys.sort((a, b) => {
  const ua = HAS_UUID.test(a), ub = HAS_UUID.test(b);
  if (ua || ub) return ua && ub ? 0 : ua ? 1 : -1;
  return a < b ? -1 : a > b ? 1 : 0;
});

/** Recursively sorted keys; volatile keys dropped (unless keepVolatile); temp paths scrubbed to "<tmp>". Ids stay as recorded. */
export function canonical(v, keepVolatile = false) {
  if (typeof v === 'string') return v.replace(TMP_RE, '<tmp>');
  if (Array.isArray(v)) return v.map(e => canonical(e, keepVolatile));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of sortKeys(Object.keys(v))) {
      if (!keepVolatile && isVolatileKey(k)) continue;
      o[canonical(k)] = canonical(v[k], keepVolatile);
    }
    return o;
  }
  return v;
}

/** sha1 prefix of the JSON of `v` (a string is hashed as it is), its ids renumbered inside it. */
export function digest(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return crypto.createHash('sha1').update(renumberIds(s)).digest('hex').slice(0, 10);
}

// ---- projection: what a hash covers ----------------------------------------------------------------------

export const PROJECTION = {
  strip: {
    core: ['stripId', 'stripType', 'state', 'ownerPositionId', 'bayId', 'rackId', 'orderKey', 'rev', 'flightDataId'],
    sparse: ['flags', 'coordination', 'airspaceEntry', 'tofiCoordination', 'annotations', 'previousLeg'],
  },
  flightData: {
    core: ['flightDataId', 'rev'],
    sparse: ['identity', 'filed', 'assigned', 'clearance', 'airspace', 'comms'],
  },
};

const isEmpty = (v) => v === null || v === undefined || v === false || v === '' || (Array.isArray(v) && !v.length) || (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
/** Objects lose their empty members (null, false, "", [], {}), recursively; array elements stay in place. */
export function pruneEmpty(v) {
  if (Array.isArray(v)) return v.map(pruneEmpty);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) { const c = pruneEmpty(v[k]); if (!isEmpty(c)) o[k] = c; }
    return o;
  }
  return v;
}

function projectRecord(rec, spec) {
  const o = {};
  for (const k of spec.core) o[k] = rec[k] === undefined ? null : rec[k];
  for (const k of spec.sparse) { const c = pruneEmpty(rec[k]); if (!isEmpty(c)) o[k] = c; }
  return o;
}

/** The fields of `rec` no hash covers (ext): what a lane promotes on purpose. */
export function extKeys(rec, kind) {
  const spec = PROJECTION[kind];
  return Object.keys(rec).filter(k => !spec.core.includes(k) && !spec.sparse.includes(k) && !isVolatileKey(k)).sort();
}

/** What a digest of `v` is taken over: every Strip and flight data inside it projected, everything else with empties pruned. */
export function project(v) {
  if (isStrip(v)) return projectRecord(v, PROJECTION.strip);
  if (isFlightData(v)) return projectRecord(v, PROJECTION.flightData);
  if (Array.isArray(v)) return v.map(project);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) { const c = project(v[k]); if (!isEmpty(c)) o[k] = c; }
    return o;
  }
  return v;
}
/** digest(project(v)): the hash a golden line carries. */
export const hashOf = (v) => digest(project(v));

export const isStrip = (v) => v && typeof v === 'object' && typeof v.stripId === 'string' && 'rev' in v && 'state' in v && 'stripType' in v;
export const isFlightData = (v) => v && typeof v === 'object' && typeof v.flightDataId === 'string' && v.identity && v.filed;

/** Strip -> "S#13 r4 DEPARTURE/HANDED_OFF @APP ap-departures/main:V h=ab12cd34ef". */
export function summarize(v, depth = 0) {
  const r = summarizeInner(v, depth);
  // A big nested record (a runway/runway-status view, a whole Position list) would dominate the file;
  // keep its shape and a hash of the full content instead.
  if (depth === 3 && r && typeof r === 'object') {
    const len = JSON.stringify(r).length;
    if (len > BIG) return { '~big': digest(r), chars: len, keys: Array.isArray(r) ? `array[${r.length}]` : Object.keys(r).slice(0, 8) };
  }
  return r;
}
const BIG = 700;

function summarizeInner(v, depth) {
  if (isStrip(v)) {
    const c = canonical(v);
    return `S ${c.stripId} r${c.rev} ${c.stripType}/${c.state} @${c.ownerPositionId} ${c.bayId}/${c.rackId}:${c.orderKey} h=${hashOf(c)}`;
  }
  if (isFlightData(v)) {
    const c = canonical(v);
    return `F ${c.flightDataId} r${c.rev} ${c.identity.callsign} sq=${c.identity.beaconAssigned} h=${hashOf(c)}`;
  }
  if (Array.isArray(v)) return v.map(e => summarize(e, depth + 1));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of sortKeys(Object.keys(v))) { if (!isVolatileKey(k)) o[canonical(k)] = summarize(v[k], depth + 1); }
    return o;
  }
  return canonical(v);
}

const ROWS_MAX = 12; // beyond this a collection is its count + hash (a changed row still changes the hash)

/** A snapshot-shaped value (many records): count + digest of the whole + per-record summaries. */
export function summarizeCollection(v) {
  if (Array.isArray(v)) return { n: v.length, h: hashOf(canonical(v)), ...(v.length <= ROWS_MAX ? { rows: v.map(summarizeRow) } : {}) };
  return { h: hashOf(canonical(v)), v: summarize(v) };
}
function summarizeRow(r) {
  if (isStrip(r) || isFlightData(r)) return summarize(r);
  const c = canonical(r);
  const id = c && (c.airspaceId || c.marsaId || c.flightDataId || c.hullId || c.id || c.runwayId || c.facilityId);
  return `${id !== undefined ? id : '?'} h=${hashOf(c)}`;
}

/** The compact final-state record for one createEfsp() instance. */
export function summarizeFinalState(fs_) {
  const out = { boards: {} };
  for (const [f, b] of Object.entries(fs_.boards || {})) {
    const { strips, ...rest } = b;
    out.boards[f] = { ...summarizeCollection(strips || []), rest: summarize(rest) };
  }
  for (const k of ['flightData', 'airspaces', 'correlations', 'marsa', 'runwayStatuses', 'carriers']) {
    if (k === 'flightData' && fs_.flightData && !Array.isArray(fs_.flightData)) {
      const { flightDataList, ...rest } = fs_.flightData;
      out.flightData = { ...(Array.isArray(flightDataList) ? summarizeCollection(flightDataList) : { h: hashOf(canonical(flightDataList)) }), rest: summarize(rest) };
    } else out[k] = fs_[k] === undefined ? null : summarizeCollection(fs_[k]);
  }
  if (fs_.error) out.error = fs_.error;
  return out;
}

// ---- golden I/O -----------------------------------------------------------

/**
 * Diff-friendly serialisation: objects are expanded one key per line, and every array is printed
 * one element per line (each element compact JSON), except arrays under an `instances` key whose
 * elements are expanded further. A changed step is therefore exactly one changed line.
 */
export function serializeGolden(obj) {
  const walk = (v, indent, key) => {
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      const expand = key === 'instances';
      return '[\n' + v.map(e => indent + '  ' + (expand ? walk(e, indent + '  ') : JSON.stringify(e))).join(',\n') + '\n' + indent + ']';
    }
    if (v && typeof v === 'object') {
      const ks = Object.keys(v);
      if (!ks.length) return '{}';
      return '{\n' + ks.map(k => `${indent}  ${JSON.stringify(k)}: ${walk(v[k], indent + '  ', k)}`).join(',\n') + '\n' + indent + '}';
    }
    return JSON.stringify(v);
  };
  return walk(obj, '') + '\n';
}

export function goldenPath(name) { return path.join(GOLDEN_DIR, name + '.json'); }

/** Paths where `a` and `b` differ, at most `limit`, as "path: golden X | actual Y". */
export function diffPaths(a, b, p = '', out = [], limit = 12) {
  if (out.length >= limit) return out;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  const ao = a && typeof a === 'object', bo = b && typeof b === 'object';
  if (!ao || !bo || Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${p || '(root)'}: golden ${short(a)} | actual ${short(b)}`);
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (out.length >= limit) break;
    diffPaths(a[k], b[k], `${p}${Array.isArray(a) ? `[${k}]` : '.' + k}`, out, limit);
  }
  return out;
}
const short = (v) => { const s = v === undefined ? 'undefined' : JSON.stringify(v); return s.length > 160 ? s.slice(0, 157) + '...' : s; };

/**
 * Compare `actual` with the golden `name`; with UPDATE_GOLDEN=1 write it instead.
 * `unitsOf(doc)` yields [label, value] units (steps / cells) so the message names the first
 * units that moved instead of dumping a whole file.
 */
export function checkGolden(assert, name, actual, unitsOf) {
  const file = goldenPath(name);
  const text = renumberIds(serializeGolden(actual));
  if (UPDATE) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return;
  }
  if (!fs.existsSync(file)) assert.fail(`golden ${name}.json is missing; run UPDATE_GOLDEN=1 (see docs/wip/FREEZE.md)`);
  const golden = fs.readFileSync(file, 'utf8');
  if (golden === text) return;
  const g = JSON.parse(golden), a = JSON.parse(text);
  const gu = unitsOf(g), au = unitsOf(a);
  const msgs = [];
  const n = Math.max(gu.length, au.length);
  let moved = 0;
  for (let i = 0; i < n; i++) {
    const [gl, gv] = gu[i] || ['(missing)', undefined];
    const [al, av] = au[i] || ['(missing)', undefined];
    if (JSON.stringify(gv) === JSON.stringify(av) && gl === al) continue;
    moved++;
    if (msgs.length < 6) {
      msgs.push(`  unit ${i} [${al !== '(missing)' ? al : gl}]\n    ` + diffPaths(gv, av).join('\n    '));
    }
  }
  assert.fail(`FREEZE: ${name} no longer matches its golden (${moved} of ${n} units differ; golden diffs must be empty unless a supervisor approved the change, docs/wip/FREEZE.md).\n` + msgs.join('\n'));
}

/**
 * A table split per op: `docs` is { <op name>: doc }, each golden/<dir>/<op>.json, so a change to one op touches one file.
 * The set of files is itself checked (a missing or stale file fails); every file is compared and all mismatches are
 * reported together. With UPDATE_GOLDEN=1 the directory is rewritten whole.
 */
export function checkGoldenSet(assert, dir, docs, unitsOf) {
  const safe = (n) => n.replace(/[^\w.-]/g, '_');
  const names = Object.keys(docs).map(safe).sort();
  if (new Set(names).size !== names.length) assert.fail(`${dir}: two op names map to one file name`);
  const folder = path.join(GOLDEN_DIR, dir);
  if (UPDATE) fs.rmSync(folder, { recursive: true, force: true });
  else {
    const have = fs.existsSync(folder) ? fs.readdirSync(folder).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort() : [];
    const missing = names.filter(n => !have.includes(n)), stale = have.filter(n => !names.includes(n));
    if (missing.length || stale.length) assert.fail(`FREEZE: ${dir}/ file set changed: missing goldens [${missing}], stale goldens [${stale}] (docs/wip/FREEZE-GRAIN.md)`);
  }
  const failures = [];
  for (const [op, doc] of Object.entries(docs)) {
    try { checkGolden(assert, `${dir}/${safe(op)}`, doc, unitsOf); } catch (e) { failures.push(e.message); }
  }
  if (failures.length) assert.fail(`FREEZE: ${failures.length} of ${names.length} goldens in ${dir}/ differ.\n` + failures.slice(0, 3).join('\n') + (failures.length > 3 ? `\n... ${failures.length - 3} more` : ''));
}
