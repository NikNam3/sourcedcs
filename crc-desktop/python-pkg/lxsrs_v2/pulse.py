from __future__ import annotations

from ctypes import POINTER, Structure, byref, c_char_p, c_int, c_size_t, c_uint32, c_void_p, cdll
from dataclasses import dataclass
import json
import logging
import math
import queue
import subprocess
import threading


LOG = logging.getLogger(__name__)

PA_STREAM_PLAYBACK = 1
PA_STREAM_RECORD   = 2
PA_SAMPLE_S16LE    = 3


@dataclass
class PulseSink:
    name: str
    driver: str
    sample_spec: str
    state: str
    description: str = ""


@dataclass
class PulseSource:
    name: str
    description: str
    state: str


class _PaSampleSpec(Structure):
    _fields_ = [
        ("format", c_int),
        ("rate", c_uint32),
        ("channels", c_int),
    ]


class _PaBufferAttr(Structure):
    _fields_ = [
        ("maxlength", c_uint32),
        ("tlength",   c_uint32),
        ("prebuf",    c_uint32),
        ("minreq",    c_uint32),
        ("fragsize",  c_uint32),
    ]

_PA_UINT32_MAX = 0xFFFFFFFF  # PA sentinel meaning "use default"


def _load_libpulse_simple():
    lib = cdll.LoadLibrary("libpulse-simple.so.0")
    lib.pa_simple_new.restype = c_void_p
    lib.pa_simple_new.argtypes = [
        c_char_p, c_char_p, c_int, c_char_p, c_char_p,
        POINTER(_PaSampleSpec), c_void_p, c_void_p, POINTER(c_int),
    ]
    lib.pa_simple_write.restype  = c_int
    lib.pa_simple_write.argtypes = [c_void_p, c_void_p, c_size_t, POINTER(c_int)]
    lib.pa_simple_read.restype   = c_int
    lib.pa_simple_read.argtypes  = [c_void_p, c_void_p, c_size_t, POINTER(c_int)]
    lib.pa_simple_drain.restype  = c_int
    lib.pa_simple_drain.argtypes = [c_void_p, POINTER(c_int)]
    lib.pa_simple_free.argtypes  = [c_void_p]
    return lib


class PulseSimplePlayer:
    def __init__(self, sink_name: str | None = None, *, app_name: str = "lxsrs_v2", stream_name: str = "SRS Audio") -> None:
        self._sink_name = sink_name
        self._app_name = app_name.encode("utf-8")
        self._stream_name = stream_name.encode("utf-8")
        self._simple = None
        self._lib_simple = _load_libpulse_simple()
        self._spec = _PaSampleSpec(format=PA_SAMPLE_S16LE, rate=48000, channels=1)

    def set_sink(self, sink_name: str | None) -> None:
        if self._sink_name == sink_name:
            return
        self._sink_name = sink_name
        self.close()

    def write(self, pcm_s16le: bytes) -> None:
        stream = self._ensure_stream()
        error = c_int()
        result = self._lib_simple.pa_simple_write(stream, pcm_s16le, len(pcm_s16le), byref(error))
        if result < 0:
            raise RuntimeError(f"pa_simple_write failed: {error.value}")

    def drain(self) -> None:
        if self._simple is None:
            return
        error = c_int()
        result = self._lib_simple.pa_simple_drain(self._simple, byref(error))
        if result < 0:
            raise RuntimeError(f"pa_simple_drain failed: {error.value}")

    def close(self) -> None:
        if self._simple is not None:
            self._lib_simple.pa_simple_free(self._simple)
            self._simple = None

    def _ensure_stream(self):
        if self._simple is not None:
            return self._simple
        error = c_int()
        device = self._sink_name.encode("utf-8") if self._sink_name else None
        simple = self._lib_simple.pa_simple_new(
            None,
            self._app_name,
            PA_STREAM_PLAYBACK,
            device,
            self._stream_name,
            byref(self._spec),
            None,
            None,
            byref(error),
        )
        if not simple:
            raise RuntimeError(f"pa_simple_new failed for sink {self._sink_name!r}: {error.value}")
        self._simple = simple
        return simple


