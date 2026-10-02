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
