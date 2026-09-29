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

// docs/adr/0066 — a valid Mode 4/5 reply needs our crypto.
test('mode4Of: an own player answers Mode 4 only with SRS on and the Mode 4 switch on', () => {
  const t = new Transponders({ srs: srsWith({
    On: { squawk: 4521, squawkStatus: 1, mode4: true },
    Off: { squawk: 4522, squawkStatus: 1, mode4: false },
    Dark: { squawk: 4523, squawkStatus: 0, mode4: true },
    Legacy: { squawk: 4524, squawkStatus: undefined, mode4: true },
    Numeric: { squawk: 4525, squawkStatus: 2, mode4: 1 },
  }) });
  assert.equal(t.mode4Of(air(1, { player: 'On' })), true);
  assert.equal(t.mode4Of(air(2, { player: 'Off' })), false, 'Mode 4 switched off');
  assert.equal(t.mode4Of(air(3, { player: 'Dark' })), false, 'transponder off');
  assert.equal(t.mode4Of(air(4, { player: 'Nobody' })), false, 'no SRS client');
  assert.equal(t.mode4Of(air(5, { player: 'Legacy' })), true, 'legacy SRS block: status undefined is on');
  assert.equal(t.mode4Of(air(6, { player: 'Numeric' })), true);
  assert.equal(new Transponders({ srs: null }).mode4Of(air(7, { player: 'On' })), false, 'no SRS at all');
});

test('mode4Of: a hostile or neutral player with every switch on has the wrong keys', () => {
  const t = new Transponders({ srs: srsWith({ Red: { squawk: 1200, squawkStatus: 1, mode4: true } }) });
  assert.equal(t.mode4Of(air(1, { player: 'Red', coalition: HOSTILE })), false);
  assert.equal(t.mode4Of(air(2, { player: 'Red', coalition: 1 })), false);
});

test('mode4Of: own AI aircraft and ships answer (mode4For); neutral, hostile and vehicles do not', () => {
  const t = new Transponders({ srs: null });
  assert.equal(t.mode4Of(air(1)), true, 'own AI aircraft');
  assert.equal(t.mode4Of(air(2, { category: 2 })), true, 'own AI helicopter');
  assert.equal(t.mode4Of(air(3, { coalition: 1 })), false, 'neutral AI');
  assert.equal(t.mode4Of(air(4, { coalition: HOSTILE })), false, 'hostile AI');
  assert.equal(t.mode4Of(air(5, { category: 4 })), true, 'own ship');
  assert.equal(t.mode4Of(air(6, { category: 4, coalition: HOSTILE })), false, 'hostile ship');
  assert.equal(t.mode4Of(air(7, { category: 3 })), false, 'own ground vehicle: no IFF');
  assert.equal(t.mode4Of(null), false);
});

test('mode4Of: mode4For [] takes Mode 4 away from own AI; a class other than own is never honoured', () => {
  assert.equal(new Transponders({ config: { mode4For: [] } }).mode4Of(air(1)), false);
  const t = new Transponders({ config: { mode4For: ['own', 'neutral', 'hostile'] } });
  assert.equal(t.mode4Of(air(2, { coalition: 1 })), false, 'crypto check comes first');
  assert.equal(t.mode4Of(air(3, { coalition: HOSTILE })), false);
});
