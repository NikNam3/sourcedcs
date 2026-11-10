// The microphone test (S-RADIO-2 RQ18; lxsrs_v2 client.py test_mic_device): record about 1.5 s of what would go on
// the air (after the limiter), report the peak, and play it back on the output device.

import { SAMPLE_RATE } from './radio-audio-constants.js';

export const MIC_TEST_MS = 1500;

/** @param {Float32Array[]} blocks @returns {number} the largest absolute sample */
export function peakOf(blocks) {
  let p = 0;
  for (const b of blocks) for (let i = 0; i < b.length; i++) { const a = Math.abs(b[i]); if (a > p) p = a; }
  return p;
}

/**
 * @param {(tap:((b:Float32Array) => void)|null) => void} setTap the engine sends every processed block to the tap
 * @param {AudioContext} ctx @param {AudioNode} dest
 * @returns {Promise<{peak:number, blocks:number}>}
 */
export function runMicTest(setTap, ctx, dest, ms = MIC_TEST_MS, st = setTimeout) {
  const blocks = [];
  setTap((b) => blocks.push(b));
  return new Promise((resolve) => st(() => {
    setTap(null);
    const total = blocks.reduce((n, b) => n + b.length, 0);
    if (total) {
      const buf = ctx.createBuffer(1, total, SAMPLE_RATE);
      let at = 0;
      for (const b of blocks) { buf.copyToChannel(b, 0, at); at += b.length; }
      const src = ctx.createBufferSource();
      src.buffer = buf; src.connect(dest); src.start();
    }
    resolve({ peak: peakOf(blocks), blocks: blocks.length });
  }, ms));
}
