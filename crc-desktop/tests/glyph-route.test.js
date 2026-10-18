'use strict';
// U-GLYPHS: the local server's /fonts/ route (app/glyph-route.js) against the shipped glyph files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveGlyphs } = require('../app/glyph-route');

const FONTS = path.join(__dirname, '../app/public/fonts');
const url = (stack, range) => `/fonts/${encodeURIComponent(stack.join(','))}/${range}.pbf`;

// A minimal reader for the glyph PBF: message { repeated fontstack stacks = 1 } fontstack { name = 1; range = 2;
// repeated glyph glyphs = 3 } glyph { id = 1; ... }. Returns [{ name, ids }] in file order.
function varint(b, i) { let r = 0, s = 0, c; do { c = b[i++]; r += (c & 0x7f) * 2 ** s; s += 7; } while (c & 0x80); return [r, i]; }
function* fields(b) {
  let i = 0;
  while (i < b.length) {
    let k, v; [k, i] = varint(b, i);
    if ((k & 7) === 0) { [v, i] = varint(b, i); } else if ((k & 7) === 2) { let l; [l, i] = varint(b, i); v = b.subarray(i, i + l); i += l; } else throw new Error('wire type ' + (k & 7));
    yield [k >> 3, v];
  }
}
function stacks(buf) {
  const out = [];
  for (const [f, v] of fields(buf)) {
    if (f !== 1) continue;
    const s = { name: null, ids: [] };
    for (const [f2, v2] of fields(v)) {
      if (f2 === 1) s.name = Buffer.from(v2).toString().split(',')[0]; // Noto's names its own fallbacks after a comma
      if (f2 === 3) for (const [f3, v3] of fields(v2)) if (f3 === 1) s.ids.push(v3);
    }
    out.push(s);
  }
  return out;
}
/** What maplibre 3.6.2 ends up with: the last glyph read for each code point wins. */
const winner = (buf, cp) => { let w = null; for (const s of stacks(buf)) if (s.ids.includes(cp)) w = s.name; return w; };

test('a shipped range of a combined stack merges the fonts, the primary winning', () => {
  const r = resolveGlyphs(url(['Roboto Regular', 'Noto Sans Regular'], '0-255'), FONTS);
  assert.equal(r.status, 200);
  assert.deepEqual(stacks(r.body).map((s) => s.name), ['Noto Sans Regular', 'Roboto Regular'], 'fallback first, primary last');
  assert.equal(winner(r.body, 'A'.codePointAt(0)), 'Roboto Regular');
  // Roboto has no arrows: Noto Sans fills them in (the data block's altitude trend).
  const arrows = resolveGlyphs(url(['Roboto Regular', 'Noto Sans Regular'], '8448-8703'), FONTS);
  assert.equal(winner(arrows.body, 0x2191), 'Noto Sans Regular');
  assert.equal(winner(arrows.body, 0x2193), 'Noto Sans Regular');
  assert.equal(winner(resolveGlyphs(url(['Roboto Medium', 'Noto Sans Regular'], '9472-9727'), FONTS).body, 0x25B2), 'Noto Sans Regular', '▲');
});

test('a single font answers its own file unchanged', () => {
  const r = resolveGlyphs('/fonts/Roboto%20Medium/0-255.pbf', FONTS);
  assert.deepEqual(r.body, fs.readFileSync(path.join(FONTS, 'Roboto Medium/0-255.pbf')));
  assert.deepEqual(resolveGlyphs('/fonts/Roboto%20Medium/0-255.pbf?v=1', FONTS).body, r.body, 'a query string is ignored');
});

test('Roboto Mono stands in as Roboto of the same weight; an unknown font gets Roboto Regular', () => {
  const mono = resolveGlyphs(url(['Roboto Mono Medium', 'Noto Sans Regular'], '0-255'), FONTS);
  assert.equal(winner(mono.body, '7'.codePointAt(0)), 'Roboto Medium');
  const monoReg = resolveGlyphs(url(['Roboto Mono Regular', 'Noto Sans Regular'], '0-255'), FONTS);
  assert.equal(winner(monoReg.body, '7'.codePointAt(0)), 'Roboto Regular');
  const unknown = resolveGlyphs(url(['Open Sans Regular', 'Arial Unicode MS Regular'], '0-255'), FONTS);
  assert.deepEqual(stacks(unknown.body).map((s) => s.name), ['Roboto Regular']);
});

test('a range no font ships answers an empty 200, not an error', () => {
  const r = resolveGlyphs(url(['Roboto Regular', 'Noto Sans Regular'], '65280-65535'), FONTS);
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 0);
});

test('not a glyph URL: null; a malformed stack: 400', () => {
  assert.equal(resolveGlyphs('/index.html', FONTS), null);
  assert.equal(resolveGlyphs('/fonts/Roboto%20Regular/0-255.json', FONTS), null);
  assert.equal(resolveGlyphs('/fonts/Roboto%20Regular/abc.pbf', FONTS), null);
  assert.equal(resolveGlyphs('/fonts/%E0%A4%A/0-255.pbf', FONTS).status, 400);
});

test('a traversal attempt never reads outside fonts/', () => {
  // A directory beside fonts/ holding a file named like a range: none of these may return its bytes.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glyphs-'));
  const fontsDir = path.join(root, 'fonts');
  fs.mkdirSync(path.join(fontsDir, 'Roboto Regular'), { recursive: true });
  fs.writeFileSync(path.join(fontsDir, 'Roboto Regular', '0-255.pbf'), 'ROBOTO');
  fs.mkdirSync(path.join(root, 'secret'));
  fs.writeFileSync(path.join(root, 'secret', '0-255.pbf'), 'SECRET');
  for (const u of [
    '/fonts/..%2Fsecret/0-255.pbf',
    '/fonts/..%2F..%2Fsecret/0-255.pbf',
    '/fonts/%2E%2E%2Fsecret/0-255.pbf',
    '/fonts/Roboto%20Regular%2C..%2Fsecret/0-255.pbf',
    '/fonts/..%5Csecret/0-255.pbf',
    '/fonts/../secret/0-255.pbf',
    '/fonts/secret%00/0-255.pbf',
  ]) {
    const r = resolveGlyphs(u, fontsDir);
    if (r === null || r.status !== 200) continue;
    assert.ok(!r.body.toString().includes('SECRET'), u);
  }
  assert.equal(resolveGlyphs('/fonts/..%2Fsecret/0-255.pbf', fontsDir).body.toString(), 'ROBOTO', 'an invalid name is not shipped: the default font');
  fs.rmSync(root, { recursive: true, force: true });
});
