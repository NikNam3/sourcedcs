# 0082 — Finished flights are archived: gone from memory and the Board snapshot, kept in the log

## Context

Nothing used to leave memory. A DROPPED Strip stayed in its Board's `_strips` forever, its FDR
stayed in the `FdrStore`, and both were written into every Board snapshot, which is persisted after
every Mutation. ADR 0002 made the Board durable ("mission reload must NOT clear this"), and ADR 0065
made the Mutation log the history. Neither said when a finished flight should leave.

L6's 4-hour soak measured the cost (`docs/wip/L6.md`, F3/F4/F7):

- `strips.dropped` grew from 19 to 378;
- the snapshot grew from 23 KB to 470 KB;
- `handleMessage` p50 grew from 0.8 to 13 ms;
- each DROPPED Strip cost about 7.8 KB of heap.

The human decided H36: archive DROPPED Strips (and FDRs with no live Strip) after 2 h or at mission
change, once L5 has counted them; the log keeps history. The supervisor fixed the rules in S-R2-13.

## Decision

### The rules (S-R2-13, verbatim)

> only FDRs that had a Strip and whose Strips are all DROPPED/archived; 2 h of wall time since the
> drop; mission change = F3's session roll-over; nothing archived can be undone; L5's backfill
> treats a missing FDR as `UNKNOWN`/`ARCHIVED`

Applied as:

1. A **Strip** is archived when it is `DROPPED`, and either 2 h of wall time have passed since its
   drop or the mission session rolls over, and the traffic count has its record.
2. An **FDR** is archived in the sweep that archives its last Strip, when no Strip on any Board
   (live, or DROPPED and not archived yet) still references it. TOFI's shared FDR stays while the
   other Facility's Strip is live. An FDR that never had a Strip is never a candidate.
3. **Mission change** is F3's roll-over (`missionSession.onNewSession`, ADR 0086: `MISSION_START`,
   `MISSION_CHANGED` or `CLOCK_STEP_BACK`). Everything DROPPED and counted goes at once, whatever its
   age. Live Strips stay.
4. **Nothing archived can be undone.** A Mutation on an archived Strip, `Undo` included, is
   `NOT_FOUND`. Only the mission-change path can archive inside the 30 s Undo window.
5. The traffic count's boot backfill of an archived drop classifies it `UNKNOWN`, basis `ARCHIVED`
   (L5 already did; a test now proves it).

"Archived" means removed from memory and from the snapshot. There is no archive file. The Mutation
log keeps the history.

### Wall-time retention

`BoardStore` keeps `_droppedWallAt` (stripId → `Date.now()` at the drop). It is set in
`_retireStrip`, deleted by an `Undo` that revives the Strip, and persisted in the Board snapshot as
`droppedWallAt: [[id, ms], …]`. It is not a Strip field, so the wire is unchanged.

Wall time on purpose: retention is a storage lifetime, like L5's log rotation, and the mission clock
rewinds on a reload (H11's line). A Strip that reached DROPPED by another path (a refused TOFI's
minted Strip, a `SetState`) is stamped at the first sweep that sees it, so it goes at most one sweep
late. A DROPPED Strip restored from a snapshot written before this ADR gets the restore time.

The 2 h is `ARCHIVE_AFTER_MS` in `crc-sync/src/efsp/archiver.js`, a constant. H36 fixed it, so it is a
decision, not tuning.

### The counted guard

The sweep archives a Strip only if `trafficCount.hasCountFor(stripId)` (L5's unvoided record for its
drop). An uncounted drop is skipped, warned by id, and retried next sweep, so a count bug shows as a
Strip that stays, never as silent data loss. With no counter wired (unit tests, the soak) the sweep
archives and warns once.

### Who does what

- `archiver.js` (`Archiver`) decides **when**: `sweep({ all, reason })` per Facility, then the FDR
  pass, then `marsaStore.evictMissingFdrs()` and `correlationStore.evictMissingFdrs()`, which used to
  run only at restore.
