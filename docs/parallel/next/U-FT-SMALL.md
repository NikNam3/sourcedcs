# Briefing: U-FT-SMALL (client + server): small fixes from the final test of 2026-10-24

Written 2026-10-24 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-FT-SMALL`, branch `lane/U-FT-SMALL`, `E2E_LANE=8`). No ADR unless an item turns
out to be a design decision (then ask the supervisor for a number). Read H163 in `decisions.md`; H160 binds you
(design for N, no literal Position ids in code, rule 9). Dark cockpit (grey unless a problem, show only what the
controller needs).

**Running beside you:** U-SURFACE (airport surface: `airport-surface.js`, `map-style.js`, `atc-scope.js`
`atcBlackScope`, `facility-schema.js`, the snapshot in `efsp-ws.js`, `efsp-state.js`) and U-LTAG-COURSE
(magnetic/projection, read-mostly). Keep out of their files where you can; if you must touch `atc-scope.js`, only add,
do not reshape.

## Items (commit each one separately, green)

1. **Bullseye cursor readout.** The topbar bullseye readout (`panels/topbar.js` `updateBullseyeCursor`, fed from
   `map-interactions.js`) is (a) hidden while the session is ATC-only, using the rule that already exists for it,
   `atc-scope.js` `atcOnlySession()` (every Position held is ATC; signed on to nothing or any tactical Position = shown),
   live on sign-on/off (`positions` change-bus topic); and (b) **blank whenever the cursor is not over the map**
   (mouseleave of the map canvas, and over a panel that covers the map). Same for the measure readout only if it
   shares the element; do not change the measure tool otherwise.
2. **STARS letters not centred in their circles.** The position-symbol letters (`positionLetters`, the STARS scope
   target symbols, `atc-scope.js` / the layer that draws them) sit off-centre in their circle. Centre them (text-anchor
   / text-offset / glyph baseline in MapLibre, or the canvas icon). Check at the sizes the scope uses and after the
   bundled-glyph change (U-GLYPHS: Roboto, not Mono). A screenshot before/after in the wip note.
3. **Heading-turn grace too short for big turns** (server, `crc-sync/src/efsp/conformance.js`, `config/alerting.json`).
   Today a fixed `headingGraceSec: 30`, so a 180° turn at standard rate (60 s) alerts mid-turn. Make the grace
   dynamic: the time to turn the assigned amount at a configured rate (standard rate 3°/s, a new alerting key) plus a
   margin (new key), measured from the assignment; direction = the shorter way unless the assignment says LEFT/RIGHT
   (check what `activeClearanceEntry(..., 'heading')` carries). **Continuity:** during the grace, alert (after
   `headingPersistSec`) if the aircraft is not turning toward the heading, i.e. the remaining turn stopped shrinking
   (levelled off on a wrong course, or turning the wrong way); captured stays as today. Wall clock for durations
   (rule 5). Unit tests: 30°, 90°, 180° turns at 3°/s pass with no alert; levelling off at 120° of a 180° turn alerts;
   wrong-way turn alerts. Freeze/walk goldens may move: `freeze:update` in a separate commit, explain the diff.
   Run `npm run soak:selfcheck` (you touch no listed file, but conformance feeds the hub; run it once).

**Held until the human answers (the supervisor will SendMessage you; until then do 1–3 only):**

4. Radar coverage overlay default (FT-Q1).
5. Clearance Delivery creating Strips (FT-Q2): today `CREATE_STRIP_TYPE_PERMISSIONS` in
   `crc-sync/src/efsp/authority/positions/civil-atc.js` gives OPS only DEPARTURE, CD none.
6. LC departure Strips show P/S, OPT and HOOK (FT-Q3): `strip-fields.js` ~93/99 (`9J-ENTRY`, `9J-OPTION`, `3F` on
   the LC DEPARTURE grid; ADR 0126 put P/S and OPT there for pattern work).

## Gates

Unit tests per item; both unit suites once before the report; `npm run walk`, `npm run freeze`; `wire:record` only if
you change the wire (you should not). Specs: `l22-stars-scope`, `smoke`, and any spec covering the topbar readout, on
`E2E_LANE=8`. Every command under `nice -n 19`. Output `docs/wip/U-FT-SMALL.md`; final message per rule 8.
