# Briefing: U-CARRIER (server + client): the carrier panels' v2 prototype fixes, U18–U22

Written 2026-10-21 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-CARRIER`, branch `lane/U-CARRIER`, `E2E_LANE=8`). **One commit per item; commit
at every green step, at least every ~15 minutes.** ADR number **0137** (yours, if a decision needs recording; U22 likely
does).

**Scope (H159):** v2 ships a *first working prototype* of the carrier panels; upgraded carrier panels are v3. Fix what
the live test found, make it work end to end, plain unit tests plus the carrier specs named below. No redesign.

Running beside you: **U-ROLE-POSITIONS** (lean: `authority/`, `position-store.js`, `facility-config.js`, every
`DEFAULT_FACILITY_ID` user, client sends; the carrier handoffs' rule tables move to roles there) and **U-SMALL-FIXES**
(`vfr.js`, airspace transit ops/ticker, soak driver, `strip-indicators.js` transit marks). Stay out of their files; where
a carrier rule must change in an authority table, keep the hunk minimal and say so (rule 9: name roles such as
`CV_MARSHAL`, never `CV_APP1`).

## Items (`/home/nklx/dev/personal/sourcedcs/docs/parallel/live-test-2026-10-13.md` §F; decisions H122–H127, H144,
H156 CV-Q1 in `docs/parallel/decisions.md`; `docs/efsp-briefing.md` carrier sections; ADRs on the carrier family)

1. **U18 — the carrier cannot create a Strip.** Find why (rights table, missing UI action, or no Strip type for a
   carrier arrival/departure) and let the carrier Positions create the Strips they need (recommended: the same
   create flow the airfield uses, the carrier's Facility, the Strip types the carrier family already handles).
2. **U19 — remove PriFly's pattern section** (INITIAL, BREAK, DOWNWIND, GROOVE) entirely: it happens zip-lip with no
   controller action. Server state, ops, wire keys and client; `npm run wire:record`.
3. **U20 — a Bay for recovered aircraft** on the carrier (where a trapped aircraft's Strip goes; recommended: a
   RECOVERED Bay in PriFly's panel, Strip moved there on the trap/"recovered" action, dropped from there like any
   finished Strip).
4. **U21 — the carrier map:** the Marshal symbol bigger and drawn as an orbit (racetrack/holding pattern, not a line);
   show the planned path after leaving Marshal (push → platform → ten-mile → final, per the Case) and the pattern.
5. **U22 `[R]` — EAT and fuel editable in the MARSHAL panel.** Research first: CV NATOPS / CV ATC manual (cite
   paragraphs) on how Marshal assigns an Expected Approach Time. Today fuel is typed on the Strip (`lowStateLb`) and EAT
   is derived from the stack slot and ramp time (`marshal-stack.js` `DERIVED_KEYS` refuses it). Recommended unless the
   manual says otherwise: fuel editable in the panel (writes the same Strip field); EAT editable as a per-flight
   override that wins over the derived value until cleared, shown set (grey); DELTA still shifts all. Record it in ADR
   0137. Keep 9° and 6 min (H156 CV-Q1 a).

## Gates

Both unit suites, `npm run walk`, `npm run freeze` (goldens: `freeze:update`, small diff, separate commit),
`soak:selfcheck` if Board/wire/hub moved, `wire:record`, module-graph fixture if exports change. Specs: the carrier
ones (`carrier-*`, marshal/prifly specs: find them) on `E2E_LANE=8` only, never the full suite. Every command under
`nice -n 19`.

## Output

Commits; ADR 0137 if needed; `docs/wip/U-CARRIER.md` (guide wording, research quotes, defaults taken, what is left for
v3); final message per rule 8.
