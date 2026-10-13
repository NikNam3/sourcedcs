# U-STRIP: the Strip face, round 2 (U1–U4)

Lane note for `lane/U-STRIP` (briefing `docs/parallel/next/U-STRIP.md`; rulings `decisions.md` H138, H139, dark cockpit
H115–H119). Client plus one crc-sync config file, the stereo-route validator and the carrier Block Maps.

## What was built

| Id | What changed | Where |
|---|---|---|
| U1 | A long value never runs under the next field. An editable cell was `display: flex` (for its 44px target) and `text-overflow` does not apply to a flex container's text, and the chip let it take its full text width: it overran the cell (a 627 px route in a 255 px cell). It is now a block with a 44px line, capped to its cell, cut with an ellipsis; same for read-only cells and the expanded view's rows. The whole value is the cell's hover title when it was cut (measured on `pointerenter`; a title the cell already has, a refusal or a time's source, is kept). Same CSS on every strip type. | `efsp-panel.css` (U-STRIP block at the end), `bay/block-edit.js` |
| U2 | **RMKS on every strip type when present**: one bottom row (the last row of the Strip's main column), absent when the flight has no remarks (blank counts as none). One line, never growing the Strip: cut at a word boundary with an ellipsis (`cutRemarksToFit`, refit by one shared `ResizeObserver` when the Strip's width changes; CSS's own ellipsis covers a first word longer than the row), the whole text on hover. Clicking it (or Enter/Space on it) opens the **text-box window**: a popover anchored to the Strip with a multi-line, scrollable `textarea` holding the whole remark. Save / Cancel; **Esc cancels** (the popover portal's own handler), **Ctrl+Enter saves**. Save is the ordinary `SetBlock` on the strip type's remarks Block (`9E`, `M8` on MISSION): same rights and refusals as any Block edit; the window stays open on a refusal (DESK-ACKS) and closes on the ack. **Read-only** (no Save, "read only: OPS holds this Strip") for a controller who does not hold the Strip's Position, e.g. a Strip found with `.find`. The ⋯ menu has **"Edit remarks…"** for the holder, which is how a first remark is written (an empty RMKS has no row to click). When the face shows the row, the expanded view no longer lists the remarks Block a second time. | `strip-remarks.js` (new), `bay/popovers/remarks.js` (new), `strip-template.js` (`remarksBlockFor`, `remarksOf`, `cutRemarksToFit`), `strip-view.js`, `strip-menu.js`, `bay/strip-expanded.js` |
| U2 (server) | MARSHAL, FINAL and PATTERN had **no remarks Block**, though their flight data always carries `filed.remarks`. Each gains `9E` (`flightData filed.remarks`, not required) on **both** sides (`crc-sync/src/efsp/block-map.js`, client `strip-template.js`), so the carrier's Strips (Marshal, PriFly, the lanes) show and edit remarks like every other. FINAL's "nothing to type but HDG/ALT" rule now has this one exception, on the carrier's final too. `npm run wire:record`: surface unchanged, protocol stays 2. | `block-map.js`, parity tests |
| U3 | `COMMS:` and `CTRL:` chips are tone `quiet`: grey text (`--efsp-muted`), no background, no frame, whoever holds them (the blue "mine" frame is gone for these two). The problem tones (`attn`, `bad`) and the release chips are unchanged; which states are a problem is U-RELEASE's. | `control-release-rules.js`, `efsp-panel.css` |
| U4 | **Stereo routes set no remarks.** `remarks` removed from the shipped `crc-sync/config/efsp-stereo-routes.json` (texts quoted below), from the seed (`toFlightDataFiledSeed`) and from the validator's fields; the picker shows **only the name** (`description` stays in the file and in the API answer, never shown or filed). | `stereo-routes.js`, `flight-data-store.js`, `create-strip.js` |

### For the human: `state/efsp-stereo-routes.json`

