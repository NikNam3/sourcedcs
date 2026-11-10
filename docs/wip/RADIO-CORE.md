# RADIO-CORE: the SRS client in Node, the audio in the renderer (ADR 0158 step 2)

Branch `lane/RADIO-CORE`. Rulings applied: S-RADIO-1 (RQ1–RQ14), S-RADIO-2 (RQ18, partly overridden), H183 (intercom).

## What was built

`crc-desktop/app/srs/` (CommonJS, one job each, all under 160 lines):

| File | Job |
|---|---|
| `srs-guid.js` | 22-character GUIDs (UUID4 hex, first 22) |
| `voice-packet.js` | UDP packet encode/decode, byte for byte `protocol.py` (fixtures) |
| `sync-message.js` | `{Client, MsgType, Version}` lines, `Client`/`RadioInfo` shapes, `SRS_VERSION = '2.3.3.3'` (the one place) |
| `radio-slots.js` | radio identity <-> SRS slots: one slot per distinct frequency+modulation, intercom in slot 0, match by frequency |
| `sync-link.js` | TCP: SYNC + RADIO_UPDATE on connect, RADIO_UPDATE on change, PING 15 s, dead after 45 s silent, backoff 1/2/5/10/30 s, VERSION_MISMATCH reported, not retried |
| `voice-link.js` | UDP: GUID keepalive 15 s, ready on the echo, decode, dropped-packet count |
| `srs-session.js` | one SRS client: the two links, slots, PTT, packets out and in, intercom unit, SRS client list |
| `srs-frame.js` | the binary `/srs` frame (u16 header length, JSON header, Opus) |
| `srs-route.js` | the `/srs` WebSocket: loopback + Origin check, one renderer at a time, messages to the session |

`app/server.js`: `attachSrsRoute(...)` and `var RADIO_CLIENT` in `/js/config.js`. `main.js`: `radioClient` (RQ11).

`crc-desktop/app/public/js/radio/` (ES modules, nothing runs at import):

| File | Job |
|---|---|
| `radio-audio-constants.js` | leaf: 48 kHz, 20 ms blocks, 40 ms Opus frames, 32 kbit/s, 450 ms RX timeout, 80 ms playout, gains |
| `voice-processor.js` | the transmit gain + limiter, ported from `audio.py` and checked against its output (fixture, within 2 s16 steps) |
| `mic-worklet.js` | the `AudioWorkletProcessor` and its pure frame cutter; registers only inside a worklet scope |
| `mic-capture.js` | `getUserMedia` (all processing off), own 48 kHz context, the worklet by absolute URL |
| `opus-codec.js` | WebCodecs `opusSupported()`, encoder, decoder (packet number rides in the timestamp) |
| `playout-schedule.js` | pure per-sender playout: 80 ms start, packet-number slots, drop late, restart past 200 ms drift |
| `rx-activity.js` | pure RX lamps (450 ms) |
| `rx-mixer.js` | per-radio band-pass, gain, pan into master; `pickPlaybackRadio` (loudest unmuted) |
| `rx-path.js` | decoders per sender GUID, schedule, start/end tones, noise per receiving radio, no playback on a transmitting radio |
| `tx-path.js` | PTT: `ptt` message, per-transmission encoder, frames up, tones and noise, flush before key-up |
| `tx-group.js` | pure: the pressed radio's group, or itself; never receive-only; intercom always alone |
| `device-pick.js` | pure: by id, else by label, else default + note (RQ9) |
| `radio-effects.js` | band-pass nodes, tones and noise from `/sounds/srs/` (12 WAVs copied from `lxsrs_v2/AudioEffects`) |
| `srs-socket.js` | the renderer's `/srs` end, reconnecting |
| `srs-frame.js` | the renderer's copy of the frame (parity test) |
| `mic-test.js` | 1.5 s record, peak, playback |
| `radio-engine-state.js` | leaf state + listeners |
| `radio-engine.js` | the contract, wiring only (180 lines) |

### The engine's exports (contract + rulings)

`setRadios(radios)`, `setPtt(down, radioId)`, `setRadioAudio(radioId, {volume, pan, muted})`,
`setDevices({inputId, outputId, inputLabel?, outputLabel?})`, `onState(fn) -> unsubscribe`, and from the rulings
`setAudioOptions({inputGain, outputGain, soundSet, noise})`, `testMic() -> Promise<{peak, blocks}>`,
`setIdentity({name})` (RQ3), `setIntercomUnit(unitId|null)` (H183).

State: `connected, udpReady, enabled, error, rxRadioIds, txRadioIds, opusSupported, deviceNote, overflowRadioIds,
invalidRadioIds, srsClients [{name, unitId}], intercomUnitId`.

