# Questions: radio rework, wave 1 (ADR 0158 steps 2 and 3)

Written by the questioner on 2026-11-10, on `main` at 517f770b. Read-only: nothing here changed code. Sources: ADR 0158,
`docs/parallel/radio/{README,RADIO-CORE,RADIO-SET}.md`, `crc-desktop/python-pkg/lxsrs_v2/{protocol,models,client,audio,effects,api,__main__}.py`,
`crc-desktop/{main.js,lxsrs-setup.js,config.json,package.json}`, `crc-desktop/app/{server.js,package.json}`,
`app/public/js/{srs-radio.js,ptt-controller.js,settings.js,dock.js}`, `panels/efsp/{frequency-state,efsp-ws,efsp-state,facility-topology,combination-rules,efsp-change-bus}.js`,
`crc-sync/config/efsp-facility-*.json`. Paths below are under `crc-desktop/` unless they say otherwise.

Nothing the ADR or the two briefings already settle is asked again. SRS facts that come from memory of the SRS C# source,
not from this repo, are marked **verify**: the lane checks them before relying on them.

## Summary

| Id | Lane | One line |
|---|---|---|
| RQ1 | CORE | Frames are 40 ms in `client.py` (SRS's jitter buffer reads 40 ms), the ADR says 20 ms |
| RQ2 | CORE | The two 22-byte GUIDs: `protocol.py`'s `transmission_guid` is the client GUID, there is no per-transmission GUID |
| RQ3 | CORE | SYNC contents: today Name `lxsrs_v2`, Coalition 0, unitId 1, no EAM password |
| RQ4 | CORE | TCP: `client.py` never pings and never reconnects; what to send, and GUID across reconnects |
| RQ5 | CORE | RX matching: frequency tolerance, modulation, encryption, 8.33 channel names |
| RQ6 | CORE | One packet on several of my radios, and a radio that is transmitting: play once, play where |
| RQ7 | CORE | Jitter buffer, loss and end of transmission (no buffer in Python, 450 ms end timeout) |
| RQ8 | CORE | `getUserMedia` processing flags, mic always open, 48 kHz context, worklet path |
| RQ9 | CORE | Device ids: origin-scoped, and the saved Pulse source names do not carry over |
| RQ10 | CORE | `/srs` WebSocket: no `ws` in `app/package.json`, and `server.js` listens on every interface |
| RQ11 | CORE + supervisor | The client switch: lxsrs plays audio itself and spawns on Linux only |
| RQ12 | SET + CORE | Who owns the PTT controller, and two panels bound to the same key |
| RQ13 | SET + CORE | SRS has 11 radio slots, and two radios on one frequency |
| RQ14 | SET | "Staffs": signed on (Primary + Observer) or acting (Primary); optimistic or acked; across a crc-sync drop |
| RQ15 | SET | 14 of the 16 shipped Positions have no frequency row, so no radio |
| RQ16 | SET | `bands.js`: boundaries, float compare, and where the parity test lives |
| RQ17 | SET | Persistence: one key in `settings.js` or the old `srs_pref_*` keys; PTT target fallback |
| RQ18 | SET | Which of `srs-radio.js`'s features wave 1 ports (intercom, FM, sound sets, mic test, gains) |
| RQ19 | SET | First run: seed manual radios from `config.json` `freqs`, or start with none |

Most valuable first: RQ1, RQ2, RQ11, RQ13, RQ14, RQ15, RQ10.

---

### RQ1: 20 ms or 40 ms Opus frames   [lane: RADIO-CORE]
- Context: ADR 0158 §1 and RADIO-CORE.md say "20 ms frames at 48 kHz", "960-sample frames". `client.py:28-32` sends
  **40 ms** frames at 16 kHz, with the comment: "40 ms frames, what the SRS client itself sends (Common/Constants.cs
  MIC_INPUT_AUDIO_LENGTH_MS): its receive jitter buffer reads 40 ms at a time, so a sender's packets should be that long."
  The sample rate does not matter to a receiver (an Opus decoder outputs at whatever rate it is opened at). The frame
  length does, if real SRS clients buffer per 40 ms.
- Question: What frame duration does the Node client put on the air?
- Options: (a) 20 ms as the ADR says; (b) 40 ms, as `client.py`: the worklet may still cut 960-sample (20 ms) blocks, and
  the WebCodecs encoder is configured `opus: { frameDuration: 40000 }` so each output chunk, and each UDP packet, is 40 ms;
  (c) 40 ms and the worklet cuts 1920-sample blocks.
