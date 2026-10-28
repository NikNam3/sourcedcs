# WIRE-B: the heartbeat names every Facility's Board (ADR 0104)

## Code as found
- `ws-hub.js` `_tick` sent `{type:'efsp-heartbeat', boardSeq}` for INCIRLIK only; soak driver/freeze world match the literal prefix
  `{"version":1,"type":"efsp-heartbeat"` (kept valid). Soak shadow and host-core never read the beat's body: no soak edits.
- Client `efspHeartbeatGapOf` checked only the selected Facility with one `_heartbeatBehind` counter.
- Snapshot aliases `boardSeq`/`facility` were read only by the client's `applyEfspSnapshot` and by tests that fed it.
- Owned-scope sessions already get an (empty) delta for every Facility.

## Done
- Server: `heartbeatBoardsAll`/`heartbeatBoardsFor` (efsp-ws.js, exposed in efsp/index.js), `_tickAll` builds the map once.
- Client: per-Facility counter, epoch trigger, loop in `noteEfspHeartbeatForSync`; snapshot reads `facilities[0]` and `boardSeqByFacility`.
- Aliases removed. Tests: ws-hub-heartbeat, ws-hub-read-scope (real EFSP), efsp-resync-state (three new), scenario-resync.

## Defaults taken
- Owned-scope sessions are named the Facilities where they hold a Position (S-WIREB0 accepted), not none.
- Protocol stays 2 (`wire:record` reports surface unchanged; 2 is already unreleased).

## Not done / findings
- The wire-surface fixture does not cover heartbeat keys; the heartbeat shape is pinned by the heartbeat tests instead.
- Restore case: an epoch is per Board instance, covered by the client epoch test, not by a server restore test.
