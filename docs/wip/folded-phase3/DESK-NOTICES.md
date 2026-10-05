# DESK-NOTICES (lane notes)

Branch `lane/DESK-NOTICES-desk-notices`. Usage guide edited (§8J reset, §8I carrier tag, Undo bullet).

## Wire change
`efsp-board-delta` gains optional `missionReset: {at, strips}` on the deltas `resetForMission` builds (one per Board that
dropped Strips; `strips` = that Board's count, `at` = mission clock). The archiver's later deltas do not carry it. `wire:record`
says the recorded surface is unchanged (it records frame types, not optional fields), so WIRE_PROTOCOL stays 2.
A client that ignores the field still converges (an old client just shows no notice).

## What was done
1. Notice: `noteMissionReset` (panel/undo-slot.js) reuses the dismissible `#efsp-undo-voided` message slot; same `at` from a second
   Facility adds to the count. `efsp-messages.js` closes popovers on every `strips.gone` Strip (`closePopoversForStrips`) and, for
   a reset, sends pending Mutations on removed Strips down `settleEfspAck`+`notifyEfspOrphanedMutation`.
2. ATO preview: `efsp-ato-carrier` tag from `line.carrier.hullCode`. No MISSION Strip chip: no existing slot fits.
3. Undo of a Split: `undo.js` returns `flightDataGone`; the primary delta carries it as `flightDataList.gone`. The client
   already deleted `gone` flight data (efsp-state.js `applyEfspDelta`); a unit test pins it.

## Defaults taken
- Notice sits in the Undo-message list (cap 5) rather than a new banner element; no Playwright spec (unit-tested through the registry).
- The pending-Mutation orphan notice and the server's later NOT_FOUND ack may both show a refusal (not deduplicated).
- Popovers close on any gone Strip, not only on a reset.
- A reset where no Board had Strips sends no delta, so no notice.

## Not done
- Playwright specs for the notice (cannot drive a mission reset from the e2e host without a test hook).
