// The pure parts of the built-in radio's renderer half (app/public/js/radio/, ADR 0158 step 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createVoiceProcessor } from '../app/public/js/radio/voice-processor.js';
import { createFrameCutter, MIC_PROCESSOR_NAME } from '../app/public/js/radio/mic-worklet.js';
import { createPlayoutSchedule } from '../app/public/js/radio/playout-schedule.js';
import { txRadioIdsFor } from '../app/public/js/radio/tx-group.js';
import { pickDevice } from '../app/public/js/radio/device-pick.js';
import { createRxActivity } from '../app/public/js/radio/rx-activity.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/srs/voice-processor-fixture.json', import.meta.url)));

test('the transmit gain and limiter match lxsrs_v2 audio.py VoiceProcessor, block by block', () => {
  const vp = createVoiceProcessor({ volume: fixture.volume, blockMs: fixture.blockMs });
  fixture.in.forEach((block, k) => {
    // Python ran in float32 and truncated to s16; allow one step of rounding difference.
    const out = vp.process(Float32Array.from(block));
    const want = fixture.outS16[k];
    let worst = 0;
    for (let i = 0; i < out.length; i++) worst = Math.max(worst, Math.abs(Math.trunc(out[i] * 32767) - want[i]));
    assert.ok(worst <= 2, `block ${k}: off by ${worst}`);
    assert.ok(out.every(v => v >= -1 && v <= 1));
  });
});

test('the limiter keeps a loud block under full scale and lets quiet speech through unchanged', () => {
  const vp = createVoiceProcessor({ volume: 1 });
  const quiet = Float32Array.from({ length: 960 }, (_, i) => 0.3 * Math.sin(i / 10));
  assert.deepEqual([...vp.process(quiet)], [...quiet]);
  const loud = vp.process(Float32Array.from({ length: 960 }, (_, i) => 2 * Math.sin(i / 10)));
  assert.ok(Math.max(...loud.map(Math.abs)) < 1);
});

test('the worklet cutter makes fixed blocks out of 128-sample quanta', () => {
  assert.equal(MIC_PROCESSOR_NAME, 'crc-srs-mic');
  const c = createFrameCutter(960);
  let blocks = [];
  for (let q = 0; q < 16; q++) blocks = blocks.concat(c.push(Float32Array.from({ length: 128 }, (_, i) => q * 128 + i)));
  assert.equal(blocks.length, 2); // 2048 samples
  assert.equal(blocks[0][0], 0); assert.equal(blocks[0][959], 959);
  assert.equal(blocks[1][0], 960); assert.equal(blocks[1][959], 1919);
  assert.notEqual(blocks[0].buffer, blocks[1].buffer, 'each block owns its buffer (it is transferred)');
});

test('playout: a stream starts 80 ms late and plays back to back; reorder, loss and lateness', () => {
  const s = createPlayoutSchedule();
  const d = 0.04;
  assert.equal(s.place(10, d, 1.0), 1.08);
  assert.ok(Math.abs(s.place(12, d, 1.03) - 1.16) < 1e-9, 'packet 12 arrives before 11: it waits for its slot');
  assert.ok(Math.abs(s.place(11, d, 1.05) - 1.12) < 1e-9, '11 lands in its place');
  assert.ok(Math.abs(s.place(14, d, 1.10) - 1.24) < 1e-9, '13 lost: silence in its slot');
  assert.equal(s.place(13, d, 1.21), null, '13 after its slot is dropped');
});

test('playout: a gap of 450 ms is a new transmission; drifting 200 ms behind restarts', () => {
  const s = createPlayoutSchedule();
  s.place(1, 0.04, 0);
  assert.equal(s.ended(0.3), false);
  assert.equal(s.ended(0.5), true);
  assert.ok(Math.abs(s.place(500, 0.04, 0.5) - 0.58) < 1e-9, 'after the gap, restarted');
  // the network stalls, then delivers late: 0.5 s behind its slot
  assert.ok(Math.abs(s.place(510, 0.04, 1.4) - 1.48) < 1e-9, 'too far behind: restarted at this frame');
  assert.ok(Math.abs(s.place(5000, 0.04, 1.42) - 1.50) < 1e-9, 'a wild jump ahead also restarts');
});

test('a press transmits on the pressed radio\'s group, or on it alone; never on a receive-only radio', () => {
  const radios = [
    { id: 'P1U', groupId: 'auto' }, { id: 'P1V', groupId: 'auto' }, { id: 'OBS', groupId: 'auto', receiveOnly: true },
    { id: 'GU', groupId: null }, { id: 'OBS2', groupId: null, receiveOnly: true },
  ];
  assert.deepEqual(txRadioIdsFor(radios, 'P1V'), ['P1U', 'P1V']);
  assert.deepEqual(txRadioIdsFor(radios, 'GU'), ['GU']);
  assert.deepEqual(txRadioIdsFor(radios, 'OBS2'), []);
  assert.deepEqual(txRadioIdsFor(radios, 'OBS'), []);
  assert.deepEqual(txRadioIdsFor(radios, 'nope'), []);
  const withIc = [...radios, { id: 'IC', modulation: 'INTERCOM', groupId: 'auto' }];
  assert.deepEqual(txRadioIdsFor(withIc, 'P1U'), ['P1U', 'P1V'], 'the intercom never rides with a group (H183)');
  assert.deepEqual(txRadioIdsFor(withIc, 'IC'), ['IC']);
});

test('a device is picked by id, then by label, else the default with a note', () => {
  const devs = [{ kind: 'audioinput', deviceId: 'a1', label: 'Headset' }, { kind: 'audiooutput', deviceId: 'o1', label: 'Headset' }];
  assert.deepEqual(pickDevice(devs, 'audioinput', { id: 'a1' }), { deviceId: 'a1', note: null });
  assert.deepEqual(pickDevice(devs, 'audioinput', { id: 'old', label: 'Headset' }), { deviceId: 'a1', note: null });
  assert.deepEqual(pickDevice(devs, 'audiooutput', { id: 'a1', label: 'Gone' }), { deviceId: null, note: 'saved speaker not present' });
  assert.deepEqual(pickDevice(devs, 'audioinput', { id: null }), { deviceId: null, note: null });
});

test('a radio is receiving for 450 ms after its last packet', () => {
  const a = createRxActivity();
  a.heard(['A', 'B'], 0); a.heard(['B'], 300);
  assert.deepEqual(a.active(400), ['A', 'B']);
  assert.deepEqual(a.active(500), ['B']);
  assert.deepEqual(a.active(800), []);
});
