# RADIO-SRELAY: the relay moves into crc-sync (ADR 0160)

Branch `lane/RADIO-SRELAY`. ADR **0160** (supersedes ADR 0159's leases, run table and client relay; 0158/0159 not
edited). Rulings applied: H186 (server-side relay, overlapping groups merge, controllers' own transmissions included),
H184 (node limit 1, count + 1), H183 (intercom never relayed).

## What was built

crc-sync, `src/radio/` (one job each, all under 105 lines):

| File | Job |
|---|---|
| `link-networks.js` | union-find over every session's groups into networks (≥ 2 channels), pure; the channel-key check |
| `relay-decision.js` | pure: drop checks (OWN, RELAYED, intercom, no-target), targets = union of the packet's networks minus its own channels, the one relayed packet |
| `relay-srs-client.js` | one SRS connection (`CRC RELAY`, own coalition in SRS numbering, no position, ≤ 11 radios), on the copied sync/voice links |
| `relay-pool.js` | the connections and their channel split (11 per connection, stable, at most 8), one copy per packet across connections, the aggregate status |
| `relay-wire.js` | the `radio-link-groups` family: validation, ack, the service's status frames; close |
| `relay-service.js` | wires them: groups per session → networks → pool channels; packet → decision → send; per-session status frames, only on change |
| `srs/` | byte-identical copies of crc-desktop's `app/srs/` `srs-guid.js`, `voice-packet.js`, `sync-message.js`, `sync-link.js`, `voice-link.js` |

Also: `efsp/wire/frames.js` `linkGroupsAck`, `relayStatusFrame` (the two lease frames removed); `ws-hub.js` binding
lines only (`_sendRadioRelay` renamed to public `sendRadioRelay`, so the service can push status when a connection
changes; 6 lines changed); `app.js` builds `createRelayService` (seam `deps.relayConnection`) and stops it in `stop()`,
returns `relayService`; `tools/wire-surface.js` scans `radio-[a-z-]+` in `relay-wire.js` constants and frames.
Removed: `radio/relay-leases.js`, `tests/radio-relay-leases.test.mjs`.

crc-desktop:

| File | Change |
|---|---|
| `app/srs/relay.js`, `relay-seen.js`, `relay-path.js`, `tests/srs-relay.test.js` | removed |
| `app/srs/srs-session.js` | relay path, `setLinkGroups`, `setRelayLeases`, `relayedPackets` removed; drops a packet whose `originalGuid` is ours; `rx-dedupe.js` drops the relay's copy of a packet already heard; state gains `duplicatePackets` |
| `app/srs/rx-dedupe.js` | new: first copy of `originalGuid` + packet number within 2 s plays |
| `app/srs/srs-route.js` | `link-groups` and `relay-leases` messages removed |
| `app/public/js/radio/relay-lease.js` | removed |
| `app/public/js/radio/relay-feed.js` | new leaf state + sender: `radio-link-groups` on `/feed`, re-sent after a reconnect (1 s check), `radio-relay-status` kept |
| `app/public/js/radio/relay-groups.js` | groups as sorted channel keys (receive-only, intercom, unlinked left out); `relayingGroupIds(groups, status)`; `relayDownNote(status)` |
| `app/public/js/radio/radio-relay-sync.js` | the panel's link: push groups, RELAYING ids, the down note; no engine, no radio-client gating |
| `radio-engine.js` | `setLinkGroups`, `setRelayLeases` removed (transmit groups come from `radio.groupId`, `tx-group.js`) |
| `radio-panel.js`, `link-group-editor.js`, `css/radio-panel.css` | amber `relay down: <reason>` line on top of the body; RELAYING title reworded |
| `tests/helpers/fake-radio-engine.mjs` | the two relay exports removed |

### Wire (for the supervisor's `npm run wire:record`)

Client → server `radio-link-groups {version, clientMutationId, groups:[{id, channels}]}`. Server → client
`radio-link-groups-ack {version, clientMutationId, ok, reason?, detail?}` and
`radio-relay-status {version, networks:[{channels}], connected, error?}`. Gone: `radio-relay-claim`, `radio-relay-ack`,
`radio-relay-leases`. The scan should see them (not run here); `tests/fixtures/wire-surface.json` still lists the old
three until recorded.

## What the SRS source says (ciribob/DCS-SimpleRadioStandalone master, read 2026-11-10)

- **Server** (`Common/Network/Server/UDPVoiceRouter.cs`, `GenerateOutgoingPacket`): no line of sight, no range, no
  position at all. It drops a sender that is a spectator (coalition 0) under `SPECTATORS_AUDIO_DISABLED`, or muted;
  drops `RetransmissionCount > RETRANSMISSION_NODE_LIMIT`; sends global frequencies to everyone; otherwise sends to
  every other client whose coalition matches (only under `COALITION_AUDIO_SECURITY`) and whose `RadioInfo` can hear one
  of the packet's frequency/modulation/encryption segments. It never sends a packet back to its sender (except test
  frequencies).
