/* flag-writer.js: the paper gestures' SetFlag writes, one per Strip in flight, so quick clicks are not refused
   STALE_REV ("somebody else changed this Strip") when nobody else did. */

import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/client-env.mjs';

import { _resetFlagWriterForTest, effectiveFlag, withWantedFlags, writeFlag } from '../app/public/js/panels/efsp/flag-writer.js';
import { trackHighlightColor } from '../app/public/js/panels/efsp/track-highlight.js';

// A one-Strip server: applies a SetFlag only at the current rev, like crc-sync's StripOps#dispatch.
function harness() {
  const server = { stripId: 's1', rev: 1, flags: { highlight: null, attention: null, offset: false } };
  const local = { s1: structuredClone(server) };
  const sent = [];
  _resetFlagWriterForTest({
    getStrip: (id) => local[id] || null,
    send: (acting, strip, op, { onAck }) => sent.push({ acting, baseRev: strip.rev, op, onAck }),
  });
  /** Answers the oldest unanswered send, as the server would. Returns what onAck returned (true: no banner). */
  function answer() {
    const m = sent.find(x => !x.answered); m.answered = true;
    let ack;
    if (m.baseRev !== server.rev) ack = { ok: false, reason: 'STALE_REV', strip: structuredClone(server) };
    else { server.flags[m.op.flag] = m.op.value; server.rev += 1; ack = { ok: true, strip: structuredClone(server) }; }
    local.s1 = ack.strip; // efsp-state applies the ack's Strip before the continuation runs
    return m.onAck(ack);
  }
  return { server, local, sent, answer };
}

test('two quick highlight clicks: one write in flight, the second sent on the first ack\'s rev', () => {
  const h = harness();
  writeFlag('GC', 's1', 'highlight', 'yellow');
  writeFlag('GC', 's1', 'highlight', 'cyan');
  assert.equal(h.sent.length, 1, 'the second waits for the first ack');
  assert.equal(effectiveFlag(h.local.s1, 'highlight'), 'cyan', 'the next gesture reads what was last asked for');
  h.answer();
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].baseRev, 2);
  assert.deepEqual(h.sent[1].op, { kind: 'SetFlag', flag: 'highlight', value: 'cyan' });
  h.answer();
  assert.equal(h.server.flags.highlight, 'cyan');
  assert.equal(effectiveFlag(h.local.s1, 'highlight'), 'cyan');
});

test('clicks that end where the Strip already is send nothing more', () => {
  const h = harness();
  writeFlag('GC', 's1', 'highlight', 'yellow');
  writeFlag('GC', 's1', 'highlight', null); // cleared again before the first ack
  h.answer(); // yellow lands
  assert.equal(h.sent.length, 2);
  assert.deepEqual(h.sent[1].op.value, null);
  h.answer();
  assert.equal(h.server.flags.highlight, null);
  writeFlag('GC', 's1', 'highlight', null);
  assert.equal(h.sent.length, 2, 'already clear: nothing to send');
});

test('a STALE_REV from a change the controller did not make is retried without a banner', () => {
  const h = harness();
  writeFlag('GC', 's1', 'attention', 'red');
  h.server.rev = 5; // the server touched the Strip meanwhile
  assert.equal(h.answer(), true, 'handled: no refusal banner');
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].baseRev, 5);
  h.answer();
  assert.equal(h.server.flags.attention, 'red');
});

test('a refusal other than STALE_REV drops the wanted value and shows the banner', () => {
  const h = harness();
  writeFlag('GC', 's1', 'offset', true);
  const m = h.sent[0];
  assert.equal(m.onAck({ ok: false, reason: 'NOT_OWNER' }), false);
  assert.equal(effectiveFlag(h.local.s1, 'offset'), false);
  assert.equal(withWantedFlags(h.local.s1), h.local.s1);
});

test('trackHighlightColor: only a Strip this controller works colours the label', () => {
  const mine = { ownerPositionId: 'GC', state: 'TAXI', flags: { highlight: 'lime' } };
  const theirs = { ownerPositionId: 'TWR', state: 'TAXI', flags: { highlight: 'cyan' } };
  assert.equal(trackHighlightColor([theirs, mine], ['GC']), 'lime');
  assert.equal(trackHighlightColor([theirs], ['GC']), null);
  assert.equal(trackHighlightColor([{ ...mine, state: 'DROPPED' }], ['GC']), null);
  assert.equal(trackHighlightColor([{ ...mine, flags: { highlight: null } }], ['GC']), null);
});
