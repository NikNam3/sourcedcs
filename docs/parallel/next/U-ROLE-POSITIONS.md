# Briefing: U-ROLE-POSITIONS (server + client): build ADR 0132, roles per Position, no default Facility

Written 2026-10-21 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-ROLE-POSITIONS`, branch `lane/U-ROLE-POSITIONS`, `E2E_LANE=9`). **Commit at every
green step, at least every ~15 minutes; one commit per numbered step below where you can.** No new ADR is expected:
you build **ADR 0132** as written (P4: never edit it). If building it proves a part of it wrong, take ADR number
**0135**, write a short ADR that supersedes only that part, and say so in your report.

Running beside you: **U-AIRSPACE-BADGE** (`efsp/airspace-entry-alert.js`, a hub "inside" fact per Strip, client
`strip-indicators.js`), **U-TERRAIN-DCS** (`terrain.js`, `coverage.js`, `grpc-client.js` Eval, `theaters.*`, client
`elevation.js`/`los.js`). Your change is wide; theirs are narrow. Where you must touch their files (a
`DEFAULT_FACILITY_ID` there), keep the hunk minimal and list it in your report so the supervisor merges in order.

## Why

Read in `/home/nklx/dev/personal/sourcedcs/docs/parallel/decisions.md`: **S-ARCH-79** (why adding Konya is not
JSON-only today: hard-coded facility table, rules keyed by id, `DEFAULT_FACILITY_ID` in ~25 server getters and the
client's sends), **S-ARCH-80** (ADR 0132 written), **H156** (RP-Q1 a: "too many combinations to test all, possibly 50+
facilities"; RP-Q2: Konya is V3, prove it with a fixture only; SC-Q1: the airport surface follows the Positions held).
Then **ADR 0132** whole, and lane-rules rule 9.

## Steps (suggested order; take the recommended default, log it, P2)

1. **Roles.** `authority/roles.js` with the closed vocabulary; `positionRoles` in each shipped facility file; strict
   start-up check (missing/unknown role, duplicate Position id across files naming both files). `roleOf`,
   `facilityOf`, `positionWithRole(facilityId, role)`.
2. **Facility files discovered** (§6): every `config/efsp-facility-*.json` plus its `state/` override, Facility id from
   the file's `facility` key, unique; `CRCSYNC_EFSP_FACILITY_DIR` replaces the per-file env vars (update the e2e
   harness and soak host that set them). `FACILITY_CONFIG_FILES` / `SHIPPED_FACILITY_IDS` go.
3. **Rules by role** (§3): state-owner tables, Position families (`authority/positions/*.js`), strip types
   (`authority/strip-types/*.js`), combination, carrier handoffs, `position-store.js`, and every client mirror. Each
   rule is evaluated for the one acting Position in the Strip's Facility.
4. **Topology in the file** (§5): `departureHandoff`, `arrivalFrom`, cross-Facility `consolidation` (hat offers,
   ADR 0110, may cross Facilities; Strips stay in their Facility).
5. **No default Facility** (§4): remove `DEFAULT_FACILITY_ID` and every default `facilityId` parameter, server and
   client; new refusal `FACILITY_MISMATCH` (join `refusal-codes.js`'s `REFUSAL_CODES`). The client takes a message's
   Facility from the acting Position.
6. **Client** (§7): the positions frame carries each Position's role (`npm run wire:record`; it decides whether
   protocol 2 stays); labels add the Facility only when one controller holds the same role in two Facilities;
   one-Facility panels (runway status, PAR, frequencies, SFA rack) show their Facility and offer the others held.
7. **First consumer, SC-Q1:** the airport surface layer (U-SCOPE-SMALL's `airportSurface`, Declutter → Map) is shown
   when the controller holds an airport-role Position (LC/GC; CD too? recommended: CD, GC, LC, PAR are airport roles,
   say it in your wip) of a Facility, also when held together with CTR/AP; not shown when only non-airport Positions
   are held. It never names an id.
8. **Proof** (§8 + H156): the `TESTFIELD` fixture (`TF_CD`, `TF_GC`, `TF_LC`, `departureHandoff: 'CTR'`) added by a
   facility file only, a departure CD → GC → LC → CTR on it; the source-scan test (quoted Position id in
   `crc-sync/src/efsp/**` or `crc-desktop/app/public/js/panels/efsp/**` outside an allow-list, and
   `DEFAULT_FACILITY_ID` anywhere); **the rules as properties over generated holdings** (any set of Positions across
   any generated Facilities, a seeded generator, at least 50 generated facility files in one run; properties such as
   "an op is allowed iff the acting Position's role allows it in the Strip's Facility", "a handoff goes only to the
   topology's id", "no Strip changes Facility") rather than an enumerated list; the holding walk table of ADR 0132 as
   named server tests; the two-tower rows as one Playwright spec (`E2E_LANE=9`). Konya itself is **not** shipped (V3).

Incirlik's ids do not change, so Board snapshots, the Mutation log and the freeze goldens keep their ids; goldens
re-record only where the facility hash or the positions frame changes (`npm run freeze:update`, check the diff is
small, commit it separately).

## Tests, gates

Unit tests per step. Before the report: both unit suites, `npm run walk` (and `npm run walk` depth 4 once if the
control-release rules moved), `npm run freeze`, `soak:selfcheck` (the Board and hub move), `wire:record`, module-graph
fixture if client exports change (`GOLDEN_RECORD=1 node --test tests/module-graph.test.mjs`), your spec plus the EFSP
specs that send a `facilityId` (find them; run them on `E2E_LANE=9`, never the full suite). Every command under
`nice -n 19`.

## Output

Commits; `docs/wip/U-ROLE-POSITIONS.md` (how to add an airfield now, step by step, for the guide; the CLAUDE.md
sentence about `DEFAULT_FACILITY_ID` "being removed" becomes "removed"; defaults taken; rule-9 places you could not
fix); final message per rule 8.
