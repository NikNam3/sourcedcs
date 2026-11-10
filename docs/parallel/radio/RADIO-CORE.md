# Lane RADIO-CORE: the SRS client in Node and the audio in the renderer (ADR 0158 step 2)

Read first: `CLAUDE.md`, ADR 0158 (whole), `docs/parallel/radio/README.md` (the contract), `docs/parallel/lane-rules.md`,
`crc-desktop/README.md` ("Client modules", packaging), and the Python you are porting:
`crc-desktop/python-pkg/lxsrs_v2/{protocol,models,client,audio,effects}.py`.

## Goal

A working SRS client with no Python. Network in the bundled local server (`crc-desktop/app/`, CommonJS, plain Node, no
Express). Audio in the renderer (ES modules). Joined by a loopback WebSocket `/srs`. It exposes `radio-engine.js` as the
README's contract says.

## Files (ADR 0158 §6). One job each, about 300 lines at most, split by job if it grows

`crc-desktop/app/srs/`: `voice-packet.js`, `sync-message.js`, `srs-guid.js`, `sync-link.js`, `voice-link.js`,
`srs-route.js`. `relay.js` and `relay-seen.js` are **not** this lane's (step 4).

`crc-desktop/app/public/js/radio/`: `mic-capture.js`, `mic-worklet.js`, `opus-codec.js`, `rx-mixer.js`,
`radio-effects.js`, `srs-socket.js`, `radio-engine.js`. If the engine wants more than one job, split it (for example a
`tx-path.js` and an `rx-path.js` behind `radio-engine.js`) rather than grow it.

`app/server.js`: only the wiring of the `/srs` route. Leave the `/srs-api/` proxy alone.

## Requirements

- **Packets.** Match `protocol.py` byte for byte. Unit-test `voice-packet.js` and `sync-message.js` against fixtures
  that you generate **from the Python code** (a tiny script under `crc-desktop/tests/fixtures/srs/` that you run once by
  hand; commit the bytes, not a test that needs Python).
- **Sync link.** `{Client, MsgType, Version}` newline JSON, the version constant `2.3.3.3` in one place. It sends
  SYNC on connect, RADIO_UPDATE when the radios change, and PING on the keepalive; it reconnects with backoff and
  handles VERSION_MISMATCH by reporting it in the state, not by retrying forever. Read `client.py` for what it sends
  and when, including coalition, name and position.
- **Voice link.** The UDP socket, the keepalive as `client.py` does it, receive, decode, and forward to the renderer
  as `{radioIds matched by frequency, senderGuid, transmissionGuid, opus bytes}`. A transmission on a group is **one
  packet stream with every frequency of the group** (ADR 0158 §4, controller side).
- **Codec.** WebCodecs `AudioEncoder`/`AudioDecoder` `opus`, 48 kHz mono, 20 ms frames, 32 kbit/s, as `client.py`.
  `isConfigSupported` is false → the state says `opusSupported: false`; no fallback.
- **Mic.** `getUserMedia` with `deviceId`, an `AudioWorklet` that cuts 960-sample frames, and the gain and limiter
  chain from `audio.py`'s transmit chain (read the comment about sibilance and clipping and keep its intent).
- **RX.** One decoder per sender guid, mixed through Web Audio, per-radio gain, pan and mute, output device via
  `AudioContext.setSinkId`.
- **Effects.** Port `effects.py`: band-pass, noise, and the start and end tones. Where the Python loads sound files,
  use the same files from `python-pkg/lxsrs_v2/AudioEffects`, **copied** into `app/public/sounds/srs/`. Do not
  reference the Python package path, because it goes away.
- **PTT.** Reuse `ptt-controller.js` as is (the max-TX watchdog included).
- **The module graph stays acyclic and nothing goes on `window`** (`tests/module-graph.test.mjs`,
  `tests/no-window-globals.test.mjs`). Shared state goes in a leaf module.
- **Settings.** Where the SRS host and port come from today (see `lxsrs-setup.js`'s `lxsrsArgs` and the config it
  reads), read the same keys. Add no new config keys without logging them as a default in your wip file.

## Not this lane

The radio set, link groups, bands, the panel DOM (RADIO-SET); the relay and leases (step 4); ATIS (step 5); removing
Python (step 6); crc-sync (no change in this step).

## Deliverables

- the code and unit tests for every pure module;
- `docs/wip/RADIO-CORE.md`, holding:
  - what you verified about SRS behaviour from the Python (and from the SRS source, if you can find it), especially
    for ADR 0158 §4's "to verify" list: de-duplication on `transmissionGuid` and server handling of
    `retransmissionCount`;
  - the defaults you took;
  - a manual test script for the supervisor: how to run it against a real SRS server.

ADR: none (0158 covers it). Report per lane-rules rule 8.
