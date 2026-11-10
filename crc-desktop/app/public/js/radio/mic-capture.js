// The microphone (ADR 0158 §1, §6; S-RADIO-1 RQ8): getUserMedia with the chosen device and every browser
// processing flag off (automatic gain fights the limiter, echo cancellation clips the start of a call, and a
// controller wears a headset), into its own 48 kHz AudioContext, through mic-worklet.js, which posts 20 ms blocks.
// The engine keeps it open while the radio is connected and drops the blocks unless the key is down, so the first
// word of a call is not lost to opening the device.

import { SAMPLE_RATE, BLOCK_SAMPLES } from './radio-audio-constants.js';
import { MIC_PROCESSOR_NAME } from './mic-worklet.js';

/** Served by the local server's static route; loaded into the worklet scope, never imported here beyond the name. */
export const MIC_WORKLET_URL = '/js/radio/mic-worklet.js';

export function micConstraints(deviceId) {
  return {
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  };
}

/** @param {(block:Float32Array) => void} onBlock */
export function createMicCapture(onBlock) {
  let ctx = null, stream = null, node = null, generation = 0;

  async function stop() {
    generation++;
    if (node) { node.port.onmessage = null; node.disconnect(); node = null; }
    if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
    if (ctx) { const c = ctx; ctx = null; try { await c.close(); } catch { /* already closed */ } }
  }

  return {
    /** (Re)opens the device. @param {string|null} deviceId null for the default @throws what getUserMedia throws */
    async start(deviceId) {
      await stop();
      const mine = ++generation;
      const s = await navigator.mediaDevices.getUserMedia(micConstraints(deviceId));
      if (mine !== generation) { for (const t of s.getTracks()) t.stop(); return; }
      const c = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
      await c.audioWorklet.addModule(MIC_WORKLET_URL);
      if (mine !== generation) { for (const t of s.getTracks()) t.stop(); c.close(); return; }
      const n = new AudioWorkletNode(c, MIC_PROCESSOR_NAME, { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, processorOptions: { blockSamples: BLOCK_SAMPLES } });
      n.port.onmessage = (e) => onBlock(e.data);
      const silent = c.createGain();
      silent.gain.value = 0; // the worklet is pulled only when it leads to the destination
      c.createMediaStreamSource(s).connect(n);
      n.connect(silent); silent.connect(c.destination);
      ctx = c; stream = s; node = n;
    },
    stop,
    isOpen: () => !!node,
  };
}
