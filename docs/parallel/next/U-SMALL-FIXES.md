# Briefing: U-SMALL-FIXES (server + client + soak): five small v2 fixes

Written 2026-10-21 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-SMALL-FIXES`, branch `lane/U-SMALL-FIXES`, `E2E_LANE=7`). **One commit per item;
commit at every green step, at least every ~15 minutes.** ADR number **0136** only if item 4 or 5 needs one (they
change ADR 0128's behaviour: P4, never edit 0128; one short ADR covering both is fine).

v2 is the priority (H159): these are fixes, keep them small and tested with plain unit tests plus the specs named.

Running beside you: **U-TERRAIN-DCS** (terrain, coverage, grpc-client, theaters, client elevation/los) and
**U-ROLE-POSITIONS** (lean, H158: `authority/`, `position-store.js`, `facility-config.js`, every `DEFAULT_FACILITY_ID`
user, client sends). Stay out of their files. If an item needs "the Position's Facility", use what exists today and say
so; do not add a `DEFAULT_FACILITY_ID` use (rule 9).

## Items (decisions in `/home/nklx/dev/personal/sourcedcs/docs/parallel/decisions.md`)

1. **`vfr.js`** (S-ARCH-76): clearing an assigned altitude leaves an ACTIVE entry with an empty value, so
   `hasNoClearance` still calls the flight IFR. An empty value is no clearance. Fix at the source if clearing should
   remove the entry (check the Strip field op), and make `hasNoClearance` robust either way.
2. **`crc-desktop/e2e/airspace-entry-alert.spec.js`** cleanup (S-ARCH-76, U-AIRSPACE-BADGE's report): it sends
   `DeleteAirspace` without `baseDefRev` and is refused, leaving test airspaces on the rig. Send the current
   `baseDefRev`; check the other specs that delete airspaces for the same bug.
3. **Soak `skip-shadow-client`** (S-ARCH-75): the selfcheck case fails on seeds 15, 16, 23, 26 because the dropped frame
   removes a Strip that is being dropped anyway, so nothing is left to detect (`crc-sync/tools/soak/driver.js` ~201,
   the `injectShadowDrop` condition). Drop a frame a later one cannot repair; prove it on seeds 1–30
   (`soak:selfcheck -- --seed n`, or however the runner takes a seed).
4. **MTB-Q2 b** (H156): a transit decline **stays until the requester acknowledges it**, instead of being forgotten
   after 5 minutes (`crc-sync/src/app/tickers.js` ~79, the `airspace-transits` ticker; the transit op family in
   `efsp/airspace/`). An acknowledge op from the requesting side (rights: the Position that requested, or whoever holds
   the flight's live Strip now: recommended the latter, log it); the client shows Acknowledge where the decline is shown
   today. The transit still ends when the flight's last live Strip goes. `npm run wire:record`.
5. **MTB-Q3** (H156): no 5-minute feature. A **grey "coordinate" mark** on a flight whose filed route crosses an
   ACTIVE MOA/WARNING/RESTRICTED (the filed-through geometry, `airspace/route-geometry.js`) and that has no transit and
   no approved entry for it. Grey (dark cockpit), shown where the transit marks are (`strip-indicators.js` ~129); it
   goes when a transit is requested or an entry approved, or the airspace goes cold. The server already knows
   filed-through per airspace (the card list, `airspace-entry-alert.js`): deliver the fact to the Strip holder the way
   U-AIRSPACE-BADGE delivers `airspaceInside` (merged, read it first), do not compute geometry on the client.

## Gates

Both unit suites, `npm run walk`, `npm run freeze` (goldens: `freeze:update`, small diff, separate commit),
`soak:selfcheck` (item 3 on many seeds), `wire:record`, module-graph fixture if exports change. Specs:
`airspace-entry-alert`, `moa-transit`, `airspace-badge`, on `E2E_LANE=7` only. Every command under `nice -n 19`.

## Output

Commits; ADR 0136 if needed; `docs/wip/U-SMALL-FIXES.md` (guide wording, defaults taken); final message per rule 8.