- **Receiving client** (`DCS-SR-Client/Audio/Managers/UDPClientAudioProcessor.cs`): `HasLineOfSight` (under `LOS_ENABLED`)
  and `InRange` (under `DISTANCE_ENABLED`) both look up the packet's **`Guid`** (the last sender, so the relay) in the
  client list and use its `LatLngPosition`; when either position is not valid they return true (heard).
  `LatLngPosition.IsValid()` is `lat != 0 && lng != 0` (`Common/Models/Player/LatLngPosition.cs`).
- **Hence** the relay has no position (0/0/0): it is heard at any range, like a controller's CRC. Its coalition is the
  own one, non-zero. Recorded in ADR 0160 §4.
- The stock client's own retransmit (`RetransmitAudio`) skips a packet whose `Guid` is its own and respects the node
  limit; it is the same model as ours.

## Defaults taken

| # | Default | Why |
|---|---|---|
| D1 | An ack `radio-link-groups-ack` (VALIDATION_ERROR for a malformed list) besides the status | ADR 0159's family had one; a refused list should be visible in the console |
| D2 | At most 16 groups per session, 11 channels per group; group id 1–64 characters | a panel has a handful; SRS gives a client 11 radios |
| D3 | The protocol copy covers `sync-link.js` and `voice-link.js` too, not only the packet and sync message code | the relay needs the TCP and UDP links with the same keepalive/backoff; copying beats re-writing them |
| D4 | Parity = byte-identical files, in `crc-sync/tests/radio-srs-copies-parity.test.mjs`, which also pins the directory to those five files | simplest check that cannot drift |
| D5 | SRS coalition = DCS-gRPC coalition − 1 (3 BLUE → 2, 2 RED → 1) | the two numberings; coalition 0 would be a spectator |
| D6 | Relay position 0/0/0 (no position) | the SRS source, above |
| D7 | Unit id 1 on the relay's SYNC and on relayed packets | ADR 0159 §1's `RELAY_UNIT_ID` |
| D8 | Pool: at most 8 connections (88 channels); channels past that are not tuned and the status error names them | a bound on SRS slots crc-sync takes |
| D9 | Split keeps a channel on its connection, fills the first with room, closes an emptied one | no retune of a busy connection when another network changes |
| D10 | Pool dedupe by sender `Guid` + packet number within 2 s | a multi-frequency packet split over two connections reaches the relay twice |
| D11 | A relayed packet leaves on the connection that heard it | that connection is a known, ready SRS client |
| D12 | Encrypted segments are never a source (but still count as "already carried", never a target) | relaying encrypted audio as clear is noise (ADR 0159 D10) |
| D13 | `connected` = every open connection is up and UDP-ready; no connection = `connected:false` with no error | the panel says "down" only when a network exists (`relayDownNote`) |
| D14 | Status goes to every session that has sent groups (including `[]`), filtered to its networks, only when its frame changes; the sender always gets one after its ack | declarative, and quiet |
| D15 | The client always sends its groups (no `radioClient` or SRS-link gating) | the relay is crc-sync's now; RADIO only loads under the built-in client anyway |
| D16 | The controller's CRC drops its own voice relayed back (`originalGuid` ours) and plays only the first copy of a pilot's packet (`originalGuid` + packet number, 2 s), deduped after the radio match so an unmatched packet is still counted | otherwise a controller on two frequencies of a network hears every pilot twice, and its own voice on a third |
| D17 | RELAYING shows only while the relay is connected and the group has a channel in a reported network | "crc-sync relays this group's network" is false while it is down; the amber line says that instead |
| D18 | The amber line sits at the top of the panel body, above the grey notes | one line, where the eye starts |

