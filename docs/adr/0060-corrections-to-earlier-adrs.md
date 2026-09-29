# 0060 — corrections to earlier ADRs, and the rule for making them

## Context

A read of all 59 ADRs before the parallel work waves found no conflicting live decisions among the
permission, airspace, correlation and MARSA ADRs. It did find three kinds of problem:

- **wrong citations and wrong facts** — an ADR pointing at the wrong ADR, or stating something about
  the tree that is not true;
- **decisions later reversed without the earlier ADR saying so**, so a reader of the older ADR
  finds a rule that no longer holds and nothing pointing onward;
- **no settled rule for how a correction is made.** `0022` and `0048` say corrections go in new
  prose and an ADR is never edited afterwards, while `0014` and `0016` carry appended "Update"
  sections.

## Decision

### The rule

**An ADR is never edited once committed. A correction is new prose, in a new ADR.** This one is the
first made under that rule. `0014`'s and `0016`'s "Update" sections are historical and are not a
precedent. A later ADR that changes an earlier decision names the earlier ADR and the specific
statement it overturns, so a reader of the new one can find the old one. A reader of the old one
should check this file and later ADRs before relying on it.

One exception is on record: `0058` gained a "Notes" section after it was committed, at the
controller's explicit direction, on the same day this rule was adopted. It is the last such edit.

### Wrong citations and wrong facts

| ADR | It says | The truth |
|---|---|---|
| `0026` | *"`M1`–`M8`/`M25`/`M26` stay exactly as defined here"* | Its table defines `M1`–`M8` only. `M25`/`M26` were never defined by it. |
| `0037` | *"as docs/adr/0027's void-time addition demonstrated"* | `0027` is the terminal-Drop ADR. No ADR records adding `VOID_TIME_EXPIRED`; it was added as the fifth forwarding obligation in the WP4 work, without an ADR of its own. |
| `0039` | *"`VOID_TIME_EXPIRED`, the fifth forwarding obligation (docs/adr/0031)"* | `0031` is the TOFI eligibility gate. Same answer as above. |
| `0041` | *"docs/adr/0039 had just made `isBlockVisible` authoritative on the write path"* | `0039` does not mention it. `_applySetBlock` refusing a Block its Facility hides was added in the same pass as `0039` without being recorded; `0041` is the first ADR to state it. |
| `0042` | adds a `crc-sync-data:/app/data` volume for the terrain cache | The cache lives on `crc-sync-state:/app/state` (`0044`, `0048`). Nothing is mounted over `/app/data`. |
| `0044` | *"`crc-sync/data/` is gitignored"* | `crc-sync/data/icao.json` is tracked: `data/` holds shipped reference tables. `state/` is what is gitignored. |
| `0048` | its directory block reads *"`data/` — everything written at runtime. A volume in the compose stack."* | Its own prose, `state-paths.js` and `CLAUDE.md` all say **`state/`**. The block's `data/` is a leftover from before the directory was renamed. |
| `0059` | *"Military positions and radars do not do collision avoidance the way ATC does."* | Stated as fact, it presents a squadron decision as doctrine (defect D11). What is true: the controller decided that STCA goes to ATC Positions only. That scoping is `[SOURCE-DEFINED]`. |
| `0054` | *"(Note the correct reason — accepting an ENTRY does not write `separationRegime`; see `0053`.)"* | `0053` is what made an ENTRY accept write the regime. The note describes the state of the code before `0053`, not after it. |

### Decisions later reversed, and what now holds

| Earlier ADR says | Reversed by | What holds now |
|---|---|---|
| `0010`: auto-transferring a Strip as part of its NLA is rejected; *"OPS must explicitly transfer the Strip to CD before anyone can press Mark Cleared."* | `0012` | Every NLA transition that crosses a Position boundary transfers the Strip. `0012` does not name `0010`'s rejection; it is named here. |
| `0023` (restated as a rationale in `0030`): Convert to Arrival resets `annotations`, `flags` and `correlation`. | `0040`, `0045` | Annotations and flags are archived as `previousLeg` (`0040`). `strip.correlation` no longer exists; correlation is keyed by `fdrId` and survives the conversion (`0045`). |
| `0008`: ARRIVAL Block `7` is annotation-routed with `confirmVacated`; Blocks `20`/`21` are to be revisited once WP5 lands. `0024`'s label table (`ALT` filed/assigned). | `0047`, `0058` | `20`/`21` stay Strip-local scratchpads on ARRIVAL and OVERFLIGHT (`0047`). ARRIVAL `7`, OVERFLIGHT `7A` and DEPARTURE `20`/`21` target the flight's clearance on the FDR, labelled `ALT`/`HDG`, and the filed Block `7` is `CRUS ALT` (`0058`). |
| `0055`: a chip shows up to two struck priors and a `*` overflow indicator; the actions row is pinned. | `0056` | One struck prior in the label line, then `+N`, which opens the expanded view. The actions row is replaced by Layout C's tab and tools. |
| `0056`: indicators are fixed slots, always drawn, dim when off. | `0058` | Indicators appear only when something is wrong or in effect. `0058` says so itself. |
| `0042`: `groundLabels` and label offsets stay in the renderer as per-viewer annotations. | `0059` | A ground vehicle's or ship's label is the shared tag (collab rename). Label offsets remain per-viewer. |
| `0046`: *"match on raw, display resolved"*, with the badge showing the contact's resolved callsign, and the squawk-map negative test. | `0059` | Matching is still on the raw DCS callsign and now on the code the transponder is sending. The label is the Strip's callsign once correlated, so the badge shows the contact's code or track number. The squawk map is gone. `0059` says so itself. |
| `0021`: obligation alerts are fire-and-forget broadcasts. | `0045` and `0051` name this as a known defect; the fix is ADR `0067` (wave-1 lane L7). | Until `0067` lands, `0021`'s description is still accurate. |

## Consequences

- The corrections above are the whole list found by the read. A later correction adds a new ADR
  rather than editing this one.
- Every lane in the parallel plan (`docs/efsp-parallel-plan.md`) follows the rule: a lane that
  changes an earlier decision writes its own ADR, never an "Update" section.
- `docs/parallel/decisions.md` P4 carries the same rule for the lanes.
