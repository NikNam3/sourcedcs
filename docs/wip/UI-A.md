# UI-A — the UI follow-up lane (U1-U5, U8, S-L15, S-L16, S-L23 and S-L1b findings)

Branch `lane/UI-A-followup`, cut from `efsp-wp5-correlation` at `d9e9176`. Run on `E2E_LANE=2`. No ADR taken
(0090 stays free): every change below is a field-list, label or gesture choice inside ADR 0056/0058's rules.

## What changed

| Item | Change | Where |
|---|---|---|
| U1 | OPS shows ORDNANCE (3G) on its DEPARTURE face, always; OPS may write 3G on any non-DROPPED departure whoever holds it (the 14E precedent, a second row in `NON_OWNER_BLOCK_WRITES`) | `strip-fields.js`; `permission.js` (append only, one row + comment) |
| U2 | Root cause: `noteEfspArrivals` skipped every new Strip whose `updatedBy` was one of *my* controller ids, and a coordination replica carries the proposer's id, so one controller holding APP and CTR was never told. A minted replica (coordination `mintedForCoordination`, TOFI `mintedForTofi`) is now an arrival whoever made it | `efsp-arrivals.js` |
| U3 | Label `IFR` -> `KEEP IFR` (8-char rule) with a hover on the label saying it is TOFI's `ifrActive`: the flight stays IFR under tactical control and ATC keeps separating it. No colour | `strip-template.js` (labels, `BLOCK_TITLES`) |
| U4 | TYPE (Block 3, a composite) opens an editor on the bare aircraft type and writes Block 3A. The wake category stays in the expanded view (nothing derives it from the type; guessing would put a made-up value on a Strip) | `strip-template.js` `editRedirectFor`, `bay-view.js` `_buildBlockCell`/`_startBlockEdit` |
| U5 | RELEASE (14A, the release state; label was `RLS ST`) on a DEPARTURE's face at APP and CTR, where the release travels (guide 4.6.2) | `strip-fields.js`, `strip-template.js` |
| U8 | When the paired mission Strip (`tofiCoordination.peerStripId`) is OFF_STATION or RTB and the ATC Strip's TOFI is ACTIVE, the NLA slot on CTR's Strip is a filled `TOFI Exit` button (`data-strip-action="tofi-exit-primary"`), replacing the NLA button (which would be Drop/Hand on, both blocked under an active TOFI). Render signature carries the mission line's state (S-L14) | `efsp-nla.js` `tofiExitDueFor`, `strip-view.js`, `bay-view.js` (one signature line) |
| S-L15 | One-input entry points: Alt+click on a Strip toggles OFFSET, Ctrl/Cmd+click steps HIGHLIGHT (yellow, cyan, lime, off). The menu item and the right-click swatches stay (2 inputs). The `bay-view.js` comment that said the swatch met the ceiling is corrected. New `GESTURE_INPUT_COST` rows | `bay-view.js`, `efsp-metrics-client.js`, metrics panel text |
| S-L16 W2 | TAXI (17) on GND's face, TAKEOFF (18) on TWR's | `strip-fields.js` |
| S-L16 W3 | A typed TAXI/TAKEOFF earlier than the (new) proposed departure gets a dotted underline and a hover saying why a typed time does not follow a P-time. No colour | `strip-template.js` `typedTimeBehindPlan`, css |
| S-L16 W5 | Retyping the value an estimate (italic) shows is no longer a no-op: it sends the value, so the estimate becomes the actual. The hover says "Type it again to accept it as the actual" | `bay-view.js`, `strip-template.js` |
| S-L16 vul | `setField` refuses a vul start that is not before the end ("move the end first") and an end not after the start. Clearing is always allowed | `fdr-store.js` `_vulWindowRefusal` |
| S-L23 | A held TAC_C2 gets a client-local tab "with AIC/JTAC" listing the live MISSION lines AIC/JTAC hold (only while there is one), so a TAC_C2-only controller can answer CTR's TOFI exit on an AIC-held line. A controller holding nothing but JTAC at a Facility gets no drop-only tabs there (H59) | `efsp-state.js` `efspLinesWithOthers`, `efsp-panel.js`, `bay-view.js` `_isPseudoBayId` |
| S-L1b | `_renderArrivalsLine` caches its element; `srs-radio.js` caches the two buttons `_renderSlots` read; `openPanel` waits for `dock` | `efsp-panel.js`, `srs-radio.js`, `e2e/helpers/app.js` |