class PulseSimpleRecorder:
    """Reads raw PCM from a PulseAudio/PipeWire source (microphone).

    pa_simple is not thread-safe, so the entire PA lifecycle (new → read → free)
    runs inside a single dedicated thread.  start() blocks until the connection
    is confirmed or fails.
    """

    def __init__(
        self,
        source_name: str | None = None,
        *,
        samplerate: int = 16000,
        channels: int = 1,
        block_duration_ms: int = 20,
        app_name: str = "lxsrs_v2",
        stream_name: str = "SRS Mic",
    ) -> None:
        self._source_name = source_name
        self._app_name    = app_name.encode("utf-8")
        self._stream_name = stream_name.encode("utf-8")
        self._samplerate  = samplerate
        self._channels    = channels
        self._lib_simple  = _load_libpulse_simple()
        self._spec        = _PaSampleSpec(format=PA_SAMPLE_S16LE, rate=samplerate, channels=channels)
        self._queue: queue.Queue[bytes] = queue.Queue(maxsize=100)
        self._closed      = threading.Event()
        self._thread: threading.Thread | None = None
        # bytes per frame (one Opus frame's worth)
        self._frame_bytes = 2 * channels * (samplerate * block_duration_ms // 1000)
        # startup handshake
        self._ready       = threading.Event()
        self._start_error: Exception | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._read_loop, daemon=True, name="pulse-recorder")
        self._thread.start()
        # Block until the thread signals success or failure (timeout = 5 s)
        if not self._ready.wait(timeout=5.0):
            self._closed.set()
            raise RuntimeError(f"Timed out connecting to PA source {self._source_name!r}")
        if self._start_error is not None:
            raise self._start_error

    def _read_loop(self) -> None:
        import ctypes
        # Create pa_simple HERE, in the same thread that will call pa_simple_read/free.
        error = c_int()
        device = self._source_name.encode("utf-8") if self._source_name else None
        # Request a small fragment size so PA delivers audio one frame at a time
        # rather than accumulating a large buffer (which would cause a 1-4 s
        # startup delay before the first frames arrive).
        buf_attr = _PaBufferAttr(
            maxlength=_PA_UINT32_MAX,
            tlength=_PA_UINT32_MAX,
            prebuf=_PA_UINT32_MAX,
            minreq=_PA_UINT32_MAX,
            fragsize=self._frame_bytes,
        )
        simple = self._lib_simple.pa_simple_new(
            None, self._app_name, PA_STREAM_RECORD, device,
            self._stream_name, byref(self._spec), None, byref(buf_attr), byref(error),
        )
        if not simple:
            self._start_error = RuntimeError(
                f"pa_simple_new (RECORD) failed for source {self._source_name!r}: PA error {error.value}"
            )
            self._ready.set()
            return

        LOG.info("PulseAudio recorder opened source=%r at %d Hz", self._source_name, self._samplerate)
        self._ready.set()  # signal success to start()

        buf = (ctypes.c_char * self._frame_bytes)()
        try:
            while not self._closed.is_set():
                err2 = c_int()
                ret = self._lib_simple.pa_simple_read(simple, buf, self._frame_bytes, byref(err2))
                if ret < 0:
                    if not self._closed.is_set():
                        LOG.error("pa_simple_read failed: %d", err2.value)
                    break
                try:
                    self._queue.put_nowait(bytes(buf))
                except queue.Full:
                    pass  # drop frame; caller is too slow
        finally:
            # Free happens in this thread — safe because no other thread touches simple
            self._lib_simple.pa_simple_free(simple)

    def read(self, timeout: float = 1.0) -> bytes | None:
        if self._closed.is_set():
            return None
        try:
            return self._queue.get(timeout=timeout)
        except queue.Empty:
            return None

    def close(self) -> None:
        self._closed.set()
        if self._thread is not None:
            # _read_loop exits within one frame (~20 ms) and frees pa_simple itself
            self._thread.join(timeout=2.0)
            self._thread = None


