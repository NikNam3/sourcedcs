# RADIO-RELAY: pilots hear each other on linked frequencies (ADR 0158 step 4)

Branch `lane/RADIO-RELAY`. ADR **0159** (re-specifies ADR 0158 §4 check 3, the relayed packet and the lease messages).
Rulings applied: H183 (never relay the intercom), H184 (the server's `RETRANSMISSION_NODE_LIMIT` is raised to 1; the relay
always sends count + 1; no count-0 mode, no switch).

## What was built

crc-desktop, the local server (`app/srs/`, CommonJS):

| File | Job |
|---|---|
| `relay.js` | the decision, pure (apart from the run table it is handed): the four checks, intercom, receive-only, leases, one output packet |
| `relay-seen.js` | the run table: `originalGuid` + packets with no gap over 450 ms; the way the run came in; 30 s expiry |
| `relay-path.js` | the relay on the receive path: keeps groups and leases, offers every packet to `relay.js`, sends the answer; `channelKey` |
| `srs-session.js` | +relay path (every received packet is offered to it), `setLinkGroups`, `setRelayLeases`, `relayedPackets` in the state |
| `srs-route.js` | two `/srs` messages: `link-groups`, `relay-leases` |

crc-desktop, the renderer (`app/public/js/radio/`):

| File | Job |
|---|---|
| `relay-groups.js` | pure leaf: the radio set's groups as relay channels, the keys to claim, which groups this client relays for |
| `relay-lease.js` | leaf state + one sender: the declarative claim on `/feed`, the grants, re-claim after a `/feed` reconnect |
| `radio-relay-sync.js` | the panel's link: groups to the engine, claims only while the built-in radio's SRS links are up, grants to the engine |
| `radio-engine.js` | contract additions `setLinkGroups(groups)`, `setRelayLeases(channelKeys)`; both re-sent on every `/srs` open |
| `link-group-editor.js`, `radio-panel.js` | one grey `RELAYING` mark on a group header when this client holds a lease in it |

crc-sync:

| File | Job |
|---|---|
| `src/radio/relay-leases.js` | the lease table, pure, in memory: first come, declarative claims, pass on in claim order |
| `src/radio/relay-wire.js` | the `radio-relay` family: claim → ack + leases frames, close → leases frames to whoever gained |
| `src/efsp/wire/frames.js` | `relayClaimAck`, `relayLeasesFrame` |
| `src/ws-hub.js` | +11 lines: `radioRelay` dep, the claim before the EFSP branch, release on close (no grace), `_sendRadioRelay` |
| `src/app.js` | binds `createRadioRelayWire()` |

### Contract additions (radio engine)

- `setLinkGroups(groups)`: `[{ id, channels: [{ key, mhz, modulation: 'AM'|'FM', receiveOnly }] }]`, from
  `relay-groups.js relayGroupsOf(set)`. Groups with fewer than two relayable channels are left out.
- `setRelayLeases(channelKeys)`: `['251000:AM', ...]`, the channels crc-sync granted.
- Server state gains `relayedPackets` (sent to the renderer in the `/srs` state; not copied into the engine state).

### Wire (for the supervisor's `npm run wire:record`)

`radio-relay-claim {version, clientMutationId, channels}` (client → server), `radio-relay-ack {version, clientMutationId,
ok, reason?, detail?}` and `radio-relay-leases {version, held}` (server → client). New message types: a protocol bump.

## Defaults taken

| # | Default | Why |
|---|---|---|
| D1 | The claim is **declarative** (the whole wanted list), and grant/revoke is one `radio-relay-leases {held}` frame per session | ADR 0158 named claim/release/grant/revoke; one list cannot get out of step, and unlink/unstaff/retune need no message of their own |
| D2 | Lease frames leave through a new hub method `_sendRadioRelay`, not `deliverEfsp` | they are directed at single sessions; `deliverEfsp` is the read-scoped broadcast with the obligation re-check (precedent: conflict-suppress ack, PAR samples) |
| D3 | The family lives in `src/radio/relay-wire.js`, not in `efsp/wire/families/` (not registered in `FAMILIES`) | the hub's only non-EFSP families are inline in `ws-hub.js`; this is not a store family (no seq, snapshot, audit, replay), and registering it would put it into the skeleton and the freeze tables |
| D4 | Any connected session may claim (no Position gate) | a user group of guards and manual radios is linked without any Position |
| D5 | A closed socket releases its leases at once, not after the sign-on grace | a pilot must not go unheard for the grace |
| D6 | The client claims only while the built-in radio runs (`RADIO_CLIENT === 'node'`) and its SRS link is connected and UDP ready; otherwise it claims `[]` | a lease held by a client that cannot relay silences the pilots |
| D7 | Channel key `"<kHz>:<AM|FM>"`; at most 11 per claim | integer kHz is what the panel and the table already use; SRS has 11 slots |
| D8 | A channel any radio of the set has receive-only is marked `receiveOnly`: never a source, never a target, its lease not asked for | briefing: an Observer's radio is never relayed either way |
| D9 | The relayed packet keeps the pilot's packet number | the Opus frame is the same; a receiver's jitter buffer orders by it |
| D10 | Relayed packets skip encrypted segments (not heard, not relayed) | the client has no keys (RADIO-CORE D5) |
| D11 | The run table notes a run before the PTT and lease checks | the way a transmission came in does not depend on our PTT |
| D12 | Re-claim after a `/feed` reconnect is found by a 1 s check of `isSyncOpen()` in `relay-lease.js` (the held list is cleared while it is down) | `sync.js` has no close hook; crc-sync dropped the leases with the socket anyway |
| D13 | The `RELAYING` mark shows when this client holds the lease on at least one channel of the group | it relays onto that channel then; the title says what it means |

