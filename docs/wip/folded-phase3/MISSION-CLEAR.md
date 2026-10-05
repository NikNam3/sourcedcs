# MISSION-CLEAR (lane notes)

ADR 0108. Briefing and usage-guide edits are made (usage guide §8J "A new mission clears the Board", briefing "Mission reset (H108)").

## Defaults taken (P2)
- **Same-fingerprint `mission_start` needs the clock.** The brief says "use the existing roll-over decision" and also "never a bare
  `mission_start` with an unchanged fingerprint". Resolved: the session still rolls on it (ADR 0086 unchanged, archiver as before),
  but `onMissionReset` fires only once the clock is >60 s behind the old session's high-water mark within 10 min wall. A different
  fingerprint, `MISSION_CHANGED` and `CLOCK_STEP_BACK` clear at once. Constants `CONFIRM_STEP_BACK_MS`, `CONFIRM_WINDOW_MS` are mine.
- **Live Strips are dropped, then archived in the same roll-over** (the reset handler runs the archiver's roll-over sweep after
  dropping), so the Board and flight data are really empty; they do not wait for the retention. ARCHIVE_AFTER_MS untouched.
- **Audit shape:** one `MissionResetStrip` per Strip (the traffic count needs a stripId + before/after entry per drop) plus one
  `MissionReset` per Board with the counts; each changed store writes its own `MissionReset`.
- **Kept:** active runway + wind source (re-derived by the load for the new session), config, staffing.
- **MISSION (ATO) lines on TACTICAL are cleared too** ("every live Strip", H108). Re-import the ATO.
- **No client change, no notice.** The deltas are ordinary (`strips.gone`, store deltas).

## Walks not done / human-owed
- **S-F3 live check still owed:** does DCS-gRPC send `mission_start` to a stream that connects mid-mission? Restart crc-sync against a
  running server and watch `[mission-session]` and `mission reset` in the log: there must be no `mission reset` line. The guard makes
  the answer non-destructive, but only a live run shows the same-mission-reconnect case.
- A real DCS crash and `.miz` restart through DCS (expect `mission_start` with the same fingerprint, then `mission reset` once the
  clock reads back at the start).
- No browser walk: not run (client untouched). Open popover on a Strip that is dropped by a reset, and a pending Mutation targeting it
  (answered NOT_FOUND by the Board; the orphan path exists for a reconnect, this one rides the ack), were not exercised.

## Findings for other lanes
- **Traffic count:** a reset drop of a Strip in a countable pre-drop state is counted as traffic (a flight that never finished is
  counted like a finished one). Q for the human if that matters; an exclusion reason would be one line in `countability`
  (`traffic-count.js`) keyed on `after`/entry `reason: 'mission-reset'`.
- **Client notice:** none exists. A "New mission: Board cleared, N Strips" banner would read `summary` from a new frame field or a
  system alert; DESK-GRAPH owns `crc-desktop/app/`.
- **Correlation store has no `gone`:** `forgetAll()` moves the seq once and sends an empty `updated`; a client keeps stale correlation
  records for dead flights until its next resync (harmless: nothing references them). Same already holds for `retireFinished`.
- **Unchanged-fingerprint restart that does not step the clock a minute** does not clear (documented in ADR 0108 Consequences).
- The `efsp-board-delta` of a reset carries `flightDataList: { updated: [] }`; flight data leaves through the archiver's own
  delta right after (`flightDataListGone`).
