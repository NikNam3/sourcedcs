<!-- The step 0 questioner's page-by-page evidence (28 Oct 2026). Page indices are 0-based. Every question was settled as rulings R1-R14 in docs/wip/TOLD-STEP0.md ("Questioner rulings"). The scripts and renders it mentions were scratch files and are not kept. -->

# TOLD step 0: questions for the implementer lanes (questioner, 2026-10-28)

Each question has a recommended default, so a lane can proceed without live chat. Page indices are 0-based.
The evidence scripts and renders (`words.py`, `spans.py`, `p258.png` … `p264.png`) were scratch files and are not kept.

## Q1 (Task 3): Extracted curves end a hair inside the frame, so Review Focus 1 fails on real data under Task 3's `interp` rule ("undefined outside [first input, last input]"). Does a building block get an edge tolerance?

Evidence:
- Task 6's committed `B2-1.json` (lane/told-t6, 6d07e3bf): every PA curve runs from temperature **−39.9996** to 50.0016. Exactly −40 °C, the chart's bottom edge, is below `first` and gives `OutOfChart`.
- Prototype B2-3 `gw` curves (the same geometry Task 7 will extract): every curve starts at TOF **0.9995** and the eight lighter ones end at **6.9996**. "TOF exactly 7", the Review Focus 1 example, gives `OutOfChart`. The cause is the frame line at y 136.3, against the fitted TOF 7 at y 136.28.
- Guideline lines in the prototype show the same: DI lines start at **0.055** (baseline 0), CG at 29.999, wind at 0.003, and tailwind lines end at **19.989** (drawn to 20 kt). So a 20 kt tailwind, which is on the drawn end, would be refused.

Options:
- (a) Tolerance in the building blocks. `interp` accepts x within `EDGE_TOLERANCE × span` of an end and **clamps** to that end's value. `span` is the panel's drawn input span: the union over all curves of a family, all lines of a guideline panel, or the single curve. `drawnRange` still reports the measured ends.
- (b) The extractor snaps a curve end to the tick or frame value when it lies within ε pt of a frame or grid line. Task 6 is done, so this means a re-extract, and it does not cover the tailwind ends (they stop at a grid line inside the panel).
- (c) No tolerance; drop Review Focus 1's TOF 7 example. That would refuse −40 °C and a 20 kt tailwind, both printed values.

**Recommended:** (a) with **one** constant, `EDGE_TOLERANCE = 0.002`, used by `curveFamily`, `singleCurve` and `guidelinePanel`. It replaces `BASELINE_TOLERANCE` (see Q2). The largest shortfall found is 0.055 of DI's 400 (0.014 %) and 0.011 kt of the wind panel's 40 (0.03 %), so 0.2 % covers every case found with 7× margin. The clamped "extrapolation" it allows stays at most 0.2 % of a panel, far inside the 2 % sample tolerance. Add Task 3 tests: an input exactly `tolerance/2` beyond an end reads the end value, and `2 × tolerance` beyond it gives `OutOfChart`. Add one Task 9 test each: B2-1 at −40 °C reads, and B2-3 at TOF 7.00 with GW 20 reads.

## Q2 (Task 3): `BASELINE_TOLERANCE = 0.02 × param span` is 10× larger than any shortfall, but the plan does not say how a line is evaluated beyond its end. "Param span" and the order of the target-equals-baseline check are also undefined.

Evidence:
- The prototype engine uses `0.02 * max(|hi - lo|, 1)` per **line** and then extrapolates linearly (`interp1`). The prototype extractor uses 0.02 × the **axis label** span. Task 3 says "the panel's param span" without saying which.
- On the wind panel, 0.02 × 40 kt = 0.8 kt. The tailwind lines end at 19.989 kt, so a 20.7 kt tailwind would pass "covers the target". Task 3's `interp` then returns `undefined` there, so one implementer clamps (reading 20 kt: optimistic, a shorter distance) and another extrapolates. Neither follows the "never extrapolate" rule.
- Task 3's tests say "target equal to baseline returns entry" and "entry outside the outermost lines → OutOfChart", without saying which check comes first. They differ for an entry below the lowest line (1,000 ft, see Q12) with CG 35 % or DI 0.

