# Lane RADIO-SRELAY: the relay moves into crc-sync (ADR 0160)

Read first:
- `CLAUDE.md`;
- `docs/parallel/lane-rules.md` (binding);
- ADR 0158, ADR 0159;
- `docs/parallel/decisions.md` H182 to H186;
- `docs/wip/RADIO-CORE.md` (what the SRS source says);
- `docs/wip/RADIO-RELAY.md` (what is built now and is being replaced);
- the code: `crc-desktop/app/srs/**` (`relay*.js`, `voice-packet.js`, `sync-message.js`, `voice-link.js`, `sync-link.js`),
  `crc-desktop/app/public/js/radio/relay-*.js`, `radio-relay-sync.js`, `crc-sync/src/radio/**`, `crc-sync/src/srs-client.js`
  (crc-sync's existing SRS client, the transponder one), `ws-hub.js`, `wire/frames.js`.

## The human's rulings (H186)

1. **The relay is server-side.** crc-sync is the one relay node on the SRS server. No client relays, and there are no
   leases.
2. **Overlapping link groups merge** into one network, across all controllers. Every frequency of a network hears every
   other, including controllers' own transmissions.
3. SRS `RETRANSMISSION_NODE_LIMIT` is 1 on the squadron server (H184).

## Design (write it as ADR 0160, superseding ADR 0159's leases and client relay; P4: never edit 0158 or 0159)

- **Networks.** Each crc-desktop session sends crc-sync its link groups, declaratively and whole each time:
  `radio-link-groups {clientMutationId, groups:[{id, channels:['251000:AM', ...]}]}`.
  - Channels are `kHz:MODULATION` as RADIO-RELAY defined them.
  - The client leaves out INTERCOM, `receiveOnly` and unlinked radios.
  - crc-sync merges every session's groups by shared channel (union-find) into **networks**. A network has at least two
    channels.
  - A session closing removes its groups at once.
- **Relay decision** (pure). For a received packet, the targets are the network's channels minus the packet's own
  channels. The packet's channels can belong to more than one network, so take the union of those networks.
  - **Drop** it when any of these holds: the sender `Guid` is the relay's own; `RetransmissionCount` ≥ 1; any segment
    is INTERCOM; there is no target.
  - Each of the first two drops closes the loop on its own. Test each with the other disabled, plus the round trip: the
    relay's output fed back in sends nothing.
  - A controller's own multi-frequency packet gets the network's missing channels added, which is ruling 2. A pilot's
    single-frequency packet gets the rest of the network.
- **Relayed packet.** It carries only the targets (not the source channels), as one packet.
  - It keeps the Opus bytes, the packet number and `OriginalClientGuid`.
  - It uses the relay's `Guid`, `RetransmissionCount + 1` and a fixed relay unit id.
  - Each segment gets the target channel's modulation and encryption 0.
- **The relay's SRS connection.** A crc-sync SRS client: TCP sync plus UDP, with its radios tuned to every network
  channel.
  - SRS allows 11 radios per client, so open more connections when there are more channels. A pool, as its own module.
  - Coalition is `CRCSYNC_COALITION`; the name is `CRC RELAY`.
  - Host and port are the ones crc-sync's existing SRS client uses (`CRCSYNC_SRS_HOST`/`PORT`, injected env, never read
    at require time).
  - Reconnect with backoff. No networks means no connection.
  - **Read the SRS source** (ciribob, as RADIO-CORE did): does the server apply line-of-sight or range to a receiver or
    sender by position? If yes, give the relay a position (say which in the ADR) and log the finding.
- **Shared protocol code.** crc-sync needs the voice packet and sync message code that is in
  `crc-desktop/app/srs/`.
  - Make a hand copy under `crc-sync/src/radio/srs/`, with a parity test that reads both copies, the way the other
    client and server parity tests do. CLAUDE.md: a lane runs both unit suites' relevant files when it edits either side.
  - Do not create a shared npm package.
- **Status to the clients.** `radio-relay-status {networks:[{channels}], connected, error?}` goes to each session, only
  with the networks that include one of its channels.
  - The panel's grey RELAYING mark on a group header now means crc-sync relays that group's network.
  - When the relay is down, the panel shows one amber line: "relay down: <reason>".
- **Removed from the client:**
  - `app/srs/relay.js`, `relay-seen.js`, `relay-path.js`, and their hooks in `srs-session.js`/`srs-route.js`;
  - the renderer's `relay-lease.js` and the lease parts of `radio-relay-sync.js` (keep it if it is still the panel's link
    for sending groups);
  - the engine's `setRelayLeases`; `setLinkGroups` stays only if the engine still needs the groups for transmit;
  - the `radio-relay-claim/ack/leases` family and `relay-leases.js` in crc-sync;
  - their tests, replaced by the new ones.
- **Wire.** It goes through `wire/frames.js` and the hub's delivery; refusal codes go in `refusal-codes.js`. Extend
  `tools/wire-surface.js` the way the supervisor did for `relay-wire.js` (look at its radio-relay block) so the new
  messages are scanned. Do not run `wire:record`.

## Files

One job each, about 300 lines at most, no god files. For example, under `crc-sync/src/radio/`:

| File | Job |
|---|---|
| `link-networks.js` | union-find, pure |
| `relay-decision.js` | pure |
| `relay-pool.js` | the connections and their channel split |
| `relay-srs-client.js` | one SRS connection |
| `relay-wire.js` | the message family |
| `relay-service.js` | wires them, built in `createApp` |
| `srs/` | the protocol copies |

`ws-hub.js` gets only the binding lines, no logic.

## Not this lane

ATIS, the radio set's rules, removing lxsrs (H185).

## Deliverables

- the code and tests (round trip; each drop check disabled in turn; the network merge with A {F1,F2} + B {F2,F3}
  giving one network {F1,F2,F3}; two controllers linking the same frequency giving exactly one relayed copy; a session
  close shrinking the network; the 11-channel pool split; controller packet augmentation);
- ADR 0160;
- `docs/wip/RADIO-SRELAY.md`: defaults, usage-guide text, the RUNBOOK line if anything is new, and the manual test
  script (two pilots on two linked frequencies, plus the overlap case).

Report per lane rule 8.
