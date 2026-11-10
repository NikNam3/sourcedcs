# 0160: The relay is crc-sync, and overlapping link groups merge into networks

**Status.** Built (2026-11-10). Supersedes ADR 0159 §2 (the run table, check 3) and §3 (the lease family) and the
client relay of ADR 0158 §4; keeps ADR 0159 §1's relayed packet with the changes below. Neither 0158 nor 0159 is edited
(P4). [SOURCE-DEFINED]: ruling H186 (the relay is server-side; overlapping groups merge; controllers' own transmissions
included), H184 (`RETRANSMISSION_NODE_LIMIT` is 1 on the squadron server), H183 (the intercom is never relayed), and the
SRS source (ciribob/DCS-SimpleRadioStandalone master, read 2026-11-10; `docs/wip/RADIO-SRELAY.md`).

## Context

ADR 0159 had each crc-desktop relay its own link groups, with crc-sync granting a lease per frequency so that two
controllers on the same frequencies would not both relay. That left three costs: a controller's client had to be up,
on the built-in radio and connected to SRS for its pilots to be relayed; two controllers whose groups overlapped only
partly split the frequencies, so a pilot was heard only inside the lease holder's group, not across both; and every
client carried a loop-proof relay with a run table (check 3), because several relays could hear each other. The human
ruled (H186) that crc-sync is the one relay, and that overlapping groups merge.

## Decision

### 1. One relay, in crc-sync

crc-sync is the only relay node on the SRS server. No client relays, and there are no leases. crc-desktop only tells
crc-sync its link groups. The relay works whether or not any controller's own radio is connected to SRS. The groups come
from the built-in radio's panel (RADIO); the Python panel sends none.

### 2. Networks

Each session sends its link groups, declaratively and whole each time:
`radio-link-groups {clientMutationId, groups:[{id, channels:['251000:AM', ...]}]}`. A channel is `"<kHz>:<AM|FM>"`
(ADR 0159 §3). The client leaves out the intercom, every receive-only channel and unlinked radios; a group needs two
channels. crc-sync merges every session's groups by shared channel (union-find, `radio/link-networks.js`) into
**networks** of at least two channels. A closed `/feed` socket removes the session's groups at once (no sign-on
grace: a pilot must not go unheard for it). The groups are in memory; a reconnecting client sends them again.

At most 16 groups of at most 11 channels per session; anything else is refused with `VALIDATION_ERROR` in
`radio-link-groups-ack {clientMutationId, ok, reason?, detail?}`.

### 3. What is relayed

For a received packet, the targets are every channel of every network one of its clear channels is in, minus the
channels the packet already carries. So a pilot's single-frequency packet goes out on the rest of the network, and a
controller's packet (which already carries the controller's own group) gets the network's missing channels added
(H186 ruling 2: every frequency of a network hears every other, controllers included).

