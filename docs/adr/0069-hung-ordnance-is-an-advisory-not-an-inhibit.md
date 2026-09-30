# 0069 — Hung ordnance is a computed advisory on the Strip, never an inhibit: it names the runway the Strip resolves to and the hot cargo pad, recommends no runway, and Block 3G is on every Position a pilot reports it to

## Context

Guide §9.5, whole:

> `M14` ∈ `{CLEAN, LOADED, HUNG, EXPENDED}`. `HUNG` MUST propagate to field state: verified local practice is that hung ordnance influences **runway selection** — Kunsan selects the runway that minimises taxi distance to the hot cargo pad, weather permitting `[Annex §13.8]`. Implement as an advisory on runway assignment plus a routing constraint toward the designated hazardous-cargo parking area.

`docs/adr/0052` built the field (`fdr.military.ordnanceState`, written only by `setMilitary()`, Block `3G` on the three ATC Roles) and said: "`3G` accepts `HUNG` and nothing acts on it yet". `docs/adr/0061` built field state: one record per Facility, one runway per pavement, and a pure module (`field-state.js`) whose header reserved a place for this function. This ADR is what acts on `HUNG`.

Three rulings shape it:

- **The WP6 plan, Phase 4:** an advisory, not an inhibit. The hot cargo pad from the field-state config is the named routing constraint. The Kunsan basis is **local practice at one base, not doctrine**. No taxi-distance computation, since there is no geometry.
- **H21:** SOURCE's pads are **placeholders: names only, no preferred direction.** The advisory states the fact and recommends no runway.
- **H55** (the human's answer to this lane's Q2): hung ordnance is reported to the first agency the pilot is in contact with, so **any Position the pilot is talking to may record it**: TWR, APP, CTR and every tactical Position.

## Decision

### An advisory, computed, never stored

`hungOrdnanceAdvisoryFor(strip, fdr, fieldState)` is appended to `crc-sync/src/efsp/field-state.js`. It is pure and requires nothing new. It returns `null` unless all of these hold:

- the FDR's `military.ordnanceState` is `HUNG`;
- the Strip is an `ARRIVAL` or a `DEPARTURE` (a departure that aborts and returns with a hung store is real);
- the Strip is not `DROPPED`;
- the Facility has a field-state record. A Facility without one has no pad to route to and no runway to name, so the function fails quiet.

When they hold, it returns `{ kind: 'HUNG_ORDNANCE', runway, end, runwaySource, padName, text: 'HUNG', reason }`.

`fieldState` is the record as the wire carries it (`FieldStateStore.getFieldState`). Its runway rows carry their ends and racks, so the record serves as its own inventory. The runway comes from `0061`'s `resolveRunwayForStrip` over `buildStatusView(record, record)`: the rack, then 8A/8B, then the active end, then nothing. The source is passed through under L1's names (`RACK`, `FDR`, `ACTIVE_RUNWAY`).

The advisory is **computed on every read and never stored**. That is the WP6 plan's rule-4 argument: the FDR and the field-state record both broadcast whole, so a stored advisory would only bump `rev`s and add deltas without saying anything new. There is no new FDR field, record field, op or wire message.

**It never inhibits.** `nla.js` does not read it, and no button is disabled or Mutation refused because of it. The pure test proves that `computeNla` gives identical results for a HUNG flight and a CLEAN one at `HANDED_TO_TOWER`, `FINAL`, `LANDED`, `TAXI`, `RUNWAY_QUEUE` and `LUAW` on a real field-state view. The scenario sortie walks `HANDED_TO_TOWER → FINAL → LANDED → TAXI_IN` with `advance()`, exactly as for a clean flight.

### The wording states facts and recommends nothing (H21) `[SOURCE-DEFINED]`

- With a pad: `Hung ordnance. SOURCE practice: after landing, taxi to <pad name>; the runway is the controller's call.`
- On a DEPARTURE Strip, "after landing" becomes "if it returns".
- With no pad configured: `Hung ordnance. No hot cargo pad is configured at <facilityId> (SOURCE practice).`
- When a runway resolved, this sentence is appended: ` Runway 05/23 (05) assigned.` The runway is named as L1 names it, the pavement plus the end when one resolved, so no per-direction id is invented. The source (rack, FDR or active end) stays in the returned object and never reaches the UI.

The chip label is `HUNG`, tone `attn` (amber). Red is reserved for "something is wrong with what the controller is doing" (STCA, level bust). Hung ordnance is a situation in effect. Tests assert that no reason contains recommendation wording (`prefer`, `recommend`, `closer`, `nearer`, `use runway`, …) or cites Kunsan, the FAA or the USAF. The guide's Kunsan basis is cited here, in the ADR, and nowhere in the UI.

### The pad is a named routing constraint, with no geometry

The pad's name comes from the Facility config (`fieldState.pads.hotCargo.name`, INCIRLIK `'Hot cargo pad'`). `getFieldState` merges it onto the record, so it reaches the client in the snapshot and in every field-state delta. Nothing computes a taxi distance or compares runway ends against the pad, because no geometry exists and H21 forbids a preferred direction. A runway change re-states the runway and leaves the pad unchanged, and a sortie asserts that.

**Pad occupancy is deferred.** `hotCargoPad.{occupied, occupantFdrId}` stays present and unpopulated (§12), as L1 seeded it. The advisory does not read it. Populating it needs store ops and a wire change in L1's files, and the need has not been shown. A walked scenario where two hung aircraft compete for one pad would show it.

### The client mirror and its drift test

