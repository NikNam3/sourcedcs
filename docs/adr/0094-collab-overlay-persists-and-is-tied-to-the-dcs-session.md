# 0094 — the collaborative overlay persists, and belongs to one DCS mission session

Builds on `0086` (mission session) and `0059` (truth never reaches a client). Triage S-13: the
human decided "declarations should survive a crc-sync restart but not a DCS server restart".

## Context

Controllers' IFF declarations and tags live in `collab-store.js`, keyed by DCS unit id. Before
this ADR the store was memory only, and its life was accidental:

- A **crc-sync restart** lost all of it.
- **Every `mission-load`** wiped it, including loads that change nothing.
- A **gRPC reconnect** lost it whenever the unit stream was down longer than the 12 s track
  reaper plus the 5 s sweep: the track expired, then `evictStale` deleted the entry, and the
  unit coming back under the same id was undeclared.
- A **DCS restart** is what wipes it on purpose, because unit ids re-mint. Two failure shapes
  were not covered: a restart crc-sync did not see (it was down), and an id reused by a different
  unit.

## Decision

1. **Persisted.** `state/collab-overlay.json` (`state-paths.js`, override `CRCSYNC_COLLAB_PATH`),
   written atomically (tmp + rename) after every mutation, read once at startup. A corrupt file is
   moved aside (`.corrupt-<ms>`) and the store starts empty. `persist: true` is passed only by
   `server.js`; a bare `new CollaborativeStore()` stays in memory.
2. **Tied to a session.** The file records the mission-session number (`0086`) it was written in.
   Each entry also records the identity of its unit: DCS unit name, type, coalition, callsign.
3. **The rule.** An entry is shown only while all three hold:
   - the session number is unchanged. `MissionSession` rolls on `mission_start`, a different
     mission fingerprint, or a mission-clock step back of more than 5 min. A roll calls
     `clear()`, which also empties the file. `mission_start` clears at once, not at the load.
   - the unit streamed under that id is the same unit: same type, same coalition, and same DCS
     unit name (callsign when a name is missing). A different unit under the id drops the entry
     for good, whenever it is seen.
   - the unit has not been reported gone by DCS (`gone` drops the entry).
4. **Restart gate.** Entries loaded from disk are not shown until crc-sync has seen the first
   `mission-load` and the first mission-clock sample. The load lets a different mission roll the
   session. The clock sample lets a restarted `.miz` roll it by the clock step-back. If no clock
   sample arrives within 15 s (wall-clock fallback) the gate opens anyway. A persisted session
   number different from the live one discards the file's entries. Units already streamed while
   the gate was shut are checked when it opens.
5. **Parking.** `evictStale` no longer deletes the entry of a track that is not streamed. It
   parks it, and `observeUnit` revives it only if the same unit returns under that id. Parked
   entries expire after 10 min (grace starts at gate open for restored ones). A gRPC reconnect,
   however long up to that, keeps declarations. `mission-load` no longer clears the overlay.
6. **Wire unchanged.** Nothing about identity, parking or the session reaches a client. The
   overlay is still read through `get()` by `surveillance/`.

Wiring is `src/collab-wiring.js`, called from `server.js` after its mission-load and game-time
handlers (listener order matters: the session must roll before the gate looks at it).

## What it can and cannot detect

Detects: `mission_start` while crc-sync is connected; a different mission loaded while crc-sync
was down; the same `.miz` restarted while crc-sync was down, provided the mission clock had
advanced more than 5 min before the restart (lastAt is persisted at most once a minute); an id
re-minted to a different unit at any time; a despawned unit.

Cannot detect: a same-`.miz` restart within 5 min of mission time while crc-sync was down AND
the same unit under the same id (same name, same type): the declaration is restored onto what is
now a fresh instance of that unit. This is the conservative edge of what DCS-gRPC lets us know,
and it is mild: the same unit, the same callsign, a few minutes in. Also not detected: a DCS-gRPC
process restart alone (DCS running) changes nothing, correctly, since DCS unit ids survive it.

## Failure modes

- State directory not writable: persistence logs a warning and the store keeps working in memory.
- gRPC down longer than 10 min, then back: declarations are dropped at expiry. Accepted.
- DCS never reconnects after a crc-sync restart: restored entries stay held and expire silently
  (their grace starts only when the gate opens, so they stay on disk until then).
- The radar picture, `surveillance` track numbers and the track store also key on unit ids and
  are rebuilt from the stream after any restart; they carry no controller input, so they are not
  persisted. `mission-load` still resets them.
