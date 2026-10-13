# LT-AIRSPACE-ALERT (T27 rights, T29 alert) — ADR 0119

Lane notes. The ADR is `docs/adr/0119-airspace-entry-alert-by-type-and-the-using-agency-approves-entry.md`. The lane was
stopped part-way once (an accidental click); the supervisor checkpointed the uncommitted work (`6c6e7b27`) and a second
agent finished it.

## What was built

1. **Agency rights (H134 LT-RQ13 a).** OPS's `airspace` row: create/edit/delete `null`, `use: true`, both sides
   (`authority/positions/civil-atc.js`, client `AIRSPACE_ROWS.OPS`, parity test). Only the controlling Position defines an
   airspace. Tests updated: `airspace-registry.test.mjs`, client `airspace-capabilities-parity`, `airspace-panel-views`.
2. **Entry approval (H136 VQ5 a).** `ApproveAirspaceEntry`/`ClearAirspaceEntry`: the op grant (AP, CTR: the Position
   working the Strip relays) or the airspace's using agency (`authority/airspace.js` `isUsing`), on a live Strip of its own
   Facility it does not hold (`facility-rules.js` `mayActBesideOwner`). The rights are inline in the two op files: the
   checkpoint's shared `board/airspace-entry-rights.js` broke the board seam (no sibling requires under `board/`) and is
   gone. Clear has an early gate (`isAirspaceUsingAgency(pos, null)` = the using agency of any airspace) so CD/GC/LC/PAR
   keep `PERMISSION_DENIED`; the Strip's own airspace is checked in `apply`. New Board rule `isAirspaceUsingAgency`
   (60 required rules). Client: "Airspace…" / "Leave airspace" in the Strip menu for a controller holding the using agency
   and not the Strip (`_usingAgencyEntryChoices`).
3. **The alert (H132, H134 LT-Q5 a, H136 VQ4 b).** `crc-sync/src/efsp/airspace-entry-alert.js`, wired in
   `app/monitors.js` and the `conformance-conflict-alert` ticker (after CA). `efsp-alerts.airspaceEntry`, per session via
   the hub's `airspaceEntryFor` (controlling Position + every Position holding a live Strip of the flight). Client:
   `alerts-state.js`, ATC block line 0 `SAA` amber (palette key `caution`), click-to-acknowledge (`AS:` key with `since`),
   classic label `SAA`, Strip chip "Airspace conflict <name>", track-panel line. `vfr.js` shared (`hasNoClearance`).

## Defaults taken (P2)

- **Untracked contacts alert only when they report altitude** (H136 VQ8 a's MCI rule): a primary-only target cannot be
  placed against an airspace's vertical limits by the controller. Ours.
- **RANGE and DANGER are restricted-like** (research V3 (b), inference).
- **A ROUTE (MTR) never alerts.** Ours.
- **MOA/WARNING: a tracked IFR flight without approval alerts.** Ours (labelled in the ADR).
- **An MRU TOFI (pending or effective) for a Facility the airspace is ACTIVE for counts as approval.** Ours: the MRU is the
  using agency that took the flight (ADR 0102).
- **A formation's uncorrelated wingmen are the flight** (ADR 0118 members): one alert per flight and airspace.
- **Not alerted under 50 kt ground speed or 10 s track age** (`alerting.json` `airspaceEntry`, CA's numbers). A hovering
  helicopter in a range does not alert. Ours.
- **Tag `SAA`** (P/CG Special Activity Airspace) on the data block; amber `caution` colour in both palettes (no TCW value).
  Strip/panel text "Airspace conflict <name>" (P/CG AIRSPACE CONFLICT).
- **Acknowledgement is client-local** (as CA, STARS-style); a new entry (new `since`) blinks again.
- **The using agency is not sent the alert** (the briefing says controlling Position and working Position).
- **No predictive look-ahead** (EDST probes; ours is containment only).

## Wire

`efsp-alerts` gains `airspaceEntry`. `tools/wire-surface.js` now records `efsp-alerts`' top-level keys (it did not scan
that frame before, so a new slice went unnoticed). `npm run wire:record`: WIRE_PROTOCOL stays 2. Freeze goldens
re-recorded once (separate commit): every hub golden's efsp-alerts frame gains `airspaceEntry: []`; scenario-airspace's
SOUTH_RANGE `ClearAirspaceEntry` on the RANGES Board is now `NOT_FOUND` (it is RANGE-SOUTH's using Position, so it passes
the early gate) instead of `PERMISSION_DENIED`.

## Specs (lane 3)

- New `e2e/airspace-entry-alert.spec.js` (2): OPS approves/clears on AP's Strip against the real crc-sync (GC refused);
  the alert display, injected (the rig has no DCS units, so the monitor never fires there).
- `e2e/airspace-server.spec.js` + 1: OPS has no "+ New airspace" and an Incirlik create as OPS is refused "only AP may".
- Run: airspace-entry-alert 2/2, airspace-server 7/7, flight-following 3/3.

## Walks not done

- No live DCS walk: an aircraft actually flying into an ACTIVE restricted area / MOA, a 2-ship with a wingman squawking,
  helicopters at a range, the indicated-altitude edge at a floor.
- The alert spec injects the efsp-alerts frame; the server path is covered by unit tests only.

## For the guide / briefing (docs pass)

- Airspace definition: only the controlling Position (and the web admin). OPS schedules, requests activation, releases
  and approves entry for airspace Incirlik uses (its using agency).
- Entry approval: the Position working the Strip, or the using agency on a Strip it does not hold.
- The airspace-entry alert: what triggers it by type, `SAA` amber in the data block, click to acknowledge, chip on the
  Strip, retracts on leaving or approval. `alerting.json` `airspaceEntry` keys.
- `airspace-schema.js`'s "type is never read for behaviour" comment is amended in code; the briefing's D14 wording
  should follow.

## Findings / for the supervisor to decide

- **The using agency cannot see the flights it may approve.** OPS's Bays show only OPS's Strips, so the new
  "Airspace…" item on AP's Strip is reachable only where that Strip is drawn for an OPS-only controller, which today is
  nowhere; a controller holding OPS and AP gets the owner path. The server path works (spec). Options: deliver the alert
  to the using agency too and let it approve from the alert; an "in airspace / requesting" list on the airspace card; or
  leave approval to the Position working the Strip (relay, ¶9-3-1 NOTE). Human call.
- **A RANGES using Position** (`usingPositionId`) is the using agency in the rules but works no Board, so it cannot approve
  on an INCIRLIK Strip. Unchanged.
- **No "Start flight following" from the alert on an untracked contact**: the alert names it; the controller uses the
  track panel's existing action.
