# 0108 — A new mission clears the Board

## Context

F3's mission session (ADR 0086) decides when DCS is in a new mission, and the archiver (ADR 0082, rule 3) files the DROPPED
Strips at that moment. Live Strips were deliberately left alone (ADR 0002): they all survived the roll-over. After a DCS crash
or a restart for the next sortie that is a Board of flights that no longer exist: respawned aircraft with new unit ids,
departures queued on the old runway's Rack, a runway still suspended for works, a carrier stack for a recovery that is over,
MARSA relations and TOFI links about dead flights. Q3-4 offered a one-click clear (a) or automatic clearing (b). The human
chose (b), decisions.md H108: "dcs crash -> clear the board."

## Decision

At a **real** mission roll-over the system clears the per-mission state, once.

- **What is cleared.** Every live Strip on every Board goes to DROPPED, one system pass per Board
  (`BoardStore.resetForMission`), through the same `retire` a controller's Drop uses, so the flight data, beacon code, MARSA
  membership, carrier stack entry and peer link are released exactly as for any drop. `retire` takes `{ force: true }`: an
  ACTIVE TOFI exchange, which refuses a controller's drop, ends with the flight. The per-mission stores reset: runway status
  (every runway OPEN, no suspension, closure, inspection, pending request or runway change, empty pads), carriers (Case,
  stacks, ship inputs), MARSA (a relation still ACTIVE ends as `PARTICIPANT_RETIRED`), the SFA rotation (configured start),
  and the correlation records. ALERT and SCRAMBLE flags, coordination and TOFI links, comms and control are on the Strips and go
  with them. ATO MISSION lines (TACTICAL) are Strips and go too; the ATO is imported again.
- **What is not cleared.** Configuration (Facility config, airspace definitions and the registry, stereo routes, theaters,
  apt-config), Position staffing, the Mutation log (it gains the reset), metrics and the traffic count. The active runway and its
  wind source stay: the mission-load that follows re-derives it for the new session (ADR 0086, H22), and a stale value is
  safer than none if that read fails.
- **Audit.** Per Strip one `MissionResetStrip` entry (actor `system`, `reason: 'mission-reset'`, `before`, `after`,
  `missionSession`, `sessionReason`): the traffic count reads it as the drop it is, so each flight that was traffic is
  counted once and the archiver's "counted before archived" rule holds. Per Board one `MissionReset` entry with the counts
  (`strips`, `flightDataList`). Each store that changed writes its own `MissionReset` entry (runway status per Facility,
  carrier per hull, MARSA per relation, SFA).
- **Delivery.** `efsp.resetForMission` persists, and `app.js` delivers through `deliverEfsp`: one `efsp-board-delta` per Board
  that had Strips (the dropped ones as `gone`, plus any peer Strip the exchange change touched), then one delta per store
  whose seq moved (`efsp-marsa-delta`, `efsp-carrier-delta`, `efsp-runway-status-delta`, `efsp-sfa-delta`,
  `efsp-correlation-delta`). The correlation store has no `gone`, so its seq moves once and the delta updates nothing; a
  client that misses a frame heals through the heartbeat (ADR 0106). The archiver's roll-over sweep then runs, so the dropped
  Strips and their flight data leave memory at once and the Board is empty, not 12 hours from empty. No wire shape changes: the
  surface is the existing frames and two new Mutation-log ops (`MissionReset`, `MissionResetStrip`).
- **The guard.** `MissionSession.onMissionReset(fn)` is narrower than `onNewSession`. It fires at once for
  `MISSION_CHANGED` (a different fingerprint), `CLOCK_STEP_BACK` (the clock went back more than 5 min) and a `MISSION_START`
  that names a different fingerprint from the session before it. For a `MISSION_START` on the **same** fingerprint (the
  restarted `.miz`, and also what a reconnect that replays `mission_start` would look like) or with no earlier fingerprint
  to compare, it waits for corroboration: the mission clock, observed on `game-time`, more than 60 s behind the old
  session's highest reading, within 10 min of wall time. A real restart puts the clock back at the mission's start; a spurious
  `mission_start` on a running mission does not. It never fires for the first session, a gRPC reconnect (another
  `mission-load`, same fingerprint), or a crc-sync restart onto the same mission (the persisted session and clock carry on).
  The pending confirmation is memory only, so a crc-sync restart inside the window errs toward not clearing.

## Why automatic

The human decided it (H108). The recommended alternative, a one-click clear, was recommended because a spurious `mission-load`
on a crc-sync restart would destroy a real picture. The guard answers that: the clear never rests on a bare reconnect or a
bare `mission_start`. What remains owed is the live check of whether DCS-gRPC sends `mission_start` to a stream that connects
mid-mission (S-F3); the design is correct either way, and the check says only how often the confirmation path is the one taken.

## Consequences

- A DCS crash followed by a restart of the same mission whose clock does not go back by a minute (a crash within the
  first minute, or a mission that restarts from a saved point later than before) does not clear; the controllers drop by hand,
  as before.
- A reset drop counts as traffic for a flight that was in a countable pre-drop state (ADR 0065), the same as a controller's drop.
- There is no Undo and no confirm. A pending Mutation of a controller on a cleared Strip is answered NOT_FOUND by the Board.
- The client shows the Strips leaving; there is no "New mission: Board cleared" notice (a finding, not built).
- ADR 0082's retention is unchanged; the reset only makes the roll-over sweep find the Strips.
