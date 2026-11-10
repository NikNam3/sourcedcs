// The receive side of the Web Audio graph (ADR 0158 §1, §6): per radio, the voice at the radio's volume and the radio's
// own sounds at a fixed level, both through its pan into one master gain and the output device. It replaces lxsrs_v2's
// OptionalOpusPlaybackSink mixing thread: the graph mixes.
//
//   frame source ───────────────> voice gain (volume, 0 when muted) ─┐
//   tone, noise ─> band-pass ───> sound gain (1, 0 when muted) ──────┴─> pan ─> master (output gain) ─> destination
//
// The volume is the voice's alone, as in lxsrs_v2 (its noise was its own stream at a fixed level): turning a radio up
// makes the pilot louder, not the static. The voice is played as decoded, unfiltered, as lxsrs_v2 played it.

import { SAMPLE_RATE } from './radio-audio-constants.js';

const DEFAULT_AUDIO = Object.freeze({ volume: 1, pan: 0, muted: false });

/**
 * The radio a packet heard on several radios plays through: the loudest unmuted one, once (S-RADIO-1 RQ6). Null when
 * every one is muted. Pure.
 * @param {string[]} radioIds @param {(id:string) => {volume:number, muted:boolean}} audioOf
 */
export function pickPlaybackRadio(radioIds, audioOf) {
  let best = null, loudest = -1;
  for (const id of radioIds) {
    const a = audioOf(id);
    if (a.muted || a.volume <= 0) continue;
    if (a.volume > loudest) { best = id; loudest = a.volume; }
  }
  return best;
}

/** @param {AudioContext} ctx @param {{bandPass:() => {input:AudioNode, output:AudioNode}}} effects */
export function createRxMixer(ctx, effects) {
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const audio = new Map(); // radioId -> {volume, pan, muted}
  const chains = new Map(); // radioId -> {filter, gain, pan}

  const audioOf = (id) => audio.get(id) || DEFAULT_AUDIO;
  const apply = (id) => {
    const c = chains.get(id);
    if (!c) return;
    const a = audioOf(id);
    c.voice.gain.value = a.muted ? 0 : a.volume;
    c.sound.gain.value = a.muted ? 0 : 1;
    c.pan.pan.value = Math.max(-1, Math.min(1, a.pan));
  };
  const chain = (id) => {
    if (!chains.has(id)) {
      const filter = effects.bandPass();
      const voice = ctx.createGain();
      const sound = ctx.createGain();
      const pan = ctx.createStereoPanner();
      voice.connect(pan);
      filter.output.connect(sound); sound.connect(pan);
      pan.connect(master);
      chains.set(id, { filter, voice, sound, pan });
      apply(id);
    }
    return chains.get(id);
  };

  return {
    audioOf,
    pick: (radioIds) => pickPlaybackRadio(radioIds, audioOf),
    setChannelAudio(id, a) { audio.set(id, { ...audioOf(id), ...a }); apply(id); },
    setOutputGain(g) { master.gain.value = g; },
    /** Where a radio's own sounds (its tones and noise) go in: before its filter, gain and pan. */
    input: (id) => chain(id).filter.input,
    /** Where sounds that belong to no radio go (our own transmit tones). */
    master,
    /** @param {Float32Array} pcm @param {number} at context time */
    play(id, pcm, at) {
      const buf = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
      buf.copyToChannel(pcm, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(chain(id).voice);
      src.start(at);
    },
    /** Drops the chains of radios that are gone. */
    keepOnly(ids) {
      const keep = new Set(ids);
      for (const [id, c] of chains) {
        if (keep.has(id)) continue;
        c.filter.output.disconnect(); c.voice.disconnect(); c.sound.disconnect(); c.pan.disconnect();
        chains.delete(id);
      }
    },
  };
}
