/* The radio-only page stays small (docs/adr/0161 §2): js/radio-only-main.js reaches nothing of the map, the dock or the
 * strips, and radio-only.html loads no CDN script. An allowlist, not a blocklist: outside radio/, a module joins this
 * page only by being named here, so a new import that drags the Board or MapLibre in fails this test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PUBLIC = path.join(import.meta.dirname, '../app/public');
const JS = path.join(PUBLIC, 'js');
const ROOT = path.join(JS, 'radio-only-main.js');
const rel = (abs) => path.relative(JS, abs).split(path.sep).join('/');

const ALLOWED_OUTSIDE_RADIO = [
  'html-escape.js', 'ptt-controller.js', 'radio-only-main.js', 'settings.js', 'sync-connection.js', 'sync.js',
  'update-required.js', 'wire-protocol.js',
  'panels/efsp/efsp-change-bus.js', 'panels/efsp/efsp-message-registry.js', 'panels/efsp/facility-topology.js',
  'panels/efsp/frequency-state.js', 'panels/efsp/signed-on-state.js',
];

/** Everything a file names: static imports, re-exports and dynamic imports. */
function importsOf(abs) {
  const text = fs.readFileSync(abs, 'utf8');
  const specs = [
    ...[...text.matchAll(/^\s*import\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map(m => m[1]),
    ...[...text.matchAll(/^\s*export\s+[^'";]*?\s+from\s+['"]([^'"]+)['"]/gm)].map(m => m[1]),
    ...[...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]),
  ];
  return specs.map(s => path.resolve(path.dirname(abs), s));
}

function reachable() {
  const seen = new Set();
  const visit = (abs) => { if (seen.has(abs)) return; seen.add(abs); importsOf(abs).forEach(visit); };
  visit(ROOT);
  return [...seen];
}

test('radio-only-main.js reaches no map, dock or strips module', () => {
  const files = reachable().map(rel).sort();
  assert.deepEqual(files.filter(f => /(^|\/)(map-|maptiler|basemap|geojson|dock|atc-scope|app\.js|main\.js$)|strip|bay|efsp-state|efsp-ws|efsp-panel/.test(f) && f !== 'radio-only-main.js'), []);
  assert.deepEqual(files.filter(f => !f.startsWith('radio/') && !ALLOWED_OUTSIDE_RADIO.includes(f)), [], 'a module outside radio/ joined the radio-only page');
});

test('nothing reachable reads the CDN globals', () => {
  const uses = reachable().filter(f => /\b(maplibregl|dockview)\b/.test(fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, ''))).map(rel);
  assert.deepEqual(uses, []);
});

test('radio-only.html loads nothing from outside the app', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'radio-only.html'), 'utf8');
  assert.deepEqual([...html.matchAll(/(?:src|href)="((?:https?:)?\/\/[^"]+)"/g)].map(m => m[1]), []);
  assert.doesNotMatch(html, /maplibre|dockview/i);
});

test('the page loads the settings before the panel binds them, or its first save wipes the full app\'s (RO3)', () => {
  const main = fs.readFileSync(ROOT, 'utf8');
  const load = main.indexOf('loadSettings();');
  assert.ok(load > 0 && load < main.indexOf('initRadioPanel('));
});
