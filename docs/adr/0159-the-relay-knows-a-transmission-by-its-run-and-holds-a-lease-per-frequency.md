# 0159: The relay knows a transmission by its run, and holds a lease per frequency

**Status.** Built (2026-11-10). Amends, without editing (P4): ADR 0158 §4 (the relayed packet's fields, check 3, the
lease family's messages). [SOURCE-DEFINED]: the human's goal of 2026-11-10 ("pilots should hear each other on linked
frequencies, make sure that happens"), ruling H184 (the SRS server setting), and the SRS source as read by RADIO-CORE
(`docs/wip/RADIO-CORE.md`, "What SRS does").

## Context

ADR 0158 §4 lets the client that holds a link group's relay lease re-send a pilot's transmission on the group's other
frequencies, and names four independent checks that keep the relay from looping. It was written before the SRS source
was read, and two of its assumptions are wrong:

- **SRS has no per-transmission id.** A voice packet carries two GUIDs: the first is `OriginalClientGuid` (the client
  that first transmitted the audio), the last is `Guid` (the client that sent this datagram). Nothing names one
  transmission. ADR 0158's `transmissionGuid` is `OriginalClientGuid`, which is the *pilot*, the same for every
  transmission the pilot makes. Check 3 as written ("remember the `transmissionGuid`") cannot be built.
- **The SRS server drops relayed packets by default.** It drops every packet whose `RetransmissionCount` is above its
  `RETRANSMISSION_NODE_LIMIT` setting, which defaults to 0. A relayed packet with count 1 vanishes.
- SRS clients were not found to de-duplicate across frequencies. A packet carrying several frequencies is one packet,
  played once.

## Decision

### 1. The relayed packet

The relay sends **one packet** per received packet, carrying every target frequency of the group, so a listener tuned
to two of them hears it once. It keeps the pilot's `OriginalClientGuid`, the pilot's packet number and the Opus frame
unchanged; `Guid` is this client's; `UnitId` is a fixed `RELAY_UNIT_ID` (1), never the pilot's (a pilot's client could
take a packet from its own unit for intercom traffic) and never the intercom unit the controller joined; and
`RetransmissionCount` is the received count + 1, as SRS intends.

**The SRS server must have `RETRANSMISSION_NODE_LIMIT` ≥ 1** (H184: the human sets 1 on the squadron server). With the
default 0 every relayed packet is dropped by the server, silently: the controller side (one packet stream on every
frequency of the group) still works, the pilot-to-pilot relay does not. There is no mode that sends count 0.

### 2. Check 3, re-specified: a transmission is a run

A **run** is the packets of one `OriginalClientGuid` with no gap longer than 450 ms between two of them (SRS's receive
timeout). For each run the relay remembers the way its first packet came in: the sender `Guid` and the channels it was
heard on. The rest of the run is relayed only when it comes in that same way. The same original arriving any other way
while the run lasts (another sender, other channels) is a copy coming back and is dropped. A copy never keeps a run
alive. A run is forgotten 30 s after its last packet. A packet whose `OriginalClientGuid` is this client's is always
dropped (our own transmission, however it came back).

The four checks then read, each closing the loop on its own:

1. **Own.** The sender `Guid` is this client's.
2. **Relayed.** `RetransmissionCount` ≥ 1, so relays never chain (one hop).
3. **Way back.** Our own original, or a copy of a known run arriving another way.
4. **PTT.** This client's PTT is down on that group.

Also dropped: a packet with an intercom segment (H183), a packet on no frequency of a linked group, a group whose
heard channel is receive-only (an Observer's radio is never a source), and a packet with no target left (no other
frequency, none leased to this client, only receive-only ones, or only frequencies the pilot already transmits on).

### 3. The lease family

Leases are per channel (a frequency and a modulation, keyed `"<kHz>:<AM|FM>"`, e.g. `"251000:AM"`), granted to the
first session to claim, released on close, unlink or unstaff, and passed to the next claimant in claim order. The
table is in memory (`crc-sync/src/radio/relay-leases.js`).

ADR 0158 named four messages (claim, release, grant, revoke). It is built as two and one answer:

- `radio-relay-claim {clientMutationId, channels}`: **declarative**, every channel the client wants now. A channel it
  no longer names is released by the same claim, so unlink, a left Position and a retune need no message of their own,
  and `[]` releases everything.
- `radio-relay-ack {clientMutationId, ok, reason?, detail?}` to the claimant. A malformed claim is `VALIDATION_ERROR`.
- `radio-relay-leases {held}`: the channels one session holds now, whole. Sent to the claimant after every claim, and
  to every session whose leases a claim or a close moved: the grant and the revoke are this one frame.

Any connected session may claim: a link group can hold guards and manual radios, which no Position gates. A client
claims only while it can relay (its built-in radio runs and its SRS links are up), so a controller on the old Python
client, or one whose SRS link is down, never holds a lease that nobody uses. A closed `/feed` socket releases at once,
without the sign-on grace: a pilot must not go unheard for the grace.

The frames are built in `efsp/wire/frames.js`. They are directed at single sessions, so they leave through the hub's
`_sendRadioRelay`, not `deliverEfsp`: that is the broadcast path, with the read scope and the obligation re-check, and
neither applies to a lease (the conflict-suppress ack and the PAR samples go out directly for the same reason). The
family is not in `efsp/wire/families/` (no seq, snapshot, audit or replay); it is `src/radio/relay-wire.js`, bound into
the hub as `radioRelay` by `app.js`.

## Consequences

- A pilot on any frequency of a linked group is heard on the others, once, with one hop of delay.
- Two controllers whose groups overlap split the overlapping channels between them; each relays only onto the channels
  it holds. A channel that is in one controller's group but whose lease another controller holds *for a different
  group* is relayed into only from that other group's frequencies. A pilot is then not heard across the two groups'
  union, only within each holder's own group.
- If a relay's copy of a run's first packet reaches another relay before the pilot's original does, and a server reset
  the count, the second relay takes the copy's way as the run's: the loop stays closed (each relay drops the other's
  later copies), but listeners may hear that run twice. With the count intact (H184) check 2 drops the copy first.
- The relay depends on the server setting. Nothing on the client can see that a relayed packet was dropped by the
  server; the RUNBOOK states the setting as required.
- New wire (`radio-relay-claim`, `radio-relay-ack`, `radio-relay-leases`): recorded with `npm run wire:record`, a
  crc-desktop release with a protocol bump.
