# Briefing: U-JURISDICTION (server + client, wire change): whose airspace an aircraft is in — ADR 0125

Written 2026-10-13 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-JURISDICTION`, branch `lane/U-JURISDICTION`, `E2E_LANE=7`). **Commit at every green
step, at least every ~15 minutes.** ADR number **0125** (yours). Runs **before U-RELEASE**, which uses your answer to
move control at the boundary.

## Why

**H142–H145** (`decisions.md`, read all four whole): a not-released handoff moves control automatically once the aircraft is inside
the receiver's airspace. So the airspace system must know each controlling facility's **area of jurisdiction** and answer
"whose airspace is this aircraft in". FAA background: ¶2-1-15 a 1/c (control at a boundary), and
`docs/parallel/research/release-and-par.md` R1/R4.

## What to build

1. **A jurisdiction area** in the airspace system (`crc-sync/src/efsp/airspace-schema.js`, `airspace-store.js`,
   `airspace/containment.js`): a new kind next to `AREA`/`ROUTE` (e.g. `JURISDICTION`), with
   - the owning **Facility** (INCIRLIK, CARRIER, CENTER — the facility ids in `config/efsp-facility-*.json`) and the
     **Positions** whose airspace it is (TOWER → LC/GC, RAPCON → AP/PAR, H143),
   - an **airspace class** (`A`–`G`; Class G = nobody owns it, so it is never anyone's jurisdiction),
   - vertical limits in ft **MSL** (`altLowerFt`/`altUpperFt`; UNL = no upper),
   - geometry: a polygon (as today) **or a circle** `{ centre, radiusNm }` whose centre is either a fixed point or
     **anchored to a carrier hull** (follows the live ship position the carrier code already has).
2. **Shipped defaults, theater-wide config** (shipped in `config/`, a `state/` copy overrides it, strict like every
   `state/` file — use or extend `config/efsp-airspaces.json`'s theater keying, your call, ADR says which):
   - Syria: **Incirlik TOWER = the published LTAG CTR** (ICAO control zone, H145; **never label it bare "CTR"**, which is
     our Center Position: id e.g. `LTAG-CZ`, label "LTAG CTR (control zone)"), verbatim (AIP Türkiye AD 2 LTAG AD 2.17, page dated 14 MAY 26; "3000 FT AMSL/SFC", class "-"): *"Circle radius 5 NM centered
     on 370012N-0352530E except the part of the circle north west of a straight line joining 365906N-0351925E and
     370432N-0352837E. SFC-3000ft"* (3,000 ft MSL). Decimal: centre 37.003333 N 35.425000 E; chord 36.985000 N
     35.323611 E → 37.075556 N 35.476944 E (both end points on the circle; the chord is 2.0 nm NW of the centre; the
     field is on the kept side). Model it as a circle-minus-half-plane or as the equivalent polygon (arc points + chord);
     either way keep the source text in the config entry. Class D, owner Positions **LC, GC**;
   - Syria: **Incirlik RAPCON** (H142/H143) = the published **Adana MTMA** (AIP Türkiye ENR 2.1.3, AIRAC AMDT 08/26:
     "Centered on 365956N-0352559E, Radius 50 NM, FL280 / 2000FT AMSL", İncirlik Approach), centre **36.998889 N
     35.433056 E** (not the CTR's centre), **SFC – FL280** (the floor lowered to SFC by H143, ours), owner Positions **AP, PAR**
     (and any SFA/approach Position of INCIRLIK); class: pick a terminal class and label it ours (the class does not change
     ownership here: H143 overrode the "Class E below 2,000 ft is CENTER's" reading);
   - **CARRIER**: 50 nm circle on the hull, **SFC – UNL**, owner the CARRIER Positions (every hull in `efsp-carriers.json`);
   - **CENTER**: everything not inside another jurisdiction area — not drawn as a shape, it is the fallback; Class E.
     **Class G** areas (none shipped) belong to nobody.
3. **No overlap between static areas** (H144): two non-carrier jurisdiction areas never share any volume. The shipped
   RAPCON is the 50 nm circle **with the tower's volume cut out** (a cut-out/hole in the geometry, or an `excludes` list
   naming the tower area — your design, the ADR says which); CENTER is the complement of all of them. The validator
   (config load, `state/` load, and every panel edit) **refuses** an area that overlaps another static area, naming
   both; a 3D check (lateral overlap and altitude bands overlapping). **The carrier circle is the only area allowed to
   overlap**, and wherever it is it wins over everything (it moves; static airspace cannot follow it).
4. **One server function** `jurisdictionAt({ lat, lon, altFt })` → the owning area (Facility + Positions) or `null`
   (Class G), plus `isInsideJurisdictionOf(positionId, track)` (the receiving Position's area, CTR = the fallback); unit-tested at edges (boundary counts as inside, the floor/ceiling, the
   overlap order, a moving hull). U-RELEASE will call it from the control settle tick.
5. **Editable in the airspaces panel** (client `airspace-panel.js`, `airspace-editor.js`, `airspace-geometry-editor.js`):
   jurisdiction areas listed in their own section, editable (geometry, limits, class), with the carrier anchor shown
   read-only. Default rights (log it): a facility's area is edited by its controlling Positions — AP for RAPCON, LC for TOWER,
   CV_PRIFLY/CV_MARSHAL for CARRIER (as the carrier management panel, H119) — refusals through the existing airspace
   permission path. Drawn on the map as a thin grey outline (dark cockpit), off by default in the map layers if the map
   gets busy.
6. No release/handoff behaviour in this lane: only the areas and the query.

## Tests and gates

Both unit suites; `npm run walk`; `npm run freeze` (+ `freeze:update` with a small, explained diff, separate commit);
`soak:selfcheck` if Board/wire/hub moved; `npm run wire:record` (new airspace kind/keys). e2e: the airspaces panel shows
the TOWER, RAPCON and carrier areas; AP edits RAPCON's ceiling; an edit pushing RAPCON into another static area is refused; a Position without the right is refused. `E2E_LANE=7`, your specs.

## Output

Commits on `lane/U-JURISDICTION`; ADR 0125 (cites ¶2-1-15; says plainly which numbers are the human's and which are
ours); `docs/wip/U-JURISDICTION.md` (usage-guide wording, defaults, any `state/` action for the human); final message
per lane-rules rule 8.
