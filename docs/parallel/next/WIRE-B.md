# WIRE-B: the heartbeat names every Facility's Board

> Read `README.md` in this folder, `docs/parallel/refactor/README.md` (conventions, **Test policy**) and
> `docs/parallel/lane-rules.md` first. Rulings: decisions.md **H88** (queue item 5: "per-Facility heartbeat, yes",
> WIRE-B after W2), ADR **0081** (Board sync: one event, one broadcast, epoch and replay), **S-UIB** (the client's three
> resync triggers: epoch change on a delta/ack, two heartbeats ahead, reconnect), **R3-47** (no resync on reconnect: the
> snapshot on connect is the recovery), questions-W6 Q6-BC-7 ("the per-Facility heartbeat itself stays WIRE-B's"),
> `docs/wip/SYNC.md` step 7 (SYNC-B comes after this lane, and wants the heartbeat to name every store's seq later).
> **VERSION** has merged: this is a wire change, so the protocol bumps (`npm run wire:record`).

| | |
|---|---|
| Wave | B, cut after **VERSION merged** (both edit `ws-hub.js`'s connect and tick area) |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-WIRE-B` on `lane/WIRE-B-facility-heartbeat` |
| ADR | **0104** "the heartbeat names every Facility's Board" (new) |
| Size / model | 0.75 lane / Sonnet 5.5. One lane edits both sides: a wire message changes, and its server and client land together |
| E2E lane | `E2E_LANE=3` (VERSION's, free once it merged): `ui-b-resync.spec.js` and the boot smoke |
| Merge | before **SYNC-B-S** |

## Code as found (re-find at step 0)

- Server: `ws-hub.js` `_tick` sends, every tick (500 ms), unconditionally:

  ```js
  { version, type: 'efsp-heartbeat', boardSeq: this._efsp.boardStoreFor(DEFAULT_FACILITY_ID).currentSeq }
  ```

  Only the **default Facility's** Board seq is in it (INCIRLIK, `facility-config.js` `DEFAULT_FACILITY_ID`), and no
  epoch.
- `efsp-ws.js` `_snapshotMessage` already sends `boardSeqByFacility`, `boardEpochByFacility` and `facilities` for
  every Facility. It also still sends `boardSeq` and `facility` marked "back-compat alias".
- Client:
  - `panels/efsp/efsp-state.js` `efspHeartbeatGapOf(msg)` compares `msg.boardSeq` with
    `efspBoardSeqByFacility.get(efspFacility)`, the **selected** Facility, with one `_heartbeatBehind` counter;
  - `efsp-ws.js` `noteEfspHeartbeatForSync` asks a resync for that one Facility;
  - `efsp-messages.js` registers `efsp-heartbeat` (staleness via `noteEfspHeartbeat`, and the sync check).
  - A controller signed on to Positions in two Facilities, or watching a Facility other than INCIRLIK, gets no
    heartbeat check for the others.
- Consumers of the heartbeat's shape:
  - `tools/soak/driver.js` ~169 matches the literal prefix `'{"version":1,"type":"efsp-heartbeat"'` (key order
    matters);
  - `tools/soak/host-core.js` (the `heartbeat` what-tick ~349);
  - `tools/soak/shadow.js` (per-Facility `boardSeq`);
  - `tests/ws-hub-heartbeat.test.mjs`, `tests/efsp-scenario-resync.test.mjs`, the freeze world (`freeze-world.mjs` ~69
    skips heartbeats by prefix);
  - crc-desktop's resync-state tests.

## Goal

The heartbeat names, for **every Facility whose Board this session receives deltas for**, that Board's seq and epoch.
The client checks each Facility it tracks: two beats in a row ahead, or an epoch different from ours, triggers that
Facility's resync. This is the same rule as today, applied per Facility, with at most one resync in flight per
Facility (S-UIB, unchanged).

## Design

- Wire: `{ version: 1, type: 'efsp-heartbeat', boards: { [facilityId]: { seq, epoch } } }`. `boardSeq` goes: no back
  compatibility, and the protocol bump covers the old client. Keep `type` as the second key so the soak's prefix
  matchers still match. Step 0 confirms every matcher.
- Which Facilities: the set the session's snapshot listed (`facilities`), filtered by the session's read scope exactly
  as deltas are (`efsp.filterForSession`/`readScopeKey`, ADR 0080). A JTAC-only session must not learn a Board's seq
  that it receives nothing from. If the read scope gives no Board-level answer, use the snapshot's Facility list for
  read-all sessions and omit `boards` entries for owned-scope sessions. Their resync answer is a snapshot anyway
  (`_resyncAnswer`: owned read scope → snapshot).
- Cost: one small object per session per tick. Build the `boards` map once per tick and reuse it for every read-all
  session.
- The snapshot's `boardSeq`/`facility` back-compat aliases: remove them in this lane if no client or tool reads them.
  Grep `crc-desktop/app`, `tools/soak` and the tests. Otherwise list the readers and leave them.
- Client:
  - `efspHeartbeatGapOf(msg)` returns the **list** of Facilities behind. A per-Facility counter replaces
    `_heartbeatBehind`.
  - An epoch in the heartbeat that differs from `efspBoardEpochByFacility` asks at once, the same rule as
    `efspEpochChangeOf` for deltas.
  - `noteEfspHeartbeatForSync` loops over them, through `requestEfspResync(facilityId, reason)`'s existing in-flight
    limit.
  - Staleness (`noteEfspHeartbeat`) is unchanged: any heartbeat is a live connection.
- ADR 0104: the shape, the read-scope rule, and the alias removal. It names SYNC-B as the lane that adds `stores` next
  to `boards`. Reserve the key name now, as `stores`, so SYNC-B adds a sibling rather than reshaping.

## Owns

- `crc-sync/src/ws-hub.js` `_tick`'s heartbeat lines.
- `crc-sync/src/efsp/efsp-ws.js` `_snapshotMessage` (alias removal only), plus a small exported
  `heartbeatBoardsFor(ctx, session)` beside it, if the read-scope logic belongs there.
- `crc-sync/src/efsp/index.js`: one accessor line, if needed.
- `tools/soak/{driver,host-core,shadow}.js`: the heartbeat lines only. Run `soak:selfcheck`.
- `tests/ws-hub-heartbeat.test.mjs` and the resync scenario test. The freeze world's prefix stays valid, so re-record
  nothing.
- `crc-sync/tests/fixtures/wire-surface.json` and the `WIRE_PROTOCOL` bump in both copies, via `wire:record`.
- crc-desktop: `panels/efsp/efsp-state.js` (`efspHeartbeatGapOf` and its counter), `panels/efsp/efsp-ws.js`
  (`noteEfspHeartbeatForSync`), and their unit tests (`efsp-resync-state.test.mjs` …).
- `docs/adr/0104-…md`, `docs/wip/WIRE-B.md`.

## Frozen for you

`ws-hub.js` `_admit`/`attach` (VERSION, merged), everything else in `efsp-ws.js` (UNDO-S edits its Board path), the
stores, and the client panels beyond the two functions.

## Steps

0. Step 0 per the refactor README:
   - re-find every site above and every heartbeat consumer (server, soak, tests, client);
   - how `filterForSession`/`readScopeKey` decide per session, and the read-scope cases (read-all, owned, JTAC);
   - who reads the snapshot aliases.
1. ADR 0104.
2. Server: the heartbeat shape, the per-session Facility set, the alias removal, the tests (read-all session sees every
   Facility; owned-scope session sees none it cannot read; seq and epoch correct after a mutation and after a
   restore). Run soak:selfcheck.
3. Client: the per-Facility gap and epoch check, plus tests (two Facilities, one behind; an epoch change; at most one
   in flight each).
4. `wire:record` (protocol bump as its rule says). `ui-b-resync` and the boot smoke on `E2E_LANE=3`. Both unit suites
   once.

## Acceptance

- A lost last delta on a non-default Facility is caught within two beats and healed by one resync (unit test and
  `ui-b-resync` pass).
- An owned-scope session's heartbeat names no Board it cannot read.
- The soak selfcheck passes (`drop-broadcast` still fires).
- The wire-surface test is green with the bump.
- Both suites green.

## Defaults (P2)

- Epoch in the heartbeat: yes (it is the cheaper trigger).
- The heartbeat cadence stays at every tick.
- No per-store data here: that is SYNC-B's.
