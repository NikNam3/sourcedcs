'use strict';

// USMTF text → sets. The lowest layer of the ATO parser (docs/adr/0063): it
// knows the slash grammar and nothing about what any set means.
//
// SOURCE CAVEAT (EFSPImplementationGuide.md §9.9, required to be carried into code):
// the detailed USMTF set-level breakdown this parser implements comes from a
// DCS community wiki — the 455 vAEW "ATO, ACO & SPINS Guide"
// (https://wiki.455aew.com/books/ato-aco-spins-guide/page/ato) — NOT from the
// official specification. Set names are consistent with real USMTF, but
// anything load-bearing MUST be verified against MIL-STD-6040 [Annex §14.3],
// which was not available when this was written (and the Annex itself is not
// in this repository). The grammar below (`/` separates fields, `//` ends a
// set, `-` is empty, `KEY:value` descriptors, columnar sets whose name starts
// with a digit) is the part every public source agrees on
// (docs/parallel/research/usmtf-ato.md §1.2).
//
// Pure: no I/O, no requires. Never throws on any string input.

const MAX_INPUT_BYTES = 1024 * 1024; // 1 MiB — see the pathological-input test

// Duplicates fdr-store.js:76's MAX_FREE_TEXT. Not required from there because
// fdr-store.js reads config at require time (airspace-config, stereo-routes);
// tests/efsp-ato-acceptance.test.mjs asserts the two stay equal.
const MAX_FREE_TEXT = 2000;

// Free-text sets: everything up to `//` is one field and may contain `/`.
const FREE_TEXT_SETS = new Set(['AMPN', 'NARR', 'GENTEXT', 'RMKS']);

// Set names the tokenizer may use to notice a missing `//`: a line that
// starts at column 0 with one of these, followed by `/` (or alone, for a
// columnar set), cannot be a wrapped continuation of the previous set.
// Restricted to known names so an ordinary wrapped value that happens to
// look like `WORD/` is never mistaken for a new set.
const KNOWN_SET_NAMES = new Set([
  'OPER', 'EXER', 'MSGID', 'AKNLDG', 'TIMEFRAM', 'PERIOD', 'PERID', 'REF', 'DECL',
  'TSKCNTRY', 'SVCTASK', 'TASKUNIT',
  'AMSNDAT', 'MSNACFT', 'AMSNLOC', 'GTGTLOC', 'MTGTLOC', 'SHIPTGT', 'ESCDATA', 'RECCEDAT',
  'PTRCPLOT', 'AIRMOVE', 'CONTROLA', 'ARINFO', 'REFTSK', 'PKGCMD', 'ASUPTFOR', 'ASUPTBY',
  'FACINFOR', 'URMKREF', 'AMPN', 'NARR', 'GENTEXT', 'RMKS',
  '5REFUEL', '6ROUTE', '7CONTROL', '9PKGDAT',
]);

// `KEY:value`. A DTG (`011000ZOCT`) and a coordinate (`2840N08040W`) never
// contain a colon, so they stay bare. No nested quantifiers (ReDoS).
const DESCRIPTOR_RE = /^([A-Z][A-Z0-9]{0,5}):(.*)$/s;
const SET_NAME_RE = /^[A-Z0-9]+$/;

function warn(code, severity, line, set, message, field = null) {
  return { code, severity, line, set, field, message };
}

/** One field. `-`, '' and whitespace are empty. `upper` false only for free text. */
function makeField(rawText, upper = true) {
  const raw = rawText;
  let text = rawText.trim();
  if (upper) text = text.toUpperCase();
  let key = null;
  const m = upper ? DESCRIPTOR_RE.exec(text) : null;
  if (m) { key = m[1]; text = m[2].trim(); }
  const empty = text === '' || text === '-';
  return { raw, value: empty ? null : text, key, empty };
}

// Newlines inside a linear set are wrap points: USMTF wraps inside fields, so
// the newline and the indent of the continuation line are deleted outright
// (research §1.2, "recommended parse").
function unwrap(s) { return s.replace(/\n[ \t]*/g, ''); }

/**
 * @param {string} text
 * @returns {{ sets: object[], warnings: object[], classification: string|null }}
 */
