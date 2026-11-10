# Lane RADIO-RELAY: pilots hear each other across linked frequencies (ADR 0158 step 4)

Read first: `CLAUDE.md`; ADR 0158, especially §4; `docs/parallel/decisions.md` H182, H183, S-RADIO-1 and S-RADIO-2;
`docs/wip/RADIO-CORE.md` "For step 4", plus its SRS findings; `docs/wip/RADIO-SET.md`; `docs/parallel/lane-rules.md`
(binding). The engine (`crc-desktop/app/srs/`, `app/public/js/radio/`) and the panel are merged on main, and RADIO 2
drives the real engine.

## Goal (the human, 2026-11-10: "pilots should hear each other on linked frequencies, make sure that happens")

When a pilot transmits on one frequency of a link group, every pilot on the group's other frequencies hears it. The
relay must never loop, never double, and never relay the intercom.

## What changed since ADR 0158 was written (RADIO-CORE read the SRS source)

1. **SRS has no per-transmission id.** The UDP packet's first GUID is `OriginalClientGuid` and the last is the
   sender's `Guid`. ADR 0158 §4 check 3 is therefore **re-specified**. Write it in a new ADR **0159**, which amends
   0158 §4 (P4: 0158 is not edited). A transmission is identified by its `OriginalClientGuid` plus a run of packet
   numbers with no gap over 450 ms. For each run, the relay remembers the frequency and sender its first packet came in
   on. The rest of the run is relayed only from that entry. The same original arriving any other way is a returning
   copy and is dropped.
2. **The SRS server drops relayed packets by default.** `RETRANSMISSION_NODE_LIMIT` defaults to 0, so a packet with
   `RetransmissionCount` ≥ 1 is dropped. The relay sends `RetransmissionCount + 1`, as SRS intends.
   - A constant in one place, `RELAY_SETS_RETRANSMISSION_COUNT = true`, decides whether the count is raised, pending
     the human's choice on the server setting.
   - With it false, the relay sends count 0 and check 2 (below) cannot see a relay. Loop safety then rests on checks
     1, 3, 4 and the leases. Write a test that proves the loop stays closed in that mode too.
3. **The relay output.** Send it as **one packet** carrying all of the group's other frequencies, so a pilot tuned to
   two of them hears it once. Keep `OriginalClientGuid` (the pilot), use this client's `Guid`, and use a fixed
   `RELAY_UNIT_ID`. Never use the intercom's unit id or the pilot's.
4. **Never relay INTERCOM modulation** (H183). Never relay a radio that is `receiveOnly` (an Observer's radio), whether
   as the source or as the target.

## The drop checks (all independent, each its own test, ADR 0158 §4 as amended)

1. The sender `Guid` is ours (covers our own transmissions and our own relay output).
2. `RetransmissionCount` ≥ 1.
3. Wrong-way copy of a known run (re-specified above), plus our own originals.
4. Our PTT is down on that group.

Also drop: a frequency not in a linked group of ours; INTERCOM modulation; a target frequency we hold no lease for.

**Tests:**
- the round trip (relay a packet, feed our output back in, nothing sent);
- each check disabled in turn, with the loop still closed;
- a 200-packet transmission relayed in full;
- two simulated relays sharing a frequency, with the packets on the air not multiplying;
- both values of `RELAY_SETS_RETRANSMISSION_COUNT`.

## Leases (crc-sync)

Leases are per frequency, granted first-come, released on close, unlink or unstaff, and passed to the next claimant
(ADR 0158 §4).
- `crc-sync/src/radio/relay-leases.js`: the table, pure and in memory.
- One wire family file: find where non-EFSP hub families live, or put it beside `efsp/wire/families/` if the hub has
  only that. Frames go through `wire/frames.js` and `WsHub#deliverEfsp`; refusals go in `refusal-codes.js`.
- Do not run `wire:record`; the supervisor does.
- The client: `app/public/js/radio/relay-lease.js` (leaf state plus one sender) claims the frequencies of the
  session's linked groups whenever the radio set changes, and hands the grants to the engine.

## Files

One job each, about 300 lines at most:
- `app/srs/relay.js`: the decision, pure; inputs are the groups, the leases, the PTT state and the packet.
- `app/srs/relay-seen.js`: the run table.
- The relay is wired where received packets are handled (`srs-session.js` or a new `relay-path.js`, not by growing a
  file).

The engine learns the groups and leases through `radio-engine.js`: add `setLinkGroups(groups)` and
`setRelayLeases(frequencies)`, and log them as contract additions. The panel shows one grey "relaying" mark on a
group whose frequencies this client holds the lease for. The dark cockpit applies: nothing more.

## Not this lane

ATIS (step 5), removing Python (step 6), the radio set's rules.

## Deliverables

- the code and tests;
- ADR 0159;
- `docs/wip/RADIO-RELAY.md`: defaults, usage-guide text, and a manual test script with two pilots on two linked
  frequencies on a real SRS server.

Report per lane rule 8.
