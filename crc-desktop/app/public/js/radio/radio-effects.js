// The radio effects as Web Audio nodes (ADR 0158 §1): the receive band-pass, the background noise and the start and
// end tones. A port of lxsrs_v2's effects.py, with the same sound files, copied to /sounds/srs/.
//
// effects.py has no band-pass; it is here because the ADR asks for one. The cutoffs are the SRS receive filter's as
// remembered from its ClientAudioProvider (high-pass 520 Hz, Q 0.97; low-pass 4130 Hz, Q 2.0), not confirmed against
// the source (docs/wip/RADIO-CORE.md).

export const TX_SOUNDS = Object.freeze({
  MIDS: ['MIDS_TX.wav', 'MIDS_TX_END.wav'],
  INTERCOM: ['INTERCOM_TRANS_START.wav', 'INTERCOM_TRANS_END.wav'],
  RADIO_TRANS: ['RADIO_TRANS_START.wav', 'RADIO_TRANS_END.wav'],
  RADIO_TRANS_ALTERNATE: ['RADIO_TRANS_START_ALTERNATE.wav', 'RADIO_TRANS_END_ALTERNATE.wav'],
  RADIO_TRANS_APACHE: ['RADIO_TRANS_START_APACHE.wav', 'RADIO_TRANS_END.wav'],
});
export const SOUND_SETS = Object.freeze(Object.keys(TX_SOUNDS));
export const DEFAULT_SOUND_SET = 'RADIO_TRANS';

/** Background noise per modulation (effects.py `_NOISE_FILES`; intercom is not ported, S-RADIO-2 RQ18). */
export const NOISE_FILES = Object.freeze({ AM: 'UHF_NOISE.wav', FM: 'FM_NOISE.wav' });
/** Noise level, a fraction of full scale (effects.py `_NOISE_VOLUME`). */
export const NOISE_VOLUME = 0.12;

export const BAND_PASS = Object.freeze({ highHz: 520, highQ: 0.97, lowHz: 4130, lowQ: 2.0 });

const SOUND_URL = '/sounds/srs/';

/** @param {BaseAudioContext} ctx @param {(url:string) => Promise<Response>} [fetchFn] */
export function createRadioEffects(ctx, fetchFn = (u) => fetch(u)) {
  const cache = new Map(); // file -> Promise<AudioBuffer|null>
  const load = (file) => {
    if (!cache.has(file)) {
      cache.set(file, fetchFn(SOUND_URL + file)
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${file}: ${r.status}`))))
        .then(b => ctx.decodeAudioData(b))
        .catch(() => null)); // a missing sound is silence, never an error on the radio
    }
    return cache.get(file);
  };

  return {
    /** The receive filter of one radio. @returns {{input:AudioNode, output:AudioNode}} */
    bandPass() {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = BAND_PASS.highHz; hp.Q.value = BAND_PASS.highQ;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = BAND_PASS.lowHz; lp.Q.value = BAND_PASS.lowQ;
      hp.connect(lp);
      return { input: hp, output: lp };
    },

    /** The start or end tone of a sound set, once, into `dest`. */
    async tone(dest, soundSet, which) {
      const files = TX_SOUNDS[soundSet] || TX_SOUNDS[DEFAULT_SOUND_SET];
      const buf = await load(files[which === 'end' ? 1 : 0]);
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(dest);
      src.start();
    },

    /**
     * Loops the modulation's noise into `dest` until the returned stop() is called.
     * @returns {() => void}
     */
    noise(dest, modulation) {
      const file = NOISE_FILES[modulation] || NOISE_FILES.AM;
      const gain = ctx.createGain();
      gain.gain.value = NOISE_VOLUME;
      gain.connect(dest);
      let src = null, stopped = false;
      load(file).then((buf) => {
        if (!buf || stopped) return;
        src = ctx.createBufferSource();
        src.buffer = buf; src.loop = true;
        src.connect(gain);
        src.start();
      });
      return () => {
        stopped = true;
        if (src) { try { src.stop(); } catch { /* not started */ } src.disconnect(); }
        gain.disconnect();
      };
    },

    /** Starts loading every sound now, so the first tone is not late. */
    preload() { for (const f of [...Object.values(TX_SOUNDS).flat(), ...Object.values(NOISE_FILES)]) load(f); },
  };
}
