# Briefing: U-VFR-REDO: VFR as a minimal VFR strip on a tagged track, not an IFR Strip without a plan

Written 2026-10-27 by the supervisor. One agent, Opus 5.5. Follow `docs/parallel/lane-rules.md` (worktree
`/home/nklx/dev/personal/sourcedcs-U-VFR-REDO`, branch `lane/U-VFR-REDO`, cut **after U-VQ-AB merged**; E2E lane named at
dispatch). Everything under `nice -n 19`. Grep `decisions.md` (read H136, H166, H172–H175 rows), never read it whole.
New ADR **0146** (supersedes ADR 0143's VFR departure and the flight-following Strip of H136; P4: never edit old ADRs).
Shared docs are not yours: `docs/wip/U-VFR-REDO.md`.

## Why (H174, the human's verdict on the build)

VFR today is "an ifr aircraft that has no flightplan": created only at CD (`vfr-departure.js`, `CreateVfrDeparture`)
with an irrelevant direction of flight; the Strip looks like a cleared IFR Strip, shows fields that do not apply and
nothing says VFR; in the air it gets Hand Off to AP, release, handoff to CTR. **What a controller needs from a VFR:**
the track (primary; a transponder is not needed) correlated with a callsign by clicking the track and giving it a
tag; cancellable conflict alerts (U-VQ-AB, merged before you); assign and cancel HDG/SPD/ALT with conformance checks.
Everything else not needed.

## Rulings (H175, Desk round 18)

- **VR-Q1:** a **minimal VFR strip**, everywhere (also at the tower: runway queue, the pattern). It says **VFR**
  (FAA: "VFR" in the altitude block; check FAA JO 7110.65BB ch. 2 sec. 3 strip marking and STARS data block for VFR,
  quote it). Shows only callsign, type, code (if any), assigned HDG/SPD/ALT, and what the tower needs (runway). No
  clearance steps, no Pending Clearance, no route, no destination, no release, no void time.
- **VR-Q2:** moving it between controllers is the **STARS automated handoff** of the track (initiate, the receiver
  accepts, then the frequency change), as for flight following (JO 7110.65BB ¶5-4, flight following ¶7-6-1); **never a
  release** (release is IFR control in another's airspace). No forced "Hand Off to AP/CTR" step: any Position, any time.
- **VR-Q3 / VR-Q4** are on the Desk with recommendations (remove the CD form and today's Start-flight-following Strip,
  replaced by the tag; an optional discrete code from the label menu). Take the recommendations unless the Desk says
  otherwise by the time you reach them (P2, log it).

## Shape (defaults; the code decides the details)

1. **Start it from the track**, at any Position that sees it (ground or air): the track-label menu (ADR 0140,
   `label-menu.js`) and an untracked/primary target's click: type the callsign (and type, optional) → one Mutation makes
   the flight data with `flightRules: 'VFR'`, a VFR strip in the acting Position's working Bay (the one acting Position,
   rule 9: never a literal id), and binds the track (a controller binding, ADR 0142). No code needed; the binding
   follows the primary track. Reuse `flight-following.js` / its server op rather than add a parallel path; fewest node
   kinds (memory): a flight-rules field on the existing flight data, not a new record type, unless the code shows that
   costs more.
2. **Assign/cancel HDG, SPD, ALT** on it exactly like on an IFR Strip from the label menu, with conformance; an emptied
   value is no clearance.
3. **Handoff** as VR-Q2. **Radar service terminated** ends it (code released, binding gone, strip dropped).
4. Remove: `CreateVfrDeparture`, the CD VFR form and `.vfr`, the direction-of-flight field if nothing else uses it,
   OVERFLIGHT-for-flight-following if (1) replaces it. Pattern ops (`board/ops/pattern.js`) work on VFR strips.
5. **Walk the pilot requests** (memory rule) before calling it done: VFR pops up IFR (gets a clearance → becomes an IFR
   Strip); IFR cancels IFR in the air (→ VFR strip, keeps the binding); track lost and back (primary only vs code);
   two controllers tag the same track; handoff not accepted; VFR into active SUA (transit rules, ADR 0128/0144); VFR
   departure and arrival at LTAG through GC/LC and the pattern.
6. Wire: `npm run wire:record`; freeze goldens in their own commit; strict `state/`: an old Board holding
   `CreateVfrDeparture` records or VFR-departure Strips: say in the wip note what the deploy must do.

## Gates

Per the test policy (`refactor/README.md`): your files while working; once before the report both unit suites, freeze,
walk (authority tables change), `soak:selfcheck` (board/wire), the Playwright specs for the panels you changed plus a
new VFR spec on your E2E lane. Final message per rule 8.
