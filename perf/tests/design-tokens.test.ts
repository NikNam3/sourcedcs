// The design system's colour and type rules (TOLD.md 10.1): five colour tokens, defined once in tokens.css,
// light and dark; no other colour anywhere; one font stack.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const webDir = new URL('../web/', import.meta.url);
const cssDir = new URL('css/', webDir);

const read = (url: URL): string => readFileSync(url, 'utf8');
const tokensCss = read(new URL('tokens.css', cssDir));
const otherCssFiles = readdirSync(cssDir)
  .filter((name) => name.endsWith('.css') && name !== 'tokens.css')
  .sort();
const otherCss = otherCssFiles.map((name) => ({ name, text: read(new URL(name, cssDir)) }));
const specimen = read(new URL('components.html', webDir));

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

test('tokens.css: no rule other than the two :root rules, no other custom property', () => {
  const top = blocks(stripComments(tokensCss)).map((b) => b.prelude);
  assert.equal(top.length, 2);
  const all = declarations(tokensCss).filter((d) => d.property.startsWith('--'));
  assert.equal(all.length, 10);
});

test('there is a component stylesheet and a print stylesheet besides the tokens', () => {
  assert.ok(otherCssFiles.includes('perf.css'));
  assert.ok(otherCssFiles.includes('print.css'));
});

test('no colour literal in any other stylesheet', () => {
  for (const { name, text } of otherCss) {
    const css = stripComments(text);
    assert.doesNotMatch(css, HEX, `${name}: hex colour`);
    assert.doesNotMatch(css, COLOUR_FUNCTION, `${name}: colour function`);
    assert.deepEqual(namedColoursIn(css), [], `${name}: named colour`);
  }
});

test('no colour literal in components.html', () => {
  assert.doesNotMatch(specimen, HEX, 'hex colour');
  assert.doesNotMatch(specimen, COLOUR_FUNCTION, 'colour function');
  for (const css of inlineCss(specimen)) assert.deepEqual(namedColoursIn(css), [], 'named colour in inline CSS');
  const attributes = specimen.matchAll(/\s(fill|stroke|color|bgcolor|stop-color|flood-color|lighting-color)\s*=/gi);
  assert.deepEqual(
    [...attributes].map((m) => m[1]),
    [],
    'colour presentation attribute',
  );
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
    { name: 'tokens.css', css: tokensCss },
    ...inlineCss(specimen).map((css) => ({ name: 'components.html', css })),
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
  assert.doesNotMatch(specimen, /\sfont-family\s*=/i, 'no font-family attribute in components.html');
});