def list_pulse_sinks() -> list[PulseSink]:
    try:
        result = subprocess.run(
            ["pactl", "--format=json", "list", "sinks"],
            check=True, capture_output=True, text=True,
        )
        sinks: list[PulseSink] = []
        for entry in json.loads(result.stdout):
            name = entry.get("name", "")
            desc = entry.get("description") or name
            state = entry.get("state", "")
            sinks.append(PulseSink(name=name, driver="", sample_spec="", state=state, description=desc))
        return sinks
    except Exception:
        pass

    # Fallback: short text format (no descriptions)
    try:
        result = subprocess.run(
            ["pactl", "list", "short", "sinks"],
            check=True, capture_output=True, text=True,
        )
    except Exception:
        return []
    sinks = []
    for line in result.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) < 5:
            continue
        sinks.append(PulseSink(name=parts[1], driver=parts[2], sample_spec=parts[3], state=parts[4]))
    return sinks


def list_pulse_sources() -> list[PulseSource]:
    """Return non-monitor PulseAudio/PipeWire input sources with friendly descriptions."""
    try:
        # Try JSON output first (PipeWire pactl supports it)
        result = subprocess.run(
            ["pactl", "--format=json", "list", "sources"],
            check=True, capture_output=True, text=True,
        )
        sources: list[PulseSource] = []
        for entry in json.loads(result.stdout):
            name = entry.get("name", "")
            if name.endswith(".monitor"):
                continue  # skip loopback/monitor sources
            desc  = entry.get("description") or name
            state = entry.get("state", "")
            sources.append(PulseSource(name=name, description=desc, state=state))
        return sources
    except Exception:
        pass

    # Fallback: parse text output of `pactl list sources`
    try:
        result = subprocess.run(
            ["pactl", "list", "sources"],
            check=True, capture_output=True, text=True,
        )
    except Exception:
        LOG.exception("pactl list sources failed")
        return []

    sources = []
    cur_name = cur_desc = cur_state = ""
    for line in result.stdout.splitlines():
        stripped = line.strip()
        if stripped.startswith("Name:"):
            cur_name = stripped.split(":", 1)[1].strip()
        elif stripped.startswith("Description:"):
            cur_desc = stripped.split(":", 1)[1].strip()
        elif stripped.startswith("State:"):
            cur_state = stripped.split(":", 1)[1].strip()
        elif line.startswith("Source #"):
            if cur_name and not cur_name.endswith(".monitor"):
                sources.append(PulseSource(name=cur_name, description=cur_desc or cur_name, state=cur_state))
            cur_name = cur_desc = cur_state = ""
    if cur_name and not cur_name.endswith(".monitor"):
        sources.append(PulseSource(name=cur_name, description=cur_desc or cur_name, state=cur_state))
    return sources


def play_test_tone_on_sink(sink_name: str | None, *, frequency_hz: float = 880.0, duration_s: float = 0.35, samplerate: int = 48000) -> None:
    frame_count = max(1, int(duration_s * samplerate))
    pcm = bytearray()
    fade_frames = max(1, int(0.03 * samplerate))
    for frame in range(frame_count):
        amplitude = 0.2
        if frame < fade_frames:
            amplitude *= frame / fade_frames
        elif frame >= frame_count - fade_frames:
            amplitude *= (frame_count - frame - 1) / fade_frames
        sample = int(32767.0 * amplitude * math.sin(2.0 * math.pi * frequency_hz * frame / samplerate))
        pcm.extend(int(sample).to_bytes(2, byteorder="little", signed=True))
    player = PulseSimplePlayer(sink_name=sink_name, stream_name="Output Test")
    try:
        player.write(bytes(pcm))
        player.drain()
    finally:
        player.close()
