# 0062 — §9.4's MTR fields: six plain FDR Blocks, a field-grid row that appears only for an MTR flight, and the lost-comms rule as a note

## Context

Guide §9.4 (Military Training Routes) asks for two things. The first is the fields of §6.4's `M10` (MTR designator, entry fix, entry time) and `M11` (exit fix, exit estimate, requested altitude after exit). The guide says the `M11` items are "precisely what a controller asks for by voice and must post". The second is a lost-comms rule, "to implement as an advisory": separate assuming the aircraft keeps **the higher of** the minimum IFR altitude for each remaining segment **or** the highest altitude in the last clearance.

ADR `0052` settled the shape and deferred the surface. It seeded `fdr.military.mtr` with its six keys as `null` and gave it no write path. It reserved the Block ids `9G-*`/`9H-*`, and it wrote the reservation into `MILITARY_BLOCK_NAMESPACE` as two wildcard rows that the drift test skipped. Its reason was that `M11` wants prominent placement, and that placement belonged to §9.4. ADR `0056` placed the deliverable in one line: "§9.4 MTR fields → the field grid of the Positions that fly MTRs".

Three decisions from the round-1 questions bind this ADR. **H23**: the squadron flies MTRs, Syria is treated as if under US regulation, and the route list arrives later, so the fields are free text for now. **H24**: the Positions that show the MTR group follow the briefing default below. **H25**: there is no history cell in this slice; the gap is recorded and fixed once for every `fdr` Block later. **H51**: the human approved the Strip mockup (`docs/wip/L2-mockup.html`). **S-L2a** (the supervisor, on questioner Q43) corrected one point of the briefing: the two times are stored as epoch ms, not as `HHMM` strings.

### What this supersedes

Per P4, `0052` and `0056` are not edited. This ADR replaces the following parts of them:

- **From `0052`:** the reservation of `9G-*`/`9H-*` (its table rows for `M10`/`M11`), the statement that `mtr` is "present and unpopulated, no setter", and the paragraph under *Alternatives considered* about adding the MTR Blocks later. The Blocks exist now, and the six leaves of `mtr` are writable through `setField()`. `mtr` as a whole is still not writable, and `setMilitary()` still refuses it.
- **From `0056`:** the per-Position field lists gain a **conditional** MTR group, described below. `0056`'s table is otherwise unchanged.

## Decision

### Six Blocks, plain `fdr`, on every ATC Role

| Block | Guide | FDR path | Label |
|---|---|---|---|
| `9G-MTR`   | M10 designator | `military.mtr.designator` | `MTR` |
| `9G-ENTRY` | M10 entry fix | `military.mtr.entryFix` | `ENTRY` |
| `9G-TIME`  | M10 entry time | `military.mtr.entryTimeUtc` | `ENTRY TM` |
| `9H-EXIT`  | M11 exit fix | `military.mtr.exitFix` | `EXIT` |
| `9H-TIME`  | M11 exit estimate | `military.mtr.exitEstimateUtc` | `EXIT EST` |
| `9H-ALT`   | M11 requested altitude after exit | `military.mtr.requestedAltitudeAfterExit` | `EXIT ALT` |

- **On DEPARTURE, ARRIVAL and OVERFLIGHT; none on MISSION.** A MISSION Strip shares its `fdrId` with the ATC Strip, so a MISSION Block would be a second place to post one aircraft's MTR data. This is the same reasoning as `3F`/`3G` in `0052`.
- **Split per field, like `9A-*`,** so a Facility can hide one Block with `hiddenBlocks` without hiding the others.
- **Plain `fdr` target kind, not `military`.** The values are free text, times and an altitude, not an enum or a boolean. They go through `setField()` like every other filed field, with its length cap, refusal path and provenance. `MILITARY_WRITABLE_FIELDS` does not grow.
- **No `interlock` tag.** `9H-ALT` is the pilot's **request**, and posting a request issues nothing. If the controller approves it, they write ALT (the clearance), which is tagged and does void MARSA before rendezvous. The scenario walks both.
- **Each Block sits at the end of its Role's 9-family** in both Block Map copies, so the expanded view lists it next to the route.

`MILITARY_BLOCK_NAMESPACE`'s `M10`/`M11` rows name the real Blocks with a new `blocks: { id: path }` shape. Single-Block rows keep `blockId`. The drift tests now check both shapes on every ATC Role, fail if a wildcard row comes back, and fail if a `military.*` fdr Block exists that no row claims.

### What each field accepts (`fdr-store.js`'s `normalizeMtrValue`)