- **Recommended: (b).** It keeps the interop finding that `client.py` already paid for, and the worklet stays simple.
  48 kHz mono, 32 kbit/s, `application: 'voip'`, `complexity: 10` as `client.py:286-288`. Log it as a correction of the
  ADR's "20 ms" in `docs/wip/RADIO-CORE.md`; the supervisor amends the ADR text.

### RQ2: What the two 22-byte GUIDs are   [lane: RADIO-CORE]
- Context: `protocol.py` decodes the tail as `transmission_guid` then `client_guid`, and `client.py:315-316` sends
  **both as the client's own GUID**, on every packet of every transmission. So no code here has ever made a
  per-transmission GUID, and nothing proves the first field is one. **Verify:** in the SRS source (`UDPVoicePacket.cs`)
  the two fields are, as I recall, the sender's `Guid` and the `OriginalClientGuid` (the first transmitter, kept by a
  retransmitting radio), not a transmission id. ADR 0158 §4 check 3 ("every `transmissionGuid` we originated", "the same
  `transmissionGuid` arriving on another frequency") depends on what this field really is.
- Question: How does `voice-packet.js` name the fields and what does step 2 put in them?
- Options: (a) name them as `protocol.py` does and send the client GUID in both (parity); (b) name them after the SRS source
  (`guid`, `originalGuid`, order as SRS has it) and send the client GUID in both; (c) generate a fresh GUID per PTT press
  for the first field, as the ADR's wording implies.
- **Recommended: (b), byte-for-byte equal to (a) on the wire.** Step 2 sends exactly what `client.py` sends, so the
  fixtures match; the names say what the field is. `docs/wip/RADIO-CORE.md` records what the SRS source says about the
  two fields, about de-duplication, and about `retransmissionCount` and the server's retransmission node limit (the
  ADR's "to verify" list). If SRS has no per-transmission GUID, step 4's check 3 must key on `originalGuid` plus packet
  number instead; that is a supervisor amendment before step 4, not a step-2 change. Never send (c) to a real server
  before that is settled: a GUID SRS reads as `originalGuid` that matches no client could change how receivers treat it.

### RQ3: What the SYNC message carries for a controller   [lane: RADIO-CORE]
- Context: `main.js:40` calls `lxsrsArgs(config)` (`lxsrs-setup.js:117-128`), which passes only host, port, freqs, txFreq,
  defaultFreq and the API port. So today every controller joins SRS with `Name: "lxsrs_v2"` (`__main__.py:17` default),
  `Coalition: 0` (spectator), `unitId: 1` (`client.py:107-111`, "a fixed shared value so all lxsrs_v2 clients land on the
  same intercom group"), `LatLngPosition` all zero, `Seat: 0`, `AllowRecord: false`, and radio `Name`/`Model` `linux1..11`.
  It never sends `EXTERNAL_AWACS_MODE_PASSWORD` (MsgType 7). It works on the squadron server today with that.
- Question: What does `sync-message.js` send?
- Options: (a) exact parity, `lxsrs_v2` included; (b) parity except `Name`: the renderer passes a display name over `/srs`
  (the signed-in controller, e.g. from the snapshot's `self.controllerId`, else `CRC`), and each radio's `Name` is its
  label cleaned as `models.py` `_clean_radio_label` does (alphanumeric, lower case, 32 chars), `Model` `crc`;
  (c) (b) plus External AWACS Mode with a coalition password, coalition from `CRCSYNC_COALITION`.
- **Recommended: (b).** Coalition 0, unitId 1, no EAM, as today: the server accepts that now, and EAM needs a password
  nobody has configured (log it as a deferred option, not a new config key). The name is the one change, because 20
  controllers all called `lxsrs_v2` in the SRS client list is today's bug, not a feature. `radioIndex` is the slot of the
  PTT target, as `client.py:122`.

### RQ4: The TCP link: ping, reconnect, GUID   [lane: RADIO-CORE]
- Context: RADIO-CORE.md asks for "PING on the keepalive" and "reconnects with backoff". `client.py` has neither: it never
  sends MsgType PING on TCP (only the UDP GUID every 15 s, `client.py:27, 194-198`), and `_tcp_loop` simply returns on
  EOF (`:164-167`), leaving UDP running. So there is no Python behaviour to port for either; it is new.
- Question: What does the sync link send, and what survives a reconnect?
- Options: (a) no TCP ping, as `client.py`, rely on `socket.setKeepAlive`; (b) a TCP PING every 15 s alongside the UDP
  keepalive, and treat 45 s with nothing received (TCP or UDP echo) as dead; (c) a RADIO_UPDATE every 15 s as the keepalive.
- **Recommended: (b), with the GUID kept for the whole app run** (one GUID per launch, not per connection), reconnect
  backoff 1, 2, 5, 10, 30 s capped, a SYNC then a RADIO_UPDATE after each reconnect, and the UDP socket re-opened and its
  GUID re-sent with it. UDP "ready" stays what `client.py:VoiceProtocol` uses: the server echoes the 22-byte GUID. A
  transmission is refused (state `error`) while UDP is not ready. **Verify** in the SRS server source that a PING is
  accepted silently and that a reconnect with the same GUID replaces the old entry rather than being refused.

### RQ5: Which radio a received packet is for   [lane: RADIO-CORE]
- Context: `client.py:on_voice_packet` plays every packet the server sends, whatever its frequency, and picks the volume of
  the first radio within **1 kHz** of the packet's first frequency (`_get_radio_volume`, `:648-654`). It ignores modulation
  and encryption. The table allows 8.33 kHz channel **names** in the airband (`frequency-state.js:frequencyChannelProblem`,
  offsets 5/10/15 kHz), so a row can say `122.105`. The contract gives the engine `mhz` (a float) and `modulation`.
- Question: How does `voice-link.js` match a packet frequency to `radioIds`?
- Options: (a) parity: 1 kHz on frequency only; (b) frequency in integer Hz (`Math.round(mhz * 1e6)`) within SRS's own
  tolerance, **and** the same modulation, and drop a segment with `encryption != 0`; (c) exact equality in Hz.
- **Recommended: (b).** The tolerance is SRS's (**verify**: `RadioBase`/`FreqCloseEnough` is, as I recall, under 1 kHz,
  about 500 Hz; use whatever it is, as one constant in `voice-packet.js` or a small `frequency-match.js`). Modulation is
  part of a channel in SRS (AM 121.5 is not FM 121.5). A channel name is tuned literally: `122.105` goes on the air as
  122 105 000 Hz, no 8.33 name-to-frequency conversion, because SRS and DCS radios do none. A packet that matches no radio
  is dropped and counted in the state (it means the server routed something we did not ask for).

### RQ6: One packet on several of my radios; a radio that is transmitting   [lane: RADIO-CORE]
- Context: The contract's RX message carries `radioIds` (plural). A linked transmission from another CRC carries every
  frequency of its group in one packet (ADR §4), and two of my radios can share a frequency (RQ13). Per-radio volume,
  pan and mute are per radio. `client.py` plays a packet once.
- Question: How many times is it played, and at what gain and pan?
- Options: (a) once per matched radio (each through its own gain and pan); (b) once, through the loudest unmuted matched
  radio's gain and pan, every matched radio lit RX; (c) once, through the first matched radio in panel order.
- **Recommended: (b).** Playing it per radio doubles a voice whenever two radios match, and the controller hears an echo.
  Muted radios do not count; all matched radios muted, it is not played but the RX lamps still light (dark cockpit: the
  controller sees traffic on a muted radio). Also: while this client's PTT is down on a group, packets for that group's
  frequencies are not played (a radio that is transmitting does not receive, as in SRS and in a real set); guard and other
  groups keep playing. That is local playback only, not ADR §4 check 4 (which is about the relay).

### RQ7: Jitter buffer, loss and end of transmission   [lane: RADIO-CORE]
- Context: Python has no jitter buffer: `OptionalOpusPlaybackSink` decodes on arrival into a 50-frame deque and a 20 ms
  mixer tick drains it (`audio.py:43-139`); a late packet is a gap. End of a transmission is 450 ms of silence from a sender
  (`client.py:_run_rx_monitor`, `RX_TIMEOUT = 0.45`), which plays the end tone and frees the decoder. WebCodecs'
  `AudioDecoder` has no PLC or FEC call.
- Question: What does `rx-mixer.js` do with timing?
- Options: (a) play each decoded frame as soon as it is decoded; (b) a per-sender playout buffer: start a transmission
  after a fixed delay (60 to 80 ms), schedule decoded `AudioBuffer`s back to back on the context clock, reorder by packet
  number inside the buffer, drop a packet that arrives after its slot, leave silence for a lost one; (c) an adaptive
  buffer.
- **Recommended: (b) at 80 ms (two 40-ms frames).** Simple, testable as a pure scheduler (input: arrival times and packet
  numbers; output: play times), and it closes the gaps (a) has on any real link. Keep the 450 ms end-of-transmission
  timeout and the per-sender decoder freed with it, as Python. If the scheduled time falls more than 200 ms behind the
  context clock, restart the stream rather than drift.

### RQ8: Microphone capture settings   [lane: RADIO-CORE]
- Context: Chromium turns on `echoCancellation`, `noiseSuppression` and `autoGainControl` by default in `getUserMedia`.
  The Python chain had none of them, only gain and the limiter (`audio.py:VoiceProcessor`), which the briefing says to
  keep. Python kept the mic open and drained stale frames on PTT (`client.py:265-268`). The page is
  `http://localhost:<wsPort>` (`main.js:147`), a secure context, so `getUserMedia` and `AudioWorklet` work; there is no
  CSP in `index.html`, and `main.js` sets no permission handler (Electron grants media by default).
- Question: What constraints, when is the mic open, and how is the worklet loaded?
- Options: (a) Chromium defaults, mic opened on PTT; (b) all three processing flags **off**, mic open while the radio is
  connected, frames dropped unless PTT is down, `new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })` so
  Chromium resamples any device rate; (c) as (b) with noise suppression on.
- **Recommended: (b).** AGC fights the limiter and EC clips the start of a call; a controller wears a headset. Opening the
  mic on PTT costs 100 to 300 ms and clips the first word. The worklet loads with
  `audioWorklet.addModule('/js/radio/mic-worklet.js')` (an absolute path the static server already serves; no import from
  it, so it does not enter the module graph test as a cycle). On PTT down, reset the encoder (or `flush()` then reuse) so
  no stale audio leads the call.

### RQ9: Device ids and the saved Pulse names   [lane: RADIO-CORE (engine), RADIO-SET (pickers)]
- Context: `srs-radio.js` saves `srs_pref_mic` / `srs_pref_sink` as **PulseAudio source and sink names**
  (`alsa_input.usb-...`). WebRTC `deviceId`s are different strings, hashed per origin (`http://localhost:3100`, so a changed
  `wsPort` changes every id), and `enumerateDevices` labels are empty until mic permission is granted.
- Question: What is saved, and what happens to the old preferences?
- Options: (a) migrate the Pulse names by matching them against labels; (b) save `{ deviceId, label }`, select by id, fall
  back to the same label, else the default device with one grey note "saved microphone not present"; ignore the old keys;
  (c) save the id only.
- **Recommended: (b).** A Pulse name never equals a Chromium label, so (a) would be a guess. The old keys stay where they
  are for the old panel. The engine takes ids through `setDevices`; the pickers (RADIO-SET) refresh the list on the
  `devicechange` event instead of the 5 s poll `srs-radio.js` uses.

### RQ10: The `/srs` WebSocket: library and who may connect   [lane: RADIO-CORE]
- Context: `app/package.json` has one dependency, `dotenv`; `server.js` is plain `http` with no upgrade handler. And
  `httpServer.listen(port)` (`server.js:191`) binds **every interface**, not loopback: the ADR's "loopback only, like the
  rest of the local server" is not true today. A LAN neighbour reaching `/srs` could key the controller's frequencies.
- Question: How is `/srs` served, and how is it kept local?
- Options: (a) hand-rolled RFC 6455 on `server.on('upgrade')`; (b) the `ws` package in `app/package.json` (crc-sync already
  uses it), `noServer: true` on `server.on('upgrade')` for path `/srs`; (c) (b) and change `listen` to `127.0.0.1`.
- **Recommended: (b), plus a per-connection check:** refuse the upgrade unless `req.socket.remoteAddress` is loopback
  (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) and `Origin` is `http://localhost:<wsPort>` (or `127.0.0.1`). Do not change the
  `listen` host in this lane: `localhost` can resolve to `::1` first and the window loads `http://localhost`, so that is a
  server-wide change for the supervisor (log it as a finding: the existing `/srs-api/` and `/api/sync-config` routes are
  open to the LAN too). Adding `ws` means `npm install` in `app/` and the lockfile; `tests/packaging-config.test.js`
  ("every app/package.json dependency is actually present") then needs `app/node_modules/ws` present.

### RQ11: How the panel chooses its client, given that lxsrs plays audio itself   [lane: RADIO-CORE, supervisor]
- Context: ADR build step 2: "`lxsrs_v2` stays as is, and a setting chooses which client the panel uses." But lxsrs is
  spawned by `main.js:68-74` at app start, before any renderer setting can be read, and it plays received audio straight
  to PulseAudio (`--play-audio`), whatever the panel does. With both running, the controller is two SRS clients and hears
  every call twice. And lxsrs is spawned **on Linux only** (`IS_LINUX`): Windows has never had a radio.
- Question: Where does the switch live?
- Options: (a) a renderer setting only (both clients run; double audio); (b) a `config.json` key, e.g.
  `"radioClient": "lxsrs" | "node"`, read by `main.js` (spawn lxsrs or not) and exposed in `/js/config.js` so the renderer
  mounts the matching panel; default `lxsrs` on Linux, `node` on Windows; (c) the renderer setting, and `main.js` kills or
  starts lxsrs over IPC when it changes.
- **Recommended: (b).** Only `main.js` can stop lxsrs from connecting, and Windows gains a radio at once. It is a new config
  key, so RADIO-CORE logs it as a default in `docs/wip/RADIO-CORE.md` as the briefing asks. The supervisor rules it,
  because it touches `main.js`, which neither lane owns.

### RQ12: Who owns the PTT controller   [lanes: RADIO-SET and RADIO-CORE]
- Context: Both briefings say to reuse `ptt-controller.js`. The contract has `setPtt(down, radioId)` on the engine, called
  by the panel. `createPttController` binds `keydown`/`keyup` on `document` and `blur` on `window`, and repeats
  `post('/ptt/start')` every 400 ms (`ptt-controller.js:11, 49-53`). The old panel already has one bound to the saved key
  (default `Space`, `srs-radio.js:36`). RADIO-SET mounts "RADIO 2" beside it.
- Question: Which lane creates it, and how do the two panels not both key on the same press?
- Options: (a) the engine creates it (RADIO-CORE); (b) the panel creates it (RADIO-SET), with
  `post: (p) => engine.setPtt(p === '/ptt/start', targetRadioId)`, and `setPtt(true)` is idempotent in the engine;
  (c) both.
- **Recommended: (b).** The key, the button and the max-TX preference are panel things, and the contract already makes the
  panel call `setPtt`. The engine treats the 400 ms repeat as a keepalive it may ignore (the audio frames stop by
  themselves if the renderer dies). The new panel binds its controller only when it is the selected client (RQ11);
  until then, in wave 1, it binds none, so the stub never fights the old panel for `Space`.

### RQ13: SRS's 11 slots, and two radios on one frequency   [lanes: RADIO-SET (radio-set.js) and RADIO-CORE (slots)]
- Context: SRS `RadioInfo` has `MAX_RADIOS = 11` slots (`models.py:9`, `srs-radio.js:202`). The derived set has 2 guards +
  up to 2 per staffed Position + manual radios: a controller combined at four Positions is at 10 before any manual radio.
  Two radios can also share a frequency: a manual radio on 243.000, two Positions with the same row, a Position row equal
  to a guard. ADR §2's conflict rule is about groups only.
- Question: Who caps the set, and how are duplicates tuned?
- Options: (a) the engine silently tunes the first 11; (b) the engine tunes **one SRS slot per distinct frequency and
  modulation** (duplicates share it, RX maps the packet to all their `radioIds`); `radio-set.js` counts distinct
  frequencies and, past 11, sets `conflict: 'no SRS slot (11 in use)'` on the overflow radios, in the order guards,
  Position radios (staffing order), manual radios (added order); (c) refuse to add a manual radio past the cap, and let
  Position radios overflow.
- **Recommended: (b).** Deduplicating first makes the cap rarely reached; the cap then lands on the least important radios
  and says so in grey on the row, in `radio-set.js` where it is pure and testable. The engine still refuses more than 11
  distinct entries and reports it in `error`, as a backstop. A duplicate radio is not itself a conflict unless the group
  rule makes it one.

### RQ14: Which Positions count as "staffed"   [lane: RADIO-SET]
- Context: `efsp-ws.js` offers two lists. `getSignedOnPositions()` is every Position the server has this controller at,
  **Primary or Observer**; `getActingPositions()` is Primary only (`:161-180`). Both are set optimistically by
  `sendEfspSetPositions` before the ack, and adopted from `efsp-positions-ack`; neither is cleared when the crc-sync socket
  drops (a reconnect re-declares, and an ack or coverage message may then drop one, `:197-240`). `efsp-ws.js` imports
  `sync.js`, so it is not a leaf. The ack marks change-bus topic `positions`, and so does a frequency delta
  (`frequency-panel.js:286`); the coverage message too when Primary/Observer changes (`:231`).
- Question: Which list feeds `radio-set.js`, and how does an Observer's Position appear?
- Options: (a) `getActingPositions()` only: an Observer gets no radio; (b) `getSignedOnPositions()`: Primary Positions get
  Position radios in the automatic group, an Observer's Position gets its radios **receive-only and unlinked**
  (`groupId: null`, a `receiveOnly: true` field, PTT refused on them); (c) both kinds the same.
- **Recommended: (b).** An Observer is there to listen (the OJT case: ADR 0105 offers an Observer no action), so hearing
  the frequency is the point, but keying it or linking it into the relay is acting. It is one new contract field, so the
  supervisor confirms it with RADIO-CORE (`receiveOnly` radios are tuned but never in a TX packet). The panel reads
  through an adapter in `radio-panel.js` (subscribing `onEfspChanged(['positions'], …)`), and passes plain arrays to
  `radio-set.js`, which stays pure. Radios follow the retained lists, so a crc-sync blip does not drop the controller's
  radios; a Position lost on reconnect drops its radio when the ack says so.

### RQ15: Positions with no frequency row   [lane: RADIO-SET]
- Context: Of the shipped Facilities only Incirlik has `positionFrequencies`, and only for GC (`GND 275.8`) and LC
  (`TWR 251`) (`crc-sync/config/efsp-facility-*.json`): 14 of the 16 shipped Positions have none. OPS, CD, AP, PAR, CTR, the four TACTICAL, the five CARRIER and
  every RANGES Position have **no row**, so the derived set gives a controller at AP or GCI nothing but the guards. The
  ADR covers a row outside both bands ("the panel says so"), not a Position with no row.
- Question: What does the panel show for a staffed Position with no row?
- Options: (a) nothing; (b) one grey line per such Position, `AP: no frequency (FREQUENCIES panel)`, in the automatic
  group's place; (c) a red warning.
- **Recommended: (b).** Dark cockpit: grey, once, no instruction beyond where the frequency is set (ADR 0138's
  AddFrequency). It is not a problem the controller caused, so not red. Log for the supervisor that the shipped facility
  files need UHF rows for the other Positions before step 3 is useful at most Positions: a squadron data question for the
  human, not a lane change.

### RQ16: `bands.js` edges and the parity test   [lane: RADIO-SET]
- Context: ADR §3: VHF 118.000 to 136.975, UHF 225.000 to 399.975. `frequency-state.js` `FREQUENCY_LIMITS` has the airband as
  `118 ≤ mhz < 137` with 8.33 names up to 136.990, and the SFA pool `225..399.975`. Float `mhz` values (`136.975`) compare
  unreliably as floats.
- Question: How are the edges written and compared, and where is the parity test?
- Options: (a) float `mhz >= min && mhz <= max`; (b) compare in integer kHz (`Math.round(mhz * 1000)`), both edges
  inclusive as the ADR states, so a valid 8.33 name above 136.975 (136.980, 136.990) gets no radio and the
  "outside both bands" note; (c) VHF up to `< 137.000`, to match the airband.
- **Recommended: (b).** The ADR is explicit and the note covers the edge. The parity test goes where the other ten do,
  `crc-desktop/tests/radio-bands-parity.test.mjs`, importing `crc-sync/src/radio/bands.js` by relative path as
  `facility-topology-parity.test.mjs` reads crc-sync's files (CLAUDE.md: both suites run for either lane).

### RQ17: Where the radio preferences live   [lane: RADIO-SET]
- Context: RADIO-SET.md says `radio-prefs.js` persists "through `settings.js`". `settings.js` is one object under
  `crc-desktop-settings`, with a `DEFAULTS` table, saved whole. `srs-radio.js` does not use it: it keeps
  `srs_pref_mic`, `srs_pref_sink`, `srs_pref_ptt_key`, `srs_pref_ptt_max_tx_s` as separate `localStorage` keys
  (`:16-19`), and lxsrs keeps radios, volumes, TX slot, sound set and noise in `lxsrs_v2_state.json` in userData.
- Question: What key, what shape, and what carries over?
- Options: (a) separate `radio_*` keys like the old panel; (b) one `radio` entry in `settings.js` `DEFAULTS`:
  `{ audio: { [radioId]: { volume, pan, muted } }, groups: [{ id, name }], membership: { [radioId]: groupId | null },
  manual: [{ id, mhz, modulation, label }], devices: { input: { deviceId, label }, output: {…} }, pttKey, maxTxS,
  pttTarget, soundSet, noise, inputGain, outputGain }`; first load copies `srs_pref_ptt_key` and `srs_pref_ptt_max_tx_s`
  if set; (c) (b) without the copy.
- **Recommended: (b).** One leaf-readable place, as the briefing asks, and the controller keeps the PTT key they set.
  Unlinked is stored as explicit `null` (so "moved out of the automatic group" survives a restart and re-staffing), an
  absent membership means "default for its kind". `pttTarget` is a radio identity; if that radio is gone, the target falls
  back to the automatic group, else the first radio, and the fallback is not saved. `maxTxS` stays clamped by
  `clampMaxTxSeconds`.

### RQ18: Which of the old panel's features wave 1 ports   [lane: RADIO-SET (UI), RADIO-CORE (engine)]
- Context: `srs-radio.js` + `api.py` offer: per-radio volume 0 to 5x; input and output gain 0 to 5x (input default **0.5**,
  `__main__.py:44`); mic and speaker pickers; mic test (records 1.5 s, plays it back with the peak, `client.py:774-837`);
  five TX sound sets (`effects.py:TX_SOUNDS`) and a noise toggle; AM/FM cycle per radio; **intercom** (one radio at slot 0,
  modulation INTERCOM, unitId picked from the SRS client list, `client.py:461-497`, `srs-radio.js:560-605`); a connection
  dot; the panel hidden while disconnected. The max-TX time has no UI (a `localStorage` value only). The contract has no
  modulation other than AM, and no engine call for gains, sound set, noise, mic test or the SRS client list.
- Question: What is in wave 1, and what joins the contract?
- Options: (a) everything, intercom included; (b) everything but intercom: FM for manual radios only, gains, sound set,
  noise, mic test, pickers, connection dot; intercom logged as not ported, for the human; (c) the minimum (radios, volume,
  devices, PTT key).
- **Recommended: (b).** Intercom rests on the shared `unitId: 1` trick, which also is the unit every relay packet will
  carry (ADR §4), so it wants its own ruling. The rest is small and the controller uses it. The supervisor adds to the
  contract: `setAudioOptions({ inputGain, outputGain, soundSet, noise })`, `testMic()`, and `modulation: 'AM' | 'FM'`.
  RADIO-SET's stub implements them as no-ops; RADIO-CORE implements them. Noise follows `effects.py` (loops while any RX
  or our own TX is active, 0.12 of full scale, by modulation).

### RQ19: First run: what manual radios the new panel starts with   [lane: RADIO-SET]
- Context: `config.json` ships `"freqs": ["251.000", "305.500"]`, `"txFreq": "251.000"`, `"defaultFreq": "251.000"`; lxsrs
  starts with those and then keeps the controller's own set in `lxsrs_v2_state.json` (userData). The renderer cannot read
  either today (`/js/config.js` carries only the crc-sync and Casdoor values, `server.js:67-74`). 251.000 is already LC's
  Position frequency.
- Question: Does the new panel seed manual radios?
- Options: (a) seed from `config.json` `freqs` (needs `/js/config.js` to expose them); (b) import `lxsrs_v2_state.json`;
  (c) start with none: Position radios and guards cover the controller, `defaultFreq` (if exposed) only prefills the
  add-radio input.
- **Recommended: (c).** The point of step 3 is that radios come from staffing; seeding 251.000 would duplicate LC's radio,
  and importing the Python state file ties the new panel to what step 6 deletes. Log 305.500 as a frequency the human may
  want as a Position row or a standing manual radio.
