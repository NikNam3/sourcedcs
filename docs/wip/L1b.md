# L1b — Field state, client, and the hook mismatch (guide §9.7 rules 1 and 4, client side)

## Report

| | |
|---|---|
| Branch | `lane/L1b-field-state-client`, from `b964979` |
| Commits | `9f8c6dd` L1 API as found · `c078133` H52 rename + S-L1d broadcaster · `acb1736` client state, wire, rules mirror · `40cfcbf` panel + Strip chips · `b1a443a` wip checkpoint · `2b04996` S-L1b2 signature line · `874ad92` Playwright walk · final: ADR 0068 + this file |
| crc-desktop tests | **517 → 554** (+37, all in the new `tests/efsp-field-state-client.test.js`) |
| crc-sync tests | **1573 → 1577** (1565 → 1569 pass, 8 todo unchanged): +4 in the new `tests/efsp-field-state-l1b.test.mjs`; the H52 rename edits `efsp-field-state`, `efsp-scenario-field-state` and `efsp-permission` tests in place (same counts) |
| Playwright | `E2E_LANE=1 npx playwright test e2e/field-state.spec.js`: **4/4 green** (about 1.5 min) |
| ADR | `docs/adr/0068-field-state-client-panel-strip-chips-and-runway-works.md` (the only ADR touched) |

**What was built:**

- **The panel:** a FIELD STATE dock panel showing runways, status, attribution in Zulu, gear, requests to tower, the runway change with its acknowledgers, the pads, and a count of waiting requests on the tab.
- **Buttons:** from `fieldStateActionsFor`, a proactive mirror of tower's authority. The drift test replays every offered button against a real `FieldStateStore`.
- **Strip chips:**
  - `RWY 05 SUSP/INSP/CLSD` on every Strip that will use a runway that is not open. It has no duplicate reason line when the server's NLA inhibit already says it.
  - `RWY 05 INACT` for a Strip queued for the inactive end (Q30).
  - `HOOK` from `gearMismatchFor`: computed, never stored, and only when gear is configured (H57). It never fires on the shipped `[]` inventory.

**Server-side, per decisions.md:**

- **H52:** the barrier change is renamed to generic runway works (`SUSPENDED_WORKS`, `WORKS`, `BeginRunwayWorks`, `CompleteRunwayWorks`, reason `… suspended — works in progress`).
- **S-L1d:** `WsHub.broadcastEfspFieldStateDelta` is public, and `server.js` uses it.

**Shared-file edits (all additive; nothing reordered):**

- `app.js`: two cases at the end of the `ws.onmessage` switch, and one line after `renderAirspacePanel()` in `efsp-snapshot`.
- `index.html`: the panel div after the airspace panel, a CSS link after `efsp-panel.css`, and two scripts after `airspace-panel.js`.
- `dock.js`: one entry each in `PANEL_TITLES`, `createComponent`, `LEFT_CLUSTER` (the array line itself changes), `PANEL_SIDE` and `DOCKABLE_PANELS`.
- `radar-panel.js`: one row in `panelControlRows()`.
- `efsp-state.js`: the map, the snapshot refill, the delta applier and getters after the MARSA block, the reset, and exports.
- client `efsp-ws.js`: `sendEfspFieldStateMutation` after `sendEfspMarsaMutation`.
- `strip-view.js`: **exactly the three S-W2A hunks**.
- `bay-view.js`: **one guarded line** at the end of `_stripRenderSignature` (**S-L1b2**, approved by the supervisor).
- crc-sync:
  - `ws-hub.js`: one method after `broadcastEfspCorrelationDelta`.
  - `server.js`: the wind hunk's broadcast.
  - The H52 rename in `field-state.js`, `field-state-store.js`, `permission.js`, plus comments in `nla.js`, `index.js` and `facility-config.js`.

**For the integrator (F3 is already merged on `efsp-wp5-correlation`):**

- **`server.js` conflicts:** F3 moved the wind block into `deriveActiveRunwaysFromWind()`. Resolve by taking F3's function and replacing its `wsHub._broadcast({...})` with `wsHub.broadcastEfspFieldStateDelta({ fieldStateSeq: efsp.fieldStateStore.currentSeq, fieldStates: [efsp.fieldStateStore.getFieldState(facilityId)] })`.
- **Rename conflicts:** F3 also edited `field-state-store.js` / `field-state.js` / `efsp-field-state.test.mjs`. The H52 rename is mechanical. After merging, re-run over the crc-sync field-state files:
  `sed -i -E 's/SUSPENDED_BARRIER_CHANGE/SUSPENDED_WORKS/g; s/\bBARRIER_CHANGE\b/WORKS/g; s/_beginBarrierChange/_beginRunwayWorks/g; s/_completeBarrierChange/_completeRunwayWorks/g; s/BeginBarrierChange/BeginRunwayWorks/g; s/CompleteBarrierChange/CompleteRunwayWorks/g; s/suspendForBarrierChange/suspendForRunwayWorks/g; s/suspended — barrier change/suspended — works in progress/g'`
  Then `grep -rni barrier crc-sync/src crc-sync/tests`: only the guide quote "A barrier reconfiguration" should remain.