## For `infra/RUNBOOK.md` (supervisor)

> SRS server: `RETRANSMISSION_NODE_LIMIT` must be ≥ 1, or linked-frequency relay is silently dropped.

## What the usage guide should say (RADIO 2)

- Pilots on the frequencies of one link group hear each other: when a pilot transmits on one of them, CRC re-sends it
  on the group's others, a moment later. The automatic POSITIONS group does this for your Position frequencies; your
  own groups do it for whatever you put in them.
- If another controller links the same frequencies, crc-sync gives each frequency to one of you, so pilots never hear
  a transmission twice. **RELAYING** in grey next to a group's name means your CRC is the one relaying onto at least one
  of its frequencies. No mark means another controller's CRC does it, or nobody needs to.
- While you transmit on a group, nothing is relayed into it: your own voice already goes out on all of its frequencies.
- The intercom is never relayed, and neither is a radio you only observe (RX ONLY).
- The relay needs the built-in radio (`radioClient` `node`) and a connection to SRS. The old radio does not relay.

## Manual test: two pilots on two linked frequencies, a real SRS server

Needs: the SRS server with `RETRANSMISSION_NODE_LIMIT` 1 (server settings, or `server.cfg`), one crc-desktop with
`"radioClient": "node"`, two stock SRS clients (pilot A, pilot B; two machines, or one machine and one more).

1. In crc-desktop sign on to a Position with a UHF and a VHF row (or add two manual radios, e.g. 251.000 and 122.100,
   and put both into group A). Open RADIO 2. Within a second or two the group header shows grey **RELAYING**.
2. Pilot A tunes 251.000, pilot B tunes 122.100. Pilot A talks: pilot B hears A, once, a fraction later. The controller
   hears A on the 251.000 row only.
3. Pilot B talks: pilot A hears B.
4. Pilot C (or A's second radio) tuned to **both** 251.000 and 122.100: when A talks on 251.000, C hears it twice
   (direct + relay). This is expected (SRS does not de-duplicate across frequencies); note how it sounds.
5. The controller holds PTT on the group while A talks: B hears the controller, not A (check 4). Release: B hears A again.
6. Loop check: A talks for 30 s. The SRS server's traffic stays flat (no growing packet rate), and nobody hears an echo.
7. Unlink 122.100 (UNLINK in its link menu): RELAYING goes, A is no longer heard by B. Link it again: it comes back.
8. A second crc-desktop (another controller) links the same two frequencies: its RADIO 2 shows no RELAYING (the first
   holds both). A talks: B hears A **once**. Close the first crc-desktop: within a second the second shows RELAYING and B
   still hears A.
9. Intercom: neither pilot ever hears intercom traffic relayed.
10. With the server's `RETRANSMISSION_NODE_LIMIT` back at 0, step 2 fails silently (B hears nothing); that is the setting
    this test depends on.

## Findings for other lanes and the supervisor

- **Module graph**: new renderer modules `relay-groups.js`, `relay-lease.js`, `radio-relay-sync.js` (reachable from
  `radio-panel.js`; no cycle by construction: `relay-lease.js` imports only `sync.js` and the message registry). The
  `module-graph-exports.json` fixture needs re-recording (`GOLDEN_RECORD=1`); not run here.
- **Wire: the scan does not see this family.** `tools/wire-surface.js` reads client-to-server types from the hub's
  `case`/`msg.type ===` literals and server-to-client ones from `type: 'efsp-…'` literals; `radio-relay-claim` is matched
  through `radioRelay.handles()` and the two frames are `radio-relay-*`. So `npm run wire:record` alone will not bump:
  use `npm run wire:record -- --bump`, or teach the scan `src/radio/relay-wire.js` (`CLAIM`) and `radio-` literals in
  `frames.js`. The freeze table `tables-wire-message-types` matches `efsp-` only, so it is unchanged.
- **`relayedPackets`** is in the `/srs` state but the engine's `onServerState` drops it; a later METRICS line could show it.
- **Coverage gap with overlapping groups** (ADR 0159 Consequences): leases are per frequency, so when two controllers'
  groups overlap only partly, a pilot is relayed only within the lease holder's own group, not across the union.
- **No feedback when the server drops relayed packets** (limit 0): nothing on the client can see it. A possible later
  check: our relayed packets never come back to us anyway, so it would need a second client; left to the RUNBOOK.
- **`ws-hub.js` is 840+ lines**: a god file before this lane; this lane added 11 lines. Its inline non-EFSP families
  (`declare`, `rename`, `aptConfigSet`, conflict suppress) could move to their own files the way `relay-wire.js` is.
- The RADIO-ATIS files were not touched.

## Tests (each run alone, `nice -n 19`)

- `crc-desktop/tests/srs-relay.test.js` 19 (new): the relayed packet; one packet for all targets; the round trip; each
  check disabled in turn with the loop closed; each check alone; a run ending; intercom, unlinked, unleased, encrypted;
  receive-only source and target; `normaliseGroups`; a 200-packet transmission in full; two relays sharing a frequency
  with packets on the air constant (count intact, and a server that resets it); three frequencies with overlapping groups.
- `crc-desktop/tests/radio-relay.test.mjs` 5 (new): key parity with the Node side, groups, receive-only, the claim and
  reconnect, the panel link's gating.
- `crc-sync/tests/radio-relay-leases.test.mjs` 6 (new): first come, release passes on, declarative claims, validation,
  the wire frames, through the hub.
- Re-run because touched: `srs-session.test.js` 6, `radio-panel.test.mjs` 8 (fake engine gained the two exports).
