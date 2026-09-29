import { test } from 'node:test';
import assert from 'node:assert/strict';

// docs/adr/0059 — what each aircraft's transponder is sending.
const { Transponders, octalCode } = await import('../src/surveillance/transponder.js');
const { USER_COALITION } = await import('../src/surveillance/iff.js');
const { isSynthetic, CodeAllocator } = await import('../src/efsp/code-allocator.js');

const HOSTILE = USER_COALITION === 3 ? 2 : 3;

function srsWith(entries) {
  return { getTransponder: (name) => entries[name] || null };
}
function air(id, over = {}) {
  return { id, category: 1, coalition: USER_COALITION, player: null, ...over };
}

test('octalCode: the SRS number becomes the 4-digit octal string, and nothing else does', () => {
  assert.equal(octalCode(7700), '7700');
  assert.equal(octalCode(41), '0041');
  assert.equal(octalCode(0), '0000');
  assert.equal(octalCode(89), null, 'an 8 or 9 is not Mode 3/A');
  assert.equal(octalCode(12345), null);
  assert.equal(octalCode(-1), null);
  assert.equal(octalCode(null), null);
});

test('a player squawks what SRS says; no SRS client, or switched off, is no transponder', () => {
  const t = new Transponders({ srs: srsWith({
    Maverick: { squawk: 4521, squawkStatus: 1 },
    Goose: { squawk: 4522, squawkStatus: 0 },
    Iceman: { squawk: 7700, squawkStatus: 2 },
  }) });
  assert.deepEqual(t.transponderOf(air(1, { player: 'Maverick' })), { code: '4521', ident: false, emergency: null });
  assert.equal(t.transponderOf(air(2, { player: 'Goose' })), null, 'switched off');
  assert.equal(t.transponderOf(air(3, { player: 'Viper' })), null, 'no SRS client at all');
  assert.deepEqual(t.transponderOf(air(4, { player: 'Iceman' })), { code: '7700', ident: true, emergency: 'GENERAL' });
});

test('own and neutral AI squawk a stable synthetic code; hostile AI does not squawk', () => {
  const t = new Transponders({ srs: srsWith({}) });
  const a = t.transponderOf(air(10));
  assert.ok(a && isSynthetic(a.code), `${a && a.code} is in the reserved block`);
  assert.equal(t.transponderOf(air(10)).code, a.code, 'the same unit keeps its code');
  assert.ok(isSynthetic(t.transponderOf(air(11, { coalition: 1 })).code), 'neutral squawks');
  assert.equal(t.transponderOf(air(12, { coalition: HOSTILE })), null, 'hostile AI flies with it off');
});

test('synthetic codes are unique, and a released one goes back to the block', () => {
  const t = new Transponders({ srs: null });
  const codes = new Set();
  for (let i = 0; i < 200; i++) codes.add(t.transponderOf(air(`u${i}`)).code);
  assert.equal(codes.size, 200, 'no two live AI share a code');
  const before = t.transponderOf(air('u0')).code;
  const kept = t.transponderOf(air('u1')).code;
  t.retain(new Set(['u1']));
  assert.equal(t.transponderOf(air('u1')).code, kept, 'a live unit keeps its code');
  assert.equal(t._synthetic.has('u0'), false, 'a gone unit gave its code back');
  t.clear();
  assert.equal(t.transponderOf(air('u0')).code, before, 'after a reload the same unit hashes to the same code again');
});

test('ships and ground vehicles have no transponder', () => {
  const t = new Transponders({ srs: null });
  assert.equal(t.transponderOf(air(20, { category: 4 })), null);
  assert.equal(t.transponderOf(air(21, { category: 3 })), null);
});

test('the allocator never hands out, and refuses, a code from the synthetic block', () => {
  const alloc = new CodeAllocator();
  for (let i = 0; i < 0o7000; i++) {
    const r = alloc.allocate(`f${i}`);
    if (r.error) break;
    assert.equal(isSynthetic(r.code), false, `allocated ${r.code}`);
  }
  const refused = new CodeAllocator().validateAssignment('6123', 'f1');
  assert.equal(refused.ok, false);
  assert.match(refused.detail, /uncontrolled/);
});
