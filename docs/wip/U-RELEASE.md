# U-RELEASE: released handoffs, check-in, control at the boundary (U5–U8), ADR 0122

Lane U-RELEASE, branch `lane/U-RELEASE` from `319db075`. Resumed after a usage stop: the first agent left the server model
(`03e32873`) and an uncommitted fixture edit (kept, committed as `a069d14c`). ADR:
`docs/adr/0122-a-handoff-is-released-or-not-control-moves-after-check-in.md`.

## What was built

- **Server.** `HANDOFF PROPOSE` takes `released` (default true). `HANDOFF CHECKED_IN` (receiver only) moves comms, and
  control too when released. `ControlRelease` is REQUEST (receiver, not-released only, before control moved, one open) /
  GRANT (makes it released; control moves now if checked in) / REFUSE; no WITHDRAW, no scopes. TRANSFER_COMMS and
  TRANSFER_CONTROL are unknown HANDOFF actions. The control tick (`handoff-control`, 1 s) moves control of a checked-in,
  not-released handoff once the correlated contact is inside the receiving Position's airspace (ADR 0125), audited as
  `HandoffControlInAirspace`. Obligations NOT_CHECKED_IN (receiver, after `alerting.json handoff.notCheckedInSec` = 60) and
  IN_AIRSPACE_NOT_CHECKED_IN (both sides). `efsp.insideReceiverAirspace(strip)` and `efsp.locateFlight(flightDataId)`.
  Guard seam `src/efsp/handoff-guards.js` (empty; phases OFFER and CONTROL; for U-RSU's IFR_NOT_CANCELLED).
- **Client.** Coordinate popover: a "Released" checkbox (ticked) shown only for Hand Off. The receiver's row: "Checked in",
  and on a not-released handoff "Request release…" (note only). The handing-off station: "Release" (one click) and
  "Unable…" only while a request is open. Chips: COMMS/CTRL grey; RELEASED / NOT RELEASED grey on the receiver until control
  moves; RELEASE REQUESTED amber for the handing-off station; RELEASE REFUSED amber for the receiver; nothing after control
  moved. Badge labels for the two new obligations.
- **Soak driver.** Checks in after every ACCEPT; 30 % of its CTR/AP handoffs are not released and then request and get a
  release.
- **e2e.** `e2e/control-release.spec.js` rewritten (4 tests); `e2e/mtr-pilot-walk.spec.js` presses Checked in instead of
  Control to AP; `e2e/helpers/fake-dcs.js` can serve `StreamUnits` (`startFakeDcs(port, { units: true })`, `setUnit`), off
  by default.

## For the usage guide (docs/efsp-usage-guide.md, the owner's to word)

> **Handing off.** Coordinate → Hand off. Leave **Released** ticked (the normal case): control passes when the receiver
> marks the aircraft checked in. Untick it to keep control until the aircraft is inside the receiver's airspace as well.
> Tell the pilot to contact the receiver; there is no separate comms button.
>
> **Receiving.** Accept the handoff. When the pilot calls, press **Checked in**. On a released handoff control is yours at
> once; on a not-released one it becomes yours by itself once the aircraft is inside your airspace (the Strip says NOT
> RELEASED until then). You cannot take control by hand. To have it sooner, **Request release…**; the other controller
> releases (control is yours at once if checked in) or says unable.
>
> **Amber means:** a handoff to answer; an aircraft accepted a minute ago and not yet checked in; a not-released aircraft
> already in your airspace but not checked in; a release request waiting for your answer (handing-off station); a
> refused request (receiver).

## Defaults taken

1. **AP→LC and AP→PAR (H143) are not built.** A HANDOFF is cross-Facility only (`coordination target must be a different
   Facility`) and LC/PAR take no HANDOFF, so inside INCIRLIK a handoff is a TransferStrip/NLA with no record, no switch and
   no check-in; control follows the owner (ADR 0101). The tick answers per receiving Position (unit test: LC/GC are judged
   on LTAG-CZ, AP/PAR on RAPCON), so it would apply as is if intrafacility transfers got the model. **Supervisor decision.**
2. The briefing's e2e "AP→CTR not released crosses the RAPCON boundary" is built as asked (a fake DCS unit climbs above
   FL280 out of RAPCON into CENTER's fallback). The request/grant e2e runs CTR→AP (same mechanics, the existing helpers).
3. Not-checked-in threshold 60 s (`alerting.json handoff.notCheckedInSec`); `state/alerting.json` overrides.
4. IN_AIRSPACE_NOT_CHECKED_IN is raised for a **not-released** handoff only (as the briefing words it); a released one not
   checked in gets NOT_CHECKED_IN after 60 s.
5. A refused release request stays amber on the receiver's Strip until the handoff is released or control moves (there is
   no acknowledge).
6. The tick moves control only to a live, covered receiver and only on a correlated contact; a GRANT on a checked-in
   aircraft toward an unstaffed receiver is refused NOT_STAFFED.
7. Retirement and repair moves do not ask the handoff guards.
8. The soak driver never REFUSEs (see findings).

## Human action (state/)

- **A Board snapshot from before this lane stops start-up** if any Strip in it carries a HANDOFF record: the key
  `coordination.release` is unknown now (`checkPersistedShape`, no migration). Delete `state/efsp-board.json` on the server
  before deploying, or wait until it holds no HANDOFF Strips (finished Strips are archived after
  12 h, ADR 0107). The supervisor's S-ARCH-64 note about `state/efsp-airspaces.json` lacking the Syria jurisdiction areas
  matters here too: without them every point is CENTER's (the tick then moves a not-released handoff to AP/LC never).

## Gates (on the lane head)

- crc-sync `npm test`: 2790/2790 (before: 2775). crc-desktop `npm test`: 1353/1353 (before: 1352).
- `npm run walk` (depth 4): 24/24; I11 walks both switch positions (released 336 sequences / 37 states, not released
  448 / 70), actions ACCEPT, CHECK_IN, TAKE_CTRL (refused), REQUEST, GRANT, REFUSE, IN_AIRSPACE, drops, undo, staffing.
- `npm run freeze`: 56/56 after two separate `freeze:update` commits (hash-only record change; the random hub goldens follow
  the soak driver).
- `npm run soak:selfcheck`: PASS.
- `npm run wire:record -- --bump`: protocol stays 2, surface unchanged.
- e2e (E2E_LANE=7): control-release (4), mtr-pilot-walk, l3-coordination: 20/20.

## Findings for other lanes

- **Soak (selfcheck leak detector):** with REFUSE in the driver's mix (20 % of requests) the injected leak's heap slope
  fitted with R² 0.86 (< 0.9) twice, deterministically; with always-GRANT it is 0.96, with the pre-lane driver 0.98. Not
  investigated: either refused, never-settled exchanges make the heap noisier, or they retain something. Worth a look
  by whoever owns the soak (a 3 h run with refusals and `--judge-memory`).
- **U-RSU:** add `IFR_NOT_CANCELLED` to `HANDOFF_GUARDS` in `src/efsp/handoff-guards.js` (and its code to
  `refusal-codes.js`); both phases are wired and unit-tested with a stand-in guard (`control-release-boundary.test.mjs`).
- **Freeze:** ControlRelease and HANDOFF CHECKED_IN are not in the hub op matrix (`hub-op-matrix/` has no ControlRelease
  file); covered by unit tests only.
- **U-PAR:** no file of yours touched; the PAR final's HANDOFF-free path is unchanged.
