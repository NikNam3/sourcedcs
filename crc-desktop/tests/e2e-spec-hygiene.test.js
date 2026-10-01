'use strict';

// Every Playwright spec must import test/expect from ./helpers/test. That module is what serves the
// CDN scripts from node_modules and what gives each spec file a fresh crc-sync (the reset hook);
// a spec that requires '@playwright/test' directly silently gets neither and depends on whatever
// ran before it (docs/wip/E2EH.md). A new spec that forgets fails here, in `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

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
