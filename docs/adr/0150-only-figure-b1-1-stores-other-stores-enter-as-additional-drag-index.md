# 0150: Only Figure B1-1 stores; other stores enter as an additional drag index

**Status.** Accepted (TOLD step 0 design review, 2026-10-28). Spec: `docs/wip/TOLD.md`, "Goal and principles" 3 and
section 5.3.

## Context

Drag index and store weights come from Figure B1-1 (sheets 1 to 7) of the manual. DCS carries stores the HAF supplement
does not list. A calculator could estimate a drag index for those from a similar store, or import a loadout and a gross
weight from DCS or a `.miz` file. Either gives a number that is not in the manual (ADR 0148).

## Decision

1. **Only Figure B1-1 stores are selectable.** The drag index is the basic aircraft plus the B1-1 stores per station
   (tank values depend on what is at stations 3 and 7, tip values are deltas to the AIM-9 baseline) plus the pilot's
   additional drag index (`src/core/inputs/`, the drag index builder).
2. **Any other store enters as an additional drag index**, typed by the pilot. perf never estimates one.
3. **Gross weight is entered by hand**, read off DCS by the pilot, in this and every later version. It is never
   imported.

## Consequences

- Figure B1-1 is extracted as tables (by word position, columns declared in the spec, row and column counts asserted,
  printed back once for a person to compare against the page). Step 0 does this.
- A store missing from B1-1 is the pilot's responsibility, as it is with the paper charts.
- A store import later (from `tools/miztoyaml` and `data/weaponsdata.json`) is possible and would only fill B1-1
  stations. It never sets the gross weight.
- Step 3's flight plan carries gross weight from leg to leg and gives the landing weight from the plan; the start is
  still the typed value.
