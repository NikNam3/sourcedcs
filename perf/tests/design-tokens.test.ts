// The design system's colour and type rules (TOLD.md 10.1): five colour tokens, defined once in tokens.css,
// light and dark; no other colour anywhere; one font stack.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const webDir = new URL('../web/', import.meta.url);

const read = (path: string): string => readFileSync(new URL(path, webDir), 'utf8');
// Every file under web/, as a path relative to it ('css/perf.css'). web/js/ is tsc output and holds neither kind.
const webFiles = readdirSync(webDir, { recursive: true, encoding: 'utf8' })
  .map((path) => path.split('\\').join('/'))
  .sort();
const tokensCss = read('css/tokens.css');
const otherCss = webFiles
  .filter((path) => path.endsWith('.css') && path !== 'css/tokens.css')
  .map((name) => ({ name, text: read(name) }));
const pages = webFiles.filter((path) => path.endsWith('.html')).map((name) => ({ name, text: read(name) }));
const specimen = read('components.html');

const LIGHT = {
  '--paper': '#ffffff',
  '--ink': '#000000',
  '--grey': '#555555',
  '--rule': '#bbbbbb',
  '--alert': '#b00000',
};
const DARK = {
  '--paper': '#000000',
  '--ink': '#ffffff',
  '--grey': '#a8a8a8',
  '--rule': '#444444',
  '--alert': '#ff6b6b',
};
const FONT_STACK = "'Times New Roman', Times, 'Liberation Serif', serif";

// The CSS named colours (CSS Color 4) and the system colours, except transparent and currentColor.
const NAMED_COLOURS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood ' +
    'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod ' +
    'darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon ' +
    'darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray ' +
    'dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green ' +
    'greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon ' +
    'lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon ' +
    'lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta ' +
    'maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen ' +
    'mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive ' +
    'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru ' +
    'pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen ' +
    'seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato ' +
    'turquoise violet wheat white whitesmoke yellow yellowgreen ' +
    'accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field fieldtext ' +
    'graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext'
  ).split(' '),
);

const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-])/i;
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i;

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const stripStrings = (value: string): string => value.replace(/'[^']*'|"[^"]*"/g, "''");

interface Block {
  prelude: string;
  body: string;
}

/** The top-level blocks of a stylesheet: `prelude { body }`, braces balanced. */
function blocks(css: string): Block[] {
  const out: Block[] = [];
  let depth = 0;
  let start = 0;
  let bodyStart = 0;
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] === '{') {
      if (depth === 0) bodyStart = i + 1;
      depth += 1;
    } else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        out.push({ prelude: css.slice(start, bodyStart - 1).trim(), body: css.slice(bodyStart, i) });
        start = i + 1;
      }
    }
  }
  assert.equal(depth, 0, 'unbalanced braces');
  return out;
}

/** The declarations `property: value` of a CSS text, at any nesting depth. */
function declarations(css: string): { property: string; value: string }[] {
  const out: { property: string; value: string }[] = [];
  for (const match of stripComments(css).matchAll(/([-a-z]+)\s*:\s*([^;{}]+)(?=[;}])/gi)) {
    const property = match[1];
    const value = match[2];
    if (property !== undefined && value !== undefined)
      out.push({ property: property.toLowerCase(), value: value.trim() });
  }
  return out;
}

function customProperties(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { property, value } of declarations(body)) {
    if (property.startsWith('--')) out[property] = value.toLowerCase();
  }
  return out;
}

/** The CSS a page carries inline: `<style>` elements and `style` attributes. */
function inlineCss(html: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) out.push(match[1] ?? '');
  for (const match of html.matchAll(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi))
    out.push(`x{${(match[1] ?? '').slice(1, -1)}}`);
  return out;
}

