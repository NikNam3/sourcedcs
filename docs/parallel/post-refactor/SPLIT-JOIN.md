> Amended for H100 (2026-10-01): Q-SJ1 (b), Q-SJ2 (any live IFR Strip; on the ground no assignment), Q-SJ3 (c), speed as a
> plain recorded assignment (DR-11 b). Q-SJ4 (a), Q-SJ5 (a) as recommended. The lane is slightly larger (see sizing).

# SPLIT-JOIN: formation split and join

> Read `docs/parallel/refactor/README.md` (conventions, **Test policy**) and `docs/parallel/lane-rules.md` first; they
> apply here except where this file says the refactor window is closed. Rulings: decisions.md **H85 (R3-52), H89, H90,
> H91**, H96/H98 (vocabulary), S-desk3, S-TEST. ADR: **0099** (draft `docs/wip/DES-SPLIT-adr-0099.md`, copy it to
> `docs/adr/0099-formation-split-and-join.md` in your first commit). Undo contract: ADR **0100** and `UNDO.md` in this
> folder. Design notes and the human's open questions: `docs/wip/DES-SPLIT.md`. **decisions.md wins over this file; the
> merged code wins over its file names.**

Written against the **post-refactor layout** (ARCH-plan §2.2) and the **post-RENAME vocabulary**: flight data (today
FDR / `fdr-store.js` / `fdrId`), strip type (Role), staffed (occupied), beacon code (squawk), `Interfacility*`
(`Peer*`). Today's behaviour is cited by symbol; step 0 re-finds each one.

