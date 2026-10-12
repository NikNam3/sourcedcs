# Briefing: the live-test fix batch (2026-10-12)

Written by the supervisor after the human's first local test (2026-10-11). Findings, causes and rulings:
**`docs/parallel/live-test-2026-10-11.md`** (T1–T31). Decisions **H128–H132** in `docs/parallel/decisions.md` win over
this file. Every lane: `docs/parallel/lane-rules.md`, its own worktree `/home/nklx/dev/personal/sourcedcs-<LANE>` on
branch `lane/<LANE>`, **Opus 5.5**, both unit suites, commit at every green step, dark-cockpit UI (memory
`feedback_dark_cockpit_ui`), **FAA model, always** (H128; memory `feedback_faa_model_always`: read the paragraph, quote it
in the ADR, label ours as ours). Report per lane-rules rule 8 with the usage-guide wording in `docs/wip/<LANE>.md`.

## Lanes and order

`[R]` = waits for LT-RESEARCH (`docs/parallel/next/LT-RESEARCH.md`, output `docs/parallel/research/live-test-faa.md`).
`[H]` = waits for a human answer (Decision Desk, ids below). **H112: one agent at a time** unless the human lifts it; the
"files" column says which lanes do not touch the same files, should the human allow several at once.

| # | Lane | Findings | Needs | Side / files | ADR |
|---|---|---|---|---|---|
| 0 | **LT-RESEARCH** | Q1–Q11 for T1, T4, T5, T7, T8, T11, T12, T16–T18, T27, T29 | — | docs only | — |
| 1 | **LT-TERRAIN** | T2 | — | server: `crc-sync/src/terrain.js` (+ tests) | — |
| 2 | **LT-UI** | T10, T19, T20, T21, T23, T24, T26, T3 (check) | [H] LT-Q3 (T10 reverse direction) | client: metrics panel, strip menu, combination line, correlation highlight, handoff/PO buttons | — |
| 3 | **LT-AIRSPACE-FIX** | T13, T27 (client half + message), T28 | — | client airspace editor/layers; server `airspace-store.js` message text | — |
| 4 | **LT-CORRELATION** | T12 | [R] Q11 (helpful, not blocking) | server `correlation-*.js`, `surveillance/transponder.js` | — |
| 5 | **LT-SFA-PAR** | T1, T5, T11 (and SFA leaves T26's list) | [R] Q1–Q3 | server authority/positions, Incirlik facility config, `sfa-store.js`, PAR ops, `conformance.js`; client PAR panel, FINAL line, SFA view | **0117** |
| 6 | **LT-STRIP-FIELDS** | T7, T8, T31(a) | [R] Q4–Q5, then [H] the label table | client `strip-template.js`, `strip-fields.js`; server `block-map.js`, `flight-data-store.js` validation | — |
| 7 | **LT-MARSA** | T14, T15, T16, T17 | [R] Q6–Q7 | server `marsa-*`, `conformance.js`, STCA; client MARSA chips | **0118** |
| 8 | **LT-AIRSPACE-ALERT** | T29, T27 (using-agency rights) | [R] Q8–Q9, [H] LT-Q5 | server airspace monitor + authority; client alert | **0119** |
| 9 | **LT-RSU-DESIGN** → **LT-RSU** | T25 (H130, H131) | design first: ADR + mockup for the human; build after approval | server Incirlik authority/states, client pattern board | **0120** |
| 10 | **LT-GROUND** | T4 | [H] LT-Q1, [R] Q10 | server `surveillance/presentation.js` | **0121** |

Not in the batch: **T9** (withdrawn), **T22** (explained by T1/T5/T25; LT-UI checks what the metric counts), **T30**
(deferred to the declutter work at the end of the EFSP work, H6), **T6** (squadron data: stereo routes; UI change only if
the human answers LT-Q2), **T18** (answered by LT-RESEARCH Q6; LT-MARSA builds the consequences).

Suggested order: 0 → 1 → 2 → 3 → 4 (none of these needs research) → 5 → 6 → 7 → 8 → 9 → 10. Lanes 1–4 are file-disjoint
from each other and from 0, so they are the natural batch if the human allows several agents.

## Lane details

### 1. LT-TERRAIN (T2)
MapTiler `terrain-rgb-v2` now serves WebP only (`tiles.json` `format: webp`; `.png` URLs and `Accept: image/png` still
return `image/webp`); `crc-sync/src/terrain.js:259` asks for `.png` and decodes PNG only, so every tile fails "not a PNG"
and every radar sees to full range. Fix: decode WebP (a small pure-JS or wasm decoder, or `sharp` if it fits the Docker
image; say why) **or** move to the older `terrain-rgb` set that still serves PNG (verify it is not deprecated). The disk
cache key/extension follows. Test with a real tile fixture (one PNG and one WebP checked in under `tests/fixtures/`), and a
boot with a key that pre-warms without failures. Never touch `state/`; the cache dir in tests is the private TMPDIR.

### 2. LT-UI (T10, T19, T20, T21, T23, T24, T26, T3)
- **T10 / H129:** selecting a Strip no longer rings its track (`correlation-highlight.js`, called from `_selectStrip`);
  the Strip's ⋯ menu gets **"Show on map"**, which rings it and brings it into view if off-screen (how long the ring
  stays: decide and log). The map → Strip direction (click a contact selects its Strip): keep or drop per **LT-Q3**.
