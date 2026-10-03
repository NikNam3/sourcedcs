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

// ARCH-W 5.3 item 5 (E2E-STAB): a popover holds more than one <select>, so `locator('select')` (strict mode throws the day a
// second one appears) or `locator('select').first()` (picks whichever renders first) is a spec waiting to break. Use the
// popover's own hook: a `data-testid` through getByTestId, or a class that names the one select (`select.efsp-block-enum-select`).
test('no spec reaches a <select> by the bare tag', () => {
  const bad = [];
  for (const f of specs) {
    fs.readFileSync(path.join(E2E, f), 'utf8').split('\n').forEach((line, i) => {
      if (/locator\(\s*['"]select['"]\s*\)/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, [], 'name the select by getByTestId(...) or a class selector');
});

// ARCH-W 5.3 item 3: a sleep is a guess about load. Wait on a signal (helpers/app.js: settle, frames, serverTicks,
// lapseNlaGuard, or an expect.poll on the store). The one left is a server wall-clock grace with no signal to poll.
const SLEEPS_ALLOWED = { 'signon-reconnect.spec.js': 1 };
test('waitForTimeout is not used outside the documented exceptions', () => {
  const found = {};
  for (const f of [...specs, 'helpers/app.js', 'helpers/test.js']) {
    const n = (fs.readFileSync(path.join(E2E, f), 'utf8').match(/\.waitForTimeout\(/g) || []).length;
    if (n) found[f] = n;
  }
  assert.deepEqual(found, SLEEPS_ALLOWED);
});

// ARCH-W 5.3 item 4: a retry budget under the 5 s default shrinks exactly when the machine is busy.
test('no spec or helper sets an assertion or click timeout under the 5 s default', () => {
  const bad = [];
  for (const f of [...specs, 'helpers/app.js']) {
    fs.readFileSync(path.join(E2E, f), 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/\btimeout:\s*(\d+)\b/g)) if (Number(m[1]) < 5000 && !/setTimeout|test\.setTimeout/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, []);
});
