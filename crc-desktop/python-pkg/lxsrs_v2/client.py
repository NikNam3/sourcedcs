from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import json
import logging
from pathlib import Path
import socket
import sys
import threading
import time
import uuid
from typing import Any

from .audio import AudioDevice, AudioSink, MicrophoneCapture, NullAudioSink, OptionalOpusPlaybackSink, PulseMicrophoneCapture, list_audio_devices, pcm16_mono_peak, resample_pcm16_mono
from .effects import AudioEffects, TX_SOUND_SETS
from .models import Client, MessageType, Modulation, PlayerRadioInfo, default_radio_info, make_radio
from .protocol import GUID_LENGTH, VoicePacket, decode_network_message, encode_network_message
from .pulse import PulseSink, PulseSource, PulseSimplePlayer, list_pulse_sinks, list_pulse_sources, play_test_tone_on_sink
from .ui import CursesUI, RadioRow


LOG = logging.getLogger(__name__)
DEFAULT_VERSION = "2.3.3.3"
UDP_PING_INTERVAL = 15.0
MIC_SAMPLE_RATE = 16000
MIC_FRAME_MS = 20
# The web UI re-sends /api/ptt/start every 400 ms while the key is held. If none arrives for this long (renderer crashed,
# window lost, network between them cut) the radio is un-keyed here, so a stuck client can never hold the frequency open.
PTT_KEEPALIVE_TIMEOUT_S = 1.5


def make_srs_guid() -> str:
    return str(uuid.uuid4()).replace("-", "")[:GUID_LENGTH]