The stereo-route loader now **rejects unknown keys** (it tolerated them before), so a `state/efsp-stereo-routes.json`
that still carries `remarks` **stops crc-sync's start-up** with the file and the key named:
`[efsp-stereo-routes] …/efsp-stereo-routes.json failed validation: KEMER1 has an unknown key "remarks" (a stereo route sets no remarks: delete the key)`.
Fix: delete the `remarks` keys (or the file, to use the shipped table). The main checkout has no `state/` copy of this
file today, so nothing to do there; a server that had one written by an edit would need it.

## The removed remarks text, verbatim (H138 U4: nothing lost)

From `crc-sync/config/efsp-stereo-routes.json` as it was before this lane:

- **KEMER1**: "Formations expect block FL210-FL230. RECOVERY: contact Ankara Center (CH7). When cleared on the recovery, depart the MOA and descend to cross ERGEP at FL180 or as assigned. After ERGEP proceed direct KEMER, after KEMER proceed direct Incirlik TACAN. Expect further clearance from Incirlik Radar. Nonstandard formation is automatically authorized in the block FL160 to FL180 within 3nm of lead aircraft."
- **MANAZ2**: "Formations expect block FL210-FL230. RECOVERY: contact Ankara Center (CH7). When cleared on the recovery, depart the MOA and descend to cross ERGEP at FL160 or as assigned. After ERGEP proceed direct MANAZ, after MANAZ proceed direct Incirlik TACAN. Expect further clearance from Incirlik Radar. Nonstandard formation is automatically authorized in the block FL140 to FL160 within 3nm of lead aircraft."
- **MANAZ3**: "Formations expect block FL210-FL230. RECOVERY: contact Ankara Center (CH7). When cleared on the recovery, depart the MOA and descend to cross MANAZ at FL160 or as assigned. After MANAZ proceed direct Incirlik TACAN. Expect further clearance from Incirlik Radar. Nonstandard formation is automatically authorized in the block FL140 to FL160 within 3nm of lead aircraft."
- **TARSU4**: "Formations expect block FL210-FL230. RECOVERY: contact Ankara Center (CH7). When cleared on the recovery, depart the MOA and descend to cross TARSU at FL180 or as assigned. After TARSU proceed direct Incirlik TACAN. Expect further clearance from Incirlik Radar. Nonstandard formation is automatically authorized in the block FL160 to FL180 within 3nm of lead aircraft."

## What the usage guide should say (docs pass)

- **Strip face, long values** (§ on the Strip face): a value longer than its cell is cut with "…" inside the cell; hover
  shows all of it; click to edit as before.
- **Remarks** (new short section): "When a flight has remarks, the Strip's last row shows them (RMKS), on every strip
  type. A long remark is cut at a word: click it to read the whole remark in a small window, edit it there and press
  Save or Ctrl+Enter (Esc or Cancel leaves it unchanged). Only the controller holding the Strip can edit; anyone else
  sees it read-only. To add remarks to a Strip that has none, use ⋯ → Edit remarks…". Carrier Strips (MARSHAL, FINAL,
  PATTERN) have remarks too (Block 9E).
- **Handoff chips**: "COMMS: X" and "CTRL: X" are plain grey; colour on a handoff row means something needs you.
- **Stereo routes (§4A)**: lines 186–206 need changing: the picker lists names only; a stereo route fills route,
  requested altitude, departure and destination, **not remarks**; the table's keys are `name`, `route`, `description`,
  `departureAirport`, `destinationAirport`, `requestedAltitude`, `active`, and any other key (including `remarks`)
  refuses the table at start-up; line 190's "recovery and formation-block text as remarks" is no longer true (the text
  is quoted above). The example at l.206 (`"remarks": "squadron standard"`) must go.
- `CLAUDE.md` needs nothing.

## Defaults taken

