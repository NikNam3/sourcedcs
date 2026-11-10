# 0158: The radio is part of crc-desktop: position radios, VHF per Position, linked frequencies

**Status.** Proposed (2026-11-10). Replaces the Python SRS bridge (`crc-desktop/python-pkg/lxsrs_v2`, `lxsrs-setup.js`,
the `/srs-api/` proxy) once built. Amends, without editing (P4): ADR 0131 and 0138 (a Position's frequency rows gain a
band, and the radio panel reads them). [SOURCE-DEFINED]: the human's request and rulings of 2026-11-10 in session (including: the first row of a band is the Position's radio).

## Context

The radio panel (`app/public/js/srs-radio.js`) is a front end for a separate Python process, `lxsrs_v2`. At first run,
crc-desktop creates a venv and pip-installs `opuslib`, `numpy`, `sounddevice` and `scipy` against whatever `python3` the
machine has. On Linux it plays through PulseAudio directly (`pulse.py`). The renderer talks to the process over a local
HTTP API that it polls every 200 ms. The result is fragile on Windows, depends on the user's Python, and feels like a
separate app: the radios are typed in by hand and know nothing about the Positions the controller staffs.

The human asked for four things:

- **(A)** Staffing a Position creates its radios in the panel.
- **(B)** Each Position has an optional VHF frequency besides its UHF one. The panel's radios belong to Positions, one
  UHF and one VHF each.
- **(C)** When one controller staffs several Positions, their radios are linked: a transmission on any linked radio
  goes out on all the others, both the controller's and a pilot's.
- **(D)** ATIS gets a VHF frequency and transmits on both.

Rulings:
- Links are automatic, with a per-radio unlink toggle.
- Manual extra radios stay.
- Both guards (243.000 UHF and 121.500 VHF) are always present and **separate**: they are not linked to each other or
  to anything else by default.
- The controller can create **multiple link groups** of their own.
- A relay must **never loop**. Audio the relay itself put on the air arrives back as an ordinary received transmission,
  and it must never be sent again.

## Decision

### 1. The SRS client moves into crc-desktop, with no native dependency

- **Network (Node, the bundled local server `app/`).** It is a port of `protocol.py` and `client.py`:
  - the TCP sync link: newline-delimited JSON `{Client, MsgType, Version}`, SYNC/UPDATE/RADIO_UPDATE/PING, reconnect;
  - the UDP voice socket: the `<HHH>` header, `<dBB>` frequency segments, `<IQB>` unit/packet/retransmission, the two
    22-byte GUIDs, and the keepalive.

  Node's `net` and `dgram` cover it. The protocol version string (`2.3.3.3` today) stays a constant in one module.
- **Audio (the renderer).**
  - The microphone comes from `getUserMedia`, and an `AudioWorklet` cuts it into 20 ms frames at 48 kHz mono.
  - Opus encoding and decoding use **WebCodecs** (`AudioEncoder`/`AudioDecoder`, codec `opus`, 32 kbit/s, as
    `client.py` uses today). Chromium ships it, so it is the same on Linux and Windows.
  - Playback is Web Audio with one decoder per sender, mixed in the graph. This replaces `OptionalOpusPlaybackSink`'s
    mixing thread.
  - The output device is chosen with `AudioContext.setSinkId`, the input with `getUserMedia`'s `deviceId`.
  - `effects.py`'s radio effects (band-pass, noise, start/end tones) become Web Audio nodes.
- **Between them**, a local WebSocket `/srs` on the bundled server carries binary Opus frames and JSON control and
  state messages. It replaces the 200 ms HTTP polling. It is loopback only, like the rest of the local server.
- **If WebCodecs reports no Opus support** (`AudioEncoder.isConfigSupported`), the panel says so plainly and transmits
  nothing. It does not silently fall back. A WASM Opus build is the fallback, added only if a real machine needs it.
- **PTT** stays window-focused, as today: `ptt-controller.js` with its max-TX watchdog. A global hotkey would need a
  native keyboard hook and is not part of this ADR.

### 2. The radio set is derived, not typed