@dataclass
class SRSClient:
    host: str
    port: int
    name: str
    frequencies_mhz: list[float]
    coalition: int = 0
    unit_id: int = 0
    version: str = DEFAULT_VERSION
    guid: str = field(default_factory=make_srs_guid)
    tx_frequency_mhz: float | None = None
    mic_source: str | None = None   # PulseAudio source name; None = default
    speaker_sink: str | None = None
    input_volume: float = 1.0
    output_volume: float = 1.0
    ptt_mode: str = "stdin"
    ui_enabled: bool = False
    sound_set: str = "RADIO_TRANS"
    noise_enabled: bool = True
    tcp_writer: asyncio.StreamWriter | None = field(init=False, default=None)
    _effects: AudioEffects | None = field(init=False, default=None)
    audio_sink: AudioSink = field(init=False, default_factory=NullAudioSink)
    _packet_number: int = field(init=False, default=0)
    _clients: dict[str, dict[str, Any]] = field(init=False, default_factory=dict)
    _voice_protocol: "VoiceProtocol | None" = field(init=False, default=None)
    _ptt_active: threading.Event = field(init=False, default_factory=threading.Event)
    _ptt_heartbeat_at: float = field(init=False, default=0.0)  # monotonic time of last web PTT heartbeat
    _stop_threads: threading.Event = field(init=False, default_factory=threading.Event)
    _state_lock: threading.RLock = field(init=False, default_factory=threading.RLock)
    _radio_info: PlayerRadioInfo = field(init=False)
    _tx_slot: int = field(init=False, default=0)
    _radio_volumes: list[float] = field(init=False, default_factory=list)  # per-slot output volume multiplier
    _loop: asyncio.AbstractEventLoop | None = field(init=False, default=None)
    _device_generation: int = field(init=False, default=0)
    _status_message: str = field(init=False, default="Ready")
    _remote_active: dict[str, float] = field(init=False, default_factory=dict)  # guid → last-seen monotonic
    _rx_freqs: dict[int, float] = field(init=False, default_factory=dict)       # freq_hz → last-seen monotonic
    _rx_lock: threading.Lock = field(init=False, default_factory=threading.Lock)

    @property
    def guid_bytes(self) -> bytes:
        return self.guid.encode("ascii")

    @property
    def stop_requested(self) -> bool:
        return self._stop_threads.is_set()

    def __post_init__(self) -> None:
        frequencies_hz = [freq * 1_000_000 for freq in self.frequencies_mhz]
        self._radio_info = default_radio_info(frequencies_hz, Modulation.AM)
        self._radio_info.unit = self.name
        # unitId must be > 0 for intercom routing.
        # Use a fixed shared value so all lxsrs_v2 clients land on the same intercom group.
        if self.unit_id == 0:
            self.unit_id = 1
        self._radio_info.unitId = self.unit_id
        n = len(self._radio_info.radios)
        self._radio_volumes = [1.0] * n
        if self.tx_frequency_mhz is not None:
            self._set_tx_slot_from_frequency(self.tx_frequency_mhz)
        self._load_state()
        effects_dir = Path(__file__).parent / "AudioEffects"
        if effects_dir.exists():
            self._effects = AudioEffects(effects_dir, sink_name=self.speaker_sink)

    def build_client_state(self) -> Client:
        with self._state_lock:
            radio_info = PlayerRadioInfo(
                ambient=self._radio_info.ambient,
                iff=self._radio_info.iff,
                radios=[radio for radio in self._radio_info.radios],
                unit=self._radio_info.unit,
                unitId=self._radio_info.unitId,
                selected=self._tx_slot,
            )
        return Client(
            ClientGuid=self.guid,
            Name=self.name,
            Coalition=self.coalition,
            RadioInfo=radio_info,
        )

    async def connect(self, *, play_audio: bool = False) -> None:
        self._loop = asyncio.get_running_loop()
        if play_audio:
            self.audio_sink = OptionalOpusPlaybackSink(sink_name=self.speaker_sink, volume=self.output_volume)

        reader, writer = await asyncio.open_connection(self.host, self.port)
        self.tcp_writer = writer
        await self._send(MessageType.SYNC)

        udp_transport, udp_protocol = await self._open_udp()
        self._voice_protocol = udp_protocol
        tasks = [
            asyncio.create_task(self._tcp_loop(reader)),
            asyncio.create_task(self._udp_keepalive_loop(udp_protocol)),
        ]
        tasks.append(asyncio.create_task(asyncio.to_thread(self._run_transmit_loop)))
        tasks.append(asyncio.create_task(asyncio.to_thread(self._run_rx_monitor)))
        if self.ptt_mode != "ui":
            tasks.append(asyncio.create_task(asyncio.to_thread(self._run_ptt_controller)))
        if self.ui_enabled:
            tasks.append(asyncio.create_task(asyncio.to_thread(self._run_ui)))
        try:
            await asyncio.gather(*tasks)
        finally:
            self._stop_threads.set()
            if self._effects:
                self._effects.stop_noise()
            udp_transport.close()
            writer.close()
            await writer.wait_closed()

    async def _send(self, msg_type: MessageType) -> None:
        if self.tcp_writer is None:
            raise RuntimeError("tcp not connected")
        payload = encode_network_message(msg_type, self.build_client_state(), self.version)
        self.tcp_writer.write(payload)
        await self.tcp_writer.drain()
        LOG.debug("sent %s", msg_type.name)

    async def _tcp_loop(self, reader: asyncio.StreamReader) -> None:
        while not self._stop_threads.is_set():
            line = await reader.readline()
            if not line:
                LOG.info("tcp disconnected")
                return
            message = decode_network_message(line)
            self._handle_tcp_message(message)

    def _handle_tcp_message(self, message: dict[str, Any]) -> None:
        msg_type = MessageType(message.get("MsgType", 0))
        if msg_type in (MessageType.UPDATE, MessageType.RADIO_UPDATE, MessageType.SYNC):
            client = message.get("Client")
            if client and client.get("ClientGuid"):
                self._clients[client["ClientGuid"]] = client
                LOG.info(
                    "client=%s type=%s radios=%s",
                    client.get("Name", "---"),
                    msg_type.name,
                    _summarize_radios(client.get("RadioInfo")),
                )
            for extra in message.get("Clients") or []:
                guid = extra.get("ClientGuid")
                if guid:
                    self._clients[guid] = extra
        elif msg_type == MessageType.CLIENT_DISCONNECT:
            client = message.get("Client") or {}
            guid = client.get("ClientGuid")
            if guid:
                self._clients.pop(guid, None)
            LOG.info("client disconnected: %s", client.get("Name", guid))
        elif msg_type == MessageType.SERVER_SETTINGS:
            LOG.info("server settings updated")
        elif msg_type == MessageType.VERSION_MISMATCH:
            LOG.warning("server reported version mismatch")
        else:
            LOG.debug("message: %s", message)

    async def _open_udp(self) -> tuple[asyncio.DatagramTransport, "VoiceProtocol"]:
        loop = asyncio.get_running_loop()
        transport, protocol = await loop.create_datagram_endpoint(
            lambda: VoiceProtocol(self),
            remote_addr=(self.host, self.port),
            family=socket.AF_INET,
        )
        transport.sendto(self.guid_bytes)
        return transport, protocol

    async def _udp_keepalive_loop(self, protocol: "VoiceProtocol") -> None:
        while not self._stop_threads.is_set():
            await asyncio.sleep(UDP_PING_INTERVAL)
            if not self._stop_threads.is_set():
                protocol.transport.sendto(self.guid_bytes)

    def on_voice_packet(self, packet: VoicePacket) -> None:
        guid = packet.client_guid.decode("ascii", errors="replace")
        now  = time.monotonic()
        with self._rx_lock:
            is_new = guid not in self._remote_active
            self._remote_active[guid] = now
            for freq_hz in packet.frequencies:
                self._rx_freqs[int(freq_hz)] = now
        if is_new:
            if self._effects:
                self._effects.play_tx_start(self.sound_set)
            self._update_noise()
        radio_vol = self._get_radio_volume(packet.frequencies[0]) if packet.frequencies else 1.0
        self.audio_sink.play(packet.audio_part1, volume=radio_vol, sender_id=guid)
        LOG.info(
            "voice from=%s tx=%s freqs=%s bytes=%d packet=%d",
            packet.client_guid.decode("ascii", errors="replace"),
            packet.transmission_guid.decode("ascii", errors="replace"),
            ",".join(f"{freq / 1_000_000:.3f}" for freq in packet.frequencies),
            len(packet.audio_part1),
            packet.packet_number,
        )

    def transmit_ptt_down(self) -> None:
        self._ptt_heartbeat_at = time.monotonic()
        if not self._ptt_active.is_set():
            self._ptt_active.set()
            _tx_hz = self._get_tx_frequency_hz()
            if _tx_hz < 10000:
                LOG.info("tx start freq=%.0f Hz (intercom)", _tx_hz)
            else:
                LOG.info("tx start freq=%.3f MHz", _tx_hz / 1_000_000)

    def transmit_ptt_up(self) -> None:
        if self._ptt_active.is_set():
            self._ptt_active.clear()
            LOG.info("tx stop")

    def ptt_watchdog_tick(self, now: float | None = None) -> bool:
        """Stop transmitting if the web PTT keepalive went stale. Returns True when it released the key.

        Run on every transmit-loop pass (even while the mic is unavailable) and on every state read, so it does not depend
        on audio flowing. A key never raised through transmit_ptt_down has no heartbeat and is left alone."""
        if not self._ptt_active.is_set() or self._ptt_heartbeat_at <= 0:
            return False
        if (time.monotonic() if now is None else now) - self._ptt_heartbeat_at <= PTT_KEEPALIVE_TIMEOUT_S:
            return False
        LOG.warning("ptt keepalive lost for more than %.1f s, releasing transmit", PTT_KEEPALIVE_TIMEOUT_S)
        self.transmit_ptt_up()
        return True

    def _get_tx_frequency_hz(self) -> float:
        with self._state_lock:
            return self._radio_info.radios[self._tx_slot].freq

    def _next_packet_number(self) -> int:
        self._packet_number += 1
        return self._packet_number

    def _run_transmit_loop(self) -> None:
        try:
            import opuslib  # type: ignore
        except ImportError as exc:
            raise RuntimeError("transmit requires opuslib to be installed") from exc

        encoder = opuslib.Encoder(MIC_SAMPLE_RATE, 1, opuslib.APPLICATION_VOIP)
        encoder.bitrate = 32000  # 32 kbps — good voice quality over SRS
        encoder.complexity = 10  # max encoding quality
        mic: PulseMicrophoneCapture | None = None
        mic_generation = -1
        ptt_prev = False
        try:
            while not self._stop_threads.is_set():
                self.ptt_watchdog_tick()
                current_generation, current_source = self._get_mic_config()
                if mic is None or current_generation != mic_generation:
                    if mic is not None:
                        mic.close()
                    if current_source == "__suspended__":
                        mic = None
                        mic_generation = current_generation
                        time.sleep(0.1)
                        continue
                    try:
                        mic = PulseMicrophoneCapture(
                            source_name=current_source,
                            samplerate=MIC_SAMPLE_RATE,
                            block_duration_ms=MIC_FRAME_MS,
                            volume=self.input_volume,
                        )
                        mic.start()
                    except Exception:
                        LOG.exception("failed to open mic source %r", current_source)
                        self._set_status(f"Mic source {current_source!r} unavailable, retrying…")
                        mic = None
                        time.sleep(2.0)
                        continue
                    mic_generation = current_generation
                    label = current_source if current_source else "default"
                    LOG.info("microphone capture ready on source %r", label)
                    self._set_status(f"Mic ready: {label}")
                try:
                    pcm = mic.read(timeout=0.05)
                except Exception as exc:
                    LOG.error("error reading from microphone: %s", exc)
                    pcm = None
                    time.sleep(0.1)

                # Auto-release PTT if the web heartbeat went stale (browser closed mid-TX)
                self.ptt_watchdog_tick()
                ptt_now = self._ptt_active.is_set()

                # On PTT press: play TX start sound, start noise, flush stale mic frames
                if ptt_now and not ptt_prev:
                    self._update_noise()
                    if self._effects:
                        self._effects.play_tx_start(self.sound_set)
                    if mic is not None:
                        mic.drain()

                # On PTT release: play TX end sound, stop noise if now idle
                if not ptt_now and ptt_prev:
                    if self._effects:
                        self._effects.play_tx_end(self.sound_set)
                    self._update_noise()

                ptt_prev = ptt_now

                if pcm is None or not ptt_now:
                    continue
                if self._voice_protocol is None or not self._voice_protocol.ready:
                    continue
                frame_size = MIC_SAMPLE_RATE * MIC_FRAME_MS // 1000
                opus_frame = encoder.encode(pcm, frame_size)
                packet = VoicePacket(
                    audio_part1=opus_frame,
                    frequencies=[self._get_tx_frequency_hz()],
                    modulations=[self._get_tx_modulation()],
                    encryptions=[0],
                    unit_id=self.unit_id,
                    packet_number=self._next_packet_number(),
                    retransmission_count=0,
                    transmission_guid=self.guid_bytes,
                    client_guid=self.guid_bytes,
                )
                self._voice_protocol.transport.sendto(packet.encode())
        finally:
            if mic is not None:
                mic.close()

    def _run_ptt_controller(self) -> None:
        if self.ptt_mode == "pynput":
            self._run_pynput_ptt()
            return
        if self.ptt_mode == "ui":
            # UI handles its own PTT via 'p' key heartbeat
            return
        self._run_stdin_toggle_ptt()

    def _run_ui(self) -> None:
        self._run_ptt_notice()
        CursesUI(self).run()

    def _run_ptt_notice(self) -> None:
        if self.tx_frequency_mhz is not None and self.ptt_mode == "ui":
            LOG.info("ui mode active: use the UI 'p' key to toggle transmit")

    def _run_stdin_toggle_ptt(self) -> None:
        LOG.info("ptt controller: press Enter to toggle transmit on/off")
        while not self._stop_threads.is_set():
            line = sys.stdin.readline()
            if line == "":
                time.sleep(0.1)
                continue
            if self._ptt_active.is_set():
                self.transmit_ptt_up()
            else:
                self.transmit_ptt_down()

    def _run_pynput_ptt(self) -> None:
        try:
            from pynput import keyboard  # type: ignore
        except ImportError as exc:
            raise RuntimeError("pynput PTT mode requires pynput") from exc

        LOG.info("ptt controller: hold right ctrl to transmit")

        def on_press(key) -> None:  # type: ignore[no-untyped-def]
            if key == keyboard.Key.ctrl_r:
                self.transmit_ptt_down()

        def on_release(key) -> bool | None:  # type: ignore[no-untyped-def]
            if key == keyboard.Key.ctrl_r:
                self.transmit_ptt_up()
            if self._stop_threads.is_set():
                return False
            return None

        with keyboard.Listener(on_press=on_press, on_release=on_release) as listener:
            while not self._stop_threads.is_set():
                time.sleep(0.1)
            listener.stop()

    def _get_tx_modulation(self) -> int:
        with self._state_lock:
            return int(self._radio_info.radios[self._tx_slot].modulation)

    def _set_tx_slot_from_frequency(self, tx_frequency_mhz: float) -> None:
        tx_hz = tx_frequency_mhz * 1_000_000
        for idx, radio in enumerate(self._radio_info.radios):
            if radio.freq == tx_hz and radio.modulation != Modulation.DISABLED:
                self._tx_slot = idx
                return
        for idx, radio in enumerate(self._radio_info.radios):
            if radio.modulation != Modulation.DISABLED:
                self._tx_slot = idx
                return

    def set_tx_slot(self, slot: int) -> None:
        with self._state_lock:
            if 0 <= slot < len(self._radio_info.radios) and self._radio_info.radios[slot].modulation != Modulation.DISABLED:
                self._tx_slot = slot
        self._schedule_radio_update()
        self.save_state()
        self._update_noise()

    _MAX_RADIOS = 11

    def add_radio(self) -> int:
        with self._state_lock:
            active = [r for r in self._radio_info.radios if r.modulation != Modulation.DISABLED]
            if len(active) >= self._MAX_RADIOS:
                return -1
            for idx, radio in enumerate(self._radio_info.radios):
                if radio.modulation == Modulation.DISABLED:
                    self._radio_info.radios[idx] = make_radio(251_000_000.0, name=f"linux{idx + 1}")
                    self._schedule_radio_update()
                    self.save_state()
                    return idx
        return -1

    def add_intercom(self) -> int:
        with self._state_lock:
            active = [r for r in self._radio_info.radios if r.modulation != Modulation.DISABLED]
            if len(active) >= self._MAX_RADIOS:
                return -1
            # Only one intercom allowed
            if any(r.modulation == Modulation.INTERCOM for r in self._radio_info.radios):
                return -1
            # Intercom must always live at slot 0 — shift existing radio if needed
            if self._radio_info.radios[0].modulation != Modulation.DISABLED:
                for idx in range(1, len(self._radio_info.radios)):
                    if self._radio_info.radios[idx].modulation == Modulation.DISABLED:
                        self._radio_info.radios[idx] = self._radio_info.radios[0]
                        break
            radio = make_radio(100.0, modulation=Modulation.INTERCOM, name="intercom")
            radio.IntercomUnitId = self.unit_id  # must equal sender's unitId for routing to work
            self._radio_info.radios[0] = radio
            self._tx_slot = 0
            self._schedule_radio_update()
            self.save_state()
            return 0

    def set_intercom_unit(self, unit_id: int) -> None:
        with self._state_lock:
            self.unit_id = unit_id
            self._radio_info.unitId = unit_id
            for radio in self._radio_info.radios:
                if radio.modulation == Modulation.INTERCOM:
                    radio.IntercomUnitId = unit_id
                    break
        self._schedule_radio_update()
        self.save_state()

    def disable_radio(self, slot: int) -> None:
        with self._state_lock:
            if 0 <= slot < len(self._radio_info.radios):
                self._radio_info.radios[slot].modulation = Modulation.DISABLED
                self._radio_info.radios[slot].freq = 1.0
                if self._tx_slot == slot:
                    for idx, radio in enumerate(self._radio_info.radios):
                        if radio.modulation != Modulation.DISABLED:
                            self._tx_slot = idx
                            break
        self._schedule_radio_update()
        self.save_state()

    def set_frequency(self, slot: int, freq_mhz: float) -> None:
        with self._state_lock:
            if 0 <= slot < len(self._radio_info.radios):
                self._radio_info.radios[slot].freq = round(freq_mhz * 1_000_000, 3)
                if self._radio_info.radios[slot].modulation == Modulation.DISABLED:
                    self._radio_info.radios[slot].modulation = Modulation.AM
        self._schedule_radio_update()
        self.save_state()

    def adjust_frequency(self, slot: int, delta_mhz: float) -> None:
        current = None
        with self._state_lock:
            if 0 <= slot < len(self._radio_info.radios):
                current = self._radio_info.radios[slot].freq / 1_000_000
        if current is None:
            return
        self.set_frequency(slot, max(0.001, current + delta_mhz))

    def cycle_modulation(self, slot: int) -> None:
        order = [Modulation.AM, Modulation.FM]  # INTERCOM is a dedicated radio, not a modulation type
        with self._state_lock:
            if 0 <= slot < len(self._radio_info.radios):
                radio = self._radio_info.radios[slot]
                if radio.modulation == Modulation.INTERCOM:
                    return  # intercom slot modulation is fixed
                try:
                    index = order.index(radio.modulation)
                except ValueError:
                    index = -1
                radio.modulation = order[(index + 1) % len(order)]
                if radio.freq <= 10000:
                    radio.freq = 251_000_000.0
        self._schedule_radio_update()
        self.save_state()
        self._update_noise()

    # ── State persistence ──────────────────────────────────────────────────────

    @property
    def _state_path(self) -> Path:
        return Path.cwd() / "lxsrs_v2_state.json"

    def _load_state(self) -> None:
        try:
            data = json.loads(self._state_path.read_text())
        except Exception:
            return
        try:
            radios = data.get("radios", [])
            for i, r in enumerate(radios):
                if i >= len(self._radio_info.radios):
                    break
                freq = float(r.get("freq_mhz", 251.0)) * 1_000_000
                mod_name = r.get("modulation", "AM")
                try:
                    mod = Modulation[mod_name]
                except KeyError:
                    mod = Modulation.AM
                self._radio_info.radios[i].modulation = mod
                self._radio_info.radios[i].freq = 100.0 if mod == Modulation.INTERCOM else freq
            vols = data.get("radio_volumes", [])
            for i, v in enumerate(vols):
                if i < len(self._radio_volumes):
                    self._radio_volumes[i] = float(v)
            if "tx_slot" in data:
                self._tx_slot = int(data["tx_slot"])
            if "sound_set" in data and data["sound_set"] in TX_SOUND_SETS:
                self.sound_set = data["sound_set"]
            if "noise_enabled" in data:
                self.noise_enabled = bool(data["noise_enabled"])
            if "unit_id" in data and int(data["unit_id"]) > 0:
                self.unit_id = int(data["unit_id"])
                self._radio_info.unitId = self.unit_id
        except Exception:
            LOG.exception("failed to apply saved state")

    def save_state(self) -> None:
        with self._state_lock:
            radios = [
                {"freq_mhz": round(r.freq / 1_000_000, 3), "modulation": r.modulation.name}
                for r in self._radio_info.radios
            ]
            vols = list(self._radio_volumes)
            tx = self._tx_slot
            sound_set = self.sound_set
            noise_enabled = self.noise_enabled
        try:
            self._state_path.write_text(json.dumps(
                {"radios": radios, "radio_volumes": vols, "tx_slot": tx,
                 "sound_set": sound_set, "noise_enabled": noise_enabled,
                 "unit_id": self.unit_id}, indent=2
            ))
        except Exception:
            LOG.warning("failed to save state")

    def set_radio_volume(self, slot: int, volume: float) -> None:
        with self._state_lock:
            if 0 <= slot < len(self._radio_volumes):
                self._radio_volumes[slot] = max(0.0, min(5.0, volume))
        self.save_state()

    def _get_radio_volume(self, freq_hz: float) -> float:
        with self._state_lock:
            for idx, radio in enumerate(self._radio_info.radios):
                if radio.modulation != Modulation.DISABLED and abs(radio.freq - freq_hz) < 1000:
                    if idx < len(self._radio_volumes):
                        return self._radio_volumes[idx]
        return 1.0

    def get_ui_snapshot(self) -> dict[str, Any]:
        self.ptt_watchdog_tick()
        with self._rx_lock:
            rx_freqs = dict(self._rx_freqs)
        with self._state_lock:
            rows = [
                RadioRow(
                    slot=idx,
                    freq_mhz=radio.freq / 1_000_000 if radio.freq > 1.0 else 0.0,
                    modulation=radio.modulation.name,
                    tx=idx == self._tx_slot,
                    rx=int(radio.freq) in rx_freqs,
                )
                for idx, radio in enumerate(self._radio_info.radios)
            ]
            active_count = sum(1 for radio in self._radio_info.radios if radio.modulation != Modulation.DISABLED)
            mic_device = self.mic_source
            speaker_sink = self.speaker_sink
            status_message = self._status_message
            input_volume = self.input_volume
            output_volume = self.output_volume
            radio_volumes = list(self._radio_volumes)
            sound_set = self.sound_set
            noise_enabled = self.noise_enabled
        return {
            "rows": rows,
            "udp_ready": bool(self._voice_protocol and self._voice_protocol.ready),
            "ptt": self._ptt_active.is_set(),
            "active_count": active_count,
            "mic_device": mic_device,
            "speaker_sink": speaker_sink,
            "input_volume": input_volume,
            "output_volume": output_volume,
            "radio_volumes": radio_volumes,
            "sound_set": sound_set,
            "noise_enabled": noise_enabled,
            "status_message": status_message,
            "unit_id": self.unit_id,
            "srs_clients": [
                {
                    "name": c.get("Name", ""),
                    "unit_id": (c.get("RadioInfo") or {}).get("unitId", 0),
                }
                for c in self._clients.values()
                if c.get("ClientGuid") != self.guid
                and (c.get("RadioInfo") or {}).get("unitId", 0) > 0
            ],
        }

    def request_shutdown(self) -> None:
        self._stop_threads.set()
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._shutdown_transports)

    def _schedule_radio_update(self) -> None:
        if self._loop is None or self.tcp_writer is None:
            return
        asyncio.run_coroutine_threadsafe(self._send(MessageType.RADIO_UPDATE), self._loop)

    def _shutdown_transports(self) -> None:
        if self.tcp_writer is not None:
            self.tcp_writer.close()
        if self._voice_protocol is not None:
            self._voice_protocol.transport.close()

    def list_audio_devices(self) -> list[AudioDevice]:
        devices = list_audio_devices()
        return [
            AudioDevice(
                index=-1,
                name="default",
                max_input_channels=1,
                max_output_channels=0,
                default_samplerate=0.0,
                usable_input=True,
            )
        ] + devices

    def set_mic_source(self, source: str | None) -> None:
        with self._state_lock:
            self.mic_source = source or None
            self._device_generation += 1
            label = repr(source) if source else "'default'"
            self._status_message = f"Mic source set to {label}"
        LOG.info("set_mic_source: source=%r stored=%r", source, self.mic_source)

    def set_mic_device(self, device: int | None) -> None:
        """Deprecated shim — kept for curses UI compatibility."""
        self.set_mic_source(None)  # fall back to default

    def set_input_volume(self, volume: float) -> None:
        with self._state_lock:
            self.input_volume = max(0.0, min(5.0, volume))
            self._device_generation += 1  # trigger mic restart to pick up new volume
            self._status_message = f"Input volume set to {self.input_volume:.1f}"

    def set_output_volume(self, volume: float) -> None:
        with self._state_lock:
            self.output_volume = max(0.0, min(5.0, volume))
            sink = self.audio_sink
            self._status_message = f"Output volume set to {self.output_volume:.1f}"
        if isinstance(sink, OptionalOpusPlaybackSink):
            sink.set_volume(self.output_volume)

    def set_speaker_sink(self, sink_name: str | None) -> None:
        with self._state_lock:
            self.speaker_sink = sink_name
            sink = self.audio_sink
            self._status_message = f"Speaker sink set to {sink_name if sink_name is not None else 'default'}"
        if isinstance(sink, OptionalOpusPlaybackSink):
            sink.set_sink(sink_name)
        if self._effects:
            self._effects.set_sink(sink_name)

    def set_sound_set(self, sound_set: str) -> None:
        if sound_set in TX_SOUND_SETS:
            with self._state_lock:
                self.sound_set = sound_set
            self.save_state()

    def set_noise_enabled(self, enabled: bool) -> None:
        with self._state_lock:
            self.noise_enabled = enabled
        self._update_noise()
        self.save_state()

    def _update_noise(self) -> None:
        """Start noise if local PTT or any remote is active; stop otherwise."""
        if self._effects is None:
            return
        local_tx = self._ptt_active.is_set()
        with self._rx_lock:
            remote_active = bool(self._remote_active)
        if not self.noise_enabled or (not local_tx and not remote_active):
            self._effects.stop_noise()
            return
        with self._state_lock:
            mod = self._radio_info.radios[self._tx_slot].modulation
        self._effects.start_noise(mod.name)

    def _run_rx_monitor(self) -> None:
        """Evict remote GUIDs that have gone silent and play TX-end sounds."""
        RX_TIMEOUT = 0.45   # seconds of silence = transmission ended
        CHECK_INTERVAL = 0.05
        while not self._stop_threads.is_set():
            time.sleep(CHECK_INTERVAL)
            now = time.monotonic()
            timed_out: list[str] = []
            with self._rx_lock:
                for guid, last_seen in list(self._remote_active.items()):
                    if now - last_seen > RX_TIMEOUT:
                        timed_out.append(guid)
                for guid in timed_out:
                    del self._remote_active[guid]
                for freq_hz in [f for f, t in list(self._rx_freqs.items()) if now - t > RX_TIMEOUT]:
                    del self._rx_freqs[freq_hz]
            for guid in timed_out:
                if self._effects:
                    self._effects.play_tx_end(self.sound_set)
            if timed_out:
                self._update_noise()

    def test_speaker_sink(self, sink_name: str | None) -> None:
        try:
            play_test_tone_on_sink(sink_name)
        except Exception as exc:
            self._set_status(f"Speaker test failed: {exc}")
            LOG.warning("speaker test failed on sink %s: %s", sink_name, exc)
            return
        self._set_status(f"Played test tone on sink {sink_name if sink_name is not None else 'default'}")

    def test_mic_device(self, source: str | None) -> None:
        """Record ~1.5 s from the given PulseAudio source and play it back."""
        # PulseAudio allows multiple concurrent readers, so no suspension needed.
        is_same_source = (source == self.mic_source)
        capture = PulseMicrophoneCapture(
            source_name=source,
            samplerate=MIC_SAMPLE_RATE,
            block_duration_ms=MIC_FRAME_MS,
            volume=self.input_volume,
        )
        try:
            try:
                capture.start()
            except Exception as exc:
                self._set_status(f"Mic test failed: {exc}")
                LOG.exception("mic test failed on source %r", source)
                return

            collected: list[bytes] = []
            peak = 0.0
            try:
                # Discard first few frames — PA may deliver stale buffered data
                for _ in range(3):
                    capture.read(timeout=0.05)

                label = source if source else "default"
                self._set_status(f"Testing mic {label!r}: speak now…")
                deadline = time.time() + 1.5
                while time.time() < deadline:
                    chunk = capture.read(timeout=0.25)
                    if not chunk:
                        continue
                    collected.append(chunk)
                    peak = max(peak, pcm16_mono_peak(chunk))
            except Exception as exc:
                self._set_status(f"Mic test failed: {exc}")
                LOG.exception("mic test failed on source %r", source)
                return
        finally:
            capture.close()

        if not collected:
            self._set_status("Mic test captured no audio")
            return

        pcm_16k = b"".join(collected)
        pcm_48k = resample_pcm16_mono(pcm_16k, src_rate=MIC_SAMPLE_RATE, dst_rate=48000)
        player = PulseSimplePlayer(sink_name=self.speaker_sink, stream_name="Mic Test")
        try:
            player.write(pcm_48k)
            player.drain()
        except Exception as exc:
            self._set_status(f"Mic playback failed: {exc}")
            LOG.warning("mic playback failed on sink %s: %s", self.speaker_sink, exc)
            return
        finally:
            player.close()
        label = source if source else "default"
        self._set_status(f"Mic test peak={peak:.2f} source={label!r}")

    def _get_mic_config(self) -> tuple[int, str | None]:
        with self._state_lock:
            return self._device_generation, self.mic_source

    def _set_status(self, message: str) -> None:
        with self._state_lock:
            self._status_message = message

    def list_input_sources(self) -> list[PulseSource]:
        return list_pulse_sources()

    def list_output_sinks(self) -> list[PulseSink]:
        return list_pulse_sinks()


class VoiceProtocol(asyncio.DatagramProtocol):
    def __init__(self, client: SRSClient) -> None:
        self.client = client
        self.transport: asyncio.DatagramTransport
        self.ready = False

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        self.transport = transport  # type: ignore[assignment]
        LOG.info("udp connected")

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
        if len(data) == GUID_LENGTH:
            self.ready = True
            LOG.info("udp ready from %s:%d", addr[0], addr[1])
            return
        try:
            packet = VoicePacket.decode(data)
        except Exception:
            LOG.exception("failed to decode voice packet")
            return
        self.client.on_voice_packet(packet)

    def error_received(self, exc: Exception) -> None:
        LOG.warning("udp error: %s", exc)


def _summarize_radios(radio_info: dict[str, Any] | None) -> str:
    if not radio_info:
        return "-"
    radios = radio_info.get("radios") or []
    active = []
    for radio in radios:
        if not radio:
            continue
        mod = radio.get("modulation")
        freq = radio.get("freq", 0)
        if mod == int(Modulation.DISABLED):
            continue
        if mod == int(Modulation.INTERCOM):
            active.append("INTERCOM")
        elif freq > 10000:
            active.append(f"{freq / 1_000_000:.3f}")
    return ",".join(active) if active else "-"
