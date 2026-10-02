# CR-C working file

Lane CR-C, branch `lane/CR-C-control-release-ui`, base `5efc7656`. ADR 0101 is the spec; `docs/wip/CR-S.md` the wire.

## Code as found (`5efc7656`)

| Briefing symbol | On this base |
|---|---|
| `_coordinationExchange` | `panels/efsp/strip-view.js` (the exchange row, both sides); helpers/dispatch in `bay/popovers/coordination.js` |
| the ⋯ menu | `strip-view.js#_stripMenuItems` (group "Start"; Coordinate…, Cancel proposal / End coordination) |
| coordination targets | `bay/authority-mirror.js` `COORDINATION_TARGETS` (AP→CTR, CTR→AP only); no carrier target |
| Position ids | still `AP`, `CTR`, `CV_MARSHAL`; Facilities `INCIRLIK`, `CENTER`, `CARRIER` (the RENAME to APP is not on this base) |
| refusal banner | `panel/refusal.js` (`MUTATION_ERROR_MESSAGES`, `notifyEfspMutationAck`); `NOT_STAFFED` already has a sentence |
| Block editor | `bay/block-edit.js` sends `SetBlock` (`value`, `confirmVacated`); no `coordinatedWith` anywhere |
| obligations | `strip-view.js#_litIndicator` shows any `obligationType` with `_`→space; no labels table |
| undo slot | `panel/undo-slot.js` shows the server's `undoable.label` verbatim |
| `controlAxisFor` parity copy | none exists on the client; the prompt is driven by the server's refusal (no client copy needed) |
| `commsTransferred` readers on the client | TOFI's own only |
| render signature | `bay-view.js#_stripRenderSignature` (rev-based; the marks bump rev on both Strips) |

## Defaults taken
- P2: the attestation is a line above the Strips (`#efsp-control-attest`) driven by the server's VALIDATION_ERROR, not a client copy of `controlAxisFor`: no parity table to drift; the cost is that the prompt appears after the refused send, and the write is re-sent only on the click.
- P2: the steps sit on the HANDOFF row (Comms to X, Control to X, Release… / Request release…, Unable) and are repeated in the ⋯ menu (plus Withdraw release); Comms and Control are one click (Undo covers them), the three ControlRelease forms open a popover.
- P2: the Release form offers an effective time as HHMM Zulu on the mission day (a time over 12 h in the past means tomorrow); a past time is simply already effective.
- P2: the obligation labels are `NO CONTROL HOLDER` (CONTROL_UNCOVERED, OVERDUE) and `CONTROL MOVED` (CONTROL_REPAIRED); the repair also stays as a `… MOVED BY THE SYSTEM` chip until the holders next move (the server's `coordination.repair`).
- Carrier: a "to CV_MARSHAL" select in the Coordinate popover for an ARRIVAL at INBOUND (shown with HANDOFF only); no other change on the Marshal side, the receiver steps come from the same row.
- Lane-allowed server edit (told by main): the HANDOFF mark's undo label named `peerPositionId`, wrong when the receiver records the mark; it now always names the receiving Position (`Communications to AP`, `Control to AP`), tested from both sides.

## What a controller sees
After Accept both Strips' HANDOFF row shows `COMMS: CTR` `CTRL: CTR` (outlined when it is your Position) and the steps below. `RELEASE: Turns · after the DME`, `RELEASE REQUESTED: Climb`, `RELEASE REFUSED: reason`, `RELEASE WITHDRAWN` and the repair chip come and go on both sides. A refused control instruction asks "Coordinated with X?" above the Strips. The undo slot reads "Communications to AP" / "Control to AP".

## Manual two-Facility walk (E2E_LANE=5, `e2e/control-release.spec.js`, screenshots in `docs/wip/CR-C/`)
CTR -> AP: 01 after Accept comms and control stay with CTR on both Strips; AP asks for a Turns release, 02 CTR sees the request; 03 CTR grants "after the DME", both sides show it; a heading inside the release sends without a prompt, an altitude outside it raises 04 the prompt, "Coordinated with CTR" re-sends it; Comms to AP then Control to AP (Undo slot labels read right), 05 both Strips show AP holding both and the release gone. Second spec: Unable with a reason reads on AP's Strip; a Full release, then Withdraw, reads `RELEASE WITHDRAWN`. CTR -> CV_MARSHAL: 06 the Marshal's inbox with Accept Hand Off; Accept puts the Marshal Strip in the stack (07); Marshal records comms and control, 08 CTR shows `CTRL: CV_MARSHAL`.
Walked in the browser through the real UI except the two SetBlock writes (sent through the page's own `sendEfspMutation`, so the prompt path is the real one).

## Not done / findings
- Strips in a 186 px Bay: four stacked step buttons overflow a short Bay (scroll). The tab column is 176 px; a denser step row would be a layout lane.
- The transferring Strip still shows the NLA reason "cross-Facility HANDOFF required — use Coordinate" after Accept (pre-existing; not touched).
- The usage guide's step 4 and cheat-sheet row for HANDOFF still describe the all-at-Accept effect; my subsection says it supersedes them (the brief allowed a new subsection only). The next guide pass should fix those two lines.
- The carrier panel's own Marshal board does not show the chips; they are on the Strip in the `main` Rack under the stack (07). A slot-board marker is a candidate.
- Undo of marks: only the label was checked on the client; the undo slot handles any `undoable`.

## Release note
Handoff to another Facility now moves radar contact only: record comms, ask for or grant a ControlRelease, and mark control as separate steps (undoable inside 10 s); a control instruction before control transfers asks "Coordinated with X?"; APP/CTR can hand an inbound arrival to the carrier Marshal.
