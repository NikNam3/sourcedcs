"""No station frequency in the bridge (H147 RQ5): a new radio tunes to the launcher's default, or stays untuned."""
from __future__ import annotations

import json
import re
from pathlib import Path

from lxsrs_v2.__main__ import parse_args
from lxsrs_v2.client import UNTUNED_HZ, SRSClient
from lxsrs_v2.models import Modulation


def _client(monkeypatch, tmp_path, default: float | None) -> SRSClient:
    monkeypatch.chdir(tmp_path)  # the bridge keeps its state file in cwd
    return SRSClient(host="127.0.0.1", port=5002, name="t", frequencies_mhz=[305.5],
                     ptt_mode="ui", default_frequency_mhz=default)


def test_added_radio_takes_the_configured_default(monkeypatch, tmp_path) -> None:
    c = _client(monkeypatch, tmp_path, 243.0)
    slot = c.add_radio()
    assert slot == 1
    assert c._radio_info.radios[slot].freq == 243_000_000.0
    assert c._radio_info.radios[slot].modulation == Modulation.AM


def test_added_radio_without_a_default_is_untuned(monkeypatch, tmp_path) -> None:
    c = _client(monkeypatch, tmp_path, None)
    slot = c.add_radio()
    assert c._radio_info.radios[slot].freq == UNTUNED_HZ
    assert c._radio_info.radios[slot].modulation == Modulation.AM


def test_cycle_modulation_on_an_untuned_radio_uses_the_default_or_stays_untuned(monkeypatch, tmp_path) -> None:
    c = _client(monkeypatch, tmp_path, None)
    slot = c.add_radio()
    c.cycle_modulation(slot)
    assert c._radio_info.radios[slot].freq == UNTUNED_HZ
    assert c._radio_info.radios[slot].modulation == Modulation.FM

    other = tmp_path / "other"
    other.mkdir()
    d = _client(monkeypatch, other, 262.5)
    d._radio_info.radios[0].freq = 1.0
    d.cycle_modulation(0)
    assert d._radio_info.radios[0].freq == 262_500_000.0


def test_saved_radio_without_a_frequency_loads_the_default(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / "lxsrs_v2_state.json").write_text(json.dumps({"radios": [{"modulation": "AM"}]}))
    c = SRSClient(host="127.0.0.1", port=5002, name="t", frequencies_mhz=[305.5], ptt_mode="ui",
                  default_frequency_mhz=None)
    assert c._radio_info.radios[0].freq == UNTUNED_HZ
    c2 = SRSClient(host="127.0.0.1", port=5002, name="t", frequencies_mhz=[305.5], ptt_mode="ui",
                   default_frequency_mhz=255.1)
    assert c2._radio_info.radios[0].freq == 255_100_000.0


def test_cli_default_freq_is_optional(monkeypatch) -> None:
    monkeypatch.setattr("sys.argv", ["lxsrs_v2", "--freq", "305.5"])
    assert parse_args().default_freq is None
    monkeypatch.setattr("sys.argv", ["lxsrs_v2", "--freq", "305.5", "--default-freq", "243.0"])
    assert parse_args().default_freq == 243.0


def test_no_station_frequency_literal_in_the_bridge() -> None:
    pkg = Path(__file__).resolve().parent.parent
    # the lane audit's pattern: a UHF station in MHz (251.000) or in Hz (251_000_000)
    pattern = re.compile(r"(?<![\d.])(?:2[0-9]{2}\.[0-9]{1,3}|[0-9]{3}_000_000)(?![\d.])")
    hits = []
    for py in pkg.glob("*.py"):
        if py.name == "test_output.py":
            continue  # audio tone test (Hz), not a radio
        for n, line in enumerate(py.read_text().splitlines(), 1):
            code = line.split("#", 1)[0]
            if pattern.search(code):
                hits.append(f"{py.name}:{n}: {line.strip()}")
    assert hits == []
