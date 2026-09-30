# 0073 — Block `9F` is a picker of the stereo route table; §10.5's time fallback chains are computed at read; every epoch time Block reads `HHMM`

## Context

ADR `0050` made Block `9F` (STEREO, `filed.stereoRouteName`) writable, so that a controller can switch or cancel a stereo route on a live Strip. It left the cell as free text. The reason, in `strip-template.js`, was that `ENUM_SELECT_BLOCKS` is a static client literal and the route table is runtime config, so a picker had no option source. The consequence was that a controller had to type a name from memory, and a misspelled name reached the server only to be refused.

Guide §10.5 (`EFSPImplementationGuide.md:1183–1191`) asks for more than per-path provenance: *"Where a time or value has multiple possible sources, implement an explicit ordered fallback and record which source was used … Apply the same shape to departure time, off-block time and takeoff time. The chosen source MUST be visible on hover."* The template is ATD-2's UOBT chain. Before this ADR, `fdr.provenance[path]` was recorded for every write and shown nowhere. No time field had a second source. The DD-1801's departure time (item 13, `depTime` in sourcedcs-web) was dropped by `flight-plan-lookup.js`.

Fix F4 (S-R2-17) made every typed `…TimeUtc` Block store epoch ms and display as `HHMM`. It left out the vul window (`M6`/`M7`). **S-F4** gave that window to this lane: a typed start resolves like any typed time (the nearest occurrence within ±12 h, S-L2b), and a typed end resolves to the first occurrence **after the start**, so a window may run longer than 12 h. `normalizeTypedTime` stays the single rule.

Rulings that bind this ADR: **H11** (in-game Zulu, the injected mission clock), **H23** (MTRs stay free text until the human supplies a list), **H67** (an estimated time is shown in italics, with its source on hover), **S-W2B** (the recommended option on every supervisor question, three additive lines in `bay-view.js`, an opt-in e2e env var, and contract C1 `fdr.ato.departure.timeUtc` from L14), **P4**, **P5**.

### What this supersedes

Per P4, `0050` is not edited. This ADR replaces one part of it: `9F` was *"ordinary click-to-edit free text"*. It is now a picker. The server side of `0050` is unchanged: `setField('filed.stereoRouteName', …)` still resolves every name against the table, refuses unknown or inactive names, re-files route, altitude and airports on a pick, and clears only the label on `''`.

## Decision

### 1. `9F` is a `<select>` of the configured stereo routes

- **The option source is runtime.** `efsp-stereo-routes.js` keeps the last list that a fetch actually returned and exports it as `cachedStereoRoutesClient()`. An ok response replaces the cache, even with an empty list. A failed fetch leaves the cache alone. `efsp-panel.js` already re-fetches on every snapshot, so the picker follows a restarted crc-sync without any new code.
- **`enumSelectOptionsFor(blockId, fdr)`** returns, for `9F`, every cached active route name in table order. It adds the flight's current `filed.stereoRouteName` when that name is not in the list: a route retired since filing stays visible and selected on the flight that is flying it (0050: deactivation is not retroactive). It returns `null` when nothing is cached and the flight has no stereo.
- **`isBlockEditable('9F')`** is true only while the cache is non-empty. With no table and no value, the cell is a plain span titled *"no stereo routes configured"*. It is never a free-text cell, because `bay-view.js` tries the picker first and then falls back to `isBlockEditable`.
- **`9F` is clearable** (`ENUM_CLEARABLE_BLOCKS`). "—" sends `''`, and the server clears the label and keeps the route.
- A stale list is still refused by the server, exactly as a mistyped name was, and the refusal names STEREO and the Strip.
- Not done: the route `description` as the option's `title`. `_buildEnumSelectCell` builds options from strings and was deliberately left untouched.

### 2. Three chains, computed at read (Q-L16-1, recommended option)

```
departure (Block 6,  filed.proposedDepartureTimeUtc): CONTROLLER > FLIGHT_PLAN > ATO
offBlock  (Block 17, assigned.taxiTimeUtc):           CONTROLLER > EST_DEPARTURE
takeoff   (Block 18, assigned.takeoffTimeUtc):        CONTROLLER > EST_OFF_BLOCK
```

`[SOURCE-DEFINED]`: the guide gives the shape of the chain, not its content.