**Recommended:**
- The span is the union of all lines' params in the panel, all families together: CG 30–40, DI 0–400, slope 0–2, wind 0–40.
- A line is usable when it covers baseline and target within `EDGE_TOLERANCE` (Q1). The read clamps into the line's drawn ends.
- `target === baseline` returns `entry` before any line check. This matches Task 9's "zero slope or wind skips the panel" and Review Focus 4.
- Keep everything else in Task 3's rule.

## Q3 (Task 2/3/6): `ScalePair` has no drawn range, and `scalePair()` returns a bare number. Yet B2-1's MAX AB scale is drawn only to AB 3.79 while the MIL curves reach 6.85, which maps to AB 3.90. Does the AB scale give `OutOfChart`?

Evidence:
- p283: the AB scale's baseline runs from x 153.58 to 489.15 pt, and its last tick is at 489.15. With Task 6's fitted `tof_ab` axis (a 101.970, b 102.267), that is AB **0.50 to 3.79**.
- The MIL axis spans 1–7, and the mapping AB = 0.5563·MIL + 0.0880 reaches 3.79 at **MIL 6.66**.
- Task 6's `B2-1.json`: the 10,000 ft curve ends at MIL **6.85** (50 °C), so hot days at 9,000–10,000 ft read a MIL factor whose AB value has no printed scale.
- The lower end is safe: the lowest MIL value (1.68) maps to AB 1.02.
- The Global Constraint says building blocks never extrapolate. The committed schema (Task 2, merged) has no range on `ScalePair`.