Radio fields the engine reads: `id, mhz, modulation ('AM' | 'FM' | 'INTERCOM'), label, groupId, receiveOnly`. An
intercom radio is `{ modulation: 'INTERCOM' }`; its `mhz` is ignored (sent as 100 Hz, as `client.py`).

## What SRS does (verified in the SRS source, ciribob/DCS-SimpleRadioStandalone master, read 2026-11-10)

- **The two GUIDs.** `Common/Models/UDPVoicePacket.cs`: the first 22-byte block is `OriginalClientGuid`, the last is
  `Guid`. The server reads the sender from the last 22 bytes (`UDPVoiceRouter.cs`). A sending client fills both with its
  own GUID when not relaying. **There is no per-transmission id.** `protocol.py`'s `transmission_guid` is SRS's
  `OriginalClientGuid`. `voice-packet.js` names them `originalGuid` and `guid` (RQ2).
- **`retransmissionCount`.** The fixed segment is `u32 UnitId, u64 PacketNumber, u8 RetransmissionCount` ("number of
  hops"). The server reads it and never changes it: `if (udpVoice.RetransmissionCount > nodeHopCount) return null;`
  with `nodeHopCount` from the server setting `RETRANSMISSION_NODE_LIMIT` (`ServerSettingsKeys.cs`, key 24), **default
  "0"**. So on a server with default settings **every packet with a count of 1 or more is dropped**. There is no other
  switch. The server forwards the bytes unchanged.
- **De-duplication.** None found. `UDPVoiceHandler.cs` only queues datagrams; `ClientAudioProvider.cs` and
  `JitterBufferProviderInterface.cs` key audio by `PacketNumber * Audio.Length` per stream; nothing keys on
  `OriginalClientGuid` across frequencies. The generic `JitterBuffer` class was not read, so it is not ruled out there.
  A single packet that carries several frequencies is one packet and is played once by the receiver, which is what the
  controller side (ADR 0158 §4) relies on.
- **Keepalive.** The client sends its 22 GUID bytes every 15 s (`UDPVoiceHandler.cs`), recreates the socket after 42 s
  without an echo; the server answers a 22-byte datagram with the same bytes and records the sender's address.
- **Constants.** `MIC_SAMPLE_RATE = 16000`, `MIC_INPUT_AUDIO_LENGTH_MS = 40`, `OUTPUT_SAMPLE_RATE = 48000`,
  `JITTER_BUFFER = 50` ms, `MAX_RADIOS = 11`. Hence 40 ms frames on the air (RQ1).
- **TCP.** The client sends SYNC on connect; RADIO_UPDATE when radios change (or after 180 s); the server ignores PING;
  a version below the minimum gets VERSION_MISMATCH and a disconnect; the client disconnects on it too.
- **Not found** (from memory, used as defaults): the frequency closeness test (`FreqCloseEnough`, 500 Hz) and the
  receive filter (high-pass 520 Hz Q 0.97, low-pass 4130 Hz Q 2.0). Both are one constant each
  (`radio-slots.js MATCH_TOLERANCE_HZ`, `radio-effects.js BAND_PASS`). The client-side retransmit code
  (`DCS-SR-Client/`) and whether a reconnect with the same GUID replaces the old entry were not read.

## For step 4 (the relay), before it is built

1. **The server drops relayed packets by default.** `RETRANSMISSION_NODE_LIMIT` must be at least 1 on the squadron's
   SRS server, or every relayed packet vanishes. That is a server setting the human sets; the relay should say so
   (a state flag when nothing it relays is ever heard back, or a documented precondition).
2. **ADR 0158 §4 check 3 needs re-specifying**: there is no `transmissionGuid`. The nearest key is `originalGuid`, which
   is the *client*, the same for all its transmissions. A transmission is then `originalGuid` plus a run of packet
   numbers with no gap longer than the 450 ms RX timeout. Check 1 (own `guid`) and check 2 (count >= 1) still stand.
3. **Never relay intercom** (H183): drop any packet whose modulations include INTERCOM (2) before relay logic, and never
   put an intercom slot into a relay's target frequencies.
4. **The unit id on a relayed packet**: recommended the shared default `UNIT_ID = 1` (`srs-session.js`), **never** the
   unit id the controller took to join an intercom, and not the pilot's (a pilot's own client could treat a packet
   from its own unit as intercom traffic). Keep it a separate constant (`RELAY_UNIT_ID`) so joining an intercom cannot
   change it.
5. Relayed copies on two frequencies are two packets; with no de-duplication found in SRS clients, a listener tuned to
   both may hear the relay twice. The relay must re-send on all the group's *other* frequencies in **one** packet
   (like the controller side), so a listener hears at most the original plus one copy.