function tokenize(text) {
  const warnings = [];
  const sets = [];
  if (typeof text !== 'string') {
    warnings.push(warn('NOT_TEXT', 'error', null, null, 'The ATO input is not text.'));
    return { sets, warnings, classification: null };
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) {
    warnings.push(warn('INPUT_TOO_LARGE', 'error', null, null,
      `The ATO is larger than ${MAX_INPUT_BYTES} bytes and was not read.`));
    return { sets, warnings, classification: null };
  }
  let src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  src = src.replace(/\r\n?/g, '\n');

  // Line starts, for offset → 1-based line number.
  const lineStarts = [0];
  for (let k = 0; k < src.length; k++) if (src.charCodeAt(k) === 10) lineStarts.push(k + 1);
  const lineOf = (off) => {
    let lo = 0; let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
  const lineEnd = (off) => { const e = src.indexOf('\n', off); return e === -1 ? src.length : e; };

  // Does the line starting at `off` begin a known set?
  const startsKnownSet = (off) => {
    let e = off;
    while (e < src.length && /[A-Za-z0-9]/.test(src[e])) e++;
    if (e === off) return false;
    const name = src.slice(off, e).toUpperCase();
    if (!KNOWN_SET_NAMES.has(name)) return false;
    return e >= src.length || src[e] === '/' || src[e] === '\n';
  };

  let classification = null;
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    const startLine = lineOf(i);
    if (!/[A-Za-z0-9]/.test(c)) {
      const e = lineEnd(i);
      warnings.push(warn('STRAY_TEXT', 'info', startLine, null,
        `Ignored text that is not part of any set: "${src.slice(i, Math.min(e, i + 40))}".`));
      i = e + 1;
      continue;
    }
    // Set name: up to the first `/` or newline.
    let j = i;
    while (j < n && src[j] !== '/' && src[j] !== '\n') j++;
    const name = src.slice(i, j).trim().toUpperCase();
    const atSlash = j < n && src[j] === '/';

    if (!SET_NAME_RE.test(name) || (!atSlash && !/^[0-9]/.test(name))) {
      // A bare line. Before the first set it is the classification line
      // (research §1.2); anywhere else it is noise.
      const e = lineEnd(i);
      if (!atSlash && sets.length === 0 && classification === null && SET_NAME_RE.test(name.replace(/[ \-()]/g, ''))) {
        classification = src.slice(i, e).trim().toUpperCase();
      } else {
        warnings.push(warn('STRAY_TEXT', 'info', startLine, null,
          `Ignored a line that is not a set: "${src.slice(i, Math.min(e, i + 40))}".`));
      }
      i = e + 1;
      continue;
    }

    const kind = /^[0-9]/.test(name) ? 'columnar' : (FREE_TEXT_SETS.has(name) ? 'freetext' : 'linear');
    let bodyStart = atSlash ? j + 1 : j;

    // Find the terminator, noticing a new known set at column 0 first.
    let end = -1; // index of the `//`
    let stop = n; // where an unterminated body stops
    if (atSlash && src[bodyStart] === '/') {
      end = bodyStart; // `NAME//` — an empty set
    } else {
      const term = src.indexOf('//', bodyStart);
      let scan = src.indexOf('\n', bodyStart);
      const limit = term === -1 ? n : term;
      while (scan !== -1 && scan < limit) {
        if (startsKnownSet(scan + 1)) { stop = scan; break; }
        scan = src.indexOf('\n', scan + 1);
      }
      if (stop === n && term !== -1) end = term;
    }
    const terminated = end !== -1;
    const body = src.slice(bodyStart, terminated ? end : stop);
    const next = terminated ? end + 2 : stop;
    const set = {
      name, kind, fields: [], line: startLine, endLine: lineOf(Math.max(i, next - 1)),
      raw: src.slice(i, next).trim(), terminated,
    };
    if (!terminated) {
      warnings.push(warn('UNTERMINATED_SET', 'warning', startLine, name,
        `${name} has no closing "//"; it was read up to ${stop === n ? 'the end of the ATO' : 'the next set'}.`));
    }

    if (kind === 'freetext') {
      let t = unwrap(body).trim();
      if (t.length > MAX_FREE_TEXT) {
        t = t.slice(0, MAX_FREE_TEXT);
        warnings.push(warn('FIELD_TRUNCATED', 'info', startLine, name,
          `${name} text was cut to ${MAX_FREE_TEXT} characters.`));
      }
      set.fields = [makeField(t, false)];
    } else if (kind === 'linear') {
      set.fields = body === '' ? [] : unwrap(body).split('/').map((f) => makeField(f));
    } else {
      parseColumnar(set, body, lineOf(bodyStart), warnings);
    }
    sets.push(set);
    i = next;
  }
  return { sets, warnings, classification };
}

const HEADER_CELL_RE = /^[A-Z][A-Z0-9]*$/;

function parseColumnar(set, body, firstLine, warnings) {
  const lines = body.split('\n');
  const rows = [];
  let sawNewline = lines.length > 1;
  for (let k = 0; k < lines.length; k++) {
    const t = lines[k].trim();
    if (t === '') continue;
    const line = firstLine + k;
    if (t[0] !== '/') {
      // Cells right after the name (`5REFUEL/a/b//`): a columnar set written
      // on one line, indistinguishable from a linear one. Read positionally.
      if (k === 0) { rows.push({ line, fields: t.split('/').map((f) => makeField(f)) }); continue; }
      warnings.push(warn('STRAY_TEXT', 'info', line, set.name, `Ignored a line in ${set.name} that is not a row.`));
      continue;
    }
    rows.push({ line, fields: t.slice(1).split('/').map((f) => makeField(f)) });
  }
  const first = rows[0];
  const isHeader = sawNewline && first && first.fields.length > 0
    && first.fields.every((f) => !f.empty && !f.key && HEADER_CELL_RE.test(f.value));
  if (isHeader) {
    set.header = first.fields.map((f) => f.value);
    set.rows = rows.slice(1);
    for (const r of set.rows) {
      if (r.fields.length !== set.header.length) {
        warnings.push(warn('COLUMN_COUNT', 'warning', r.line, set.name,
          `${set.name} row has ${r.fields.length} columns; its header has ${set.header.length}. Read by position.`));
      }
    }
  } else {
    set.header = null;
    set.rows = rows;
    warnings.push(warn('COLUMNAR_NO_HEADER', 'warning', set.line, set.name,
      `${set.name} has no header row; its columns were read by position.`));
  }
  set.fields = [];
}

module.exports = { tokenize, makeField, MAX_INPUT_BYTES, MAX_FREE_TEXT, FREE_TEXT_SETS, KNOWN_SET_NAMES };