The relay drops a packet when any of these holds: the sender `Guid` is one of the relay's own connections (**OWN**);
`RetransmissionCount` ≥ 1 (**RELAYED**); any segment is INTERCOM; there is no target. OWN and RELAYED each close the
loop alone (tested with the other disabled, and the round trip: the relay's output fed back in sends nothing). With one
relay, the run table of ADR 0159 §2 and the PTT check have nothing left to protect against and are gone. Encrypted
segments are not a source (the relay would put encrypted audio out as clear).

The relayed packet is **one** packet carrying only the targets. It keeps the Opus bytes, the packet number and
`OriginalClientGuid`; it carries the sending connection's `Guid`, `RetransmissionCount + 1` and the fixed relay unit
id 1; each segment has its target's modulation and encryption 0.

### 4. The relay's SRS connections

`radio/relay-srs-client.js`: one SRS client, TCP sync plus UDP voice, built on a hand copy of crc-desktop's protocol
code (`src/radio/srs/`, kept byte-identical by `tests/radio-srs-copies-parity.test.mjs`; no shared package). Its name
is `CRC RELAY`, its coalition `CRCSYNC_COALITION` in SRS numbering (DCS-gRPC 3 BLUE → SRS 2, 2 RED → SRS 1), unit id 1,
host and port those of crc-sync's transponder SRS client (`CRCSYNC_SRS_HOST`/`PORT`, from the injected env).
Reconnect and backoff are the copied sync link's (1, 2, 5, 10, 30 s).

**No position.** The SRS server applies no line of sight and no range (`UDPVoiceRouter.cs` routes on coalition,
spectator muting, `RETRANSMISSION_NODE_LIMIT`, global frequencies and whether a receiver's radio can hear the
frequency). The receiving *client* applies both (`UDPClientAudioProcessor.cs` `HasLineOfSight`, `InRange`) against the
position of the packet's **sender** (`Guid`, the relay), and treats a sender at latitude 0 / longitude 0 as having no
position (`LatLngPosition.IsValid`): heard at any range, no line-of-sight loss. The relay therefore sends position
0/0/0, on purpose: a relayed transmission reaches as far as a controller's own (which also has no position). Coalition
matters: coalition 0 is a spectator, dropped under `SPECTATORS_AUDIO_DISABLED`, and `COALITION_AUDIO_SECURITY` routes
only within one coalition.

**The pool** (`radio/relay-pool.js`). SRS gives a client 11 radios, so the relay opens one connection per 11 network
channels, at most 8 (88 channels; past that the rest are not relayed and the status says so). A channel stays on the
connection it is on when the networks change; an emptied connection is closed. No networks, no connection. A packet
carrying channels on two connections reaches the relay twice; the pool lets one copy through (same `Guid` and packet
number within 2 s). A relayed packet goes out on the connection that heard it.

### 5. Status to the clients

`radio-relay-status {networks:[{channels}], connected, error?}`, whole each time, to each session that sent groups,
with only the networks that include one of its channels; sent after every `radio-link-groups` (after the ack) and
whenever what a session would be told changes. `connected` is true when every relay connection is up and UDP-ready.
The panel's grey **RELAYING** mark on a group header now means crc-sync relays that group's network; when the relay is
down for one of the session's networks the panel shows one amber line, `relay down: <reason>`.

Frames are built in `efsp/wire/frames.js` (`linkGroupsAck`, `relayStatusFrame`) and leave through the hub's directed
`sendRadioRelay` (ADR 0159 D2's reasoning stands). `radio/relay-wire.js` is the family, `radio/relay-service.js` wires
the parts, built in `createApp`; `ws-hub.js` has only the binding lines.

### 6. The controller's receive side

A controller tuned to two frequencies of a network gets the pilot's packet and the relay's copy. crc-desktop's local
SRS session plays the first and drops a later packet with the same `OriginalClientGuid` and packet number within 2 s
(`app/srs/rx-dedupe.js`), and drops any packet whose `OriginalClientGuid` is its own (its own voice relayed onto a
frequency it also listens on).

## Consequences

- A pilot on any frequency of a network is heard on all of its others, once, one hop later, whoever linked them and
  whether or not their CRC is running.
- Two controllers linking the same frequencies give exactly one relayed copy; partly overlapping groups join into one
  network, so a controller's group can carry frequencies that another controller linked to one of them. That is the
  ruling, and it is wide: linking a common frequency (a guard is never linked, but a shared approach frequency is) joins
  two controllers' whole groups.
- The relay depends on crc-sync reaching SRS. The panel says so in one amber line when it cannot.
- crc-sync now holds up to 8 SRS client slots on the squadron server, named `CRC RELAY`, visible in the SRS client list.
- The SRS server must still have `RETRANSMISSION_NODE_LIMIT` ≥ 1 (H184).
- New wire (`radio-link-groups`, `radio-link-groups-ack`, `radio-relay-status`; `radio-relay-claim/ack/leases` gone): a
  protocol bump, recorded by the supervisor.
