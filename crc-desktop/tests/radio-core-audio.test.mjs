// The browser-facing parts of the built-in radio (app/public/js/radio/), driven with fakes for WebCodecs, Web Audio and
// WebSocket. Real audio is checked by hand on a real SRS server (docs/wip/RADIO-CORE.md, manual test).
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { opusSupported, createOpusEncoder, createOpusDecoder, ENCODER_CONFIG } from '../app/public/js/radio/opus-codec.js';
import { createTxPath } from '../app/public/js/radio/tx-path.js';
import { createRxPath } from '../app/public/js/radio/rx-path.js';
import { pickPlaybackRadio } from '../app/public/js/radio/rx-mixer.js';
import { createSrsSocket } from '../app/public/js/radio/srs-socket.js';
import { encodeFrame } from '../app/public/js/radio/srs-frame.js';
import { setEngineState, subscribeEngineState, getEngineState } from '../app/public/js/radio/radio-engine-state.js';
import { micConstraints } from '../app/public/js/radio/mic-capture.js';
import { peakOf } from '../app/public/js/radio/mic-test.js';

const RADIO = path.join(import.meta.dirname, '../app/public/js/radio');

test('every radio module imports without touching a device, a socket or a window name', async () => {
  for (const f of fs.readdirSync(RADIO).filter(f => f.endsWith('.js'))) await import(path.join(RADIO, f));
  const engine = await import('../app/public/js/radio/radio-engine.js');
  for (const name of ['setRadios', 'setPtt', 'setRadioAudio', 'setDevices', 'onState', 'setAudioOptions', 'testMic', 'setIdentity', 'setIntercomUnit']) {
    assert.equal(typeof engine[name], 'function', name);
  }
});

test('the Opus config is 48 kHz mono, 32 kbit/s, 40 ms frames on the air (S-RADIO-1 RQ1)', () => {
  assert.equal(ENCODER_CONFIG.sampleRate, 48000);
  assert.equal(ENCODER_CONFIG.numberOfChannels, 1);
  assert.equal(ENCODER_CONFIG.bitrate, 32000);
  assert.equal(ENCODER_CONFIG.opus.frameDuration, 40000);
  assert.equal(ENCODER_CONFIG.opus.application, 'voip');
});

test('no WebCodecs, or a refused config, is opusSupported false', async () => {
  assert.equal(await opusSupported({}), false);
  const yes = { isConfigSupported: async () => ({ supported: true }) };
  const no = { isConfigSupported: async () => ({ supported: false }) };
  assert.equal(await opusSupported({ AudioEncoder: yes, AudioDecoder: yes }), true);
  assert.equal(await opusSupported({ AudioEncoder: yes, AudioDecoder: no }), false);
  assert.equal(await opusSupported({ AudioEncoder: { isConfigSupported: async () => { throw new Error('x'); } }, AudioDecoder: yes }), false);
});

function fakeCodecs() {
  const log = [];
  class AudioData { constructor(i) { Object.assign(this, i); } close() { this.closed = true; } }
  class EncodedAudioChunk { constructor(i) { Object.assign(this, i); this.byteLength = i.data.byteLength; } }
  class AudioEncoder {
    constructor(i) { this.i = i; this.state = 'unconfigured'; }
    configure(c) { this.state = 'configured'; log.push(['configure', c.codec]); }
    encode(d) { log.push(['encode', d.numberOfFrames, d.timestamp]); this.i.output({ byteLength: 2, copyTo: (b) => b.set([d.timestamp & 0xff, 1]) }); }
    async flush() { log.push(['flush']); }
    close() { this.state = 'closed'; log.push(['close']); }
  }
  class AudioDecoder {
    constructor(i) { this.i = i; this.state = 'unconfigured'; }
    configure() { this.state = 'configured'; }
    decode(c) { this.i.output({ numberOfFrames: 1920, timestamp: c.timestamp, copyTo: (pcm) => pcm.fill(0.5), close() {} }); }
    close() { this.state = 'closed'; }
  }
  return { log, codecs: { AudioData, EncodedAudioChunk, AudioEncoder, AudioDecoder } };
}

test('the encoder turns blocks into frames with running timestamps; finish flushes then closes', async () => {
  const { log, codecs } = fakeCodecs();
  const frames = [];
  const e = createOpusEncoder((f) => frames.push([...f]), undefined, codecs);
  e.encode(new Float32Array(960)); e.encode(new Float32Array(960));
  await e.finish();
  assert.deepEqual(log, [['configure', 'opus'], ['encode', 960, 0], ['encode', 960, 20000], ['flush'], ['close']]);
  assert.deepEqual(frames, [[0, 1], [32, 1]]);
});

