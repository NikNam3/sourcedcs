// Shared helpers for the freeze suite (docs/wip/FREEZE.md). Test-side only.
//
// A "golden" file is JSON with one line per step/cell so a git diff points at the step that
// moved. Heavy records (a whole Strip, a whole FDR) are not stored verbatim: they are replaced
// by a one-line summary carrying a content hash of the FULL normalised record, so any field
// change anywhere inside still changes the golden, and the readable summary says which Strip.
// To see the full before/after of a changed record, dump both runs (FREEZE_DUMP=dir, see
// docs/wip/FREEZE.md) and diff the dumps.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GOLDEN_DIR = path.join(HERE, 'golden');
export const UPDATE = process.env.UPDATE_GOLDEN === '1';

const UUID_RE = /00000000-0000-4000-8000-([0-9a-f]{12})/g;
const TMP_RE = /\/(?:tmp|var\/folders)[^"\s']*?(efsp|freeze)[-\w]*/g;

/** Recursively sorted keys; strings scrubbed (deterministic uuids -> "#n", temp paths -> "<tmp>"). */
export function canonical(v) {
  if (typeof v === 'string') {
    return v.replace(UUID_RE, (_, h) => `#${parseInt(h, 16)}`).replace(TMP_RE, '<tmp>');
  }
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[canonical(k)] = canonical(v[k]);
    return o;
  }
  return v;
}

export function digest(v) {
  return crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 10);
}

const isStrip = (v) => v && typeof v === 'object' && typeof v.stripId === 'string' && 'rev' in v && 'state' in v && 'role' in v;
const isFdr = (v) => v && typeof v === 'object' && typeof v.fdrId === 'string' && v.identity && v.filed;

/** Strip -> "S#13 r4 DEPARTURE/HANDED_OFF @APP app-departures/main:V h=ab12cd34ef". */
export function summarize(v, depth = 0) {
  const r = summarizeInner(v, depth);
  // A big nested record (a runway/field-state view, a whole Position list) would dominate the file;
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
    return `S ${c.stripId} r${c.rev} ${c.role}/${c.state} @${c.ownerPositionId} ${c.bayId}/${c.rackId}:${c.orderKey} h=${digest(c)}`;
  }
  if (isFdr(v)) {
    const c = canonical(v);
    return `F ${c.fdrId} r${c.rev} ${c.identity.callsign} sq=${c.identity.beaconAssigned} h=${digest(c)}`;
  }
  if (Array.isArray(v)) return v.map(e => summarize(e, depth + 1));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[canonical(k)] = summarize(v[k], depth + 1);
    return o;
  }
  return canonical(v);
}

const ROWS_MAX = 12; // beyond this a collection is its count + hash (a changed row still changes the hash)

/** A snapshot-shaped value (many records): count + digest of the whole + per-record summaries. */
export function summarizeCollection(v) {
  if (Array.isArray(v)) return { n: v.length, h: digest(canonical(v)), ...(v.length <= ROWS_MAX ? { rows: v.map(summarizeRow) } : {}) };
  return { h: digest(canonical(v)), v: summarize(v) };
}
function summarizeRow(r) {
  if (isStrip(r) || isFdr(r)) return summarize(r);
  const c = canonical(r);
  const id = c && (c.airspaceId || c.marsaId || c.fdrId || c.hullId || c.id || c.runwayId || c.facilityId);
  return `${id !== undefined ? id : '?'} h=${digest(c)}`;
}

/** The compact final-state record for one createEfsp() instance. */
export function summarizeFinalState(fs_) {
  const out = { boards: {} };
  for (const [f, b] of Object.entries(fs_.boards || {})) {
    const { strips, ...rest } = b;
    out.boards[f] = { ...summarizeCollection(strips || []), rest: summarize(rest) };
  }
  for (const k of ['fdr', 'airspaces', 'correlations', 'marsa', 'fieldStates', 'carriers']) {
    if (k === 'fdr' && fs_.fdr && !Array.isArray(fs_.fdr)) {
      const { fdrs, ...rest } = fs_.fdr;
      out.fdr = { ...(Array.isArray(fdrs) ? summarizeCollection(fdrs) : { h: digest(canonical(fdrs)) }), rest: summarize(rest) };
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
  const text = serializeGolden(actual);
  if (UPDATE) {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
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
