import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const coreDir = fileURLToPath(new URL('../src/core/', import.meta.url));

/** Every .ts file under src/core/, as absolute paths. */
function coreFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return coreFiles(path);
      return entry.name.endsWith('.ts') ? [path] : [];
    })
    .sort();
}

/** What src/core/ must not use: it runs in the browser and in tests, with chart data passed in. */
const forbidden: readonly [string, RegExp][] = [
  ['a node: import', /from\s+['"]node:|import\(\s*['"]node:/],
  ['document', /\bdocument\b/],
  ['window', /\bwindow\b/],
  ['fetch(', /\bfetch\s*\(/],
  ['localStorage', /\blocalStorage\b/],
];

test('src/core/ has .ts files to check', () => {
  assert.ok(coreFiles(coreDir).length > 0);
});

test('no file under src/core/ uses node:, the DOM, fetch or localStorage', () => {
  const problems: string[] = [];
  for (const file of coreFiles(coreDir)) {
    const source = readFileSync(file, 'utf8');
    for (const [what, pattern] of forbidden) {
      if (pattern.test(source)) problems.push(`${relative(coreDir, file)} uses ${what}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every module under src/core/ loads, so the coverage floor counts the untested ones', async () => {
  for (const file of coreFiles(coreDir)) {
    const module: unknown = await import(pathToFileURL(file).href);
    assert.equal(typeof module, 'object', relative(coreDir, file));
  }
});