test('the decoder carries the packet number through the timestamp', () => {
  const { codecs } = fakeCodecs();
  const out = [];
  const d = createOpusDecoder((pcm, n) => out.push([pcm.length, n, pcm[0]]), undefined, codecs);
  d.decode(new Uint8Array([1]), 77);
  d.decode(new Uint8Array(0), 78); // empty: nothing to decode
  assert.deepEqual(out, [[1920, 77, 0.5]]);
});

function fakeEffects() {
  const calls = [];
  return { calls, tone: (dest, set, which) => calls.push(['tone', dest, set, which]), noise: (dest, mod) => { calls.push(['noise', dest, mod]); return () => calls.push(['noise-off', dest]); } };
}

test('PTT: one ptt message, frames sent, tones; release flushes before ptt up; repeats are ignored', async () => {
  const sent = [], frames = [];
  const fx = fakeEffects();
  let finished = null;
  const tx = createTxPath({
    socket: { send: (m) => sent.push(m), sendFrame: (f) => frames.push(f) }, effects: fx, dest: 'MASTER',
    options: () => ({ soundSet: 'RADIO_TRANS', noise: true }),
    createEncoder: (onFrame) => ({ encode: (b) => onFrame(b), finish: () => new Promise(r => { finished = r; }), close() {} }),
  });
  tx.block(new Float32Array(1));
  assert.equal(frames.length, 0, 'key up: blocks dropped');
  tx.down(['A', 'B']); tx.down(['A', 'B']);
  assert.deepEqual(sent, [{ type: 'ptt', down: true, radioIds: ['A', 'B'] }]);
  tx.block(new Float32Array(2));
  assert.equal(frames.length, 1);
  tx.up();
  assert.deepEqual(fx.calls.map(c => c[0] + (c[3] ? ':' + c[3] : '')), ['tone:start', 'noise', 'noise-off', 'tone:end']);
  assert.equal(sent.length, 1, 'ptt up waits for the flush');
  finished(); await new Promise(r => setImmediate(r));
  assert.deepEqual(sent[1], { type: 'ptt', down: false });
  tx.down([]);
  assert.equal(tx.isDown(), false, 'nothing to transmit on: no key');
});

test('a quick re-press does not get un-keyed by the first release\'s late flush', async () => {
  const sent = [];
  const finishes = [];
  const tx = createTxPath({
    socket: { send: (m) => sent.push(m), sendFrame() {} }, effects: fakeEffects(), dest: 'M', options: () => ({ soundSet: 'X', noise: false }),
    createEncoder: () => ({ encode() {}, finish: () => new Promise(r => finishes.push(r)), close() {} }),
  });
  tx.down(['A']); tx.up(); tx.down(['A']);
  finishes[0](); await new Promise(r => setImmediate(r));
  assert.deepEqual(sent.map(m => m.down), [true, true]);
});

test('RX: lamps for every matched radio, played once through the loudest unmuted, tones and noise, end after 450 ms', () => {
  const fx = fakeEffects();
  const played = [];
  const audio = { A: { volume: 0.5, muted: false }, B: { volume: 2, muted: false }, C: { volume: 3, muted: true } };
  const mixer = { pick: (ids) => pickPlaybackRadio(ids, (id) => audio[id] || { volume: 1, muted: false }), input: (id) => `in:${id}`, play: (id, pcm, at) => played.push([id, at]) };
  let now = 0, tx = new Set();
  const decoders = [];
  const rx = createRxPath({
    ctx: { currentTime: 10 }, mixer, effects: fx, options: () => ({ soundSet: 'RADIO_TRANS', noise: true }), modulationOf: () => 'AM',
    txRadioIds: () => tx, nowMs: () => now,
    createDecoder: (onPcm) => { const d = { closed: false, decode: (opus, n) => onPcm(new Float32Array(1920), n), close() { d.closed = true; } }; decoders.push(d); return d; },
  });
  rx.receive({ radioIds: ['A', 'B', 'C'], guid: 'G1', packetNumber: 5 }, new Uint8Array([1]));
  assert.deepEqual(rx.rxRadioIds(), ['A', 'B', 'C'], 'the muted radio lights too');
  assert.deepEqual(played, [['B', 10.08]]);
  assert.deepEqual(fx.calls.slice(0, 2), [['tone', 'in:B', 'RADIO_TRANS', 'start'], ['noise', 'in:B', 'AM']]);
  now = 300; rx.receive({ radioIds: ['A', 'B', 'C'], guid: 'G1', packetNumber: 6 }, new Uint8Array([1]));
  assert.equal(decoders.length, 1, 'one decoder per sender');
  now = 760; rx.tick();
  assert.equal(decoders[0].closed, true);
  assert.deepEqual(fx.calls.slice(2), [['tone', 'in:B', 'RADIO_TRANS', 'end'], ['noise-off', 'in:B']]);
  tx = new Set(['A']);
  rx.receive({ radioIds: ['A', 'B'], guid: 'G2', packetNumber: 1 }, new Uint8Array([1]));
  assert.equal(decoders.length, 1, 'a radio that is transmitting does not play');
  tx = new Set();
  rx.receive({ radioIds: ['C'], guid: 'G3', packetNumber: 1 }, new Uint8Array([1]));
  assert.equal(decoders.length, 1, 'every matched radio muted: not played');
  assert.ok(rx.rxRadioIds().includes('C'));
});