- **T19:** a flight split off a formation looks like any other flight on the face (no split field); the split stays in
  the audit; check Undo of a Split and Join back still work.
- **T20:** handoff and point-out always name their target ("Hand off to APP", "Point out to CTR") with one candidate or
  several.
- **T21:** time-to-find counts only a first selection within a window after arrival (or another honest definition);
  the panel says what it measures; the 3.0 s target is labelled ours. Check what the transfer-failure metric counts (T22).
- **T23:** each metric printed once.  **T24:** remove the `[SOURCE-DEFINED]` notes from the metrics panel.
- **T26:** the combination warning is acknowledged by a click and stays hidden until the combination changes; drop the
  rule sentences (the JO 7210.3 citations stay in the docs); keep at most "Monitor TWR 251.0, GND 275.8".
- **T3 (check only):** log in with a MapTiler key and confirm labels appear; if glyphs that failed before login are not
  retried after `onMaptilerKey`, refresh the style's glyphs too (`map-setup.js`).
Specs for each; the e2e helpers reach modules via `crc.<module>`.

### 3. LT-AIRSPACE-FIX (T13, T27 client half, T28)
- **T13:** an airspace's using/controlling agency can be cleared once set (an ordinary amendment, audited).
- **T27:** `crc-desktop/app/public/js/panels/efsp/airspace-editor.js:55` sends a create as the first Position that may
  create (OPS) instead of the draft's controlling Position the controller holds (CTR). Act as the draft's controlling
  Position when held, else OPS of the controlling Facility when held, else the first creator (the server decides); same
  for edit/delete. The refusal text (`crc-sync/src/efsp/airspace-store.js:379`, 470, 540) names who may actually do it,
  never "OPS of CENTER" (CENTER has no OPS). Spec: OPS + CTR combined creates a CENTER MOA.
- **T28:** an airspace made from a DCS drawing shows its own outline without switching the drawing off (draw airspaces
  above mission drawings, or hide the source drawing while the airspace exists; say which).

### 4. LT-CORRELATION (T12)
A new CTR OVERFLIGHT with Block 5 = 0003 stays `NO TRK` while a contact "beacons 0003". Not the former-holder rule (a new
Strip). Ruled out: OVERFLIGHT states are eligible; Block 5 writes `identity.beaconAssigned`, read by the beacon rung. The
rung matches `transponderOf(track).code` (`crc-sync/src/surveillance/transponder.js:88`): a player's code comes from SRS
(`octalCode(entry.squawk)`, null when SRS has no entry or the transponder is off); an AI contact gets a synthetic 6xxx
code only. Reproduce with a player over SRS squawking 0003 and with an AI contact; compare what the label shows with what
`beaconOf` returns; fix the mismatch (format, source, or the label claiming a code the reconciler does not see); spec.
If Q11 says an assigned-code match should not be blocked by an earlier flight's association, also exempt the beacon rung
from `_formerHolder` (ADR 0076 S-L27; callsign rungs keep it) — ask the supervisor before changing that rule.

### 5. LT-SFA-PAR (T1, T5, T11) — ADR 0117 [R]
- **T1 / H128:** no `SFA` Position. AP works the arrival on its SFA frequency and hands it to PAR; three of at least five
  UHF frequencies rotate between AP and PAR; AP keeps the rotation (JO 7610.14 ¶7-1-5 b–c; JO 7110.65BB ¶4-7-3 and its
  exceptions, ¶4-7-4). Remove the Position from authority, facility config, consolidation lists, the combination line
  (T26), Bays and specs; supersede ADR 0075/0093's SFA parts in ADR 0117. The AP → PAR drop that was refused in the test
  ("…ON_FINAL, but the only valid next state from INBOUND is HANDED_TO_TOWER") must work.
