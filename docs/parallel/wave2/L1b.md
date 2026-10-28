# L1b — Field state, client, and the hook mismatch (guide §9.7, WP6 Phase 3 steps 6–7) — implementation briefing

> Self-contained. You have no memory of the conversation that produced this. Everything you need is
> here or in a file this names by path. Where this briefing and
> `/home/nklx/dev/personal/sourcedcs/docs/parallel/decisions.md` disagree, **decisions.md wins**.
> Where this briefing and **merged L1 code** disagree about L1's API, **the code wins** (see §4, the
> "Verify against merged L1" list — do that first).

---

## 1. Header

| | |
|---|---|
| Lane | **L1b — Field state, client + hook mismatch** (guide §9.7 rules 1 and 4, client side) |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-L1b` on `lane/L1b-field-state-client` (S-W1 pattern), cut from `efsp-wp5-correlation` |
| Base commit | the integration-branch commit **after L1, L2, L3 and L5 have merged** — the supervisor fills it in when cutting the worktree. File:line references below were taken at `cfcf344` (pre-wave-1) and **will have shifted**; find things by symbol, not by line |
| ADR | **`docs/adr/0068-…md`** — yours alone. Never edit `0061` (L1's) or any other committed ADR (P4); what you change or add about them goes in 0068 |
| E2E lane | **`E2E_LANE=1`** (ports 3011 / 3111). Yours for wave 2; L19 inherits it in wave 3 |
| Baseline tests | record crc-sync and crc-desktop pass counts at your base commit before any edit; report before → after |
| Depends on | **L1** (server field state, ADR 0061) merged |
| Runs beside | **L12** (ordnance `HUNG`) and **L13** (alert/scramble) — same wave, and both read client state you create (§7.3). L14/L15/L16 also run; L15 adds a dock panel too |
| Blocks | **L19** (wave 3, `strip-view.js`), **L22** (ATC scope, waits for you) |

---

## 2. Mission

**Done means:**

1. A controller can open a **FIELD STATE dock panel** (its own panel, like AIRSPACE; **not** the
   `ops-field-state` Bay) that shows, per Facility with a field-state record: every runway (physical
   pavement and its ends), its status, the active runway end, who suspended/closed/inspected it and
   when (in-game Zulu), its arresting gear, the runway-change workflow with each acknowledger's
   state, the pads, and pending runway requests. It offers **only** the actions the controller's
   held Positions may take (a proactive mirror; the server decides), and dispatches them as
   `efsp-field-state-mutation`.
2. Refusals show in the existing refusal banner, named by the runway they were about.
3. On the **Strip**: the NLA inhibit reason the server already stamps (`strip.nla.inhibited`) renders
   under the NLA (it does today — prove it with field-state reasons); **proactively**, every live
   Strip whose resolved runway is not `OPEN` shows a `RWY` indicator with a reason line even when
   its NLA is not the gated transition; a Strip queued for an inactive runway end shows the L1
   `runwayAdvisoryFor` advisory (Q30(b), S-ALL).
4. **Rule 4:** `gearMismatchFor(fdr, runway)` — pure, **computed, never stored** — alerts on an
   ARRIVAL Strip whose FDR has `3F` (`military.hookRequired`) set when its resolved runway has no
   usable arresting gear (the exact rule is Q1 below, a HUMAN question because of H17).
5. The WP6 plan's **Phase 3 manual walk, done in Playwright** (`docs/efsp-wp6-plan.md`
   "Verification" item 4, plus the item-5 pilot requests that the client can show), with
   screenshots in `docs/wip/L1b/`.
6. ADR `0068`, `docs/wip/L1b.md`, both suites green and grown.

**Out of scope — do not build:**

- Any **crc-sync** change. L1 owns the server; you only read it. If merged L1 is missing something
  you need, render what exists, write the gap in `docs/wip/L1b.md` → "Findings for other lanes",
  and carry on (Q10).
- Wiring anything into the `ops-field-state` **Bay** (`facility-config.js` INCIRLIK, "WP6 hook,
  inert"; ADR 0061 / WP6 plan: the board is not Strips).
- Ordnance `HUNG` (L12), alert/scramble (L13). You provide the client state and two hooks they call
  (§7.3); you do not render their content.
- An emergency override onto a suspended runway (H19: none).
- Declutter of any kind (H6).
- The §10.3 suggestion chip / §10.4 staleness (L19).

---

## 3. Setup and working rules

1. **Read first, in order:** `decisions.md` (whole; esp. P2–P5, H6, H11, H15, H17–H22, S-Q23–S-Q25,
   S-ALL, H42); `docs/efsp-parallel-plan.md` §1–§2 and your lane in §4; `docs/efsp-wp6-plan.md`
   Phase 3 (the rule-4 and rule-5 paragraphs and the last paragraph about the Bay) and
   "Verification"; `docs/parallel/wave1/L1.md` §5 (the design L1 was briefed with);
   **`docs/adr/0061-*.md` and `docs/wip/L1.md` as merged** (its "Wire contract for L1b" section is
   written for you and wins over §4 of this briefing); `docs/efsp-briefing.md` §3F–§3G and §6;
   `docs/parallel/questions-round1.md` Q23–Q40 (the context of every S-ALL ruling that touches you).
2. Install: `(cd crc-sync && npm ci) && (cd crc-desktop && npm ci) && (cd crc-desktop/app && npm ci)`,
   then `npx playwright install chromium` in `crc-desktop` if the browser is missing.
3. Tests: `cd crc-desktop && npm test` (node --test, DOM stub); `cd crc-sync && npm test` once at the
   start and end (you change nothing there, but your drift test requires crc-sync modules).
   Playwright: `cd crc-desktop && E2E_LANE=1 npx playwright test e2e/field-state.spec.js`.
4. **Never touch the running crc-sync on :3000** (P3). The e2e harness starts its own on 3011.
5. **Never edit shared docs** (briefing, usage guide, CLAUDE.md, READMEs, the plans). Write
   `docs/wip/L1b.md` (§10).
6. Commit on your branch only, one green commit per step of §6, message `EFSP L1b: …` with the
   harness's attribution trailer. No merge, rebase of other branches, or push.
7. Unanswered question → take this briefing's default (§11), log it under **"Defaults taken"** in
   `docs/wip/L1b.md`, carry on (P2).
8. Every time a controller reads is **in-game Zulu** (H11): format server timestamps as `HHMMZ`
   (`new Date(ms).toISOString().slice(11,16)` → `HH:MMZ`, the airspace panel's `_formatWindow`
   precedent); any "now" you compute uses `missionNow()` when defined, never `Date.now()`.
   Headings/bearings you display are magnetic (H15) — you display none; do not introduce any.
9. UI wording (Q12, S-ALL): labels capitals ≤ 8 chars; reason lines are sentences naming what clears
   them; anything `[SOURCE-DEFINED]` shown to a controller says "SOURCE practice", never cites FAA
   or USAF.
10. Be suspicious of a scripted edit that reports success: grep for what you wrote.

---

## 4. Verify against merged L1 — do this before writing any code

L1 had not committed anything when this briefing was written (its worktree sat at `cfcf344`), so
every L1 interface below is **assumed** from `docs/parallel/wave1/L1.md` as amended by
`decisions.md`. The decisions changed L1's briefed design in several places (S-Q23's per-pavement
record, H18's tower-only close/open, H22's wind-derived active runway, S-Q24's one-input
self-coordination, S-ALL's Q26/Q27/Q30/Q35/Q36/Q39/Q40), so **L1's code is likely to differ from its
own briefing's §5**. Open `crc-sync/src/efsp/field-state.js`, `field-state-store.js`, `efsp-ws.js`'s
`_handleFieldStateMutation`, `permission.js`'s field-state table, `facility-config.js`'s INCIRLIK
`fieldState`, and `docs/wip/L1.md`, and tick each item. Record the answer to each in
`docs/wip/L1b.md` → "L1 API as found". Where it differs, **adapt your code to L1**, not the reverse.

| # | Assumption | Where to check |
|---|---|---|
| V1 | The record is **one per Facility**, `rev` at record level (the `baseRev` you send). Runway rows are **per physical runway** (S-Q23): `{ id: '05/23', ends: ['05','23'], status, arrestingGear: [{ end, position, distanceFt, type, state, gearId? }], suspension, closure, lastInspection }` — not L1 briefing §5.3's per-direction `runwayId`/`reciprocalRunwayId` | `getFieldState()`; the snapshot `fieldStates` |
| V2 | Active runway is a Facility-level **end** (`activeRunway: '05'` per S-Q23; may be spelled `activeRunwayId`), and there may be a source marker for H22's wind derivation | record top level |
| V3 | Each runway-queue Rack maps to an **end** (e.g. `rwy-05 → '05'`); where that mapping is exposed to the client (on the record, or only in server config) | record / `facility-config.js` |
| V4 | Status enum `OPEN | CLOSED | SUSPENDED_BARRIER_CHANGE | SUSPENDED_INSPECTION`; gear enums `state UP | DOWN | OUT_OF_SERVICE`, `type BAK_12 | E_5 | OTHER`, `position APPROACH_END | DEPARTURE_END | OVERRUN`. **S-L1a (provisional, desk item L1-W1):** gear is data only — `arrestingGear` validated when present, **Incirlik ships `[]`, there is no `SetGearState`**, and the suspension carries a `kind` (`BARRIER_CHANGE` today; may be renamed to a generic "works + inspection" if the human picks L1-W1 (c)). Render `kind` generically | `field-state.js` enums; INCIRLIK config; store |
| V5 | Op kinds and owners (`FIELD_STATE_OP_OWNERS`, `canActOnFieldState(actingPositionId, opKind)` in `permission.js`). Expected per **S-L1b**: `CloseRunway`/`OpenRunway`/**`BeginBarrierChange` owned by TWR**; OPS and the other ATC Positions send **`RequestRunway…` with kinds `CLOSE`, `OPEN`, `BARRIER_CHANGE`**, which TWR accepts (the accept applies the change) or rejects — exact op names and where pending requests sit on the record are unknown; **`CompleteBarrierChange` and `CompleteInspection` stay with OPS**. Runway change: `ProposeRunwayChange`/`WithdrawRunwayChange`/`BeginRunwayChange`/`CompleteRunwayChange` (TWR), `AckRunwayChange`/`RejectRunwayChange` (OPS, APP ∩ frozen acknowledgers; an unmanned APP acknowledger is **skipped and audited**, S-R2-15/H20 — find how the record shows that), **`SelfCoordinateRunwayChange`** (S-Q24). No `SetGearState` (S-L1a) | `permission.js`; store `apply` switch |
| V6 | Wire: inbound `{version:1, type:'efsp-field-state-mutation', clientMutationId, facilityId, baseRev, actingPositionId, op:{kind, runwayId?, end?, gearId?, state?, toRunwayId?/toEnd?, note?, reason?, requestId?}}`; ack `efsp-field-state-ack` `{clientMutationId, facilityId, runwayId?, ok, fieldState, reason, detail, fieldStateSeq}`; delta `efsp-field-state-delta` `{fieldStateSeq, fieldStates:{updated:[record]}}`; snapshot key `fieldStates: [record]`. Note the exact key the op uses to name a runway under S-Q23 (`runwayId: '05/23'`? `end: '05'`?) | `efsp-ws.js` |
| V7 | `runwayChange` shape: `{changeId, state: PROPOSED|ACKNOWLEDGED|IN_PROGRESS|PENDING_INSPECTION|REJECTED, from…, to…, proposedBy, proposedPositionId, acknowledgers[], acks:{OPS:null|{by,at,selfCoordinated}}, rejected, pendingInspection[]}` and derived `runwayChangeInProgress` | store |
| V8 | Pads (Q36(a) + H21): config `pads: { hotCargo, alert }` holding **placeholder names only**; record `hotCargoPad`/`alertPad` `{occupied:false, occupantFdrId:null}` with **no ops**. Whether the pad **name** reaches the client on the record (L12/L13 need it) | store `getFieldState`; config |
| V9 | Pure `field-state.js` exports: `normalizeRunwayId`, a Strip→runway resolver (`runwayIdForStrip` or renamed) that goes **rack → FDR field (8A/8B) → Facility active runway → null** and **reports the source** (S-Q25), `runwayInhibitFor`, **`runwayAdvisoryFor`** (Q30(b)) — and that the module requires nothing (so crc-desktop tests can `require` it) | `field-state.js` |
| V10 | Inhibit reason strings per Q40(a): `runway 05/23 suspended — barrier change`, `runway 05/23 suspended — awaiting inspection`, `runway 05/23 closed` | `runwayInhibitFor` + tests |
| V11 | After a successful op the server calls `nlaStatusMonitor.tick()`, so affected Strips' `nla` stamps arrive promptly on an `efsp-board-delta` (L1 briefing Q9(a)) | `_handleFieldStateMutation` |
| V12 | Timestamps on the record (`suspension.since`, `lastInspection.at`, acks' `at`) are **mission-clock** ms (H11) | store |
| V13 | Field state persists inside the Board snapshot file (`efsp-board.json`), so the e2e harness needs **no** new env var (`crc-desktop/playwright.config.js` `syncEnv`) | `index.js` `_persist` |
| V14 | H22 / **S-L1c**: the active end is set from the mission wind by `fieldStateStore.setActiveRunwayFromWind`, called from one hunk in `server.js`'s `mission-load` handler. The e2e harness has no DCS, so find what `activeRunway` is then (a fallback end, or `null`) and whether the record says how it was set. Your walk and panel must handle `null` | `field-state-store.js`; `server.js` |
| V15 | **S-R2-1**: L1 routes runway-queue placement through `runwayRackFor(strip, fdr, fieldState, bay)` at the four placement sites (so NLA from TAXI queues into the resolved end's Rack, not `rackIds[0]`) and passes the **target** `{bayId, rackId}` into the drag-path ctx. Confirm both; they change what your e2e walk sees | `board-store.js` |

If a V-item is **absent** from merged L1 (not merely renamed), see Q10.

**L1's work in progress, peeked read-only at `6473270` (4 commits on `lane/L1-field-state`, uncommitted
edits still open) — a head start, not a substitute for checking the merged code:**
- `field-state.js` header: pure, and says "Later lanes add pure functions HERE" (naming L12's advisory
  and L1b's `gearMismatchFor`). Exports include `SUSPENSION_KINDS` (`BARRIER_CHANGE`, `RUNWAY_CHANGE`),
  `REQUEST_ACTIONS` (`CLOSE`, `OPEN`, `BARRIER_CHANGE`), `RUNWAY_GATED_STATES`, `normalizeRunwayEnd`,
  `buildStatusView(inventory, record)`, **`resolveRunwayForStrip(strip, fdr, view, { targetRackId })`**
  (DEPARTURE/ARRIVAL only; a `view` carries `activeRunway` and `rackEnds`), `runwayStatusReason(runway)`,
  `runwayInhibitFor(strip, fdr, view, opts)`, **`runwayAdvisoryFor(strip, view)`**, `runwayRackFor`,
  `activeEndIntoWind`, `missionKeyOf`, `validateFieldStateInventory`, `runwayInventoryWarnings`.
- Runway rows: `{ runwayId: '05/23', ends: ['05','23'], status, arrestingGear: [...] }`; the Facility
  holds the active **end**.
- Store ops: `CloseRunway`, `OpenRunway`, `BeginBarrierChange`, `CompleteBarrierChange`,
  `CompleteInspection`, **`RequestRunwayStatus`** (+ `AcceptRunwayRequest` / `RejectRunwayRequest`),
  `ProposeRunwayChange`, `SelfCoordinateRunwayChange`, `AckRunwayChange`, `RejectRunwayChange`,
  `WithdrawRunwayChange`, `BeginRunwayChange`, `CompleteRunwayChange`. No `SetGearState`.
- Pads: INCIRLIK config `pads: { hotCargo: { name: 'Hot cargo pad' }, alert: { name: 'Alert pad' } }`;
  the record merges them, so `hotCargoPad`/`alertPad` carry `{ name, occupied, occupantFdrId }` **to
  the client**.

**Later supervisor rows that touch this lane** (decisions.md): **S-R2-2** — mission identity moves to
a `mission-session.js` module (supervisor fix **F3**, between waves, hoisting L1's `missionKeyOf`);
if F3 has landed in your base, read session boundaries from it, never from `missionKeyOf` directly.
**S-R2-13** — archiving DROPPED Strips/FDRs (H36) is wave-2 lane **L24**: a Strip or FDR you look up
may be archived, so a missing FDR is `null`, never a throw. **S-R2-14** — L23 owner-checks `SetState`
this wave; L1 made `SetState` honour the runway inhibit. **S-R2-17** — supervisor fix **F4** makes
typed `…TimeUtc` Blocks store epoch ms (via L2's `resolveZuluHhmm`); any time you read off an FDR is ms.

---

## 5. Current state of the client (verified at `cfcf344`; find by symbol)

### 5.1 Client EFSP state — `crc-desktop/app/public/js/panels/efsp/efsp-state.js` (420 lines)

- Plain globals, dual-use export at the bottom (`module.exports` block, ~402–419).
- `applyEfspSnapshot(msg)` (73–91) clears and refills each map, last lines refill `efspMarsa` from
  `msg.marsa`. **You append two lines at its end** refilling `efspFieldStates` from `msg.fieldStates`.
- Delta appliers are one-liners in the MARSA / airspace shape: `applyEfspMarsaDelta` (103–106),
  `applyEfspAirspaceDelta` (213–215). Getters `getEfspAirspace`/`getAllEfspAirspaces` (217–218).
- `_resetEfspStateForTest()` (360–376) — append `efspFieldStates.clear();`.
- L7 (wave 1) changed the obligation part of this file; do not touch it.

### 5.2 Client wire — `panels/efsp/efsp-ws.js` (172 lines)

`sendEfspAirspaceMutation` (102–108), `sendEfspCorrelationMutation` (122–128),
`sendEfspMarsaMutation` (143–149): each `_sendEfsp({version:1, type, clientMutationId:
efspClientMutationId(), …, baseRev, actingPositionId, op})`, **not** registered as pending (the
§5.6.3 replay machinery is keyed on Strip identity). Append `sendEfspFieldStateMutation` after
`sendEfspMarsaMutation`, same shape, same comment reasoning.

### 5.3 `app.js` `ws.onmessage` switch (817 lines; switch at ~484)

- `case 'efsp-snapshot'` (581–613) re-renders everything, including `renderAirspacePanel()` (~602).
- `case 'efsp-marsa-delta'` / `'efsp-marsa-ack'` (692–707) and `'efsp-airspace-delta'` /
  `'efsp-airspace-ack'` (708–737) are your templates. The airspace ack names the refusal by
  `{ subject: … }` (F-103's attribution rule) — copy that, with the subject `runway 05/23`.
- Last case `efsp-obligation-alert` (744–747) — **L7 deleted/changed it in wave 1**; append after
  whatever is last.

### 5.4 The dock — `dock.js` (737 lines), `radar-panel.js`, `index.html`

- `PANEL_TITLES` (34–42), `createComponent` switch (52–64, `case 'airspace': return
  mountExistingPanel('airspace-panel', initAirspacePanel);`), `LEFT_CLUSTER` (188),
  `PANEL_SIDE` (199), the placement table entry `airspace: () => {…}` (295–301).
- `radar-panel.js` `panelControlRows()` (101–109) — the PANELS list a controller opens panels from.
  **Not on plan §2's list; you append one row (Q4).** L15 appends one too.
- `index.html`: the airspace panel div (218–224) `<div id="airspace-panel" class="dock-unmounted">`;
  scripts 915–936, `airspace-panel.js` at 934; stylesheets 13–24.

### 5.5 The model panel — `panels/efsp/airspace-panel.js` (209 lines)

Copy its structure: a pure, exported `airspaceActionsFor(airspace, heldPositionIds)` (34–68) that
mirrors the store's authority split and is **proactive only**; `_dispatchAirspace` (84–102) using
`window.prompt` for a required reason and `missionNow()` for "now"; `_buildAirspaceCard` (104–181);
`renderAirspacePanel()` (183–199) using `getActingPositions()`; `initAirspacePanel()` caching
element refs once (dockview detaches inactive panels — the module comment 13–16 explains). Its test
`crc-desktop/tests/efsp-airspace-panel.test.js` is the model for your action-gating test.

### 5.6 The Strip — `panels/efsp/strip-view.js` (777 lines, Layout C, ADRs 0056/0058)

- `_buildLifeBlock(strip)` (287–313): the NLA button; when `strip.nla.inhibited` is set, the button is
  disabled, titled with the reason, and `_buildReasonLines` (486–516) renders
  `efsp-strip-reason efsp-nla-inhibit-reason`. **This is how the server's field-state inhibit
  reaches the Strip already** — no new code needed for rule 1's reason, only proof (§8).
- `INDICATOR_ORDER` (357) = `['stca','conf','trk','marsa','tofi','airspace','timer','siblings']`.
- `_stripAlerts(strip)` (369–393) returns `[{key, text, tone, legacy, reason}]`; the Strip turns
  `efsp-strip-alert` (any `bad`) / `efsp-strip-alert-attn` (756–758); every alert's `reason`
  becomes a reason line (488–491).
- `_buildIndicatorSlots` (462–482): **only alerts whose key is `stca` or `conf` become indicator
  chips** (`if (key === 'stca' || key === 'conf')`, 466). An alert with a new key would render as a
  reason line but **no chip** unless this changes — hence §7.3's hook lines.
- There is **no** function called `_buildIndicator`; plan §2's name means `_stripAlerts` +
  `_buildIndicatorSlots`/`INDICATOR_ORDER`.

### 5.7 FDR fields you read

`fdr.military.hookRequired` (`3F`, boolean, ADR 0052); `fdr.filed.departureRunway` (`8A`, free
text); `fdr.assigned.landingRunway` (`8B` on ARRIVAL, free text); `strip.bayId`/`strip.rackId`/
`strip.facilityId`/`strip.role`/`strip.state`. Client FDRs arrive whole on board deltas.

### 5.8 Tests and e2e

- `crc-desktop/tests/helpers/dom-stub.js` — `makeElement` (L8 migrated the older copies to it in
  wave 1). `tests/efsp-ui-reachability.test.js`'s `renderStrip()` (~377–460) runs the real
  `strip-view.js` in a `vm` sandbox with a **fixed file list** (~413–414). Plan §2: append tests at
  the end, do not touch the harness (but see Q3).
- `crc-desktop/e2e/helpers/app.js`: `openPanel(page, {held, facilityId, controller})`,
  `openEfspPanel`, `seedStrip(page, {callsign, actingPositionId, bayId, role, facilityId, fdr})`,
  `stripByCallsign`, `expectRefusalIsVisible`, `stripMenuItem`, `startAction`. New specs must
  **not** be named `l1-…`–`l9-…` (Q5, S-ALL): use `e2e/field-state.spec.js`.

---

## 6. Steps — each ends green in crc-desktop, committed

### Step 0 — verify L1 (§4), write "L1 API as found" in `docs/wip/L1b.md`. No code. Commit the wip file.

### Step 1 — client state and wire

Files: `efsp-state.js`, client `efsp-ws.js`, `app.js`; new `tests/efsp-field-state-client.test.js`.

- `efsp-state.js`: `const efspFieldStates = new Map(); // facilityId -> field-state record (crc-sync
  docs/adr/0061)` beside `efspMarsa`; snapshot refill (append at the end of `applyEfspSnapshot`);
  `applyEfspFieldStateDelta(msg)` (records whole, by `facilityId`); `getEfspFieldState(facilityId)`
  (→ record or `null`); `getAllEfspFieldStates()`; reset; exports. **These two getter names are a
  contract with L12 and L13 — do not rename them** (§7.3).
- `efsp-ws.js`: `sendEfspFieldStateMutation(actingPositionId, facilityId, baseRev, op)`.
- `app.js`, appended at the end of the switch:
  ```js
  // WP6 §9.7 (crc-sync docs/adr/0061, crc-desktop 0068). Its own delta with its own seq —
  // field state is not Strips and rides no Board's sequence (0061's rule-5 deviation).
  case 'efsp-field-state-delta':
    if (typeof applyEfspFieldStateDelta === 'function') applyEfspFieldStateDelta(msg);
    if (typeof renderFieldStatePanel === 'function') renderFieldStatePanel();
    if (typeof renderAllOpenEfspBays === 'function') renderAllOpenEfspBays(); // RWY / HOOK are derived from it
    break;
  case 'efsp-field-state-ack':
    if (!msg.ok && typeof _showMutationError === 'function') {
      _showMutationError(msg.reason || 'Rejected', msg.detail, { subject: fieldStateSubjectFor(msg) });
    }
    if (msg.fieldState && typeof applyEfspFieldStateDelta === 'function') {
      applyEfspFieldStateDelta({ fieldStates: { updated: [msg.fieldState] } });
    }
    if (typeof renderFieldStatePanel === 'function') renderFieldStatePanel();
    if (typeof renderAllOpenEfspBays === 'function') renderAllOpenEfspBays();
    break;
  ```
  and **one line** in `case 'efsp-snapshot'`, directly after `renderAirspacePanel()`:
  `if (typeof renderFieldStatePanel === 'function') renderFieldStatePanel();`
  (`fieldStateSubjectFor` lives in your rules file: `runway 05/23`, or the Facility id.)
- Tests: snapshot fills and a second snapshot replaces; delta replaces a record whole; an ack with a
  record applies it; `getEfspFieldState('CENTER')` is `null`; reset clears.

### Step 2 — the pure rules mirror

New file `crc-desktop/app/public/js/panels/efsp/field-state-rules.js` (dual-use: plain function
declarations + a `module.exports` block, `efsp-nla.js`'s pattern). Pure; reads nothing global
except where stated.

- `normalizeRunwayId(text)`, `runwayForStrip(strip, fdr, record)` → `{ runway, end, source:
  'RACK'|'FDR'|'ACTIVE' } | null` — **a mirror of L1's resolver (V9)**, same order, same
  normalisation, fail open.
- `runwayAdvisoryFor(strip, fdr, record)` — mirror of L1's (V9) or, if L1 did not build it, your
  own (Q10): a Strip in a runway-queue Rack whose end ≠ the active end → `queued for inactive
  runway 05`.
- `gearMismatchFor(fdr, runway, end)` → `null | { text: 'HOOK', reason }` per Q1's default (note: with S-L1a's shipped `[]` inventory and no `SetGearState`, the default never fires on the shipped config — test it on fixtures, and say so in the ADR):
  `hookRequired` false → `null`; runway `null` → `null` (fail open); runway has **no gear configured**
  → `null` (fail open, H17 stub); otherwise if **no** gear on that pavement is `UP` → mismatch,
  reason `Hook required: no arresting gear is rigged on runway 05/23 (SOURCE practice).` (with the
  gear states listed, e.g. `BAK-12 05 end DOWN`). Gear counted: every gear on the physical runway
  (either end) — `[SOURCE-DEFINED]`, recorded in the ADR with the narrower per-end reading as the
  alternative.
- `fieldStateAlertsFor(strip)` → alert objects in `_stripAlerts`'s shape, reading
  `getEfspFieldState(strip.facilityId)` and `getEfspFdr(strip.fdrId)`:
  - `rwy` (tone `bad`): resolved runway status ≠ `OPEN`, for the states in Q5's default. `text`:
    `RWY 05 SUSP` / `RWY 05 INSP` / `RWY 05 CLSD` (the resolved **end**; ≤ 11 chars is fine for an
    indicator); `reason`: the L1 inhibit string as a sentence plus what clears it, e.g.
    `Runway 05/23 is suspended for a barrier change; it reopens when OPS completes the inspection.`
    **Suppress the reason line (not the chip)** when `strip.nla && strip.nla.inhibited` already
    names the same runway, so the Strip never says the same thing twice.
  - `rwy` (tone `attn`): the Q30 advisory when the runway is `OPEN` but the Strip is queued for an
    inactive end.
  - `gear` (tone `bad`): `gearMismatchFor` on ARRIVAL Strips in `INBOUND`, `HANDED_TO_TOWER`, `FINAL`.
  - Nothing for OVERFLIGHT or MISSION, nothing for a Facility with no record, nothing for `DROPPED`.
- `fieldStateActionsFor(record, heldPositionIds)` → `[{ positionId, kind, label, runwayId?,
  end?, gearId?, state?, needs?: 'reason'|'note'|'toEnd' }]`, the `airspaceActionsFor` mirror,
  driven by **L1's `FIELD_STATE_OP_OWNERS` as found (V5)** plus the store's preconditions (status,
  change state, frozen acknowledgers, "has not acked yet", inspection authority). Offer
  `SelfCoordinateRunwayChange` exactly when the controller holds TWR **and** every acknowledger
  (S-Q24) and no change is open; offer TWR's accept/reject for each pending request (H18).
- `fieldStateSubjectFor(msgOrOp)` → `runway 05/23` / Facility id.
- Tests (`efsp-field-state-client.test.js`):
  - **drift**: `require('../../crc-sync/src/efsp/field-state.js')` and run both resolvers, the
    advisory and the inhibit wording over one table of cases (rack wins; 8A/8B fallback; active
    fallback; garbage → null; OVERFLIGHT → null); and `require('../../crc-sync/src/efsp/permission.js')`
    and assert every `kind` `fieldStateActionsFor` can ever offer is a key of `FIELD_STATE_OP_OWNERS`
    and is offered only to a Position `canActOnFieldState` allows (enumerate Positions × states).
    Precedent: `efsp-nla-client.test.js:160` requires `permission.js` already.
  - `gearMismatchFor`: no hook → null; no inventory → null; all gear DOWN → alert; one UP → null;
    `OUT_OF_SERVICE` counts as not usable.
  - `fieldStateAlertsFor`: each case above, and the duplicate-reason suppression.
  - `fieldStateActionsFor` (airspace-panel test's shape): holding nothing → `[]`; OPS on an `OPEN`
    runway → **requests** (`CLOSE`, `BARRIER_CHANGE`) only, never Close or Begin barrier change (H18/S-L1b); TWR → Close/Open,
    Begin barrier change, Propose, and Accept/Reject on each pending request; OPS on a runway in
    `SUSPENDED_BARRIER_CHANGE` → Complete barrier change; APP → Ack only while `PROPOSED` and not yet acked; a controller holding TWR+OPS+APP →
    `SelfCoordinateRunwayChange` offered; `BeginRunwayChange` offered only in `ACKNOWLEDGED`;
    `CompleteInspection` only to the inspection authority on `SUSPENDED_INSPECTION`.

### Step 3 — the dock panel

New files: `panels/efsp/field-state-panel.js`, `crc-desktop/app/public/css/field-state-panel.css`.
Edits: `index.html`, `dock.js`, `radar-panel.js`.

- `index.html`:
  - a panel div directly **after** the airspace panel's closing `</div>`:
    ```html
    <!-- Field state (guide §9.7, crc-sync docs/adr/0061). Its own panel: runways and gear are
         not Strips, so this is not the ops-field-state Bay (docs/adr/0068). -->
    <div id="field-state-panel" class="dock-unmounted">
      <div id="field-state-empty" class="efsp-empty">No field state at any Facility you can see.</div>
      <div id="field-state-list"></div>
    </div>
    ```
  - `<link rel="stylesheet" href="./css/field-state-panel.css"/>` after `efsp-panel.css`'s link;
  - scripts: `field-state-rules.js` and `field-state-panel.js`, **directly after the
    `airspace-panel.js` script tag** (your anchor; L12/L13 use different anchors, §7.3).
- `dock.js`: `PANEL_TITLES.fieldState = 'FIELD STATE'` (appended entry `fieldState: 'FIELD STATE',`
  after `airspace`); `case 'fieldState': return mountExistingPanel('field-state-panel',
  initFieldStatePanel);` after the airspace case; `'fieldState'` appended to `LEFT_CLUSTER` and
  `PANEL_SIDE` (`left`); a placement entry after `airspace: () => {…}` copied from it.
- `radar-panel.js`: append `{ id: 'fieldState', label: PANEL_TITLES.fieldState },` to
  `panelControlRows()`.
- `field-state-panel.js` (module comment: why its own panel; element refs cached in init, the
  airspace-panel reason):
  - `renderFieldStatePanel()` — one section per `getAllEfspFieldStates()` record, heading the
    Facility id and `rev`; empty-state element shown when there are none.
  - Per runway: `05/23` + status badge (`OPEN` plain, anything else amber/red — reuse the
    `--efsp-attn`/`--efsp-bad` tokens from `efsp-panel.css`); the active end marked `▶ 05 ACTIVE`
    (or `ACTIVE —` when `null`, V14); `suspension`/`closure`/`lastInspection` as `SUSPENDED BARRIER
    CHANGE by OPS (controller) 1432Z — note`; each gear as a row `BAK-12 · 05 end · APPROACH END ·
    1,500 ft · UP` (when the inventory is empty: `No arresting gear configured (SOURCE
    practice).`).
  - The runway change, when present: `05 → 23 · PROPOSED by TWR 1440Z`, then one chip per
    acknowledger `OPS ✓ 1441Z` / `APP …` (`selfCoordinated` shown as `self`), `REJECTED` with who
    and note, `PENDING INSPECTION: 05/23`.
  - Pending runway requests (H18), each with its requester and, for TWR, Accept/Reject.
  - Pads (V8): `HOT CARGO PAD · <name>` / `ALERT PAD · <name>` with `occupied` when set; name
    missing → `not configured`. For the alert pad also render
    `typeof alertPadConstraintFor === 'function' ? alertPadConstraintFor(record.facilityId) : null`
    as a line when non-null (L13 defines it — §7.3).
  - Actions from `fieldStateActionsFor(record, getActingPositions())`, buttons titled `as <POS>`;
    `needs:'reason'` → `window.prompt` (Cancel aborts; the airspace Deny precedent); `needs:'toEnd'`
    → a `<select>` of the other ends; dispatch with `sendEfspFieldStateMutation(action.positionId,
    record.facilityId, record.rev, op)`. Buttons go disabled on press until the next render (§7.9's
    rule, as the NLA button does).
  - `initFieldStatePanel()` → `{ onShow: renderFieldStatePanel }`.
  - Export `{ renderFieldStatePanel }` is not needed for Node; export only the pure helpers from
    the rules file.
- Tests (append to `efsp-field-state-client.test.js`, using `tests/helpers/dom-stub.js` and a `vm`
  sandbox loading `efsp-state.js`, `field-state-rules.js`, `field-state-panel.js` — the
  reachability test's airspace sandbox at ~876 is the pattern): a snapshot with a suspended runway
  renders its attribution; the OPS button dispatches `BeginBarrierChange` with the record's `rev`;
  a held-nothing controller sees no buttons; the alert-pad hook line renders when the hook returns
  text and is absent when the hook is undefined.

### Step 4 — the Strip

Edit `strip-view.js` **only** with the three shared hook edits of §7.3 (identical text in L1b, L12,
L13). Your content lives in `fieldStateAlertsFor` (Step 2). Tests: a `vm` sandbox test that renders
a Strip (your own sandbox, or the reachability harness per Q3) with a suspended runway and asserts
the `RWY` chip (`data-slot="rwy"`) and its reason line; the `HOOK` chip on a hook-required ARRIVAL
onto all-DOWN gear; nothing on a quiet Strip (ADR 0058's "nothing for normal"); and that
`strip.nla.inhibited` from a field-state reason still renders exactly one reason line.

### Step 5 — Playwright: the Phase 3 walk (`E2E_LANE=1`, `e2e/field-state.spec.js`)

Screenshots with `page.screenshot({ path: '../docs/wip/L1b/<nn>-<what>.png', fullPage: false })`
(the spec runs with cwd `crc-desktop`). One controller holding every INCIRLIK Position is allowed
for the walk (H12: 1 controller is the worst case) but the D21 checks need two controllers → two
browser contexts with different `controller` names in `openPanel`.

1. `01-panel-open` — open FIELD STATE from the PANELS list; 05/23 `OPEN`, active end shown (or `—`).
2. Seed a DEPARTURE at `TAXI` with `8A=05` (`seedStrip` + `SetState` via the page, as other specs
   do) and one in `twr-runway-queue`/`rwy-05` at `RUNWAY_QUEUE`, and an ARRIVAL at
   `HANDED_TO_TOWER` with `8B=05`; plus an ARRIVAL at `FINAL` with `3F` ✓.
3. As OPS: **request** a barrier change on 05/23 → as TWR (second context): accept it (S-L1b) →
   `02-suspended-panel` (attribution line: who requested, who accepted), `03-strips-inhibited`
   (the queued departure's NLA disabled with the reason; the arrival's too; the `RWY 05 SUSP` chips).
4. The FINAL arrival: press its NLA → `LANDED` succeeds (FINAL → LANDED is never inhibited) →
   `04-final-still-lands`.
5. OPS: Complete barrier change → still inhibited, `INSP`; TWR tries `CompleteInspection` via
   `window.sendEfspFieldStateMutation` → refusal banner names runway 05/23 (`expectRefusalIsVisible`)
   → `05-inspection-refused-to-twr`; OPS completes inspection → `06-reopened` (inhibits gone,
   `lastInspection` shows OPS).
6. Runway change (context 2 = a second controller on APP, context 1 = TWR+OPS): TWR proposes 05→23;
   Begin is not offered; APP acks; still not offered; OPS acks → Begin offered → Begin → Complete →
   `PENDING INSPECTION` → OPS inspects → active `23` → `07-runway-change-done`. The `rwy-05`
   departure now shows `queued for inactive runway 05` (Q30) → `08-inactive-runway-advisory`.
7. Pilot requests the client can show (WP6 plan item 5): *"request runway 23"* from a Strip in
   `rwy-05` (move it to `rwy-23`; the chip follows the rack); a runway change proposed then
   **rejected** by APP (what TWR sees → `09-rejected`); a divert with `3F` onto a runway whose gear
   is DOWN/`OUT_OF_SERVICE` — **not walkable under S-L1a** (no gear, no `SetGearState`): record it as
   such, and prove the chip with the fixture-driven client test instead; a restart mid-suspension is **not** walkable from the
   harness without restarting its crc-sync — assert instead that a page reload (fresh snapshot)
   still shows `SUSPENDED` → `11-reload-still-suspended`.
8. The solo-controller path: one controller holding TWR+OPS+APP sees one `Self-coordinate change`
   action (S-Q24) → `12-self-coordinated`.
9. Console errors: none (`openPanel`'s `consoleErrors`).

Every screenshot listed in `docs/wip/L1b.md` with one line saying what it proves.

### Step 6 — ADR 0068, `docs/wip/L1b.md`, both suites, final commit.

---

## 7. Shared-file rules for this lane

### 7.1 Files you own (new)

`panels/efsp/field-state-rules.js`, `panels/efsp/field-state-panel.js`, `css/field-state-panel.css`,
`tests/efsp-field-state-client.test.js`, `e2e/field-state.spec.js`, `docs/adr/0068-*.md`,
`docs/wip/L1b.md`, `docs/wip/L1b/*.png`.

### 7.2 Shared files you edit

| File | Other lanes this wave | Rule for you |
|---|---|---|
| `app/public/js/app.js` | L14, L15 | two cases appended at the **end** of the switch; one line after `renderAirspacePanel()` in `efsp-snapshot`. Nothing else |
| `app/public/index.html` | L12, L13, L14, L15 | the panel div after the airspace panel; the CSS link after `efsp-panel.css`; two scripts after `airspace-panel.js` (§7.3 anchors) |
| `app/public/js/dock.js` | L15 | append-only: one entry in each of `PANEL_TITLES`, `createComponent`, `LEFT_CLUSTER`, `PANEL_SIDE`, placement table |
| `app/public/js/panels/radar-panel.js` | L15 | one row appended to `panelControlRows()` (Q4) |
| `panels/efsp/efsp-state.js` | — (L7 was wave 1) | new map, getters, delta applier appended after the MARSA block; two lines at the end of `applyEfspSnapshot`; one in the reset; exports appended |
| `panels/efsp/efsp-ws.js` (client) | L14 possibly | one function appended after `sendEfspMarsaMutation` |
| `panels/efsp/strip-view.js` | **L12, L13** (and L19 in wave 3) | **only the three hook edits in §7.3, byte-identical** |
| `tests/efsp-ui-reachability.test.js` | L13, L17 | append tests at the end; the harness file list only per Q3 |

Files you must **not** touch: anything under `crc-sync/`; `bay-view.js`; `efsp-panel.js`;
`strip-template.js`/`strip-fields.js`; `efsp-panel.css` (you have your own CSS file); the
`ops-field-state` Bay.

### 7.3 The wave-2 hook lines (identical in L1b, L12 and L13)

L1b, L12 and L13 all need new chips on the Strip and run at the same time. To keep the merge
mechanical, **all three lanes make the same three edits to `strip-view.js`, byte for byte**; git
merges identical hunks cleanly. Each lane then defines only its own function in its own file. A
function another lane has not merged yet is simply absent (`typeof … === 'function'` is false).

1. `INDICATOR_ORDER` becomes exactly:
   ```js
   const INDICATOR_ORDER = ['stca', 'conf', 'rwy', 'gear', 'ord', 'scram', 'trk', 'marsa', 'tofi', 'airspace', 'timer', 'siblings'];
   // Keys whose chips come from _stripAlerts (warnings first, left end of the row). rwy/gear:
   // field state (docs/adr/0068); ord: hung ordnance (0069); scram: alert/scramble (0070).
   const ALERT_SLOT_KEYS = new Set(['stca', 'conf', 'rwy', 'gear', 'ord', 'scram']);
   ```
2. In `_stripAlerts`, immediately before its final `return out;`:
   ```js
     // Wave-2 advisories, each defined in its own file (docs/adr/0068, 0069, 0070).
     if (typeof fieldStateAlertsFor === 'function') out.push(...fieldStateAlertsFor(strip));
     if (typeof ordnanceAlertsFor === 'function') out.push(...ordnanceAlertsFor(strip));
     if (typeof scrambleAlertsFor === 'function') out.push(...scrambleAlertsFor(strip));
   ```
3. In `_buildIndicatorSlots`, the line `if (key === 'stca' || key === 'conf') {` becomes
   `if (ALERT_SLOT_KEYS.has(key)) {`.

If wave 1 (L2's one-line D2 edit, L7) moved these lines, apply the edits to the current text, still
identically — and if the current text differs from what is quoted in §5.6 in a way that makes the
three edits non-identical across lanes, stop that step and report it (the supervisor re-issues the
exact text to all three).

Client-state contract you provide to L12 and L13 (they code against it before you merge):
`getEfspFieldState(facilityId)` → the record exactly as the server sent it, or `null`;
`getAllEfspFieldStates()`. And the panel calls L13's `alertPadConstraintFor(facilityId)` (→ string |
null) when defined.

`index.html` script anchors (distinct, so the three hunks do not touch): **L1b after
`airspace-panel.js`**; L12 after `marsa-badge.js`; L13 after `efsp-stereo-routes.js`.

---

## 8. Acceptance

- [ ] crc-desktop suite green, grown; crc-sync suite unchanged and green (you changed nothing there).
- [ ] The Phase 3 walk in Playwright green on `E2E_LANE=1`; the screenshots in `docs/wip/L1b/`,
      each described.
- [ ] Drift tests: the resolver/advisory/inhibit wording and the action table held against
      crc-sync's `field-state.js` and `permission.js`.
- [ ] `rwy` chip on every affected Strip in Q5's states; exactly one reason line when the NLA
      already carries the same reason; nothing on a quiet Strip.
- [ ] `gearMismatchFor` computed, never stored: `grep -rn "gearMismatch" crc-sync/` is empty; no new
      message type, record field or alert type.
- [ ] The `ops-field-state` Bay line in `facility-config.js` unchanged.
- [ ] `strip-view.js`'s diff is exactly §7.3's three hunks (`git diff <base> -- …strip-view.js`).
- [ ] P4: `git diff --stat <base> -- docs/adr/` lists only `0068-*.md`.
- [ ] No `Date.now()` in anything that renders a time a controller reads.

---

## 9. Traps

- **T1 — the server decides.** The action table is proactive; never skip sending because the mirror
  says no, and never trust the mirror for anything but which buttons to draw. A mirror that drifts
  is worse than none — hence the drift test.
- **T2 — S-Q23 changed the record.** L1's briefing §5.3 (per-direction runways with
  `reciprocalRunwayId`) is **superseded**. Code against what merged L1 sends (§4).
- **T3 — H18.** OPS no longer closes or opens a runway; it **requests**. Offering OPS a Close button
  is a bug the drift test must catch.
- **T4 — dockview detaches inactive panels.** Cache element refs in `initFieldStatePanel`, never
  `document.getElementById` per render (airspace-panel's module comment).
- **T5 — the 400 ms double-tap guard** (board-store's `_applyInvokeNla`) bites Playwright too: two
  NLA presses on one Strip within 400 ms — the second is a silent success that does nothing.
- **T6 — the ack reaches only the sender.** Other controllers learn from `efsp-field-state-delta`
  (field state) and `efsp-board-delta` (the re-stamped `nla`). Your render must hang off both.
- **T7 — two answers to one question.** The server's `nla.inhibited` and your `rwy` reason can say
  the same thing; suppress the duplicate line, keep the chip.
- **T8 — fail open.** Unknown runway, empty inventory, no record, garbage `8A`: no chip, no alert. A
  false `RWY`/`HOOK` on a quiet board teaches controllers to ignore both.
- **T9 — `gearMismatchFor` must not grow a record, an alert type or a broadcast** (WP6 plan rule-4
  paragraph). It is derived from two records that already broadcast whole (ADR 0045's principle).
- **T10 — the reachability harness's blind spot**: it holds writable Blocks, not indicators. Your
  chips need their own test.
- **T11 — `window.prompt` in Playwright** needs `page.once('dialog', d => d.accept('reason'))` before
  the click, or the test hangs.
- **T12 — shared board in e2e**: every test in a spec file shares one crc-sync; drive the runway back
  to `OPEN` / no open change at each test's end, or assert relative to the start.

---

## 10. Report back (≤ 40 lines, and the same content at the top of `docs/wip/L1b.md`)

1. Branch, `git log --oneline <base>..HEAD`.
2. Test counts: crc-desktop before → after (new per file); crc-sync before = after.
3. ADR `docs/adr/0068-<slug>.md`: Context / Decision / Alternatives considered / Consequences. It
   must state: the panel is its own dock panel and why not the Bay; the proactive-mirror rule and
   its drift test; the `rwy`/`gear` chips and when each shows; `gearMismatchFor`'s rule, why it is
   computed and never stored, and H17's effect on it; the wave-2 hook lines; every earlier ADR it
   builds on or changes (at least `0056` "reasons render under the NLA", `0058` "nothing for
   normal", `0061`, `0052`'s "§9.7's gear-mismatch check now has data to read"), with no edit to
   any of them (P4).
4. `docs/wip/L1b.md` sections: *L1 API as found* (V1–V15) · *What the usage guide should say* (a
   controller walkthrough of the panel and the chips) · *What the briefing should say* · *Walks not
   done* (restart mid-suspension, two-screen walks) · *Defaults taken* · *Findings for other lanes*
   (L1 gaps; anything for L12/L13/L19/L22) · *Screenshots* (one line each).
5. Shared-file edits with the functions touched, and a statement that nothing was reordered.
6. Open issues.

---

## 11. Questions for the supervisor (take the default, log it, carry on — P2)

**Q1 — `gearMismatchFor` under H17 (gear is a stub).** `[HUMAN]` DCS does not simulate runway
arresting wires (H17). S-L1a (provisional, desk item L1-W1) ships Incirlik with `arrestingGear: []`
and no `SetGearState`, so gear never changes at runtime.
Guide rule 4 still says a `3F` aircraft on approach "MUST be checked against gear state".
- (a) **Fail open on no data**: alert only when the runway has configured gear and none of it is
  `UP`; no inventory → no alert. With H17's stub this almost never fires, but it is correct the day
  gear data is real.
- (b) Alert whenever `3F` is set and no `UP` gear exists, **including** no inventory — every hook
  arrival at Incirlik is flagged, always.
- (c) Do not build rule 4; record the deferral in ADR 0068.
**Default: (a).** It is inert on the shipped config and correct the day gear data exists; (b)
would flag every hook arrival, forever, over data that is known to be absent.

**Q2 — The identical hook lines in `strip-view.js` (§7.3).** `[SUPERVISOR]`
- (a) **All three lanes make the same three edits, byte-identical**; git merges them cleanly.
- (b) L1b alone edits `strip-view.js`; L12/L13 wait for it or put their chips in reason lines only.
- (c) Each lane edits freely; the integrator resolves.
**Default: (a).**

**Q3 — The reachability harness's sandbox file list.** `[SUPERVISOR]` Plan §2 says do not touch the
harness, but a chip test needs `field-state-rules.js` loaded into `renderStrip`'s sandbox.
- (a) One identical edit in all three wave-2 lanes: append
  `...['field-state-rules.js', 'ordnance-advisory.js', 'scramble.js'].filter(f => fs.existsSync(path.join(CLIENT, f)))`
  to the file list.
- (b) **Each lane builds its own small sandbox in its own client test** (dom-stub + the files it
  needs), leaving the harness untouched.
**Default: (b).** (a) only if the supervisor rules so for all three lanes at once.

**Q4 — `radar-panel.js` is not on plan §2's list.** `[SUPERVISOR]` Opening the panel needs one row
in `panelControlRows()`; L15 needs one too.
- (a) **Allowed: one appended row each**; the integrator resolves the adjacent-line conflict.
- (b) Open the panel only via `toggleDockPanel` from the Strip panel.
**Default: (a).**

**Q5 — Which Strips show the `RWY` chip.** `[SUPERVISOR]`
- (a) **DEPARTURE in `CLEARED`, `HELD`, `PUSHBACK`, `TAXI`, `RUNWAY_QUEUE`, `LUAW`; ARRIVAL in
  `INBOUND`, `HANDED_TO_TOWER`, `FINAL`** — every Strip that will use the runway, so the controller
  sees it before the NLA does.
- (b) Only the states rule 1 inhibits (TAXI, RUNWAY_QUEUE, LUAW, HANDED_TO_TOWER).
- (c) Every live Strip at the Facility.
**Default: (a).** `FINAL` shows the chip but its NLA (→ LANDED) is never inhibited; the reason line
there says so ("landing is an observation and is not held").

**Q6 — Which records the panel shows.** `[SUPERVISOR]`
- (a) **Every record in the snapshot** (today only INCIRLIK), actions only for Positions held at
  that Facility.
- (b) Only records of Facilities where the controller holds a Position.
**Default: (a)** — a CTR controller may want to know Incirlik's runway is shut.

**Q7 — Input for reasons/notes.** `[SUPERVISOR]`
- (a) **`window.prompt` for a required reason (Close, Reject request), none for optional notes**
  (airspace Deny precedent).
- (b) An inline text field per action.
**Default: (a).**

**Q8 — Panel default placement.** `[SUPERVISOR]`
- (a) **Closed by default, in the PANELS list, left cluster** (like AIRSPACE).
- (b) Auto-open for a controller holding OPS or TWR.
**Default: (a).**

**Q9 — Notifying TWR of a pending runway request (H18).** `[SUPERVISOR]`
- (a) **A row in the panel with Accept/Reject, and the panel's tab title gains a count
  (`FIELD STATE (1)`)**; nothing in the Strip panel.
- (b) Also a line in the Strip panel's banner area.
**Default: (a).** (b) would edit `efsp-panel.js`, which is not yours.

**Q10 — Merged L1 lacks something this briefing assumes** (e.g. `runwayAdvisoryFor`, the request
ops, pad names on the record). `[SUPERVISOR]`
- (a) **Build what the client can derive from what is on the wire, mark it "client-derived, no server
  twin" in the ADR, and list the gap in "Findings for other lanes"**; never edit crc-sync.
- (b) Stop and ask.
**Default: (a)**, except when the gap blocks one of §8's acceptance items — then report it and
finish the rest.

**Q11 — Showing `self` on a self-coordinated acknowledgement.** `[SUPERVISOR]`
- (a) **Yes, `OPS ✓ self 1441Z`**, so a second controller reading the panel knows no second person
  agreed. (b) No distinction.
**Default: (a).**

**Q12 — Where `gearMismatchFor` lives.** `[SUPERVISOR]` L1's `field-state.js` header invites it there
(beside L12's advisory); plan §2 does not list `field-state.js` for L1b, and L12 appends to that file
this wave.
- (a) **Client only (`field-state-rules.js`)**, pure and tested; no second edit to `field-state.js` this
  wave. The ADR says a server twin can be hoisted later if a server consumer appears.
- (b) Append it to `field-state.js` too, with a drift test (a second appender beside L12 — an
  adjacent-hunk conflict for the integrator).
**Default: (a).**

---

## Supervisor addendum

Read `/home/nklx/dev/personal/sourcedcs/docs/parallel/decisions.md` in full before starting and
whenever told it changed; it wins over this briefing. Most likely to touch you: **H11** (in-game
Zulu), **H15** (magnetic), **H17** (gear is a stub) with **S-L1a**, **H18** with **S-L1b** (TWR closes, opens and begins a
barrier change; others request; OPS completes and inspects), **S-L1c** (wind-derived active end),
**S-R2-1** (placement by runway), **S-R2-15** (unmanned acknowledger skipped and audited), **H19** (no override), **H21** (pads are placeholder names), **H22** (active runway from
the mission wind), **S-Q23–S-Q25**, **S-ALL** (Q26–Q30, Q35, Q36, Q39, Q40 recommended options),
**H6** (no declutter), **H42** (one coalition per server; you may read it but have no need to).