## For `infra/RUNBOOK.md` (supervisor)

> crc-sync now connects to the SRS server itself as `CRC RELAY` (one SRS client per 11 linked frequencies, up to 8),
> using `CRCSYNC_SRS_HOST`/`CRCSYNC_SRS_PORT`, whenever any controller has a link group. If SRS shows no `CRC RELAY`
> while controllers have linked frequencies, check crc-sync's logs (`srs sync` lines). The SRS server's
> `RETRANSMISSION_NODE_LIMIT` must stay ≥ 1 (unchanged).

## What the usage guide should say (RADIO)

- Pilots on the frequencies of one link group hear each other: crc-sync re-sends a pilot's transmission on the group's
  other frequencies, a moment later. This works whether or not your CRC is running.
- If another controller's group shares a frequency with yours, the two groups become one network: a pilot on any of
  their frequencies is heard on all of them, and so is your own transmission (crc-sync adds the frequencies your group
  lacks).
- **RELAYING** in grey next to a group's name means crc-sync relays that group's network. If the relay cannot reach
  SRS, the panel shows one amber line, `relay down: <reason>`.
- The intercom is never relayed, and neither is a radio you only observe (RX ONLY), nor an unlinked radio.
- Listening on two frequencies of one network, you hear a pilot once.

## Manual test: a real SRS server (supervisor)

Needs: the SRS server with `RETRANSMISSION_NODE_LIMIT` 1, a crc-sync pointed at it (`CRCSYNC_SRS_HOST`/`PORT`), two
crc-desktops (controllers A and B) on that crc-sync, three stock SRS clients (pilots P1, P2, P3) in the own coalition.

1. Controller A signs on to a Position with a UHF and a VHF row, or adds two manual radios, e.g. 251.000 and 122.100,
   both in one group. Within a second the group header shows grey **RELAYING**. The SRS client list shows one
   `CRC RELAY` with radios 251.000 and 122.100.
2. P1 tunes 251.000, P2 tunes 122.100. P1 talks: P2 hears P1 once, a fraction later. Controller A hears P1 once
   (not twice, though A listens on both).
3. P2 talks: P1 hears P2.
4. Close controller A's crc-desktop: within a second the SRS client list loses `CRC RELAY`; P1 talks, P2 hears nothing.
   Start it again: RELAYING comes back, the relay is back.
5. **Overlap.** Controller A's group: 251.000 + 122.100. Controller B's group: 122.100 + 305.500. P3 tunes 305.500.
   Both panels show RELAYING. P1 talks on 251.000: P2 and P3 hear it, once each. P3 talks: P1 and P2 hear it.
6. **Controller included.** Controller A transmits on its group (251.000 + 122.100): P3 on 305.500 hears A. A does not
   hear its own voice back on any radio.
7. **Same frequencies twice.** Controller B changes its group to 251.000 + 122.100 (the same as A). P1 talks: P2 hears P1
   **once**.