- **T5:** Landing assured must not leave the Strip in `par-final` (capacity 1, so the next rotation is refused); build
  what Q2 says ends the PAR part (most likely the Strip leaves PAR); a stuck Strip in a racks-replaced Bay must still be
  reachable (⋯ on the FINAL line). Specs assert the Bay and a second aircraft rotated to PAR afterwards.
- **T11:** PAR can issue headings on the FINAL Strip; conformance follows Q3 (no altitude conformance on the PAR final
  once the approach clearance applies; heading per the order). Same question answered for the carrier final.
Gates: freeze/walk/soak:selfcheck/wire:record (Board ops, authority and wire change).

### 6. LT-STRIP-FIELDS (T7, T8, T31a) [R] then [H]
- **T8:** every label from the FAA block names (Q5 table) — abbreviated only as the FAA does; ours marked ours; the full
  name as the tooltip. **The human approves the label table before the build** (the supervisor puts it on the Decision
  Desk from the research output).
- **T7:** Block 3 edited as one field the FAA way (count / wake indicator / designator / suffix, Q4), no leading `/`
  without an indicator, a type that is not a designator shape refused; wake indicator values per Q4.
- **T31(a):** time fields say their format before a refusal (HHMM), e.g. in the placeholder/tooltip.
Both halves: the client template and the server block maps stay in parity (the parity test).

### 7. LT-MARSA (T14, T15, T16, T17) — ADR 0118 [R]
- **T14:** the "MARSA voided" notice: how long it stays and what dismisses it, then build it.
- **T15:** after a void, clicking a separation-responsibility field makes both Strips reorder; find the rebuild/reorder
  trigger (likely the MARSHAL-FIX lesson: a press re-renders the Strip, or the two signatures depend on each other); fix;
  spec with a real click.
- **T16:** no conflict alert between members of one formation (per Q7).
- **T17 / T18:** the tanker join is MARSA, not a formation Join (the receiver keeps its flight plan); no LEVEL_BUST/
  WRONG_WAY while the receiver is under MARSA with the tanker after the handoff to it — exactly as Q6 says.

### 8. LT-AIRSPACE-ALERT (T29, T27 using agency) — ADR 0119 [R][H]
- **T29 / H132:** an alert when a correlated airborne aircraft is inside an ACTIVE airspace without an approved entry for
  it (uses `activeContaining`, ADR 0098 §7); to the controlling Position and the Position working the flight; amber in the
  label, acknowledgeable, retracts on leaving or approval. Follow Q9's FAA equivalent if one exists, else labelled ours.
  Uncorrelated contacts per **LT-Q5**.
- **T27 (rights):** whether the using agency may create/schedule a MOA another Facility controls, per Q8 and the human.

### 9. LT-RSU-DESIGN → LT-RSU (T25) — ADR 0120
Rulings H130/H131: the RSU stays (ours, modelled on AETCI 11-204: the squadron flies Incirlik as a pilot-training base);
it **controls while active**, on **its own frequency**; **AP hands over to the RSU** directly; **only home-based
training** traffic goes to it; **the tower has no pattern board**; `IN_PATTERN` is renamed to say the RSU has the flight
(working name `WITH_RSU`), the board's columns keep the leg (closed, initial, break, base, final); tower circuits stay
ordinary ARRIVALs with LC. Design lane first: ADR 0120 + a mockup update of the pattern board for the human; the build
lane after approval (AP → RSU transfer, the RSU's frequency on the hand-off, the rename everywhere incl. the wire and the
glossary, LC's runway status authority unchanged).

### 10. LT-GROUND (T4) — ADR 0121 [H][R]
Only if the human approves **LT-Q1**: air-surveillance radars never present ground vehicles (amends ADR 0066; H6's "no
hiding" yields for vehicles only, aircraft on the ground unchanged unless the human says).

## Human questions for this batch (Decision Desk, round 8)

LT-Q1 (T4 ground vehicles), LT-Q2 (T6 empty stereo picker: hide or grey), LT-Q3 (T10 keep map → Strip selection),
LT-Q4 (T31 b/c: friction or user error), LT-Q5 (T29 uncorrelated contacts). The label table (T8) and anything
LT-RESEARCH raises are added when the research lands.

## Gates (every lane)

Both unit suites; crc-sync `npm run freeze` (goldens: `freeze:update` once, small diff, separate commit), `npm run walk`,
`npm run soak:selfcheck` when Board/wire/sync/hub files move, `npm run wire:record` on any wire change (protocol 2 locally,
release 1); module-graph fixture and the no-cycle / no-window-globals / html-sinks tests; Playwright only for the specs the
lane touched, on its own `E2E_LANE`, never the full suite (the supervisor runs it sharded after a client merge). Never
touch `crc-sync/state/` or :3000; never `pkill -f`.