Server edits (minimal, listed): `permission.js` (one `NON_OWNER_BLOCK_WRITES` row + a comment line; no restructuring),
`fdr-store.js` (`_vulWindowRefusal` + one call in `setField`). Nothing in `nla.js`/`block-map.js`.

## Defaults taken (P2)

- **U1**: 3G is on OPS's face always (not "only when set"): OPS is where the load state is recorded. OPS may write it on a
  DEPARTURE only; OPS has no ARRIVAL Bay, so an arrival row would be unreachable.
- **U3**: no desk question; the field stays on CTR/APP faces with the clearer label and hover. The existing 8-character
  label test forced `KEEP IFR`.
- **U4**: only the aircraft type is editable from TYPE (not the wake category, not the formation size).
- **U5**: "DEP/APP and CTR" read as a departure Strip at APP and CTR. The Block is the release state 14A.
- **U8**: replaces the NLA button rather than adding a second one; TOFI Exit stays in the menu as before.
- **S-L15**: modifier clicks (Alt, Ctrl/Cmd), not keyboard shortcuts. Ctrl+click is a context click on macOS; the right-click
  swatches still work there.
- **S-L16 vul**: the refusal is server-side only; the client shows the refusal banner as for any SetBlock.
- **S-L23**: the "with AIC/JTAC" tab is read-only guidance: nothing can be dropped on it, and it lists MISSION lines only.

## Walks not done / left open

- U6 (block altitudes) untouched, as instructed; the ALT field is as it was.
- The U2 fix was verified with one controller holding APP and CTR (the case the code could not handle). A separate CTR
  controller was already covered by `efsp-arrivals.test.js`; if the human still sees no notification with two controllers,
  the next suspect is `heldPositions`/`getActingPositions()` for CENTER at the receiving client.
- GCI-held lines do not appear in the "with AIC/JTAC" tab (GCI is not a TAC_C2 delegate; H2 covers AIC and JTAC).
- The metrics `time-to-find` still counts the "with" tab as a real Bay (harmless).
- Dockview-hidden RADIO: `_renderSlots` is fixed by caching; `srs-radio.js` has no unit test (browser-only).

## For the guide / briefing (supervisor folds)

- Guide 3G/ordnance: OPS records the load state on its own face; any non-owner OPS may write it on a departure.
- Guide gestures: Alt+click = offset, Ctrl+click = highlight step, in addition to the menu/right-click forms.
- Guide 4.6.3: the Strip's `KEEP IFR` is `ifrActive`; hover says what it means.
- Guide 10.5 / ADR 0073 "left open": W2, W3 and W5 are closed as described above.
- Usage guide: TOFI Exit appears as the Strip's main button on CTR once the mission line is OFF_STATION/RTB.

## Report numbers

- crc-sync 1852 -> 1854 pass (0 fail; `efsp-ui-a-hooks.test.mjs` +2, one existing ATO test's vul data adjusted).
- crc-desktop 717 -> 726 pass (`efsp-ui-a.test.js` +7, drop-targets +1, arrivals +1, plus edits to the strip-fields,
  reachability and metrics tests).
- Playwright `E2E_LANE=2`: new `ui-a.spec.js` 7/7. Full suite 124 passed / 2 failed; both reruns green (tactical-positions
  01/02 and 06 pass alone, 06 sits at 19-21 s against a 20 s timeout under load; `ordnance-hung` "pilot walks" failed because
  the spec set ORDNANCE through the expanded view, which no longer lists it on OPS's face: fixed in the spec, and it needs
  `field-state.spec.js` before it, as on the baseline, for the active runway).
- `e2e` regenerates `docs/wip/*.png`; reverted after each run.
