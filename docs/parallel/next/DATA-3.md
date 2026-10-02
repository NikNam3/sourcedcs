# DATA-3: the data follow-ups DATA-2 left (S-DATA2-0, S-M-W3a)

> Read `README.md` in this folder, `docs/parallel/refactor/README.md` (conventions, **Test policy**),
> `docs/parallel/refactor/DATA-2.md` and `docs/wip/DATA-2.md` (the inventory) first. Rulings: decisions.md **H84
> R3-72 + S3-6** (JSON is the single source for data; "no magic values in code except UI code"), **H88** (split by
> kind: facility data and tunables → JSON; doctrine tables → code, in the authority registry; engineering constants →
> named constants), **P5** (tuning files are read once at startup, never written by code), **S-DATA2-0** and
> **S-M-W3a** (what DATA-2 did not move, and why), H84 **R3-44** (carrier types and unit names are data the human sets;
> no hard-coded UNION), **R3-53** (the human supplies a comm card), **H31** (approach buttons: validated integer, no
> defaults until the squadron's buttons are supplied), H13 (every theater comes eventually), S-desk3. The window is
> closed: no golden upkeep. Each data move is still its own `behaviour(DATA-3)` commit, so it can be reviewed and
> dropped alone.

| | |
|---|---|
| Wave | A |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-DATA-3` on `lane/DATA-3-data-followups` |
| ADR | none (0095 §5 and ADR 0058's P5 note cover the rule). The comm-card schema is described in the file's `_comment` and in the wip |
| Size / model | 1 lane / Sonnet 5.5 |
| E2E lane | none (server-only; the comm card has no UI yet) |

## Items (re-find each by symbol at step 0; line numbers are from `99c9577`)

1. **`ANGLED_DECK_BY_TYPE` → the carrier hull JSON.** `src/efsp/carrier/ship-state.js` ~46 holds `{CVN_71..CVN_75: 9}`
   (`[SOURCE-DEFINED]` comment ~24), exported through `carrier/index.js` (~55, ~137). `config/efsp-carriers.json`'s
   `_comment` says `angledDeckDeg: null takes the per-type table in carrier/ship-state.js`.
   - Target: every hull in `efsp-carriers.json` states `angledDeckDeg` (a number, 0 for a straight deck). The schema
     requires it, and the per-type table and its export go.
   - This is the API change S-DATA2-0 named: the ship-state function that looked the type up takes the hull's value.
     Re-find the callers.
   - R3-44 holds: the hull list is data the human sets. Ship the values that exist today, mark them
     `[SOURCE-DEFINED]` in `_comment`, and put them on the "squadron to verify" list in the wip.
2. **Field radars' specs and heights → `sensor-specs.json`.** `src/radars.js`:
   - `AIRPORT_RADAR_HEIGHT_M = 15`, `SHIP_RADAR_HEIGHT_M = 40`, `AIRPORT_RADAR {rangeNm 40, sweepMs 2000}`,
     `APPROACH_RADAR {rangeNm 80, sweepMs 3000}`, `CVN_APPROACH_RADAR {rangeNm 50, sweepMs 4000, heightM 45}` (~37-48);
   - `sensor-specs.json` already holds `presentation`/`defaultCaps` per kind (`airport`, `approach`,
     `carrierApproach`, …), `shipRadarDefault` and `carrierRadar`.
   - Target: a `fieldRadar` block (`airport`, `approach`, `carrierApproach`: `rangeNm`, `sweepMs`, `heightM`) plus the
     ship antenna height, read once via `tuning-file.js` and validated. A missing key is a startup error naming file
     and key, as DATA-2 did.
3. **Datalink `|| 4000`** (`src/surveillance/datalink.js` ~46, `this._period = (config && config.pliPeriodMs) ||
   4000`). `sensor-specs.json` `datalink.pliPeriodMs` is 4000 already.
   - Remove the fallback and validate at load.
   - Do the same for every other `|| <literal>`/`?? <literal>` fallback on a tuning read in `src/surveillance/**` and
     `src/radars.js`. Step 0 lists them; `transponder.js` ~72 `|| ['own', 'neutral']` is one.
4. **The synthetic code block.** `src/efsp/code-allocator.js` ~47-48 `SYNTHETIC_BLOCK_START = 0o6000`, `SIZE =
   0o1000` (`[SOURCE-DEFINED]`, ADR 0059). `src/surveillance/transponder.js` mints from that block. The refusal text in
   `code-allocator.js` ~115 and `ato/ato-board.js` ~308 spells "6000–6777".
   - Target: `sensor-specs.json` `transponder.syntheticBlock: { first: "6000", last: "6777" }` (octal strings, as
     codes are written).
   - It is read by both modules, and the refusal and warning texts are built from it.
   - `RESERVED_CODES`/`MONITOR_SET` stay in code: they are doctrine (H88).
5. **Approach types and button range: the comm-card schema and loader (R3-53, H31).**
   `src/efsp/carrier/flight-record.js` ~38-40 has `APPROACH_TYPES` `['TACAN','ICLS','ACLS','PAR','VISUAL']`,
   `APPROACH_BUTTON_MIN = 1`, `MAX = 20` (all `[SOURCE-DEFINED]`). Build **the schema and the loader only**: the human
   supplies the data later.
   - New `config/comm-card.json`, read once (P5), with a `state/` layer as `tuning-file.js` allows:

     ```
     { _comment, approachTypes: [...today's five],
       approachButtons: { min: 1, max: 20, buttons: [] },
       frequencies: [] }
     ```

     Each frequency is `{ id, name, mhz, use }` with `use` one of a small enum you define and document (`approach`,
     `tower`, `ground`, `departure`, `atis`, `other`). The list is empty now and has no consumer yet.
   - A loader with a validator, in `src/comm-card.js` or under `src/efsp/carrier/`, your call.
   - `flight-record.js` reads approach types and the button rule from it. With `buttons` empty, validation is today's
     integer range. Once the squadron's list is there, it is membership in `buttons[].button`. The refusal text names
     the source.
   - Tests cover both modes, plus a missing file → startup error.
   - The human fills the file later in a data-only commit. Write the exact shape they need into the wip, plus a
     filled example (fake values, marked as such) in the test fixtures, not in `config/`.
6. **The weather reference point 41/41 → `theaters.json`.** `src/grpc-client.js` ~111 `this._weatherRef = { lat: 41.0,
   lon: 41.0 }` is used by the atmosphere poll (~290) until mission data replaces it with the first airport (~172).
   On Syria (or any theater) the first polls before mission data read the wrong place.
   - Target: each theater in `config/theaters.json` gets `weatherRef: { lat, lon }` (`[SOURCE-DEFINED]`: a point near
     the theater's centre; list them for the squadron to verify).
   - Until a theater is known, the poll **does not run**. The client keeps ISA, as it does today before the first
     answer.
   - Once the theater is known, the poll uses its `weatherRef` until the first airport, then the airport, as today.
   - This is a `behaviour(DATA-3)` commit: the first minute of weather after start differs.
   - `theaters.js` validates the field. `state/theaters.json` overrides follow its existing field-by-field rule.
   - **2S-B also edits `grpc-client.js`** (`_getDrawings`). Touch only the constructor line, the poll function and the
     mission-data hook.
7. **Duplicated engineering constants → one named home.** New `src/units.js` (engineering constants only, H88; the
   name is your call):
   - **ISA** ×2: `src/altimetry.js` ~11-16 and `src/grpc-client.js` ~25-31. `altimetry.js` stays the owner and exports
     them; `grpc-client.js` imports them. ESM-GUARDS' client parity test reads `altimetry.js`, so keep the names.
   - **`MS_PER_KT`** ×3: `conflict-alert.js` ~29, `efsp/conformance.js` ~37, `efsp/airborne.js` ~21.
   - **`DAY_MS`** ×6 (the task said ×5; there are six now): `theater-context.js` ~21, `efsp/metrics.js` ~57,
     `mutation-log.js` ~34, `zulu-time.js` ~20, `ato/ato-board.js` ~38, `traffic-count.js` ~39. Add `HOUR_MS` if
     `metrics.js` derives from it.
   - **Leave `efsp/metrics.js` alone.** UNDO-S and AIRSP-2S-A edit it in this wave. List it as a one-line follow-up for
     the supervisor at their merge.
   - Every other site is a one-line hunk: the `const` line becomes an import, so a concurrent lane's merge stays
     trivial.
8. **`tools/soak/report.js` copies by hand** (~18-23): `maxKeyLen: 40` (`order-key.js` `REBALANCE_KEY_LENGTH`),
   `logRingMax: 2000` (`sync/sync-log.js` `RING_MAX`), `appliedMax: 5000` (`sync/replay-cache.js`
   `APPLIED_MUTATIONS_CAP`).
   - `require` them instead, exporting them from their modules if they are not exported yet. Those export lines are
     the only edits in those three files.
   - Do not change soak judgement.
   - Run `soak:selfcheck` once: `sync/**` is on its trigger list.

## Owns

- Code:
  - `src/efsp/carrier/ship-state.js` and `carrier/index.js` (the export);
  - `src/radars.js`, `src/surveillance/{datalink,transponder}.js` (the fallbacks and the synthetic block);
  - `src/efsp/code-allocator.js` (the block constants and the refusal text only), `src/efsp/ato/ato-board.js` (the
    warning text line and `DAY_MS`);
  - `src/efsp/carrier/flight-record.js` (the approach rule) and the new comm-card loader;
  - `src/grpc-client.js` (constructor `_weatherRef`, the poll, the mission-data hook, the ISA imports),
    `src/theaters.js`;
  - `src/units.js` (new);
  - the `DAY_MS`/`MS_PER_KT` lines of the files listed in item 7 (not `metrics.js`);
  - the export lines in `order-key.js`, `sync/sync-log.js`, `sync/replay-cache.js`; `tools/soak/report.js`.
- Config: `config/{efsp-carriers,sensor-specs,theaters}.json` and new `config/comm-card.json`.
- Tests: the matching unit tests, plus new tests for each loader and validator.
- `docs/wip/DATA-3.md`, including the "squadron to verify" list: angled-deck values, field radar figures, weather
  reference points, comm-card shape.

## Frozen for you

- `efsp/metrics.js` (UNDO-S, 2S-A), `traffic-count.js` beyond its `DAY_MS` line (SJ-S later), `grpc-client.js`
  `_getDrawings` (2S-B), `carrier-store.js` (UNDO-S).
- Facility JSONs (`efsp-facility-*.json`; never a `_comment` key there).
- The authority registry (doctrine stays code).
- Everything client-side: UI literals are exempt (S3-6).

## Steps

0. Step 0 per the refactor README:
   - each item's code as found, its JSON twin if any, every reader, and every test that pins the literal;
   - the full list of tuning-read fallbacks (item 3);
   - the duplicated-constant sites (re-grep; the counts above are a floor).
   - Say for each item whether a value exists only in code.
1. One commit per item, items 1-6 as `behaviour(DATA-3): …` (values identical unless the item says otherwise). Each
   one: the JSON complete, the literal gone, validation at load, the tests. Run the touched test files after each.
2. Items 7-8 as `refactor(DATA-3): …`.
3. Both unit suites once, `soak:selfcheck` once (item 8 touched `sync/**`), and optionally `npm run freeze` once: say
   which traces moved (item 6 may move none, because the freeze harness has no gRPC).

## Acceptance

- `git grep -n -E "ANGLED_DECK_BY_TYPE|SYNTHETIC_BLOCK_START|APPROACH_BUTTON_MAX|41\.0, lon: 41\.0|\|\| 4000"`
  finds nothing in `crc-sync/src`.
- One definition each of `DAY_MS`, `MS_PER_KT` and the ISA constants, `metrics.js` excepted and listed.
- `report.js` copies no number.
- Every new JSON field is validated at load. A missing or invalid one stops start-up naming file and key, with no code
  writing config (P5).
- Both suites and `soak:selfcheck` pass.
- The wip carries the squadron-to-verify list and the comm-card shape for the human.

## Defaults (P2)

- Weather before the theater is known: no poll (not 41/41, not "first airport of any theater").
- The comm card lives in `config/` as a tuning file with a `state/` override, not in the facility JSON. It is
  squadron-wide data, not per Facility.
- A carrier hull without `angledDeckDeg` is a load error, with no type fallback.
