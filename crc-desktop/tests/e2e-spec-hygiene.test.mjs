// Every Playwright spec must import test/expect from ./helpers/test. That module is what serves the
// CDN scripts from node_modules and what gives each spec file a fresh crc-sync (the reset hook);
// a spec that requires '@playwright/test' directly silently gets neither and depends on whatever
// ran before it (docs/wip/E2EH.md). A new spec that forgets fails here, in `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const E2E = path.join(__dirname, '..', 'e2e');
const specs = fs.readdirSync(E2E).filter((f) => f.endsWith('.spec.js'));

test('there are specs to check', () => assert.ok(specs.length > 20));

for (const f of specs) {
  test(`${f} requires ./helpers/test and not @playwright/test`, () => {
    const src = fs.readFileSync(path.join(E2E, f), 'utf8');
    assert.match(src, /require\(\s*['"]\.\/helpers\/test['"]\s*\)/, `${f} must require('./helpers/test')`);
    assert.doesNotMatch(src, /require\(\s*['"]@playwright\/test['"]\s*\)|from\s+['"]@playwright\/test['"]/, `${f} must not import @playwright/test directly`);
  });
}

test('the harness starts crc-sync with the reset hook through the supervisor', () => {
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'playwright.config.js'), 'utf8');
  assert.match(cfg, /sync-supervisor\.js/);
  const sup = fs.readFileSync(path.join(E2E, 'helpers', 'sync-supervisor.js'), 'utf8');
  assert.match(sup, /CRCSYNC_TEST_RESET:\s*'1'/);
});

// BRIDGE: a sender is replaced through the owning module's setter (crc.ws.setEfspSender, crc.sync.setSendToSync),
// never by assigning to a name, and the specs read no application global (they go through window.crc,
// e2e/helpers/modules.js).
test('no e2e file assigns an app sender or reads a bare app global', () => {
  const files = [...specs, ...fs.readdirSync(path.join(E2E, 'helpers')).filter((f) => f.endsWith('.js')).map((f) => path.join('helpers', f))];
  const bad = [];
  for (const f of files) {
    fs.readFileSync(path.join(E2E, f), 'utf8').split('\n').forEach((line, i) => {
      if (/\b(?:window|crc\.\w+)\.(?:sendToSync|sendEfsp\w*)\s*=[^=>]/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
      if (/\bwindow\.(?:sendToSync|sendEfsp\w*|getEfsp\w*|toggleDockPanel|isDockPanelOpen|getActingPositions)\b/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, []);
});
