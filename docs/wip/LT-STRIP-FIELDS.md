# LT-STRIP-FIELDS (live test 2026-10-11: T7, T8, T31 a)

Branch `lane/LT-STRIP-FIELDS`, both sides. Built to **H134** (LT-RQ1 c, LT-RQ2 b, LT-RQ3 a, LT-RQ4 c), which overrides
the briefing where they differ. No ADR, no wire-protocol bump (`wire-protocol.test.mjs` green; the SetBlock frame is
unchanged, only which Blocks it may write).

## What changed, per finding

| Finding | Change | Files | Tests |
|---|---|---|---|
| **T7** wake (LT-RQ1 c) | The wake category is the **ICAO** one, **L / M / H / J**. A new flight data keeps a plan's ICAO wake (the DD-1801's WTC) and otherwise takes the one its type's row gives in a small table; a value that is not L/M/H/J (the old `D` seeds) is replaced the same way. A type with no row gets no wake (nothing made up). Writing the type (Block 3 or 3A, or an ATO re-import while the wake was the table's) re-derives the wake; a wake the controller types (Block 3 `F16/H`, or 3B) is the override. 3B takes only L/M/H/J or empty. | crc-sync `src/efsp/aircraft-data.js` (new: table, parser, normalisers), `flight-data-store.js` (`createFlightData` seed, `setField` 3A/3B validation and re-derive, `setAircraftData`, `applyAtoTasking`) | `tests/efsp-aircraft-data.test.mjs` (11) |
| **T7** Block 3 (LT-RQ2 b) | Block 3 is written in **ICAO order**: `F16/M`, `2/F16/M`, the equipment suffix last (`F16/M/G`); no leading `/`. It is **typed as one field**: the editor opens on `[count/]TYPE[/WAKE]` (placeholder `TYPE/WAKE`) and crc-sync parses it into the number of aircraft, the type and the wake, in one write. `M/F16` (wake first) is read as type F16, wake M. A type that is not a designator shape (2–4 letters/digits, letter first) is refused, and the refusal says the shape. | crc-sync `block-map.js` (Block 3 kind `composite` → `aircraft-data`, `resolveBlockTarget`), `board/ops/set-block.js` (routes it to `setAircraftData`); crc-desktop `strip-template.js` (`formatBlock3`, `aircraftDataEditText`, `editRedirectFor`, `isBlockEditable`), `bay/block-edit.js` | crc-sync `efsp-block-map.test.mjs`, `efsp-aircraft-data.test.mjs`; crc-desktop `efsp-strip-template.test.mjs`, `efsp-ui-a.test.mjs`, `efsp-block-map-parity.test.mjs` (Block 3's `aircraft-data` kind must match on both sides); `e2e/ui-a.spec.js` U4 |
| **T8** (LT-RQ3 a, RQ4 c) | Block 1's label is **ACID** on DEPARTURE, ARRIVAL and OVERFLIGHT; every other label is unchanged (MISSION's M3 and the carrier/pattern C1 stay CALLSIGN: no FAA strip). Every Block on the three FAA strip types has a label hover from the research's Q5 table: the FAA block name and number, "(ours)" where no FAA block carries it, "#≠" where our number differs from the FAA's. On a DEPARTURE time with a §10.5 source, the hover is the FAA name with the source under it. | crc-desktop `strip-template.js` (`BLOCK_TITLES` now per strip type, `blockTitleFor(blockId, flightData, strip, stripType)`), `strip-view.js` | `efsp-strip-template.test.mjs` (ACID, every Block titled, ours/#≠); `e2e/ui-a.spec.js` U4 |
| **T31 a** | Every typed time says its format before a refusal: the label hover ends "UTC HHMM" and the editor's placeholder is `HHMM` (every `ZULU_HHMM_BLOCKS` Block, the vul window M6/M7 and EEAT C15). | crc-desktop `strip-template.js` (`blockInputPlaceholderFor`), `bay/block-edit.js` | `efsp-strip-template.test.mjs` (every time Block on every map); `e2e/ui-a.spec.js` U4 (P-time placeholder) |

### The wake table's source

`crc-sync/src/efsp/aircraft-data.js` `WAKE_BY_TYPE`. Six rows are **quoted** from JO 7360.1K Appendix A's ICAO WTC
column as the research quotes it (Q4): F16 M, K35R H, B763 H, C130 M, T38 L, A10 M. **The rest are ours**: placed by the
ICAO Doc 8643 / Doc 4444 rule on maximum certificated take-off mass (L 7,000 kg or less; M above 7,000 and below
136,000 kg; H 136,000 kg or more; J the A388 only) from each type's published MTOW, for the airframes DCS flies (fighters,
heavies, helicopters, trainers). Not checked against a Doc 8643 listing in this lane (no copy read); a few designators
(F18H/F18S, HAR, GAZL, TEX2, Q1/Q9) are from memory and should be checked when someone has Doc 8643 open. A type not
in the table gets no wake until a controller types one.

## Defaults taken