1. **Unknown stereo-route keys are refused** (not only `remarks`): the briefing made the start-up refusal conditional on
   the loader rejecting unknown keys, which it did not; it tolerated them on purpose ("same latitude airspace-config
   gives"). Taken: strict, as `state/` is everywhere else (H127, CLAUDE.md), so an old table with `remarks` cannot
   silently lose its text. The old tolerance test is replaced.
2. **Route (and every long value): cut with an ellipsis, not wrapped.** Wrapping would grow the Strip; the brief left it
   to me. Same on every type and in the expanded view.
3. **Remarks carrier Block id `9E`** on MARSHAL/FINAL/PATTERN (the ATC maps' id for the same field, not a new `C`-id): one
   id per meaning, so `remarksBlockFor` and the refusal marking need no per-type table.
4. **Read-only rule** = the controller does not hold the Strip's owner Position (`getActingPositions()` lacks
   `ownerPositionId`). This is StripOps's NOT_OWNER gate; `mayActBesideOwner`'s two exceptions do not cover remarks.
5. **The face row sits below the reason lines**, the last row of the main column (before the expanded view), in normal
   text colour at 11px (it is content, not a warning).
6. **Whitespace**: the window keeps newlines; the face shows one line with whitespace folded. Save trims the ends;
   saving an unchanged remark sends nothing; saving an empty box clears the remark and the row goes.
7. **U3 "no background"** also drops the chip's frame (a framed chip still reads as a lit indicator).
8. **"Edit remarks…"** is offered only to the holder (an item a Position can never use is left out, strip-menu rule).

## Tests

- crc-sync `npm test`: 2738 → 2742 (stereo-route strictness ×3; carrier map assertion extended). Wire: `wire:record`,
  surface unchanged, protocol 2.
- crc-desktop `npm test`: 1289 → see the final report (new `efsp-strip-remarks.test.mjs` ×5, parity test +1, the
  stereo picker and control-release tests updated); module-graph exports re-recorded (new modules `strip-remarks.js`,
  `bay/popovers/remarks.js`, new `strip-template.js` exports).
- e2e (E2E_LANE=7): new `e2e/u-strip.spec.js` 9/9 (U1/U2 on DEPARTURE, ARRIVAL incl. the expanded view, OVERFLIGHT,
  MISSION, MARSHAL and carrier PATTERN; the window: shows all 300 characters, Esc/Cancel/Ctrl+Enter/Save, emptied
  remark removes the row, ⋯ Edit remarks…; read-only for CD on OPS's Strip found with `.find` and the server's
  NOT_OWNER refusal; U3 computed colour/background/border on both sides of a CTR→AP handoff; U4 picker names, no
  remarks filed). Regression: l17-carrier, l2-block-editing, l1-touch-targets, l4-density, l16-picker-and-times,
  control-release, side-swap, l4-badges (37/37); lt-ui, ui-a, l1-popovers, mtr-fields, l18-incirlik, par-panel, smoke,
  divert, l3-coordination (75/75).

## Walks not done / findings for other lanes

- **FINAL Bays draw a one-line list, not Strip faces** (`bay-views.js` `efsp-final-row`, airfield PAR and carrier
  lanes), so a FINAL Strip's remarks are not on screen there. The Block is there (`9E`) and editable. U-PANELS U10
  turns the airfield PAR Bay into ordinary Strips, which brings the RMKS row with it; the **carrier FINAL line stays a
  line (H125/H126)** and has no RMKS: adding it is a `bay-views.js` change (U-PANELS's file), for the supervisor.
- **RSU's pattern board** (`pattern-board.js`) draws a card per aircraft, not a Strip face, so RSU PATTERN Strips show no
  RMKS row. The RSU is being redesigned (U14/U-RSU, "a list of the aircraft"); its list should show remarks when present.
- **U-PANELS also edits `strip-menu.js`** (U10, PAR ops) and `efsp-panel.css` (U13, l.1688). This lane's changes there are
  one menu item (`remarks`, group Strip, before Offset) and a block appended at the end of the CSS: small, separate hunks.
- **Both briefings name `E2E_LANE=7`** (U-STRIP and U-PANELS). Run one at a time or give one another lane.
- The usage guide's stereo section (§4A, l.186–206) is now wrong about remarks (see above).
