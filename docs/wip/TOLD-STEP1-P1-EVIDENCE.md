<!-- Plan 1 questioner's page evidence (29 Oct 2026). Page indexes are 0-based, coordinates PDF points (y down). Read against perf-told at 9f9a633b (Task 1 merged: unscaled axis, limit_line, split_kinks/joined_lines). Measured with PyMuPDF vector and text data and what-if runs of the repo's own extractor functions, monkeypatched in the scratchpad only (nothing in the repo was changed). No refusal speed value was read off B2-5 or B2-6: for those sheets only structure is recorded (line counts, baselines as tick positions, page positions of curve ends). Every question was settled as rulings P1-P16 in docs/wip/TOLD-STEP1-P1.md ("Questioner rulings"). The scratchpad scripts and renders it mentions are not kept. -->

# TOLD step 1 plan 1: page evidence and questions (questioner, 2026-10-29)

Every question has a recommended default, so a lane can go ahead without waiting. Q1 to Q7 block lanes; the rest are small.

## Common facts

- **Pens.** Every chart is `l` segments in three widths. 0.737 is curves, guide lines, limit lines and frames. 0.34 is the major grid, the text outlines and the arrowheads (`qu`). 0.113 is the minor grid and the sample-problem paths (dashed). `DEFAULT_WIDTH (0.5, 1.0)` keeps only 0.737, so the sample paths and the label leaders never reach a panel. None of the plan-1 pages has a Bezier.
- **Text layer.** Curve labels, HEADWIND/TAILWIND/UPHILL/DOWNHILL, "AVAILABLE RUNWAY LENGTH — FEET", "GW — 1000 POUNDS", "AIR TEMPERATURE — °C", "FINAL APPROACH"/"TOUCHDOWN" and **"MAXIMUM BRAKE ENERGY LIMIT LINE"** are vector glyphs, not text. The **em dash is not in the text layer at all**, not even as a control character: `'(225 KTS    NO WIND)'` and `'ACCELERATION CHECK SPEED   KIAS'` hold plain spaces where it is drawn. `page_text` keeps R4's `\x06` and `\x05` mapping (`'Figure B2\x065.\x05(Sheet 1)'` becomes `Figure B2-5. (Sheet 1)`). The apostrophe in `GW'S` is ASCII `'`.
- **Titles split over two text lines.** On B2-4 and B7-2 sh2, "DRAG"/"INDEX", "WIND"/"KNOTS" and "SLOPE"/"%" are separate text lines, and `find_title` matches only within one line. Use one word as the title (`INDEX`, `KNOTS`, `SLOPE`). On the refusal pages "WIND   KNOTS" and "SLOPE   %" are single lines.
- **Line style is not consistent across figures.** The extractor splits families by direction, so this is record only:

| Figure | Dashed | Solid |
| --- | --- | --- |
| B2-3 (step 0) | tailwind, downhill | headwind, uphill |
| B2-4 | tailwind, uphill | headwind, downhill |
| B2-5, B2-6 (all sheets) | tailwind, uphill | headwind, downhill |
| B7-2 sh2 wind/slope | tailwind, downhill | headwind, uphill |
| B7-2 sh2 RCR curves | 18, 12, 10 (WET) | 23, 16, 8, 4 |

- **Slope axis is 0–3 %** on every plan-1 chart (B2-3 was 0–2).
- **Tailwind lines are drawn to 20 kt** on B2-4, B2-5 and B2-6, and **to 40 kt** on B7-2 sh2.

## B2-4 Acceleration Check Speed (index 286, printed B2-10, Change 3)

- **must_contain:** `Acceleration Check Speed`, `F110-GE-129`, `Figure B2-4`, `DATA BASIS FLIGHT TEST`. The caption is `Figure B2-4.` (no sheet).
- **Axes.** Fitted resid ≤ 0.05.

| Axis | Page | Label band | Ticks | Title, edge |
| --- | --- | --- | --- | --- |
| `takeoff_factor` | y | x [96, 106], range y [138, 292] | 1–6 | `TAKEOFF FACTOR`, left |
| `accel_check_speed` (KIAS) | x | y [680, 690], range [100, 520] | 40, 60 … 180 | `ACCELERATION CHECK SPEED KIAS`, bottom |
| `gross_weight` (1000 lb) | y | x [90, 105], range [290, 502] | 15–50 by 5 | `GW 1000 POUNDS`, left |
| `drag_index` | y | x [84, 105], range [505, 556] | 0, 100, 200, 300 | `INDEX`, left |
| `wind` (kt) | y | x [90, 105], range [560, 625] | 0, 20, 40 | `KNOTS`, left |
| `slope` (%) | y | x [95, 105], range [628, 680] | 0–3 | `SLOPE`, left |

  The speed-axis title needs `KIAS`: without it, "ACCELERATION CHECK SPEED" also matches the page heading. The nearest-to-band rule picks the right one anyway.
