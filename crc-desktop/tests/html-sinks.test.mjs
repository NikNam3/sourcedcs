/* DESK-TIDY-2 (ARCH-C 3.2): no new unescaped interpolation into innerHTML. Every dynamic part of an `innerHTML =`,
   `outerHTML =` or `insertAdjacentHTML(` in the client must be `escapeHtml(...)` (js/html-escape.js), or a literal, or one
   of the reviewed helpers below. Prefer textContent/createElement; this only keeps a template honest. */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const JS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'public', 'js');

// Reviewed expressions that are HTML by construction: each builds its markup from escapeHtml() parts or constants.
const ALLOWED = {
  'sync.js': [/^_connFieldRow\(/],               // label, id and value all go through escapeHtml
  'update-required.js': [/^link$/, /^BTN2?$/],   // link is built with escapeHtml'd href and text; BTN* are style constants
  'srs-radio.js': [/^modBadge$/],
  'airspace-geometry-editor.js': [/^sketchSvg\(/], // numbers only, by construction (airspace-geometry-model.js)                // built just above from escapeHtml'd parts
};

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []);
}

// ── a small scanner: enough JS to walk a string/template/paren/brace-balanced expression ──
function skipString(src, i) { // src[i] is ' or "
  const q = src[i];
  for (i += 1; i < src.length; i += 1) {
    if (src[i] === '\\') i += 1;
    else if (src[i] === q) return i + 1;
  }
  return i;
}
function skipTemplate(src, i) { // src[i] is `; returns the index after the closing backtick
  for (i += 1; i < src.length; i += 1) {
    if (src[i] === '\\') i += 1;
    else if (src[i] === '`') return i + 1;
    else if (src[i] === '$' && src[i + 1] === '{') i = skipBalanced(src, i + 1) - 1;
  }
  return i;
}
function skipBalanced(src, i) { // src[i] opens ( [ {; returns the index after the matching close
  let depth = 0;
  for (; i < src.length; i += 1) {
    const c = src[i];
    if (c === '"' || c === "'") i = skipString(src, i) - 1;
    else if (c === '`') i = skipTemplate(src, i) - 1;
    else if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; }
    else if (c === '/' && src[i + 1] === '*') i = src.indexOf('*/', i + 2) + 1;
    else if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) { depth -= 1; if (depth === 0) return i + 1; }
  }
  return i;
}
/** Split `e` at top-level occurrences of `sep` (outside strings, templates and brackets). */
function splitTop(e, sep) {
  const parts = [];
  let last = 0;
  for (let i = 0; i < e.length;) {
    const c = e[i];
    if (c === '"' || c === "'") i = skipString(e, i);
    else if (c === '`') i = skipTemplate(e, i);
    else if ('([{'.includes(c)) i = skipBalanced(e, i);
    else if (e.startsWith(sep, i)) { parts.push(e.slice(last, i)); i += sep.length; last = i; }
    else i += 1;
  }
  parts.push(e.slice(last));
  return parts;
}
/** The right-hand side of the assignment starting at `i`, up to the `;` that ends the statement. */
function statementEnd(src, i) {
  for (; i < src.length;) {
    const c = src[i];
    if (c === '"' || c === "'") i = skipString(src, i);
    else if (c === '`') i = skipTemplate(src, i);
    else if ('([{'.includes(c)) i = skipBalanced(src, i);
    else if (c === ';') return i;
    else i += 1;
  }
  return i;
}

