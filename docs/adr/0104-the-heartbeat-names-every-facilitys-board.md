# 0104 — The heartbeat names every Facility's Board

## Context

The `efsp-heartbeat` (every tick, 500 ms) carried one number: the default Facility's (INCIRLIK) Board seq. The client compared it
with the selected Facility's seq only. A lost last delta on any other Facility was never caught, and a changed Board lifetime
(epoch) was caught only when a delta or ack arrived (ADR 0081, S-UIB). H88 queue item 5 asked for a per-Facility heartbeat.

## Decision

- **Shape**: `{ version: 1, type: 'efsp-heartbeat', boards: { [facilityId]: { seq, epoch } } }`. `boardSeq` is gone (no back
  compatibility; the protocol number of ADR 0103 already separates old clients). `type` stays the second key so the soak and
  freeze prefix matchers still match. The key `stores` is reserved, as a sibling of `boards`, for SYNC-B (the other stores' seqs).
- **Which Facilities** (read scope, ADR 0080): a session that reads everything is named every Facility, from one map built once
  per tick and shared. A session that reads only what it owns is named the Facilities where it holds a Position, the Boards it
  can read. Its resync answer is a snapshot anyway. (Owned sessions are still sent an empty delta and the snapshot's seq for every
  Facility, so this hides nothing already sent; it keeps the heartbeat to Boards that session can actually have Strips on.)
- **Client**: `efspHeartbeatGapOf(msg)` returns the list of Facilities to resync. Per Facility: two beats in a row ahead of
  our seq, or an epoch different from ours (at once, as `efspEpochChangeOf` does for deltas). Each is asked through
  `requestEfspResync`, which keeps at most one resync in flight per Facility. Staleness is unchanged: any heartbeat is a live socket.
- **Snapshot aliases removed**: the top-level `boardSeq` and `facility` of `efsp-snapshot` (back-compat aliases for INCIRLIK).
  The client's selected Facility is `facilities[0]` (the default Facility, first in the config order) and its seq is
  `boardSeqByFacility[facilities[0]]`.
- Protocol: unchanged at 2 (ADR 0103 bumps once between releases; the last release speaks 1). `wire:record` finds the recorded
  surface unchanged because it does not cover the heartbeat's keys.

## Consequences

A lost last delta on any tracked Facility heals within two beats by one resync. SYNC-B adds `stores` beside `boards`.