| | SJ-S (server) | SJ-C (client) |
|---|---|---|
| Starts | cut from **UNDO-S's contract commit** (UNDO.md step 1), after RENAME (W7) and L20 merged | cut from SJ-S's **wire commit** (step 3) |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-SJ-S` on `lane/SJ-S-split-join` | `/home/nklx/dev/personal/sourcedcs-SJ-C` on `lane/SJ-C-split-join-ui` |
| ADR | 0099 (copies and finishes it) | none (0099) |
| Size / model | 1.25 lanes / Sonnet (ground states, wider eligibility and grants) | 0.5 lane / Sonnet |
| Merge | after UNDO-S | with or right after SJ-S |
| E2E lane | none (server-only) | `E2E_LANE=6` |

## Goal

`SplitFormation` turns one Strip with `flightSize` N into exactly two (k and N−k): the departing part gets a typed
callsign, a new beacon code, a copy of the plan and the IFR assignment (heading, speed or altitude; required unless the
Strip is on the ground, also on a return from MARSA). `JoinFormation` ends the joiner's Strip as `JOINED`, voids its flight data, releases its code and grows
the lead. Both are one audited op, one Board event, undoable through ADR 0100.

## Code as found (cite by symbol)

- `identity.flightSize` (integer ≥ 1, default 1) on the flight data, set by `createFdr`'s seed, the ATO tasking and
  `setField` (`WRITABLE_PATHS`). `correlation-match.js` `AFFINITY_FORMATION` reads formations by callsign stem.
- `createFdr` mints the code with `CodeAllocator.allocate(fdrId)` (rotating cursor, ADR 0081) after every refusable check;
  `releaseFdr`, `reacquireFdr` (D23: never steals), `archiveFdr`.
- Clearance (ADR 0058): `CLEARANCE_FIELDS = {altitude, heading}`, `setClearance`, cells of entries ACTIVE / SUPERSEDED /
  STRUCK, `parseAltitude`, `parseHeadingDeg`. ARRIVAL's `9A-SPEED` is a Strip annotation; DEPARTURE's Block map has no
  heading or speed Block; OVERFLIGHT has `7A` and `9A-VECTOR`. `nla.js` `STATES_BY_ROLE` is the state list the new
  eligibility and ground-state keys are checked against.
- `_applyCreateStrip` (placement after the Rack's last Strip, `DEFAULT_INITIAL_STATE_BY_ROLE`, the Strip literal);
  `_retireStrip` (the one path to DROPPED: TOFI ACTIVE refusal, remove indicator, `_releaseFdrIfLastStrip` → code and
  `retireMarsaForFdr`, `carrierRetireFlight`, `receiveCoordinationPeerGone`).
- `_recordAudit`: one entry per successful Mutation with the addressed Strip's `before`/`after` and op extras.
- `traffic-count.js`: `isDropTransition`, `isUndoOfDrop`, pure `countability(before, after)`,
  `COUNTABLE_PRE_DROP_STATES` (a test holds it to every strip type), `_buildRecord` freezes `flightSize` from the flight
  data at the drop and sets `formation: flightSize > 1`.
- `correlation-store.js` `retireFinished` ends the correlation of a flight data record with no live Strip.
- Name clash to avoid: "the AR join" (ADR 0071, `arJoinFor`) is the tanker join under MARSA. The ops are
  `SplitFormation` / `JoinFormation`; UI labels "Split" / "Join formation".

## Owns

**SJ-S:** new `crc-sync/src/efsp/board/ops/split-formation.js` and `board/ops/join-formation.js` (each with its `undo`
scope per UNDO.md's contract), their one line each in `board/strip-ops.js`'s table, and the retirement call's
`{ endReason, joinedInto }` option in `strip-ops.js`; the flight-data store (`createSplitFlightData`, `voidFlightData`,
`clearance.speed` and its parser, `identity.splitFrom`, `voided`); `block-map.js` (the assignment Blocks of ADR 0099 §3);
the authority registry's strip-type families (`splitEligibleStates`, `joinEligibleStates`) and Position families
(`FORMATION_OP_KINDS` grant); `traffic-count.js` (`stripChangesOf`, `JOINED`, `splitFromFlightDataId`, widened
`isUndoOfDrop`); `tests/formation-*.test.mjs`; `docs/adr/0099-*.md`; `docs/wip/SJ-S.md`.

**SJ-C:** a new popover module for the Strip menu's "Split…" form and "Join formation…" picker (post-ESM-2a
`js/panels/efsp/bay/popovers/formation.js`) and its one registration line; the `.split` / `.join` verbs in the panel's
dot-command handler; the strip template rows for the new Blocks (`strip-template.js`); a `SPLIT` lineage chip in the
indicator row; the client flight-data mirror of `clearance.speed`; `crc-desktop/tests/efsp-formation-*.test.mjs`; new
`e2e/efsp-formation.spec.js`; the split/join section of `docs/efsp-usage-guide.md`; `docs/wip/SJ-C.md`.

## Frozen for you

`undo/undo-history.js`, `board/ops/undo.js`, the restore code and `metrics.js` (UNDO-S: it adds `formationSplits` and
`formationJoins`); `board/coordination.js`, `board/tofi.js` and control-release ops (release+TOFI lane); the airspace
registry (AIRSP phase 2); every other op module. One line elsewhere: ask "main".

## Design (ADR 0099 is the spec)

1. **Split** in the order of ADR 0099 §1 (assignment required unless the Strip state is in the family's `groundStates`;
   `marsaReturn` is a label only): every gate before any write (the code is allocated last among the checks and
   first among the writes, so a refusal leaks nothing); new flight data by copy; the assignment as a clearance entry;
   lead size N−k; the new Strip after the lead; one audit entry (`records`, `split`); one Board event.
2. **Join** per §2: both owned by the acting Position; the joiner's flight data with no other live Strip anywhere;
   retire through the one retirement path with `endReason: 'JOINED'`; `voided` on its flight data; lead size grows;
   a mixed-type warning in the ack; addressed Strip = the joiner.
3. **Undo scopes** (UNDO.md contract): Split → lead Strip, lead flight data, `created` = new Strip, new flight data,
   new code. Join → both Strips, both flight data records, the joiner's code, the joiner's MARSA relations.
4. **Traffic count** per §5: a split part counts as its own flight with lineage; `JOINED` is excluded; aircraft are
   conserved; `stripChangesOf(entry)` is the one reader of `records`; `isUndoOfDrop` VOIDs a COUNT for any Strip in
   `stripChangesOf` that leaves DROPPED or is removed.
5. **Answers (decisions.md H100; follow them, not the earlier defaults):** Q-SJ1 (b) the assignment is required on a return
   from MARSA too (no exemption; the new code is still allocated; `marsaReturn` is an audited label); Q-SJ2 any live
   DEPARTURE, ARRIVAL or OVERFLIGHT Strip may split or join (every state but `DROPPED`), on the ground (the per-family
   `groundStates`: DEPARTURE `PROPOSED`..`LUAW`, ARRIVAL `LANDED`, `TAXI_IN`) a split needs no assignment; never MISSION or
   the carrier Strips (MARSA records nothing, carrier control is its own regime: H100 did not change this); Q-SJ3 (c) every
   ATC Position (civil-ATC and Incirlik-military families); Q-SJ4 (a) a split part is its own flight; Q-SJ5 (a) the acting
   Position owns both Strips (and any split is on a Strip it owns).
   **Speed (DR-11 b):** `clearance.speed` is a recorded assignment only (no conformance, no control axis); it exists
   because a split can be by speed, and the DEPARTURE/OVERFLIGHT/ARRIVAL display Blocks exist so the assignment is visible
   (ADR 0099 §3 says what was kept and what was dropped).
6. **UI (SJ-C)**, text sketch:
   - Strip menu, group "Formation" (shown when the Strip is split- or join-eligible, the Position holds the grant and owns the Strip):
     **Split…** opens an inline form in the popover: `Leaving [1]` (stepper 1..N−1, shows "of 4, 3 remain"),
     `Callsign [______]` (required, upper-cased), `Assignment ( ) Heading ( ) Speed ( ) Altitude [____]`, `[ ] Back
     from MARSA` (audited label; the assignment stays required), `[Split]`. On a ground Strip (`groundStates`) the
     Assignment row is hidden and the split needs none. Refusals show inline.
   - **Join formation…** lists this Position's join-eligible Strips on the Board (callsign, size) as the lead; one click
     sends `JoinFormation` (no confirm: Undo covers it, ADR 0100).
   - Dot-commands on the selected Strip: `.split <k> <CALLSIGN> <H270|S250|SM.80|A120|FL240>` and `.split <k>
     <CALLSIGN> <assignment> MARSA` (a MARSA return, assignment still required) and, on a ground Strip, `.split <k> <CALLSIGN>`; `.join <LEAD-CALLSIGN>`.
   - The new Strip shows a `SPLIT` chip (title "split from VIPER1 at 1432Z"); a joined Strip leaves the Board like any
     drop. Both ops' acks fill UNDO-C's undo slot.

## Steps

0. Install, record suite counts, "Code as found" in `docs/wip/SJ-S.md` (every symbol above re-found; the flight data
   paths you will copy, one by one, with copy / reset / new for each). SendMessage "main" when done.
1. `clearance.speed` + parser + Block-map entries; eligibility keys and the grant, with their completeness tests.
2. `SplitFormation` (flight-data copy first, then the op), then `JoinFormation`.
3. Audit `records`, wire (op kinds, Strip and flight-data fields). **Tell "main" the commit id**: SJ-C is cut from it.
4. Traffic count; undo scopes enabled against UNDO-S; ADR 0099 finished; report.

## Tests (S-TEST: file-scoped while working; both unit suites, `soak:selfcheck` once before the report; no Playwright)

`crc-sync/tests/formation-*.test.mjs`, real stores, fake mission clock:

| # | Scenario | Expect |
|---|---|---|
| S1 | 4-ship splits 2 by heading 270 | new Strip after the lead, same type/state/owner/Bay; new flight data with copied plan and mission, typed callsign, size 2, new code ≠ lead's, heading 270 ACTIVE; lead size 2; one audit entry with `records` and `split` |
| S2 | refusals: k 0, k N, N 1, no callsign, lead's callsign, no assignment, bad value, ineligible state, TOFI ACTIVE, coordination PROPOSED, not owner, no grant, code pool exhausted | each its reason; allocator and stores unchanged |
| S3 | MARSA return (a) without assignment, (b) with one | (a) refused `ASSIGNMENT_REQUIRED`, nothing allocated; (b) applied, code allocated, `marsaReturn: true` audited |
| S4 | split by speed `250` and `M.85`; by altitude `FL240` | `clearance.speed` / `altitude` entries |
| S5 | split twice (4 → 2+2 → 1+1 on one part) | three Strips, sizes 2, 1, 1, three codes |
| S6 | lead with an ACTIVE Interfacility replica | replica reads size N−k through the flight data; no replica of the new part |
| S7 | join 2 into 2 | joiner DROPPED `JOINED`, flight data `voided`, code released, MARSA relation ended, lead size 4, one audit entry |
| S8 | join refusals: different owners, joiner with a live Strip at another Facility, open exchange, same Strip, stale rev | each its reason, no change |
| S9 | count: 4 departs, splits 2+2, both land; and 4 splits, rejoins, lands | 2 flights / 4 aircraft with lineage; 1 flight / 4 aircraft, the joiner `JOINED`; reconciliation total |
| S10 | Undo of a split; of a split whose part B dropped meanwhile | part `gone`, code free, lead restored; COUNT VOIDed |
| S11 | Undo of a join; with the joiner's code taken meanwhile | joiner restored, flight data un-voided, code re-acquired; D23 warning |
| S12 | archive: the joined Strip after 2 h | archived with its voided flight data |
| S13 | correlation: the joiner's correlation | ended by `retireFinished` |
| S14 | tables | every strip-type family declares both eligibility keys and `groundStates`; every state of `STATES_BY_ROLE` is ground, airborne or DROPPED |
| S15 | eligibility (H100 Q-SJ2): split and join for each IFR type in an airborne and a ground state; MISSION, MARSHAL, FINAL, PATTERN, `DROPPED` | all IFR live states accepted; the excluded types and DROPPED refused with the reason |
| S16 | ground split (DEPARTURE `TAXI`, ARRIVAL `TAXI_IN`) without an assignment; the same on an airborne state | applied, new code, no clearance entry, no takeoff stamp on the part / refused `ASSIGNMENT_REQUIRED` |
| S17 | grants (H100 Q-SJ3 c): every civil-ATC and Incirlik-military Position on a Strip it owns; the same Position on another's Strip; a tactical (MRU) and a carrier Position | accepted / `PERMISSION_DENIED` / `PERMISSION_DENIED` |
| S18 | speed (DR-11 b): split by `250` and `M.85` on DEPARTURE, ARRIVAL, OVERFLIGHT; then a contradicting track speed | entry recorded and shown in the Block; no alert, no conformance record |

SJ-C: pure tests for the form's validation and the dot-command parser (`.split 2 VIPER3 H270`, `.split 1 VIPER2 H270 MARSA`, `.split 1 VIPER2` on a ground Strip,
`.join VIPER1`, bad input), the template rows, the chip. Playwright: only `e2e/efsp-formation.spec.js` (split, see two
Strips; join, see one) and the panels you changed, on `E2E_LANE=6`. Never the full suite.

**Goldens:** the refactor window is closed, so the freeze suite is opt-in and not maintained (S-desk3, ARCH §3.1). Do
not run or re-record it. If it is still part of `npm test` on your base, stop and ask "main".

## Acceptance

ADR 0099 committed and marked Built; S1–S18 green; both unit suites green; `soak:selfcheck` all detectors fire (you
touch `board/**`); `board-seam` strict on your new files; the report lists the copy/reset table for flight data paths,
answers followed (H100), and what AIRSP phase 2 must do on split/join (occupancy).
