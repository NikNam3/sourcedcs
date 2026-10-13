# Briefing: U-JURISDICTION (server + client, wire change): whose airspace an aircraft is in — ADR 0125

Written 2026-10-13 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-JURISDICTION`, branch `lane/U-JURISDICTION`, `E2E_LANE=7`). **Commit at every green
step, at least every ~15 minutes.** ADR number **0125** (yours). Runs **before U-RELEASE**, which uses your answer to
move control at the boundary.

## Why

**H142** (`decisions.md`, read it whole): a not-released handoff moves control automatically once the aircraft is inside
the receiver's airspace. So the airspace system must know each controlling facility's **area of jurisdiction** and answer
"whose airspace is this aircraft in". FAA background: ¶2-1-15 a 1/c (control at a boundary), and
`docs/parallel/research/release-and-par.md` R1/R4.

## What to build

1. **A jurisdiction area** in the airspace system (`crc-sync/src/efsp/airspace-schema.js`, `airspace-store.js`,
   `airspace/containment.js`): a new kind next to `AREA`/`ROUTE` (e.g. `JURISDICTION`), with
   - the owning **Facility** (INCIRLIK, CARRIER, CENTER — the facility ids in `config/efsp-facility-*.json`),
   - an **airspace class** (`A`–`G`; Class G = nobody owns it, so it is never anyone's jurisdiction),
   - vertical limits in ft **MSL** (`altLowerFt`/`altUpperFt`; UNL = no upper),
   - geometry: a polygon (as today) **or a circle** `{ centre, radiusNm }` whose centre is either a fixed point or
     **anchored to a carrier hull** (follows the live ship position the carrier code already has).
2. **Shipped defaults, theater-wide config** (shipped in `config/`, a `state/` copy overrides it, strict like every
   `state/` file — use or extend `config/efsp-airspaces.json`'s theater keying, your call, ADR says which):
   - Syria: **Incirlik RAPCON** circle 50 nm on the Incirlik field reference point, **2,000 ft – FL280**, class you pick
     (D/C-like terminal; record it as ours), owner INCIRLIK;
   - **CARRIER**: 50 nm circle on the hull, **SFC – UNL**, owner CARRIER (every hull in `efsp-carriers.json`);
   - **CENTER**: everything not inside another jurisdiction area, **Class E** — not drawn as a shape, it is the
     fallback (so below 2,000 ft inside the RAPCON circle is CENTER's, H142).
3. **Precedence on overlap**: CARRIER > RAPCON (INCIRLIK) > CENTER. Put the order in the same config (an ordered list,
   the LOA stand-in, labelled ours), not in code.
4. **One server function** `jurisdictionAt({ lat, lon, altFt })` → owning Facility id or `null` (Class G), plus
   `isInsideJurisdictionOf(facilityId, track)`; unit-tested at edges (boundary counts as inside, the floor/ceiling, the
   overlap order, a moving hull). U-RELEASE will call it from the control settle tick.
5. **Editable in the airspaces panel** (client `airspace-panel.js`, `airspace-editor.js`, `airspace-geometry-editor.js`):
   jurisdiction areas listed in their own section, editable (geometry, limits, class), with the carrier anchor shown
   read-only. Default rights (log it): a facility's area is edited by its controlling Positions — AP for INCIRLIK,
   CV_PRIFLY/CV_MARSHAL for CARRIER (as the carrier management panel, H119) — refusals through the existing airspace
   permission path. Drawn on the map as a thin grey outline (dark cockpit), off by default in the map layers if the map
   gets busy.
6. No release/handoff behaviour in this lane: only the areas and the query.

## Tests and gates

Both unit suites; `npm run walk`; `npm run freeze` (+ `freeze:update` with a small, explained diff, separate commit);
`soak:selfcheck` if Board/wire/hub moved; `npm run wire:record` (new airspace kind/keys). e2e: the airspaces panel shows
the RAPCON and carrier areas; AP edits RAPCON's ceiling; a Position without the right is refused. `E2E_LANE=7`, your specs.

## Output

Commits on `lane/U-JURISDICTION`; ADR 0125 (cites ¶2-1-15; says plainly which numbers are the human's and which are
ours); `docs/wip/U-JURISDICTION.md` (usage-guide wording, defaults, any `state/` action for the human); final message
per lane-rules rule 8.
