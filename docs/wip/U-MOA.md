# U-MOA — lane note (ADR 0124)

Branch `lane/U-MOA`, cut from `543c1c1f`. Rulings H140 (LT-AQ1 b), H141 (U-RQ6 a), S-ARCH-58.

## What was built

1. **Airspace card flight list** (server `crc-sync/src/efsp/airspace-entry-alert.js` `trafficFor` / `getTraffic` /
   `routeNames`, `src/app/monitors.js`, `src/ws-hub.js`; client `panels/efsp/airspace-entry-list.js`, a separate block
   built from `airspace-card.js`, state in `alerts-state.js`, CSS in `airspace-panel.css`). Rides `efsp-alerts` as
   `airspaceTraffic`, per session.
2. **MARSA void before rendezvous only for tanker MARSA** (`marsa-store.js` `voidForAssignment`; client
   `marsa-badge.js` `marsaInterlockArmed`, used by the badge, the menu actions and `strip-exchanges.js`).

## Usage-guide wording (for DOCS)

**Airspace panel, card (add under the airspace card section):**
> If you hold the airspace's using agency (OPS at Incirlik) or its controlling Position, the card of a restricted area,
> MOA, warning area, range or danger area lists the flights **inside** it and those **filed** through it (the filed route
> names it, it is the flight's working airspace, or the flight is already approved into it). Each row shows the callsign,
> why it is listed, and **Approve**, or a grey "approved" once entry is approved. A row turns **amber** only while the
> flight is inside without approval and raising the airspace-conflict alert. **Approve** approves entry on the flight's
> Strip, wherever the Strip is (AP's, CTR's); the Strip stays where it is and the alert clears for everyone. A flight
> without a Strip (an uncorrelated contact) is not listed: correlate it first. Other Positions see no list.

**MARSA in a MOA (R7 click-by-click, replaces R7 step 4):**
1. On either flight's Strip: menu → **Flight → "MARSA…"**.
2. Pick the other flight, start event **"local declaration"**, end condition **"until ATC separation is re-established"**,
   type the declaring callsign → **Declare**.
3. Both Strips show `MARSA` and SREG reads MARSA. No CA/MCI between them; alerts against everyone else stay.
4. Keep working them: headings and altitudes you assign **do not** void a local-declaration MARSA (only a tanker MARSA
   voids before rendezvous; only that one shows `MARSA ⚠` and "Mark rendezvous").
5. Each flight still needs its own entry approval into the MOA (airspace card → Approve, or "Airspace…" on its Strip);
   MARSA approves nobody.
6. End: "MARSA…" → **End MARSA** when ATC separation is re-established.

**Briefing:** `airspace-entry-alert.js` now also builds the card list (`trafficFor`, filtered like `deliverableTo`);
`voidForAssignment` voids only `TANKER_ACCEPTED`.

## Defaults taken

- **"Filed through" = name match, not geometry** (briefing's fallback): nothing resolves a filed route to points, so it is
  a live Strip approved into the airspace, the flight data's `comms.airspaceId`, or the filed route naming the airspace id
  or name as a whole word (any case). Inside = the monitor's own containment test.
- Listed types: RESTRICTED, PROHIBITED, RANGE, DANGER, MOA, WARNING (`ENTRY_TYPES`); ROUTE never (keeps its count line).
- A VFR flight inside a MOA is listed (it may still want approval) but never amber (ADR 0119's rule decides amber).
- Approve is sent as the Strip's owner when this controller holds it, else as the using agency; a controlling Position
  that holds neither sees the row without Approve (the server's existing rights decide; not widened).
- Where the list is shown, it replaces the card's old "flights in this block" summary; where it is not, the summary stays.
- `MarkRendezvous` is still accepted by the server on a non-tanker MARSA (harmless); the client just doesn't offer it.

## Tests

- crc-sync `tests/airspace-card-traffic.test.mjs` (9), `efsp-marsa-store.test.mjs` (+tanker voids / local does not),
  `efsp-alerts-compose.test.mjs` updated. crc-desktop `tests/airspace-entry-list.test.mjs` (5),
  `efsp-marsa-client.test.mjs` (+). Module-graph exports re-recorded.
- e2e `crc-desktop/e2e/u-moa.spec.js` (3/3, `E2E_LANE=9`). The rig has no DCS units, so the "inside" amber row is checked
  by injecting an `efsp-alerts` frame; the "filed" row, Approve as OPS on AP's Strip, and the grey approved state run
  against the real crc-sync. "The alert clears on AP's side" is a unit test (monitor), not e2e. Regression run on lane 9:
  airspace-panel, airspace-entry-alert, airspace-server, l1-marsa, marsa-popover — 32/32 (R3-23 flaked once on a
  dynamic-import fetch error, passed on rerun).
- freeze: 13 hub goldens re-recorded in a separate commit (every `efsp-alerts` gains `airspaceTraffic`; random-seed goldens
  send an extra `efsp-alerts` after Approve/ClearAirspaceEntry, since the approved flight joins the list).

## Findings for other lanes

- **U-JURISDICTION**: `ENTRY_TYPES` lists SUA types only; a JURISDICTION airspace kind/type will not get a card list
  unless added (it should not: jurisdiction is not entry-approval airspace). `airspace-card.js` is touched in one place
  (`buildAirspaceEntryList`, before the ROUTE/summary branch).
- R7 gap 2 (name the MOA in the MARSA declaration) and gap 3 (tie MARSA to MOA activation) not built; R7 recommends none.
- No DCS walk of the monitor's "inside" path with live units.