1. **The wake first (`M/F16`) is accepted** and normalised to type F16, wake M (the briefing's either/or). A designator
   is never one character, so the two orders cannot be confused, and refusing the human's own first try would be friction.
2. **The equipment suffix is never typed in Block 3**: it is derived from the equipment codes (§3.3, unchanged). It is
   shown last, after the wake (`F16/M/G`, ICAO order then the FAA suffix, as ¶2-3-8 e speaks it "F-Sixteen slant Papa").
   Typing a third part (`F16/M/G`) is refused: "… (the equipment suffix comes from the equipment codes)". With a suffix
   and **no wake**, the wake's place stays empty (`F16//G`), so a suffix letter (`/H`, `/M`, `/L` are TBL 2-3-10 suffixes)
   is never read as a wake.
3. **The count is the formation size** (`identity.flightSize`): typing `2/F16/M` sets it, typing `F16/M` sets it to 1,
   as FAA Block 3 says. The editor opens on the current count, so an edit that does not touch it keeps it. Split/Join stay
   the way to split a formation into flights with their own codes; this is a correction of the number.
   Count range 1–99 (ICAO Item 9 is two digits; ours).
4. **An empty Block 3 is refused** ("Block 3 needs an aircraft type"): the FAA block is required. 3A may still be
   cleared from the expanded view.
5. **A type write re-derives the wake** (Block 3 without a wake, 3A, an ATO type while the wake was the table's or
   empty): a wake typed for the old type does not carry over to a new one.
6. **Seeds are not refused for shape**: CreateStrip / DD-1801 / ATO types are stored as given (only controller writes
   through 3 and 3A are checked). A non-designator seed shows as it came and can be corrected by typing Block 3.
7. **Format hints:** placeholders `HHMM` and `TYPE/WAKE` in the editor, and "UTC HHMM" in the label hover. No visible
   text on the Strip face (dark cockpit).
8. **MISSION, MARSHAL, FINAL, PATTERN** get no FAA tooltips (no FAA strip, Q5 table); only their typed times (M6, M7,
   C15) carry a hover, for T31 a.
9. The old TYPE cell's own hover ("Aircraft type (3A). Click to edit.") is gone: the label's hover names Block 3.

## Usage-guide wording (for the docs pass)

- **Block 3 (TYPE):** "TYPE shows the aircraft in ICAO order: the number of aircraft when more than one, the type
  designator, the ICAO wake category (L light, M medium, H heavy, J super) and the equipment suffix, for example
  `F16/M` or `2/F16/M/G`. Click it to change it and type `TYPE/WAKE`, with the number in front for a formation:
  `2/F16/M`. Leave the wake out and it is filled from the type when the type is one we know (`2/K35R` becomes
  `2/K35R/H`); type it to override. `M/F16` is read the same as `F16/M`. The equipment suffix comes from the flight's
  equipment and is not typed here. A type must be a designator (2 to 4 letters or digits starting with a letter, such as
  `F16` or `K35R`); `F-16` is refused."
- **Labels:** "Block 1 is labelled **ACID** (aircraft identification). Hover any label to see the FAA block it is: for
  example *Block 7, requested altitude*. *(ours)* marks a field the FAA strip does not have; *#≠* marks one the FAA
  numbers differently from us."
- **Times:** "Every time on a Strip is typed as four-digit UTC, `HHMM` (for example `1432`); an empty time field shows
  `HHMM` when you start typing, and its label's hover says so."

## Gates

- crc-sync unit: 2676 → 2687 (+11, `efsp-aircraft-data.test.mjs`; `efsp-block-map.test.mjs` reworded), all pass.
- crc-desktop unit: 1267 → 1272 (new T7/T8/T31 a tests in `efsp-strip-template.test.mjs`), all pass.
- `npm run freeze`: 33/56 goldens changed, re-recorded once (`freeze:update`), committed separately. Only hashes plus
  the op matrix's `SetBlock 3/3A/3B "77"`, now refused with a detail. 56/56 after.
- `npm run walk`: 23/23. `wire-protocol.test.mjs`: green, no `wire:record` needed.
- Module-graph fixture re-recorded (`GOLDEN_RECORD=1`): `strip-template.js` exports `aircraftDataEditText`,
  `blockInputPlaceholderFor`. No-cycle and no-window-globals tests green.
- Playwright lane 3: `e2e/ui-a.spec.js` 6/6 (U4 rewritten), `e2e/mtr-fields.spec.js` 7/7 (MTR titles reworded).

## Specs touched

`e2e/ui-a.spec.js` (U4: TYPE as one field, `M/F15E`, `2/K35R` → `2/K35R/H`, `F-16` refused and restored, ACID and its
title, the P-time `HHMM` placeholder); `e2e/helpers/app.js` (`seedStrip`'s wake `D` → `M`).

## Findings for other lanes / the supervisor

1. **Many test seeds still say `wakeCategory: 'D'`** (24 crc-sync test files, several e2e specs). Harmless (it is now
   replaced by the type's wake), but it reads like the CWT letter; a cleanup when someone is in those files.
2. **ATO and DD-1801 types are not checked for designator shape** (default 6). If a squadron ATO carries `F-16C`, its
   Strip shows `F-16C` and the first Block 3 retype must fix it. Whether to normalise ATO `MSNACFT` types is open.
3. **The wake table needs a Doc 8643 check** of the "ours" rows (see the source paragraph).
4. **The create-strip form** sends `wakeCategory: ''` (crc-sync now derives it); it has no Block 3 field of its own.
5. The docs (`efsp-usage-guide.md`, `efsp-briefing.md`) still describe Block 3 as `count+wake/type/suffix` with a
   leading `/`, and the TYPE cell as editing 3A (UI-A U4): replace with the wording above.
