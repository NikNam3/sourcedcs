import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { APP_VERSION } from '../src/web/version.ts';

test('APP_VERSION equals package.json version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  assert.equal(APP_VERSION, pkg.version);
});
