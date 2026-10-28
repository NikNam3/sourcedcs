import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { requireServiceToken } = require('../src/service-token.js');
const table = JSON.parse(readFileSync(new URL('./fixtures/service-token-table.json', import.meta.url), 'utf8'));

// The same table runs in sourcedcs-web/test/service-token.test.js; infra/tests keeps both copies identical.
function run(mw, header) {
  const out = { status: null, nexted: false };
  const res = { status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; } };
  mw({ headers: header == null ? {} : { authorization: header } }, res, () => { out.nexted = true; });
  return out;
}

for (const c of table.cases) {
  test(`service token: ${c.name} -> ${c.status}`, () => {
    const out = run(requireServiceToken('test token', () => c.expected), c.header);
    if (c.status === 'next') assert.equal(out.nexted, true);
    else { assert.equal(out.nexted, false); assert.equal(out.status, c.status); }
  });
}

test('service token: read per request, not at creation', () => {
  let tok = '';
  const mw = requireServiceToken('t', () => tok);
  assert.equal(run(mw, 'Bearer x').status, 503);
  tok = 'x';
  assert.equal(run(mw, 'Bearer x').nexted, true);
});