Browser scripts cannot load crc-sync, so `crc-desktop/app/public/js/panels/efsp/ordnance-advisory.js` holds a **copy** of the function, runway resolution included. Its helpers are `_ord`-prefixed so they cannot collide in the shared global scope. `tests/efsp-ordnance-client.test.js` requires both and runs them over one table of more than 5,000 rows: every ordnance state × every Role and several states × pad/no pad × rack × 8A/8B spelling × active end × record/no record. The results must be deep-equal.

`ordnanceAlertsFor(strip)` returns the chip for `strip-view.js`. It reads `getEfspFdr` and, when present, `getEfspFieldState` (L1b's client field state, built in the same wave). **With no client field state, the chip still shows**, with `Hung ordnance. The hot cargo pad is shown when field state is available.` Whether a pilot's ordnance is hung must never depend on another lane's merge order.

The chip shows on **every Position's** view of the Strip, including Positions whose grid lacks `3G` (GND after landing). The MISSION Strip gets no chip, because it has no runway. Its ATC twin shares the FDR and carries the chip.

### The wave-2 hook lines

`strip-view.js` gets three edits, byte-identical in L1b, L12 and L13 (decisions.md S-W2A):

- `INDICATOR_ORDER` gains `rwy`, `gear`, `ord` and `scram` after the conformance keys;
- an `ALERT_SLOT_KEYS` set replaces `key === 'stca' || key === 'conf'`;
- `_stripAlerts` ends with three `typeof … === 'function'` calls, one per lane's file.

Each lane defines only its own function. The `ord` chip therefore sits with the warnings, at the left end of the indicator row. Its reason line comes out of the existing `_buildReasonLines`, because every alert's `reason` becomes a line.

### Block 3G on every Position a pilot reports to (H55), MISSION included

This **changes `0052`**, which put `3G` on the three ATC Roles and deliberately not on `MISSION_BLOCK_MAP` ("one aircraft's ordnance has one place to be declared"). Under H55:

- `strip-fields.js` puts `3G` on APP's and CTR's grids for DEPARTURE, ARRIVAL and OVERFLIGHT. TWR already had it. `3G` also goes on the MISSION Role list, which is the grid every tactical Position (TAC_C2, AIC, GCI, JTAC) uses.
- `MISSION_BLOCK_MAP` gains `'3G'` on both sides, onto the same `military.ordnanceState` target. It is appended as the map's last entry.
- The hook requirement (`3F`) stays Tower's alone and off MISSION, because it gates a runway and a mission line uses none.

`0052`'s worry was two answers to one question. That does not arise: the MISSION Strip and its ATC twin share one FDR, so this adds a second surface onto one fact, not a second fact. The id is `3G`, not a guide `M`-number, so `0052`'s namespace rule (the `M` prefix belongs to `MISSION_BLOCK_MAP`'s own frozen meanings) is untouched. The tests that held `0052`'s rule now hold H55's:

- `efsp-block-map.test.mjs`: MISSION resolves `3G` and has no `3F`;
- the client parity test: `3G` is on all four Roles on both sides;
- `efsp-strip-fields.test.js`: `3G` is on exactly TWR, APP, CTR and MISSION;
- the reachability test: each of those Positions reaches `3G` on its own Strip and sends `SetBlock 3G HUNG`.

The scenario has TAC_C2 record `HUNG` on a mission line and the ATC twin show the advisory.

## Alternatives considered

- **An inhibit** (refuse `FINAL` or `LANDED` to a hung aircraft until a runway is chosen). The guide says "advisory" and the plan says it twice. An inhibit that fires on a pilot's report would strand an aircraft on the board.
- **Recommend the runway nearer the pad.** This is what the guide's Kunsan text does. H21 forbids it: the pads are placeholder names with no position, so "nearer" would be invented.
- **Store the advisory** (an FDR flag set when `3G` becomes HUNG). It is a derived value of two records that already broadcast whole. Storing it adds `rev` churn and a second copy that can disagree with the first.
- **Client only, with no server function.** The plan names `field-state.js`. A server twin is where a later consumer (L19 metrics, an acknowledgement warning) would read it, and the drift test keeps the copy honest.
- **Leave `3G` on TWR's grid only** (this lane's briefing default for Q2). The human overrode it with H55.
- **A hint line inside the 8A/8B editor** (Q6). Not done: the reason line is already on the Strip being edited, and `bay-view.js` is not this lane's file. This is a follow-up if controllers miss it.

## Consequences

- `HUNG` now does something visible on every Position, and nothing it does can block a flight.
- APP's and CTR's Strips grow a field. On APP's ARRIVAL Strip, `ORDNANCE` starts a third field row (screenshot `docs/wip/L12/02-app-sees-it.png`), which costs Strip height on every flight (`0056`'s criterion). H55 made that trade. A later layout pass may want `3G` to render only when it is not `CLEAN`.
- The `LOADED` and `EXPENDED` states still produce nothing (`0058`: nothing is drawn for what is normal).
- Until L1b's `getEfspFieldState` merges, the client shows the generic sentence. After it merges, the pad name and runway appear with no change here.
- Mutation-log entries for `SetBlock` record the Strip before and after but not the FDR value written. The `3G` write is auditable only by op and rev. This is L26's finding, recorded in `docs/wip/L12.md`.
- Builds on `0052` (the field; changed here as above), `0061` (the resolver, the record and the pad config), `0058` (nothing drawn for what is normal) and `0045` (computed, not stored). None of them is edited (P4).
