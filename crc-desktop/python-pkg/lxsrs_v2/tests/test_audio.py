import struct
import pytest

from lxsrs_v2.audio import NullAudioSink, pcm16_mono_peak, resample_pcm16_mono


def _s16le(samples: list[int]) -> bytes:
    return struct.pack(f"<{len(samples)}h", *samples)


# ---------------------------------------------------------------------------
# NullAudioSink
# ---------------------------------------------------------------------------

def test_null_audio_sink_counts_frames_and_bytes() -> None:
    sink = NullAudioSink()
    sink.play(b"\x00" * 10)
    sink.play(b"\x00" * 20)
    assert sink.frames == 2
    assert sink.bytes == 30


def test_null_audio_sink_initial_state() -> None:
    sink = NullAudioSink()
    assert sink.frames == 0
    assert sink.bytes == 0


# ---------------------------------------------------------------------------
# pcm16_mono_peak
# ---------------------------------------------------------------------------

def test_pcm16_mono_peak_empty_returns_zero() -> None:
    assert pcm16_mono_peak(b"") == 0.0


def test_pcm16_mono_peak_silence_returns_zero() -> None:
    assert pcm16_mono_peak(_s16le([0, 0, 0])) == 0.0


def test_pcm16_mono_peak_full_scale_positive() -> None:
    peak = pcm16_mono_peak(_s16le([32767]))
    assert abs(peak - 32767 / 32768.0) < 1e-5


def test_pcm16_mono_peak_full_scale_negative() -> None:
    peak = pcm16_mono_peak(_s16le([-32768]))
    assert abs(peak - 1.0) < 1e-4


def test_pcm16_mono_peak_returns_max_not_mean() -> None:
    # Mix of small and one large sample — peak must reflect the large one
    peak = pcm16_mono_peak(_s16le([100, 100, 32767, 100]))
    assert peak > 0.9


def test_pcm16_mono_peak_all_same() -> None:
    samples = [1000] * 8
    peak = pcm16_mono_peak(_s16le(samples))
    assert abs(peak - 1000 / 32768.0) < 1e-5


# ---------------------------------------------------------------------------
# resample_pcm16_mono
# ---------------------------------------------------------------------------

def test_resample_same_rate_is_noop() -> None:
    data = _s16le([1000, -1000, 500, -500])
    assert resample_pcm16_mono(data, src_rate=16000, dst_rate=16000) == data


def test_resample_empty_returns_empty() -> None:
    result = resample_pcm16_mono(b"", src_rate=48000, dst_rate=16000)
    assert result == b""


def test_resample_downsample_output_shorter() -> None:
    src_rate, dst_rate = 48000, 16000
    n_src = src_rate // 10  # 0.1 s worth of samples
    data = _s16le([0] * n_src)
    result = resample_pcm16_mono(data, src_rate=src_rate, dst_rate=dst_rate)
    n_dst_expected = dst_rate // 10
    out_samples = len(result) // 2
    assert abs(out_samples - n_dst_expected) <= 2  # allow rounding slop


def test_resample_upsample_output_longer() -> None:
    src_rate, dst_rate = 16000, 48000
    n_src = 160  # 10 ms at 16k
    data = _s16le([1000] * n_src)
    result = resample_pcm16_mono(data, src_rate=src_rate, dst_rate=dst_rate)
    out_samples = len(result) // 2
    n_dst_expected = 480  # 10 ms at 48k
    assert abs(out_samples - n_dst_expected) <= 2


def test_resample_silence_stays_silent() -> None:
    data = _s16le([0] * 480)
    result = resample_pcm16_mono(data, src_rate=48000, dst_rate=16000)
    samples = struct.unpack(f"<{len(result)//2}h", result)
    assert all(s == 0 for s in samples)


def test_resample_output_is_bytes() -> None:
    data = _s16le([100, 200, 300])
    result = resample_pcm16_mono(data, src_rate=48000, dst_rate=16000)
    assert isinstance(result, bytes)


def test_resample_clamps_to_int16_range() -> None:
    # Shouldn't overflow int16 even with edge input
    data = _s16le([32767] * 480)
    result = resample_pcm16_mono(data, src_rate=48000, dst_rate=16000)
    samples = struct.unpack(f"<{len(result)//2}h", result)
    assert all(-32768 <= s <= 32767 for s in samples)


# ---------------------------------------------------------------------------
# VoiceProcessor (transmit chain)
# ---------------------------------------------------------------------------

np = pytest.importorskip("numpy")

from lxsrs_v2.audio import VoiceProcessor  # noqa: E402


def _tone(freq: float, amp: float, n: int = 320, rate: int = 16000):
    t = np.arange(n, dtype=np.float32) / rate
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def _peak(pcm: bytes) -> float:
    return float(np.max(np.abs(np.frombuffer(pcm, dtype=np.int16)))) / 32767.0


def test_voice_processor_passes_quiet_speech_unchanged_at_every_frequency() -> None:
    # No pre-emphasis: a 200 Hz and a 6 kHz tone of the same level come out at the same level.
    for freq in (200.0, 6000.0):
        out = VoiceProcessor().process(_tone(freq, 0.3))
        assert abs(_peak(out) - 0.3) < 0.01, freq


def test_voice_processor_applies_volume() -> None:
    out = VoiceProcessor(volume=0.5).process(_tone(1000.0, 0.4))
    assert abs(_peak(out) - 0.2) < 0.01


def test_voice_processor_limits_hot_input_without_hard_clipping() -> None:
    proc = VoiceProcessor()
    outs = [proc.process(_tone(1000.0, 1.0)) for _ in range(5)]
    for out in outs:
        assert _peak(out) < 0.95
    samples = np.frombuffer(outs[-1], dtype=np.int16)
    assert np.count_nonzero(np.abs(samples) >= 32700) == 0
    assert _peak(outs[-1]) <= VoiceProcessor.LIMIT + 0.01


def test_voice_processor_gain_recovers_after_a_peak() -> None:
    proc = VoiceProcessor()
    proc.process(_tone(1000.0, 1.0))
    first_quiet = _peak(proc.process(_tone(1000.0, 0.3)))
    for _ in range(100):  # 2 s
        last_quiet = _peak(proc.process(_tone(1000.0, 0.3)))
    assert first_quiet < 0.3
    assert abs(last_quiet - 0.3) < 0.01