## Defaults taken

| # | Default | Why |
|---|---|---|
| D1 | 40 ms Opus frames on the air, 20 ms worklet blocks (`frameDuration: 40000`) | S-RADIO-1 RQ1; corrects ADR 0158 §1's "20 ms" (P4: ADR not edited) |
| D2 | Packet GUID fields named `originalGuid`, `guid`; both our own GUID | RQ2 |
| D3 | SYNC: name from `setIdentity` (default `CRC`), coalition 0, unit id 1, position 0/0/0, radio `Name` = cleaned label, `Model` `crc` | RQ3 |
| D4 | TCP PING every 15 s, dead after 45 s with nothing heard (TCP line or UDP echo), backoff 1/2/5/10/30 s; SYNC then RADIO_UPDATE after every connect; UDP socket re-opened on every sync connect; one GUID per app run (made in `srs-route.js`) | RQ4 |
| D5 | Frequency match within 500 Hz and same modulation; encrypted segments not heard; unmatched packets counted (`unmatchedPackets`) | RQ5 (tolerance from memory) |
| D6 | A packet plays once, through the loudest unmuted matched radio; every matched radio lights; nothing plays on a radio we are transmitting on | RQ6 |
| D7 | Playout 80 ms, slots by packet number, drop late, restart past 200 ms drift, end after 450 ms, decoder freed | RQ7 |
| D8 | Mic: EC/NS/AGC off, open while connected, blocks dropped unless PTT; limiter runs on every block (as `audio.py`); new encoder per transmission, flushed before key-up (500 ms cap) | RQ8 |
| D9 | Devices by id, then label, else default + `deviceNote` | RQ9 |
| D10 | `ws` in `app/package.json`; `/srs` refused (403) unless loopback and Origin `http://localhost:<port>` / `http://127.0.0.1:<port>`; a missing Origin is refused | RQ10 |
| D11 | `config.json` **`radioClient`** (`"lxsrs"` or `"node"`), read by `main.js`: lxsrs is spawned only when `lxsrs`; default `lxsrs` on Linux, `node` elsewhere; not added to the shipped `config.json` (the platform default applies). `main.js` passes `CRC_RADIO_CLIENT`, `CRC_SRS_HOST`, `CRC_SRS_PORT` (from the existing `srsHost`/`srsPort`) to the local server; `/js/config.js` gains `var RADIO_CLIENT`. With `lxsrs`, `/srs` accepts the socket and answers only `{enabled:false, error}` | RQ11; new config key, logged here as asked |
| D12 | One SRS slot per distinct frequency+modulation; past 11 the first 11 are tuned and the rest reported (`overflowRadioIds`, `error`), rather than refusing all | RQ13 backstop; losing all radios over one too many is worse |
| D13 | Receive-only radios never transmit (`tx-group.js`); they are still tuned and heard | RQ14 |
| D14 | Input gain default 0.5 (lxsrs), output 1.0, both clamped 0..5; sound set `RADIO_TRANS`; noise on, 0.12 FS, by modulation (intercom: `VHF_NOISE`) | RQ18 |
| D15 | Intercom: at most one, slot 0, 100 Hz, `IntercomUnitId` = our unit id; `setIntercomUnit(id)` takes that client's unit id as ours (as `client.py`), null back to 1; never in a group's packets, server side (`txChannels`) and client side (`tx-group.js`) | H183 |
| D16 | Receive band-pass 520 Hz / 4130 Hz (SRS from memory); `effects.py` has none | briefing asks for one |
| D17 | A second `/srs` connection replaces the first (close code 4000) | one renderer, one SRS client |
| D18 | PTT is refused (nothing sent) while UDP is not ready or Opus is unsupported; the server also refuses and says so in `error` | RQ4, ADR §1 |

## Findings for other lanes and the supervisor

- **Module graph** (`tests/module-graph.test.mjs`): the `radio/` modules are not reachable from `main.js` until
  integration imports `radio-engine.js` (and `mic-capture.js` imports `mic-worklet.js` for its name, so the worklet is
  reachable through it). The exports fixture needs `GOLDEN_RECORD=1` at integration. No cycles; every radio module
  evaluates under the DOM stub with no side effect (`radio-core-audio.test.mjs`).
- **No `window.*`**: the codec module reads `globalThis.AudioEncoder` etc. (reads only).
- **The local server listens on every interface** (`server.js` `listen(port)`): `/srs` is protected by its own check,
  but `/srs-api/` and `/api/sync-config` are open to the LAN today (RQ10 finding, supervisor).
