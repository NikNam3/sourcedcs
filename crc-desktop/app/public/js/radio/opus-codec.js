// The WebCodecs Opus encoder and decoder (ADR 0158 §1): 48 kHz mono, 32 kbit/s, 40 ms frames on the air
// (S-RADIO-1 RQ1), `voip`, complexity 10, as lxsrs_v2's client.py. No fallback: when the browser has no Opus the
// engine says so and transmits nothing (ADR 0158 §1).
//
// The WebCodecs classes are passed in (`codecs`), defaulting to the browser's, so a test can give fakes.

import { SAMPLE_RATE, OPUS_FRAME_US, OPUS_BITRATE, OPUS_COMPLEXITY } from './radio-audio-constants.js';

export const ENCODER_CONFIG = Object.freeze({
  codec: 'opus',
  sampleRate: SAMPLE_RATE,
  numberOfChannels: 1,
  bitrate: OPUS_BITRATE,
  opus: Object.freeze({ format: 'opus', frameDuration: OPUS_FRAME_US, complexity: OPUS_COMPLEXITY, application: 'voip' }),
});
export const DECODER_CONFIG = Object.freeze({ codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 1 });

const browserCodecs = () => ({
  AudioEncoder: globalThis.AudioEncoder, AudioDecoder: globalThis.AudioDecoder,
  AudioData: globalThis.AudioData, EncodedAudioChunk: globalThis.EncodedAudioChunk,
});

/** @returns {Promise<boolean>} both directions supported with ENCODER_CONFIG / DECODER_CONFIG */
export async function opusSupported(codecs = browserCodecs()) {
  if (!codecs.AudioEncoder || !codecs.AudioDecoder) return false;
  try {
    const [e, d] = await Promise.all([codecs.AudioEncoder.isConfigSupported(ENCODER_CONFIG), codecs.AudioDecoder.isConfigSupported(DECODER_CONFIG)]);
    return !!(e && e.supported && d && d.supported);
  } catch { return false; }
}

/**
 * One encoder for one transmission: blocks in, Opus frames out.
 * @param {(frame:Uint8Array) => void} onFrame
 * @param {(err:Error) => void} [onError]
 */
export function createOpusEncoder(onFrame, onError = () => {}, codecs = browserCodecs()) {
  const enc = new codecs.AudioEncoder({
    output: (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); onFrame(b); },
    error: onError,
  });
  enc.configure(ENCODER_CONFIG);
  let timestampUs = 0;
  return {
    /** @param {Float32Array} block mono samples at SAMPLE_RATE */
    encode(block) {
      if (enc.state !== 'configured') return;
      const data = new codecs.AudioData({ format: 'f32', sampleRate: SAMPLE_RATE, numberOfFrames: block.length, numberOfChannels: 1, timestamp: timestampUs, data: block });
      timestampUs += Math.round(block.length * 1e6 / SAMPLE_RATE);
      enc.encode(data);
      data.close();
    },
    /** Emits what is buffered, then closes. */
    async finish() {
      if (enc.state !== 'configured') return;
      try { await enc.flush(); } catch { /* closed meanwhile */ }
      if (enc.state !== 'closed') enc.close();
    },
    close() { if (enc.state !== 'closed') enc.close(); },
  };
}

/**
 * One decoder per sender (Opus is stateful). The packet number rides in the chunk timestamp so the output can be
 * placed in its slot.
 * @param {(pcm:Float32Array, packetNumber:number) => void} onPcm
 */
export function createOpusDecoder(onPcm, onError = () => {}, codecs = browserCodecs()) {
  const dec = new codecs.AudioDecoder({
    output: (audio) => {
      const pcm = new Float32Array(audio.numberOfFrames);
      audio.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
      const packetNumber = audio.timestamp;
      audio.close();
      onPcm(pcm, packetNumber);
    },
    error: onError,
  });
  dec.configure(DECODER_CONFIG);
  return {
    decode(opus, packetNumber) {
      if (dec.state !== 'configured' || !opus.byteLength) return;
      dec.decode(new codecs.EncodedAudioChunk({ type: 'key', timestamp: packetNumber, data: opus }));
    },
    close() { if (dec.state !== 'closed') dec.close(); },
  };
}