/** The named colours used in a CSS text's declaration values. */
function namedColoursIn(css: string): string[] {
  const found: string[] = [];
  for (const { value } of declarations(css)) {
    for (const word of stripStrings(value).matchAll(/(?<![-\w])([a-z]+)(?![-\w(])/gi)) {
      const lower = (word[1] ?? '').toLowerCase();
      if (NAMED_COLOURS.has(lower)) found.push(lower);
    }
  }
  return found;
}

test('tokens.css: the light :root defines exactly the five tokens with the 10.1 values', () => {
  const root = blocks(stripComments(tokensCss)).filter((b) => b.prelude === ':root');
  assert.equal(root.length, 1, 'one top-level :root rule');
  assert.deepEqual(customProperties(root[0]?.body ?? ''), LIGHT);
});

test('tokens.css: the dark scheme defines exactly the five tokens with the 10.1 values', () => {
  const dark = blocks(stripComments(tokensCss)).filter((b) => b.prelude.includes('prefers-color-scheme: dark'));
  assert.equal(dark.length, 1, 'one prefers-color-scheme: dark block');
  const inner = blocks(dark[0]?.body ?? '');
  assert.deepEqual(
    inner.map((b) => b.prelude),
    [':root'],
  );
  assert.deepEqual(customProperties(inner[0]?.body ?? ''), DARK);
});

test('tokens.css: the dark values apply on screen only, so print always gets the light ones', () => {
  const dark = blocks(stripComments(tokensCss)).find((b) => b.prelude.includes('prefers-color-scheme: dark'));
  assert.match(dark?.prelude ?? '', /^@media\s+screen\s+and\s+\(prefers-color-scheme: dark\)$/);
});

test('tokens.css: no rule other than the two :root rules, nothing in them but the tokens and color-scheme', () => {
  const top = blocks(stripComments(tokensCss)).map((b) => b.prelude);
  assert.equal(top.length, 2);
  const all = declarations(tokensCss);
  assert.equal(all.filter((d) => d.property.startsWith('--')).length, 10);
  assert.deepEqual(
    all.filter((d) => !d.property.startsWith('--')),
    [
      { property: 'color-scheme', value: 'light' },
      { property: 'color-scheme', value: 'dark' },
    ],
  );
});

test('there is a component stylesheet and a print stylesheet besides the tokens', () => {
  const names = otherCss.map((f) => f.name);
  assert.ok(names.includes('css/perf.css'));
  assert.ok(names.includes('css/print.css'));
});

test('no colour literal in any other stylesheet', () => {
  for (const { name, text } of otherCss) {
    const css = stripComments(text);
    assert.doesNotMatch(css, HEX, `${name}: hex colour`);
    assert.doesNotMatch(css, COLOUR_FUNCTION, `${name}: colour function`);
    assert.deepEqual(namedColoursIn(css), [], `${name}: named colour`);
  }
});

test('no colour literal in any page under web/', () => {
  assert.ok(pages.some((p) => p.name === 'components.html'));
  for (const { name, text } of pages) {
    assert.doesNotMatch(text, HEX, `${name}: hex colour`);
    assert.doesNotMatch(text, COLOUR_FUNCTION, `${name}: colour function`);
    for (const css of inlineCss(text)) assert.deepEqual(namedColoursIn(css), [], `${name}: named colour in inline CSS`);
    const attributes = text.matchAll(/\s(fill|stroke|color|bgcolor|stop-color|flood-color|lighting-color)\s*=/gi);
    assert.deepEqual(
      [...attributes].map((m) => m[1]),
      [],
      `${name}: colour presentation attribute`,
    );
  }
});

test('components.html is styled only by the stylesheets: no <style> element, no style attribute', () => {
  assert.deepEqual(inlineCss(specimen), []);
});

test('components.html links the three stylesheets, print.css for print only', () => {
  assert.match(specimen, /<link rel="stylesheet" href="css\/tokens\.css" ?\/?>/);
  assert.match(specimen, /<link rel="stylesheet" href="css\/perf\.css" ?\/?>/);
  assert.match(specimen, /<link rel="stylesheet" href="css\/print\.css" media="print" ?\/?>/);
});

test('components.html carries no script', () => {
  assert.doesNotMatch(specimen, /<script|\son[a-z]+\s*=/i);
});

test('every font-family is the one font stack', () => {
  const sources = [
    ...otherCss.map(({ name, text }) => ({ name, css: text })),
    { name: 'css/tokens.css', css: tokensCss },
    ...pages.flatMap(({ name, text }) => inlineCss(text).map((css) => ({ name, css }))),
  ];
  let families = 0;
  for (const { name, css } of sources) {
    for (const { property, value } of declarations(css)) {
      if (property === 'font-family') {
        families += 1;
        assert.equal(value, FONT_STACK, `${name}: font-family`);
      } else if (property === 'font') {
        assert.ok(value === 'inherit' || value.endsWith(FONT_STACK), `${name}: font shorthand ${value}`);
      }
    }
  }
  assert.ok(families > 0, 'the font stack is set somewhere');
  for (const { name, text } of pages) assert.doesNotMatch(text, /\sfont-family\s*=/i, `${name}: font-family attribute`);
});
