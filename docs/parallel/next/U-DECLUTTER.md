# Briefing: U-DECLUTTER (server + client): the declutter list, ADR 0121

Written 2026-10-16 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-DECLUTTER`, branch `lane/U-DECLUTTER`, `E2E_LANE=8`). **Commit at every green
step, at least every ~15 minutes; one commit per item.** ADR number **0121** (reserved for LT-GROUND since the live
test; yours).

Running beside you: **U-SMALL** (lxsrs_v2, soak, TOFI, ⋯ menu, LUAW text, aircraft types/wake, stale comments) and
**U-MOA-TRANSIT** (docs only). Stay out of their files; you own `track-label.js`, `surveillance/presentation.js`, the
Settings RADAR tab, `map-layers-overlays.js`, `geojson.js` and the `KEEP IFR` label.

## Why

H6 deferred every declutter behaviour to the end of the EFSP work; the queue is there now (only U-CARRIER and
U-MOA-TRANSIT's build remain). Dark cockpit (H115–H119): an alert is never hidden by declutter. H128 FAA model, always.

## Items, in this order

1. **LT-GROUND, ADR 0121** (H134 LT-Q1 c, LT-RQ11 a; T4 in `docs/parallel/live-test-2026-10-11.md`): **air-surveillance
   radars never present ground vehicles.** Amends ADR 0066 ("nothing is hidden on the ground"): real airport/approach/
   en-route/GCI radars drop surface vehicle returns (MTI / clutter processing; surface movement is ASDE, not modelled).
   Aircraft on the ground stay as they are. Where: `crc-sync/src/surveillance/presentation.js` (`domainOf()` /
   `presentTrack()`, the single choke point). Check every consumer that counts contacts (entry alert, MCI, CA, the
   airspace card list, correlation) still behaves; a ground vehicle with a transponder or datalink: decide from the
   sources and say so in the ADR. Freeze goldens may move.
2. **T30**: a per-controller switch in Settings → **RADAR** (default on) hiding the orange conflict-alert drawings
   (layers `conflict-alert-paths` / `conflict-alert-cpa-line`, `map-layers-overlays.js` ~l.193, built in `geojson.js`
   ~l.87). The `CA` tag in the data block and the alert itself stay.
3. **¶5-4-6 e NOTE**: show the received beacon code on the data block only when it does not match the assigned code
   (`crc-desktop/app/public/js/track-label.js`, the only place a contact becomes text). Quote the paragraph in the
   commit and the wip note.
4. **`KEEP IFR` on a flight-following Strip** (briefing §4 row l.~1600, U3 l.~1129): a flight-following (VFR) Strip
   should not show `KEEP IFR`; find where the label is drawn and why it reaches those Strips.

## Tests and gates

Run the test files you touch while working; before the report both unit suites, `npm run walk`, `npm run freeze`
(`freeze:update` in its own commit if goldens move, explain the diff), `npm run wire:record` if the wire surface moves
(it should not). Module-graph fixture re-record if client exports change. e2e: only specs for what you changed
(settings RADAR tab, data block, Strip label), `E2E_LANE=8`.

## Output

Commits on `lane/U-DECLUTTER`; ADR 0121 (sources quoted, what is ours labelled); `docs/wip/U-DECLUTTER.md` (usage-guide
wording for the docs pass, defaults taken, findings); final message per lane-rules rule 8.