- `BoardStore.archiveStrip(stripId, reason)` removes the Strip from `_strips`, `_droppedWallAt` and
  `_nlaHistory` (L6 F7), and pushes a `{ type: 'gone' }` ring entry.
- `FdrStore.archiveFdr(fdrId)` removes the FDR, and releases its code only if the FDR still holds it.
- `server.js` wires the counter, a 60 s sweep and the roll-over. When a sweep archived anything it
  persists and broadcasts.

### The audit lines

One line per archived Strip, and one per archived FDR. Neither has `before`/`after`; the history is in
the earlier lines. L5's readers ignore both, because neither is a drop or an Undo.

```js
{ clientMutationId: null, op: 'Archive', stripId, fdrId, facilityId, actingPositionId: null,
  actorId: 'system', at, reason: 'AGE' | 'MISSION_CHANGE', missionSession?, sessionReason? }
{ clientMutationId: null, op: 'ArchiveFdr', fdrId, actingPositionId: null,
  actorId: 'system', at, reason, missionSession?, sessionReason? }
```

`facilityId` is on the Strip line from the start (L26 adds it to every Board entry).

### The ring's `gone`

The archive advances the Board's seq. `getDeltaSince` returns `{ updated, gone, seq }`, where `gone`
is the ids touched in the window that are no longer on the Board. A resync from before the archive
learns the Strip is gone once `efsp-ws.js`'s `_handleResync` sends `delta.gone` (ADR 0081, L27).

### The client's `fdrs.gone`

The archiver's `efsp-board-delta` goes out once per Facility whose ring advanced, through
`wsHub.broadcastEfspBoardDelta`: `strips.gone` holds the archived Strips, and `fdrs.gone` holds the
archived FDRs. `efsp-state.js`'s `applyEfspDelta` deletes the FDRs in `fdrs.gone`. Only this delta
carries `fdrs.gone`; every other sender's `fdrs` is unchanged.

### What this changes in ADR 0002 and 0065 (neither is edited)

- **ADR 0002.** "Durable" now means durable **until archived**. A live Strip still survives a
  restart and a mission reload untouched. A DROPPED Strip survives until 2 h after its drop or the
  next mission session.
- **ADR 0065.** The log was already the history. It is now the **only** place an archived flight
  exists. The traffic count keeps its own records (L5's `_entries`) as before.

## Alternatives considered

- **An archive file** (`state/efsp-archive.jsonl`, L24-Q2 (b)). Rejected: the log already has
  every line, and a second copy is one more thing to rotate.
- **The mission clock for retention.** Rejected: it rewinds on a reload, and a reload is already
  handled by the roll-over.
- **A tuning file for the 2 h** (L24-Q4 (b)). Rejected: H36 fixed the value.
- **Archiving on drop, with a short retention.** Rejected by H36. The 2 h keeps a just-finished
  flight on the server, where a controller or a reconnecting client can still get it by id.
- **A "recent flights" lookup of archived flights** (L24-Q3 (b)). Deferred (H73). Only the log has
  them.

## Consequences

- Memory and the snapshot are bounded by about 2 h of drops (about 100/h in the realistic soak,
  200 Strips and 100 FDRs). They no longer grow with the session.
- The soak's net-growth gate is 25% (H72). The retained 2 h fill for 2 h and then plateau, about
  +18% by themselves, so the old 10% could not pass.
- A controller who wants a flight from more than 2 h ago, or from before the current mission, reads
  the Mutation log. No screen shows it (H73).
- A client that missed the drop learns about the archive from the broadcast. On a resync it learns
  only after L27's `_handleResync` sends `delta.gone`.
- Until L27 stores compact replay records, `_appliedMutations` still holds the live result objects,
  so an archived Strip stays reachable from there until 5 000 newer Mutations push it out (L6 F4,
  decisions.md S-W3d).
- Until L26 puts `facilityId` on every log entry, a boot backfill of an archived drop records
  `facilityId: 'UNKNOWN'`, because the Strip is no longer on any Board to ask.