The panel's radios are a pure function of four inputs: the Positions this session staffs, the frequency table rows
(ADR 0131/0138), the guards, and the controller's manual radios. Three kinds:

| Kind | Where it comes from | Removed when | Link group |
|---|---|---|---|
| `POSITION` | the Position's first UHF row and first VHF row, if it has one | the controller leaves the Position | the automatic Position group |
| `GUARD` | always 243.000 AM and 121.500 AM, each its own radio | never | none (separate), unless the controller links it |
| `MANUAL` | added by the controller, kept in `settings.js` | the controller removes it | none, unless the controller links it |

- A frequency table change reaches the radio at once, because the radio is recomputed from the table.
- A radio's volume, pan and mute are kept per **radio identity**: `POSITION:<positionId>:<band>`, `GUARD:<band>` or
  `MANUAL:<id>`. They are not kept per frequency, so a retune keeps the controller's settings.
- **Link groups.**
  - One group is automatic: every `POSITION` radio of every Position the session staffs is in it unless unlinked
    (requirement C).
  - The controller can create further groups, named by the controller (or A, B, C by default), and move any radio into
    one: a Position radio, a guard or a manual radio.
  - A radio is in at most one group, and an unlinked radio is in none.
  - Group membership is kept in `settings.js` by radio identity, so a group survives a retune and a restart.
  - A Position radio that the controller moved into another group stays there when the Position is staffed again.
  - **A frequency is in at most one group per client.** If two radios with the same frequency would end up in two
    groups, `radio-set.js` keeps the first and marks the second as conflicting in the panel. Otherwise one received
    packet would belong to two groups, and the relay would have two answers.
- The transmit selection is the link group. Pressing PTT transmits on the selected radio's whole group. With an
  unlinked radio selected, it transmits on that radio alone.

### 3. VHF per Position: a band on the frequency row (amends 0131/0138)

- The band is **derived from the frequency**: VHF from 118.000 to 136.975 MHz, UHF from 225.000 to 399.975 MHz. A row
  outside both bands is valid in the table but gets no Position radio, and the panel says so.
- No new key is added to the facility files or to `state/efsp-frequencies.json`. A Position gets its VHF by adding a
  second `positionFrequencies` row (for example `{ "label": "TWR VHF", "mhz": 122.1 }`) in the facility file, or by an
  AddFrequency at run time (ADR 0138).
- **One radio per band per Position.** The first row of each band, in table order (shipped rows first, then added rows
  in the order they were added), is the Position's radio. Any further rows of that band stay in the FREQUENCIES panel,
  and the controller can add them as manual radios. The shipped facility files get VHF rows only where the squadron
  names a frequency; until then those Positions have UHF only.
- The shared band ranges live in one small module on each side (`crc-sync/src/radio/bands.js`,
  `app/public/js/radio/bands.js`), held equal by a parity test.

### 4. Linked frequencies

**Controller side.** An SRS voice packet carries a list of frequencies. A transmission on a link group is **one packet
stream** with every frequency of the group in it. Every listener tuned to any of them hears it once, and nothing is
retransmitted.

**Pilot side (relay).** When a packet arrives on a frequency in a linked group, the client that holds that group's
**relay lease** re-sends the same Opus frames on the group's *other* frequencies, with:

- `retransmissionCount + 1`;
- the original `transmissionGuid`, so a listener tuned to two of the frequencies can de-duplicate;
- its own `clientGuid` and `unitId`.

**No loop.** The relay's own output is heard again: the SRS server sends it to everyone tuned to the target
frequencies, and that can include this client, because it also listens on the group's frequencies. Any other relay on
those frequencies hears it too. `relay.js` drops a packet, and never re-sends it, when **any** of these holds. Each
check catches the loop on its own, so a bug in one does not reopen it:

1. **It is our own.** Its `clientGuid` is this client's, whether we transmitted it or relayed it. The relay sends
   under its own `clientGuid`, so its output is always recognised as its own.
2. **It is already a relay.** Its `retransmissionCount` is ≥ 1. This catches another controller's relay output, so
   relays never chain, and the chain is at most one hop.