- **Other lanes:** L12/L13 may reference `SUSPENDED_BARRIER_CHANGE`; the same sed applies.

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

## What the usage guide should say

**The field (FIELD STATE panel).** Open it from PANELS → FIELD STATE. Each airfield with a runway inventory (today Incirlik) shows:

- **The active end:** `▶ 05 ACTIVE`, and how it was set: from the mission wind at load, or by a runway change. `ACTIVE —` means nothing has set it yet.
- **Each runway (e.g. `05/23`)** with a badge: OPEN, CLOSED, WORKS (suspended for runway works) or INSPECT (works done, awaiting OPS's inspection). Below the badge:
  - who suspended or closed it, at which Position, when (Zulu), and who asked;
  - the last inspection;
  - any request waiting on tower;
  - its arresting gear. At Incirlik this reads "No arresting gear configured (SOURCE practice).", because DCS simulates no wires.
- **The runway change:** `05 → 23 · PROPOSED · proposed by TWR (name) 1440Z`, then one chip per acknowledger: `OPS ✓ 1441Z` (`✓ self` when the same person acknowledged it), `APP …` (still waiting), or `APP skipped` (nobody held APP when it was proposed). A rejection or withdrawal says who and why. After completion it reads `PENDING INSPECTION: 05/23`.
- **The pads:** the hot cargo pad and the alert pad, by name.

**Buttons appear only for what your Positions may do:**

- **TWR:** CLOSE (asks for a reason), OPEN, WORKS, ACCEPT/REJECT a request, CHG RWY (pick the end), WITHDRAW, BEGIN and COMPLETE a change.
- **OPS / CD / GND / APP:** REQ CLS, REQ OPEN, REQ WRKS.
- **OPS:** WRK DONE (works complete), INSP OK (the inspection, which is the only way back to OPEN).
- **OPS / APP:** ACK or REJECT a proposed change.
- **Holding TWR, OPS and APP yourself:** SELF CHG changes the runway in one input.

When a request is waiting for you as TWR, the tab reads `FIELD STATE (1)`. A refused action shows in the Strip panel's banner, starting with the runway it was about.

**On the Strip:**

- `RWY 05 SUSP` / `RWY 05 INSP` / `RWY 05 CLSD` means the runway this Strip will use is not open. It shows from CLEARED onward for departures, and from INBOUND to FINAL for arrivals. The reason line says what clears it. When the NLA itself is held, its own reason line says it instead.
- On FINAL the aircraft can still be marked LANDED.
- `RWY 05 INACT` (amber) means the Strip sits in the rack of the runway that is no longer active. Move it to the active end's rack, or leave it if the pilot needs 05.
- `HOOK` means a hook-equipped arrival (3F) is heading for a runway whose configured arresting gear is not rigged. It never shows at Incirlik today, because no gear is configured.

## What the briefing should say

- **Client field state:**
  - `efsp-state.js`'s `getEfspFieldState(facilityId)` and `getAllEfspFieldStates()` return the record exactly as sent.
  - `field-state-rules.js` holds the pure mirror (resolver, reasons, advisory, `gearMismatchFor`, `fieldStateAlertsFor`, `fieldStateActionsFor`, `fieldStateSignatureFor`).
  - `field-state-panel.js` is the dock panel.
- **Chips that depend on anything other than the Strip, its FDR or the stores already in `_stripRenderSignature` must add themselves to that signature.** Otherwise the Strip never rebuilds for them: the NLA board-delta arrives before the field-state delta.
- **Traps:**
  - dockview detaches the inactive tab of a group, and several existing panels break when their DOM is looked up while detached (Findings).
  - The field-state drift test replays every offered button against a real store; keep it when adding an op.

## Walks not done

- **A 3F divert onto DOWN / OUT_OF_SERVICE gear:** not walkable, because Incirlik has no gear and there is no `SetGearState` (S-L1a/H17). The HOOK chip is proved by the client fixtures and a rendered-Strip test instead.
- **A crc-sync restart mid-suspension:** not walkable without restarting the harness's crc-sync. A page reload (fresh snapshot) was walked instead (`11`). The server-side restore is L1's tested path.
- **The wind-derived active end:** the harness has no DCS, so the walk sets the active end through a runway change first.
- **Two physical screens:** the walk used separate browser contexts, one per controller.

## Defaults taken

| Question | Default |
|---|---|
| Q1 | H57 answered: (a), fires only when gear is configured |
| Q2 | S-W2A: (a), identical hook edits |
| Q3 | (b): own sandbox in my own test, reachability harness untouched |
| Q4 | (a): one row in `radar-panel.js` |
| Q5 | (a): the chip on every runway-using state |
| Q6 | (a): every record shown |
| Q7 | (a): `window.prompt` for the Close reason and for rejections; none for optional notes |
| Q8 | (a): closed by default, left cluster |
| Q9 | (a): count in the tab title |
| Q10 | (a): acknowledgers and inspection authority are client-derived from the owners table |
| Q11 | (a): `✓ self` |
| Q12 | (a): `gearMismatchFor` is client-only |

**My own choices:**

- **Labels:** ≤ 8-character button labels: CLOSE, OPEN, WORKS, WRK DONE, INSP OK, REQ CLS, REQ OPEN, REQ WRKS, ACCEPT, REJECT, CHG RWY, SELF CHG, ACK, WITHDRAW, BEGIN, COMPLETE. Badges: OPEN, CLOSED, WORKS, INSPECT.
- **Requests:** a controller who holds TWR is not offered requests.
- **The inactive-end chip** is `RWY 05 INACT`, tone attn.
- **The magnetic stand-in (S-W3c):** the panel calls `toMagneticDisplay` for the wind direction. Until F2 merges, a guarded `globalThis.toMagneticDisplay` stand-in returns null and the direction is omitted. F2's real function replaces it whether it loads before or after.
- **The wording of H52's inhibit reason** is `works in progress`, the label L1 already used as its fallback.

## Findings for other lanes

- **L1 / crc-sync (gap):** the record carries neither `runwayChangeAcknowledgers` (until a change is proposed) nor `inspectionAuthorityPositionId`. Adding both to `getFieldState()` would let the client mirror any config exactly. Today it falls back to the owners table, which matches Incirlik.
- **Pre-existing, `efsp-panel.js` `_renderArrivalsLine`:** it finds its line with `document.getElementById`. While dockview has the Strip panel detached (another tab of its group in front), the lookup fails and a **new line is inserted on every render**, so the arrivals list stacks up. Any panel in the left group triggers it, AIRSPACE included. It should cache the element (the airspace-panel rule). Seen in the walk before FIELD STATE was put in its own column.
- **Pre-existing, `srs-radio.js` `_renderSlots`:** it throws `Cannot read properties of null (reading 'style')` on every poll once the RADIO panel is closed. Same cause.
- **Pre-existing, `e2e/helpers/app.js` `openPanel`:** on the very first test after the harness starts it can race `initDock` (`dock` is null). Seen once.
- **L12 / L13:**
  - The three hook lines are in.
  - `getEfspFieldState` / `getAllEfspFieldStates` are the contract.
  - The panel calls `alertPadConstraintFor(facilityId)` when it exists.
  - If your chip reads the field record, it is already in the render signature through `fieldStateSignatureFor`, which covers status, suspension kind, active end and gear.
  - Rename any `SUSPENDED_BARRIER_CHANGE` / `BARRIER_CHANGE` you wrote (H52).
- **L19:** the empty reason line for a suppressed duplicate is hidden by CSS (`.efsp-alert-reason:empty`). A one-line `if (!a.reason) continue;` in `_buildReasonLines` would be cleaner when you hold `strip-view.js`.
- **L22:** read the same getters; `fieldStateViewOf(record)` builds the rack-to-end view.
- **L20:** the `[SOURCE-DEFINED]` choices here:
  - pavement-wide gear counting;
  - the Q5 state set;
  - "works in progress";
  - the label set.
- **`grep gearMismatch crc-sync/`** matches only L1's pre-existing comment in `field-state.js`; there is no code.

## Screenshots (`docs/wip/L1b/`)

| File | What it proves |
|---|---|
| `01-panel-open.png` | FIELD STATE opened from the PANELS list: 05/23 OPEN, `ACTIVE —` with no mission wind |
| `02-suspended-panel.png` | After OPS's request and TWR's accept: `SUSPENDED WORKS by TWR (maverick) … · requested by OPS (goose)`, badge WORKS |
| `03-strips-inhibited.png` | The queued departure: `RWY 05 SUSP` chip, NLA disabled, exactly one reason line (the server's) |
| `03b-arrival-inhibited.png` | The arrival handed to tower: chip, held NLA, reason |
| `04-final-still-lands.png` | The FINAL arrival showed the chip and still went to LANDED |
| `05-inspection-refused-to-twr.png` | TWR's hand-sent CompleteInspection refused, with the banner naming `runway 05/23` |
| `06-reopened.png` | After OPS's inspection: OPEN, `INSPECTED by OPS (goose)`, the Strips released |
| `07-runway-change-done.png` | After propose → APP ack → OPS ack → begin → complete → inspection: `▶ 23 ACTIVE`, active end "by runway change" |
| `08-inactive-runway-advisory.png` | The Strip left in `rwy-05`: `RWY 05 INACT` and the advisory line |
| `09-rejected.png` | A change APP rejected: `REJECTED by APP (iceman) … — wind is 240 at 15`, as TWR sees it |
| `11-reload-still-suspended.png` | After a page reload mid-suspension, the fresh snapshot still shows WORKS and who suspended it |
| `12-self-coordinated.png` | One controller holding TWR+OPS+APP: SELF CHG gives `ACKNOWLEDGED` with `OPS ✓ self` / `APP ✓ self` |

## Open issues

- F3 merge conflicts in `server.js` and the rename files (see "For the integrator").
- H17 still stands: HOOK is inert until gear data exists.
