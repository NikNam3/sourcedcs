"""The web PTT keepalive: no /api/ptt/start for PTT_KEEPALIVE_TIMEOUT_S un-keys the radio."""
from __future__ import annotations

import json
import threading
import urllib.request

from lxsrs_v2 import client as client_mod
from lxsrs_v2.api import SrsApiServer
from lxsrs_v2.client import PTT_KEEPALIVE_TIMEOUT_S, SRSClient


def _client() -> SRSClient:
    return SRSClient(host="127.0.0.1", port=5002, name="t", frequencies_mhz=[251.0], tx_frequency_mhz=251.0, ptt_mode="ui")


def _clock(monkeypatch) -> list[float]:
    now = [1000.0]
    monkeypatch.setattr(client_mod.time, "monotonic", lambda: now[0])
    return now


def test_timeout_is_about_one_and_a_half_seconds() -> None:
    assert PTT_KEEPALIVE_TIMEOUT_S == 1.5


def test_keepalive_holds_the_key_and_silence_releases_it(monkeypatch) -> None:
    now = _clock(monkeypatch)
    c = _client()
    c.transmit_ptt_down()
    assert c._ptt_active.is_set()
    for _ in range(10):                      # client re-sends every 400 ms
        now[0] += 0.4
        c.transmit_ptt_down()
        assert c.ptt_watchdog_tick() is False
    assert c._ptt_active.is_set()
    now[0] += PTT_KEEPALIVE_TIMEOUT_S - 0.01  # renderer dies here
    assert c.ptt_watchdog_tick() is False
    now[0] += 0.02
    assert c.ptt_watchdog_tick() is True
    assert not c._ptt_active.is_set()
    assert c.ptt_watchdog_tick() is False    # idempotent


def test_state_read_also_enforces_it(monkeypatch) -> None:
    now = _clock(monkeypatch)
    c = _client()
    c.transmit_ptt_down()
    now[0] += 2.0
    assert c.get_ui_snapshot()["ptt"] is False


def test_key_without_a_heartbeat_is_left_alone(monkeypatch) -> None:
    now = _clock(monkeypatch)
    c = _client()
    c._ptt_active.set()                      # never went through transmit_ptt_down
    now[0] += 60
    assert c.ptt_watchdog_tick() is False
    assert c._ptt_active.is_set()


def test_http_handler_start_keeps_alive_and_stop_releases(monkeypatch) -> None:
    now = _clock(monkeypatch)
    c = _client()
    srv = SrsApiServer(c, port=0)
    srv.start()
    port = srv._server.server_address[1]

    def post(path: str) -> None:
        req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=b"{}", method="POST")
        urllib.request.urlopen(req, timeout=5).read()

    try:
        post("/api/ptt/start")
        assert c._ptt_active.is_set()
        now[0] += 1.0
        post("/api/ptt/start")
        now[0] += 1.0                         # 1.0 s since the last keepalive: still keyed
        assert c.ptt_watchdog_tick() is False
        now[0] += 1.0                         # 2.0 s of silence: the watchdog un-keys it
        assert c.ptt_watchdog_tick() is True
        post("/api/ptt/start")
        post("/api/ptt/stop")
        assert not c._ptt_active.is_set()
    finally:
        srv.stop()