- **Designator and fixes:** any text within the free-text cap, trimmed and upper-cased. `''` clears to `null`. **No format rule.** There is no MTR route table yet (H23), so any grammar for designators or fixes would be invented (D11). Upper-casing is the strip convention, not validation.
- **The two times:** typed as `HHMM`, `HH:MM`, with an optional trailing `Z`. They are **stored as epoch ms**, like every other `…Utc` field (S-L2a), and dated by the **mission clock** (H11, ADR `0079`), never the wall clock. A finite number is taken as epoch ms already. Anything else is refused with `MTR exit estimate must be a UTC time as HHMM, e.g. 1432` (or *entry time*), and a refusal leaves the FDR byte-identical. The client shows these two Blocks as `HHMM` (`strip-template.js`'s `ZULU_HHMM_BLOCKS`), so the edit cell opens on `1432` and sends back what the controller typed.
  - **Which day** a typed time lands on: the occurrence of that time nearest the mission's now, within ±12 h. So `0010` typed at `2350Z` means tomorrow, not 23 hours ago. This rule is ours, `[SOURCE-DEFINED]`, and lives in a new pure module, `crc-sync/src/efsp/zulu-time.js` (`parseZuluHhmm`, `resolveZuluHhmm`, `formatZuluHhmm`), for the other typed time Blocks to reuse (see Consequences).
- **Requested altitude after exit:** anything `parseAltitudeFt()` accepts (`FL210`, `080`, `8000`, `A050`), stored as the controller wrote it, upper-cased and without spaces. A block altitude (`FL190B210`) is refused, because the guide's field is singular.

### Placement: a row that appears only when the flight has MTR data

The field-list criterion (`strip-fields.js`, ADR `0056`) is edit frequency, and most flights never fly an MTR. Six always-on columns at APP/CTR would cost Strip height on every Strip for data few flights carry. The guide still wants `M11` prominent rather than buried in ▼. So:

- `compactBlocksFor(role, positionId, fdr)` takes an optional FDR. **When any of the six MTR fields has a value**, the Position's MTR list is appended to its field list. Without an FDR, or with no MTR data, the result is exactly what it was.
- The trigger is **any** field, not the designator. A controller who clears the designator but leaves an exit fix must still see that exit fix on the Strip, not have it vanish into ▼ while it is still on the flight.
- **The group starts its own grid row at column 1**, using one CSS rule keyed on `9G-MTR`, which every list starts with. It therefore sits in the same columns on every MTR Strip in a Bay, whatever wrapped above it (`0056`'s "a field sits in the same place on every Strip of a Bay").
- **`M11` first:** `MTR · EXIT · EXIT EST · EXIT ALT`, then `ENTRY · ENTRY TM`.
- **Prominence comes from position and grouping, never colour.** Colour means something is wrong (`0056`/`0058`).
- An MTR write bumps `fdr.rev`, which is already in the Strip's render signature. The row appears and disappears on every Strip of the flight, at every Facility, with no extra wiring.

Per Position, `[SOURCE-DEFINED]` (H24 accepted this default; a squadron member should confirm it):

| Role | OPS | CD | GND, TWR | APP, CTR |
|---|---|---|---|---|
| DEPARTURE | `MTR ENTRY ENTRY TM` (OPS files the flight) | `MTR` (read into the clearance) | none | all six, `M11` first |
| ARRIVAL | — | — | none | `MTR EXIT EXIT EST EXIT ALT` (entry is history on an arrival) |
| OVERFLIGHT | — | — | — | all six, `M11` first |

GND and TWR get none, for the same reason FREQ is kept off them: ground movement and the runway do not use MTR data. MISSION has no Blocks at all. A Position no list names reaches all six in ▼, as it reaches every other Block.

### The lost-comms rule is a note, not a warning

`0058` says a Strip shows nothing when nothing is wrong, and that reason lines (amber ▲) are for things that are wrong or blocked. An MTR flight with working radios is not wrong. So the advisory is **not on the collapsed face**. It appears in two places, and only for a flight with MTR data:

1. **A grey note at the top of the expanded (▼) view** (`efsp-expanded-note efsp-mtr-lostcomms`), not a reason line and not amber.
2. **The hover title of the `EXIT ALT` label**, because that is the field a controller is looking at when the question comes up.

The text (`strip-fields.js`'s `mtrLostCommsAdvisory`; the wording is `[SOURCE-DEFINED]`, the rule is the guide's):

> Lost comms (§9.4): separate assuming the higher of the minimum IFR altitude for each remaining segment — not available in this system — or the altitude in the last clearance: **FL180**.

"The last clearance" is the ACTIVE entry of `fdr.clearance.altitude` (`0058`), shown as the controller wrote it. If there is none, the text says "none posted (ALT is empty)". The advisory **never computes a lost-comms altitude**, because there is no minimum-IFR-altitude data for any segment. It never reads `9H-ALT`, which is a request, not a clearance. It always says the MIA half is unavailable, because showing only the half we hold would present the advisory as complete (D11). It cites §9.4, not a regulation.

### Amendment semantics

An MTR write goes through `setField()`, so it bumps `fdr.updatedAt`, not `clearanceUpdatedAt`. `AMENDMENT_INSIDE_30MIN` therefore fires when MTR data is posted to a DEPARTURE within 30 minutes of proposed departure. That is correct: the MTR is part of the filed plan, and posting it then is an amendment. On an airborne flight the proposed departure time is in the past, so the obligation cannot fire. Conformance (`conformance.js`) does not read `9H-ALT`.

## Alternatives considered

**Always-on MTR fields at APP and CTR.** This is simpler, since `compactBlocksFor` would need no third argument. But it costs up to six columns on every APP/CTR Strip for data most flights never carry, which goes against `strip-fields.js`'s own criterion and `0055`'s density finding. If the squadron ever wants it, the lists move into `COMPACT_BLOCKS_BY_POSITION` and nothing else changes.

**MTR as an indicator or badge.** Rejected. Indicators are for things that are wrong or in effect (`0058`), and an indicator is not a control (`0056`). An MTR is data a controller edits.

**The lost-comms rule as a permanent reason line on every MTR Strip.** Rejected. It breaks `0058`, and an amber line that is always there trains the controller to ignore amber. An indicator slot is rejected for the same reason.

**Computing a lost-comms altitude from `9H-ALT`.** Rejected. That field is a request, and the rule says "last clearance". The other half of the rule has no data behind it.

**The `military` target kind and `setMilitary()`.** Rejected. That kind is for an enum or a boolean behind a patch setter. Using it here would make the namespace drift test require `setMilitary` to write `mtr`, which would empty the deferred-field guard of meaning.

**Times as `HHMM` strings.** This was the briefing's default, because a spoken estimate has no date. Overruled (S-L2a). Every other `…Utc` field is epoch ms, and a typed string stored where readers expect ms is the known time-Block bug (Q43). Dating the typed time against the mission clock's nearest occurrence answers the missing-date objection.

**A §3.7 history cell for the MTR fields.** Deferred (H25).

## Consequences

- **The §3.7 gap, stated plainly.** Guide §3.7 rule 1 says amending a Block MUST append, not overwrite. These six fields overwrite. After "request exit at E instead", the old exit fix `F` is kept **nowhere**: not on the FDR, and not in the Mutation log either. `_recordAudit` logs Strip snapshots and `op.kind`, not the FDR or `op.value`. The same is already true of every plain `fdr` Block (route, stereo, remarks). H25 records this as one fix for all of them later, probably a `clearance`-style history cell (`0058`'s shape) on the FDR.
- **Changing the designator does not warn about a stale exit fix.** Posting `IR109` over an exit fix entered for `IR107` leaves the old fix on the face, with nothing to say it may be stale. Without a route table nothing can know whether the fix belongs to the new route. This belongs with the route list (H23).
- **`zulu-time.js` is meant for reuse.** The other typed time Blocks (`6`, `14`, `14B`–`14D`, `16`–`18`, `M6`/`M7`) still store whatever string the cell sends where readers expect epoch ms, and they render the raw number. That is the §10.5 time work's bug to fix (L16). It should reuse `resolveZuluHhmm` on the server and add those Blocks to the client's `ZULU_HHMM_BLOCKS`, not write a second rule.
- `strip-view.js` and `bay-view.js` each pass the FDR to `compactBlocksFor`. The face and the expanded view must agree on what is on the face, or a Block ends up on both or on neither. `efsp-ui-reachability.test.js` holds this with an MTR FDR. `strip-view.js` also sets the label's `title` from `blockTitleFor()`.
- **Walked:** the sortie scenario (`crc-sync/tests/efsp-scenario-mtr.test.mjs`) posts at OPS and CTR, reads on the INCIRLIK Strip, amends the exit, keeps MARSA through the request and voids it on the approval, refuses bad input, cancels, checks the amendment obligation, checks narrowing per Block, and restarts. A two-controller Playwright walk of "request a different exit fix" is written up in `docs/wip/L2.md`. **Not walked:** a real DCS mission clock (e2e runs on the wall-clock fallback), and whether squadron controllers actually want the group at OPS and CD.