- **Frames.** x [109.1, 534.6] on every panel. y: distance [143.3, 285.1], gw [297.5, 496.1], di [508.4, 550.9], wind [563.4, 620.0], slope [632.4, 675.0]. The frames have gaps where the sample path crosses, which does no harm. The speed axis runs from 40.0 kt at the left frame to 190.0 kt at the right frame.
- **Panels in reading order** (matches the Part 2 text order, and the plan's ids `distance, gw, di, wind, slope`):
  1. `distance` (`curve_family`). Input `takeoff_factor` (page y), output speed (page x), param `check_distance` ft with values [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000]: **14 chains, clean**, no joining needed.
     - `monotonic: falls`: speed falls as TOF rises along every curve. `order.output: rises`.
     - Drawn TOF ranges: 500 ft [1.18, 5.13] (it leaves the **left frame at 40 kt**); 1000–2000 ft [1.09, 6.00]; 2500+ end at the right frame at 1.13 / 1.33 / 1.75 / 2.13 / 2.53 / 2.92 / 3.33 / 3.74 / 4.13 / **4.52** (11000).
     - **No curve reaches TOF 1.0.** The lowest end is 1.09, 2.5 pt above the bottom frame.
     - The only TOF where all 14 curves are drawn is [4.52, 5.13]. So `check_at: [4.7, 4.9]` works with today's extractor (what-if: passes).
     - Label anchor clearance is ≥ 12 pt for every curve.
  2. `gw` (`guideline_panel`). Input `gross_weight` (page y), **baseline 43** (a full-width 0.737 line at y 337.2, mid-panel). Lines run from GW 48 at the top to GW 18 at the bottom, with segments both above and below the baseline. Family `{all: falls}` (speed falls as GW rises). **16 lines**, at baseline speeds 40 (left corner) … 190 (right corner). Some exit the right frame early: drawn GW ranges start at 18.4 / 21.4 / 24.8 / 28.2 / 31.8 / 35.4 / 39.0 / 43.0.
     - **The "BASELINE" label box (x 430–457, y 328–335) cuts the line through baseline ≈ 151 kt.** The upper piece, GW 44.9–48.0, is left alone: the gap is 10.2 pt along y, above `join_dashes`' 9 pt. The lower piece reaches 43.1. The extractor then fails: "line starting at page (423.7, 308.8) … does not reach the baseline 43" (Q4).
  3. `di` (`guideline_panel`). Baseline 0 (top frame), `{all: falls}`. **14 lines**, at baseline speeds 60, 70 … 190. **There is no line below 60 kt** (Q9).
  4. `wind` (`guideline_panel`). Baseline 0 at the top. `{headwind: rises, tailwind: falls}`. Headwind (solid) has **8** lines, baselines 40 … 180, drawn to 40 kt; the 180 line leaves the right frame at 14.4 kt. Tailwind (dashed) has **7** lines, baselines 60 … 180, drawn to 20 kt.
  5. `slope` (`guideline_panel`). Baseline 0. `{downhill: rises, uphill: falls}`. Downhill (solid) has **8** lines, baselines 40 … 180; the 180 line leaves at 1.74 %. Uphill (dashed) has **7** lines, 60 … 180, drawn 0–3 %.
- **Clips must include the left and right frame lines** (e.g. x [108.6, 535.1]). The 40 kt lines start at the left frame corner and the 190 kt lines at the right corner. With B2-3's habit of a clip just inside the frame, the corner segment is dropped and the line "does not reach the baseline". `panel_segments` still drops the vertical frame lines.
- **What-if result.** Counts as above, gw with `filter.min_span_pt: 20` (which drops the orphan piece; see Q4 for the better fix), and the sample chain run the step-0 way: TOF 1.85 → 1500 ft 111.9 → GW 33 127.7 → DI 150 125.9 → 10 kt headwind 133.3 → 1 % uphill **129.0 KIAS (manual 129)**.
- **Sample (p279–280), exact:** "A. Takeoff factor (AB) = 1.85 B. Distance from brake release = 1500 feet C. GW = 33,000 pounds D. Drag index = 150 E. Wind = 10 knots (headwind) F. Slope = 1 percent (uphill) G. Acceleration check speed = 129 KIAS".
- **Procedure (p279):** "Enter chart with takeoff factor (A). Proceed horizontally to the right to a distance line (B), down to the GW baseline and parallel the nearest weight guideline to GW (C), down to drag index baseline and parallel the nearest guideline to drag index (D), down to wind baseline and parallel nearest guideline to wind (E), down to slope baseline and parallel nearest guideline to slope (F), and finally down to read acceleration check speed (G)." Also from p279: "Reliable HUD airspeed indications should begin at about 50 knots."
- **corrections:** none printed.

## B2-5 Refusal Speed (Non-AB), sheets 1–3 (index 287, 288, 289; printed B2-11, B2-12 (Change 3), B2-13 (Change 8))

- **must_contain** (all three sheets): `Refusal Speed (Non-AB)`, `F110-GE-129`, `Figure B2-5. (Sheet N)`. Per sheet:
  - sh1: `DRY CONCRETE (RCR=23)`, `FOR RCR=16 (DRY) DECREASE REFUSAL SPEED BY 4 KIAS FOR ALL GW'S.`
  - sh2: `WET CONCRETE (RCR=18)`, `FOR RCR=12 (WET) DECREASE REFUSAL SPEED BY 9 KIAS FOR ALL GW'S.`
  - sh3: `SNOW (RCR=8)`, `ICY (RCR=4)`. These appear twice: in the conditions block and as panel headings.
- **Notes (all sheets):** "REFUSAL SPEED BASED ON: ZERO TAXI ENERGY. NO BRAKING ABOVE MAX BRAKE APPLICATION SPEED (REFER TO FIGURE B2-12) … BRAKES APPLIED 3 SECONDS AFTER IDLE SELECTED." Configuration: "ALL DRAG INDEXES", "SPEEDBRAKES — OPEN". **Sheet 3 alone says "(REFER TO FIGURE B2-10)"**, a misprint: B2-10 is roll trim (Q14).
- **Axes.** Fitted resid ≤ 0.03.

| Axis | Page | Ticks, band | Title, edge |
| --- | --- | --- | --- |
| `refusal_speed` (KIAS) | y | 40 … 200 by 20. Label band x: sh1 [514, 534], sh2 [506, 526], sh3 [529, 549] | `REFUSAL SPEED KIAS`, right |
| `takeoff_factor` | y | **2–7**. Labels at x ≈ 292–298 (sh1), 233–239 (sh2), 347–353 (sh3), y 518.7 … 698.8 | `NON-AB TAKEOFF FACTOR`, right |
| `wind` (kt) | x | 0, 20, 40 | `WIND KNOTS`, bottom |
| `slope` (%) | x | 0–3 | `SLOPE`, bottom |
| `carry` (unscaled, page x) | x | none | none |

  On sheet 3 the carry axes are `carry_snow` and `carry_icy`.
- **Frames.**

| Sheet | runway x | runway y | gw y | wind x | slope x |
| --- | --- | --- | --- | --- | --- |
| sh1 | [71.0, 287.1] | [199.7, 487.8] | [518.3, 698.4] | [335.6, 407.7] | [456.5, 510.6] |
| sh2 | [83.6, 227.7] | [194.3, 482.4] | [516.8, 696.9] | [304.6, 376.6] | [448.9, 502.9] |
| sh3 | snow [56.8, 200.9], icy [233.7, 341.8] | [199.4, 487.6] | [516.7, 696.8] | [372.5, 444.5] | [471.6, 525.7] |

  Each GW panel shares its runway panel's x frame exactly, so the carried page x is common to the two. Wind and slope use the runway panels' y frame.
- **Panels** (the plan's shape holds: gw → runway → wind → slope; refusal speed rises to the right with carry):
  - **`gw`** (`curve_family`). Input TOF (page y), output carry (page x). `monotonic: falls`: carry falls as TOF rises; verified on the joined curves, with no wrong-way step. GW ticks are not printed; the param values come from the labels.
    - **sh1: 9 curves**, values [18, 20, 24, 28, 32, 36, 40, 44, 48]. Heavier is left (lower carry), so `order.output: falls`. Labels sit at the lower left with leader arrows to the curves.
    - **The leaders knock out the curves where they cross.** sh1 gives 45 chains for 9 curves, with pieces about 6 pt long and gaps about 2.5 pt. `mono_pieces` plus `join_dashes` (defaults, along y) joins them into exactly 9 curves, each spanning the whole panel (Q1).
    - **sh2: 9 curves** (same values; labels 18 at the top to 48), 46 chains, also knocked out. The curves are 2.0–2.5 pt apart at the top.
    - **sh3 snow: 9 curves**, 47 chains, knocked out; 2.1 pt apart at the top.
    - **sh3 icy: 2 curves**, labels **"18/20"** and **"48"**, clean. **They cross at TOF 4.38.** Below it 48 is left (`falls`); above it 48 is right.
    - Drawn TOF on every B2-5 GW curve: **[2.11, 6.79]**. The curves start at y 524.9–526.3 and end at 693.2–694.7, inside the frame.
  - **`runway`** (`curve_family`). Input carry, output refusal speed. Every line is **one straight segment** (a chain of n=2). `monotonic: rises`, `order.output: rises`.
    - sh1, sh2 and sh3 snow: **12 lines**, [2000, 3000, 4000, 5000, 6000, 7000, 8000, 10000, 12000, 15000, 18000, 20000]. sh3 icy: **10 lines**, [3000 … 18000] (no 2000, no 20000).
    - Lines start at the left frame or, for the lowest ones, at the bottom frame (sh2 2000 at x 92.0; snow 2000 at 72.8; icy 4000/3000-side lines at 242.2, 253.1, 267.0). They end at the top or right frame.
    - A carry common to all lines exists on every panel: sh1 [71, 127.6], sh2 [92, 165.3], snow [72.8, 117.8], icy [267, 334.3].
    - Anchor clearance is ≥ 7.6 pt.
  - **`wind`** (`guideline_panel`). Input wind (page x), baseline 0 at the left frame. Same on all three sheets:
    - `headwind` rises: **8** lines (solid), baselines 40 … 180. The 160 line leaves the top frame (200 kt) at about 26–36 kt and the 180 line at about 12–17 kt.
    - `tailwind` falls: **8** lines (dashed), baselines 60 … 200, drawn to 20 kt. On sh3 one line meets the bottom frame at 19.81 kt.
  - **`slope`** (`guideline_panel`). Input slope (page x), baseline 0. `uphill` rises: **8** dashed lines, 40 … 180. `downhill` falls: **8** solid lines, 60 … 200. All drawn 0–3 %.
    - **sh1's uphill lines are almost flat** (+0.4 to +0.8 kt over 3 %) and wobble by up to **0.34 pt** against their direction. The downhill lines' first point is 0.11–0.17 pt off. Both fail the strict `check_monotonic` (Q4).
- **Extraction failures with today's code** (what-if, counts set):
  - sh1 slope: monotonic, 0.34 pt.
  - sh2 wind: "doubles back along wind at page (340.6, 370.0)". This is a 0.057 pt **vertical micro-segment** (340.611, 370.035) → (340.611, 369.978) inside the headwind line from 80, which gives a zero step along the input. After that is fixed, a tailwind dash at (331.0, 244.2) is left unjoined: `join_dashes` skips it for a dash 8.9 pt further on with a smaller prediction error. With `max_gap` 6 it joins, and the 5.5 pt label knockout on the headwind line from 80 still bridges.
  - sh2 slope, sh3 slope: monotonic, at the first point.
  - Every GW panel except sh3 icy: unlabelled pieces, from the knockouts (Q1).
  - sh2 and sh3 snow GW: the label rule (Q6).
- **corrections** (verbatim lines above): sh1 "RCR 16: −4 KIAS"; sh2 "RCR 12: −9 KIAS"; sh3 none.
- **Part 2 text (p280)**, for the whole family:
  - "Refusal speed for dry runway conditions, dry concrete (RCR = 23) and dry (RCR = 16) is presented in figures B2-5 and B2-6, sheet 1 … wet concrete (RCR = 18) and wet (RCR = 12) … sheet 2 … loose snow (RCR = 8) and smooth ice (RCR = 4) … sheet 3."
  - "Drag index effects are negligible."
  - "**Certain heavy GW/low RCR combinations can result in the refusal speed for a heavy GW aircraft being higher than the refusal speed for a light GW aircraft.**" This is the crossing on B2-5 sh3 icy and B2-6 sh3 snow, and B2-6 sh3 icy's reversed order.
- **No sample** for any B2-5 sheet.

## B2-6 Refusal Speed (AB), sheets 1–3 (index 290, 291, 292; printed B2-14, B2-15, B2-16, all Change 3)

- **must_contain:** `Refusal Speed (AB)`, `F110-GE-129`, `Figure B2-6. (Sheet N)`. Per sheet:
  - sh1: `DRY CONCRETE (RCR=23)`, `FOR RCR=16 (DRY) DECREASE REFUSAL SPEED BY 5 KIAS FOR ALL GW'S.`
  - sh2: `WET CONCRETE (RCR=18)`, `FOR RCR=12 (WET) DECREASE REFUSAL SPEED BY 10 KIAS FOR ALL GW'S.`
  - sh3: `SNOW (RCR=8)`, `ICY (RCR=4)`. Every sheet's note says "FIGURE B2-12".
- **Axes.** As B2-5, except **`takeoff_factor` ticks 1.0–4.0 by 0.5** (7 ticks; labels x ≈ 274–287 sh1, 240–253 sh2, 315–329 sh3; y 487.9 at 4.0, 704.0 at 1.0) and the title is `AB TAKEOFF FACTOR`. Refusal speed bands: sh1 [501, 521], sh2 [500, 520], sh3 [515, 535].
- **Frames.**

| Sheet | runway x | runway y | gw y | wind x | slope x |
| --- | --- | --- | --- | --- | --- |
| sh1 | [88.8, 268.8] | [185.0, 473.2] | [487.6, 703.7] | [319.9, 392.0] | [443.8, 497.8] |
| sh2 | [90.1, 234.2] | [184.4, 472.5] | [487.0, 703.1] | [302.3, 374.4] | [442.5, 496.6] |
| sh3 | snow [69.4, 177.5], icy [202.1, 310.1] | [190.5, 478.7] | [487.4, 703.6] | [347.9, 419.9] | [458.2, 512.2] |

  sh1's frame lines are broken where the sample path crosses (V 268.8 at y 294–302, H 473.2 at x 166–169), which does no harm.
- **`gw`:**
  - **sh1: 9 curves** [18 … 48], knocked out (45 chains), joined cleanly. **The 18 and 20 curves end at the same point** (231.4, 689.6) at TOF 1.20.
  - **sh2: 2 curves** [18, 48], clean, no crossing. 48 is left: `falls`.
  - **sh3 snow: 2 curves** [18, 48]. **They cross at TOF 3.54**: below it 48 is left (bottom labels "48" left, "18" right); above it 48 is right. The two start 2.3 pt apart at the top.
  - **sh3 icy: 4 curves** [18, 20, 24, 48] with bottom labels 18, 20, 24, 48 from left to right. **Heavier is to the right throughout**, so `order.output: rises`, the reverse of dry.
  - Drawn TOF on every B2-6 GW curve: **[1.20, 3.87]**.
- **`runway`:** sh1, sh2 and sh3 snow have 12 lines [2000 … 20000]; sh3 icy has 10 [3000 … 18000]. All are single straight segments. Common carry: sh1 [88.8, 128.0], sh2 [126.6, 185.9], snow [82.8, 107.3], icy [268.3, 310.1].
- **`wind` / `slope`:** exactly as B2-5: headwind 8 (40–180), tailwind 8 (60–200) to 20 kt; uphill 8 (40–180, dashed), downhill 8 (60–200).
  - With today's code, sh1 slope fails monotonic at the first point (0.11 pt).
  - With a global `max_gap` 6, sh1 wind and sh3 wind would fail, so the gap must be set per panel (Q4).
- **Sample (p280, sh1 only), exact:** "A. Takeoff factor (AB) = 1.85 B. GW = 33,000 pounds C. Available runway length = 6000 feet D. Wind = 10 knots (headwind) E. Slope = 1 percent (uphill) F. Refusal speed (dry runway) = 153 KIAS". GW 33 lies between the 32 and 36 curves.
- **Procedure (p280):** "Enter appropriate chart with takeoff factor (A). Proceed horizontally left to GW (B) and then vertically up to runway length (C). From there, proceed horizontally right to wind baseline and parallel nearest guideline to wind (D) and then horizontally right to slope baseline and parallel nearest guideline to slope (E). Finally, proceed horizontally right to read refusal speed (dry runway RCR = 23) (F)."

## B7-1 Landing Speed (index 389, printed B7-3, no Change marking)

- **must_contain:** `Landing Speed`, `Figure B7-1`, `13 DEGREES AOA (INDEXER ON SPEED)`, `ALL TEMPERATURES`, `ALL ALTITUDES`. **No engine is printed** (image number 1F-16X-1-1-0015B; Q13).
- **Axes:**
  - `gross_weight` (1000 lb): page x, label band y [570, 581], ticks 20–45 by 5, title `GW 1000 POUNDS`, edge bottom. The frame x [103.1, 542.7] is GW **17.0 to 48.0**.
  - `airspeed` (KIAS): page y, band x [80, 99], ticks 120–220 by 20, title `AIRSPEED KIAS`, edge left. The frame y [254.3, 566.4] is 220.1 to 110.1 kt.
  - Fits: GW a 14.1786 b −137.91; speed a −2.8362 b 878.34.
- **Curves.** Two clean chains, both running from the left frame to the right frame (GW 17.0–48.0): final approach 125.0 → 210.6 kt, touchdown 115.1 → 194.0 kt.
  - They are **parallel across the whole width**, at least 16.5 kt (≈ 47 pt) apart, so **no rectangular clip holds one curve without the other**. `single_curve` asserts exactly one chain in its clip (Q3).
  - At GW 20: final **136.05**, touchdown **125.35** (manual 136/125).
- **Note:** "THE BASELINE AIRSPEEDS ARE BASED ON THE BASIC OPERATING WEIGHT PLUS FULL AMMO. ACTUAL APPROACH AIRSPEED AT 13 DEGREES AOA MAY DIFFER BY +/-5 KNOTS DUE TO VARIATIONS IN AIRCRAFT CG." This is not a correction rule; it belongs on the Limitations page.
- **Sample (p387), exact:** "A. GW = 20,000 pounds B. Touchdown speed = 125 KIAS C. Final approach speed = 136 KIAS".

## B7-2 sheet 1 Short Field Landing Distance (Uncorrected) (index 390, printed B7-4, Change 3)

- **must_contain:** `Short Field Landing Distance (Uncorrected)`, `F110-GE-129`, `Figure B7-2. (Sheet 1)`, `MLG TIRE LIMIT SPEED`, `NLG TIRE LIMIT SPEED`, `DRY CONCRETE RUNWAY`.
  - Not available: "MAXIMUM BRAKE ENERGY LIMIT LINE" is vector-only, and "(225 KTS — NO WIND)" has no dash character.
  - The SEC note is text: "NOTE: DURING SEC, INCREASE UNCORRECTED GROUND ROLL DISTANCE BY 4/5 PERCENT WHEN BELOW/ABOVE MAXIMUM BRAKE LIMIT LINE. USE SHEET 3 TO DETERMINE CORRECTED GROUND ROLL DISTANCE."
- **One outer 0.737 frame**: x [100.0, 525.4], y [179.0, 689.6]. **There is no frame line between the two panels.** The altitude-0 line is a 0.34 grid line at y 405.92.
- **Axes:**
  - `altitude` (ft): page y, band x [72, 96], range [170, 412], ticks 0–8000 by 1000, title `ALTITUDE FEET`, left. 0 ft is at y 405.9.
  - `ground_roll` (1000 ft): page y, band x [528, 542], range [310, 670], ticks **2–14 by 2**, title `UNCORRECTED GROUND ROLL 1000 FEET`, right. The 12 and 14 ticks lie beside the temperature panel, above y 405.9. The gw panel's top (y 405.9) is roll ≈ 10.99.
  - `carry`: unscaled, page x.
- **Panels:**
  - `temp` (`curve_family`). Input altitude, output carry. **10 straight lines**, [−40, −30, −20, −10, 0, 10, 20, 30, 40, 50] (labels −40 … 50). Each runs from 0 ft (y 405.9; x 105.2, 124.8 … 282.3) to the top frame at 8000 ft (x 264.1 … 502.6). Every line covers 0–8000 ft. `monotonic: rises`, `order.output: rises`.
    - **The GW 48 curve climbs into this region**: its last piece reaches y 387.0 at x 497.1. So the temp clip, to y ≈ 406, catches a GW 48 stub. `filter.min_span_pt: 100` drops it; temp lines span 227 pt along y.
  - `gw` (`curve_family`). Input carry, output ground_roll. **11 curves**, [20, 24, 28, 32, 34, 36, 38, 40, 42, 44, 48].
    - All run from the left frame (x 100.0) to **x 497.1, not the right frame**. Lighter curves end lower (roll 3.76 … 11.67 at x 497.1).
    - **The 48 curve is in 3 pieces**, knocked out by the MLG and NLG label leaders at x 402.2–404.5 and 424.1–426.3 (gaps 2.5–2.6 pt). That gives an unlabelled-chain failure with today's `curve_family` (Q1).
    - What-if: joining with max gap 3 pt and min span 30 pt gives exactly 11 curves. The limit-line dashes (gaps ≥ 4.3 pt) stay unjoined and are dropped.
    - The clip must reach up to y ≈ 386, so it overlaps the temp region. Temp-line segments there are excluded, because geom keeps only segments with both ends inside the clip and the temp lines are long single segments.
    - `monotonic: rises`, `order.output: rises`.
  - **Limit lines** (Task 1's `limit_line`; what-if with `max_dash_pt: 14`, `filter.min_span_pt: 40`, frame y [405.9, 689.6]). Each is found exactly once:

| Panel | Clip | Carry range | Roll | Trend |
| --- | --- | --- | --- | --- |
| `brake_energy` | [99.5, 505, 505, 545] | [100.0, 497.1] (the GW curves' full range) | 6.34 → 7.19 | rises slightly |
| `mlg_tire` | [403, 428, 505, 455] | [406.3, 502.9] | 10.10 → 9.36 | falls |
| `nlg_tire` | [347, 455, 505, 498] | [349.6, 502.3] | 9.12 → 7.85 | falls |

    - All three are 0.737 width. Dashes are 12.2–13.0 pt with 4.2–4.4 pt gaps; the end dashes are about 6 pt. The tire lines run past the GW curves' end (497.1) to about 502.6–502.9.
    - **Each tire line begins at the GW 48 curve**, just above it: MLG start 10.10 vs 48 at 9.95; NLG start 9.12 vs 8.87. So left of its start no GW curve on the chart reaches the line.
    - The GW 48 middle piece (11 pt segments, 19.6 pt span) crosses MLG's first dash at about (410, 433). `min_span_pt: 40` is what removes it.
    - `beyond: above` is right for all three: a longer roll at the same carry means a heavier GW, which means a higher touchdown speed or more energy. The SEC note's "BELOW/ABOVE" agrees.
    - The `label` strings are not checked against the page by the extractor (good, since the brake label is not text).
- **What-if sample:** 2000 ft / 40 °C gives carry 309.2 pt; GW 28 gives **3902 ft (manual 3902)**.
  - Limit verdicts there: brake energy **false** (line 6.78); **MLG and NLG: carry 309.2 is outside their drawn ranges, so `null`** (Q7).
  - Other points:

| Input | Carry | Roll | brake | MLG | NLG |
| --- | --- | --- | --- | --- | --- |
| 8000 ft / 40 °C / 46 k | 476.1 | 10.33 | true | true | true |
| 6000 / 40 / 44 | 415.4 | 8.38 | true | false | false |
| 2000 / 40 / 48 | — | 8.11 | true | null | null |
| 5000 / 30 / 40 | — | — | false | null | false |

  - **8000 ft / 50 °C gives carry 502.6**, beyond the GW curves' 497.1, which is `OutOfChart`.
- **Sample (p388), exact:** "SAMPLE PROBLEM (SHEET 1). A. Altitude = 2000 feet B. Temperature = 40°C C. GW = 28,000 pounds D. Uncorrected ground roll distance: PRI = 3902 feet SEC (3902 1.04) = 4058 feet". The × sign is missing from the text layer, as on p279.
- **Procedure (p387):** "Enter sheet 1 with pressure altitude (A), proceed to the right to temperature (B), down to GW (C), and finally to the right and read uncorrected ground roll distance (D)."

## B7-2 sheet 2 Short Field Landing Distance (Corrected) (index 391, printed B7-5, Change 3)

- **must_contain:** `Short Field Landing Distance (Corrected)`, `F110-GE-129`, `Figure B7-2. (Sheet 2)`, `ENTER CHART WITH UNCORRECTED GROUND`.
- **Axes:**
  - `uncorrected_roll` (1000 ft): page y, band x [124, 138], range [190, 545], ticks 0–12 by 2, title `UNCORRECTED GROUND ROLL DISTANCE 1000 FEET`, left.
  - `ground_roll` (1000 ft): page x, band y [666, 676], range [135, 495], ticks 0–12 by 2, title `CORRECTED GROUND ROLL DISTANCE 1000 FEET`, bottom.
  - `wind`: y, band [124, 138], range [548, 612], ticks 0, 20, 40, title `KNOTS`.
  - `slope`: y, band [128, 138], range [614, 668], ticks 0–3, title `SLOPE`.
  - Resid ≤ 0.05. Two "0" labels sit at x ≈ 131, y 540.6 and 551.7, so the ranges must separate them.
- **Frames:** x [142.1, 482.5]; rcr y [200.0, 540.3]; wind [551.1, 607.9]; slope [618.6, 661.2].
- **RCR curves (7)**, all from the origin:
  - Labels: "RCR 23 (DRY CONCRETE)", "16 (DRY)", "8 (SNOW)", "4 (ICY)" are solid; "18 (WET)", "12 (WET)", "10 (WET)" are dashed.
  - RCR 23 is the identity line (corrected = uncorrected).
  - **16 merges into 23 at uncorrected 9.0 and the two coincide to the corner (12, 12).** Both end at the same corner point, so `geom.chains` returns them as **one closed chain (n=111) that doubles back**. `mono_pieces` along y splits it into 23 and 16.
  - Drawn uncorrected ranges: 4 [0, 4.64]; 8 [0, 8.24]; 16 and 23 [0, 12]; wet 10 [0.15, 5.51], 12 [0.16, 5.98], 18 [0.19, 6.91].
  - The dashed curves are 69 dash chains (11.6–12.8 pt) and need joining. Near the origin, three duplicate dash fragments (uncorrected 0.6–1.6) stay unjoined and are dropped by `min_span_pt: 30`.
  - **Wet and dry curves cross.** At uncorrected 2 the corrected roll is 4: 6.13, 8: 3.87, 10: 4.60, 12: 4.17, 16: 2.22, 18: 3.38, 23: 2.00. At 4 it is 8: 7.17 vs 18: 7.33; at 6, 8: 9.61 vs 18: 10.66. So **one family ordered by RCR is not monotone anywhere**, and the `order` assert fails.
  - Split as the manual's interpolation rule says (Q2), each family is monotone: dry {4, 8, 16, 23} and wet {10, 12, 18}, with `order.output: falls`.
- **`wind`** (`guideline_panel`). Input wind (page y), baseline 0 at the top, output corrected roll (page x). `headwind` falls: **12** solid, curved lines, baselines 1 … 12 (×1000 ft), drawn to 40 kt. `tailwind` rises: **11** dashed lines, 1 … 11, **drawn to 40 kt**; some leave the right frame early (12k). No line from baseline 0. Today's code fails with "doubles back at (399.3, 558.2)": a 0.227 pt horizontal micro-segment sitting on the 5 kt grid row (Q4).
- **`slope`** (`guideline_panel`). `uphill` falls: **12** solid lines, 1 … 12. `downhill` rises: **11** dashed lines, 1 … 11. All 0–3 % unless they leave the right frame.
- **What-if chain** (two families, micro-step fix): from 3.902, RCR 16 gives 4.294, then 10 kt headwind 3.526, then 1 % uphill **3375 (manual 3375)**; **RCR 4 gives 10.446, then 8.634, then 8006 (manual 8000)**.
- **Sample (p388), exact:** "SAMPLE PROBLEM (SHEET 2). D. Uncorrected ground roll distance (SEC) = 3902 feet E. RCR = 16 F. Wind = 10 knots (headwind) G. Slope = 1 percent (uphill) H. Corrected ground roll distance = 3375 feet **I. RCR = 4 J. Corrected ground roll distance = 8000 feet**". The I/J path is drawn on the chart (I on the 4 ICY curve, then F, G, J).
- **Part 7 text (p387):** "For wet runways, interpolate between RCR 18 (WET), RCR 12 (WET), and RCR 10 (WET). For runways with no liquid water present, interpolate between RCR 23 (DRY CONCRETE), RCR 16 (DRY), RCR 8 (SNOW), and RCR 4 (ICY). If RCR is unknown and runway is wet, use RCR 18 (WET) for wet concrete and RCR 12 (WET) for wet asphalt." Also: "Short Field Landing Distance charts are based on brakes applied at 100 KIAS" (wet or icy).

## Questions

**Q1 (Tasks 4, 5, 6; extractor). `curve_family` cannot extract knocked-out or dashed curves. Who adds joining, and with which keys?**

- **Evidence.** `curve_family` uses `filtered_chains`: plain `geom.chains`, no `mono_pieces`, no `join_dashes`. These panels then give leftover or unlabelled pieces:

| Panel | What breaks it |
| --- | --- |
| B2-5 sh1, sh2, sh3 snow; B2-6 sh1 `gw` | 45–47 chains for 9 curves (leader knockouts) |
| B7-2 sh1 `gw` | the 48 curve in 3 pieces |
| B7-2 sh2 | the wet curves are 69 dashes; the 23/16 pair is one closed chain that doubles back |

  What-if: `joined_lines` along the input axis gives exactly 9 / 9 / 9 / 9 / 11 curves, monotone, with no order swap.
  - B7-2 sh1 also needs a **3 pt** gap, so the limit-line dashes (gaps 4.3 pt) stay apart and are then dropped by `min_span_pt: 30`.
  - B7-2 sh2 needs the wet and dry curves separated by chain length.
- **Options:**
  - (a) Optional `curve_family` filter keys, opt-in so step-0 data stays byte-identical:
    - `join: true` builds the panel's lines with `joined_lines` along the input; `min_span_pt` is applied after joining.
    - `max_gap_pt` (default 9.0; see Q4).
    - `min_chain_pt` / `max_chain_pt` keep only chains longer or shorter than this before joining: the solid and the dashed family.
  - (b) Every lane adds its own variant in `panels.py`: three lanes conflict on one file.
  - (c) Hand-declared y bands per piece: unworkable for 45 pieces.
- **Recommended:** (a), as one extractor commit (fixture test, step-0 byte-identity check) by a short **Task 1b before lanes 4–6 start**, or by the supervisor.
  - Specs: B2-5/B2-6 knocked-out GW panels `filter: {join: true}`.
  - B7-2 sh1 gw `filter: {join: true, max_gap_pt: 3, min_span_pt: 30}`.
  - B7-2 sh2 `rcr_dry` `filter: {join: true, min_chain_pt: 30}` and `rcr_wet` `filter: {join: true, max_chain_pt: 14, min_span_pt: 30}`.
  - **Why:** three of the four lanes need the same thing. Without it, every one of those specs fails before its first panel.

**Q2 (Task 6; contract). B7-2 sh2's RCR curves are two families, wet and not-wet. The contract has one family `rcr` and no wet input.**

- **Evidence:** Part 7, p387 (quoted above) interpolates wet between 18, 12 and 10, and no-water between 23, 16, 8 and 4. The curves cross (snow 8 against wet 18; dry 16 against wet 18), so one family ordered by RCR fails `order` at every check point. Interpolating RCR 14 between 12 (wet) and 16 (dry) would mix the two runway kinds. The plan's own spec ruled the same split for refusal ("For wet runways …", plan 2's rule).
- **Options:**
  - (a) Two panels, `rcr_dry` [4, 8, 16, 23] and `rcr_wet` [10, 12, 18].
    - `groundRollCorrected(ctx, fig, i: {uncorrectedFt, rcr, wet: boolean, headwindKt, slopePct})`; runner input `wet` (0/1 or a boolean like `pitch_8deg`).
    - RCR outside the chosen family's range (dry 4–23, wet 10–18) gives `OutOfChart` on `rcr`.
    - The rounding id stays `b7-2.sh2.rcr`.
  - (b) One family: wrong by the manual, and it fails extraction.
- **Recommended:** (a), with the samples' `wet: false`. It is a contract change, so tell Task 6 before it starts, and plan 2's input layer later.

**Q3 (Task 6; extractor). B7-1's two curves cannot be separated by a rectangular clip, and `single_curve` asserts one chain.**

- **Evidence:** both curves span GW 17–48 in parallel, 16.5–47 kt apart. Any clip that holds all of one holds most of the other.
- **Options:**
  - (a) Optional `single_curve` key `anchor: [x, y]`: take the chain within `LABEL_TOL_PT` of the anchor, which must be unique, and ignore the others. The panel's `count_in_clip: 2` is asserted, so a stray chain is still caught.
  - (b) A `curve_family` with a fake numeric param (0 = touchdown, 1 = final): the reader would then interpolate between them, which is meaningless.
  - (c) A polygon clip.
- **Recommended:** (a). It is small, and like (a) of Q1 it is opt-in, so the step-0 data is unchanged. Put it in the same extractor commit as Q1. The plan's "final above touchdown" order stays a test.

**Q4 (Tasks 3–6; extractor). Guideline-panel robustness: three small failures on real pages.**

- **(i) Micro-segments.** A 0.06–0.23 pt segment along a grid row or column gives a zero step along the input, and `to_points` says "doubles back": B2-5 sh2 wind at (340.6, 370.0) and B7-2 sh2 wind at (399.3, 558.2). **Recommended:** in `to_points`, drop a point whose step along the input is exactly 0 and whose other-axis step is under 0.5 pt. That case fails today, so no step-0 data can change.
- **(ii) Monotonic jitter.** Near-flat dashed lines wobble against their direction: B2-5 sh1 uphill by 0.34 pt; first points elsewhere by 0.11–0.17 pt on B2-5 sh2, B2-5 sh3, B2-6 sh1. **Recommended:** `check_monotonic` accepts a wrong-way step up to `MONO_TOL_PT = 0.5` page pt, converted to chart units per panel. It is assert-only, so the data stays byte-identical. The family is still decided by the end-to-end rise, which is robust: for example +0.4 kt against −1.5 kt.
- **(iii) Join gap per panel.** B2-4 gw's BASELINE label gap is 10.2 pt and needs about 12. B2-5 sh2 wind needs 6, because 9 skips a 1.8 pt dash for one 8.9 pt away. A global 6 breaks B2-5 sh1 wind and B2-6 sh3 wind; a global 12 breaks B2-4 wind. **Recommended:** optional `filter.max_gap_pt` (default 9.0) for `guideline_panel` (and Q1's `curve_family`). B2-4 gw sets 12, B2-5 sh2 wind 6. The fallback for B2-4 gw is `filter.min_span_pt: 20`, which drops the orphan piece; checked to give 129.0 KIAS, but the line through ≈ 151 kt then has no part above GW 43.1.
- **With (i)–(iii), every B2-4, B2-5, B2-6 and B7-2 sh2 guideline panel extracts with the exact counts above** (what-if).

**Q5 (Task 4). B2-5 sh3 icy prints one curve labelled "18/20". `assign_labels` refuses two anchors on one chain, and `order` is strict.**

- **Options:**
  - (a) `param.values: [18, 48]`: GW 20 interpolates 2/30 of the way toward 48 instead of reading the 18/20 curve.
  - (b) `[20, 48]`: GW 18 becomes `OutOfChart`, against Review Focus 2.
  - (c) An optional `param.shared: [[18, 20]]`: one anchor labels both values, the curve is written twice, and `order` skips declared pairs.
- **Recommended:** (c), in the Q1 commit. It is what the page says. The data gains one duplicate curve and the reader is unchanged.

**Q6 (Task 4). `LABEL_TOL_PT = 3` cannot label B2-5 sh2 and B2-5 sh3 snow.**

- **Evidence:** the best anchor clearance per curve (the largest distance from any point on it to the nearest other curve) is 2.3, 2.5, 2.7 pt on sh2 and 2.5, 2.8, 2.9 pt on snow. `assign_labels` needs the second-nearest curve more than 3 pt away. Every other plan-1 panel has ≥ 3.6 pt (B2-6 sh1 3.6; the rest ≥ 5.9).
- **Recommended:** an optional per-panel `label_tol_pt` (default 3), set to 1.0 on those two GW panels. Anchors read off a 6× render are good to about 0.2 pt, and the leader arrow tips mark the curve. Put it in the Q1 commit. Alternative: a global 1.5 pt, but that needs a byte-identity check of step 0 (its anchors were placed for 3 pt).

**Q7 (Task 6). The B7-2 sh1 limit-line tests in the plan cannot pass as written.**

- **Evidence:**
  - (1) "the sheet 1 sample's `limits` all `false`": the sample's carry (309.2 pt) is left of both tire lines' drawn starts (MLG 406.3, NLG 349.6). Under the ruled rule ("outside the line's drawn input range nothing is judged") that gives `{brakeEnergy: false, mlgTire: null, nlgTire: null}`. TOLD.md 1.6 Validation 4 says "the B7-2 sample inside all three".
  - (2) "GW 46,000 lb at 8,000 ft and 50 °C" as a `true` example: 50 °C at 8000 ft carries to 502.6 pt, past the GW curves' end at 497.1. That is `OutOfChart` naming `temperature` (`drawnRange` null), so `limits: null`.
  - Each tire line starts on the GW 48 curve, so left of its start no point on the chart is beyond it.
- **Options:**
  - (a) Keep the core rule. Fix the tests: sample `{false, null, null}`; beyond-all `8000 ft / 40 °C / 46,000 lb` (carry 476.1, roll 10.33 against 7.15 / 9.57 / 8.07); inside-the-tire-lines `6000 ft / 40 °C / 44,000 lb` (brake true, MLG false, NLG false); use the 50 °C case as Review Focus 3's carried-line test. Reword 1.6 Validation 4.
  - (b) A `null` left of a tire line's start becomes `false` in `b7-2.ts` ("no GW drawn reaches it"): chart knowledge in code.
- **Recommended:** (a). Plan 2's rule treats `null` as "no warning", which matches the chart.

**Q8 (Task 6, sample). B7-2 sh2 prints a second sample: RCR 4 → 8000 ft. Add it?**

- **Evidence:** p388 "I. RCR = 4 J. Corrected ground roll distance = 8000 feet", same D, F, G; the path I–F–G–J is drawn. What-if gives 8006 ft (0.08 %).
- **Recommended:** yes. `{uncorrected_ft: 3902, rcr: 4, wet: false, headwind_kt: 10, slope_pct: 1} → {ground_roll_ft: 8000}`, plus the TOLD.md 0.6 row. The erratum already on file ("SEC" label) concerns the text only and applies to both samples; keep `affects: null`. As in R3.

**Q9 (Task 3; Limitations). B2-4's DI panel has no line below 60 kt.**

- **Evidence:** DI lines start at 60, 70 … 190. GW lines start at 40, wind and slope lines at 40. A 500–1000 ft check usually comes out of the GW panel below 60 kt, so with DI > 0 it gives `OutOfChart` (on `accel_check_speed`, the entry rule). DI 0 skips the panel (R1).
- **Recommended:** strict, as R11. Add to the TOLD.md step 1 Limitations list: "acceleration check speeds under 60 KIAS with a drag index are not computed". Supporting text, p279: "Reliable HUD airspeed indications should begin at about 50 knots." Task 3's tests should pick a GW/DI combination for "below the drawn range" with that in mind.

**Q10 (Tasks 4, 5; spec). The `order` check on GW panels that cross, meet or reverse.**

- **Evidence.** B2-5 sh3 icy crosses at TOF 4.38. B2-6 sh3 snow crosses at 3.54. B2-6 sh3 icy is reversed everywhere (heavier means more carry). B2-6 sh1's 18 and 20 meet at TOF 1.20. The supervisor's ruling keeps `order` required with `check_at` only where the curves are apart.
- **Recommended:**

| Panel | `order` |
| --- | --- |
| B2-5 sh3 icy | `{output: falls, check_at: [2.5, 3.5]}` (below the crossing) |
| B2-6 sh3 snow | `{output: falls, check_at: [1.5, 2.5, 3.0]}` |
| B2-6 sh3 icy | `{output: rises, check_at: [1.5, 2.5, 3.5]}` |
| B2-6 sh1 | `check_at` from 1.5 up |
| B2-5 sh3 snow (curves 2.1 pt apart at the top) | at 5 or below |

  Each spec comments the crossing TOF. Review Focus 2's "refusal speed can rise with GW" is real on two sheets; the figure tests should pin one point above the crossing where 48 reads higher than 18.

**Q11 (Tasks 3–5; Limitations). The drawn TOF ranges are narrower than B2-1's output.**

- **Evidence:**

| Chart | Drawn TOF | B2-1 output |
| --- | --- | --- |
| B2-5 (all sheets) | **[2.11, 6.79]** | MIL 1.68–6.85 |
| B2-6 | **[1.20, 3.87]** | AB 1.02–3.79 |
| B2-4 | **[1.09, 6.0]** (500 ft curve only from 1.18) | — |

  So cold or low-altitude MIL TOF below 2.11 has no non-AB refusal speed, and AB below 1.20 has none. Every curve stops a few points inside the frame, well past R1's tolerance.
- **Recommended:** strict `OutOfChart`, a Limitations entry each, and one test each. Do not extend to the frame.

**Q12 (Tasks 4, 5; spec). `corrections` wording.**

- **Recommended:** B2-3's style, one line each: `"RCR 16 (dry): refusal speed -4 KIAS, all GW"` (B2-5 sh1), `"RCR 12 (wet): refusal speed -9 KIAS, all GW"` (sh2), `-5` and `-10` for B2-6. The verbatim note goes in `must_contain`, which also proves the number came from the page. Sheet 3 has `corrections: []`.

**Q13 (Task 6; spec). B7-1 prints no engine, but `engine` is a required string.**

- **Recommended:** `engine: F110-GE-129`, with a spec comment ("the page prints none; the figure is in the F110-GE-129 supplement and holds for all engines") and no engine in `must_contain`. Do not change the schema.

**Q14 (Task 4; errata). B2-5 sh3's note says "REFER TO FIGURE B2-10" for the maximum brake application speed. Every other sheet says B2-12, and B2-10 is the roll-trim chart.**

- **Recommended:** a `manual-errata.yaml` entry with `affects: null` (figure B2-5, sheet 3, where "chart notes", printed "FIGURE B2-10", correct "FIGURE B2-12"), committed with the B2-5 specs. Nothing reads the note today, but the file is the place for known misprints.

**Q15 (Tasks 4, 5). Which input an `OutOfChart` names when the entry speed lies outside the wind or slope lines.**

- **Evidence:**
  - Headwind lines exist from baseline 40 to 180 and tailwind from 60 to 200. A runway-panel result of 185 kt with a headwind, or 50 kt with a tailwind, is outside the usable lines, and `guidelinePanel` names its output, `refusal_speed`.
  - Review Focus 3 only rewrites the carried axis.
- **Recommended:** leave it as `refusal_speed`, like R11's `distance` on B2-3. The UI can say "refusal speed off the chart". The tests use a 10 kt tailwind with a mid-chart speed, so it does not bite there.

**Q16 (Task 6; spec facts that are easy to get wrong; no ruling needed unless the supervisor disagrees).**

- B7-2 sh1 has no frame line between its panels. The gw panel's clip must reach y ≈ 386, because GW 48 rises above the 0 ft line. The temp panel needs `filter.min_span_pt` (100 checked) to drop the GW 48 stub.
- The limit lines need clips about as above, `max_dash_pt` about 14 (dashes ≤ 13.0 pt) and `min_span_pt` 40 (the GW 48 piece crossing MLG spans 19.6 pt).
- B7-2 sh2: RCR `check_at` must avoid uncorrected ≥ 9.0 (16 and 23 coincide there) and the origin: dry [2, 4], wet [2, 4, 5]. Anchors for 23 and 16 go below 9.0.