- `CONTROLLER` is the chain's own field when it holds a number. `FLIGHT_PLAN` is `fdr.timeInputs.flightPlanDepartureUtc`. `ATO` is `fdr.ato.departure.timeUtc` (L14, contract C1). `EST_*` is another chain's answer.
- A controller's entry always wins and stops the fallback (§10.2 rule 3). Clearing it (`''` → `null`, F4) resumes the chain.
- For departure, the DD-1801 ranks above the ATO (Q-L16-6): the pilot's filing is the later and more specific document.
- `estimated` is true only for an `EST_*` source, which is a plan standing in for an actual that has not happened yet. Departure's own sources are all plans, so departure is never "estimated".
- **An estimate is always another source's value, never arithmetic on one.** No taxi or climb-out duration is added (D11).
- **Nothing is stored.** The inputs are stored and the answer is a pure function of them. "Record which source was used" is met because the answer is deterministic from recorded inputs. No writer has to remember to recompute anything. Above all, `assigned.taxiTimeUtc` and `assigned.takeoffTimeUtc` never hold an estimate that a later reader could mistake for an actual. `forwarding-obligations.js` keeps reading only what a controller entered.
- One pure module on each side: `crc-sync/src/efsp/time-chains.js` and `crc-desktop/app/public/js/panels/efsp/time-chains.js`. The two files are **byte-identical**, because the packages never share code (0001). `crc-sync/tests/fixtures/time-chains.json` holds both to the same answers, and each package's test also asserts that the two files are equal.
- The chains apply to DEPARTURE Strips only. On an ARRIVAL, Block `6` is the ETA.

### 3. The one new input: the DD-1801 departure time

- `flight-plan-lookup.js` `toFdrFiledSeed` adds `flightPlanDepartureTimeHhmm: plan.depTime || ''`.
- `createFdr` resolves it with `resolveZuluHhmm` against the mission clock into **`fdr.timeInputs = { flightPlanDepartureUtc }`**. A value that is not a time is dropped silently, because the lookup that supplies it is best-effort. The value is **not** written into `filed.proposedDepartureTimeUtc`, which stays the controller's field, so a cleared P-time falls back to the plan instead of losing it.
- `restore()` seeds `timeInputs` onto older FDRs, and both readers treat a missing `timeInputs` or `fdr.ato` as null (0052's lesson).

### 4. Display

- `ZULU_HHMM_BLOCKS` now covers every Block whose target is an epoch `…Utc` path, including `M6`/`M7`. A test derives the expected set from the Block Maps, so a time Block added later without `HHMM` formatting fails the test.
- For Blocks `6`/`17`/`18` on a DEPARTURE, `resolveBlockValue` returns the chain's value, `timeSource` and `estimated`. A value that comes from a chain is `provenance: 'COMPUTER_GENERATED'`.
- **An estimate is italic** (`.efsp-block-estimated`, H67). No colour is used, because 0056 reserves colour for something wrong. An estimate stays click-to-edit: typing the actual replaces it.
- **The source is on hover (§10.5's MUST).** Three places show it: the value cell of Blocks 6/17/18 (`blockValueHintFor`, one line in `_buildBlockCell`, which a refusal title still overrides), and the label of the expanded ▼ row (`blockTitleFor(blockId, fdr, strip)`, one line in `_appendExpandedView`). The hover text gives the Block's name, the value, and its source sentence, with `~` before an estimate. When a controller's entry is shown, it also gives what would apply if the entry were cleared. The label on the collapsed face is titled by `strip-view.js` from the FDR alone, so it carries no chain title: it cannot tell a P-time from an ETA, and the value cell beside it has the title anyway.

### 5. The vul window's typed times (S-F4)

- `mission.vulWindowStartUtc` and `mission.vulWindowEndUtc` join `TYPED_TIME_LABELS`.
- `normalizeTypedTime(path, value, nowMs, startMs)` resolves a `WINDOW_END_OF` path (the end) to the **first occurrence strictly after** the start (`zulu-time.js` `resolveZuluHhmmAfter`) when the start is a number. With no start, the end resolves to the nearest occurrence like any other typed time.
- Both `setField` and `createFdr` apply the rule. The ATO's epoch ms pass through untouched.

## Consequences

- A controller cannot type an unconfigured stereo name any more. The only remaining refusal is a stale list.
- The two e2e specs that provoked a refusal by typing `NOSUCH` into `9F` now type it into Block `6`. F4 made that a refusal (*"proposed departure time must be a UTC time as HHMM"*), so the findings keep their meaning.
- `playwright.config.js` gains an opt-in `E2E_STEREO_ROUTES=<file>`. Every other run still sees an empty table.
- L14's `fdr.ato.departure.timeUtc` feeds the P-time chain with no further change. L5 can bucket by `resolveTimeChain('takeoff', fdr)`.

## Left open

- **A state change that stamps a time** (TWR presses Airborne → takeoff time; Q-L16-3). No state change writes a time today, and adding one belongs to `board-store.js`. It is the next source for the takeoff chain, owned by L19/board-store.
- **The stale exit fix after an MTR designator change** (S-L2b). It needs a route table, and H23 keeps MTRs free text, so it is recorded as a gap.
- **Editing the vul start does not move an end already stored.** The end was resolved against the old start and stays as stored epoch ms. A start moved past its end is not refused.
- **Accepting an estimate as an actual** is a no-op edit: typing the same `HHMM` that the estimate shows sends nothing.
