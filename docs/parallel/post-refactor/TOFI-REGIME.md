# TOFI-REGIME: the separation regime becomes effective at airspace entry (H97)

> Read `docs/parallel/refactor/README.md` (conventions, test policy) and `docs/parallel/lane-rules.md` first.
> Rulings: H97, H79 (AIRSP), S-R3-80 (`kind: AREA|ROUTE`), S-desk3/R3-16 and ADR 0096 (clocks), H95 (undo), S-TEST.
> ADR draft: `docs/wip/DES-RELEASE-adr-0102.md` (copy to `docs/adr/0102-…md` in your first commit). Questions DR-7,
> DR-8 and the UI sketch: `docs/wip/DES-RELEASE.md`. **decisions.md wins over this briefing.**

| | |
|---|---|
| Start | after the refactor window; may start before **AIRSP-2S-A** (ADR 0098's registry and `src/efsp/airspace/containment.js`) merges, coding against the I1–I4 signature with a test stub |
| Merge order | **AIRSP-2S-A → TOFI-REGIME** (never before 2S-A); and after CONTROL-RELEASE's client lane (CR-C) if both touch the exchange rows |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-TOFI-REGIME` on `lane/TOFI-REGIME-entry` |
| ADR | 0102 (depends on 0098) |
| Size / model | 1 lane / Sonnet 5.5 (server 0.6, client 0.4) |

Post-RENAME names (flight data = today's FDR, `fdrId` whatever RENAME called it; strip type = Role).

## Goal

At TOFI ENTRY accept the picked regime is stored as pending and ATC stays the effective regime. A monitor makes it
effective when the correlated flight is inside an airspace ACTIVE for the accepting MRU Facility; the MRU can mark
"Entered" by hand. Leaving the airspace, or the airspace deactivating, raises an alert and never changes the regime.
The TOFI handshake (propose, accept, comms, exit gated on SREG = ATC) is otherwise unchanged; no ControlRelease.

## Before you start: confirm the 0098 interface

ADR 0102 § "Depends on" lists I1–I4, as accepted by DES-AIRSP: at most one using agency per definition
(`usingPositionId` xor `usingFacilityId`; the acting Positions come from the `airspaceUse` capability);
`activeContaining({ lat, lon, altFt }, { usingFacilityId }) → { inside, unknown }` (current theater only, injected
through deps, never `require`d; ROUTE legs `segments[i].fix → segments[i+1].fix`; `unknown` only for
`geometry === null`); `isActiveFor(airspaceId, usingFacilityId)`; limits in indicated feet (`altimetry.js`
`indicatedAltFt`), converted by you. Until AIRSP-2S-A merges, inject a stub with that signature in tests and in the
monitor's deps; at merge, wire the real `containment.js` in `createApp` and delete the stub. Re-find what 2S-A
actually shipped by symbol and write the mapping in step 0. If something is missing, stop and SendMessage "main":
adding it is AIRSP's file, not yours.

## Owns

`crc-sync/src/efsp/fdr-store.js` (`setTofi`: the three new fields and their validation), `src/efsp/board/tofi.js`
(`Tofi`: ACCEPT writes pending; new action `MARK_ENTERED`; `markEntered` for the monitor; EXIT/REJECT clear pending),
the SetBlock op's SREG branch (pending vs effective), new `src/efsp/tofi-regime-monitor.js`, its ticker line in
`src/app.js` (`tofi-regime`, 1 s), the `tofiRegime` list on `efsp-alerts` (`ws-hub.js` compose line, `read-scope.js`
filter line), `config/alerting.json` (`regimeExitGraceS: 10`) and its schema, authority grant of `MARK_ENTERED` to the
MRU Positions (`authority/positions/tactical.js`), new tests `tests/tofi-regime*.test.mjs`, existing TOFI tests that
assert the regime at accept; client: `_tofiExchange`/TOFI indicator module (the `[Entered]` button, pending SEP REG
display), the `efsp-alerts` handler for `tofiRegime` (one `registerEfspMessage` consumer), CSS; the usage guide's TOFI
paragraph; `docs/adr/0102-…md`, `docs/wip/TOFI-REGIME.md`.

## Design

1. **Pending vs effective.** `setTofi` accepts `pendingSeparationRegime` (any `SEPARATION_REGIMES` value except
   `ATC`, or null), `pendingSince`, `pendingFacilityId`, `regimeEffective`. ACCEPT (no active MARSA): if the regime is
   `ATC`, write it as today; otherwise write `separationRegime: 'ATC'` plus pending, then ask the registry once: if the
   flight is already inside, make it effective in the same op (`trigger: 'AIRSPACE'`).
2. **`markEntered(flightDataId, { trigger, airspaceId, by, warning })`** is the one function that promotes pending to
   effective; the `MARK_ENTERED` op (MISSION Strip owner, ACTIVE ENTRY TOFI, pending present) and the monitor both call
   it. Manual without containment → `warning: 'NOT_IN_ACTIVE_AIRSPACE'` on the result and in the audit.
3. **Monitor** (`tofi-regime-monitor.js`), shaped like `conformance.js`: deps `{ boards, flightDataStore, trackStore,
   correlationStore, containment (I2/I3, stub until 2S-A), indicatedAltFt, weather, transitionAltFt, clock, wallClock, config }`; pure
   per-flight evaluation `evaluateRegime(input, mem, wallNow, cfg)` exported for tests. Entry needs 2 consecutive
   inside ticks; the outside alert needs `regimeExitGraceS` of wall time outside (ADR 0096: pure duration);
   `since` is mission time. No correlation → no change, alert kind `AWAITING_ENTRY_UNKNOWN` only while pending and
   only if the airspace is `unknown` or the track is missing (DR-8 tells the MRU to mark by hand).
4. **Writes from the monitor** go through the Board facade as a system mutation (actor `system`, one audit entry,
   board-delta + flight-data broadcast as ACCEPT's result does); never a direct store write from the monitor.
5. **MARSA precedence** (ADR 0051): the monitor skips a flight with an active MARSA relation; ACCEPT under MARSA
   writes no pending (as today).
6. **SREG Block** (DR-8 note in ADR 0102): before entry a non-ATC write replaces pending; `ATC` clears pending; after
   entry it writes the effective regime as today.

## Steps

0. Step 0 per README; "Code as found" incl. the 0098 mapping and every reader of `tofi.separationRegime`.
1. Flight-data fields + ACCEPT change + existing tests (`behaviour(TOFI-REGIME): …`).
2. `markEntered`, `MARK_ENTERED` op, authority grant, SREG branch, EXIT/REJECT cleanup.
3. Monitor + ticker + `efsp-alerts` list + config.
4. Undo registration of `MARK_ENTERED` (H95, 10 s), or a `test.todo` if the undo lane has not merged.
5. Client: pending display, `[Entered]`, alert chip; usage guide; ADR status; report.

## Tests

- ACCEPT with each regime: ATC (nothing pending), non-ATC outside (pending, effective ATC), non-ATC already inside
  (effective at accept), under MARSA (refusal and no pending as today);
- monitor (pure `evaluateRegime` with fake clocks): enter after 2 ticks, not after 1; leave → alert only after the
  grace; back inside clears; deactivation (registry state flip) raises the alert; overlapping airspaces; ROUTE corridor
  inside/outside; `unknown` geometry → no automatic entry; no correlation → no alert;
- manual mark: MRU side only; with/without containment (warning); twice → refused; undo within 10 s restores pending;
- EXIT with pending passes the SREG gate and clears pending; REJECT clears pending;
- audit: one entry per manual and per automatic entry, actor `system` for the latter;
- `efsp-alerts` carries `tofiRegime`, filtered by read scope.
`soak:selfcheck` (board files touched). Client: touched TOFI specs + boot smoke only (S-TEST).

## Acceptance

Both suites green; selfcheck green; ADR 0102 committed with the 0098 mapping in its "Depends on"; a manual walk with a
drawn AREA and a ROUTE (enter, leave, deactivate, manual mark without geometry) in `docs/wip/TOFI-REGIME.md`.
