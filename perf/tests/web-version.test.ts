import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { APP_VERSION, versionLine } from '../src/web/version.ts';

test('APP_VERSION equals package.json version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  assert.equal(APP_VERSION, pkg.version);
});

test('the footer line: data version, app version and the date; unknown data when it did not load', () => {
  const date = new Date(2026, 10, 12);
  assert.equal(versionLine(3, date), `Data version 3 · App version ${APP_VERSION} · 12 Nov 2026`);
  assert.equal(versionLine(null, date), `Data version unknown · App version ${APP_VERSION} · 12 Nov 2026`);
});
