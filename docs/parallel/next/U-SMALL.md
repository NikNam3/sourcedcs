# Briefing: U-SMALL (server + client + bridge): the small-items list

Written 2026-10-16 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-SMALL`, branch `lane/U-SMALL`, `E2E_LANE=7`). **Commit at every green step, at
least every ~15 minutes; one commit per item.** No ADR number (none of these items changes a design; if one turns out
to, stop that item and report it).

Running beside you: **U-DECLUTTER** (owns `track-label.js`, `surveillance/presentation.js`, the Settings RADAR tab,
`map-layers-overlays.js`, `geojson.js`, the `KEEP IFR` label) and **U-MOA-TRANSIT** (docs only). Stay out of those files;
if an item needs one, write it in your wip note for the supervisor.

## Items, in this order

1. **No station frequency hardcoded (H147 RQ5, stands under H149).** `lxsrs_v2/client.py` has three 251 MHz literals:
   l.447 (`make_radio(251_000_000.0, …)` default slot), l.530 (`cycle_modulation` reset), l.551 (`freq_mhz` default
   251.0). Both copies are tracked: `lxsrs_v2/lxsrs_v2/client.py` and `crc-desktop/python-pkg/lxsrs_v2/client.py`; keep
   them identical (find out whether something checks that; if nothing does, say so in the wip note). Give the bridge a
   config path for its default frequency (how `crc-desktop/lxsrs-setup.js` / `main.js` launch it, what the SRS panel
   `srs-radio.js` already sends; the station frequencies live in crc-sync JSON, `config/comm-card.json` and the facility
   files). A sensible shape: the launcher passes a default from config, the bridge has no literal, an unset default
   leaves the slot untuned. Python tests under `lxsrs_v2/tests` (`python3 -m pytest`), plus `crc-desktop/tests/
   lxsrs-setup.test.js`. Re-run the frequency audit (`command grep -rnE '2[0-9]{2}\.[0-9]{3}|[0-9]{3}_000_000'` over
   crc-sync/src, crc-desktop/app/public/js, lxsrs_v2) and list it.
2. **Soak REFUSE memory (S-ARCH-67).** With REFUSE in the soak driver's mix the leak detector read R² 0.86 (< 0.9), so
   `crc-sync/tools/soak/traffic.js` (l.~128) never refuses. Find out whether an unsettled refused exchange holds memory
   (board, exchange store, idempotency/replay cache in `src/efsp/sync/`, the ledger `tools/soak/ledger.js`). If it does,
   fix the leak; then put REFUSE back in the mix and show `soak:selfcheck` PASS and a `soak:smoke` with it. If it does
   not, explain the R² drop and put REFUSE back if the detector still fires.
3. **FAA quotes for ADR 0126** (no ADR edit, P4): `docs/research/twr-pattern-quotes.md` quoting JO 7110.65 ¶3-10-5
   and AIM 4-3-3 / 4-3-22 verbatim with the edition, plus ¶3-8-2 which ADR 0126 already uses. faa.gov gave the last lane
   403: try other public copies and name the source. Note any place ADR 0126 disagrees with the text.
4. **The briefing's small-items row** (`docs/efsp-briefing.md` §4, l.~1600; sources S-ARCH-49/51/53/56):
   - TOFI with one counterpart sends at once and does not name its target (name it, like T20's buttons);
   - the Strip ⋯ menu can print the "Flight" heading twice;
   - `LUAW_WHILE_COMBINED_TEXT` still carries citations and "consider splitting the positions" (dark cockpit: never tell
     the controller their job; keep the condition, drop the advice);
   - stale comments: the reconciler's `tick()` docstring on same-rung ties (§3C), `surveillance/par-monitor.js` l.10
     "Landing assured", `tools/soak/shadow.js` l.49 "six stores" (five);
   - normalise ATO / DD-1801 aircraft types to ICAO designators (`F-16C` → `F16`) where they enter (ATO import, flight
     plan lookup); check the "ours" wake rows in `src/efsp/aircraft-data.js` against ICAO Doc 8643 (cite it; fix wrong
     rows); the `wakeCategory: 'D'` test seeds (make them valid L/M/H/J);
   - check that an airspace approval rewriting a frequency leaves no Strip on `ap-sfa` (find the path, add a unit test;
     fix if it does).

## Tests and gates

Run the test files you touch while working; before the report both unit suites, `npm run walk`, `npm run freeze`
(`freeze:update` in its own commit if goldens move, explain the diff), `soak:selfcheck` (item 2 moves soak files),
`npm run wire:record` only if the wire surface moves (it should not). Module-graph fixture re-record if client exports
change. e2e: only specs for what you changed (TOFI, ⋯ menu), `E2E_LANE=7`.

## Output

Commits on `lane/U-SMALL`; `docs/research/twr-pattern-quotes.md`; `docs/wip/U-SMALL.md` (per item: what changed,
usage-guide/briefing wording for the docs pass, the frequency audit, the soak finding, defaults taken, anything left);
final message per lane-rules rule 8.