8. Unlink 122.100 at controller B (B's group is gone): nothing changes for P1/P2 (A still links them). Unlink it at A
   too: RELAYING goes on both, P2 no longer hears P1, `CRC RELAY` leaves the SRS client list.
9. **Relay down.** With a network up, stop the SRS server (or firewall crc-sync from it): both panels show
   `relay down: SRS …` in amber and RELAYING goes. Start SRS: it reconnects by itself (1, 2, 5, 10, 30 s) and the line
   goes.
10. Intercom and RX ONLY radios are never relayed; an Observer's radio on 122.100 does not join a network.
11. Loop: P1 talks for 30 s; SRS server traffic stays flat, nobody hears an echo.

## Findings for other lanes and the supervisor

- **Wire record**: protocol bump needed (`npm run wire:record`); `tests/fixtures/wire-surface.json` still names the
  three lease messages. Not run here.
- **Module graph**: `radio/relay-lease.js` gone, `radio/relay-feed.js` new; `relay-groups.js` exports changed
  (`leaseKeysOf` gone, `relayDownNote` new); `radio-engine.js` lost two exports. `module-graph-exports.json` needs
  `GOLDEN_RECORD=1`.
- **e2e**: the RADIO panel now always sends `radio-link-groups` when a group has two channels, so an e2e crc-sync will
  try to connect its relay to whatever SRS host the harness sets (backoff up to 30 s, harmless but logs). If that is
  noise, the harness could inject `deps.relayConnection` or set the SRS host to something closed.
- **Soak**: the soak never sends link groups, so no relay connection is opened; `createApp` builds the service anyway.
- **`docs/parallel/radio/README.md`** (the engine contract) still lists `setLinkGroups`/`setRelayLeases`; they are gone.
  ADR 0159's "Consequences" coverage gap is closed by ADR 0160.
- **CLAUDE.md** crc-sync paragraph could say crc-sync also runs the linked-frequency relay (its own SRS clients,
  `src/radio/`, ADR 0160), and that `src/radio/srs/` is a hand copy of `crc-desktop/app/srs/` under a parity test.
- **No METRICS line** for the relay yet (`relayService.relayedPackets()`, `status()`, the pool's connection count are
  there to read).
- **Fast `/feed` reconnects** (closed and open again within the 1 s check) are not seen by `relay-feed.js`, so the groups
  are not re-sent until they change; the same limitation as ADR 0159 D12. A `sync.js` open hook would fix both.
- **The panel's amber line** is covered by the pure `relayDownNote` tests, not by a panel DOM test.

## Tests (each run alone, `nice -n 19`)

- `crc-sync/tests/radio-relay-decision.test.mjs` 9 (new): A {F1,F2} + B {F2,F3} → {F1,F2,F3}; network rules; pilot
  packet; controller augmentation; two networks' union; intercom/no-network/encrypted/modulation drops; each loop check
  with the other disabled (and both off loops); the round trip through encode/decode; the 11-channel split, stability,
  closing, the connection limit.
- `crc-sync/tests/radio-relay-service.test.mjs` 8 (new): two controllers on the same frequencies → one relayed copy;
  overlap and session close shrinking the network; status filtering and change-only; pool dedupe and the 12th channel's
  second connection; the wire's validation; through the hub; relay down with its reason; one real relay connection
  against fake sockets (SYNC name, coalition, no position, radios, UDP ready, RADIO_UPDATE on retune).
- `crc-sync/tests/radio-srs-copies-parity.test.mjs` 2 (new).
- `crc-desktop/tests/radio-relay.test.mjs` 6 (rewritten).
- `crc-desktop/tests/srs-session.test.js` 7 (was 6; +1 dedupe and own-echo).
- `crc-desktop/tests/radio-panel.test.mjs` 8, re-run (fake engine changed): pass.
- `crc-desktop/tests/srs-route.test.js` 5, re-run (two messages removed): pass.
- Removed: `crc-sync/tests/radio-relay-leases.test.mjs` (6), `crc-desktop/tests/srs-relay.test.js` (19).