test('the /srs socket parses text and frames, says hello on every open, and reconnects', () => {
  const made = [], waits = [];
  class WS { constructor(url) { this.url = url; this.readyState = 0; this.out = []; made.push(this); } send(d) { this.out.push(d); } close() { this.readyState = 3; this.onclose(); } }
  const got = { open: 0, msgs: [], frames: [] };
  const s = createSrsSocket({ url: 'ws://localhost:3100/srs', WebSocket: WS, setTimeout: (fn, ms) => waits.push([fn, ms]),
    onOpen: () => got.open++, onMessage: (m) => got.msgs.push(m), onFrame: (f) => got.frames.push(f) });
  s.open();
  s.send({ type: 'x' });
  assert.equal(made[0].out.length, 0, 'not open yet: nothing sent');
  made[0].readyState = 1; made[0].onopen();
  s.send({ type: 'hello' }); s.sendFrame(new Uint8Array([1, 2]));
  assert.equal(made[0].out[0], '{"type":"hello"}');
  assert.ok(made[0].out[1] instanceof ArrayBuffer);
  made[0].onmessage({ data: '{"type":"state","connected":true}' });
  made[0].onmessage({ data: encodeFrame({ radioIds: ['A'] }, new Uint8Array([9])) });
  made[0].onmessage({ data: 'not json' });
  assert.deepEqual(got.msgs, [{ type: 'state', connected: true }]);
  assert.deepEqual(got.frames[0].header, { radioIds: ['A'] });
  made[0].readyState = 3; made[0].onclose();
  assert.equal(waits[0][1], 500);
  waits[0][0]();
  made[1].readyState = 1; made[1].onopen();
  assert.equal(got.open, 2);
  s.close();
  assert.equal(waits.length, 1, 'closed on purpose: no reconnect');
});

test('engine state: listeners get the whole state once per real change', () => {
  const seen = [];
  const off = subscribeEngineState((s) => seen.push(s.rxRadioIds));
  setEngineState({ rxRadioIds: ['A'] });
  setEngineState({ rxRadioIds: ['A'] });
  setEngineState({ nonsense: 1 });
  off();
  setEngineState({ rxRadioIds: [] });
  assert.deepEqual(seen, [[], ['A']]);
  assert.deepEqual(getEngineState().rxRadioIds, []);
});

test('mic constraints turn every browser processing flag off and pin the device', () => {
  assert.deepEqual(micConstraints('dev1').audio, { deviceId: { exact: 'dev1' }, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false });
  assert.equal(micConstraints(null).audio.deviceId, undefined);
  assert.equal(peakOf([Float32Array.from([0.1, -0.7]), Float32Array.from([0.3])]), Math.fround(0.7));
});

test('the packet number survives a decoder that restates timestamps (Chromium), and a failed decoder is replaced', () => {
  const decoders = [];
  class AudioDecoder {
    constructor({ output, error }) { this.output = output; this.error = error; this.state = 'unconfigured'; this.n = 0; decoders.push(this); }
    configure() { this.state = 'configured'; }
    decode(chunk) {
      if (chunk.data[0] === 0xff) { this.state = 'closed'; this.error(new Error('corrupt')); return; }
      // Chromium-like: the output timestamp is the first input's plus the decoded duration, not the input's own
      const ts = this.n++ * 40000;
      this.output({ numberOfFrames: 1920, timestamp: ts, copyTo: (dst) => dst.fill(0.25), close() {} });
    }
    close() { this.state = 'closed'; }
  }
  class EncodedAudioChunk { constructor(o) { Object.assign(this, o); } }
  const out = [];
  const d = createOpusDecoder((pcm, n) => out.push(n), undefined, { AudioDecoder, EncodedAudioChunk });
  d.decode(new Uint8Array([1]), 500);
  d.decode(new Uint8Array([1]), 502); // 501 lost
  d.decode(new Uint8Array([0xff]), 503); // corrupt: the decoder closes
  d.decode(new Uint8Array([1]), 504);
  assert.deepEqual(out, [500, 502, 504]);
  assert.equal(decoders.length, 2, 'replaced after the failure');
});