Options:
- (a) Add `range: [lo, hi]` (in `to` units, the drawn scale's first and last tick, which the extractor measures from the scale line) to `ScalePair`. Then `scalePair(p, figure, from): Read<number>` gives `OutOfChart` on `to.name` outside it, with the Q1 tolerance. This takes a schema change (Task 2 merged), a regenerated `types.ts`, and a re-extract of B2-1 (Task 6 merged).
- (b) Keep the number and have b2-1.ts check `tofAb` against a literal 3.79. That puts chart data in code.
- (c) Accept the extrapolation: about 0.1 TOF at most, only at PA ≥ 9,000 ft and above 40 °C.

**Recommended:** (a). Do it in Task 3's lane as one commit: the schema field, `types:gen`, the extractor's scale-pair panel measuring the scale line's ends (`geom.py`), and a re-extract of B2-1 per Task 6 Step 6. Task 3 already changes the `scalePair` signature. If the supervisor wants Task 3 to stay pure TS, give the schema and extractor part to Task 7, which re-runs the extractor anyway. Why: it is the only place in step 0 where a printed limit would be silently exceeded.

## Q4 (Task 9, 7): The sample-problem inputs in TOLD.md 0.6 match the manual, but the Part 2 text gives three more answers that the specs leave out. Add them?

Evidence (p278, p279, printed B2-2/B2-3; text read with `\x06` mapped to `-`):
- B2-1, p278: "A. Runway temperature = 40°C, B. Pressure altitude = 2000 feet, C. MIL takeoff factor = 3.16, D. MAX AB takeoff factor = 1.85". This matches.
- B2-2, p279: "GW = 33,000 pounds, CG = 37.0 percent, Takeoff speed at 35.0 percent CG = 170 KIAS, … 170 − (0.8 × 2.0) = 168 KIAS, Rotation speed: Non AB = 158, AB = 153". This matches. The chart notes on p284 state the rules verbatim: "ROTATE AT 10 KNOTS LESS THAN COMPUTED TAKEOFF SPEED FOR NON-AB", "15 KNOTS … FOR AB", "INCREASE TAKEOFF SPEED 0.8 KNOT FOR EACH 1% FORWARD OF 35% MAC", "DECREASE … AFT", "INCREASE … 8 PERCENT FOR … 8 DEGREES PITCH ATTITUDE". So `vto = vto35 − 0.8 × (cg − 35)` is right, sign included.
- **B2-2 at 8°**, p279: "168 × 1.08 = 181 KIAS, Rotation speed: Non AB = **171** KIAS, AB = **166** KIAS". This confirms the plan's order (CG correction, then ×1.08, then −10/−15). Task 6's `B2-2.yaml` second sample only expects `{vto_kias: 181}`.
- B2-3, p279: "Non-AB takeoff factor = 3.16, GW = 33,000, CG = 37.0, Drag index = 150, Slope = 1 percent (uphill), Wind 10 knots (headwind), Takeoff distance = 4243 feet. Using an AB takeoff factor of 1.85, takeoff distance is 2384 feet. … Non AB 4243 × 1.18 = 5007 feet, **AB 2384 × 1.18 = 2813 feet**". The plan has only 4,243, 2,384 and 5,007. The panel order in the text is GW, CG, DI, slope, wind, which matches Task 7.

**Recommended:**
- Task 9 extends B2-2's 8° sample to `{vto_kias: 181, vr_mil_kias: 171, vr_ab_kias: 166}`. This is a spec-only edit: samples are not in the data JSON, and Task 6's manifest logic keeps the manifest byte-identical on a re-run with unchanged data.
- Task 7 adds B2-3's fourth sample: AB TOF 1.85 with the same inputs and `pitch_8deg: true` → `{distance_ft: 2813}`.
- Update the TOLD.md 0.6 table (B2-2: "181 at 8° pitch, rotation 171/166"; B2-3: "2,813 ft AB at 8°").
- No other mismatches were found, and no erratum is needed for B2-1 to B2-3.

## Q5 (Task 8, also 6/7): The PDF encodes every hyphen as the control character `\x06`, so `"B1-1" in p.get_text()` finds nothing, and `get_text("words")` drops hyphens from table cells. How do lanes match and normalise text?

Evidence:
- `get_text()` on pages 258–264 gives `Figure B1\x061.\x05(Sheet 1)`. The hyphen is `\x06` and the space is `\x05`. A en-space inside a cell is `\x03` (p263, SUU-20 weight `474\x03420`). Page footers read `B1\x066`. Task 8 Step 1's find command (`"B1-1" in p.get_text()`) returns `[]`. A loose `B11` match also hits the page numbers B1-10, B1-11.
- `get_text("words")` treats `\x06` as whitespace. `AIM-9 LAUNCHER` comes out as the words `AIM`, `9`, `LAUNCHER`, `F-16C**` as `F` + `16C**`, `300-GALLON` as `300` + `GALLON`, and `-117/A` (p260, rack) as `117/A`, which loses the leading hyphen. If cells are joined "by one space" as Task 8 says, the result is `AIM 9 LAUNCHER`, `LAU 88/A + WEAPON PYLON*`, `JP 8`.
- `get_text("dict")` spans keep it: `'AIM\x069 LAUNCHER (16S210)'`, `'AGM\x0665A, B'`, `'\x0688/A, A/A, \x06117/A,'`.
- The B1-1 sheets are pages **258–264** (sheet 1 = 258, printed B1-6 … sheet 7 = 264, printed B1-12).
- On the chart pages (283–285), the chart artwork uses a real `-` (`-10`, `F110-GE-129`, `FIGURE B2-10` in the B2-2 notes), so the prototype's asserts pass. The page frame still uses `\x06`, though: the running head `GR1F\x0616CJ\x061`, the caption `Figure B2\x063.` and the printed page number `B2\x069`. A `must_contain: ["Figure B2-3"]` or a printed-page check against the text layer would fail.

Options:
- (a) Build words from `get_text("rawdict")`/`"dict"` characters after a fixed map `\x06 → '-'`, `\x05`/`\x03`/`\t` → space, then split on spaces. Apply the same normalised text to `must_contain` and axis titles.
- (b) Keep `get_text("words")` and repair afterwards. This cannot work: the gap left by a lost hyphen looks like any other word gap.

**Recommended:** (a). Put one `page_text(page)` / `page_words(page)` helper in `geom.py`. Task 6 has landed without it, so Task 8 adds it, and Task 7 uses it if a title needs it. B2-1 and B2-2 need no re-extract because their strings carry no hyphen. It applies the map `{'\x06': '-', '\x05': ' ', '\x03': ' ', '\t': ' '}`, so `must_contain` and `title` are written in the spec with normal hyphens. Task 8 Step 1 uses the page list above (or `re.search(r'Figure B1-1\.\s*\(Sheet (\d)\)', page_text(p))`). Why: store names are keys that step 1's drag index builder shows to pilots, so `AIM 9L` instead of `AIM-9L` is a visible data defect, and `-117/A` → `117/A` changes the meaning.

## Q6 (Task 8): Every store sheet has rows that span several printed lines, group headers and blank (row-spanned) key cells. Task 8's "one line = one row, no null key" format fails on sheets 1, 2, 3, 4, 5, 6 and 7. What row rules does the format get?

Evidence, per sheet (y in PDF points):
- **Sheet 1 (p258)** has three tables (operating weight, drag index, expendables). The expendables table has group lines with no values (`EXTERNAL USABLE FUEL:`, `GUN AMMO:`). `JP-8` belongs to a brace spanning three rows but sits in the name column on the 300-gallon line (y 423.4). The ammo values sit 2.9 pt below their labels (`FULL DRUM` 490.0 vs `287` 492.9; `FIRED OUT` 506.6 vs `130` 509.4), so 2-pt clustering splits each into a label-only line and a value-only line.
- **Sheet 2 (p259)** has five two-line names whose values are on the *second* line: `AIM-9 LAUNCHER (16S210) +` / `ADAPTER (16S301)`, `LANTIRN TARGETING POD` / `PYLON (16S1150)`, `LAU-117/A… +` / `WEAPON PYLON*`, `LAU-118(V)4/A + WEAPON` / `PYLON*`, `LAU-129/A LAUNCHER +` / `ADAPTER (16S301)`. Line by line, these give a row `ADAPTER (16S301)` that duplicates the real first row and gets that row's values wrong.
- **Sheet 3 (p260)** has group `A/A 37U-36:` (3 sub-rows) and group `AN/ASQ:` (x 62.8; sub-rows at x 72.7). `AGM-65A, B`, `AGM-65D` and `AGM-65G` put store, station and the first rack line on line 1 and weight + DI on line 2 (p260 y 286.7 / 297.8). Each AN/ASQ item (`-T-17 (P4A)` …) has a second line with a **blank store cell** (station `2,3,7, OR 8`, its own DI). That is a row-span.
- **Sheet 4 (p261)** has the two-line names `CATM-88B (WITH WINGS AND` / `FINS)` with the values on line 2, group `LANTIRN POD:` (`NAVIGATION`, `TARGETING`), and the CBU brace label `(SUU-30 H/B)` in the store column of the middle row only.
- **Sheet 5 (p262)** has four groups whose header is itself two lines (`LAU-3/A, B/A, C/A, D/A ROCKET` / `LAUNCHER WITH:`). The sub-rows repeat across groups: `(7) M151`, `FIRED OUT (NO FWD FAIRING)` with station `3 OR 7` appear under LAU-68 (DI 17) and LAU-131 (DI 18), so without the group the key is ambiguous and the DI differs. In the LAU-5003 group the value column drifts upward against the labels: offsets 0.9, 1.4, 1.9, **2.3 pt** (`EMPTY WITH FWD FAIRING` 594.8 vs `78`/`20` 592.5).
- **Sheet 6 (p263)**: `MXU-648A/A, C/A (TRAVEL POD)` has its DI on line 1 (341.6) and a *trailing* line 2 `(MAX CARGO WT IS 300 LB)` + `(EMPTY)` (353.1) with no DI. The groups `SUU-20A/A, B/A WITH:` and `SUU-5003A/A, B/A WITH:` carry a sub-header `(A/A) (B/A)` in the weight column (375.5). Each sub-row's weight cell holds two numbers (`474 420` = A/A 474 lb, B/A 420 lb), which is a multi-level header.
- **Sheet 7 (p264)**: `TGM-65A, B` and `TGM-65D, G` work like AGM-65 (values on line 2). Groups `300-GALLON TANK (EMPTY/FULL):`, `370-…:`, `600-…:` have condition rows. `NO STORES AT 3 OR 7` / `4 OR 6` appears under both 370 and 600 with different DIs (27 vs 20). `SINGLE RACKS OR STORES` / `AT 3 OR 7` is a two-line sub-row. This is where TOLD.md 5.3's "tank values depend on what is at 3/7" lives: the dependency is a **group + condition row**, not a value that depends on another column.

Options:
- (a) Declare every row's y band by hand in the spec (about 150 bands). This is deterministic but laborious, and every spec edit risks a typo.
- (b) Four declared rules plus one override, all small:
  1. **Line clustering** at 3 pt, not 2. The line pitch is about 11.5 pt, and 2 pt splits sheet 5's last LAU-5003 row and sheet 1's ammo rows. Assert that no clustered line spans more than 3 pt.
  2. **`row_end: <column>`** (the DI column; on sheet 1 the F-16C column). Lines accumulate until a line with a non-null cell in that column. That line closes the row, and each column's words are joined top to bottom with one space. This fixes sheets 2, 3 (AGM-65, TOW REEL), 4 (CATM), 7 (TGM, SINGLE RACKS) and sheet 1's ammo offset.
  3. **Group headers:** accumulated lines whose key text ends with `:` and whose `row_end` cell is null become the current group. Their words in other columns, such as `(A/A) (B/A)`, are appended to the group text in column order, so no word is dropped. Every following row gets the group in an extra column `group` (declared in `columns`, null when no group applies). A row whose key starts within 2 pt of the header's x (not indented) ends the group.
  4. **`fill_down: [store]`:** after rules 2–3, a null in these columns takes the previous row's value inside the same group. This covers AN/ASQ's second lines.
  5. **`attach_up: [y, …]`:** an explicit override for a trailing continuation line that belongs to the row above. Only sheet 6's MXU line 2 at y≈353 needs it. Without it, rule 2 glues that line onto the SUU-20 header.
  Keep the asserts: rows, columns, no word outside every column, no null key cell, and **no pending lines left at the end of the row band** (this catches a wrong `row_end`).
- (c) Extract only the cells the TOLD core reads, the DI column, and skip names. Then the drag index builder has nothing to show the pilot.

**Recommended:** (b). It is the smallest format that fits all seven sheets with one override. Every rule is declared per table in the spec, so Task 8 does not invent an extension, and the human checkpoint (Step 5) sees the joined rows. Make `row_end`, `fill_down` and `attach_up` optional keys of the table spec (default: no merge, the current plan's behaviour) and `group` an ordinary column the spec names. If the supervisor prefers to keep Task 8 minimal, the fallback is (a) for sheets 5–7 only, but (b) costs less to write and to check.

## Q7 (Task 8): Which cell texts become numbers? The sheets have `20,000`, `4/2`, `13/8`, `4*`, `2**`, `429*`, `392*/2432`, `117 (123**)`, `474 420` and a lone `-`.

Evidence:
- Sheet 1: `20,000` / `20,600` (operating weight), DI `4/2` / `9/2` under the header `DRAG INDEX (SUBSONIC/SUPERSONIC)*`. Part 1 text (p254) explains that one drag index cannot represent supersonic drag, hence two values.
- Sheets 3–6: the DI column mixes `39`, `13/8`, `5/9`, `19/23`, `10/10`, `4*` (AIM-9 at 1 or 9: footnote `*USED FOR REMOVING WINGTIP AIM-9 MISSILE…`), `2**` (AN/ASQ at 1 or 9: `**…DRAG INDEX IS 2 LESS THAN AIM-9 MISSILE AT STATION 1 OR 9`) and `32*` (LANTIRN NAV, `*WITH PYLON`).
- Weight cells: `-` (p260 TARGET DEPLOYED, a real hyphen-minus meaning "no value"), `117 (123**)`, `93 (99**)`, `398 (404**)` (sheet 2), `429*` (sheet 4), `474 420` (sheet 6, A/A and B/A), `392*/2432` (sheet 7, empty*/full), `108 (EMPTY)` (sheet 6).
- With Task 8's rule (`-?\d+(\.\d+)?` → number, else string), the DI column holds numbers and strings mixed. Takeoff needs the **subsonic** value, and only step 1's drag index builder can interpret the footnotes: the tip-missile `4*` is the delta to the AIM-9 baseline of TOLD.md 5.3.

Options:
- (a) Keep every non-plain-number cell as its verbatim string. Add one declared assert per column, `pattern: <regex>` (for DI: `^\d+(/\d+)?\*{0,2}$`), so a misread cell such as `1 3/8` or a stray word stops the run. Step 1's `inputs/` parses `13/8` and the markers.
- (b) Add format rules `split: "/"` (two output columns) and `markers: "*"` (a `<col>_note` column), so the DI column is purely numeric in the data.
- (c) Also accept thousands separators: `^\d{1,3}(,\d{3})+$` → number.

**Recommended:** (a) + (c), plus "a cell that is exactly `-` or `–` becomes null" (only in non-key columns; the null-key assert still applies). Why: (b) bakes in interpretations the manual leaves to the reader. Does a plain `39` mean "same subsonic and supersonic"? What does `**` mean for the sum? Those belong in step 1's drag index builder with its own tests, next to the Part 1 sample problem (Q13). The `pattern` assert keeps the strings honest for the one human comparison. Station cells (`2,3,7, OR 8`) are multi-word, so rule (c) cannot misfire on them. Assert that a single-word cell with a comma that is not a thousands number stays a string.

## Q8 (Task 8): Table keys are not unique on any store sheet, and `tableCell` takes the first match. What is the key, and is uniqueness asserted?

Evidence: `AIM-120B` appears at `1 OR 9` (DI 0) and `2,3,7, OR 8` (DI 4) (p260). `CATM-120A (107), B (106)` likewise (p261). Each AIM-9 variant appears twice. `NO STORES AT 3 OR 7` / `4 OR 6` appears under 370 and 600 gallon (DI 27 vs 20, p264). Sheet 2 has three rack variants of LAU-129. Task 3's `tableCell` rule ("exact match of every key column") returns the first match without complaint.

Options: (a) key `[store]` as in the plan's example; (b) key `[group, store, station]`, with the extractor asserting the key tuple is unique per table.

**Recommended:** (b). On sheet 2, `[store, station]` is enough (no group column). Also make `tableCell` (Task 3) refuse to answer when more than one row matches, with an `Error`, not `OutOfChart`, because duplicate keys are a data defect, like `panel()`'s missing id. Why: a duplicate key would otherwise give a silent wrong DI, which is the exact failure the human checkpoint can miss. Tell Task 3 now: it runs in batch C, before Task 8.

## Q9 (Task 7): Do B2-3's guideline panels match what the prototype assumed, and are the `families` / `min_lines` rules enough?

Evidence: p285 rendered (`p285.png`). I re-ran the prototype's `guide_panel` pipeline on the real PDF with counters (`guide.py`).
- **Matches the prototype.** Each panel's lines start on its baseline: CG at 35 (a full-width BASELINE line mid-panel; lines run from 30 at the bottom to 40 at the top), DI, slope and wind at 0 at the top. Slope: uphill solid lines go right (rise), downhill **dashed** lines go left (fall), both from the same baseline points. Wind: headwind solid lines go left down to 40 kt, tailwind dashed lines go right and are **drawn only to 20 kt** (they end at 19.989).
- Joined line counts are exact and nothing is dropped: CG 12 lines (the 12,000 ft line covers only 35→40), DI 11 (the 11,000 ft line exits the frame at DI 350; no 12,000 ft line), slope 23 = 11 uphill + 12 downhill (no uphill line from 12), wind 23 = 12 headwind + 11 tailwind. Zero pieces fall under "< 5 pt" or "does not cross the baseline". The drawn example path (A–G arrows) has stroke width 0.113, the grid 0.34 and the curves 0.737, so the 0.5–1.0 width filter already removes the path. Dashes are separate `l` segments, not a dash pattern, which is why `join_dashes` is needed.
- Every CG line **falls**: distance shrinks as CG moves aft, e.g. 1.0597 at 30 % → 0.9401 at 40 %. Task 7 declares CG `{all: any}`, which checks nothing.
- `min_lines: 20` on slope and wind would still pass if, say, all 23 lines were mis-split into one family.
- The data JSON is written with sorted keys, so `families` comes out as `{downhill, uphill}` and `{headwind, tailwind}`. Task 6 says "the second family of a guideline panel in blue", which in JSON order would paint uphill and tailwind blue, the opposite of Task 7 Step 2.

**Recommended:**
1. CG `families: {all: falls}`.
2. Replace `min_lines` with an exact `count` per family: `cg {all: 12}`, `di {all: 11}`, `slope {uphill: 11, downhill: 12}`, `wind {tailwind: 11, headwind: 12}`. This is the guideline twin of "curve count == param values", and it fails loudly if dash joining breaks a line in two. If the supervisor wants to keep the plan's key, keep `min_lines` but add "each family ≥ 2".
3. Store slope and wind params as **magnitudes**, as drawn (0–2 %, 0–40 kt). The sign only picks the family, and b2-3.ts passes `Math.abs(x)` as the target (the prototype does this; Task 9's "negative = downhill/tailwind" is the input convention, not the data's).
4. Colour the overlay by declared direction (`rises` red, `falls` blue), not by key order.

## Q10 (Task 4, running): In the single-point test, what does `dir[k][p]` become when the down or up run errors for output k? And may one id be read twice in one run?

Evidence: Task 4's pseudo-code picks "the worse of lo, hi for k per WORSE ('down' on a tie)" but never says what happens when lo or hi is an `OutOfChart`. The Cells rule says only that the first such error becomes the conservative value. Step 1 will call `takeoffDistance` for MIL and AB in one chain, so it will read `b2-3.gw` … twice. A run of `{p: down}` would then round both reads, and `roundingPoints` would hold `b2-3.gw` twice.

**Recommended:**
- An errored side counts as the worst, so `dir[k][p]` is set to that direction. The final run `f` then errors for k, and the cell's conservative value is that error, which keeps "first such error" well-defined: in run order, the single-point runs come first, in exact-pass read order, down before up. If both sides error, take `down`.
- `ctx.read` throws `Error` on a second read of the same id within one run (a chain defect, like `panel()`'s missing id), with a Task 4 test.
- Step 1 adds an id prefix, for example `takeoffDistance(ctx, fig, i, idPrefix = 'b2-3')`, or a `scoped(ctx, 'mil.')` wrapper. Task 9 keeps the fixed ids, so its pinned trace is unchanged.

## Q11 (Task 9): The "oracle agreement on real data" test compares `evaluate` and `evaluateExhaustive` over 50 seeded B2-3 input sets "inside the drawn ranges". How are input sets drawn, and how are two errors compared?

Evidence: B2-3's drawn region is not a box. Uniform TOF 1–7 × GW 20–48 puts many points past 12,000 ft (GW 36+ curves end at TOF 6.6 down to 3.6, prototype data) or below the 1,000 ft guideline floor (Q12). Both functions then return errors, but "the first error" can name a different input in each (different run order), so `deepEqual` on the cells fails although both are right.

**Recommended:** draw seeded sets until 50 have an `ok` exact distance (cap the attempts at, say, 2,000 and fail if 50 are not reached). Then, per set: both conservatives `ok` → equal within 0.5 ft; both errors → pass, comparing only `kind`; one `ok` and one error → fail. Draw the ranges as TOF 1–5, GW 20–40 k, CG 30–40, DI 0–300, slope −2…2, wind −20…40 (tailwind is drawn only to 20 kt). Include exact zeros for slope and wind in a few sets so the skip path is covered.

## Q12 (Task 3/9, consequence for step 1): Every B2-3 guideline panel's lowest line starts at 1,000 ft, so a distance under 1,000 ft out of the GW panel gives `OutOfChart` at the CG panel. Is that intended?

Evidence: on all four guideline panels, the lowest line starts on its baseline at 1.0 (×1000 ft), and the left frame (0 ft) is the only thing below it. Prototype chain, AB at sea level, 15 °C (AB TOF 1.40): distance after the GW panel is 682 / 836 / 1,008 ft for GW 20 / 22 / 24 k lb. At −10 °C, 24 k lb gives 929 ft. A real F-16C is 20,000 lb basic plus 7,162 lb of internal fuel, so this only bites a light, low-fuel AB takeoff. The lines are close to proportional (CG at 30 %: ×1.060 at 1,000 ft, ×1.053 at 2,000 ft), so the frame at 0 acts like a zero guideline.

**Recommended:** strict `OutOfChart` in step 0, as Task 3 says. With Q2's order, CG 35 % and DI 0 still return the entry. Add a note to TOLD.md step 1 (Limitations page: "AB takeoffs under 1,000 ft are not computed") rather than inventing a zero guideline now. The human may later rule that the left frame counts as a guideline: a one-line change in `guidelinePanel`, plus a test.

## Q13 (Task 8/9): Should the B1-1 specs carry `sample_problems`? Part 1 has a worked drag index example, but no figure code or runner exists in step 0.

Evidence: p254–255 (printed B1-2/B1-3) works an example: 4 AIM-9L on LAU-129/A, 2 MK 84, 2 × 370 gal gives store DI 142 and basic DI 4C, so total 146. It also has a configuration weight of 11,536 lb (the text above it says 11,520 for the T.O. 1-2 value, and the pylon weight is 289 lb in the text vs 281 on sheet 2). Task 9's test: "A spec with samples but no runner fails the test."

**Recommended:** no `sample_problems` in the B1-1 specs in step 0. If Task 8 adds them, Task 9's suite goes red with no runner to write. Record the example for step 1's drag index builder (TOLD.md 1.2 item 1). Do not record the 289/281 and 11,520/11,536 differences as errata yet: the text says the T.O. 1-2 values "may vary slightly … due to rounding". Revisit when the builder exists.

## Q14 (Task 12): Which TOLD.md 0.1–0.4 boxes can honestly be ticked, and what happens to text that points into `perf/prototype/`?

Evidence:
- TOLD.md 0.1 line 123: "CI …: lint, format check, type check, `data:check`, core tests with the coverage floor, the Playwright smoke spec". The plan's execution notes move the smoke spec and the PA parity test to step 1. 0.3 line 150 says "fails on unlabelled curves or leftover labels". Task 6 first assigned params by declared order (its DONE_WITH_CONCERNS). Its `panels.py` now has `assign_labels`, which checks spec label anchors and not the printed label text: a reviewer's call.
- Text that will point at a deleted directory: Task 6's `specs/B2-1.yaml` line 1 and `B2-2.yaml` line 2 ("from perf/prototype/extraction/extract.py"), `geom.py` line 3, and the plan's Task 9 Step 3 ("compare with perf/prototype/engine/engine.js").

**Recommended:**
- Tick a box only when everything in it is delivered. Split 0.1's CI item: tick the delivered part and add an unticked "Playwright smoke spec and PA parity test (step 1)". Tick 0.3's label item only if the Task 6 review accepted anchor-based labelling as meeting it; otherwise reword it to what was built.
- Before deleting, rewrite the comments to "from the planning prototype (removed in <commit>; `git show <commit>^:perf/prototype/…`)", with the deletion commit's parent as the reference, so the coordinates' origin stays traceable.
- Leave the plan file itself alone: it is a finished work record.

## Q15 (Task 5): Small loader details two implementers would do differently.

Evidence and **Recommended**, one line each:
- **Path base.** Resolve `extraction/specs/` and `manual-errata.yaml` from `import.meta.url` (`new URL('../../extraction/…', import.meta.url)`), not `process.cwd()`. Tests run from `perf/`, but CI or an editor may not.
- **`applyErrata` strictness.** Throw when `affects.sample` is out of range (the plan says so) **and** when `affects.key` is not already in that sample's `expected`. A typo must not add a new expected key that no runner checks.
- **Matching.** `affects.spec` is the spec **id** (`B7-2.sh2`). The erratum's `figure`/`sheet` are for people. Assert that an erratum with `affects` names a spec that `loadSpecs()` found, but skip that check while the spec does not exist yet: B7-2 arrives in step 1, and its entry has `affects: null`.
- **YAML parse.** Use `yaml`'s `parse` with default (core) schema, so `pitch_8deg: true` is a boolean and `sheet: null` is null. `loadSpecs()` returns specs sorted by file name, so test order is stable.
