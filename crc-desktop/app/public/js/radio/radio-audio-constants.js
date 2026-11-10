// The audio numbers of the built-in SRS client (leaf; ADR 0158 §1, corrected by S-RADIO-1 RQ1, RQ7).

/** Everything runs at 48 kHz mono: the AudioContexts are opened at it, so Chromium resamples any device. */
export const SAMPLE_RATE = 48000;
/** The worklet's block: 20 ms. */
export const BLOCK_SAMPLES = 960;
export const BLOCK_MS = 20;
/**
 * Opus frames on the air are 40 ms, as lxsrs_v2's client.py and SRS itself (Common/Constants.cs
 * MIC_INPUT_AUDIO_LENGTH_MS = 40): SRS's receive jitter buffer reads 40 ms at a time. ADR 0158 §1's "20 ms" is the
 * worklet block, not the packet (S-RADIO-1 RQ1). The encoder joins two blocks into one frame.
 */
export const OPUS_FRAME_US = 40_000;
export const OPUS_BITRATE = 32_000;
export const OPUS_COMPLEXITY = 10;
/** A sender silent this long has ended its transmission (client.py `RX_TIMEOUT`). */
export const RX_TIMEOUT_MS = 450;
/** A transmission starts playing this long after its first frame arrives: two 40 ms frames (S-RADIO-1 RQ7). */
export const PLAYOUT_DELAY_MS = 80;
/** Further behind (or ahead) of the clock than this, a stream restarts instead of drifting (RQ7). */
export const MAX_DRIFT_MS = 200;
/** lxsrs_v2's default input gain (`__main__.py` --input-volume 0.5). */
export const DEFAULT_INPUT_GAIN = 0.5;
export const DEFAULT_OUTPUT_GAIN = 1.0;
export const GAIN_MAX = 5.0;
