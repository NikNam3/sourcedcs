import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { slot, legacyShape } from './helpers/wire-slots.mjs';

const require = createRequire(import.meta.url);
const { orderSlots, SLOT_ORDER } = require('../src/efsp/wire/slots');

test('orderSlots sends the slots in SLOT_ORDER and names each frame\'s slot without serialising the names', () => {
  const a = { type: 'efsp-board-delta', n: 1 }, b = { type: 'efsp-board-delta', n: 2 }, m = { type: 'efsp-marsa-delta' };
  const out = orderSlots({ sfa: { type: 'efsp-sfa-delta' }, marsa: m, peer: b, primary: a });
  assert.deepEqual(out.map(f => f.type), ['efsp-board-delta', 'efsp-board-delta', 'efsp-marsa-delta', 'efsp-sfa-delta']);
  assert.deepEqual(out.slots, ['primary', 'peer', 'marsa', 'sfa']);
  assert.equal(JSON.stringify(out).includes('slots'), false);
  assert.deepEqual(SLOT_ORDER, ['primary', 'peer', 'marsa', 'carrier', 'sfa']);
  assert.equal(slot({ broadcasts: out }, 'primary'), a);
  assert.equal(slot({ broadcasts: out }, 'peer'), b, 'two board-deltas are told apart by slot, not by type');
  assert.equal(slot({ broadcasts: out }, 'carrier'), undefined);
  assert.deepEqual(Object.keys(legacyShape({ ack: {}, broadcasts: out })).sort(), ['ack', 'broadcast', 'marsaBroadcast', 'peerBroadcast', 'sfaBroadcast']);
});

test('the slot helpers fail loudly on an ambiguous mapping instead of guessing', () => {
  const frames = [{ type: 'efsp-board-delta' }, { type: 'efsp-board-delta' }];
  assert.throws(() => slot({ broadcasts: frames }, 'primary'), /ambiguous/);
  assert.throws(() => legacyShape({ ack: {}, broadcasts: frames }), /ambiguous/);
  assert.throws(() => slot({ ack: {} }, 'primary'), /no broadcasts/);
  assert.throws(() => slot({ broadcasts: [] }, 'bogus'), /unknown slot/);
  assert.equal(slot({ broadcasts: [] }, 'primary'), undefined);
});
