// The /srs binary frame: the Node copy (app/srs/srs-frame.js) and the renderer copy (app/public/js/radio/srs-frame.js)
// read each other's frames.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as web from '../app/public/js/radio/srs-frame.js';

const node = createRequire(import.meta.url)('../app/srs/srs-frame.js');
const header = { radioIds: ['GUARD:UHF', 'POSITION:x:UHF'], guid: 'g'.repeat(22), originalGuid: 'o'.repeat(22), packetNumber: 42, retransmissionCount: 0 };
const opus = new Uint8Array([0xfc, 0xff, 0xfe, 0, 1, 2]);

test('a frame the server writes, the renderer reads', () => {
  const out = web.decodeFrame(new Uint8Array(node.encodeFrame(header, opus)).buffer);
  assert.deepEqual(out.header, header);
  assert.deepEqual([...out.opus], [...opus]);
});

test('a frame the renderer writes, the server reads; the bytes are the same', () => {
  const buf = web.encodeFrame({}, opus);
  const out = node.decodeFrame(Buffer.from(buf));
  assert.deepEqual(out.header, {});
  assert.deepEqual([...out.opus], [...opus]);
  assert.deepEqual([...new Uint8Array(web.encodeFrame(header, opus))], [...node.encodeFrame(header, opus)]);
});

test('short or truncated frames are refused on both sides', () => {
  assert.throws(() => node.decodeFrame(Buffer.from([1])), /short/);
  assert.throws(() => web.decodeFrame(new Uint8Array([9, 0, 1]).buffer), /truncated/);
});