- **RADIO-SET**: the panel creates the PTT controller with `post: (p) => setPtt(p === '/ptt/start', targetRadioId)`;
  repeats are ignored by the engine (RQ12). An intercom radio is `modulation: 'INTERCOM'`, never `groupId` (the engine
  ignores a group on it anyway). The picker reads `state.srsClients` and calls `setIntercomUnit`. The panel should show
  `state.enabled === false` (radioClient is lxsrs) and `opusSupported === false` plainly.
- **Docs pass**: CLAUDE.md says crc-desktop has "eight CommonJS tests"; this lane adds six more (`srs-*.test.js`).
  `crc-desktop/README.md` should name `app/srs/`, `/srs`, `radioClient`, and that `app/node_modules/ws` is now needed.
- `srs-radio.js`, `lxsrs_v2`, `lxsrs-setup.js` and the `/srs-api/` proxy are untouched.
- Not checked: that Electron 43's Chromium accepts the Opus encoder config (`isConfigSupported`); the manual test
  below shows it in the state (`opusSupported`).

## Manual test against a real SRS server (supervisor)

Use a test SRS server, or the squadron server outside an event. Two machines (or this one plus the stock SRS client).

1. In `crc-desktop/config.json` set `"radioClient": "node"` (and `srsHost`/`srsPort` to the test server). Start with
   `cd crc-desktop && npm start`. lxsrs must **not** start (no `[lxsrs]` lines in the log).
2. DevTools console (the radio panel is not wired yet):
   ```js
   const e = await import('/js/radio/radio-engine.js');
   e.onState(s => console.log(JSON.stringify(s)));
   e.setIdentity({ name: 'CRC TEST' });
   e.setRadios([
     { id: 'GUARD:UHF', mhz: 243, modulation: 'AM', label: 'Guard', groupId: null },
     { id: 'MANUAL:a', mhz: 251, modulation: 'AM', label: 'Test A', groupId: 'g1' },
     { id: 'MANUAL:b', mhz: 122.1, modulation: 'AM', label: 'Test B', groupId: 'g1' },
   ]);
   ```
   Expect `opusSupported: true`, then `connected: true`, `udpReady: true` within a second or two. The SRS server's
   client list shows `CRC TEST` with radios 243.000, 251.000, 122.100.
3. **Receive**: from the stock SRS client on 251.000, talk. `rxRadioIds` lists `MANUAL:a`; you hear the start tone,
   the voice through the band-pass with a little noise, and the end tone about half a second after the other side lets
   go. `e.setRadioAudio('MANUAL:a', { muted: true })`: the lamp still lights, no sound. `{ pan: -1 }`: left ear.
4. **Transmit on a group**: `e.setPtt(true, 'MANUAL:a')`, speak, `e.setPtt(false)`. `txRadioIds` lists both
   `MANUAL:a` and `MANUAL:b` while down. Stock clients on 251.000 **and** on 122.100 each hear it once. Check the first
   word is not clipped and the voice is not harsh or clipping on loud syllables (the limiter).
5. **Unlinked**: `e.setPtt(true, 'GUARD:UHF')`: only 243.000 hears it.
6. **Devices**: `navigator.mediaDevices.enumerateDevices()` then `e.setDevices({ inputId, outputId })`; the sound moves
   to the chosen output. `await e.testMic()` returns a peak and plays 1.5 s back.
7. **Intercom**: add `{ id: 'INTERCOM', modulation: 'INTERCOM', label: 'Intercom' }` to the radios; pick a unit from
   `state.srsClients` with `e.setIntercomUnit(unitId)`; talk on it with a stock client in that unit.
8. **Resilience**: stop the SRS server: `connected: false`, retries at 1, 2, 5, 10, 30 s; start it again: it reconnects
   by itself. Reload the window: the SRS server sees the same GUID come back, not a second client.
9. **Windows**: repeat 2 to 4 on Windows (default `radioClient` there is `node`).
10. With `"radioClient": "lxsrs"` (or unset on Linux) the old panel works as before and `/srs` answers
    `enabled: false`.

## Tests (each run alone, `nice -n 19`)

`srs-protocol.test.js` 15, `srs-radio-slots.test.js` 7, `srs-sync-link.test.js` 7, `srs-voice-link.test.js` 3,
`srs-session.test.js` 6, `srs-route.test.js` 5, `srs-frame-parity.test.mjs` 3, `radio-core-pure.test.mjs` 8,
`radio-core-audio.test.mjs` 11: 65 new, all passing. Fixtures from the Python, generated once by hand:
`tests/fixtures/srs/make-fixtures.py` (packets, sync lines) and `make-voice-processor-fixture.py` (needs numpy).