/** The unsafe dynamic parts of expression `e` (empty when every part is escaped, literal or reviewed). */
export function unsafeParts(e, allowed = []) {
  e = e.trim();
  if (e === '') return [];
  if (e[0] === '(' && skipBalanced(e, 0) === e.length) return unsafeParts(e.slice(1, -1), allowed);
  const plus = splitTop(e, '+');
  if (plus.length > 1) return plus.flatMap((p) => unsafeParts(p, allowed));
  const q = splitTop(e, '?');
  if (q.length > 1) return splitTop(q.slice(1).join('?'), ':').flatMap((p) => unsafeParts(p, allowed)); // the test is not output
  const and = splitTop(e, '&&');
  if (and.length > 1) return unsafeParts(and[and.length - 1], allowed);
  if (/^(['"]).*\1$/s.test(e) && skipString(e, 0) === e.length) return [];
  if (e[0] === '`' && skipTemplate(e, 0) === e.length) {
    const bad = [];
    for (let i = 1; i < e.length - 1; i += 1) {
      if (e[i] === '\\') i += 1;
      else if (e[i] === '$' && e[i + 1] === '{') {
        const end = skipBalanced(e, i + 1);
        bad.push(...unsafeParts(e.slice(i + 2, end - 1), allowed));
        i = end - 1;
      }
    }
    return bad;
  }
  if (/^\d+(\.\d+)?$/.test(e)) return [];
  if (/^escapeHtml\(/.test(e) && skipBalanced(e, e.indexOf('(')) === e.length) return [];
  if (allowed.some((re) => re.test(e))) return [];
  return [e];
}

/** Every sink in `src`: [{ line, rhs }]. */
export function sinksIn(src) {
  const out = [];
  const re = /\.(?:innerHTML|outerHTML)\s*(\+?)=(?!=)\s*|\.insertAdjacentHTML\(\s*[^,]+,\s*/g;
  for (let m; (m = re.exec(src));) {
    const start = m.index + m[0].length;
    const rhs = src.slice(start, m[0].includes('insertAdjacentHTML') ? skipBalanced(src, m.index + m[0].indexOf('(')) - 1 : statementEnd(src, start));
    out.push({ line: src.slice(0, m.index).split('\n').length, rhs });
  }
  return out;
}

test('the checker: escaped, literal and conditional parts pass; a bare interpolation or concatenation fails', () => {
  assert.deepEqual(unsafeParts('`<b>${escapeHtml(a.b)}</b>`'), []);
  assert.deepEqual(unsafeParts("'<i>' + escapeHtml(x) + '</i>'"), []);
  assert.deepEqual(unsafeParts('(ok ? `<b>${escapeHtml(x)}</b>` : ``)'), []);
  assert.deepEqual(unsafeParts('`<b>${a.name}</b>`'), ['a.name']);
  assert.deepEqual(unsafeParts("'<b>' + name + '</b>'"), ['name']);
  assert.deepEqual(unsafeParts('(ok ? `<b>${n}</b>` : "")'), ['n']);
  assert.deepEqual(unsafeParts('`<b>${escapeHtml(x)}</b>`; alert(1)'), ['`<b>${escapeHtml(x)}</b>`; alert(1)']);
  assert.deepEqual(unsafeParts('`<b>${escapeHtml(x) + y}</b>`'), ['y']);
  assert.equal(sinksIn('a.innerHTML = `x${y}`;\nb.innerHTML = "";').length, 2);
  assert.equal(sinksIn('el.insertAdjacentHTML("beforeend", `<i>${v}</i>`);').length, 1);
});

test('every innerHTML/outerHTML/insertAdjacentHTML in the client escapes what it interpolates', () => {
  let seen = 0;
  const bad = [];
  for (const f of walk(JS)) {
    const rel = path.relative(JS, f);
    const allowed = ALLOWED[path.basename(f)] || [];
    for (const s of sinksIn(fs.readFileSync(f, 'utf8'))) {
      seen += 1;
      for (const part of unsafeParts(s.rhs, allowed)) bad.push(`${rel}:${s.line}  ${part.replace(/\s+/g, ' ').slice(0, 80)}`);
    }
  }
  assert.ok(seen >= 10, `the scan found ${seen} sinks; the scanner is broken`);
  assert.deepEqual(bad, [], `unescaped interpolation into innerHTML (use textContent or escapeHtml from js/html-escape.js):\n${bad.join('\n')}`);
});

test('index.html has no inline event-handler attribute', () => {
  const html = fs.readFileSync(path.join(JS, '..', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /\son(click|load|error|change|input)=/i);
});