3. **It is a copy of a transmission we know, arriving the wrong way.** `relay-seen.js` remembers, for 30 seconds after
   its last packet:
   - every `transmissionGuid` we originated: always dropped;
   - for every transmission we relay, the frequency and `clientGuid` its first packet came in on.

   A transmission is a stream of packets with one `transmissionGuid`, so the pilot's later packets must still be
   relayed. They are relayed only when they arrive on that same entry frequency from that same sender. The same
   `transmissionGuid` arriving on any other frequency, or from any other sender, is a copy coming back and is dropped.
   This catches a copy that returns on a second frequency, and a server that resets `retransmissionCount`.
4. **We are transmitting on that group.** While this client's PTT is down on a group, nothing is relayed into that
   group. Our own voice already goes out on every frequency of the group (controller side above), and relaying a pilot
   over it would only step on both.

Every check is a unit test in `relay.js`. The tests include:
- the round trip "relay a packet, feed the relay's own output back in, expect nothing sent";
- each check disabled in turn, with the loop still closed by the others;
- a pilot's 200-packet transmission relayed in full, not just its first packet. The soak-style test sends a stream of packets through two simulated relays that share a
frequency and asserts the number of packets on the air stays constant.

**The lease.** If two controllers both linked the same frequencies, both would relay the pilot and every listener would
hear double. Two controllers who both link guard, or two who share a Position frequency in their own groups, make
this a normal case, not an edge case. So **crc-sync grants relay leases per frequency**:

- A client asks for its groups' frequencies on `/feed`. crc-sync grants each frequency to one session, the first to ask.
- A lease ends when the session closes, unlinks or leaves the Position, and then passes to the next session that asked.
- A client relays a packet only onto frequencies it holds the lease for, and only from frequencies in the same group.
- Two controllers whose groups overlap therefore relay without doubling. The overlapping frequencies are relayed by one
  of them.

This is new wire: a message family (`radio-relay`: claim, release, grant, revoke) and a hub frame. It goes through
`wire/frames.js` and `WsHub#deliverEfsp` like every other frame, and is recorded with `npm run wire:record`. The lease
table is in-memory only. A restart drops every lease, and the clients claim again when they reconnect.

**Unlink.** A radio taken out of its group transmits and receives on its own. It is not part of the group's packets
and holds no lease for the group. Relinking puts it back. Moving a radio to another group releases its frequency's
lease for the old group and claims it for the new one.

**To verify against the SRS source before step 4 is built:**

- that SRS clients de-duplicate on `transmissionGuid` across frequencies;
- what the SRS server does with `retransmissionCount`, including whether it enforces a node limit and whether a server
  setting disables retransmission.

If the server refuses retransmitted packets, the pilot-side relay waits on that setting, and the controller side
still works.

### 5. ATIS on two frequencies

- The per-airport ATIS config (`apt-config.js`, `settings.aprtAtisFreq`) gains an optional VHF frequency beside the
  existing one.
- `POST /api/atis-transmit` takes `frequencies: [..]` (one or two). crc-sync starts one DCS-gRPC SRS `Transmit` per
  frequency, concurrently. DCS-gRPC's `TransmitRequest` has a single `frequency`.
- `AtisStore` keeps its ownership per frequency, so a second client is refused on either frequency.
- `atisActive` lists both.
- The loop's next tick waits for both calls to finish.

### 6. Module layout: no god files

Each file has one job, and none should grow past about 300 lines; a file that would is split by job. The radio has no
central "radio manager" object. The state is a leaf module that the others read and write, as in ADR 0095 §6.

`crc-desktop/app/srs/` (Node, CommonJS like the rest of `app/`):

| File | Job |
|---|---|
| `voice-packet.js` | UDP voice packet encode/decode (pure) |
| `sync-message.js` | the TCP JSON messages, `Client`/`RadioInfo` shapes, message types, version constant (pure) |
| `srs-guid.js` | the 22-character SRS GUIDs |
| `sync-link.js` | the TCP connection: connect, reconnect, ping, radio updates |
| `voice-link.js` | the UDP socket: send, receive, keepalive |
| `relay.js` | which received packets to re-send, and where (pure; inputs: the groups, the leases, the PTT state, the packet) |
| `relay-seen.js` | the expiring table of transmission GUIDs already originated or relayed (§4 check 3) |
| `srs-route.js` | the `/srs` local WebSocket: binary frames in and out, control messages |

