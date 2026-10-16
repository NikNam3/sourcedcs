from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

from .api import SrsApiServer
from .client import SRSClient


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Linux-oriented SRS client prototype")
    parser.add_argument("--host", default="server.sourcedcs.page")
    parser.add_argument("--port", type=int, default=5002)
    parser.add_argument("--name", default="lxsrs_v2")
    parser.add_argument("--coalition", type=int, default=0)
    parser.add_argument("--unit-id", type=int, default=0)
    parser.add_argument(
        "--freq",
        dest="frequencies",
        action="append",
        type=float,
        required=True,
        help="Monitored frequency in MHz. Repeat the flag for multiple radios.",
    )
    parser.add_argument("--play-audio", action="store_true")
    parser.add_argument("--tx-freq", type=float, help="Transmit frequency in MHz.")
    parser.add_argument(
        "--default-freq",
        type=float,
        help="Frequency in MHz a newly added radio tunes to. Unset: a new radio starts untuned.",
    )
    parser.add_argument(
        "--ptt-mode",
        choices=["stdin", "pynput"],
        default="stdin",
        help="PTT control mode. stdin toggles TX on each Enter press; pynput uses right Ctrl hold-to-talk.",
    )
    parser.add_argument("--mic-source", help="PulseAudio/PipeWire source name (from pactl list sources)")
    parser.add_argument("--speaker-sink", help="PulseAudio/PipeWire sink name")
    parser.add_argument("--input-volume", type=float, default=0.5, help="Input volume multiplier (default: 0.5)")
    parser.add_argument("--output-volume", type=float, default=1.0, help="Output volume multiplier (default: 1.0)")
    parser.add_argument("--ui", action="store_true", help="Enable curses UI for radio management and PTT.")
    parser.add_argument("--api-port", type=int, default=0, help="Expose HTTP control API on this port (e.g. 5003). 0 = disabled.")
    parser.add_argument("--debug", action="store_true")
    return parser.parse_args()


async def _main() -> None:
    args = parse_args()
    log_level = logging.DEBUG if args.debug else logging.INFO
    log_format = "%(asctime)s %(levelname)s %(name)s: %(message)s"
    if args.ui:
        log_path = Path.cwd() / "lxsrs_v2.log"
        handler = logging.FileHandler(log_path, encoding="utf-8", mode="a")
        # Ensure logs are flushed immediately
        class FlushHandler(logging.FileHandler):
            def emit(self, record):
                super().emit(record)
                self.flush()

        handler = FlushHandler(log_path, encoding="utf-8", mode="a")
        logging.basicConfig(
            level=log_level,
            format=log_format,
            handlers=[handler],
            force=True,
        )
        # Redirect stderr to the log file to capture C-level PortAudio errors
        log_file = open(log_path, "a", encoding="utf-8", buffering=1)
        sys.stderr = log_file
        logging.getLogger().info("--- Application Started (UI Mode) ---")
    else:
        logging.basicConfig(
            level=log_level,
            format=log_format,
            force=True,
        )
        logging.getLogger().info("--- Application Started (CLI Mode) ---")
    client = SRSClient(
        host=args.host,
        port=args.port,
        name=args.name,
        frequencies_mhz=args.frequencies,
        coalition=args.coalition,
        unit_id=args.unit_id,
        tx_frequency_mhz=args.tx_freq,
        default_frequency_mhz=args.default_freq,
        mic_source=args.mic_source,
        speaker_sink=args.speaker_sink,
        input_volume=args.input_volume,
        output_volume=args.output_volume,
        ptt_mode="ui" if args.ui else args.ptt_mode,
        ui_enabled=args.ui,
    )
    if args.api_port:
        api = SrsApiServer(client, port=args.api_port)
        api.start()
    await client.connect(play_audio=args.play_audio)


if __name__ == "__main__":
    try:
        asyncio.run(_main())
    except Exception:
        logging.getLogger().exception("Fatal error in main")
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(0)
