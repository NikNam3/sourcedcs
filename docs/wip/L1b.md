# L1b — Field state, client, and the hook mismatch (guide §9.7 rules 1 and 4, client side)

_Work in progress. The report summary goes at the top when the lane finishes._

## L1 API as found

Checked against the merged code at `b964979` (L1 merged as `9db3fc3`). Where it differs from the
briefing, the client follows the code.

| # | Briefing assumed | Merged L1 has |
|---|---|---|
| V1 | One record per Facility, `rev` on the record; runway rows per pavement | **Yes.** `getFieldState(facilityId)` merges the inventory into each row: `{ runwayId: '05/23', ends, endHeadingsTrue, rackIds: {'05':'rwy-05','23':'rwy-23'}, status, arrestingGear, suspension, closure, lastInspection, pendingRequest }`. The id key is **`runwayId`**, not `id` |
| V2 | Facility-level active end | **`activeRunway`** (an end, or `null`) plus **`activeRunwaySource`**: `null`, `{kind:'WIND', windFromTrue, windKt, missionKey, at}` or `{kind:'RUNWAY_CHANGE', changeId, at}` |
| V3 | Rack → end mapping | **On the record**, per runway row: `rackIds` (end → rackId). The client builds `rackEnds` from it, exactly as `buildStatusView` does from the inventory |
| V4 | Status and gear enums | Statuses `OPEN`, `CLOSED`, `SUSPENDED_BARRIER_CHANGE`, `SUSPENDED_INSPECTION`; gear enums as assumed; the suspension carries `kind` (`BARRIER_CHANGE`, `RUNWAY_CHANGE`); Incirlik ships `arrestingGear: []`; no `SetGearState`. **H52 renames the barrier family in this lane** (see ADR 0068) |
| V5 | Op kinds and owners | `FIELD_STATE_OP_OWNERS` in `permission.js`: TWR `CloseRunway`, `OpenRunway`, `BeginBarrierChange`, `AcceptRunwayRequest`, `RejectRunwayRequest`, `ProposeRunwayChange`, `SelfCoordinateRunwayChange`, `WithdrawRunwayChange`, `BeginRunwayChange`, `CompleteRunwayChange`; OPS `CompleteBarrierChange`, `CompleteInspection`; OPS/CD/GND/APP `RequestRunwayStatus{action: CLOSE\|OPEN\|BARRIER_CHANGE}`; OPS/APP `AckRunwayChange`, `RejectRunwayChange`. One pending request per runway, on the runway row (`pendingRequest`). An unmanned acknowledger shows as `acks[pos] = {skipped:true, reason:'UNMANNED', at}` |
| V6 | Wire | As assumed. Ops name the pavement as **`runwayId: '05/23'`**; a runway change names an **end** as `toRunwayId: '23'`; a request carries `action`. Ack `efsp-field-state-ack` `{clientMutationId, facilityId, runwayId, ok, fieldState, reason, detail, fieldStateSeq}` (sender only); delta `efsp-field-state-delta` `{fieldStateSeq, fieldStates:{updated:[record]}}`; snapshot `fieldStates: [record]`, no resync branch |
| V7 | `runwayChange` shape | `{changeId, state, fromRunwayId, toRunwayId, proposedBy, proposedPositionId, proposedAt, note, acknowledgers, acks, selfCoordinated, rejected:{by,positionId,at,cause:'REJECTED'\|'WITHDRAWN',note}, beganAt, beganBy, completedAt, completedBy, pendingInspection}` and derived `runwayChangeInProgress`. A REJECTED change stays on the record until the next proposal replaces it |
| V8 | Pads | `hotCargoPad` / `alertPad` = `{ name, occupied, occupantFdrId }` — **the name reaches the client** |
| V9 | Pure exports | `normalizeRunwayEnd` (not `normalizeRunwayId`), `buildStatusView`, **`resolveRunwayForStrip(strip, fdr, view, {targetRackId})`** → `{runwayId, end, source: 'TARGET_RACK'\|'RACK'\|'FDR'\|'ACTIVE_RUNWAY'}`, `runwayStatusReason`, `runwayInhibitFor`, **`runwayAdvisoryFor(strip, view)`** (no FDR argument). The module requires nothing, so crc-desktop tests can require it |
| V10 | Inhibit strings | `runway 05/23 suspended — barrier change`, `… suspended — awaiting inspection`, `… closed` (renamed by H52 to `… suspended — works in progress`) |
| V11 | `nlaStatusMonitor.tick()` after a successful op | **Yes**, in `_handleFieldStateMutation` |
| V12 | Mission-clock timestamps | **Yes**: every stamp is `this._clock.now()`, the injected MissionClock (`index.js` passes `clock`) |
| V13 | Persisted in the Board snapshot | **Yes**: `fieldStates` in `efsp-board.json`; the e2e harness needs no new env var |
| V14 | Active end with no DCS | Stays **`null`** (no wind, no `mission-load`); `activeRunwaySource` is `null`. The panel shows `ACTIVE —` |
| V15 | Placement by runway, drag target in ctx | **Yes**: `_placementRack` → `runwayRackFor` at the placement sites; `_nlaCtx({bayId, rackId})` carries the drag target |

Not on the record, and so not known to the client (**gap**, see Findings): the Facility's
`runwayChangeAcknowledgers` (until a change is proposed) and `inspectionAuthorityPositionId`. The
client falls back to the permission table's owners (`AckRunwayChange` → OPS, APP;
`CompleteInspection` → OPS), which equal Incirlik's config today.