`crc-desktop/app/public/js/radio/` (ES modules):

| File | Job |
|---|---|
| `radio-set.js` | derives the radios from Positions, frequency rows, guards and manual radios (leaf, pure) |
| `link-groups.js` | the automatic Position group and the controller's groups, one frequency per group per client (leaf, pure) |
| `radio-prefs.js` | per-radio-identity volume, pan and mute, devices, PTT key (leaf) |
| `bands.js` | the VHF and UHF ranges (leaf; parity with crc-sync) |
| `mic-capture.js` | `getUserMedia`, the worklet, 20 ms frames |
| `mic-worklet.js` | the `AudioWorkletProcessor` |
| `opus-codec.js` | the WebCodecs encoder and decoder wrappers |
| `rx-mixer.js` | per-sender decoders and per-radio gain and pan into the Web Audio graph |
| `radio-effects.js` | band-pass, noise, start and end tones |
| `srs-socket.js` | the renderer's end of `/srs` |
| `relay-lease.js` | claims and releases leases on `/feed`, holds the grants (leaf state + one sender) |
| `radio-panel.js` | the DOM: draws the radio set, handles clicks |
| `ptt-controller.js` | existing, kept |

crc-sync: `src/radio/bands.js`, `src/radio/relay-leases.js` (the lease table) and one wire family file under
`src/efsp/wire/families/` (or a `src/radio/` handler bound in `app/`, wherever the hub's non-EFSP families live).

The import graph stays acyclic (`tests/module-graph.test.mjs`, bound 0), and nothing goes on `window`.

### 7. What is removed

These go only after steps 2 to 5 run on a real SRS server, on Linux and Windows:

- `crc-desktop/python-pkg/`, `lxsrs-setup.js` and its test;
- the venv provisioning in `main.js`, the `extraResources` entry in `package.json`'s `build`;
- the `/srs-api/` proxy in `app/server.js`, and `srs-radio.js`.

`packaging-config.test.js` is updated in the same commit. crc-sync's own `srs-client.js` (the transponder client) is a
separate thing and is untouched.

## Build order

1. This ADR.
2. **SRS core in Node and audio in the renderer, at parity with today's panel** (manual radios, the current feature
   set). `lxsrs_v2` stays as is, and a setting chooses which client the panel uses.
3. **The derived radio set**: Position radios, guards, VHF bands, link groups (§2, §3). The groups take part in transmit only; the relay comes in step 4.

   Steps 2 and 3 can run as parallel lanes: 3 is pure and DOM, 2 is network and audio, and their only contact is
   `radio-set.js`'s output shape.
4. **Linking and relay** (§4), including the crc-sync lease family and the wire record.
5. **ATIS on two frequencies** (§5).
6. **Removal** (§7).

## Consequences

- crc-desktop no longer needs Python. The radio works the same on Linux and Windows, and the first launch no longer
  waits for a venv.
- The panel follows the controller's Positions. A frequency table change retunes the radio at once.
- One controller staffing several Positions is heard by pilots on every frequency of those Positions, and pilots hear
  each other across them, as on a combined position's retransmitted frequencies.
- A relayed pilot transmission arrives one hop later on the other frequencies. A relay depends on a lease holder being
  connected. If the lease holder's client hangs without closing, its lease lasts until crc-sync sees the socket drop.
- The wire grows a family, so this is a crc-desktop release with a protocol bump.
- Testing:
  - `voice-packet.js`, `sync-message.js`, `relay.js`, `radio-set.js`, `bands.js` and the lease table are pure and get
    unit tests;
  - packet encoding is checked against bytes captured from `protocol.py`, before it is deleted;
  - audio is checked by hand on a real SRS server.

## Open questions

- A global PTT hotkey (§1) is wanted, but not in this ADR.
