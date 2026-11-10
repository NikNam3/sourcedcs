// The transmit chain between the microphone and the Opus encoder: gain, then a peak limiter (pure). A port of
// lxsrs_v2's audio.py VoiceProcessor, whose note is kept here because its intent is the point:
//
// There is no pre-emphasis. A pre-emphasis filter (y[n] = x[n] - 0.97 x[n-1]) only makes sense when the receiver
// undoes it, and no SRS client does: it cut 200 Hz by about 20 dB and lifted 8 kHz by 6 dB, so the voice arrived
// thin, high and harsh, and the lifted sibilance hit full scale and clipped. Opus shapes its own spectrum.
//
// The limiter keeps the peaks under LIMIT instead of hard-clipping them: the gain drops at once when a block would go
// over (ramped across the block, so no click) and recovers slowly, and a soft knee catches what the ramp lets
// through. Speech below the threshold passes unchanged.

export const LIMIT = 0.7;             // about -3 dBFS
export const KNEE = 0.6;              // soft clip starts here, never passes 1.0
export const RELEASE_DB_PER_S = 12.0; // how fast the gain comes back after a peak

/** @param {{volume?:number, blockMs?:number}} [o] */
export function createVoiceProcessor({ volume = 1.0, blockMs = 20 } = {}) {
  let vol = volume;
  let gain = 1.0;
  const release = 10 ** (RELEASE_DB_PER_S * blockMs / 1000 / 20);
  const room = 1.0 - KNEE;
  return {
    setVolume(v) { vol = v; },
    /** @param {Float32Array} samples in [-1, 1] @returns {Float32Array} a new array, in [-1, 1] */
    process(samples) {
      const n = samples.length;
      const x = new Float32Array(n);
      if (!n) return x;
      let peak = 0;
      for (let i = 0; i < n; i++) { x[i] = samples[i] * vol; const a = Math.abs(x[i]); if (a > peak) peak = a; }
      const wanted = peak <= LIMIT ? 1.0 : LIMIT / peak;
      const next = wanted < gain ? wanted : Math.min(wanted, gain * release, 1.0);
      if (gain !== 1.0 || next !== 1.0) {
        // numpy.linspace(gain, next, n): the first sample at `gain`, the last at `next`
        for (let i = 0; i < n; i++) x[i] *= n === 1 ? gain : gain + (next - gain) * (i / (n - 1));
      }
      gain = next;
      for (let i = 0; i < n; i++) {
        const a = Math.abs(x[i]);
        if (a > KNEE) x[i] = Math.sign(x[i]) * (KNEE + room * Math.tanh((a - KNEE) / room));
        if (x[i] > 1) x[i] = 1; else if (x[i] < -1) x[i] = -1;
      }
      return x;
    },
  };
}
